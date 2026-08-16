from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any
from enum import IntFlag


class OutcomeFlags(IntFlag):
    COMPARABLE = 1
    IDENTICAL = 2
    MISMATCH = 4
    CONVERSION_FAILED = 8
    DUPLICATE = 16
    NM_PENDING = 32
    A_ONLY = 64
    B_ONLY = 128
    STRUCTURAL_BLOCK = 256
    INVALID_KEY = 512


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
class TraceItem:
    side: str
    rule_id: str
    ordinal: int
    row_id: Any
    original: Any
    normalized: Any
    status: str
    reason: str
    conversion_success: bool
    numeric_difference: float | None = None
    absolute_difference: float | None = None
    difference_rate: float | None = None


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
    rule_results: list[RuleResult] = field(default_factory=list)
    outcome_flags: OutcomeFlags = OutcomeFlags(0)
    details: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        # Keep the historical string status API while exposing typed algebra.
        if not self.outcome_flags:
            from src.comparison.status import flags_for_status
            self.outcome_flags = flags_for_status(self.status)

    @property
    def display_status(self) -> str:
        return self.status


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
