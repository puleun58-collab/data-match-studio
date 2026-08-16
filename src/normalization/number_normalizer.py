from __future__ import annotations

import re
from typing import Any

import pandas as pd


def normalize_number(value: Any, options: dict[str, Any] | None = None) -> float | None:
    if value is None:
        return None
    try:
        missing = pd.isna(value)
        if not hasattr(missing, "__len__") and bool(missing):
            return None
    except (TypeError, ValueError):
        return None
    options = options or {}
    text = str(value).strip()
    if not text:
        return None
    if options.get("parentheses_negative", True) and text.startswith("(") and text.endswith(")"):
        text = "-" + text[1:-1]
    if options.get("percent_string", False) and text.endswith("%"):
        text = text[:-1]
        divisor = 100.0
    else:
        divisor = 1.0
    if options.get("remove_commas", True):
        text = text.replace(",", "")
    if options.get("remove_currency", True):
        text = re.sub(r"[₩$€£원]|krw|usd|eur", "", text, flags=re.IGNORECASE)
    if options.get("remove_spaces", True):
        text = re.sub(r"\s+", "", text)
    if options.get("extract_number", False) or options.get("remove_units", False):
        match = re.search(r"[-+]?(?:\d+(?:\.\d*)?|\.\d+)", text)
        if not match:
            return None
        text = match.group(0)
    try:
        return float(text) / divisor
    except (TypeError, ValueError):
        return None
