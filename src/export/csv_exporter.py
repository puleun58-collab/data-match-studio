from __future__ import annotations

from io import BytesIO

import pandas as pd


def export_csv(frame: pd.DataFrame) -> bytes:
    buffer = BytesIO()
    frame.to_csv(buffer, index=False, encoding="utf-8-sig")
    return buffer.getvalue()
