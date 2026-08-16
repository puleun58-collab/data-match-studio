from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import pandas as pd


@dataclass
class KeyCardinality:
    key: tuple[Any, ...]
    a_count: int
    b_count: int

    @property
    def kind(self) -> str:
        if self.a_count == 0:
            return "B_ONLY"
        if self.b_count == 0:
            return "A_ONLY"
        if self.a_count == 1 and self.b_count == 1:
            return "ONE_TO_ONE"
        if self.a_count == 1:
            return "ONE_TO_MANY"
        if self.b_count == 1:
            return "MANY_TO_ONE"
        return "MANY_TO_MANY"


def analyze_cardinality(frame_a: pd.DataFrame, frame_b: pd.DataFrame) -> list[KeyCardinality]:
    counts_a = {_as_key_tuple(key): int(value) for key, value in frame_a["__key_tuple"].value_counts(dropna=False).to_dict().items()}
    counts_b = {_as_key_tuple(key): int(value) for key, value in frame_b["__key_tuple"].value_counts(dropna=False).to_dict().items()}
    keys = list(dict.fromkeys([*counts_a.keys(), *counts_b.keys()]))
    return [KeyCardinality(key, int(counts_a.get(key, 0)), int(counts_b.get(key, 0))) for key in keys]


def _as_key_tuple(value: Any) -> tuple[Any, ...]:
    return value if isinstance(value, tuple) else (value,)


def cardinality_summary(items: list[KeyCardinality]) -> dict[str, int]:
    return {
        "1:1": sum(item.kind == "ONE_TO_ONE" for item in items),
        "1:N": sum(item.kind == "ONE_TO_MANY" for item in items),
        "N:1": sum(item.kind == "MANY_TO_ONE" for item in items),
        "N:M": sum(item.kind == "MANY_TO_MANY" for item in items),
        "A only": sum(item.kind == "A_ONLY" for item in items),
        "B only": sum(item.kind == "B_ONLY" for item in items),
    }
