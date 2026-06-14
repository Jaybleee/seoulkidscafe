# 서울 박물관 지도 데이터 구축 계획

## 목표

`data/museums_seed.csv`를 기초 데이터로 사용해 서울형 키즈카페 지도와 같은 정적 Leaflet 웹사이트를 만든다. 1차 PDF 필드는 보존하고, 주소/웹사이트/좌표/최신 운영정보는 공식 웹사이트 또는 신뢰 가능한 공공 API로 보강한다.

현재 seed는 PDF의 9개 주제별 목록 전체 75개 콘텐츠를 포함한다.

- 시간여행자 17개
- 호기심박사 12개
- 미래탐험대 10개
- 창의예술가 8개
- 생태탐험가 8개
- 안전지킴이 7개
- 쑥쑥성장대장 5개
- 스포츠마스터 5개
- 이야기수집가 3개

초안 지도 데이터는 아래 정책을 적용해 `data/museums.json`으로 생성한다.

- `금융감독원 e-금융교육센터`: 온라인 전용 콘텐츠라 지도 후보에서 제외
- `서울형 키즈카페`: 기존 키즈카페 지도와 중복되는 대량 시설이라 제외
- `청소년경찰학교(서울)`: 11개 자치구 시설로 확장
- 결과: 지도 후보 83개

초안 사이트는 `/museums/` 경로에 둔다.

위치 보강 상태:

- OSM/Nominatim 지오코딩: 38개
- 네이버 검색 결과 좌표 보강: 34개
- 청소년경찰학교 관할 경찰서 대표 위치: 11개
- 자치구 중심 임시 좌표: 0개

## 1차 PDF 수집 필드

- `name`: PDF에 나온 기관명/콘텐츠명
- `theme`: PDF 주제 분류
- `keyword`: PDF 키워드
- `district`: PDF 지역
- `recommended_age`: PDF 권장연령
- `fee`: PDF 이용요금
- `pdf_operating_days`: PDF 운영요일
- `source_pdf_page`: PDF 표 페이지
- `notes`: OCR/시각 검수 메모

## 주소/웹사이트 보강 전략

1. 기관명 정규화
   - 괄호, 지점명, 띄어쓰기 변형을 보존하되 검색용 `search_name`을 별도 생성한다.
   - 예: `국립극장공연예술박물관(서울)` → 검색명 `국립극장 공연예술박물관 서울`.

2. 1순위: 공식 사이트 직접 검색
   - 검색 쿼리: `"{기관명}" 공식`, `"{기관명}" 주소`, `"{기관명}" 관람안내`.
   - 공식 도메인 후보를 우선 채택한다.
   - 수집 필드: `website_url`, `address`, `phone`, `opening_hours_text`, `closed_days_text`, `fee_detail`, `reservation_url`.

3. 2순위: 서울 열린데이터/문화포털/공공기관 API
   - 서울시 문화공간, 공공서비스예약, 문화포털 등 공공 데이터에서 주소와 좌표를 교차 확인한다.
   - 공식 사이트 주소와 공공 데이터 주소가 다르면 `verification_status=needs_review`로 표시한다.

4. 3순위: 지도 지오코딩
   - 주소가 확보된 뒤 Nominatim 또는 공공 주소 API로 `lat/lng`를 보강한다.
   - 키즈카페 프로젝트처럼 `data/geocode_cache.json` 형태의 캐시를 둔다.

## 크롤러 구조 제안

- `crawler/museum_seed.py`
  - PDF seed CSV 로드, 기관명 정규화, 중복 후보 정리.
- `crawler/museum_crawler.py`
  - 공식 사이트/공공데이터 보강.
  - 결과: `data/museums_raw.csv`.
- `crawler/enrich_museum_geocode.py`
  - 주소 기반 좌표 보강.
  - 결과: `data/museums.csv`, `data/museums.json`.
- `web/`
  - 기존 키즈카페 Leaflet UI를 재사용하되 필터를 박물관용으로 변경.
  - 필터: 키워드, 지역, 권장연령, 요금, 운영요일, 주제.

## 검수 규칙

- PDF 운영요일은 참고값으로 유지하고, 지도 표시 기본값은 공식 사이트 최신 운영정보를 우선한다.
- 공식 사이트에서 확인한 운영요일이 PDF와 다르면 `pdf_mismatch=true`와 차이 내용을 남긴다.
- 온라인 전용 또는 다지점 기관은 지도 표시 정책을 따로 정한다.
  - 예: `금융감독원 e-금융교육센터`는 지도 제외 또는 온라인 콘텐츠로 별도 표시.
  - 예: `서울시립미술관`은 대표관/분관을 분리할지 결정 필요.

## 최종 JSON 필드 초안

```json
{
  "id": "seoul-craft-museum",
  "name": "서울공예박물관",
  "theme": "창의예술가",
  "keyword": "창작공예",
  "district": "종로구",
  "recommended_age": ["유아", "초등"],
  "fee": "일부유료",
  "pdf_operating_days": ["월", "화", "수", "목", "금", "토", "일"],
  "address": "",
  "lat": "",
  "lng": "",
  "website_url": "",
  "reservation_url": "",
  "opening_hours_text": "",
  "closed_days_text": "",
  "source_pdf_page": 14,
  "verification_status": "seed"
}
```
