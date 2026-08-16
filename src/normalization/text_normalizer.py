from __future__ import annotations

import re
import unicodedata
from typing import Any

from src.models.config import KeyNormalizationOptions
from .null_normalizer import is_missing


def normalize_text(value: Any, options: dict[str, Any] | KeyNormalizationOptions | None = None) -> str | None:
    if is_missing(value):
        return None
    if isinstance(options, KeyNormalizationOptions):
        config = options.__dict__
    else:
        config = options or {}
    text = str(value)
    if config.get("unicode_normalize", True):
        text = unicodedata.normalize("NFKC", text)
    if config.get("remove_special_spaces", True):
        text = text.replace("\u00a0", " ").replace("\u3000", " ")
    if config.get("remove_line_breaks", True):
        text = re.sub(r"[\r\n]+", " ", text)
    for old, new in config.get("replacements", {}).items():
        text = text.replace(old, new)
    if config.get("collapse_spaces", False):
        text = re.sub(r"\s+", " ", text)
    if config.get("remove_all_spaces", False):
        text = re.sub(r"\s+", "", text)
    if config.get("trim", True):
        text = text.strip()
    if config.get("case_insensitive", False):
        text = text.casefold()
    if config.get("remove_special_characters", False):
        text = re.sub(r"[^\w\s-]", "", text, flags=re.UNICODE)
    return text
