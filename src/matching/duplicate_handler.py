from __future__ import annotations

from typing import Any

import pandas as pd

from src.models.config import DuplicatePolicy


def grouped_rows(frame: pd.DataFrame) -> dict[tuple[Any, ...], pd.DataFrame]:
    return {key: group for key, group in frame.groupby("__key_tuple", sort=False, dropna=False)}


def representative(group: pd.DataFrame, policy: DuplicatePolicy) -> pd.Series:
    if group.empty:
        raise ValueError("대표 행을 선택할 수 없습니다.")
    if policy.representative_sort_column and policy.representative_sort_column in group.columns:
        ascending = policy.representative_sort_direction.lower() == "asc"
        return group.sort_values(policy.representative_sort_column, ascending=ascending).iloc[0]
    return group.iloc[0]


def aggregate_values(series: pd.Series, method: str) -> Any:
    values = series.dropna()
    if method == "sum":
        return pd.to_numeric(values, errors="coerce").sum()
    if method == "mean":
        return pd.to_numeric(values, errors="coerce").mean()
    if method == "min":
        return values.min() if len(values) else None
    if method == "max":
        return values.max() if len(values) else None
    if method == "count":
        return int(values.count())
    if method == "nunique":
        return int(values.nunique())
    if method == "first_date":
        dates = pd.to_datetime(values, errors="coerce").dropna()
        return dates.min() if len(dates) else None
    if method == "last_date":
        dates = pd.to_datetime(values, errors="coerce").dropna()
        return dates.max() if len(dates) else None
    if method == "concat_unique":
        return " | ".join(str(item) for item in pd.unique(values))
    raise ValueError(f"지원하지 않는 집계 방식: {method}")
