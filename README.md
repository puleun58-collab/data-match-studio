# Data Match Studio

Excel/CSV 파일과 워크시트를 키 기준으로 비교하는 데이터 비교 앱입니다. 파일명·시트명·컬럼명을 하드코딩하지 않으며, 업로드한 데이터는 브라우저 밖으로 전송하거나 저장하지 않습니다.

## 배포 주소

**https://data-match-studio.vercel.app**

## 주요 기능

- XLSX/CSV/TSV 파일 비교
- 같은 Excel 파일의 서로 다른 시트 비교
- 양쪽 시트의 키 컬럼과 비교 컬럼을 각각 매핑
- 단일·복합 키와 중복 키 처리
- N:M 카테시안 곱 차단 및 집합·멀티셋·집계·대표 행 정책
- 문자·숫자·날짜·불리언 비교와 빈 값 처리
- 결과 요약, 원본/정규화 값 추적, CSV/JSON/XLSX 다운로드
- 비교 설정 템플릿 저장/불러오기

## 브라우저 사용 시 참고

- XLSX 수식은 실행하지 않고 Excel에 저장된 캐시 결과값을 읽습니다. 캐시값이 없으면 빈 값으로 처리될 수 있습니다.
- 매크로가 포함된 XLSM, 암호화 파일, 손상된 파일, ZIP64는 브라우저에서 거부합니다.
- 대용량 파일은 브라우저 자원 한도에 따라 거부될 수 있습니다.
- 여러 시트를 비교하려면 같은 파일을 양쪽에 업로드한 뒤 각각 다른 시트를 선택합니다.

## 로컬 Streamlit 실행

Python 3.11 이상이 필요합니다.

```bash
python -m venv .venv
# Windows PowerShell
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
streamlit run app.py
```

브라우저에서 `http://localhost:8501`을 엽니다. 로컬 실행 경로는 XLSM과 비 UTF-8 CSV 등 브라우저에서 제한되는 파일을 처리할 때 사용합니다.

## 브라우저 앱 개발

Node.js 20 이상이 필요합니다.

```bash
npm install
npm run dev
```

## 검증

```bash
python -m pytest -q
npm test
npm run typecheck
npm run static-export
```

## Docker

```bash
docker build -t data-match-studio .
docker run --rm -p 8501:8501 data-match-studio
```

## 개인정보 및 배포 구조

Vercel 앱은 정적 Next.js 애플리케이션입니다. API Route, Server Action, 파일 업로드 서버, 데이터베이스를 사용하지 않으며 파일은 `File`/`ArrayBuffer`로 브라우저 안에서만 처리됩니다.
