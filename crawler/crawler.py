from __future__ import annotations

import json
import re
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Iterable
from urllib.parse import parse_qs, urljoin, urlparse

import pandas as pd
import requests
from bs4 import BeautifulSoup, Tag
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry


BASE_URL = "https://umppa.seoul.go.kr"
LIST_PATH = "/icare/user/kidsCafe/BD_selectKidsCafeList.do"
SOURCE_URL = urljoin(BASE_URL, LIST_PATH)
ROOT_DIR = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT_DIR / "data"
RAW_CSV_PATH = DATA_DIR / "kids_cafes_raw.csv"
JSON_PATH = DATA_DIR / "kids_cafes.json"
TIMEOUT = 20
REQUEST_PAUSE_SECONDS = 0.15
RETRY_TOTAL = 4
STYLE_LABELS = {
    "2001": "일반형 키즈카페",
    "2002": "여기저기 키즈카페",
}
WEEKDAY_ORDER = ["월", "화", "수", "목", "금", "토", "일"]

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    )
}


@dataclass
class KidsCafe:
    id: str
    name: str
    cafe_type: str
    district: str
    address: str
    phone: str
    age: str
    capacity: str
    image_url: str
    reserve_url: str
    detail_url: str
    operation_period: str
    operation_days: str
    closed_days: str
    feature_summary: str
    open_saturday: bool | None
    open_sunday: bool | None
    parking_available: bool | None
    parking_info: str
    lat: str
    lng: str
    source_url: str


def ensure_data_dir() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)


def build_session() -> requests.Session:
    session = requests.Session()
    retry = Retry(
        total=RETRY_TOTAL,
        connect=RETRY_TOTAL,
        read=RETRY_TOTAL,
        backoff_factor=0.8,
        status_forcelist=[429, 500, 502, 503, 504],
        allowed_methods=["GET"],
    )
    adapter = HTTPAdapter(max_retries=retry)
    session.mount("https://", adapter)
    session.mount("http://", adapter)
    return session


def clean_text(value: str | None) -> str:
    if not value:
        return ""
    return re.sub(r"\s+", " ", value).strip()


def absolute_url(url: str | None) -> str:
    if not url:
        return ""
    return urljoin(SOURCE_URL, url.strip())


def infer_district(address: str) -> str:
    match = re.search(r"(서울\S*\s+([가-힣]+구))", address)
    if match:
        return match.group(2)
    match = re.search(r"([가-힣]+구)", address)
    return match.group(1) if match else ""


def extract_phone(text: str) -> str:
    match = re.search(r"(0\d{1,2}-\d{3,4}-\d{4})", text)
    return match.group(1) if match else ""


def split_chunks(text: str) -> list[str]:
    normalized = re.sub(r"[|/]", "\n", text)
    return [clean_text(chunk) for chunk in normalized.splitlines() if clean_text(chunk)]


def find_text_by_label(container: Tag, labels: Iterable[str]) -> str:
    joined = clean_text(container.get_text("\n", strip=True))
    chunks = split_chunks(joined)
    for idx, chunk in enumerate(chunks):
        for label in labels:
            if label in chunk:
                if ":" in chunk or "：" in chunk:
                    return clean_text(re.split(r"[:：]", chunk, maxsplit=1)[-1])
                if idx + 1 < len(chunks):
                    return chunks[idx + 1]
    return ""


def normalize_label(text: str) -> str:
    return re.sub(r"\s+", "", text or "")


def definition_map(container: Tag) -> dict[str, str]:
    result: dict[str, str] = {}
    dl = container.select_one("dl")
    if not dl:
        return result

    current_label = ""
    for child in dl.find_all(["dt", "dd"], recursive=False):
        text = clean_text(child.get_text(" ", strip=True))
        if child.name == "dt":
            current_label = normalize_label(text)
        elif child.name == "dd" and current_label:
            result[current_label] = text
            current_label = ""
    return result


def extract_links(container: Tag) -> tuple[str, str, str]:
    reserve_url = ""
    detail_url = ""
    directions_url = ""
    for link in container.select("a[href]"):
        raw_href = (link.get("href") or "").strip()
        if not raw_href or raw_href.startswith(("javascript:", "#", "tel:", "mailto:")):
            continue
        href = absolute_url(raw_href)
        text = clean_text(link.get_text(" ", strip=True))
        if any(keyword in text for keyword in ["예약 신청", "예약", "신청", "바로가기"]):
            reserve_url = href
        if not directions_url and "오시는길" in text:
            directions_url = href
        if not detail_url and any(keyword in text for keyword in ["이용안내", "상세", "보기"]):
            detail_url = href
        elif not detail_url and href:
            detail_url = href
    return reserve_url, detail_url, directions_url


def extract_facility_params(*urls: str) -> dict[str, str]:
    for url in urls:
        if not url:
            continue
        parsed = urlparse(url)
        params = parse_qs(parsed.query)
        facility_id = params.get("q_fcltyId", [""])[0]
        facility_style = params.get("q_fcltyStle", ["2001"])[0] or "2001"
        if facility_id:
            return {"q_fcltyId": facility_id, "q_fcltyStle": facility_style}
    return {}


def build_detail_url(reserve_url: str, detail_url: str) -> str:
    if detail_url:
        return detail_url
    params = extract_facility_params(reserve_url)
    if not params:
        return ""
    return absolute_url(
        f"/icare/user/kidsCafe/BD_selectKidsCafeView.do"
        f"?q_fcltyId={params['q_fcltyId']}&q_fcltyStle={params['q_fcltyStle']}"
    )


def build_directions_url(reserve_url: str, detail_url: str, directions_url: str) -> str:
    if directions_url:
        return directions_url
    params = extract_facility_params(reserve_url, detail_url)
    if not params:
        return ""
    return absolute_url(
        f"/icare/user/kidsCafe/BD_selectKidsCafeDirections.do"
        f"?q_fcltyId={params['q_fcltyId']}&q_fcltyStle={params['q_fcltyStle']}"
    )


def fetch_coordinates_from_directions(session: requests.Session, directions_url: str) -> tuple[str, str]:
    if not directions_url:
        return "", ""

    try:
        response = session.get(directions_url, headers=HEADERS, timeout=TIMEOUT)
        response.raise_for_status()
    except requests.RequestException:
        return "", ""

    response.encoding = response.apparent_encoding or response.encoding
    time.sleep(REQUEST_PAUSE_SECONDS)

    match = re.search(
        r'setPoint\(\s*["\']([0-9.\-]+)["\']\s*,\s*["\']([0-9.\-]+)["\']',
        response.text,
    )
    if not match:
        return "", ""
    return match.group(1), match.group(2)


def extract_image(container: Tag) -> str:
    img = container.select_one("img")
    if not img:
        return ""
    for attr in ["src", "data-src", "data-original", "data-lazy-src"]:
        value = img.get(attr)
        if value:
            return absolute_url(value)
    return ""


def extract_name(container: Tag) -> str:
    for selector in [".kidscafe_wrap > h5", ".tit", ".title", ".subject", ".name", "h2", "h3", "h4", "strong", "dt"]:
        node = container.select_one(selector)
        if node:
            text = clean_text(node.get_text(" ", strip=True))
            if len(text) >= 2:
                return text
    lines = split_chunks(container.get_text("\n", strip=True))
    return lines[0] if lines else ""


def extract_address(container: Tag) -> str:
    fields = definition_map(container)
    if fields.get("주소"):
        return fields["주소"]
    for selector in [".addr", ".address", ".location", "address"]:
        node = container.select_one(selector)
        if node:
            return clean_text(node.get_text(" ", strip=True))
    text = clean_text(container.get_text("\n", strip=True))
    match = re.search(r"(서울[^\n]+)", text)
    return clean_text(match.group(1)) if match else ""


def build_id(index: int) -> str:
    return f"kc_{index:03d}"


def parse_list_items(soup: BeautifulSoup) -> list[Tag]:
    fixed_items = soup.select("div.board_kidscafe div.kidscafe_wrap")
    if fixed_items:
        return fixed_items
    return []


def parse_total_pages(soup: BeautifulSoup) -> int:
    page_numbers = []
    for link in soup.select("a[href], button[onclick]"):
        text = clean_text(link.get_text(" ", strip=True))
        if text.isdigit():
            page_numbers.append(int(text))
        href_blob = " ".join(filter(None, [link.get("href"), link.get("onclick")]))
        page_numbers.extend(int(num) for num in re.findall(r"[?&]pageIndex=(\d+)", href_blob))
        page_numbers.extend(int(num) for num in re.findall(r"jsMovePage\((\d+)\)", href_blob))
    return max(page_numbers) if page_numbers else 1


def fetch_page(session: requests.Session, page_index: int, facility_style: str) -> str:
    response = session.get(
        SOURCE_URL,
        params={
            "q_currPage": page_index,
            "q_rowPerPage": 5,
            "q_fcltyStle": facility_style,
        },
        headers=HEADERS,
        timeout=TIMEOUT,
    )
    response.raise_for_status()
    response.encoding = response.apparent_encoding or response.encoding
    time.sleep(REQUEST_PAUSE_SECONDS)
    return response.text


def extract_sidebar_fields(soup: BeautifulSoup) -> dict[str, str]:
    result: dict[str, str] = {}
    for item in soup.select(".viewWrap .bx-right li"):
        label_node = item.select_one("b")
        value_node = item.select_one("span")
        label = normalize_label(label_node.get_text(" ", strip=True) if label_node else "")
        value = clean_text(value_node.get_text(" ", strip=True) if value_node else item.get_text(" ", strip=True))
        if label:
            result[label] = value
    return result


def extract_section_map(soup: BeautifulSoup) -> dict[str, str]:
    sections: dict[str, str] = {}
    for title in soup.select(".sub_title03"):
        heading = clean_text(title.get_text(" ", strip=True))
        chunks: list[str] = []
        for sibling in title.next_siblings:
            if not isinstance(sibling, Tag):
                continue
            if sibling.name == "h3" and "sub_title03" in sibling.get("class", []):
                break
            text = clean_text(sibling.get_text(" ", strip=True))
            if text:
                chunks.append(text)
        if heading and chunks:
            sections[heading] = clean_text(" ".join(chunks))
    return sections


def extract_text_lines(container: Tag | BeautifulSoup | None) -> list[str]:
    if container is None:
        return []
    lines = []
    for raw_line in container.get_text("\n", strip=True).splitlines():
        line = clean_text(raw_line)
        if line:
            lines.append(line)
    return lines


def unique_preserve_order(values: Iterable[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        if value and value not in seen:
            seen.add(value)
            result.append(value)
    return result


def truncate_text(text: str, max_length: int = 180) -> str:
    if len(text) <= max_length:
        return text
    return f"{text[: max_length - 1].rstrip()}…"


def weekday_range(start: str, end: str) -> list[str]:
    start_idx = WEEKDAY_ORDER.index(start)
    end_idx = WEEKDAY_ORDER.index(end)
    if start_idx <= end_idx:
        return WEEKDAY_ORDER[start_idx : end_idx + 1]
    return WEEKDAY_ORDER[start_idx:] + WEEKDAY_ORDER[: end_idx + 1]


def extract_weekday_set(text: str) -> set[str]:
    if not text:
        return set()

    days: set[str] = set()
    if "매일" in text:
        days.update(WEEKDAY_ORDER)
    if "주말" in text:
        days.update(["토", "일"])
    if "주중" in text or "평일" in text:
        days.update(["월", "화", "수", "목", "금"])

    for start, end in re.findall(
        r"(?<![가-힣])(월|화|수|목|금|토|일)(?:요일)?\s*[~\-]\s*(월|화|수|목|금|토|일)(?:요일)?(?![가-힣])",
        text,
    ):
        days.update(weekday_range(start, end))

    for day in re.findall(r"(?<![가-힣])(월|화|수|목|금|토|일)(?:요일)?(?![가-힣])", text):
        days.add(day)

    return days


def infer_weekend_open(operation_days: str, closed_days: str) -> tuple[bool | None, bool | None]:
    open_days = extract_weekday_set(operation_days)
    if open_days:
        return "토" in open_days, "일" in open_days

    closed = extract_weekday_set(closed_days)
    saturday = False if "토" in closed else None
    sunday = False if "일" in closed else None
    if "평일" in closed_days:
        saturday = True
        sunday = True
    return saturday, sunday


def extract_parking_info(lines: list[str]) -> str:
    candidates: list[str] = []
    for idx, line in enumerate(lines):
        if "주차" not in line:
            continue
        candidates.append(line)
        if "주차안내" in line or "주차 안내" in line:
            for extra in lines[idx + 1 : idx + 4]:
                if any(keyword in extra for keyword in ["주차", "무료", "유료", "공간", "대중교통", "공영"]):
                    candidates.append(extra)
    joined = " / ".join(unique_preserve_order(candidates)[:4])
    return truncate_text(joined, 220)


def infer_parking_available(parking_info: str) -> bool | None:
    if not parking_info:
        return None
    negative_keywords = [
        "주차불가",
        "주차 불가",
        "주차장 없음",
        "주차공간 없음",
        "주차 공간 없음",
        "주차공간이 없",
        "주차 공간이 없",
        "별도의 주차공간이 없",
    ]
    if any(keyword in parking_info for keyword in negative_keywords):
        return False
    positive_keywords = ["주차비", "무료주차", "유료주차", "주차안내", "주차 안내", "주차공간", "주차 공간", "주차 가능"]
    if any(keyword in parking_info for keyword in positive_keywords):
        return True
    return None


def extract_feature_summary(
    style_code: str,
    sections: dict[str, str],
    operation_period: str,
    parking_info: str,
) -> str:
    combined = " ".join(sections.values())
    features: list[str] = []

    if style_code == "2002":
        features.append("공원형 시즌 운영")
    if operation_period:
        features.append("운영기간 지정")
    if "놀이돌봄서비스" in combined:
        features.append("놀이돌봄서비스 운영")
    if "미끄럼방지 양말" in combined:
        features.append("미끄럼방지 양말 필수")
    if "현장접수" in combined:
        features.append("현장 접수 병행")
    if "사전예약" in combined:
        features.append("사전예약 중심 운영")
    if "계좌이체" in combined:
        features.append("현장 계좌이체 결제")
    if "대중교통" in combined:
        features.append("대중교통 이용 권장")
    if "우천" in combined or "미세먼지" in combined:
        features.append("기상 상황에 따라 변동")
    if "보호자 동반" in combined:
        features.append("보호자 동반 이용")
    if parking_info and "주차공간 협소" in parking_info:
        features.append("주차공간 협소")
    if "입장권 구매" in combined:
        features.append("입장권 구매 후 입장")
    if "80분간 운영" in combined or "회차" in combined:
        features.append("회차별 예약 운영")

    features = unique_preserve_order(features)
    if features:
        return " · ".join(features[:3])

    if style_code == "2001":
        return "회차별 예약 운영"
    if style_code == "2002":
        return "운영기간 지정 야외형 키즈카페"
    return ""


def fetch_detail_info(session: requests.Session, detail_url: str, style_code: str) -> dict[str, object]:
    if not detail_url:
        return {
            "operation_period": "",
            "operation_days": "",
            "closed_days": "",
            "feature_summary": "",
            "open_saturday": None,
            "open_sunday": None,
            "parking_available": None,
            "parking_info": "",
        }

    try:
        response = session.get(detail_url, headers=HEADERS, timeout=TIMEOUT)
        response.raise_for_status()
    except requests.RequestException:
        return {
            "operation_period": "",
            "operation_days": "",
            "closed_days": "",
            "feature_summary": "",
            "open_saturday": None,
            "open_sunday": None,
            "parking_available": None,
            "parking_info": "",
        }

    response.encoding = response.apparent_encoding or response.encoding
    time.sleep(REQUEST_PAUSE_SECONDS)
    soup = BeautifulSoup(response.text, "html.parser")
    sidebar = extract_sidebar_fields(soup)
    sections = extract_section_map(soup)
    lines = extract_text_lines(soup.select_one(".sub_content") or soup)

    operation_period = sidebar.get("운영기간", "")
    operation_days = sidebar.get("운영일", "")
    closed_days = sidebar.get("휴관일", "")
    open_saturday, open_sunday = infer_weekend_open(operation_days, closed_days)
    parking_info = extract_parking_info(lines)
    parking_available = infer_parking_available(parking_info)
    feature_summary = extract_feature_summary(style_code, sections, operation_period, parking_info)

    return {
        "operation_period": operation_period,
        "operation_days": operation_days,
        "closed_days": closed_days,
        "feature_summary": feature_summary,
        "open_saturday": open_saturday,
        "open_sunday": open_sunday,
        "parking_available": parking_available,
        "parking_info": parking_info,
    }


def crawl() -> list[KidsCafe]:
    session = build_session()
    items: list[KidsCafe] = []
    seen: set[tuple[str, str]] = set()
    detail_cache: dict[str, dict[str, object]] = {}

    for style_code, cafe_type in STYLE_LABELS.items():
        first_html = fetch_page(session, 1, style_code)
        first_soup = BeautifulSoup(first_html, "html.parser")
        total_pages = parse_total_pages(first_soup)

        for page_index in range(1, total_pages + 1):
            html = first_html if page_index == 1 else fetch_page(session, page_index, style_code)
            soup = first_soup if page_index == 1 else BeautifulSoup(html, "html.parser")

            for container in parse_list_items(soup):
                fields = definition_map(container)
                name = extract_name(container)
                address = extract_address(container)
                if not name and not address:
                    continue

                dedupe_key = (name, address)
                if dedupe_key in seen:
                    continue
                seen.add(dedupe_key)

                reserve_url, detail_url, directions_url = extract_links(container)
                detail_url = build_detail_url(reserve_url, detail_url)
                directions_url = build_directions_url(reserve_url, detail_url, directions_url)
                lat, lng = fetch_coordinates_from_directions(session, directions_url)
                text_blob = clean_text(container.get_text("\n", strip=True))

                detail_info = detail_cache.get(detail_url)
                if detail_info is None:
                    detail_info = fetch_detail_info(session, detail_url, style_code)
                    detail_cache[detail_url] = detail_info

                operation_period = str(detail_info.get("operation_period", "") or fields.get("운영기간", ""))
                operation_days = str(detail_info.get("operation_days", "") or fields.get("운영일", ""))
                closed_days = str(detail_info.get("closed_days", ""))
                open_saturday = detail_info.get("open_saturday")
                open_sunday = detail_info.get("open_sunday")

                if open_saturday is None or open_sunday is None:
                    fallback_sat, fallback_sun = infer_weekend_open(operation_days, closed_days)
                    open_saturday = open_saturday if open_saturday is not None else fallback_sat
                    open_sunday = open_sunday if open_sunday is not None else fallback_sun

                cafe = KidsCafe(
                    id="",
                    name=name,
                    cafe_type=cafe_type,
                    district=infer_district(address),
                    address=address,
                    phone=fields.get("전화번호") or find_text_by_label(container, ["전화", "문의"]) or extract_phone(text_blob),
                    age=fields.get("이용연령") or find_text_by_label(container, ["연령", "이용연령", "대상"]),
                    capacity=fields.get("이용정원") or find_text_by_label(container, ["정원", "이용정원", "인원"]),
                    image_url=extract_image(container),
                    reserve_url=reserve_url or detail_url,
                    detail_url=detail_url,
                    operation_period=operation_period,
                    operation_days=operation_days,
                    closed_days=closed_days,
                    feature_summary=str(detail_info.get("feature_summary", "")),
                    open_saturday=open_saturday if isinstance(open_saturday, bool) or open_saturday is None else None,
                    open_sunday=open_sunday if isinstance(open_sunday, bool) or open_sunday is None else None,
                    parking_available=detail_info.get("parking_available")
                    if isinstance(detail_info.get("parking_available"), bool) or detail_info.get("parking_available") is None
                    else None,
                    parking_info=str(detail_info.get("parking_info", "")),
                    lat=lat,
                    lng=lng,
                    source_url=detail_url or directions_url or SOURCE_URL,
                )
                items.append(cafe)

    for index, cafe in enumerate(items, start=1):
        cafe.id = build_id(index)
    return items


def save_outputs(cafes: list[KidsCafe]) -> None:
    ensure_data_dir()
    records = [asdict(cafe) for cafe in cafes]
    frame = pd.DataFrame(records)
    frame.to_csv(RAW_CSV_PATH, index=False, encoding="utf-8-sig")
    JSON_PATH.write_text(json.dumps(records, ensure_ascii=False, indent=2), encoding="utf-8")


def main() -> None:
    cafes = crawl()
    save_outputs(cafes)
    print(f"Saved {len(cafes)} records to {RAW_CSV_PATH}")


if __name__ == "__main__":
    main()
