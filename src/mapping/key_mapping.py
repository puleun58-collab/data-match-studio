from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
import json
from typing import Any, Iterable

import pandas as pd

from src.models.config import KeyNormalizationOptions
from src.matching.key_builder import normalize_key_value


@dataclass(frozen=True)
class MappingGroup:
    canonical: Any
    aliases: tuple[Any, ...] = ()
    row_number: int | None = None


@dataclass(frozen=True)
class MappingIssue:
    severity: str
    code: str
    message: str
    alias: Any = None
    canonicals: tuple[Any, ...] = ()
    row_numbers: tuple[int, ...] = ()


@dataclass
class MappingBuildResult:
    alias_to_canonical: dict[Any, Any]
    preview: list[dict[str, Any]]
    issues: list[MappingIssue]
    stats: dict[str, int]
    groups: list[MappingGroup] = field(default_factory=list)

    @property
    def applicable(self) -> bool:
        return not any(issue.severity == "error" for issue in self.issues)


@dataclass(frozen=True)
class MappingApplication:
    original: Any
    normalized: Any
    standard: Any
    applied: bool
    mapping_enabled: bool
    canonical: Any = None
    alias: Any = None
    group: Any = None


def groups_from_wide_frame(
    frame: pd.DataFrame,
    canonical_column: str,
    alias_columns: Iterable[str] | None = None,
    *,
    use_all_other_columns: bool = False,
) -> list[MappingGroup]:
    if canonical_column not in frame.columns:
        raise ValueError("대표값 컬럼을 선택하세요.")
    selected = [column for column in (alias_columns or []) if column != canonical_column]
    if use_all_other_columns:
        selected = [str(column) for column in frame.columns if column != canonical_column]
    missing = [column for column in selected if column not in frame.columns]
    if missing:
        raise ValueError(f"별칭 컬럼을 찾을 수 없습니다: {', '.join(missing)}")
    if not selected:
        raise ValueError("별칭 컬럼을 하나 이상 선택하세요.")
    return [
        MappingGroup(row[canonical_column], tuple(row[column] for column in selected), index + 2)
        for index, (_, row) in enumerate(frame.iterrows())
    ]


def build_mapping(groups: Iterable[MappingGroup], options: KeyNormalizationOptions) -> MappingBuildResult:
    source_groups = list(groups)
    issues: list[MappingIssue] = []
    preview: list[dict[str, Any]] = []
    normalized_candidates: dict[Any, set[Any]] = defaultdict(set)
    normalized_rows: dict[Any, set[int]] = defaultdict(set)
    raw_candidates: dict[str, set[str]] = defaultdict(set)
    canonical_values: dict[Any, set[Any]] = defaultdict(set)
    alias_values: dict[Any, set[Any]] = defaultdict(set)
    registration_counts: dict[tuple[Any, Any], int] = defaultdict(int)
    row_signatures: dict[tuple[str, tuple[str, ...]], list[int]] = defaultdict(list)
    empty_alias_cells = 0
    empty_canonicals = 0
    aliasless_rows = 0
    alias_count = 0

    for ordinal, group in enumerate(source_groups, start=2):
        row_number = group.row_number or ordinal
        raw_canonical = group.canonical
        if _is_empty(raw_canonical):
            empty_canonicals += 1
            issues.append(MappingIssue("warning", "EMPTY_CANONICAL", f"{row_number}행의 대표값이 비어 있어 제외했습니다.", row_numbers=(row_number,)))
            continue
        canonical = normalize_key_value(raw_canonical, options)
        if _is_empty(canonical):
            empty_canonicals += 1
            issues.append(MappingIssue("warning", "EMPTY_CANONICAL", f"{row_number}행의 대표값이 정규화 후 비어 있어 제외했습니다.", row_numbers=(row_number,)))
            continue
        canonical_values[canonical].add(raw_canonical)
        nonempty_aliases = [value for value in group.aliases if not _is_empty(value)]
        empty_alias_cells += len(group.aliases) - len(nonempty_aliases)
        if not nonempty_aliases:
            aliasless_rows += 1
            issues.append(MappingIssue("warning", "ALIASLESS_GROUP", f"{row_number}행의 대표값에는 별칭이 없습니다.", canonicals=(raw_canonical,), row_numbers=(row_number,)))
        row_signatures[(_raw_token(raw_canonical), tuple(_raw_token(value) for value in group.aliases))].append(row_number)

        registrations = [(raw_canonical, True), *((value, False) for value in nonempty_aliases)]
        for raw_alias, is_canonical in registrations:
            normalized_alias = normalize_key_value(raw_alias, options)
            if _is_empty(normalized_alias):
                if not is_canonical:
                    empty_alias_cells += 1
                continue
            if not is_canonical:
                alias_count += 1
                alias_values[normalized_alias].add(raw_alias)
            normalized_candidates[normalized_alias].add(canonical)
            normalized_rows[normalized_alias].add(row_number)
            raw_candidates[_raw_token(raw_alias)].add(_raw_token(raw_canonical))
            registration_counts[(normalized_alias, canonical)] += 1
            preview.append({
                "원본 별칭": raw_alias,
                "정규화 별칭": normalized_alias,
                "표준 키": canonical,
                "대표값": raw_canonical,
                "유형": "대표값" if is_canonical else "별칭",
                "행": row_number,
            })

    duplicate_rows = 0
    for signature_rows in row_signatures.values():
        if len(signature_rows) > 1:
            duplicate_rows += len(signature_rows) - 1
            issues.append(MappingIssue("warning", "DUPLICATE_ROW", f"완전히 동일한 매핑 행이 {len(signature_rows)}번 등록되었습니다.", row_numbers=tuple(signature_rows)))

    duplicate_aliases = 0
    for (alias, canonical), count in registration_counts.items():
        if count > 1:
            duplicate_aliases += count - 1
            issues.append(MappingIssue("warning", "DUPLICATE_ALIAS", f"별칭 '{alias}'이(가) 같은 대표값 '{canonical}'에 반복 등록되었습니다.", alias, (canonical,), tuple(sorted(normalized_rows[alias]))))

    collision_aliases: set[Any] = set()
    for alias, canonicals in normalized_candidates.items():
        if len(canonicals) <= 1:
            continue
        collision_aliases.add(alias)
        raw_collision = len(raw_candidates.get(_raw_token(alias), set())) > 1
        code = "ALIAS_CONFLICT" if raw_collision else "NORMALIZED_ALIAS_CONFLICT"
        label = "별칭 충돌" if raw_collision else "정규화 후 별칭 충돌"
        issues.append(MappingIssue("error", code, f"{label}: '{alias}' → {', '.join(map(str, sorted(canonicals, key=str)))}", alias, tuple(sorted(canonicals, key=str)), tuple(sorted(normalized_rows[alias]))))

    canonical_alias_conflicts: set[Any] = set()
    for canonical in canonical_values:
        targets = normalized_candidates.get(canonical, set())
        if any(target != canonical for target in targets):
            canonical_alias_conflicts.add(canonical)
            issues.append(MappingIssue("error", "CANONICAL_ALIAS_CONFLICT", f"대표값 '{canonical}'이(가) 다른 그룹의 별칭으로 사용되었습니다. 체인 매핑은 지원하지 않습니다.", canonical, tuple(sorted(targets | {canonical}, key=str)), tuple(sorted(normalized_rows[canonical]))))

    alias_to_canonical = {
        alias: next(iter(canonicals))
        for alias, canonicals in normalized_candidates.items()
        if len(canonicals) == 1 and alias not in canonical_alias_conflicts
    }
    unique_preview: list[dict[str, Any]] = []
    seen_preview: set[tuple[Any, Any]] = set()
    for item in preview:
        pair = (item["정규화 별칭"], item["표준 키"])
        if pair not in seen_preview:
            unique_preview.append(item)
            seen_preview.add(pair)

    stats = {
        "canonical_count": len(canonical_values),
        "alias_count": alias_count,
        "mapping_item_count": len(alias_to_canonical),
        "duplicate_alias_count": duplicate_aliases,
        "empty_alias_cell_count": empty_alias_cells,
        "collision_alias_count": len(collision_aliases | canonical_alias_conflicts),
        "empty_canonical_count": empty_canonicals,
        "duplicate_row_count": duplicate_rows,
        "aliasless_group_count": aliasless_rows,
    }
    return MappingBuildResult(alias_to_canonical, unique_preview, issues, stats, source_groups)


def build_mapping_from_wide(
    frame: pd.DataFrame,
    canonical_column: str,
    alias_columns: Iterable[str] | None,
    options: KeyNormalizationOptions,
    *,
    use_all_other_columns: bool = False,
) -> MappingBuildResult:
    return build_mapping(groups_from_wide_frame(frame, canonical_column, alias_columns, use_all_other_columns=use_all_other_columns), options)


def apply_mapping_value(original: Any, options: KeyNormalizationOptions, mapping: MappingBuildResult | None) -> MappingApplication:
    normalized = normalize_key_value(original, options)
    if mapping is None:
        return MappingApplication(original, normalized, normalized, False, False)
    if not mapping.applicable or normalized not in mapping.alias_to_canonical:
        return MappingApplication(original, normalized, normalized, False, True)
    canonical = mapping.alias_to_canonical[normalized]
    return MappingApplication(original, normalized, canonical, True, True, canonical, normalized, canonical)


def application_stats(applications: Iterable[MappingApplication]) -> dict[str, float | int]:
    values = [item for item in applications if item.mapping_enabled and not _is_empty(item.normalized)]
    unique = {item.normalized for item in values}
    mapped = {item.normalized for item in values if item.applied}
    return {
        "unique_key_count": len(unique),
        "mapped_key_count": len(mapped),
        "unmapped_key_count": len(unique - mapped),
        "mapping_rate": (len(mapped) / len(unique) * 100) if unique else 0.0,
    }


def dump_mapping_json(groups: Iterable[MappingGroup]) -> str:
    payload: dict[str, list[Any]] = {}
    for group in groups:
        if _is_empty(group.canonical):
            continue
        key = str(group.canonical)
        payload.setdefault(key, [])
        payload[key].extend(value for value in group.aliases if not _is_empty(value))
    return json.dumps(payload, ensure_ascii=False, indent=2, default=str)


def load_mapping_json(payload: str | bytes) -> list[MappingGroup]:
    try:
        value = json.loads(payload)
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise ValueError("키 매핑 JSON 형식이 올바르지 않습니다.") from exc
    if not isinstance(value, dict):
        raise ValueError("키 매핑 JSON은 대표값을 키로 사용하는 객체여야 합니다.")
    groups: list[MappingGroup] = []
    for index, (canonical, aliases) in enumerate(value.items(), start=1):
        if not isinstance(aliases, list):
            raise ValueError(f"대표값 '{canonical}'의 별칭은 배열이어야 합니다.")
        groups.append(MappingGroup(canonical, tuple(aliases), index))
    return groups


def _is_empty(value: Any) -> bool:
    if value is None:
        return True
    try:
        if bool(pd.isna(value)):
            return True
    except (TypeError, ValueError):
        pass
    return isinstance(value, str) and not value.strip()


def _raw_token(value: Any) -> str:
    return "" if _is_empty(value) else str(value)
