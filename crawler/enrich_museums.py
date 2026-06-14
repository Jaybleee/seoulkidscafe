from __future__ import annotations

import csv
import html
import json
import re
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urljoin, urlparse
from urllib.request import Request, urlopen


ROOT_DIR = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT_DIR / "data"
SEED_PATH = DATA_DIR / "museums_seed.csv"
JSON_PATH = DATA_DIR / "museums.json"
CSV_PATH = DATA_DIR / "museums.csv"
GEOCODE_CACHE_PATH = DATA_DIR / "museum_geocode_cache.json"
NAVER_LOCATION_CACHE_PATH = DATA_DIR / "museum_naver_location_cache.json"

USER_AGENT = "seoul-kids-map-draft/0.1 (local data enrichment)"
REQUEST_PAUSE_SECONDS = 1.05
TIMEOUT = 18
SEOUL_CENTER = (37.5665, 126.9780)

EXCLUDED_NAMES = {
    "금융감독원 e-금융교육센터": "온라인 전용 콘텐츠",
    "서울형 키즈카페": "기존 키즈카페 지도와 중복되는 대량 시설",
}

DISTRICT_CENTROIDS = {
    "종로구": (37.5735, 126.9788),
    "중구": (37.5636, 126.9976),
    "용산구": (37.5326, 126.9905),
    "성동구": (37.5634, 127.0369),
    "광진구": (37.5384, 127.0822),
    "동대문구": (37.5744, 127.0396),
    "중랑구": (37.6063, 127.0925),
    "성북구": (37.5894, 127.0167),
    "강북구": (37.6396, 127.0257),
    "도봉구": (37.6688, 127.0471),
    "노원구": (37.6542, 127.0568),
    "은평구": (37.6027, 126.9291),
    "서대문구": (37.5791, 126.9368),
    "마포구": (37.5663, 126.9019),
    "양천구": (37.5170, 126.8665),
    "강서구": (37.5509, 126.8495),
    "구로구": (37.4955, 126.8877),
    "금천구": (37.4569, 126.8955),
    "영등포구": (37.5264, 126.8962),
    "동작구": (37.5124, 126.9393),
    "관악구": (37.4784, 126.9516),
    "서초구": (37.4837, 127.0324),
    "강남구": (37.5172, 127.0473),
    "송파구": (37.5145, 127.1059),
    "강동구": (37.5301, 127.1238),
}

YOUTH_POLICE_SCHOOLS = [
    ("강동 청소년경찰학교", "안전지킴이", "사회질서", "강동구"),
    ("강북 청소년경찰학교", "안전지킴이", "사회질서", "강북구"),
    ("강서 청소년경찰학교", "안전지킴이", "사회질서", "강서구"),
    ("관악 청소년경찰학교", "안전지킴이", "사회질서", "관악구"),
    ("광진 청소년경찰학교", "안전지킴이", "사회질서", "광진구"),
    ("구로 청소년경찰학교", "안전지킴이", "사회질서", "구로구"),
    ("노원 청소년경찰학교", "안전지킴이", "사회질서", "노원구"),
    ("도봉 청소년경찰학교", "안전지킴이", "사회질서", "도봉구"),
    ("동작 청소년경찰학교", "안전지킴이", "사회질서", "동작구"),
    ("서초 청소년경찰학교", "안전지킴이", "사회질서", "서초구"),
    ("송파 청소년경찰학교", "안전지킴이", "사회질서", "송파구"),
]

POLICE_STATION_QUERIES = {
    "강동구": "서울강동경찰서 주소",
    "강북구": "서울강북경찰서 주소",
    "강서구": "서울강서경찰서 주소",
    "관악구": "서울관악경찰서 주소",
    "광진구": "서울광진경찰서 주소",
    "구로구": "서울구로경찰서 주소",
    "노원구": "서울노원경찰서 주소",
    "도봉구": "서울도봉경찰서 주소",
    "동작구": "서울동작경찰서 주소",
    "서초구": "서울서초경찰서 주소",
    "송파구": "서울송파경찰서 주소",
}

NAVER_QUERY_OVERRIDES = {
    "유니세프 어린이지구촌체험관": ["유니세프한국위원회 주소"],
    "구로재난안전체험장": ["구로구 안전체험관 주소", "구로소방서 주소"],
}

OFFICIAL_URL_OVERRIDES = {
    "국립고궁박물관": "https://www.gogung.go.kr/",
    "국립대한민국임시정부기념관": "https://www.nmkpg.go.kr/",
    "국립민속박물관 어린이박물관": "https://www.nfm.go.kr/kids/",
    "국립중앙박물관 어린이박물관": "https://www.museum.go.kr/site/child/home",
    "서대문형무소역사관": "https://sphh.sscmc.or.kr/",
    "서울교육박물관": "https://edumuseum.sen.go.kr/",
    "서울기록원": "https://archives.seoul.go.kr/",
    "서울백제어린이박물관": "https://baekjemuseum.seoul.go.kr/dreamvillage/",
    "서울생활사박물관": "https://museum.seoul.go.kr/sulm/index.do",
    "서울약령시 한의약박물관": "https://museum.ddm.go.kr/",
    "서울역사박물관 어린이박물관": "https://museum.seoul.go.kr/",
    "용산역사박물관": "https://museum.yongsan.go.kr/",
    "은평역사한옥박물관": "https://museum.ep.go.kr/",
    "전쟁기념관 어린이박물관": "https://www.warmemo.or.kr/kids/",
    "청계천박물관": "https://museum.seoul.go.kr/cgcm/index.do",
    "한양도성박물관": "https://museum.seoul.go.kr/scwm/index.do",
    "허준박물관": "https://www.heojunmuseum.go.kr/",
    "국립항공박물관": "https://www.aviation.or.kr/",
    "국립어린이과학관": "https://www.csc.go.kr/",
    "서대문자연사박물관": "https://namu.sdm.go.kr/",
    "서울시립과학관": "https://science.seoul.go.kr/",
    "서울에너지드림센터": "https://seouledc.or.kr/",
    "서울하수도과학관": "https://sssmuseum.org/",
    "국회박물관": "https://museum.assembly.go.kr/",
    "한국은행 화폐박물관": "https://www.bok.or.kr/museum/",
    "국립현대미술관 서울": "https://www.mmca.go.kr/",
    "서울공예박물관": "https://craftmuseum.seoul.go.kr/",
    "서울시립미술관": "https://sema.seoul.go.kr/",
    "서울우리소리박물관": "https://gomuseum.seoul.go.kr/",
    "서울식물원": "https://botanicpark.seoul.go.kr/",
    "서울상상나라": "https://www.seoulchildrensmuseum.org/",
    "송파책박물관": "https://www.bookmuseum.go.kr/",
    "신문박물관 PRESSEUM": "https://www.presseum.or.kr/",
}


@dataclass
class Museum:
    id: str
    name: str
    theme: str
    keyword: str
    district: str
    recommended_age: list[str]
    fee: str
    pdf_operating_days: list[str]
    address: str
    lat: float | None
    lng: float | None
    website_url: str
    image_url: str
    source_pdf_page: str
    source_type: str
    verification_status: str
    notes: str


def slugify(value: str) -> str:
    cleaned = re.sub(r"[^0-9A-Za-z가-힣]+", "-", value).strip("-")
    return cleaned.lower() or "museum"


def read_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, data: Any) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def request_json(url: str) -> Any:
    req = Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    with urlopen(req, timeout=TIMEOUT) as response:
        return json.loads(response.read().decode("utf-8", errors="replace"))


def request_text(url: str) -> str:
    req = Request(
        url,
        headers={
            "User-Agent": USER_AGENT,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
    )
    with urlopen(req, timeout=TIMEOUT) as response:
        raw = response.read()
        charset = response.headers.get_content_charset() or "utf-8"
        return raw.decode(charset, errors="replace")


def naver_search_html(query: str) -> str:
    url = f"https://search.naver.com/search.naver?where=nexearch&query={quote(query)}"
    req = Request(
        url,
        headers={
            "User-Agent": (
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
            )
        },
    )
    with urlopen(req, timeout=TIMEOUT) as response:
        return response.read().decode("utf-8", errors="replace")


def parse_naver_location(page: str) -> dict[str, Any] | None:
    road_match = re.search(r'roadAddress":"([^"]+)"', page)
    address_match = re.search(r'address":"([^"]+)"', page)
    if not road_match and not address_match:
        return None

    position = road_match.start() if road_match else address_match.start()
    chunk = page[max(0, position - 2500) : position + 5000]
    lonlat_match = re.search(
        r"longitude(?:%5E|\\^)([0-9.]+).*?latitude(?:%5E|\\^)([0-9.]+)",
        chunk,
        flags=re.IGNORECASE,
    )
    if not lonlat_match:
        lonlat_match = re.search(r'"x"\s*:\s*"?([0-9.]+).*?"y"\s*:\s*"?([0-9.]+)', chunk)
    if not lonlat_match:
        return None

    address = road_match.group(1) if road_match else address_match.group(1)
    return {
        "address": html.unescape(address).replace("\\/", "/"),
        "lon": float(lonlat_match.group(1)),
        "lat": float(lonlat_match.group(2)),
    }


def naver_location(record: dict[str, str], cache: dict[str, Any]) -> dict[str, Any] | None:
    name = record["name"]
    district = record["district"]
    queries = NAVER_QUERY_OVERRIDES.get(name, [f"{name} 주소", f"{name} {district} 주소"])
    status = "naver_search"

    if "청소년경찰학교" in name:
        station_query = POLICE_STATION_QUERIES.get(district)
        queries = [station_query, f"{district} 경찰서 주소"] if station_query else queries
        status = "police_station_proxy"

    for query in [query for query in queries if query]:
        if query not in cache:
            try:
                page = naver_search_html(query)
                parsed = parse_naver_location(page)
            except (HTTPError, URLError, TimeoutError, ValueError) as exc:
                parsed = {"error": str(exc)}
            cache[query] = parsed
            time.sleep(0.35)

        parsed = cache.get(query)
        if isinstance(parsed, dict) and {"lat", "lon", "address"} <= set(parsed):
            return {**parsed, "query": query, "status": status}

    return None


def best_nominatim_result(results: list[dict[str, Any]]) -> dict[str, Any] | None:
    if not results:
        return None
    seoul_results = [item for item in results if "서울" in item.get("display_name", "")]
    return seoul_results[0] if seoul_results else results[0]


def geocode(name: str, district: str, cache: dict[str, Any]) -> dict[str, Any] | None:
    query = f"{name} {district} 서울".strip()
    if query in cache:
        return cache[query]

    url = (
        "https://nominatim.openstreetmap.org/search"
        f"?format=json&limit=3&extratags=1&namedetails=1&q={quote(query)}"
    )
    try:
        result = best_nominatim_result(request_json(url))
    except (HTTPError, URLError, TimeoutError, json.JSONDecodeError) as exc:
        result = {"error": str(exc)}

    cache[query] = result
    time.sleep(REQUEST_PAUSE_SECONDS)
    return result if isinstance(result, dict) and "lat" in result else None


def extract_website(geo: dict[str, Any] | None) -> str:
    if not geo:
        return ""
    extratags = geo.get("extratags") or {}
    for key in ["website", "contact:website", "url"]:
        value = extratags.get(key)
        if isinstance(value, str) and value.startswith(("http://", "https://")):
            return value
    return ""


def extract_og_image(site_url: str) -> str:
    if not site_url:
        return ""
    try:
        page = request_text(site_url)
    except (HTTPError, URLError, TimeoutError, UnicodeDecodeError):
        return ""

    patterns = [
        r'<meta[^>]+property=["\']og:image["\'][^>]+content=["\']([^"\']+)["\']',
        r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+property=["\']og:image["\']',
        r'<meta[^>]+name=["\']twitter:image["\'][^>]+content=["\']([^"\']+)["\']',
    ]
    for pattern in patterns:
        match = re.search(pattern, page, flags=re.IGNORECASE)
        if match:
            image = html.unescape(match.group(1).strip())
            return urljoin(site_url, image)
    return extract_candidate_image(site_url, page)


def extract_candidate_image(site_url: str, page: str) -> str:
    candidates = re.findall(r'<img[^>]+(?:src|data-src|data-original)=["\']([^"\']+)["\']', page, flags=re.IGNORECASE)
    skip_words = ["logo", "icon", "favicon", "blank", "spacer", "sns", "facebook", "instagram", "youtube", "btn_"]
    preferred_words = ["main", "visual", "museum", "exhibit", "banner", "intro", "thumb", "photo", "kv"]

    scored: list[tuple[int, str]] = []
    for raw in candidates:
        image = html.unescape(raw.strip())
        if not image or image.startswith("data:"):
            continue
        lowered = image.lower()
        if any(word in lowered for word in skip_words):
            continue
        if not lowered.endswith((".jpg", ".jpeg", ".png", ".webp", ".gif")):
            continue
        score = 0
        if any(word in lowered for word in preferred_words):
            score += 10
        if re.search(r"(1920|1200|1080|800|720|640|560|480)", lowered):
            score += 4
        if "/upload" in lowered or "/file" in lowered or "/images" in lowered:
            score += 2
        scored.append((score, urljoin(site_url, image)))

    if not scored:
        return ""
    scored.sort(key=lambda item: item[0], reverse=True)
    return scored[0][1]


def split_semicolon(value: str) -> list[str]:
    return [part.strip() for part in value.split(";") if part.strip()]


def fallback_centroid(district: str) -> tuple[float | None, float | None]:
    first = split_semicolon(district)[0] if ";" in district else district
    return DISTRICT_CENTROIDS.get(first, SEOUL_CENTER)


def row_to_records(row: dict[str, str]) -> list[dict[str, str]]:
    name = row["name"]
    if name in EXCLUDED_NAMES:
        return []
    if name == "청소년경찰학교(서울)":
        expanded = []
        for school_name, theme, keyword, district in YOUTH_POLICE_SCHOOLS:
            clone = dict(row)
            clone.update({"name": school_name, "theme": theme, "keyword": keyword, "district": district})
            clone["notes"] = f"{row.get('notes', '')}; PDF의 청소년경찰학교(서울)를 11개 자치구 시설로 확장".strip("; ")
            expanded.append(clone)
        return expanded
    return [row]


def build_records() -> list[Museum]:
    cache = read_json(GEOCODE_CACHE_PATH)
    naver_cache = read_json(NAVER_LOCATION_CACHE_PATH)
    image_cache = cache.setdefault("_images", {})
    output: list[Museum] = []

    with SEED_PATH.open(encoding="utf-8") as f:
        rows = list(csv.DictReader(f))

    for row in rows:
        for record in row_to_records(row):
            name = record["name"]
            district = record["district"]
            geo = geocode(name, district, cache)
            website = OFFICIAL_URL_OVERRIDES.get(name) or extract_website(geo)
            if website and not image_cache.get(website):
                image_cache[website] = extract_og_image(website)
                time.sleep(0.25)
            image_url = image_cache.get(website, "")

            address = ""
            lat = lng = None
            verification_status = "needs_review"
            if geo:
                address = geo.get("display_name", "")
                try:
                    lat = float(geo["lat"])
                    lng = float(geo["lon"])
                    verification_status = "geocoded"
                except (KeyError, TypeError, ValueError):
                    lat = lng = None

            if lat is None or lng is None:
                naver_geo = naver_location(record, naver_cache)
                if naver_geo:
                    address = naver_geo["address"]
                    lat = naver_geo["lat"]
                    lng = naver_geo["lon"]
                    verification_status = naver_geo["status"]
                    if naver_geo["status"] == "police_station_proxy":
                        proxy_note = "청소년경찰학교 별도 주소 미확인: 관할 경찰서 대표 위치로 표시"
                        record["notes"] = f"{record.get('notes', '')}; {proxy_note}".strip("; ")

            if lat is None or lng is None:
                lat, lng = fallback_centroid(district)
                verification_status = "approximate"

            source_type = "expanded" if "청소년경찰학교" in name else "pdf"
            output.append(
                Museum(
                    id=slugify(name),
                    name=name,
                    theme=record["theme"],
                    keyword=record["keyword"],
                    district=district,
                    recommended_age=split_semicolon(record["recommended_age"]),
                    fee=record["fee"],
                    pdf_operating_days=split_semicolon(record["pdf_operating_days"]),
                    address=address or f"{district} 위치 확인 필요",
                    lat=lat,
                    lng=lng,
                    website_url=website,
                    image_url=image_url,
                    source_pdf_page=record["source_pdf_page"],
                    source_type=source_type,
                    verification_status=verification_status,
                    notes=record.get("notes", ""),
                )
            )

    write_json(GEOCODE_CACHE_PATH, cache)
    write_json(NAVER_LOCATION_CACHE_PATH, naver_cache)
    return output


def write_csv(records: list[Museum]) -> None:
    fieldnames = list(asdict(records[0]).keys()) if records else []
    with CSV_PATH.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for record in records:
            data = asdict(record)
            data["recommended_age"] = ";".join(data["recommended_age"])
            data["pdf_operating_days"] = ";".join(data["pdf_operating_days"])
            writer.writerow(data)


def main() -> None:
    records = build_records()
    write_json(JSON_PATH, [asdict(record) for record in records])
    write_csv(records)

    status_counts: dict[str, int] = {}
    for record in records:
        status_counts[record.verification_status] = status_counts.get(record.verification_status, 0) + 1
    print(f"wrote {len(records)} records")
    print(status_counts)


if __name__ == "__main__":
    main()
