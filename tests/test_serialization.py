from datetime import date, datetime, timezone
from decimal import Decimal
import math

import pytest

from src.common.serialization import decode_scalar, encode_scalar, scalar_dumps, scalar_loads


def test_scalar_v1_round_trip():
    values = [None, "text", True, 3, 1.5, Decimal("12.340"), date(2026, 8, 16), datetime(2026, 8, 16, 12, 30, tzinfo=timezone.utc)]
    for value in values:
        assert decode_scalar(encode_scalar(value)) == value


def test_nonfinite_and_unknown_version():
    assert math.isnan(decode_scalar(encode_scalar(float("nan"))))
    assert math.isinf(scalar_loads(scalar_dumps(float("inf"))))
    with pytest.raises(ValueError):
        decode_scalar({"version": 99, "type": "string", "value": "x"})
    with pytest.raises(ValueError):
        encode_scalar(datetime(2026, 8, 16, 12, 30))
    assert encode_scalar(2**60)["type"] == "decimal"
