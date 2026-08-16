from __future__ import annotations

from io import BytesIO
from typing import Any

import pandas as pd

from src.comparison.comparison_engine import result_rows_to_frame
from src.models.comparison_result import ComparisonSummary, ResultRow
from src.models.config import ComparisonConfig, to_dict

SHEET_NAMES = [
    "01_전체결과", "02_불일치", "03_A에만존재", "04_B에만존재", "05_중복키",
    "06_N대M처리필요", "07_변환실패", "08_데이터품질", "09_비교설정", "10_요약",
]


def export_excel(
    rows: list[ResultRow],
    config: ComparisonConfig,
    quality_frame: pd.DataFrame | None = None,
    summary: ComparisonSummary | dict[str, Any] | None = None,
) -> bytes:
    all_results = result_rows_to_frame(rows)
    summary_values = _summary_values(summary)
    sheets = {
        "01_전체결과": all_results,
        "02_불일치": all_results[all_results["상태"].isin(["일부 항목 불일치", "모든 항목 불일치", "중복 키 · 값 상이", "형식 변환 실패"])] if not all_results.empty else all_results,
        "03_A에만존재": all_results[all_results["상태"] == "데이터셋 A에만 존재"] if not all_results.empty else all_results,
        "04_B에만존재": all_results[all_results["상태"] == "데이터셋 B에만 존재"] if not all_results.empty else all_results,
        "05_중복키": all_results[all_results["상태"].str.contains("중복|1:N|N:1", na=False)] if not all_results.empty else all_results,
        "06_N대M처리필요": all_results[all_results["상태"] == "N:M 처리 필요"] if not all_results.empty else all_results,
        "07_변환실패": all_results[all_results["상태"] == "형식 변환 실패"] if not all_results.empty else all_results,
        "08_데이터품질": quality_frame if quality_frame is not None else pd.DataFrame(),
        "09_비교설정": _settings_frame(config),
        "10_요약": pd.DataFrame([summary_values]),
    }
    buffer = BytesIO()
    with pd.ExcelWriter(buffer, engine="xlsxwriter", datetime_format="yyyy-mm-dd hh:mm:ss") as writer:
        workbook = writer.book
        header_format = workbook.add_format({"bold": True, "bg_color": "#D9EAF7", "border": 1})
        number_format = workbook.add_format({"num_format": "#,##0.############"})
        for name in SHEET_NAMES:
            frame = sheets[name]
            frame.to_excel(writer, sheet_name=name, index=False)
            worksheet = writer.sheets[name]
            worksheet.freeze_panes(1, 0)
            worksheet.autofilter(0, 0, max(len(frame), 1), max(len(frame.columns) - 1, 0))
            for index, column in enumerate(frame.columns):
                worksheet.write(0, index, column, header_format)
                width = min(max(len(str(column)) + 2, 10), 45)
                worksheet.set_column(index, index, width)
            for index, column in enumerate(frame.columns):
                if pd.api.types.is_numeric_dtype(frame[column]):
                    worksheet.set_column(index, index, None, number_format)
            if "상태" in frame.columns and len(frame):
                status_col = frame.columns.get_loc("상태")
                for status, color in (("모두 동일", "#E2F0D9"), ("형식 변환 실패", "#FCE4D6"), ("N:M 처리 필요", "#FFF2CC"), ("중복 키", "#FFF2CC")):
                    worksheet.conditional_format(1, status_col, len(frame), status_col, {"type": "text", "criteria": "containing", "value": status, "format": workbook.add_format({"bg_color": color})})
    return buffer.getvalue()


def _summary_values(summary: ComparisonSummary | dict[str, Any] | None) -> dict[str, Any]:
    if summary is None:
        return {}
    if isinstance(summary, ComparisonSummary):
        return {
            "전체 결과": summary.total,
            "비교 가능": summary.comparable,
            "모두 동일": summary.identical,
            "불일치": summary.mismatch,
            "A에만 존재": summary.a_only,
            "B에만 존재": summary.b_only,
            "중복": summary.duplicate,
            "변환 실패": summary.conversion_failed,
            "N:M 처리 필요": summary.nm_pending,
            "일치율": summary.match_rate,
            "상태별 건수": summary.by_status,
        }
    return dict(summary)


def _settings_frame(config: ComparisonConfig) -> pd.DataFrame:
    payload = to_dict(config)
    rows: list[dict[str, Any]] = []
    def walk(prefix: str, value: Any) -> None:
        if isinstance(value, dict):
            for key, item in value.items():
                walk(f"{prefix}.{key}" if prefix else key, item)
        elif isinstance(value, list):
            rows.append({"설정": prefix, "값": str(value)})
        else:
            rows.append({"설정": prefix, "값": value})
    walk("", payload)
    return pd.DataFrame(rows)
