"""Versioned, tagged scalar serialization used by templates."""
from __future__ import annotations

import json
import math
import re
from datetime import date, datetime
from decimal import Decimal
from typing import Any

try:
    import numpy as np
except ImportError:  # pragma: no cover - pandas already brings numpy in normal installs
    np = None

VERSION = 1


def encode_scalar(value: Any) -> dict[str, Any]:
    if np is not None and isinstance(value, np.generic):
        value = value.item()
    if value is None:
        return {"version": VERSION, "type": "null", "value": None}
    if isinstance(value, bool):
        return {"version": VERSION, "type": "bool", "value": value}
    if isinstance(value, str):
        return {"version": VERSION, "type": "string", "value": value}
    if isinstance(value, int):
        if abs(value) > 2**53 - 1:
            return {"version": VERSION, "type": "decimal", "value": str(value)}
        return {"version": VERSION, "type": "int", "value": value}
    if isinstance(value, float):
        if math.isfinite(value):
            return {"version": VERSION, "type": "float", "value": value}
        return {"version": VERSION, "type": "nonfinite", "value": "nan" if math.isnan(value) else ("inf" if value > 0 else "-inf")}
    if isinstance(value, Decimal):
        if not value.is_finite():
            return {"version": VERSION, "type": "nonfinite", "value": "nan" if value.is_nan() else ("inf" if value > 0 else "-inf")}
        return {"version": VERSION, "type": "decimal", "value": str(value)}
    if isinstance(value, datetime):
        if value.tzinfo is None:
            raise ValueError("datetime scalar requires an explicit timezone")
        return {"version": VERSION, "type": "datetime", "value": value.isoformat()}
    if isinstance(value, date):
        return {"version": VERSION, "type": "date", "value": value.isoformat()}
    if isinstance(value, (dict, list)):
        return {"version": VERSION, "type": "json", "value": value}
    raise TypeError(f"unsupported scalar type: {type(value).__name__}")


def decode_scalar(value: Any) -> Any:
    if not isinstance(value, dict) or value.get("version") != VERSION:
        raise ValueError("unknown scalar version")
    if set(value) - {"version", "type", "value"}:
        raise ValueError("unknown scalar fields")
    kind = value.get("type")
    raw = value.get("value")
    if kind == "null": return None
    if kind == "string":
        if not isinstance(raw, str): raise ValueError("invalid string scalar")
        return raw
    if kind == "bool":
        if not isinstance(raw, bool): raise ValueError("invalid bool scalar")
        return raw
    if kind == "int":
        if isinstance(raw, bool) or not isinstance(raw, int) or abs(raw) > 2**53 - 1: raise ValueError("invalid int scalar")
        return raw
    if kind == "float":
        if isinstance(raw, bool) or not isinstance(raw, (int, float)) or not math.isfinite(float(raw)): raise ValueError("invalid float scalar")
        return float(raw)
    if kind == "decimal":
        if not isinstance(raw, str) or not re.fullmatch(r"-?(0|[1-9][0-9]*)(\.[0-9]+)?", raw):
            raise ValueError("invalid decimal scalar")
        try: return Decimal(raw)
        except Exception as exc: raise ValueError("invalid decimal scalar") from exc
    if kind == "date":
        if not isinstance(raw, str) or not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", raw): raise ValueError("invalid date scalar")
        try: return date.fromisoformat(raw)
        except Exception as exc: raise ValueError("invalid date scalar") from exc
    if kind == "datetime":
        if not isinstance(raw, str) or not re.search(r"(Z|[+-][0-9]{2}:[0-9]{2})$", raw): raise ValueError("invalid datetime scalar")
        try:
            parsed = datetime.fromisoformat(raw)
            if parsed.tzinfo is None: raise ValueError("datetime scalar requires an explicit timezone")
            return parsed
        except Exception as exc: raise ValueError("invalid datetime scalar") from exc
    if kind == "nonfinite":
        if raw == "nan": return float("nan")
        if raw == "inf": return float("inf")
        if raw == "-inf": return float("-inf")
        raise ValueError("invalid nonfinite scalar")
    if kind == "json":
        try: json.dumps(raw, allow_nan=False)
        except (TypeError, ValueError) as exc: raise ValueError("invalid json scalar") from exc
        return raw
    raise ValueError("unknown scalar type")


def canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)


def scalar_dumps(value: Any) -> str:
    return canonical_json(encode_scalar(value))


def scalar_loads(payload: str | bytes) -> Any:
    return decode_scalar(json.loads(payload))

serialize_scalar = encode_scalar
deserialize_scalar = decode_scalar
encode_scalar_v1 = encode_scalar
decode_scalar_v1 = decode_scalar
to_scalar = encode_scalar
from_scalar = decode_scalar
