from __future__ import annotations

from collections import Counter
from typing import Any

import pandas as pd

from src.common.exceptions import ComparisonError
from src.matching.aggregation_matcher import compare_aggregates
from src.matching.duplicate_handler import representative
from src.matching.join_engine import KeyCardinality
from src.matching.multiset_matcher import compare_multisets
from src.matching.set_matcher import compare_sets
from src.models.comparison_result import ComparisonSummary, ResultRow, RuleResult
from src.models.config import ComparisonConfig, ComparisonRule
from .base_comparator import ValueComparison
from .boolean_comparator import compare_boolean
from .date_comparator import compare_date
from .number_comparator import compare_number
from .text_comparator import compare_text


class ComparisonEngine:
    """Pure Python/pandas engine. It has no Streamlit dependency."""

    def compare(self, frame_a: pd.DataFrame, frame_b: pd.DataFrame, config: ComparisonConfig) -> list[ResultRow]:
        if "__key_tuple" not in frame_a.columns or "__key_tuple" not in frame_b.columns:
            raise ComparisonError("비교 전에 키를 생성해야 합니다.")
        groups_a = {_as_key_tuple(key): group for key, group in frame_a.groupby("__key_tuple", sort=False, dropna=False)}
        groups_b = {_as_key_tuple(key): group for key, group in frame_b.groupby("__key_tuple", sort=False, dropna=False)}
        keys = self._ordered_keys(groups_a, groups_b, config.join_type)
        result: list[ResultRow] = []
        for key in keys:
            group_a = groups_a.get(key, frame_a.iloc[0:0])
            group_b = groups_b.get(key, frame_b.iloc[0:0])
            result.extend(self._compare_key(key, group_a, group_b, config))
        return result

    @staticmethod
    def _ordered_keys(groups_a: dict, groups_b: dict, join_type: str) -> list:
        keys_a, keys_b = list(groups_a), list(groups_b)
        if join_type == "left":
            return keys_a
        if join_type == "right":
            return keys_b
        if join_type == "inner":
            return [key for key in keys_a if key in groups_b]
        return list(dict.fromkeys([*keys_a, *keys_b]))

    def _compare_key(self, key: tuple[Any, ...], group_a: pd.DataFrame, group_b: pd.DataFrame, config: ComparisonConfig) -> list[ResultRow]:
        a_count, b_count = len(group_a), len(group_b)
        key_display = self._key_display(key)
        if any(_is_missing_key_value(value) for value in key):
            return [ResultRow(key, key_display, "빈 키", "키 열에 빈값이 있습니다.", a_count, b_count, rule_results=self._unavailable_rules(config, "빈 키"))]
        if not a_count:
            return [ResultRow(key, key_display, "데이터셋 B에만 존재", "데이터셋 A에 키가 없습니다.", 0, b_count, rule_results=self._unavailable_rules(config, "상대 데이터셋에 키가 없음"))]
        if not b_count:
            return [ResultRow(key, key_display, "데이터셋 A에만 존재", "데이터셋 B에 키가 없습니다.", a_count, 0, rule_results=self._unavailable_rules(config, "상대 데이터셋에 키가 없음"))]

        cardinality = KeyCardinality(key, a_count, b_count)
        if cardinality.kind == "MANY_TO_MANY":
            return self._compare_many_to_many(key, group_a, group_b, config)
        if cardinality.kind == "ONE_TO_MANY":
            return self._compare_one_to_many(key, group_a, group_b, config, "1:N 비교")
        if cardinality.kind == "MANY_TO_ONE":
            return self._compare_one_to_many(key, group_b, group_a, config, "N:1 비교", swapped=True)
        return [self._compare_rows(key, group_a.iloc[0], group_b.iloc[0], config)]

    def _compare_one_to_many(self, key: tuple[Any, ...], single: pd.DataFrame, many: pd.DataFrame, config: ComparisonConfig, status: str, swapped: bool = False) -> list[ResultRow]:
        policy = config.duplicate_policy_b if not swapped else config.duplicate_policy_a
        if policy.policy_type in {"first", "last", "representative"}:
            ordered = many
            if policy.representative_sort_column and policy.representative_sort_column in many.columns:
                ordered = many.sort_values(
                    policy.representative_sort_column,
                    ascending=policy.representative_sort_direction.lower() == "asc",
                )
            if policy.policy_type == "first":
                selected = ordered.iloc[0]
            elif policy.policy_type == "last":
                selected = ordered.iloc[-1]
            else:
                selected = representative(many, policy)
            result = self._compare_rows(
                key,
                selected if swapped else single.iloc[0],
                single.iloc[0] if swapped else selected,
                config,
            )
            result.status = status
            result.duplicate_type = f"{status} · {policy.policy_type}"
            result.reason = f"{policy.policy_type} 대표 행 선택; {result.reason}"
            return [result]
        if policy.policy_type in {"set", "multiset", "aggregate"}:
            result = self._compare_collection(
                key,
                many if swapped else single,
                single if swapped else many,
                config,
                policy.policy_type,
            )
            result.status = status
            result.duplicate_type = f"{status} · {policy.policy_type}"
            result.reason = f"{policy.policy_type} 처리; {result.reason}"
            return [result]
        if not policy.allow_one_to_many and policy.policy_type == "error":
            return [ResultRow(key, self._key_display(key), "중복 키", "1:N 또는 N:1 키에 대한 행별 비교가 허용되지 않았습니다.", len(single) if not swapped else len(many), len(many) if not swapped else len(single), duplicate_type=status, rule_results=self._unavailable_rules(config, "중복 키 처리 규칙 위반"))]
        output: list[ResultRow] = []
        for _, row in many.iterrows():
            result = self._compare_rows(key, single.iloc[0] if not swapped else row, row if not swapped else single.iloc[0], config)
            result.status = status
            result.reason = f"{status}; " + result.reason
            result.duplicate_type = status
            output.append(result)
        return output

    def _compare_many_to_many(self, key: tuple[Any, ...], group_a: pd.DataFrame, group_b: pd.DataFrame, config: ComparisonConfig) -> list[ResultRow]:
        policy = config.nm_policy
        if policy in {"error", "", "none"}:
            return [ResultRow(key, self._key_display(key), "N:M 처리 필요", "N:M 상태이며 처리 방식이 지정되지 않았습니다.", len(group_a), len(group_b), duplicate_type="N:M", rule_results=self._unavailable_rules(config, "N:M 상태이며 처리 방식 미지정"))]
        if policy == "set":
            return [self._compare_collection(key, group_a, group_b, config, "set")]
        if policy == "multiset":
            return [self._compare_collection(key, group_a, group_b, config, "multiset")]
        if policy == "aggregate":
            return [self._compare_collection(key, group_a, group_b, config, "aggregate")]
        if policy == "representative":
            row_a = representative(group_a, config.duplicate_policy_a)
            row_b = representative(group_b, config.duplicate_policy_b)
            result = self._compare_rows(key, row_a, row_b, config)
            result.status = "중복 키 · 값 동일" if result.status == "모두 동일" else "중복 키 · 값 상이"
            result.duplicate_type = "N:M 대표 행"
            result.reason = f"대표 행 선택; {result.reason}"
            return [result]
        return [ResultRow(key, self._key_display(key), "N:M 처리 필요", f"지원하지 않는 N:M 처리 방식: {policy}", len(group_a), len(group_b), rule_results=self._unavailable_rules(config, f"지원하지 않는 N:M 처리 방식: {policy}"))]

    def _compare_collection(self, key: tuple[Any, ...], group_a: pd.DataFrame, group_b: pd.DataFrame, config: ComparisonConfig, mode: str) -> ResultRow:
        rule_results: list[RuleResult] = []
        all_equal = True
        for rule in config.comparison_rules:
            values_a = group_a[self._column_name(group_a, rule.column_a_id)].tolist()
            values_b = group_b[self._column_name(group_b, rule.column_b_id)].tolist()
            normalized_a, normalized_b = self._normalized_values(values_a, values_b, rule)
            conversion_failed = any(
                not self._compare_value(value, value, rule).conversion_success_a
                for value in [*values_a, *values_b]
            )
            if conversion_failed:
                all_equal = False
                rule_results.append(RuleResult(
                    rule.rule_id, rule.display_name, values_a, values_b,
                    normalized_a, normalized_b, "형식 변환 실패", "중복 값 중 변환할 수 없는 값이 있음",
                    conversion_success_a=False, conversion_success_b=False,
                    comparison_method=mode, duplicate_policy=mode,
                ))
                continue
            if mode == "set":
                detail = compare_sets(normalized_a, normalized_b)
                reason = "고유값 집합이 동일" if detail["equal"] else "고유값 집합이 다름"
                equal = detail["equal"]
            elif mode == "multiset":
                detail = compare_multisets(normalized_a, normalized_b)
                reason = "값별 발생 건수가 동일" if detail["equal"] else "값별 발생 건수가 다름"
                equal = detail["equal"]
            else:
                detail = compare_aggregates(pd.Series(normalized_a), pd.Series(normalized_b), rule.normalization_options.get("aggregation_method", "sum"))
                reason = "집계값이 동일" if detail["equal"] else "집계값이 다름"
                equal = detail["equal"]
            all_equal &= equal
            rule_results.append(RuleResult(rule.rule_id, rule.display_name, values_a, values_b, normalized_a, normalized_b, "동일" if equal else "불일치", reason, comparison_method=mode, duplicate_policy=mode))
        status = "중복 키 · 값 동일" if all_equal else "중복 키 · 값 상이"
        return ResultRow(key, self._key_display(key), status, "; ".join(item.reason for item in rule_results), len(group_a), len(group_b), max((len(set(map(str, group_a[self._column_name(group_a, rule.column_a_id)].tolist()))) for rule in config.comparison_rules), default=0), max((len(set(map(str, group_b[self._column_name(group_b, rule.column_b_id)].tolist()))) for rule in config.comparison_rules), default=0), status, details={"mode": mode}, rule_results=rule_results)

    def _compare_rows(self, key: tuple[Any, ...], row_a: pd.Series, row_b: pd.Series, config: ComparisonConfig) -> ResultRow:
        results: list[RuleResult] = []
        for rule in config.comparison_rules:
            value_a = row_a[self._column_name(row_a, rule.column_a_id)]
            value_b = row_b[self._column_name(row_b, rule.column_b_id)]
            comparison = self._compare_value(value_a, value_b, rule)
            results.append(RuleResult(
                rule.rule_id, rule.display_name, value_a, value_b,
                comparison.normalized_a, comparison.normalized_b,
                "동일" if comparison.equal else "불일치", comparison.reason,
                comparison.numeric_difference, comparison.absolute_difference,
                comparison.difference_rate, comparison.conversion_success_a,
                comparison.conversion_success_b, rule.comparison_method,
            ))
        conversion_failed = any(not item.conversion_success_a or not item.conversion_success_b for item in results)
        all_equal = all(item.status == "동일" for item in results)
        if conversion_failed:
            status, reason = "형식 변환 실패", "; ".join(item.reason for item in results if "변환" in item.reason)
        elif all_equal:
            status, reason = "모두 동일", "모든 비교 규칙이 동일합니다."
        elif all(item.status == "불일치" for item in results):
            status, reason = "모든 항목 불일치", "; ".join(item.reason for item in results)
        else:
            status, reason = "일부 항목 불일치", "; ".join(item.reason for item in results if item.status == "불일치")
        return ResultRow(key, self._key_display(key), status, reason, 1, 1, rule_results=results, row_id_a=row_a.get("__row_id"), row_id_b=row_b.get("__row_id"))

    def _compare_value(self, value_a: Any, value_b: Any, rule: ComparisonRule) -> ValueComparison:
        if rule.data_type in {"number", "unit_number"}:
            return compare_number(value_a, value_b, rule)
        if rule.data_type in {"date", "datetime"}:
            return compare_date(value_a, value_b, rule)
        if rule.data_type == "boolean":
            return compare_boolean(value_a, value_b, rule)
        return compare_text(value_a, value_b, rule)

    @staticmethod
    def _unavailable_rules(config: ComparisonConfig, reason: str) -> list[RuleResult]:
        return [RuleResult(rule.rule_id, rule.display_name, status="비교 불가", reason=reason, comparison_method=rule.comparison_method) for rule in config.comparison_rules]

    def _normalized_values(self, values_a: list, values_b: list, rule: ComparisonRule) -> tuple[list, list]:
        return ([self._compare_value(value, value, rule).normalized_a for value in values_a], [self._compare_value(value, value, rule).normalized_a for value in values_b])

    @staticmethod
    def _column_name(frame: pd.DataFrame | pd.Series, identifier: str) -> str:
        available = frame.index if isinstance(frame, pd.Series) else frame.columns
        if identifier in available:
            return identifier
        raise ComparisonError(f"비교 열을 찾을 수 없습니다: {identifier}")

    @staticmethod
    def _key_display(key: tuple[Any, ...]) -> str:
        return " | ".join("(빈값)" if _is_missing_key_value(value) else str(value) for value in key)


def _is_missing_key_value(value: Any) -> bool:
    if value is None:
        return True
    try:
        missing = pd.isna(value)
        return not hasattr(missing, "__len__") and bool(missing)
    except (TypeError, ValueError):
        return False


def _as_key_tuple(value: Any) -> tuple[Any, ...]:
    return value if isinstance(value, tuple) else (value,)


def result_rows_to_frame(rows: list[ResultRow]) -> pd.DataFrame:
    output: list[dict[str, Any]] = []
    for row in rows:
        base = {
            "키": row.key_display, "상태": row.status, "사유": row.reason,
            "A 키 발생 건수": row.a_count, "B 키 발생 건수": row.b_count,
            "A 고유값 개수": row.a_unique_count, "B 고유값 개수": row.b_unique_count,
            "중복 유형": row.duplicate_type, "A 행 식별자": row.row_id_a, "B 행 식별자": row.row_id_b,
        }
        if row.details:
            base["중복 상세"] = str(row.details)
        if not row.rule_results:
            output.append(base)
            continue
        for item in row.rule_results:
            values = dict(base)
            values.update({
                f"{item.display_name} · A 원본값": item.original_a,
                f"{item.display_name} · B 원본값": item.original_b,
                f"{item.display_name} · A 정규화값": item.normalized_a,
                f"{item.display_name} · B 정규화값": item.normalized_b,
                f"{item.display_name} · 결과": item.status,
                f"{item.display_name} · 불일치 사유": item.reason,
                f"{item.display_name} · 숫자 차이": item.numeric_difference,
                f"{item.display_name} · 절대 차이": item.absolute_difference,
                f"{item.display_name} · 차이율": item.difference_rate,
                f"{item.display_name} · 변환 성공 A": item.conversion_success_a,
                f"{item.display_name} · 변환 성공 B": item.conversion_success_b,
                f"{item.display_name} · 비교 방식": item.comparison_method,
                f"{item.display_name} · 중복 처리 방식": item.duplicate_policy,
            })
            output.append(values)
    return pd.DataFrame(output)


def summarize(rows: list[ResultRow]) -> ComparisonSummary:
    by_status = Counter(row.status for row in rows)
    comparable = sum(row.status in {"모두 동일", "일부 항목 불일치", "모든 항목 불일치", "1:N 비교", "N:1 비교", "중복 키 · 값 동일", "중복 키 · 값 상이"} for row in rows)
    rowwise_identical = sum(
        row.status in {"1:N 비교", "N:1 비교"}
        and bool(row.rule_results)
        and all(item.status == "동일" for item in row.rule_results)
        for row in rows
    )
    rowwise_mismatch = sum(
        row.status in {"1:N 비교", "N:1 비교"}
        and any(item.status != "동일" for item in row.rule_results)
        for row in rows
    )
    identical = by_status.get("모두 동일", 0) + by_status.get("중복 키 · 값 동일", 0) + rowwise_identical
    mismatch = by_status.get("일부 항목 불일치", 0) + by_status.get("모든 항목 불일치", 0) + by_status.get("중복 키 · 값 상이", 0) + rowwise_mismatch
    return ComparisonSummary(len(rows), comparable, identical, mismatch, by_status.get("데이터셋 A에만 존재", 0), by_status.get("데이터셋 B에만 존재", 0), sum("중복" in row.status for row in rows), by_status.get("형식 변환 실패", 0), by_status.get("N:M 처리 필요", 0), identical / comparable * 100 if comparable else 0.0, dict(by_status))
