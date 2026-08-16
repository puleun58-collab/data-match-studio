from __future__ import annotations

from pathlib import Path

import pandas as pd


ROOT = Path(__file__).parent


def main() -> None:
    data_a = pd.DataFrame([
        {"상품코드": "P001", "상품명": "Alpha", "판매단가": "₩1,000", "기준일": "2026-08-16"},
        {"상품코드": "P002", "상품명": "Beta", "판매단가": "2,500", "기준일": "2026/08/17"},
        {"상품코드": "P003", "상품명": "Gamma", "판매단가": "오류", "기준일": "2026-08-18"},
    ])
    data_b = pd.DataFrame([
        {"제품번호": " p001 ", "제품명": "alpha", "가격": 1000, "기준일": "2026년 8월 16일"},
        {"제품번호": "P002", "제품명": "Beta", "가격": 2501, "기준일": "2026-08-17"},
        {"제품번호": "P004", "제품명": "Delta", "가격": 4000, "기준일": "2026-08-19"},
    ])
    data_a.to_csv(ROOT / "sample_a.csv", index=False, encoding="utf-8-sig")
    with pd.ExcelWriter(ROOT / "sample_b.xlsx", engine="xlsxwriter") as writer:
        pd.DataFrame([["상품 비교 샘플"], ["제품번호", "제품명", "가격", "기준일"], *data_b.astype(object).values.tolist()]).to_excel(writer, index=False, header=False, sheet_name="비교데이터")
    print("sample_a.csv and sample_b.xlsx created")


if __name__ == "__main__":
    main()
