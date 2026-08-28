from __future__ import annotations

from typing import Any

import pandas as pd

from src.models.config import KeyMappingConfig, KeyNormalizationOptions
from src.normalization.date_normalizer import normalize_date
from src.normalization.number_normalizer import normalize_number
from src.normalization.text_normalizer import normalize_text


def build_key(row: pd.Series, columns: list[str], options: KeyNormalizationOptions) -> tuple[Any, ...]:
    return tuple(normalize_key_value(row[column], options) for column in columns)


def normalize_key_value(value: Any, options: KeyNormalizationOptions) -> Any:
    text = normalize_text(value, options)
    if text is None:
        return None
    if options.coerce_numeric_string:
        number = normalize_number(text)
        if number is not None:
            if options.strip_numeric_dot_zero and number.is_integer():
                return str(int(number))
            return str(number)
    if options.date_format:
        parsed = normalize_date(text, options.date_format)
        if parsed is not None:
            return parsed
    if options.strip_numeric_dot_zero and text.endswith(".0"):
        try:
            return text[:-2] if float(text).is_integer() else text
        except ValueError:
            pass
    return text


def add_key_columns(
    frame: pd.DataFrame,
    columns: list[str],
    options: KeyNormalizationOptions,
    key_mappings: dict[str, KeyMappingConfig] | None = None,
) -> pd.DataFrame:
    from src.mapping.key_mapping import MappingGroup, apply_mapping_value, build_mapping

    built_mappings = {}
    for column, config in (key_mappings or {}).items():
        if not config.enabled or column not in columns:
            continue
        groups = [MappingGroup(canonical, tuple(aliases)) for canonical, aliases in config.groups.items()]
        mapping = build_mapping(groups, options)
        if not mapping.applicable:
            messages = "; ".join(issue.message for issue in mapping.issues if issue.severity == "error")
            raise ValueError(f"키 매핑 충돌이 해결되지 않았습니다. {messages}")
        built_mappings[column] = mapping

    result = frame.copy()
    result["__row_id"] = result.index + 1

    def key_details(row: pd.Series) -> tuple[tuple[Any, ...], tuple[Any, ...], tuple[Any, ...], tuple[bool, ...], tuple[dict[str, Any], ...]]:
        applications = [
            apply_mapping_value(row[column], options, built_mappings.get(column))
            for column in columns
        ]
        return (
            tuple(item.original for item in applications),
            tuple(item.normalized for item in applications),
            tuple(item.standard for item in applications),
            tuple(item.applied for item in applications),
            tuple(item.__dict__ for item in applications),
        )

    details = result.apply(key_details, axis=1)
    result["__key_original_tuple"] = details.map(lambda item: item[0])
    result["__key_normalized_tuple"] = details.map(lambda item: item[1])
    result["__key_tuple"] = details.map(lambda item: item[2])
    result["__key_mapping_applied"] = details.map(lambda item: item[3])
    result["__key_mapping_details"] = details.map(lambda item: item[4])
    return result
