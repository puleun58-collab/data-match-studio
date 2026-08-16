from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import pandas as pd

from .type_detector import infer_types


@dataclass
class ColumnProfile:
    column: str
    missing_count: int
    missing_rate: float
    unique_count: int
    inferred_type: str


@dataclass
class DataProfile:
    row_count: int
    column_count: int
    empty_rows: int
    empty_columns: int
    duplicate_rows: int
    columns: list[ColumnProfile]


def profile_frame(frame: pd.DataFrame) -> DataProfile:
    empty_rows = int(frame.isna().all(axis=1).sum())
    empty_columns = int(frame.isna().all(axis=0).sum())
    duplicate_rows = int(frame.duplicated(keep=False).sum())
    types = infer_types(frame)
    columns = [
        ColumnProfile(
            column=str(column),
            missing_count=int(frame[column].isna().sum()),
            missing_rate=float(frame[column].isna().mean()) if len(frame) else 0.0,
            unique_count=int(frame[column].nunique(dropna=True)),
            inferred_type=types[str(column)],
        )
        for column in frame.columns
    ]
    return DataProfile(len(frame), len(frame.columns), empty_rows, empty_columns, duplicate_rows, columns)


def profile_to_frame(profile: DataProfile) -> pd.DataFrame:
    return pd.DataFrame([{
        "열": item.column,
        "결측 건수": item.missing_count,
        "결측률": item.missing_rate,
        "고유값 수": item.unique_count,
        "추정 유형": item.inferred_type,
    } for item in profile.columns])
