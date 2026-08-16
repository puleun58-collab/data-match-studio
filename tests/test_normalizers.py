from src.models.config import KeyNormalizationOptions
from src.normalization.date_normalizer import normalize_date
from src.normalization.number_normalizer import normalize_number
from src.normalization.text_normalizer import normalize_text


def test_text_options():
    options = KeyNormalizationOptions(trim=True, collapse_spaces=True, case_insensitive=True)
    assert normalize_text("  A\n  B ", options) == "a b"


def test_number_currency_units_and_parentheses():
    assert normalize_number("₩1,000원") == 1000
    assert normalize_number("(1,200)") == -1200
    assert normalize_number("11.5 ton", {"extract_number": True}) == 11.5


def test_dates_support_common_formats():
    assert normalize_date("2026-08-16", "date").isoformat() == "2026-08-16"
    assert normalize_date("2026/08/16", "date").isoformat() == "2026-08-16"
    assert normalize_date("2026년 8월 16일", "date").isoformat() == "2026-08-16"
    assert normalize_date("2026-08-16 12:30", "year_month") == (2026, 8)
