from __future__ import annotations

from typing import Any

import pandas as pd

from src.models.config import KeyNormalizationOptions
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


def add_key_columns(frame: pd.DataFrame, columns: list[str], options: KeyNormalizationOptions) -> pd.DataFrame:
    result = frame.copy()
    result["__row_id"] = result.index + 1
    result["__key_tuple"] = result.apply(lambda row: build_key(row, columns, options), axis=1)
    return result
