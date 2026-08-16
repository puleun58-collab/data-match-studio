from src.models.config import ComparisonConfig, ComparisonRule, DatasetConfig, DuplicatePolicy
from src.templates import apply_column_remap, dump_template, load_template, remap_columns


def test_template_v2_round_trip_and_atomic_remap():
    config = ComparisonConfig(
        DatasetConfig("a.csv", "csv", key_columns=["a_old"]),
        DatasetConfig("b.csv", "csv", key_columns=["b_old"]),
        duplicate_policy_a=DuplicatePolicy("A", representative_sort_column="sort_old"),
        comparison_rules=[ComparisonRule("r1", "Value", "a_old", "b_old")],
    )
    payload = dump_template(config, {"A": {"a_old": "Code"}, "B": {"b_old": "Code"}})
    loaded = load_template(payload)
    assert loaded.dataset_a.key_columns == ["a_old"]
    remapped, diagnostics = remap_columns(
        [{"id": "a_old", "side": "A", "normalized_name": "code", "occurrence": 0}],
        [{"id": "a_new", "side": "A", "normalized_name": "code", "occurrence": 0}],
    )
    assert not diagnostics
    applied = apply_column_remap(config, remapped)
    assert applied.dataset_a.key_columns == ["a_new"]
    assert config.dataset_a.key_columns == ["a_old"]


def test_ambiguous_remap_is_not_applied():
    mapping, diagnostics = remap_columns(
        [{"id": "old", "side": "A", "normalized_name": "code"}],
        [
            {"id": "new1", "side": "A", "normalized_name": "code"},
            {"id": "new2", "side": "A", "normalized_name": "code"},
        ],
    )
    assert mapping == {}
    assert diagnostics
