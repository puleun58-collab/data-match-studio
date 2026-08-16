from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class RuleResult:
    rule_id: str
    display_name: str
    original_a: Any = None
    original_b: Any = None
    normalized_a: Any = None
    normalized_b: Any = None
    status: str = "비교 불가"
    reason: str = ""
    numeric_difference: float | None = None
    absolute_difference: float | None = None
    difference_rate: float | None = None
    conversion_success_a: bool = True
    conversion_success_b: bool = True
    comparison_method: str = ""
    duplicate_policy: str = ""


@dataclass
class ResultRow:
    key: tuple[Any, ...]
    key_display: str
    status: str
    reason: str
    a_count: int = 0
    b_count: int = 0
    a_unique_count: int = 0
    b_unique_count: int = 0
    duplicate_type: str = ""
    row_id_a: Any = None
    row_id_b: Any = None
    details: dict[str, Any] = field(default_factory=dict)
    rule_results: list[RuleResult] = field(default_factory=list)


@dataclass
class ComparisonSummary:
    total: int
    comparable: int
    identical: int
    mismatch: int
    a_only: int
    b_only: int
    duplicate: int
    conversion_failed: int
    nm_pending: int
    match_rate: float
    by_status: dict[str, int] = field(default_factory=dict)
