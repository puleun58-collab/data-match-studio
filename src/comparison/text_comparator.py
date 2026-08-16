from __future__ import annotations

from typing import Any

from src.models.config import ComparisonRule
from src.normalization.text_normalizer import normalize_text
from .base_comparator import ValueComparison, empty_comparison


def compare_text(a: Any, b: Any, rule: ComparisonRule) -> ValueComparison:
    empty = empty_comparison(a, b, rule)
    if empty is not None:
        return empty
    options = dict(rule.normalization_options)
    method = rule.comparison_method
    if method in {"trim", "strip"}:
        options["trim"] = True
    if method in {"case_insensitive", "ignore_case"}:
        options["case_insensitive"] = True
    if method == "collapse_spaces":
        options["collapse_spaces"] = True
    if method == "remove_spaces":
        options["remove_all_spaces"] = True
    if method == "remove_special":
        options["remove_special_characters"] = True
    normalized_a = normalize_text(a, options)
    normalized_b = normalize_text(b, options)
    return ValueComparison(
        normalized_a == normalized_b,
        normalized_a,
        normalized_b,
        "문자열이 동일" if normalized_a == normalized_b else "문자열이 다름",
    )
