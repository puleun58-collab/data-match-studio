from __future__ import annotations

from datetime import date, datetime
from typing import Any

from src.models.config import ComparisonRule
from src.normalization.date_normalizer import normalize_date
from .base_comparator import ValueComparison, empty_comparison


def compare_date(a: Any, b: Any, rule: ComparisonRule) -> ValueComparison:
    empty = empty_comparison(a, b, rule)
    if empty is not None:
        return empty
    mode = rule.comparison_method
    if mode == "exact_datetime":
        mode = "datetime"
    elif mode in {"year_month", "month"}:
        mode = "year_month"
    elif mode == "year":
        mode = "year"
    else:
        mode = "date"
    date_a = normalize_date(a, mode)
    date_b = normalize_date(b, mode)
    if date_a is None or date_b is None:
        return ValueComparison(False, date_a, date_b, "날짜로 변환할 수 없음", date_a is not None, date_b is not None)
    difference_days = None
    if isinstance(date_a, (date, datetime)) and isinstance(date_b, (date, datetime)):
        difference_days = abs((date_a - date_b).total_seconds()) / 86400
    tolerance = rule.tolerance_options.absolute or 0
    equal = date_a == date_b or (difference_days is not None and difference_days <= tolerance)
    return ValueComparison(equal, date_a, date_b, "날짜가 동일" if equal else "날짜 허용 범위 초과", True, True, difference_days, difference_days)
