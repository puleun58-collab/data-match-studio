import pandas as pd

from src.matching.key_builder import add_key_columns
from src.models.config import KeyNormalizationOptions


def test_composite_key_is_tuple_and_collision_safe():
    frame = pd.DataFrame({"code": ["A"], "year": ["2026.0"], "city": [" 서울 "]})
    result = add_key_columns(frame, ["code", "year", "city"], KeyNormalizationOptions(coerce_numeric_string=True))
    assert result.iloc[0]["__key_tuple"] == ("A", "2026", "서울")
    assert isinstance(result.iloc[0]["__key_tuple"], tuple)
