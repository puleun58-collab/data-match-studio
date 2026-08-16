from __future__ import annotations

from dataclasses import dataclass

import pandas as pd


@dataclass
class HeaderCandidate:
    row_number: int
    score: float
    non_empty: int
    values: list[str]


def detect_header_candidates(raw_preview: pd.DataFrame, limit: int = 5) -> list[HeaderCandidate]:
    candidates: list[HeaderCandidate] = []
    for index, row in raw_preview.iterrows():
        values = ["" if pd.isna(value) else str(value).strip() for value in row.tolist()]
        non_empty = sum(bool(value) for value in values)
        unique = len({value for value in values if value})
        score = non_empty + (unique / max(non_empty, 1))
        candidates.append(HeaderCandidate(index + 1, score, non_empty, values))
    return sorted(candidates, key=lambda item: item.score, reverse=True)[:limit]
