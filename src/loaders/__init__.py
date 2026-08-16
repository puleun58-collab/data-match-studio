from pathlib import Path

from src.common.exceptions import FileValidationError
from .base_loader import BaseLoader
from .csv_loader import CsvLoader
from .excel_loader import ExcelLoader


def loader_for(file_name: str) -> BaseLoader:
    suffix = Path(file_name).suffix.lower()
    if suffix == ".csv":
        return CsvLoader()
    if suffix in {".xlsx", ".xlsm"}:
        return ExcelLoader()
    raise FileValidationError(f"지원하지 않는 파일 형식입니다: {suffix}")


__all__ = ["BaseLoader", "CsvLoader", "ExcelLoader", "loader_for"]
