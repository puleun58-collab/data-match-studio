from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime
from typing import Any


@dataclass(frozen=True)
class ColumnRef:
    """Stable column identity; names alone are not sufficient when headers repeat."""

    index: int
    excel_letter: str
    name: str
    column_id: str

    @property
    def display_name(self) -> str:
        label = self.name.strip() or "(빈 컬럼명)"
        return f"{label} [{self.excel_letter}]"


@dataclass
class KeyNormalizationOptions:
    trim: bool = True
    collapse_spaces: bool = False
    remove_all_spaces: bool = False
    case_insensitive: bool = False
    remove_line_breaks: bool = True
    remove_special_spaces: bool = True
    unicode_normalize: bool = True
    strip_numeric_dot_zero: bool = True
    coerce_numeric_string: bool = False
    date_format: str | None = None
    replacements: dict[str, str] = field(default_factory=dict)


@dataclass
class DatasetConfig:
    file_name: str
    source_type: str
    sheet_name: str | None = None
    header_row: int = 1
    data_start_row: int = 2
    key_columns: list[str] = field(default_factory=list)
    key_normalization: KeyNormalizationOptions = field(default_factory=KeyNormalizationOptions)
    drop_empty_rows: bool = True
    drop_empty_columns: bool = True
    encoding: str | None = None
    delimiter: str | None = None


@dataclass
class NullPolicy:
    both_empty_equal: bool = True
    one_empty_mismatch: bool = True
    exclude_empty_rows: bool = False
    empty_equals_zero: bool = False
    empty_equals_text: str | None = None
    missing_tokens: list[str] = field(
        default_factory=lambda: ["", "null", "none", "nan", "n/a", "na", "-"]
    )


@dataclass
class ToleranceOptions:
    decimals: int | None = None
    absolute: float | None = None
    relative: float | None = None
    percentage: float | None = None


@dataclass
class ComparisonRule:
    rule_id: str
    display_name: str
    column_a_id: str
    column_b_id: str
    data_type: str = "text"
    comparison_method: str = "exact"
    normalization_options: dict[str, Any] = field(default_factory=dict)
    null_policy: NullPolicy = field(default_factory=NullPolicy)
    tolerance_options: ToleranceOptions = field(default_factory=ToleranceOptions)
    visible: bool = True


@dataclass
class DuplicatePolicy:
    dataset_side: str
    policy_type: str = "error"
    representative_sort_column: str | None = None
    representative_sort_direction: str = "desc"
    aggregation_method: str | None = None
    compare_mode: str = "row"
    allow_one_to_many: bool = False


@dataclass
class ComparisonConfig:
    dataset_a: DatasetConfig
    dataset_b: DatasetConfig
    join_type: str = "outer"
    duplicate_policy_a: DuplicatePolicy = field(
        default_factory=lambda: DuplicatePolicy("A")
    )
    duplicate_policy_b: DuplicatePolicy = field(
        default_factory=lambda: DuplicatePolicy("B")
    )
    nm_policy: str = "error"
    comparison_rules: list[ComparisonRule] = field(default_factory=list)
    created_at: str = field(default_factory=lambda: datetime.now().isoformat(timespec="seconds"))


def to_dict(value: Any) -> Any:
    if hasattr(value, "__dataclass_fields__"):
        return {key: to_dict(item) for key, item in asdict(value).items()}
    if isinstance(value, list):
        return [to_dict(item) for item in value]
    if isinstance(value, dict):
        return {key: to_dict(item) for key, item in value.items()}
    return value


def config_from_dict(payload: dict[str, Any]) -> ComparisonConfig:
    def key_options(raw: dict[str, Any] | None) -> KeyNormalizationOptions:
        return KeyNormalizationOptions(**(raw or {}))

    def dataset(raw: dict[str, Any]) -> DatasetConfig:
        value = dict(raw)
        value["key_normalization"] = key_options(value.get("key_normalization"))
        return DatasetConfig(**value)

    def null_policy(raw: dict[str, Any] | None) -> NullPolicy:
        return NullPolicy(**(raw or {}))

    def tolerance(raw: dict[str, Any] | None) -> ToleranceOptions:
        return ToleranceOptions(**(raw or {}))

    def rule(raw: dict[str, Any]) -> ComparisonRule:
        value = dict(raw)
        value["null_policy"] = null_policy(value.get("null_policy"))
        value["tolerance_options"] = tolerance(value.get("tolerance_options"))
        return ComparisonRule(**value)

    def duplicate(raw: dict[str, Any], default_side: str) -> DuplicatePolicy:
        return DuplicatePolicy(dataset_side=default_side, **{k: v for k, v in raw.items() if k != "dataset_side"})

    return ComparisonConfig(
        dataset_a=dataset(payload["dataset_a"]),
        dataset_b=dataset(payload["dataset_b"]),
        join_type=payload.get("join_type", "outer"),
        duplicate_policy_a=duplicate(payload.get("duplicate_policy_a", {}), "A"),
        duplicate_policy_b=duplicate(payload.get("duplicate_policy_b", {}), "B"),
        nm_policy=payload.get("nm_policy", "error"),
        comparison_rules=[rule(item) for item in payload.get("comparison_rules", [])],
        created_at=payload.get("created_at", datetime.now().isoformat(timespec="seconds")),
    )
