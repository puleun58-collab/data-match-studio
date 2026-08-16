class DataCompareError(Exception):
    """Expected, user-facing application error."""


class FileValidationError(DataCompareError):
    pass


class ConfigurationError(DataCompareError):
    pass


class ComparisonError(DataCompareError):
    pass
