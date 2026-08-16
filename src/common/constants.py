SUPPORTED_EXTENSIONS = {".xlsx", ".xlsm", ".csv"}
JOIN_TYPES = {"outer", "left", "right", "inner"}
DATA_TYPES = {"text", "number", "date", "datetime", "boolean", "unit_number", "mixed"}
STATUSES = {
    "모두 동일",
    "일부 항목 불일치",
    "모든 항목 불일치",
    "데이터셋 A에만 존재",
    "데이터셋 B에만 존재",
    "중복 키",
    "중복 키 · 값 동일",
    "중복 키 · 값 상이",
    "1:N 비교",
    "N:1 비교",
    "N:M 처리 필요",
    "빈 키",
    "비교 불가",
    "형식 변환 실패",
}
