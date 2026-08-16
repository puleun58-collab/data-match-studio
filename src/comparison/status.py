from __future__ import annotations

from enum import Enum

from src.models.comparison_result import OutcomeFlags


STATUS_IDENTICAL = "모두 동일"
STATUS_MISMATCH = "일부 항목 불일치"
STATUS_MISMATCH_ALL = "모든 항목 불일치"
STATUS_A_ONLY = "데이터셋 A에만 존재"
STATUS_B_ONLY = "데이터셋 B에만 존재"
STATUS_CONVERSION = "형식 변환 실패"
STATUS_DUPLICATE = "중복 키"
STATUS_NM_PENDING = "N:M 처리 필요"


class DisplayStatus(str, Enum):
    IDENTICAL = STATUS_IDENTICAL
    MISMATCH = STATUS_MISMATCH
    MISMATCH_ALL = STATUS_MISMATCH_ALL
    A_ONLY = STATUS_A_ONLY
    B_ONLY = STATUS_B_ONLY
    CONVERSION_FAILED = STATUS_CONVERSION
    DUPLICATE = STATUS_DUPLICATE
    NM_PENDING = STATUS_NM_PENDING


OutcomeStatus = DisplayStatus


def flags_for_status(status: str) -> OutcomeFlags:
    flags = OutcomeFlags(0)
    if status in {STATUS_IDENTICAL, STATUS_MISMATCH, STATUS_MISMATCH_ALL, "1:N 비교", "N:1 비교", "중복 키 · 값 동일", "중복 키 · 값 상이"}:
        flags |= OutcomeFlags.COMPARABLE
    if status in {STATUS_IDENTICAL, "중복 키 · 값 동일"}:
        flags |= OutcomeFlags.IDENTICAL
    if status in {STATUS_MISMATCH, STATUS_MISMATCH_ALL, "중복 키 · 값 상이"}:
        flags |= OutcomeFlags.MISMATCH
    if status == STATUS_CONVERSION:
        flags |= OutcomeFlags.CONVERSION_FAILED
    if "중복" in status or status in {"1:N 비교", "N:1 비교"}:
        flags |= OutcomeFlags.DUPLICATE
    if status == STATUS_NM_PENDING:
        flags |= OutcomeFlags.NM_PENDING | OutcomeFlags.DUPLICATE
    if status == STATUS_A_ONLY:
        flags |= OutcomeFlags.A_ONLY
    if status == STATUS_B_ONLY:
        flags |= OutcomeFlags.B_ONLY
    if status == "빈 키":
        flags |= OutcomeFlags.INVALID_KEY | OutcomeFlags.STRUCTURAL_BLOCK
    if status == STATUS_DUPLICATE:
        flags |= OutcomeFlags.DUPLICATE | OutcomeFlags.STRUCTURAL_BLOCK
    return flags


def summary_counts(rows):
    from collections import Counter
    counts = Counter()
    for row in rows:
        f = row.outcome_flags
        if f & OutcomeFlags.COMPARABLE: counts["comparable"] += 1
        if f & OutcomeFlags.IDENTICAL: counts["identical"] += 1
        if f & OutcomeFlags.MISMATCH: counts["mismatch"] += 1
        if f & OutcomeFlags.A_ONLY: counts["a_only"] += 1
        if f & OutcomeFlags.B_ONLY: counts["b_only"] += 1
        if f & OutcomeFlags.DUPLICATE: counts["duplicate"] += 1
        if f & OutcomeFlags.CONVERSION_FAILED: counts["conversion_failed"] += 1
        if f & OutcomeFlags.NM_PENDING: counts["nm_pending"] += 1
        if row.status in {"1:N 비교", "N:1 비교"} and row.rule_results:
            if any(item.status == "형식 변환 실패" for item in row.rule_results):
                counts["conversion_failed"] += 1
            elif all(item.status == "동일" for item in row.rule_results):
                counts["identical"] += 1
            elif any(item.status == "불일치" for item in row.rule_results):
                counts["mismatch"] += 1
    return counts
