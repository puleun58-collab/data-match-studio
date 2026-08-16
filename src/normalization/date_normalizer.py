from __future__ import annotations

from datetime import date, datetime
import re
from typing import Any

import pandas as pd


def normalize_date(value: Any, mode: str = "date", dayfirst: bool = False) -> Any:
    if value is None or str(value).strip() == "":
        return None
    text = str(value).strip()
    korean = re.fullmatch(r"(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일", text)
    if korean:
        text = f"{korean.group(1)}-{korean.group(2)}-{korean.group(3)}"
    parsed = pd.to_datetime(text, errors="coerce", dayfirst=dayfirst)
    if pd.isna(parsed):
        return None
    timestamp = pd.Timestamp(parsed)
    if mode == "year":
        return timestamp.year
    if mode == "year_month":
        return (timestamp.year, timestamp.month)
    if mode == "datetime":
        return timestamp.to_pydatetime()
    return timestamp.date()
