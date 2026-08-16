from __future__ import annotations

from typing import Any

from src.models.config import ComparisonRule
from .base_comparator import ValueComparison, empty_comparison

DEFAULT_BOOLEAN_MAP = {
    "y": True, "yes": True, "true": True, "1": True, "사용": True, "활성": True,
    "n": False, "no": False, "false": False, "0": False, "미사용": False, "비활성": False,
}


def compare_boolean(a: Any, b: Any, rule: ComparisonRule) -> ValueComparison:
    empty = empty_comparison(a, b, rule)
    if empty is not None:
        return empty
    mapping = {str(k).casefold(): v for k, v in (rule.normalization_options.get("mapping") or DEFAULT_BOOLEAN_MAP).items()}
    normalized_a = mapping.get(str(a).strip().casefold())
    normalized_b = mapping.get(str(b).strip().casefold())
    if normalized_a is None or normalized_b is None:
        return ValueComparison(False, normalized_a, normalized_b, "불리언으로 변환할 수 없음", normalized_a is not None, normalized_b is not None)
    return ValueComparison(normalized_a == normalized_b, normalized_a, normalized_b, "불리언이 동일" if normalized_a == normalized_b else "불리언이 다름")
