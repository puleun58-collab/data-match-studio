from io import BytesIO

import pandas as pd

from src.export import export_csv, export_excel
from src.models.config import ComparisonConfig, DatasetConfig
from src.models.comparison_result import ResultRow
from src.templates import dump_template, load_template


def test_csv_export():
    payload = export_csv(pd.DataFrame({"키": ["A"], "상태": ["모두 동일"]}))
    assert payload.startswith(b"\xef\xbb\xbf")
    assert "모두 동일" in payload.decode("utf-8-sig")


def test_excel_export_creates_required_sheets():
    config = ComparisonConfig(DatasetConfig("a.csv", "csv"), DatasetConfig("b.csv", "csv"))
    payload = export_excel([ResultRow(("A",), "A", "모두 동일", "ok")], config)
    book = pd.ExcelFile(BytesIO(payload))
    assert "01_전체결과" in book.sheet_names
    assert "10_요약" in book.sheet_names


def test_template_round_trip():
    config = ComparisonConfig(DatasetConfig("a.csv", "csv", key_columns=["a"]), DatasetConfig("b.csv", "csv", key_columns=["b"]))
    loaded = load_template(dump_template(config))
    assert loaded.dataset_a.key_columns == ["a"]
    assert loaded.dataset_b.key_columns == ["b"]
