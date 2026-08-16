from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from io import BytesIO
from typing import BinaryIO

import pandas as pd


@dataclass
class SheetInfo:
    name: str
    preview: pd.DataFrame


class BaseLoader(ABC):
    @abstractmethod
    def sheets(self, payload: bytes) -> list[SheetInfo]:
        raise NotImplementedError

    @abstractmethod
    def load(
        self,
        payload: bytes,
        sheet_name: str | None,
        header_row: int,
        data_start_row: int,
        encoding: str | None = None,
        delimiter: str | None = None,
        drop_empty_rows: bool = True,
        drop_empty_columns: bool = True,
    ) -> pd.DataFrame:
        raise NotImplementedError


def bytes_buffer(payload: bytes) -> BinaryIO:
    return BytesIO(payload)
