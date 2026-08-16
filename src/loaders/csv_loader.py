from __future__ import annotations

from io import BytesIO
import csv

import pandas as pd

from src.common.exceptions import FileValidationError
from .base_loader import BaseLoader, SheetInfo


class CsvLoader(BaseLoader):
    def sheets(self, payload: bytes) -> list[SheetInfo]:
        encoding = detect_encoding(payload)
        delimiter = detect_delimiter(payload, encoding)
        preview = self.load(
            payload, sheet_name=None, header_row=1, data_start_row=2,
            encoding=encoding, delimiter=delimiter, drop_empty_rows=False,
            drop_empty_columns=False,
        ).head(20)
        return [SheetInfo(name="CSV", preview=preview)]

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
        if header_row < 1 or data_start_row < header_row + 1:
            raise FileValidationError("헤더 행과 데이터 시작 행을 확인하세요.")
        encoding = encoding or detect_encoding(payload)
        delimiter = delimiter or detect_delimiter(payload, encoding)
        try:
            raw = pd.read_csv(
                BytesIO(payload), header=None, dtype=object, encoding=encoding,
                sep=delimiter, engine="python", on_bad_lines="error",
            )
        except Exception as exc:
            raise FileValidationError(
                "CSV 파일을 읽을 수 없습니다. 인코딩, 구분자 또는 파일 손상을 확인하세요."
            ) from exc
        from .excel_loader import _frame_from_raw
        return _frame_from_raw(raw, header_row, data_start_row, drop_empty_rows, drop_empty_columns)


def detect_encoding(payload: bytes) -> str:
    for encoding in ("utf-8-sig", "utf-8", "cp949", "euc-kr", "latin-1"):
        try:
            payload.decode(encoding)
            return encoding
        except UnicodeDecodeError:
            continue
    return "utf-8"


def detect_delimiter(payload: bytes, encoding: str) -> str:
    sample = payload[:10000].decode(encoding, errors="replace")
    try:
        return csv.Sniffer().sniff(sample, delimiters=",;\t|").delimiter
    except csv.Error:
        return ","
