from __future__ import annotations

import json
from typing import Any

from src.models.config import ComparisonConfig, config_from_dict, to_dict


def dump_template(
    config: ComparisonConfig,
    column_expectations: dict[str, dict[str, str]] | None = None,
) -> str:
    payload = to_dict(config)
    if column_expectations:
        payload["column_expectations"] = column_expectations
    return json.dumps(payload, ensure_ascii=False, indent=2, default=str)


def load_template(payload: str | bytes) -> ComparisonConfig:
    try:
        value = json.loads(payload)
        if not isinstance(value, dict):
            raise ValueError("템플릿의 최상위 값은 객체여야 합니다.")
        return config_from_dict(value)
    except (json.JSONDecodeError, TypeError, ValueError, KeyError) as exc:
        raise ValueError("비교 설정 JSON을 읽을 수 없습니다.") from exc
