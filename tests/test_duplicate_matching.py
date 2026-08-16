import pandas as pd

from src.matching.aggregation_matcher import compare_aggregates
from src.matching.join_engine import analyze_cardinality, cardinality_summary
from src.matching.multiset_matcher import compare_multisets
from src.matching.set_matcher import compare_sets
from src.profiling.duplicate_profiler import profile_duplicates


def keyed(values):
    return pd.DataFrame(values, columns=["__key_tuple", "value"])


def test_duplicate_profile_and_cardinality():
    a = keyed([(("x",), 1), (("x",), 2), (("y",), 3)])
    b = keyed([(("x",), 1), (("z",), 4)])
    profile_frame = pd.DataFrame({"key": ["x", "x", "y"], "value": [1, 2, 3]})
    profile = profile_duplicates(profile_frame, ["key"], ["value"])
    assert profile.duplicate_keys == {("x",)}
    summary = cardinality_summary(analyze_cardinality(a, b))
    assert summary["1:N"] == 1
    assert summary["N:1"] == 0


def test_set_and_multiset_details():
    assert compare_sets([1, 1, 2], [2, 1])["equal"]
    detail = compare_multisets([1, 1, 2], [1, 2])
    assert not detail["equal"]
    assert detail["differences"][1]["difference"] == 1


def test_aggregate_methods():
    left = pd.Series([1, 2, 3])
    right = pd.Series([6])
    assert compare_aggregates(left, right, "sum")["equal"]
    assert compare_aggregates(left, pd.Series([3]), "max")["equal"]
    assert compare_aggregates(left, pd.Series([2]), "mean")["equal"]
