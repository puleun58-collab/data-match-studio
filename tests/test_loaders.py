from io import BytesIO

import pandas as pd

from src.loaders.csv_loader import CsvLoader
from src.loaders.excel_loader import ExcelLoader


def test_csv_loader_handles_header_offset_and_encoding():
    payload = "제목\n코드,값\nA,1\n".encode("utf-8-sig")
    frame = CsvLoader().load(payload, None, 2, 3, "utf-8-sig", ",")
    assert list(frame.columns) == ["코드", "값"]
    assert frame.iloc[0].tolist() == ["A", "1"]


def test_excel_loader_handles_different_header_row_and_duplicate_headers():
    output = BytesIO()
    with pd.ExcelWriter(output, engine="xlsxwriter") as writer:
        pd.DataFrame([["제목", None], ["코드", "코드"], ["A", 1]]).to_excel(writer, index=False, header=False, sheet_name="원본")
    frame = ExcelLoader().load(output.getvalue(), "원본", 2, 3)
    assert list(frame.columns) == ["코드", "코드"]
    assert frame.iloc[0, 0] == "A"
