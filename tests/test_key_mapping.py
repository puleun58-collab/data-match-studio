import json

import pandas as pd
import pytest

from src.comparison import ComparisonEngine
from src.mapping import (
    MappingGroup,
    apply_mapping_value,
    build_mapping,
    build_mapping_from_wide,
    dump_mapping_json,
    load_mapping_json,
)
from src.matching.join_engine import analyze_cardinality
from src.matching.key_builder import add_key_columns
from src.models.config import ComparisonConfig, DatasetConfig, KeyMappingConfig, KeyNormalizationOptions
from src.profiling import profile_duplicates
from src.templates import apply_column_remap, dump_template, load_template


def groups_payload() -> dict[str, list[str]]:
    return {
        "DUNS": ["빨강", "파랑", "노랑", "주황", "초록"],
        "고구마": ["수박", "파도", "비행", "땅"],
    }


def mapping_config() -> KeyMappingConfig:
    return KeyMappingConfig(name="테스트", enabled=True, groups=groups_payload())


def test_wide_mapping_accepts_arbitrary_headers_selected_canonical_and_multiple_aliases():
    frame = pd.DataFrame({
        "업체": ["DUNS", "고구마"],
        "다른이름": ["빨강", "수박"],
        "구명칭": ["파랑", "파도"],
        "약칭": ["노랑", None],
    })
    result = build_mapping_from_wide(frame, "업체", ["다른이름", "구명칭", "약칭"], KeyNormalizationOptions())

    assert result.applicable
    assert result.alias_to_canonical["DUNS"] == "DUNS"
    assert result.alias_to_canonical["빨강"] == "DUNS"
    assert result.alias_to_canonical["파도"] == "고구마"
    assert result.stats["canonical_count"] == 2
    assert result.stats["empty_alias_cell_count"] == 1


def test_all_noncanonical_columns_can_be_used_as_aliases_and_row_alias_counts_vary():
    frame = pd.DataFrame({"기준명": ["A", "B"], "명칭A": ["a1", "b1"], "명칭B": [None, "b2"], "명칭C": [None, "b3"]})
    result = build_mapping_from_wide(frame, "기준명", [], KeyNormalizationOptions(), use_all_other_columns=True)

    assert result.alias_to_canonical == {"A": "A", "a1": "A", "B": "B", "b1": "B", "b2": "B", "b3": "B"}
    assert result.stats["empty_alias_cell_count"] == 2


@pytest.mark.parametrize(("raw", "expected", "applied"), [
    (" 빨강 ", "DUNS", True),
    ("보라", "보라", False),
    (None, None, False),
])
def test_mapping_runs_after_normalization_and_keeps_unmapped_values(raw, expected, applied):
    options = KeyNormalizationOptions(trim=True)
    result = build_mapping([MappingGroup("DUNS", ("빨강",))], options)
    application = apply_mapping_value(raw, options, result)

    assert application.standard == expected
    assert application.applied is applied
    assert application.original == raw


def test_case_insensitive_normalization_maps_and_detects_conflicts():
    options = KeyNormalizationOptions(case_insensitive=True)
    valid = build_mapping([MappingGroup("DUNS", ("ABC",))], options)
    assert apply_mapping_value("abc", options, valid).standard == "duns"

    conflict = build_mapping([MappingGroup("DUNS", ("ABC",)), MappingGroup("OTHER", ("abc",))], options)
    assert not conflict.applicable
    assert any(issue.code in {"ALIAS_CONFLICT", "NORMALIZED_ALIAS_CONFLICT"} for issue in conflict.issues)


def test_alias_collision_and_canonical_used_as_other_alias_are_blocking():
    alias_conflict = build_mapping([MappingGroup("DUNS", ("비행",)), MappingGroup("고구마", ("비행",))], KeyNormalizationOptions())
    assert not alias_conflict.applicable
    assert next(issue for issue in alias_conflict.issues if issue.severity == "error").canonicals == ("DUNS", "고구마")

    canonical_conflict = build_mapping([MappingGroup("DUNS", ("빨강",)), MappingGroup("ABC", ("DUNS",))], KeyNormalizationOptions())
    assert not canonical_conflict.applicable
    assert any(issue.code == "CANONICAL_ALIAS_CONFLICT" for issue in canonical_conflict.issues)


def test_quality_diagnostics_distinguish_warnings_and_errors():
    result = build_mapping([
        MappingGroup("DUNS", ("빨강", "", None), 2),
        MappingGroup("DUNS", ("빨강", "", None), 3),
        MappingGroup("고구마", (), 4),
        MappingGroup("", ("무시",), 5),
    ], KeyNormalizationOptions())

    codes = {issue.code for issue in result.issues}
    assert {"DUPLICATE_ALIAS", "DUPLICATE_ROW", "ALIASLESS_GROUP", "EMPTY_CANONICAL"} <= codes
    assert result.stats["empty_alias_cell_count"] == 4
    assert result.stats["duplicate_row_count"] == 1
    assert result.applicable


def test_direct_groups_json_save_and_load_round_trip():
    groups = [MappingGroup("DUNS", ("빨강", "파랑")), MappingGroup("고구마", ("수박",))]
    payload = dump_mapping_json(groups)
    loaded = load_mapping_json(payload)

    assert json.loads(payload) == {"DUNS": ["빨강", "파랑"], "고구마": ["수박"]}
    assert loaded == [MappingGroup("DUNS", ("빨강", "파랑"), 1), MappingGroup("고구마", ("수박",), 2)]


def test_composite_key_maps_only_selected_column_and_preserves_trace():
    frame = pd.DataFrame({"company": [" 빨강 ", "보라"], "region": ["서울", "부산"]})
    keyed = add_key_columns(frame, ["company", "region"], KeyNormalizationOptions(), {"company": mapping_config()})

    assert keyed["__key_tuple"].tolist() == [("DUNS", "서울"), ("보라", "부산")]
    assert keyed["__key_original_tuple"].tolist()[0] == (" 빨강 ", "서울")
    assert keyed["__key_normalized_tuple"].tolist()[0] == ("빨강", "서울")
    assert keyed["__key_mapping_applied"].tolist()[0] == (True, False)


def keyed(values: list[str]) -> pd.DataFrame:
    return add_key_columns(pd.DataFrame({"key": values, "value": range(len(values))}), ["key"], KeyNormalizationOptions(), {"key": mapping_config()})


@pytest.mark.parametrize(("left", "right", "kind"), [
    (["빨강"], ["초록"], "ONE_TO_ONE"),
    (["DUNS"], ["빨강", "파랑"], "ONE_TO_MANY"),
    (["빨강", "파랑"], ["DUNS"], "MANY_TO_ONE"),
    (["빨강", "파랑"], ["DUNS", "초록"], "MANY_TO_MANY"),
])
def test_mapping_drives_one_to_one_and_duplicate_cardinality(left, right, kind):
    cardinalities = analyze_cardinality(keyed(left), keyed(right))
    assert len(cardinalities) == 1
    assert cardinalities[0].kind == kind


def test_duplicate_profile_uses_final_standard_key():
    frame = keyed(["빨강", "파랑"])
    profile = profile_duplicates(frame, ["key"])

    assert profile.duplicate_keys == {("DUNS",)}
    assert profile.max_count == 2


def test_nm_comparison_remains_blocked_without_cartesian_product():
    left = keyed(["빨강", "파랑"])
    right = keyed(["DUNS", "초록"])
    config = ComparisonConfig(DatasetConfig("a.csv", "csv", key_columns=["key"]), DatasetConfig("b.csv", "csv", key_columns=["key"]), nm_policy="error")

    rows = ComparisonEngine().compare(left, right, config)

    assert len(rows) == 1
    assert rows[0].status == "N:M 처리 필요"
    assert rows[0].a_count == 2 and rows[0].b_count == 2


def test_mapping_disabled_is_identical_to_previous_key_builder_behavior():
    frame = pd.DataFrame({"key": [" A ", "b", None]})
    options = KeyNormalizationOptions(case_insensitive=True)

    previous = add_key_columns(frame, ["key"], options)
    disabled = add_key_columns(frame, ["key"], options, {"key": KeyMappingConfig(enabled=False, groups=groups_payload())})

    assert previous["__key_tuple"].tolist() == disabled["__key_tuple"].tolist()


def test_comparison_template_preserves_and_remaps_mapping_settings():
    mapping = mapping_config()
    config = ComparisonConfig(
        DatasetConfig("a.csv", "csv", key_columns=["old_a"], key_mappings={"old_a": mapping}),
        DatasetConfig("b.csv", "csv", key_columns=["old_b"], key_mappings={"old_b": mapping}),
    )

    loaded = load_template(dump_template(config))
    remapped = apply_column_remap(loaded, {"old_a": "new_a", "old_b": "new_b"})

    assert remapped.dataset_a.key_mappings["new_a"].groups == groups_payload()
    assert remapped.dataset_b.key_mappings["new_b"].enabled
