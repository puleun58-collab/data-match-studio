from __future__ import annotations

from typing import Any

import pandas as pd

DEFAULT_MISSING_TOKENS = {"", "null", "none", "nan", "n/a", "na", "-"}


def is_missing(value: Any, tokens: list[str] | None = None) -> bool:
    if value is None:
        return True
    try:
        missing = pd.isna(value)
        if not hasattr(missing, "__len__") and bool(missing):
            return True
    except (TypeError, ValueError):
        pass
    text = str(value).strip().lower()
    return text in set(tokens or DEFAULT_MISSING_TOKENS)
