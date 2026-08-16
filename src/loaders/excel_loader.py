from __future__ import annotations

from io import BytesIO

import pandas as pd

from src.common.exceptions import FileValidationError
from .base_loader import BaseLoader, SheetInfo


class ExcelLoader(BaseLoader):
    def sheets(self, payload: bytes) -> list[SheetInfo]:
        try:
            workbook = pd.ExcelFile(BytesIO(payload), engine="openpyxl")
            result: list[SheetInfo] = []
            for name in workbook.sheet_names:
                preview = pd.read_excel(
                    workbook, sheet_name=name, header=None, nrows=20, engine="openpyxl"
                )
                result.append(SheetInfo(name=name, preview=preview))
            return result
        except Exception as exc:
            raise FileValidationError(
                "Excel 파일을 읽을 수 없습니다. 암호화되었거나 손상된 파일일 수 있습니다."
            ) from exc

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
        if not sheet_name:
            raise FileValidationError("Excel 시트를 선택하세요.")
        if header_row < 1 or data_start_row < header_row + 1:
            raise FileValidationError("헤더 행과 데이터 시작 행을 확인하세요.")
        try:
            raw = pd.read_excel(
                BytesIO(payload),
                sheet_name=sheet_name,
                header=None,
                dtype=object,
                engine="openpyxl",
            )
        except Exception as exc:
            raise FileValidationError(
                "Excel 데이터를 읽을 수 없습니다. 암호화되었거나 손상된 파일일 수 있습니다."
            ) from exc
        return _frame_from_raw(
            raw,
            header_row=header_row,
            data_start_row=data_start_row,
            drop_empty_rows=drop_empty_rows,
            drop_empty_columns=drop_empty_columns,
        )


def _frame_from_raw(
    raw: pd.DataFrame,
    header_row: int,
    data_start_row: int,
    drop_empty_rows: bool,
    drop_empty_columns: bool,
) -> pd.DataFrame:
    header_index = header_row - 1
    start_index = data_start_row - 1
    if header_index >= len(raw):
        raise FileValidationError("헤더 행이 파일의 범위를 벗어났습니다.")
    headers = ["" if pd.isna(value) else str(value) for value in raw.iloc[header_index].tolist()]
    frame = raw.iloc[start_index:].copy().reset_index(drop=True)
    frame.columns = headers
    if drop_empty_rows:
        frame = frame.loc[~frame.isna().all(axis=1)].reset_index(drop=True)
    if drop_empty_columns:
        frame = frame.loc[:, ~frame.isna().all(axis=0)]
    return frame
