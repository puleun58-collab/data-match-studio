from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pandas as pd
import streamlit as st

from src.common.exceptions import DataCompareError
from src.common.validators import validate_config, validate_upload
from src.comparison import ComparisonEngine, result_rows_to_frame, summarize
from src.export import export_csv, export_excel
from src.loaders import loader_for
from src.matching.join_engine import analyze_cardinality, cardinality_summary
from src.matching.key_builder import add_key_columns
from src.mapping import MappingGroup, build_mapping, dump_mapping_json, groups_from_wide_frame, load_mapping_json
from src.models.config import (
    ColumnRef,
    ComparisonConfig,
    ComparisonRule,
    DatasetConfig,
    DuplicatePolicy,
    KeyMappingConfig,
    KeyNormalizationOptions,
    NullPolicy,
    ToleranceOptions,
)
from src.profiling import detect_header_candidates, infer_types, profile_duplicates, profile_frame, profile_to_frame
from src.templates import apply_column_remap, dump_template, load_template

st.set_page_config(page_title="범용 데이터 비교", layout="wide")
MAX_UPLOAD_BYTES = 200 * 1024 * 1024


@st.cache_data(show_spinner=False, ttl=300, max_entries=4)
def cached_sheet_infos(file_name: str, payload: bytes):
    return loader_for(file_name).sheets(payload)


@st.cache_data(show_spinner=False, ttl=300, max_entries=4)
def cached_load_frame(file_name: str, payload: bytes, sheet_name: str | None, header_row: int, data_start_row: int, encoding: str | None, delimiter: str | None, drop_empty_rows: bool, drop_empty_columns: bool) -> pd.DataFrame:
    return loader_for(file_name).load(payload, sheet_name, header_row, data_start_row, encoding, delimiter, drop_empty_rows, drop_empty_columns)


def make_column_refs(frame: pd.DataFrame, prefix: str) -> tuple[pd.DataFrame, list[ColumnRef]]:
    refs: list[ColumnRef] = []
    internal_names: list[str] = []
    for index, name in enumerate(frame.columns):
        internal = f"{prefix}_col_{index}"
        internal_names.append(internal)
        refs.append(ColumnRef(index, excel_letter(index), str(name), internal))
    prepared = frame.copy()
    prepared.columns = internal_names
    return prepared, refs


def excel_letter(index: int) -> str:
    value = index + 1
    letters = ""
    while value:
        value, remainder = divmod(value - 1, 26)
        letters = chr(65 + remainder) + letters
    return letters


def read_dataset(uploaded: Any, side: str) -> tuple[pd.DataFrame, list[ColumnRef], DatasetConfig] | None:
    if uploaded is None:
        return None
    payload = uploaded.getvalue()
    try:
        validate_upload(uploaded.name, len(payload), MAX_UPLOAD_BYTES)
        sheet_infos = cached_sheet_infos(uploaded.name, payload)
        sheet_names = [item.name for item in sheet_infos]
        selected_sheet = st.selectbox(f"데이터셋 {side} 시트", sheet_names, key=f"sheet_{side}")
        selected_info = next(item for item in sheet_infos if item.name == selected_sheet)
        candidates = list(range(1, min(len(selected_info.preview), 20) + 1)) or [1]
        detected = 1
        if selected_info.preview.shape[0]:
            detected = detect_header_candidates(selected_info.preview, 1)[0].row_number
        header_row = st.selectbox(f"데이터셋 {side} 헤더 행 (1부터)", candidates, index=max(0, candidates.index(detected)), key=f"header_{side}")
        data_start = st.number_input(f"데이터셋 {side} 데이터 시작 행", min_value=header_row + 1, value=header_row + 1, step=1, key=f"start_{side}")
        drop_empty_rows = st.checkbox(f"데이터셋 {side} 완전히 빈 행 제거", value=True, key=f"drop_rows_{side}")
        drop_empty_columns = st.checkbox(f"데이터셋 {side} 완전히 빈 열 제거", value=True, key=f"drop_columns_{side}")
        encoding = None
        delimiter = None
        if Path(uploaded.name).suffix.lower() == ".csv":
            encoding = st.selectbox("CSV 인코딩", ["utf-8-sig", "utf-8", "cp949", "euc-kr", "latin-1"], key=f"encoding_{side}")
            delimiter = st.selectbox("CSV 구분자", [",", ";", "탭", "|"], key=f"delimiter_{side}")
            delimiter = "\t" if delimiter == "탭" else delimiter
        with st.expander(f"데이터셋 {side} 원본 상위 20행", expanded=False):
            st.dataframe(selected_info.preview, use_container_width=True)
        frame = cached_load_frame(uploaded.name, payload, selected_sheet, header_row, int(data_start), encoding, delimiter, drop_empty_rows, drop_empty_columns)
        prepared, refs = make_column_refs(frame, side.lower())
        config = DatasetConfig(
            file_name=uploaded.name,
            source_type=Path(uploaded.name).suffix.lower().lstrip("."),
            sheet_name=selected_sheet,
            header_row=int(header_row),
            data_start_row=int(data_start),
            key_columns=[],
            key_normalization=KeyNormalizationOptions(),
            drop_empty_rows=drop_empty_rows,
            drop_empty_columns=drop_empty_columns,
            encoding=encoding,
            delimiter=delimiter,
        )
        st.caption(f"{uploaded.name}: {len(prepared):,}행 × {len(prepared.columns):,}열")
        return prepared, refs, config
    except DataCompareError as exc:
        st.error(str(exc))
    except Exception:
        st.error(f"데이터셋 {side}를 읽지 못했습니다. 파일, 시트, 헤더 설정을 확인하세요.")
    return None


def build_rule(rule_id: str, index: int, refs_a: list[ColumnRef], refs_b: list[ColumnRef], existing: dict[str, Any] | None = None, inferred_types: dict[str, str] | None = None) -> ComparisonRule:
    existing = existing or {}
    inferred_types = inferred_types or {}
    return ComparisonRule(
        rule_id=rule_id,
        display_name=existing.get("display_name", f"비교 항목 {index + 1}"),
        column_a_id=existing.get("column_a_id", refs_a[0].column_id),
        column_b_id=existing.get("column_b_id", refs_b[0].column_id),
        data_type=existing.get("data_type", inferred_types.get(existing.get("column_a_id", refs_a[0].column_id), "text")),
        comparison_method=existing.get("comparison_method", "exact"),
        normalization_options=existing.get("normalization_options", {}),
        null_policy=NullPolicy(**existing.get("null_policy", {})) if isinstance(existing.get("null_policy"), dict) else NullPolicy(),
        tolerance_options=ToleranceOptions(**existing.get("tolerance_options", {})) if isinstance(existing.get("tolerance_options"), dict) else ToleranceOptions(),
    )


def main() -> None:
    st.title("범용 Excel·CSV 데이터 비교")
    st.caption("업로드 파일은 세션 메모리에서만 처리되며 외부로 전송하거나 영구 저장하지 않습니다.")
    if "rules" not in st.session_state:
        st.session_state.rules = []
    if "results" not in st.session_state:
        st.session_state.results = None

    with st.sidebar:
        st.header("1. 파일 업로드")
        file_a = st.file_uploader("데이터셋 A", type=["xlsx", "xlsm", "csv"], key="file_a")
        file_b = st.file_uploader("데이터셋 B", type=["xlsx", "xlsm", "csv"], key="file_b")
        if file_a and file_b and file_a.getvalue() == file_b.getvalue():
            st.info("동일 파일이 업로드되었습니다. 각 데이터셋에서 시트를 다르게 선택할 수 있습니다.")

    if not file_a or not file_b:
        st.info("데이터셋 A와 B를 업로드하면 설정 화면이 열립니다.")
        return

    left, right = st.columns(2)
    with left:
        st.subheader("2. 데이터셋 A 영역")
        dataset_a = read_dataset(file_a, "A")
    with right:
        st.subheader("2. 데이터셋 B 영역")
        dataset_b = read_dataset(file_b, "B")
    if dataset_a is None or dataset_b is None:
        return
    frame_a, refs_a, config_a = dataset_a
    frame_b, refs_b, config_b = dataset_b
    if not refs_a or not refs_b:
        st.error("데이터셋에 사용할 수 있는 열이 없습니다. 헤더 행과 데이터 영역을 확인하세요.")
        return
    pending_template = st.session_state.pop("template_applied_config", None)
    if pending_template is not None:
        st.session_state.keys_a = [ref.display_name for ref in refs_a if ref.column_id in pending_template.dataset_a.key_columns]
        st.session_state.keys_b = [ref.display_name for ref in refs_b if ref.column_id in pending_template.dataset_b.key_columns]
        st.session_state.join_type = pending_template.join_type
        st.session_state.nm_policy = pending_template.nm_policy
        mapping_a = pending_template.dataset_a.key_mappings
        mapping_b = pending_template.dataset_b.key_mappings
        if mapping_a or mapping_b:
            st.session_state.use_key_mapping = True
            st.session_state.pop("mapping_manual_editor", None)
            st.session_state.mapping_apply_a = list(mapping_a)
            st.session_state.mapping_apply_b = list(mapping_b)
            merged_groups: dict[str, list[Any]] = {}
            for mapping in [*mapping_a.values(), *mapping_b.values()]:
                for canonical, aliases in mapping.groups.items():
                    merged_groups.setdefault(canonical, [])
                    merged_groups[canonical].extend(alias for alias in aliases if alias not in merged_groups[canonical])
            st.session_state.template_mapping_groups = merged_groups
        st.session_state.rules = [{"rule_id": rule.rule_id, "display_name": rule.display_name, "column_a_id": rule.column_a_id, "column_b_id": rule.column_b_id, "data_type": rule.data_type, "comparison_method": rule.comparison_method, "normalization_options": rule.normalization_options, "null_policy": rule.null_policy.__dict__, "tolerance_options": rule.tolerance_options.__dict__} for rule in pending_template.comparison_rules]

    tabs = st.tabs(["원본 미리보기", "데이터 품질", "키·중복 분석", "비교 규칙", "결과", "다운로드"])
    with tabs[0]:
        st.subheader("원본 데이터 미리보기")
        st.dataframe(frame_a.head(20), use_container_width=True)
        st.dataframe(frame_b.head(20), use_container_width=True)
    with tabs[1]:
        st.subheader("데이터 품질 프로파일")
        st.dataframe(profile_to_frame(profile_frame(frame_a)), use_container_width=True)
        st.dataframe(profile_to_frame(profile_frame(frame_b)), use_container_width=True)

    with st.sidebar:
        st.header("3. 키 설정")
        labels_a = [ref.display_name for ref in refs_a]
        labels_b = [ref.display_name for ref in refs_b]
        label_to_id_a = {ref.display_name: ref.column_id for ref in refs_a}
        label_to_id_b = {ref.display_name: ref.column_id for ref in refs_b}
        keys_a_labels = st.multiselect("A 키 열 (복합 키 가능)", labels_a, key="keys_a")
        keys_b_labels = st.multiselect("B 키 열 (복합 키 가능)", labels_b, key="keys_b")
        key_options = render_key_options("키 정규화")
        join_type = st.selectbox("조인 방식", ["outer", "left", "right", "inner"], key="join_type", format_func=lambda x: {"outer": "전체 외부 조인", "left": "왼쪽 조인", "right": "오른쪽 조인", "inner": "내부 조인"}[x])
        config_a.key_columns = [label_to_id_a[value] for value in keys_a_labels]
        config_b.key_columns = [label_to_id_b[value] for value in keys_b_labels]
        config_a.key_normalization = key_options
        mapping_result, mapping_ready = render_key_mapping_options(
            key_options,
            config_a,
            config_b,
            refs_a,
            refs_b,
        )
        config_b.key_normalization = key_options

    with tabs[2]:
        st.subheader("키 분석")
        if config_a.key_columns and config_b.key_columns and len(config_a.key_columns) == len(config_b.key_columns):
            keyed_a = add_key_columns(frame_a, config_a.key_columns, key_options, config_a.key_mappings)
            keyed_b = add_key_columns(frame_b, config_b.key_columns, key_options, config_b.key_mappings)
            cardinalities = analyze_cardinality(keyed_a, keyed_b)
            if mapping_result is not None:
                st.markdown("#### 키 매핑 진단")
                mapping_labels = {
                    "canonical_count": "대표값 개수",
                    "alias_count": "전체 별칭 개수",
                    "mapping_item_count": "매핑 전체 항목 수",
                    "duplicate_alias_count": "중복 별칭 개수",
                    "empty_alias_cell_count": "빈 별칭 셀 개수",
                    "collision_alias_count": "충돌 별칭 개수",
                }
                st.dataframe(pd.DataFrame([{"항목": mapping_labels[key], "값": mapping_result.stats[key]} for key in mapping_labels]), use_container_width=True)
                st.caption(f"매핑 적용 가능 상태: {'가능' if mapping_result.applicable else '불가'}")
                st.dataframe(pd.DataFrame(mapping_result.preview), use_container_width=True)
            summary = cardinality_summary(cardinalities)
            st.json(summary)
            profile_a = profile_duplicates(keyed_a, config_a.key_columns)
            profile_b = profile_duplicates(keyed_b, config_b.key_columns)
            diagnostic = pd.DataFrame([
                {"항목": "전체 행 수", "A": len(keyed_a), "B": len(keyed_b)},
                {"항목": "고유 키 수", "A": profile_a.unique_key_count, "B": profile_b.unique_key_count},
                {"항목": "빈 키 행 수", "A": profile_a.empty_key_count, "B": profile_b.empty_key_count},
                {"항목": "중복 키 수", "A": len(profile_a.duplicate_keys), "B": len(profile_b.duplicate_keys)},
                {"항목": "최대 키 발생 건수", "A": profile_a.max_count, "B": profile_b.max_count},
            ])
            st.dataframe(diagnostic, use_container_width=True)
            if profile_a.empty_key_count or profile_b.empty_key_count:
                st.warning("키 열에 빈값이 있습니다.")
            if summary["N:M"]:
                st.warning("N:M 키가 발견되었습니다. 명시적 처리 방식을 선택하기 전에는 비교가 중단됩니다.")
            st.dataframe(pd.DataFrame([{"키": " | ".join(map(str, item.key)), "A 행 수": item.a_count, "B 행 수": item.b_count, "카디널리티": item.kind} for item in cardinalities]), use_container_width=True)
        else:
            st.warning("양쪽 키 열을 같은 개수로 선택하세요.")

    with st.sidebar:
        st.header("4. 중복 키 정책")
        policy_a = render_duplicate_policy("A", refs_a)
        policy_b = render_duplicate_policy("B", refs_b)
        nm_policy = st.selectbox("N:M 처리 방식", ["error", "set", "multiset", "aggregate", "representative"], key="nm_policy", format_func=lambda x: {"error": "중복 오류·처리 필요", "set": "고유값 집합 비교", "multiset": "멀티셋 비교", "aggregate": "집계 후 비교", "representative": "대표 행 선택"}[x])

    with tabs[3]:
        st.subheader("5. 비교 규칙")
        if st.button("비교 항목 추가"):
            if refs_a and refs_b:
                rule_id = f"rule_{len(st.session_state.rules) + 1}"
                st.session_state.rules.append({"rule_id": rule_id, "display_name": f"비교 항목 {len(st.session_state.rules) + 1}", "column_a_id": refs_a[0].column_id, "column_b_id": refs_b[0].column_id})
                st.rerun()
        if st.button("전체 규칙 초기화"):
            st.session_state.rules = []
            st.rerun()
        rules: list[ComparisonRule] = []
        for index, raw_rule in enumerate(st.session_state.rules):
            rule = build_rule(raw_rule["rule_id"], index, refs_a, refs_b, raw_rule, infer_types(frame_a))
            with st.expander(rule.display_name, expanded=True):
                rule.display_name = st.text_input("규칙명", rule.display_name, key=f"name_{rule.rule_id}")
                rule.column_a_id = st.selectbox("A 비교 열", [ref.column_id for ref in refs_a], index=column_index(refs_a, rule.column_a_id), format_func=lambda value: ref_label(refs_a, value), key=f"ca_{rule.rule_id}")
                rule.column_b_id = st.selectbox("B 비교 열", [ref.column_id for ref in refs_b], index=column_index(refs_b, rule.column_b_id), format_func=lambda value: ref_label(refs_b, value), key=f"cb_{rule.rule_id}")
                rule.data_type = st.selectbox("데이터 유형", ["text", "number", "date", "datetime", "boolean", "unit_number", "mixed"], index=["text", "number", "date", "datetime", "boolean", "unit_number", "mixed"].index(rule.data_type) if rule.data_type in {"text", "number", "date", "datetime", "boolean", "unit_number", "mixed"} else 0, key=f"type_{rule.rule_id}")
                methods = method_options(rule.data_type)
                rule.comparison_method = st.selectbox("비교 방식", methods, index=methods.index(rule.comparison_method) if rule.comparison_method in methods else 0, key=f"method_{rule.rule_id}")
                if rule.data_type in {"number", "unit_number"}:
                    rule.normalization_options = {"extract_number": rule.data_type == "unit_number", "remove_units": rule.data_type == "unit_number", "remove_commas": True, "remove_currency": True, "parentheses_negative": True, "aggregation_method": st.selectbox("집계 방식", ["sum", "mean", "min", "max", "count", "nunique", "concat_unique"], key=f"agg_{rule.rule_id}")}
                    rule.tolerance_options = ToleranceOptions(decimals=st.number_input("반올림 자릿수", min_value=0, max_value=12, value=2, key=f"dec_{rule.rule_id}") if rule.comparison_method in {"round", "rounding"} else None, absolute=st.number_input("절대 허용 오차", min_value=0.0, value=0.0, key=f"abs_{rule.rule_id}") if rule.comparison_method == "absolute_tolerance" else None, percentage=st.number_input("허용 백분율", min_value=0.0, value=0.0, key=f"pct_{rule.rule_id}") if rule.comparison_method == "percentage" else None)
                if rule.data_type in {"date", "datetime"} and rule.comparison_method == "days_tolerance":
                    rule.tolerance_options = ToleranceOptions(absolute=st.number_input("허용 일수", min_value=0.0, value=0.0, key=f"days_{rule.rule_id}"))
                if rule.data_type == "boolean":
                    mapping_text = st.text_area("불리언 상태값 매핑 JSON", value=json.dumps(rule.normalization_options.get("mapping", {}), ensure_ascii=False), key=f"mapping_{rule.rule_id}")
                    try:
                        parsed_mapping = json.loads(mapping_text)
                        rule.normalization_options = {"mapping": parsed_mapping}
                    except json.JSONDecodeError:
                        st.warning("불리언 매핑은 JSON 객체 형식이어야 합니다.")
                if rule.data_type == "text":
                    rule.normalization_options = {"unicode_normalize": True, "remove_line_breaks": True, "trim": rule.comparison_method in {"trim", "collapse_spaces", "remove_spaces"}, "case_insensitive": rule.comparison_method == "case_insensitive", "collapse_spaces": rule.comparison_method == "collapse_spaces", "remove_all_spaces": rule.comparison_method == "remove_spaces"}
                    replacements = st.text_area("문자열 사용자 치환 JSON", value="{}", key=f"replace_{rule.rule_id}")
                    try:
                        parsed_replacements = json.loads(replacements)
                        if isinstance(parsed_replacements, dict):
                            rule.normalization_options["replacements"] = parsed_replacements
                    except json.JSONDecodeError:
                        st.warning("문자열 치환은 JSON 객체 형식이어야 합니다.")
                rule.null_policy = NullPolicy(both_empty_equal=st.checkbox("양쪽 빈값 동일", value=True, key=f"null_{rule.rule_id}"), empty_equals_zero=st.checkbox("빈값과 0 동일", value=False, key=f"zero_{rule.rule_id}"))
                if st.button("비교 항목 복제", key=f"copy_{rule.rule_id}"):
                    copied = {
                        "rule_id": f"rule_{len(st.session_state.rules) + 1}",
                        "display_name": f"{rule.display_name} 복사",
                        "column_a_id": rule.column_a_id,
                        "column_b_id": rule.column_b_id,
                        "data_type": rule.data_type,
                        "comparison_method": rule.comparison_method,
                        "normalization_options": dict(rule.normalization_options),
                        "null_policy": rule.null_policy.__dict__.copy(),
                        "tolerance_options": rule.tolerance_options.__dict__.copy(),
                    }
                    st.session_state.rules.append(copied)
                    st.rerun()
                if st.button("이 비교 항목 삭제", key=f"delete_{rule.rule_id}"):
                    st.session_state.rules = [item for item in st.session_state.rules if item["rule_id"] != rule.rule_id]
                    st.rerun()
            rules.append(rule)
        config = ComparisonConfig(config_a, config_b, join_type, policy_a, policy_b, nm_policy, rules)

    with st.sidebar:
        st.header("6. 실행")
        if st.button("비교 실행", type="primary", disabled=not (config_a.key_columns and config_b.key_columns and rules and mapping_ready)):
            try:
                validate_config(join_type, config_a.key_columns, config_b.key_columns, len(rules))
                keyed_a = add_key_columns(frame_a, config_a.key_columns, config_a.key_normalization, config_a.key_mappings)
                keyed_b = add_key_columns(frame_b, config_b.key_columns, config_b.key_normalization, config_b.key_mappings)
                rows = ComparisonEngine().compare(keyed_a, keyed_b, config)
                st.session_state.results = {"rows": rows, "config": config, "quality": pd.concat([profile_to_frame(profile_frame(frame_a)).assign(데이터셋="A"), profile_to_frame(profile_frame(frame_b)).assign(데이터셋="B")], ignore_index=True), "summary": summarize(rows)}
                st.success("비교가 완료되었습니다.")
            except (DataCompareError, ValueError) as exc:
                st.error(str(exc))
            except Exception:
                st.error("비교를 완료하지 못했습니다. 키, 비교 열, 중복 정책 설정을 확인하세요.")
        expectations = {
            "A": [{"side": "A", "index": ref.index, "id": ref.column_id, "raw": ref.name, "display": ref.display_name, "normalized_name": ref.name.strip().casefold(), "sheet": config_a.sheet_name, "fingerprint": f"{config_a.file_name}:{ref.index}:{ref.name.strip().casefold()}", "occurrence": 0} for ref in refs_a],
            "B": [{"side": "B", "index": ref.index, "id": ref.column_id, "raw": ref.name, "display": ref.display_name, "normalized_name": ref.name.strip().casefold(), "sheet": config_b.sheet_name, "fingerprint": f"{config_b.file_name}:{ref.index}:{ref.name.strip().casefold()}", "occurrence": 0} for ref in refs_b],
        }
        st.download_button("설정 JSON 저장", dump_template(config, expectations), file_name="comparison_template.json", mime="application/json")
        if st.button("업로드·결과 캐시 즉시 삭제", key="clear_upload_cache"):
            st.cache_data.clear()
            st.session_state.results = None
            st.success("현재 세션의 업로드 캐시와 결과를 삭제했습니다.")
        template = st.file_uploader("설정 JSON 불러오기", type=["json"], key="template")
        if template is not None:
            try:
                loaded = load_template(template.getvalue())
                raw_template = json.loads(template.getvalue())
                st.info("템플릿을 읽었습니다. 아래 재매핑을 확인한 뒤 현재 화면의 키·규칙 선택에 적용하세요. 자동 선택은 하지 않습니다.")
                expected = raw_template.get("column_expectations", {})
                remap_choices: dict[str, str] = {}
                for side, refs in (("A", refs_a), ("B", refs_b)):
                    st.markdown(f"**데이터셋 {side} 열 재매핑**")
                    candidates = ["(선택 안 함)"] + [ref.column_id for ref in refs]
                    for item in _expectation_items(expected.get(side, {}), side):
                        old_id, old_name = item["id"], item.get("display") or item.get("raw") or old_id
                        default_index = candidates.index(old_id) if old_id in candidates else 0
                        selected = st.selectbox(f"기대 열: {old_name} [{old_id}]", candidates, index=default_index, format_func=lambda value, refs=refs: ref_label(refs, value) if value != "(선택 안 함)" else value, key=f"remap_{side}_{old_id}")
                        if selected != "(선택 안 함)": remap_choices[old_id] = selected
                if st.button("템플릿 매핑 적용", key="apply_template"):
                    required = set(loaded.dataset_a.key_columns + loaded.dataset_b.key_columns)
                    required.update(rule.column_a_id for rule in loaded.comparison_rules)
                    required.update(rule.column_b_id for rule in loaded.comparison_rules)
                    required.update(value for value in (loaded.duplicate_policy_a.representative_sort_column, loaded.duplicate_policy_b.representative_sort_column) if value)
                    missing = sorted(required - remap_choices.keys())
                    if missing:
                        st.error(f"필수 열 매핑이 누락되었습니다: {', '.join(missing)}")
                    else:
                        try:
                            applied = apply_column_remap(loaded, remap_choices)
                            st.session_state.template_applied_config = applied
                            st.session_state.results = None
                            st.success("템플릿 매핑을 적용했습니다.")
                            st.rerun()
                        except ValueError as exc:
                            st.error(str(exc))
                st.caption(f"키 A: {loaded.dataset_a.key_columns} · 키 B: {loaded.dataset_b.key_columns} · 규칙 수: {len(loaded.comparison_rules)}")
            except ValueError as exc:
                st.error(str(exc))

    with tabs[4]:
        render_results()
    with tabs[5]:
        render_downloads()


def render_key_options(title: str) -> KeyNormalizationOptions:
    with st.expander(title, expanded=False):
        return KeyNormalizationOptions(
            trim=st.checkbox("앞뒤 공백 제거", True, key="key_trim"),
            collapse_spaces=st.checkbox("연속 공백 정리", False, key="key_collapse"),
            remove_all_spaces=st.checkbox("모든 공백 제거", False, key="key_remove_spaces"),
            case_insensitive=st.checkbox("대소문자 무시", False, key="key_case"),
            remove_line_breaks=st.checkbox("줄바꿈 제거", True, key="key_line"),
            remove_special_spaces=st.checkbox("특수 공백 정리", True, key="key_special"),
            unicode_normalize=st.checkbox("유니코드 정규화", True, key="key_unicode"),
            strip_numeric_dot_zero=st.checkbox("숫자형 문자열 끝 .0 제거", True, key="key_dotzero"),
            coerce_numeric_string=st.checkbox("숫자·문자 표현 통일", False, key="key_numeric"),
        )


def render_key_mapping_options(
    options: KeyNormalizationOptions,
    config_a: DatasetConfig,
    config_b: DatasetConfig,
    refs_a: list[ColumnRef],
    refs_b: list[ColumnRef],
) -> tuple[Any | None, bool]:
    enabled = st.checkbox("키 매핑 사전 사용", value=False, key="use_key_mapping")
    config_a.key_mappings = {}
    config_b.key_mappings = {}
    if not enabled:
        return None, True

    groups: list[MappingGroup] = []
    with st.expander("키 매핑 사전", expanded=True):
        st.caption("Wide 형식의 XLSX·CSV를 브라우저 세션에서만 읽습니다. 대표값 열은 직접 선택하세요.")
        mapping_file = st.file_uploader("매핑 파일", type=["xlsx", "csv"], key="mapping_file")
        if mapping_file is not None:
            try:
                payload = mapping_file.getvalue()
                validate_upload(mapping_file.name, len(payload), MAX_UPLOAD_BYTES)
                sheet_infos = cached_sheet_infos(mapping_file.name, payload)
                sheet_names = [item.name for item in sheet_infos]
                selected_sheet = st.selectbox("매핑 시트", sheet_names, key="mapping_sheet")
                selected_info = next(item for item in sheet_infos if item.name == selected_sheet)
                header_candidates = list(range(1, min(len(selected_info.preview), 20) + 1)) or [1]
                header_row = st.selectbox("매핑 헤더 행", header_candidates, key="mapping_header")
                suffix = Path(mapping_file.name).suffix.lower()
                mapping_frame = cached_load_frame(
                    mapping_file.name,
                    payload,
                    selected_sheet,
                    header_row,
                    header_row + 1,
                    "utf-8-sig" if suffix == ".csv" else None,
                    "," if suffix == ".csv" else None,
                    False,
                    False,
                )
                mapping_columns = [str(column) for column in mapping_frame.columns]
                if mapping_columns:
                    canonical_column = st.selectbox("대표값 컬럼", mapping_columns, key="mapping_canonical_column")
                    all_other = st.checkbox("대표값 컬럼을 제외한 나머지 컬럼을 모두 별칭으로 사용", value=True, key="mapping_all_aliases")
                    alias_options = [column for column in mapping_columns if column != canonical_column]
                    alias_columns = alias_options if all_other else st.multiselect("별칭 컬럼", alias_options, key="mapping_alias_columns")
                    with st.expander("원본 Wide 미리보기", expanded=False):
                        st.dataframe(mapping_frame.head(50), use_container_width=True)
                    if alias_columns:
                        groups.extend(groups_from_wide_frame(mapping_frame, canonical_column, alias_columns))
                    else:
                        st.error("별칭 컬럼을 하나 이상 선택하세요.")
                else:
                    st.error("매핑 파일에 사용할 수 있는 컬럼이 없습니다.")
            except (DataCompareError, ValueError) as exc:
                st.error(str(exc))
            except Exception:
                st.error("매핑 파일을 읽지 못했습니다. 시트, 헤더 행, 파일 형식을 확인하세요.")

        json_file = st.file_uploader("키 매핑 JSON 불러오기", type=["json"], key="mapping_json_file")
        if json_file is not None:
            try:
                groups.extend(load_mapping_json(json_file.getvalue()))
            except ValueError as exc:
                st.error(str(exc))

        template_groups = st.session_state.pop("template_mapping_groups", None)
        if template_groups:
            st.session_state.mapping_manual_seed = [
                {"대표값": canonical, "별칭 (쉼표 구분)": ", ".join(map(str, aliases))}
                for canonical, aliases in template_groups.items()
            ]
        manual_seed = st.session_state.get(
            "mapping_manual_seed",
            [{"대표값": "", "별칭 (쉼표 구분)": ""}],
        )
        manual = st.data_editor(
            pd.DataFrame(manual_seed),
            num_rows="dynamic",
            use_container_width=True,
            key="mapping_manual_editor",
            column_config={
                "대표값": st.column_config.TextColumn("대표값"),
                "별칭 (쉼표 구분)": st.column_config.TextColumn("별칭 (쉼표 구분)"),
            },
        )
        for index, row in manual.iterrows():
            canonical = row.get("대표값")
            if canonical is None or not str(canonical).strip():
                continue
            aliases = tuple(value.strip() for value in str(row.get("별칭 (쉼표 구분)") or "").split(",") if value.strip())
            groups.append(MappingGroup(str(canonical).strip(), aliases, int(index) + 2))

        if not groups:
            st.warning("매핑 파일, JSON 또는 직접 입력으로 별칭 그룹을 추가하세요.")
            return None, False

        mapping_result = build_mapping(groups, options)
        for issue in mapping_result.issues:
            if issue.severity == "error":
                st.error(issue.message)
            else:
                st.warning(issue.message)

        groups_payload: dict[str, list[Any]] = {}
        for group in groups:
            if group.canonical is None or not str(group.canonical).strip():
                continue
            canonical = str(group.canonical).strip()
            groups_payload.setdefault(canonical, [])
            groups_payload[canonical].extend(alias for alias in group.aliases if alias is not None and str(alias).strip())

        st.download_button(
            "현재 키 매핑 JSON 저장",
            dump_mapping_json(groups),
            file_name="key-mapping.json",
            mime="application/json",
        )
        selected_a = st.multiselect(
            "A에서 매핑을 적용할 키 컬럼",
            config_a.key_columns,
            key="mapping_apply_a",
            format_func=lambda value: ref_label(refs_a, value),
        )
        selected_b = st.multiselect(
            "B에서 매핑을 적용할 키 컬럼",
            config_b.key_columns,
            key="mapping_apply_b",
            format_func=lambda value: ref_label(refs_b, value),
        )
        mapping_config = KeyMappingConfig("기본 키 매핑", True, groups_payload)
        config_a.key_mappings = {column: mapping_config for column in selected_a}
        config_b.key_mappings = {column: mapping_config for column in selected_b}
        if not selected_a and not selected_b:
            st.error("매핑을 적용할 키 컬럼을 하나 이상 선택하세요.")
        with st.expander("내부 alias → canonical 미리보기", expanded=False):
            st.dataframe(pd.DataFrame(mapping_result.preview), use_container_width=True)
        return mapping_result, mapping_result.applicable and bool(selected_a or selected_b)


def render_duplicate_policy(side: str, refs: list[ColumnRef]) -> DuplicatePolicy:
    policy_type = st.selectbox(f"데이터셋 {side} 중복 정책", ["error", "first", "last", "row", "set", "multiset", "aggregate", "representative"], format_func=lambda x: {"error": "오류", "first": "첫 행", "last": "마지막 행", "row": "행별 유지", "set": "고유값 집합", "multiset": "멀티셋", "aggregate": "집계", "representative": "대표 행"}[x], key=f"dup_policy_{side}")
    allow = st.checkbox(f"데이터셋 {side} 1:N/N:1 행별 비교 허용", value=policy_type == "row", key=f"allow_nm_{side}")
    sort_col = None
    sort_direction = "desc"
    if policy_type in {"first", "last", "representative"}:
        sort_col = st.selectbox(f"데이터셋 {side} 대표 행 정렬 기준", [ref.column_id for ref in refs], format_func=lambda value: ref_label(refs, value), key=f"sort_{side}")
        sort_direction = st.selectbox(f"데이터셋 {side} 정렬 방향", ["desc", "asc"], key=f"sort_direction_{side}")
    return DuplicatePolicy(side, policy_type, sort_col, sort_direction, None, "row", allow)


def method_options(data_type: str) -> list[str]:
    if data_type in {"number", "unit_number"}:
        return ["exact", "round", "absolute_tolerance", "relative_tolerance", "percentage"]
    if data_type in {"date", "datetime"}:
        return ["date", "exact_datetime", "year_month", "year", "days_tolerance"]
    return ["exact", "trim", "case_insensitive", "collapse_spaces", "remove_spaces", "remove_special"]


def ref_label(refs: list[ColumnRef], column_id: str) -> str:
    return next((ref.display_name for ref in refs if ref.column_id == column_id), column_id)


def column_index(refs: list[ColumnRef], column_id: str) -> int:
    return next((index for index, ref in enumerate(refs) if ref.column_id == column_id), 0)


def _expectation_items(raw: Any, side: str) -> list[dict[str, Any]]:
    if isinstance(raw, list):
        return [dict(item) for item in raw if isinstance(item, dict)]
    if isinstance(raw, dict):
        return [{"id": key, "side": side, "raw": value, "display": value} for key, value in raw.items()]
    return []


def render_results() -> None:
    payload = st.session_state.get("results")
    if not payload:
        st.info("비교 실행 후 결과가 표시됩니다.")
        return
    summary = payload["summary"]
    cards = [("전체", summary.total), ("비교 가능", summary.comparable), ("모두 동일", summary.identical), ("불일치", summary.mismatch), ("A만", summary.a_only), ("B만", summary.b_only), ("중복", summary.duplicate), ("N:M", summary.nm_pending), ("일치율", f"{summary.match_rate:.2f}%")]
    columns = st.columns(len(cards))
    for column, (label, value) in zip(columns, cards):
        column.metric(label, value)
    frame = result_rows_to_frame(payload["rows"])
    if frame.empty:
        st.info("현재 필터 조건에 해당하는 결과가 없습니다.")
        return
    status = st.multiselect("상태 필터", sorted(frame["상태"].dropna().unique()) if not frame.empty else [], default=[], key="result_status")
    rule_result_columns = [column for column in frame.columns if str(column).endswith(" · 결과")]
    selected_rule = st.selectbox("특정 비교 규칙 불일치", ["전체"] + rule_result_columns, key="result_rule")
    search = st.text_input("키·원본값·정규화값·사유 검색", key="result_search")
    if status:
        frame = frame[frame["상태"].isin(status)]
    if selected_rule != "전체":
        frame = frame[frame[selected_rule] == "불일치"]
    if search:
        mask = frame.astype(str).apply(lambda column: column.str.contains(search, case=False, na=False, regex=False)).any(axis=1)
        frame = frame[mask]
    st.dataframe(frame, use_container_width=True, height=600)


def render_downloads() -> None:
    payload = st.session_state.get("results")
    if not payload:
        st.info("비교 실행 후 다운로드할 결과가 표시됩니다.")
        return
    frame = result_rows_to_frame(payload["rows"])
    st.download_button("CSV 결과 다운로드", export_csv(frame), file_name="comparison_result.csv", mime="text/csv")
    st.download_button("Excel 결과 다운로드", export_excel(payload["rows"], payload["config"], payload["quality"], payload["summary"]), file_name="comparison_result.xlsx", mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")


if __name__ == "__main__":
    main()
