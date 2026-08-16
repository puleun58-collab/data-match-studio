from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from src.models.config import ComparisonRule


@dataclass
class ValueComparison:
    equal: bool
    normalized_a: Any
    normalized_b: Any
    reason: str
    conversion_success_a: bool = True
    conversion_success_b: bool = True
    numeric_difference: float | None = None
    absolute_difference: float | None = None
    difference_rate: float | None = None


def empty_comparison(a: Any, b: Any, rule: ComparisonRule) -> ValueComparison | None:
    from src.normalization.null_normalizer import is_missing

    missing_a = is_missing(a, rule.null_policy.missing_tokens)
    missing_b = is_missing(b, rule.null_policy.missing_tokens)
    if not missing_a and not missing_b:
        return None
    if missing_a and missing_b:
        return ValueComparison(
            rule.null_policy.both_empty_equal, None, None,
            "양쪽 값이 비어 있음" if rule.null_policy.both_empty_equal else "양쪽 빈값 정책에 따른 불일치",
        )
    if rule.null_policy.empty_equals_zero:
        other = b if missing_a else a
        try:
            if float(other) == 0:
                return ValueComparison(True, None, 0 if missing_a else None, "빈값과 0을 동일 처리")
        except (ValueError, TypeError):
            pass
    if rule.null_policy.empty_equals_text is not None:
        other = str(b if missing_a else a).strip()
        if other == rule.null_policy.empty_equals_text:
            return ValueComparison(True, None, other, "빈값과 지정 문자열을 동일 처리")
    if not rule.null_policy.one_empty_mismatch:
        return ValueComparison(True, None if missing_a else a, None if missing_b else b, "한쪽 빈값 정책에 따른 동일 처리")
    return ValueComparison(False, None if missing_a else a, None if missing_b else b, "한쪽 값이 비어 있음")
