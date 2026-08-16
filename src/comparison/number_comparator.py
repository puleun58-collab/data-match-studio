from __future__ import annotations

from typing import Any

from src.models.config import ComparisonRule
from src.normalization.number_normalizer import normalize_number
from .base_comparator import ValueComparison, empty_comparison


def compare_number(a: Any, b: Any, rule: ComparisonRule) -> ValueComparison:
    empty = empty_comparison(a, b, rule)
    if empty is not None:
        return empty
    options = {"extract_number": rule.data_type == "unit_number", "remove_units": rule.data_type == "unit_number", **rule.normalization_options}
    number_a = normalize_number(a, options)
    number_b = normalize_number(b, options)
    if number_a is None or number_b is None:
        return ValueComparison(False, number_a, number_b, "숫자로 변환할 수 없음", number_a is not None, number_b is not None)
    tolerance = rule.tolerance_options
    compare_a, compare_b = number_a, number_b
    if rule.comparison_method in {"round", "rounding"} and tolerance.decimals is not None:
        compare_a = round(number_a, tolerance.decimals)
        compare_b = round(number_b, tolerance.decimals)
    difference = number_a - number_b
    absolute = abs(difference)
    rate = absolute / abs(number_b) if number_b != 0 else (0.0 if absolute == 0 else None)
    allowed = 0.0
    if rule.comparison_method in {"absolute_tolerance", "absolute"}:
        allowed = tolerance.absolute or 0.0
    elif rule.comparison_method in {"relative_tolerance", "relative", "percentage"}:
        allowed = abs(number_b) * ((tolerance.relative if tolerance.relative is not None else tolerance.percentage or 0) / (100 if tolerance.percentage is not None else 1))
    equal = abs(compare_a - compare_b) <= allowed if rule.comparison_method not in {"exact", "round", "rounding"} else compare_a == compare_b
    return ValueComparison(
        equal, compare_a, compare_b,
        "숫자 값이 동일" if equal else "숫자 값이 다름",
        True, True, difference, absolute, rate,
    )
