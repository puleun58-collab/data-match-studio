# 범용 데이터 비교 스튜디오

임의의 XLSX/XLSM/CSV 두 개를 사용자가 지정한 키와 비교 규칙으로 분석하는 Streamlit 웹앱입니다. 상품·주문·고객·재고·인사·회계 등 특정 업무나 파일명에 종속되지 않습니다.

## 구현 범위

- XLSX, XLSM, CSV 업로드 및 Excel 시트 선택
- 헤더 행·데이터 시작 행 직접 지정, 헤더 후보 미리보기
- CSV 인코딩·구분자 선택
- 중복 컬럼명, 빈 컬럼명, 특수문자 컬럼을 내부 ID와 Excel 열 문자로 관리
- 단일 키·복합 키 및 양쪽 서로 다른 컬럼명 매핑
- 앞뒤 공백, 공백·대소문자·줄바꿈·유니코드·`.0` 정규화
- 전체 외부/왼쪽/오른쪽/내부 조인
- 문자, 숫자, 날짜/시간, 불리언, 숫자+단위 비교
- 반올림·절대/상대/백분율 허용 오차, 빈값 정책
- 원본값·정규화값·비교 방식·변환 성공 여부·불일치 사유 추적
- 중복 키 프로파일링 및 카테고리별 1:1, 1:N, N:1 처리
- N:M 카테시안 곱 차단 및 집합·멀티셋·집계·대표 행 정책
- 결과 검색·상태 필터, CSV/XLSX 다운로드
- 10개 결과 시트, 설정 시트, 요약 시트
- JSON 템플릿 저장/불러오기
- 순수 Python 비교 엔진과 Streamlit UI 분리

## 기술적 가정과 안전성

- 업로드 파일은 `BytesIO`로 읽고 애플리케이션에서 영구 저장하지 않습니다.
- 파일 내용이나 사용자 값은 로그에 기록하지 않습니다.
- openpyxl은 수식을 계산하거나 매크로를 실행하지 않습니다. `.xlsm`도 데이터만 읽습니다.
- 암호화·손상 파일, 미지원 확장자, 잘못된 헤더는 stack trace 대신 사용자 오류로 표시합니다.
- 병합 셀은 빈 셀로 해석될 수 있으므로 상위 행 미리보기와 헤더 직접 지정으로 확정합니다.
- N:M은 명시적 정책 없이 결과를 생성하지 않습니다. 따라서 단순 조인에 의한 카테시안 폭증이 없습니다.
- 1:N/N:1은 기본 차단이며 화면에서 행별 비교 허용을 명시해야 합니다.
- 기본 MVP는 pandas를 사용하지만, 엔진 입력/출력 경계가 DataFrame과 typed config로 분리되어 후속 Polars 어댑터를 추가할 수 있습니다.

## 구조

```text
app.py                         # Streamlit UI와 세션 상태
src/models/                    # dataclass 설정·결과 모델
src/loaders/                   # Excel/CSV 메모리 로더
src/profiling/                 # 헤더·유형·품질·중복 분석
src/normalization/             # 키·문자·숫자·날짜·결측 정규화
src/matching/                  # 카디널리티·집합·멀티셋·집계
src/comparison/                # 순수 비교 엔진과 비교기
src/export/                    # CSV/XLSX 내보내기
src/templates/                 # JSON 템플릿
src/common/                    # 상수·검증·예외
tests/                         # pytest 테스트
sample_data/                   # 범용 샘플 생성기
```

## 로컬 실행

Python 3.11 이상을 사용합니다.

```bash
python -m venv .venv
# Windows PowerShell
.\.venv\Scripts\Activate.ps1
# macOS/Linux
# source .venv/bin/activate
python -m pip install -r requirements.txt
streamlit run app.py
```

브라우저에서 `http://localhost:8501`을 엽니다.

## 테스트

```bash
pytest -q
```

샘플 파일 생성:

```bash
python sample_data/generate_samples.py
```

이 저장소의 실행 환경에 Python 런타임이 설치되어 있지 않으면 테스트를 실행할 수 없으며, 의존성 설치 후 위 명령을 실행해야 합니다.

## Docker

```bash
docker build -t data-compare-app .
docker run --rm -p 8501:8501 data-compare-app
```

## 결과 판정

행 결과에는 다음이 포함됩니다.

- 키 및 A/B 키 발생 건수
- A/B 원본값과 정규화값
- 동일/불일치/누락/빈 키/변환 실패 상태
- 숫자 차이·절대 차이·차이율
- 비교 방식 및 중복 처리 방식
- N:M 집합·멀티셋·집계 상세

일치율은 비교 가능한 결과 중 동일 결과의 비율이며, 키 누락·중복 오류·N:M 처리 필요·비교 불가·변환 실패는 제외합니다.

## 향후 확장

MVP 이후 `.xls`, TSV, parquet, Google Sheets, 데이터베이스 어댑터, 단위 환산, N:M 최적 매칭, 컬럼 유사도 추천, 페이지네이션 전용 결과 저장소를 추가할 수 있습니다. 현재 자동 단위 환산, 계정/권한, 서버 이력, 예약 실행은 포함하지 않습니다.
