from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import pandas as pd


@dataclass
class DuplicateProfile:
    counts: dict[tuple[Any, ...], int]
    duplicate_keys: set[tuple[Any, ...]]
    max_count: int
    empty_key_count: int
    unique_key_count: int
    value_variation: dict[tuple[Any, ...], int]


def profile_duplicates(
    frame: pd.DataFrame,
    key_columns: list[str],
    value_columns: list[str] | None = None,
) -> DuplicateProfile:
    value_columns = value_columns or []
    counts: dict[tuple[Any, ...], int] = {}
    empty_key_count = 0
    for _, row in frame.iterrows():
        key = tuple(row[column] for column in key_columns)
        if any(pd.isna(value) or str(value).strip() == "" for value in key):
            empty_key_count += 1
            continue
        counts[key] = counts.get(key, 0) + 1
    duplicate_keys = {key for key, count in counts.items() if count > 1}
    variation: dict[tuple[Any, ...], int] = {}
    if value_columns:
        for key in duplicate_keys:
            subset = frame.loc[
                frame.apply(lambda row: tuple(row[column] for column in key_columns) == key, axis=1),
                value_columns,
            ]
            variation[key] = int(len(subset.drop_duplicates()))
    return DuplicateProfile(
        counts=counts,
        duplicate_keys=duplicate_keys,
        max_count=max(counts.values(), default=0),
        empty_key_count=empty_key_count,
        unique_key_count=len(counts),
        value_variation=variation,
    )
