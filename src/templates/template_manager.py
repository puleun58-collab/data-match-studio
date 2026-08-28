from __future__ import annotations

import copy
import json
import re
from typing import Any

from src.models.config import ComparisonConfig, config_from_dict, to_dict

TEMPLATE_VERSION = 2


def _normalized(value: str) -> str:
    return re.sub(r"\s+", " ", value.strip()).casefold()


def dump_template(config: ComparisonConfig, column_expectations: Any = None) -> str:
    payload = to_dict(config)
    payload["template_version"] = TEMPLATE_VERSION
    if column_expectations is not None:
        payload["column_expectations"] = column_expectations
    return json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True, default=str)


def load_template(payload: str | bytes) -> ComparisonConfig:
    try:
        value = json.loads(payload)
        if not isinstance(value, dict):
            raise ValueError("template must be an object")
        # v1 templates had no marker and remain readable.
        version = value.get("template_version", 1)
        if version not in (1, TEMPLATE_VERSION):
            raise ValueError("unknown template version")
        value = {k: v for k, v in value.items() if k not in {"template_version", "column_expectations"}}
        return config_from_dict(value)
    except (json.JSONDecodeError, TypeError, ValueError, KeyError) as exc:
        raise ValueError("비교 설정 JSON을 읽을 수 없습니다.") from exc


def _items(expectations: Any) -> list[dict[str, Any]]:
    if expectations is None: return []
    if isinstance(expectations, list): return [dict(x) for x in expectations]
    if isinstance(expectations, dict):
        result = []
        for key, item in expectations.items():
            row = dict(item) if isinstance(item, dict) else {}
            row.setdefault("id", key)
            result.append(row)
        return result
    raise ValueError("column expectations must be a list or object")


def remap_columns(expectations: Any, columns: Any) -> tuple[dict[str, str], list[str]]:
    """Purely map template column ids to current ids, with diagnostics."""
    expected, current = _items(expectations), _items(columns)
    mapping: dict[str, str] = {}; diagnostics: list[str] = []
    used: set[str] = set()
    for old in expected:
        old_id = old.get("id")
        if not old_id: diagnostics.append("missing expectation id"); continue
        old_name = old.get("normalized_name") or _normalized(str(old.get("raw", old.get("name", ""))))
        def compatible(candidate: dict[str, Any], check_fingerprint: bool = True) -> bool:
            if old.get("side") and candidate.get("side") != old.get("side"):
                return False
            if old.get("sheet") and candidate.get("sheet") != old.get("sheet"):
                return False
            if check_fingerprint and old.get("fingerprint") is not None and candidate.get("fingerprint") != old.get("fingerprint"):
                return False
            candidate_name = candidate.get("normalized_name") or _normalized(str(candidate.get("raw", candidate.get("name", ""))))
            if old_name and candidate_name and old_name != candidate_name:
                return False
            if old.get("occurrence") is not None and candidate.get("occurrence") != old.get("occurrence"):
                return False
            return True
        candidates = [c for c in current if c.get("id") == old_id and compatible(c)]
        if not candidates and old.get("fingerprint") is not None:
            candidates = [c for c in current if c.get("fingerprint") == old.get("fingerprint") and compatible(c)]
        if not candidates:
            n = old_name
            candidates = [c for c in current if (c.get("normalized_name") or _normalized(str(c.get("raw", c.get("name", ""))))) == n and compatible(c, check_fingerprint=False)]
            occ = old.get("occurrence")
            if occ is not None: candidates = [c for c in candidates if c.get("occurrence") == occ]
        if len(candidates) != 1:
            diagnostics.append(f"{'stale' if not candidates else 'ambiguous'} column reference: {old_id}"); continue
        new_id = candidates[0].get("id")
        if new_id in used:
            diagnostics.append(f"conflicting column reference: {old_id}"); continue
        used.add(new_id); mapping[old_id] = new_id
    return mapping, diagnostics


def apply_column_remap(config: ComparisonConfig, mapping: dict[str, str], diagnostics: list[str] | None = None) -> ComparisonConfig:
    if diagnostics:
        raise ValueError("; ".join(diagnostics))
    result = copy.deepcopy(config)
    def replace(value: str | None) -> str | None: return mapping.get(value, value) if value is not None else None
    result.dataset_a.key_columns = [replace(x) for x in result.dataset_a.key_columns]
    result.dataset_b.key_columns = [replace(x) for x in result.dataset_b.key_columns]
    result.dataset_a.key_mappings = {replace(column) or column: value for column, value in result.dataset_a.key_mappings.items()}
    result.dataset_b.key_mappings = {replace(column) or column: value for column, value in result.dataset_b.key_mappings.items()}
    for rule in result.comparison_rules:
        rule.column_a_id = replace(rule.column_a_id) or rule.column_a_id
        rule.column_b_id = replace(rule.column_b_id) or rule.column_b_id
    result.duplicate_policy_a.representative_sort_column = replace(result.duplicate_policy_a.representative_sort_column)
    result.duplicate_policy_b.representative_sort_column = replace(result.duplicate_policy_b.representative_sort_column)
    return result


def remap_template(config: ComparisonConfig, expectations: Any, columns: Any) -> tuple[ComparisonConfig, list[str]]:
    mapping, diagnostics = remap_columns(expectations, columns)
    if diagnostics: return config, diagnostics
    return apply_column_remap(config, mapping), []

# Descriptive aliases used by callers.
remap_template_columns = remap_template
apply_template_remap = remap_template
