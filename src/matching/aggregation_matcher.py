from __future__ import annotations

from typing import Any

import pandas as pd

from .duplicate_handler import aggregate_values


def compare_aggregates(series_a: pd.Series, series_b: pd.Series, method: str) -> dict[str, Any]:
    value_a = aggregate_values(series_a, method)
    value_b = aggregate_values(series_b, method)
    equal = value_a == value_b
    if isinstance(value_a, float) and isinstance(value_b, float):
        equal = bool(pd.isna(value_a) and pd.isna(value_b)) or value_a == value_b
    return {
        "equal": equal,
        "method": method,
        "raw_a": series_a.tolist(),
        "raw_b": series_b.tolist(),
        "value_a": value_a,
        "value_b": value_b,
    }
