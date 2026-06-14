# 서울형 키즈카페 / 서울미래아이 콘텐츠 지도 MVP

서울형 키즈카페 지점 정보를 크롤링해 `JSON`으로 저장하고, Leaflet + OpenStreetMap 기반 정적 웹페이지로 보여주는 프로젝트입니다. 서버 없이 동작하는 정적 구조이며, 저장소 루트에서 바로 GitHub Pages 배포가 가능하도록 구성했습니다.

추가로 `서울미래아이 365` PDF 기반의 어린이 박물관·체험 콘텐츠 지도 초안을 `museums/` 경로에 분리해 두었습니다. 키즈카페와 박물관·체험을 함께 탐색하는 통합 실험 페이지는 `explore/` 경로에 별도로 둡니다.

현재는 아래 두 카테고리를 함께 수집합니다.

- `일반형 키즈카페`
- `여기저기 키즈카페`

웹페이지에서는 아래 탐색 기능을 제공합니다.

- 검색어 필터
- 자치구 필터
- 연령 다중 선택 필터
- 주말 운영 요일 필터
- 모바일 지도 / 목록 전환
- 지도 마커 팝업 내 이미지 / 정보 전환
- 카드 내 `이용안내` / `예약페이지` 링크

현재 저장된 데이터 기준:

- 총 `155`개 지점
- 서울 `25`개 자치구 커버
- 위경도 누락 `0`건

## 프로젝트 구조

```text
.
├─ index.html
├─ crawler/
│  ├─ crawler.py
│  ├─ enrich_geocode.py
│  ├─ enrich_museums.py
│  └─ requirements.txt
├─ data/
│  ├─ kids_cafes_raw.csv
│  ├─ kids_cafes.csv
│  ├─ kids_cafes.json
│  ├─ museums_seed.csv
│  ├─ museums.csv
│  ├─ museums.json
│  ├─ geocode_cache.json
│  └─ geocode_failures.csv
├─ museums/
│  ├─ index.html
│  ├─ style.css
│  └─ script.js
├─ explore/
│  ├─ index.html
│  ├─ style.css
│  └─ script.js
├─ web/
│  ├─ index.html
│  ├─ style.css
│  └─ script.js
├─ README.md
└─ .gitignore
```

## 실행 방법

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r crawler/requirements.txt
```

## 크롤링 방법

목록 페이지와 상세 `이용안내` 페이지를 함께 요청해 아래 정보를 수집합니다.

- 지점명, 자치구, 주소, 전화번호
- 이용연령, 이용정원
- 대표 이미지, 예약 링크, 이용안내 링크
- 운영기간, 운영일, 휴관일
- 토요일/일요일 운영 여부
- 주차 가능 여부와 주차 안내 문구
- 카드에 표시할 주요 특징 요약

```bash
python crawler/crawler.py
```

생성 결과:

- `data/kids_cafes_raw.csv`
- `data/kids_cafes.json`

원본 사이트 구조가 바뀌면 CSS 선택자 보정이 필요할 수 있습니다.

## JSON 생성 및 위경도 보강

현재 크롤러는 각 지점의 `오시는길` 페이지에서 좌표를 직접 추출합니다. `enrich_geocode.py`는 좌표 누락 시 보정용 안전장치 역할을 합니다.

```bash
python crawler/enrich_geocode.py
```

생성 결과:

- `data/kids_cafes.csv`
- `data/kids_cafes.json`
- `data/geocode_cache.json`
- `data/geocode_failures.csv`

## 로컬 미리보기 방법

정적 서버로 프로젝트 루트에서 실행하는 방식을 권장합니다.

```bash
python -m http.server 8000
```

브라우저에서 `http://localhost:8000/web/` 접속

모바일 화면에서는 상단 토글로 `지도` / `목록`을 전환할 수 있습니다.

박물관·체험 지도 초안은 아래 경로로 접속합니다.

```text
http://localhost:8000/museums/
```

키즈카페와 박물관·체험 통합 실험 페이지는 아래 경로로 접속합니다.

```text
http://localhost:8000/explore/
```

GitHub Pages 배포 후에는 아래 경로에서 볼 수 있습니다.

```text
https://jaybleee.github.io/seoulkidscafe/museums/
https://jaybleee.github.io/seoulkidscafe/explore/
```

## GitHub Pages 배포 방법

1. 저장소를 GitHub에 push 합니다.
2. GitHub Pages의 배포 소스를 저장소 루트로 설정합니다.
3. 배포 후 루트 `index.html`이 자동으로 `web/`로 이동시켜 줍니다.

간단한 배포 방식 예시:

- 저장소 루트 그대로 배포 가능한 정적 호스팅 사용
- GitHub Pages에서 브랜치 루트를 그대로 공개
- 필요 시 `web/`와 `data/`를 함께 `gh-pages` 브랜치에 복사 배포

## 데이터 갱신 방법

1. `python crawler/crawler.py`
2. `python crawler/enrich_geocode.py`
3. `data/kids_cafes.json` 갱신 확인
4. 정적 페이지 재배포

비개발자 협업을 위해 주소 컬럼은 CSV에도 유지되며, 위경도는 `kids_cafes.csv`에서 수동 보정 가능합니다.

박물관·체험 지도 데이터는 아래 명령으로 갱신합니다.

```bash
python crawler/enrich_museums.py
```

생성 결과:

- `data/museums.csv`
- `data/museums.json`
- `data/museum_geocode_cache.json`
- `data/museum_naver_location_cache.json`

## 주요 데이터 필드

최종 `kids_cafes.json`에는 기존 기본 정보 외에도 다음 필드가 포함됩니다.

- `cafe_type`: 일반형 / 여기저기 구분
- `detail_url`: 이용안내 상세 페이지
- `operation_period`: 운영기간
- `operation_days`: 운영일
- `closed_days`: 휴관일
- `feature_summary`: 카드용 주요 특징 요약
- `open_saturday`, `open_sunday`: 토/일 운영 여부
- `parking_available`: 주차 가능 여부
- `parking_info`: 주차 안내 문구

## 한계 사항

- 원본 서울형 키즈카페 사이트 구조가 변경되면 크롤러 수정이 필요합니다.
- 이미지 링크는 페이지 구조에 따라 일부 누락될 수 있습니다.
- 무료 지오코딩은 속도와 정확도 한계가 있으며 호출 제한이 있을 수 있습니다.
- 현재는 MVP 범위만 반영되어 마커 클러스터링, 상세 모달, 자동 스케줄 실행은 포함하지 않았습니다.
