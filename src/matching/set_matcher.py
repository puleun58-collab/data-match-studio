from __future__ import annotations

from typing import Any, Iterable


def compare_sets(values_a: Iterable[Any], values_b: Iterable[Any]) -> dict[str, Any]:
    a = {freeze(value) for value in values_a}
    b = {freeze(value) for value in values_b}
    common = a & b
    only_a = a - b
    only_b = b - a
    return {
        "equal": a == b,
        "a_values": sorted(a, key=str),
        "b_values": sorted(b, key=str),
        "only_a": sorted(only_a, key=str),
        "only_b": sorted(only_b, key=str),
        "common": sorted(common, key=str),
    }


def freeze(value: Any) -> Any:
    try:
        hash(value)
        return value
    except TypeError:
        return str(value)
