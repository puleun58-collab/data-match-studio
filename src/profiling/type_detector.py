from __future__ import annotations

import re
from typing import Any

import pandas as pd


def infer_type(series: pd.Series) -> str:
    values = series.dropna()
    if values.empty:
        return "mixed"
    text = values.astype(str).str.strip()
    lowered = text.str.lower()
    if lowered.isin({"y", "n", "yes", "no", "true", "false", "1", "0", "사용", "미사용", "활성", "비활성"}).all():
        return "boolean"
    numeric = pd.to_numeric(text.str.replace(",", "", regex=False), errors="coerce")
    if numeric.notna().mean() >= 0.95:
        return "number"
    unit_numeric = text.str.replace(r"[^0-9+\-.]", "", regex=True)
    if pd.to_numeric(unit_numeric, errors="coerce").notna().mean() >= 0.8 and (~text.str.fullmatch(r"[-+]?\d+(\.\d+)?")).any():
        return "unit_number"
    dates = pd.to_datetime(values, errors="coerce")
    if dates.notna().mean() >= 0.8:
        return "datetime" if any(" " in item or "T" in item for item in text.head(20)) else "date"
    return "text"


def infer_types(frame: pd.DataFrame) -> dict[str, str]:
    return {str(column): infer_type(frame[column]) for column in frame.columns}
