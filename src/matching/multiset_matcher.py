from __future__ import annotations

from collections import Counter
from typing import Any, Iterable

from .set_matcher import freeze


def compare_multisets(values_a: Iterable[Any], values_b: Iterable[Any]) -> dict[str, Any]:
    a = Counter(freeze(value) for value in values_a)
    b = Counter(freeze(value) for value in values_b)
    keys = set(a) | set(b)
    differences = {
        key: {"a_count": a.get(key, 0), "b_count": b.get(key, 0), "difference": a.get(key, 0) - b.get(key, 0)}
        for key in sorted(keys, key=str)
        if a.get(key, 0) != b.get(key, 0)
    }
    return {"equal": not differences, "a_counts": dict(a), "b_counts": dict(b), "differences": differences}
