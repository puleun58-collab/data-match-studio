from __future__ import annotations

from pathlib import Path

from .constants import JOIN_TYPES, SUPPORTED_EXTENSIONS
from .exceptions import ConfigurationError, FileValidationError


def validate_extension(file_name: str) -> str:
    extension = Path(file_name).suffix.lower()
    if extension not in SUPPORTED_EXTENSIONS:
        raise FileValidationError(
            f"지원하지 않는 파일 형식입니다: {extension or '(확장자 없음)'}"
        )
    return extension


def validate_upload(file_name: str, size: int, max_bytes: int) -> None:
    validate_extension(file_name)
    if size > max_bytes:
        raise FileValidationError(
            f"파일 크기가 제한({max_bytes / 1024 / 1024:.0f} MB)을 초과했습니다."
        )


def validate_config(join_type: str, key_columns_a: list[str], key_columns_b: list[str], rule_count: int) -> None:
    if join_type not in JOIN_TYPES:
        raise ConfigurationError("지원하지 않는 조인 방식입니다.")
    if not key_columns_a or not key_columns_b:
        raise ConfigurationError("양쪽 데이터셋의 키 열을 하나 이상 선택하세요.")
    if len(key_columns_a) != len(key_columns_b):
        raise ConfigurationError("복합 키의 구성 열 개수는 양쪽이 같아야 합니다.")
    if rule_count == 0:
        raise ConfigurationError("비교 규칙을 하나 이상 추가하세요.")
