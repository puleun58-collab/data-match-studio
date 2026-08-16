from __future__ import annotations

import pandas as pd

from src.comparison import ComparisonEngine, result_rows_to_frame, summarize
from src.matching.key_builder import add_key_columns
from src.models.config import ComparisonConfig, ComparisonRule, DatasetConfig, DuplicatePolicy, KeyNormalizationOptions, NullPolicy, ToleranceOptions


def config(rules, nm_policy="error", allow=False):
    return ComparisonConfig(
        DatasetConfig("a.csv", "csv", key_columns=["key"], key_normalization=KeyNormalizationOptions()),
        DatasetConfig("b.csv", "csv", key_columns=["key"], key_normalization=KeyNormalizationOptions()),
        duplicate_policy_a=DuplicatePolicy("A", allow_one_to_many=allow),
        duplicate_policy_b=DuplicatePolicy("B", allow_one_to_many=allow),
        nm_policy=nm_policy,
        comparison_rules=rules,
    )


def rule(data_type="text", method="exact", **kwargs):
    return ComparisonRule("r1", "값", "value", "value", data_type, method, normalization_options=kwargs.get("normalization_options", {}), null_policy=kwargs.get("null_policy", NullPolicy()), tolerance_options=kwargs.get("tolerance_options", ToleranceOptions()))


def run(a, b, rules, **kwargs):
    fa = add_key_columns(pd.DataFrame(a), ["key"], KeyNormalizationOptions())
    fb = add_key_columns(pd.DataFrame(b), ["key"], KeyNormalizationOptions())
    return ComparisonEngine().compare(fa, fb, config(rules, **kwargs))


def test_one_to_one_outer_join_and_missing():
    rows = run([{"key": "a", "value": "x"}, {"key": "only-a", "value": "1"}], [{"key": "a", "value": "x"}, {"key": "only-b", "value": "2"}], [rule()])
    statuses = {row.key_display: row.status for row in rows}
    assert statuses["a"] == "모두 동일"
    assert statuses["only-a"] == "데이터셋 A에만 존재"
    assert statuses["only-b"] == "데이터셋 B에만 존재"


def test_left_join_excludes_b_only():
    rows = run([{"key": "a", "value": "x"}], [{"key": "a", "value": "x"}, {"key": "b", "value": "y"}], [rule()])
    assert [row.key_display for row in rows] == ["a"]


def test_text_normalization_and_case():
    rows = run([{"key": "a", "value": " ABC  "}], [{"key": "a", "value": "abc"}], [rule("text", "case_insensitive")])
    assert rows[0].status == "모두 동일"


def test_number_rounding_and_absolute_tolerance():
    assert run([{"key": "a", "value": "1.234"}], [{"key": "a", "value": "1.23"}], [rule("number", "round", tolerance_options=ToleranceOptions(decimals=2))])[0].status == "모두 동일"
    assert run([{"key": "a", "value": "100"}], [{"key": "a", "value": "101"}], [rule("number", "absolute_tolerance", tolerance_options=ToleranceOptions(absolute=1))])[0].status == "모두 동일"


def test_relative_tolerance_and_unit_number():
    assert run([{"key": "a", "value": "1,000원"}], [{"key": "a", "value": "1000"}], [rule("unit_number", "exact")])[0].status == "모두 동일"
    assert run([{"key": "a", "value": "100"}], [{"key": "a", "value": "101"}], [rule("number", "relative_tolerance", tolerance_options=ToleranceOptions(relative=0.01))])[0].status == "모두 동일"


def test_date_and_boolean_comparison():
    assert run([{"key": "a", "value": "2026-08-16"}], [{"key": "a", "value": "2026/08/16"}], [rule("date", "date")])[0].status == "모두 동일"
    assert run([{"key": "a", "value": "Y"}], [{"key": "a", "value": "사용"}], [rule("boolean", "exact")])[0].status == "모두 동일"


def test_empty_and_conversion_failure_are_distinct():
    assert run([{"key": "a", "value": None}], [{"key": "a", "value": None}], [rule("number")])[0].status == "모두 동일"
    assert run([{"key": "a", "value": "bad"}], [{"key": "a", "value": "1"}], [rule("number")])[0].status == "형식 변환 실패"


def test_one_to_many_requires_explicit_permission_and_then_compares_rows():
    blocked = run([{"key": "a", "value": 100}], [{"key": "a", "value": 100}, {"key": "a", "value": 120}], [rule("number")])
    assert blocked[0].status == "중복 키"
    allowed = run([{"key": "a", "value": 100}], [{"key": "a", "value": 100}, {"key": "a", "value": 120}], [rule("number")], allow=True)
    assert [row.status for row in allowed] == ["1:N 비교", "1:N 비교"]


def test_many_to_one_rowwise_comparison():
    rows = run([{"key": "a", "value": 100}, {"key": "a", "value": 120}], [{"key": "a", "value": 100}], [rule("number")], allow=True)
    assert [row.status for row in rows] == ["N:1 비교", "N:1 비교"]


def test_many_to_many_is_not_cartesian_and_requires_policy():
    a = [{"key": "a", "value": 100}, {"key": "a", "value": 120}]
    b = [{"key": "a", "value": 100}, {"key": "a", "value": 120}, {"key": "a", "value": 150}]
    rows = run(a, b, [rule("number")])
    assert len(rows) == 1
    assert rows[0].status == "N:M 처리 필요"


def test_set_and_multiset_comparison():
    a = [{"key": "a", "value": 100}, {"key": "a", "value": 120}]
    b = [{"key": "a", "value": 120}, {"key": "a", "value": 100}]
    assert run(a, b, [rule("number")], nm_policy="set")[0].status == "중복 키 · 값 동일"
    b.append({"key": "a", "value": 100})
    assert run(a, b, [rule("number")], nm_policy="set")[0].status == "중복 키 · 값 동일"
    assert run(a, b, [rule("number")], nm_policy="multiset")[0].status == "중복 키 · 값 상이"


def test_aggregate_comparison():
    a = [{"key": "a", "value": 100}, {"key": "a", "value": 120}]
    b = [{"key": "a", "value": 100}, {"key": "a", "value": 120}]
    comparison_rule = rule("number", "exact", normalization_options={"aggregation_method": "sum"})
    assert run(a, b, [comparison_rule], nm_policy="aggregate")[0].status == "중복 키 · 값 동일"


def test_summary_and_traceable_result_columns():
    rows = run([{"key": "a", "value": "x"}], [{"key": "a", "value": "y"}], [rule()])
    frame = result_rows_to_frame(rows)
    assert "값 · A 원본값" in frame.columns
    assert "값 · A 정규화값" in frame.columns
    assert summarize(rows).mismatch == 1
