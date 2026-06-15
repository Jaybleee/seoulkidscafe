import html
import json
import re
import socket
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DATA_FILES = [ROOT / "data" / "museums.json", ROOT / "data" / "libraries.json"]
CACHE_PATH = ROOT / "data" / "place_image_cache.json"
USER_AGENT = "seoul-kids-map/1.0 (official image enrichment)"
MAX_DETAIL_PAGES = 3

LOW_QUALITY_WORDS = [
    "og-image",
    "og1",
    "common/og",
    "logo",
    "favicon",
    "/ico",
    "ico_",
    "ic_",
    "sns_logo",
    "sns",
    "preview_logo",
    "symbol",
    "header_flag",
    "vod_",
    "child_web_access",
    "onerror",
    "access_",
    "sss",
    "recommendbook",
    "quickmenu",
    "quick_ico",
    "popup",
    "nuri",
    "close_btn",
    "img_closed",
    "close.gif",
    "today_close",
    "waiting",
    "bookthumb",
    "shopping-phinf",
    "mark_holiday",
    "mobileinfo",
    "mainep",
    "mainvi.gif",
    "img_map_library",
    "img_slogan",
    "p_slogan",
    "facility_floor",
    "bannerzone",
    "fsite",
    "i_sang",
    "process_join",
    "cal_example",
    "map_",
    "map.png",
    "blank",
    "spacer",
    "btn_",
]

SKIP_WORDS = [
    "og-image",
    "og1",
    "common/og",
    "icon",
    "sns",
    "/ico",
    "ico_",
    "ic_",
    "favicon",
    "blank",
    "spacer",
    "popup",
    "header_flag",
    "vod_",
    "child_web_access",
    "onerror",
    "access_",
    "sss",
    "recommendbook",
    "quickmenu",
    "quick_ico",
    "close_btn",
    "img_closed",
    "close.gif",
    "today_close",
    "waiting",
    "bookthumb",
    "shopping-phinf",
    "mark_holiday",
    "mobileinfo",
    "mainep",
    "mainvi.gif",
    "img_map_library",
    "img_slogan",
    "p_slogan",
    "facility_floor",
    "bannerzone",
    "fsite",
    "i_sang",
    "process_join",
    "cal_example",
    "map_",
    "facebook",
    "instagram",
    "youtube",
    "kakao",
    "btn_",
]

PREFERRED_WORDS = [
    "main",
    "visual",
    "photo",
    "thumb",
    "banner",
    "intro",
    "kv",
    "slide",
    "view",
    "gallery",
    "upload",
    "children",
    "child",
    "library",
    "museum",
    "exhibit",
    "space",
    "facility",
    "facilities",
    "room",
    "building",
    "contents",
    "mainvisual",
]

DETAIL_LINK_WORDS = [
    "소개",
    "시설",
    "공간",
    "자료실",
    "어린이",
    "전시",
    "관람",
    "이용",
    "facility",
    "facilities",
    "intro",
    "info",
    "guide",
    "space",
    "room",
    "child",
    "children",
    "kids",
    "exhibit",
    "museum",
    "library",
    "lib",
]


def load_cache() -> dict:
    if CACHE_PATH.exists():
        return json.loads(CACHE_PATH.read_text(encoding="utf-8"))
    return {}


def save_cache(cache: dict) -> None:
    CACHE_PATH.write_text(json.dumps(cache, ensure_ascii=False, indent=2), encoding="utf-8")


def request_text(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=8) as response:
        raw = response.read()
        charset = response.headers.get_content_charset() or "utf-8"
    return raw.decode(charset, errors="replace")


def normalize_text(value: str) -> str:
    return re.sub(r"\s+", "", value).lower()


def name_tokens(name: str) -> list[str]:
    normalized = normalize_text(name)
    tokens = [normalized]
    for suffix in ["어린이박물관", "도서관", "박물관", "체험관", "기념관", "역사관"]:
        if normalized.endswith(suffix):
            tokens.append(normalized[: -len(suffix)])
    tokens.extend(normalize_text(part) for part in re.split(r"[\s·()/-]+", name) if len(part) >= 2)
    return [token for token in dict.fromkeys(tokens) if len(token) >= 2]


def absolute_url(base_url: str, image_url: str) -> str:
    image_url = html.unescape(image_url.strip())
    if image_url.startswith("//"):
        scheme = urllib.parse.urlparse(base_url).scheme or "https"
        return f"{scheme}:{image_url}"
    return urllib.parse.urljoin(base_url, image_url)


def same_domain(base_url: str, next_url: str) -> bool:
    base_host = urllib.parse.urlparse(base_url).netloc.lower().removeprefix("www.")
    next_host = urllib.parse.urlparse(next_url).netloc.lower().removeprefix("www.")
    return bool(base_host and next_host and (next_host == base_host or next_host.endswith("." + base_host)))


def is_image_url(url: str) -> bool:
    lowered = urllib.parse.urlparse(url).path.lower()
    return lowered.endswith((".jpg", ".jpeg", ".png", ".webp", ".gif"))


def is_low_quality(url: str) -> bool:
    lowered = url.lower()
    return any(word in lowered for word in LOW_QUALITY_WORDS)


def score_image(url: str, kind: str) -> int:
    lowered = url.lower()
    if any(word in lowered for word in SKIP_WORDS):
        return -100
    if not is_image_url(url):
        return -50

    score = 0
    if kind == "og":
        score += 14
    if kind == "detail":
        score += 10
    if any(word in lowered for word in PREFERRED_WORDS):
        score += 8
    if re.search(r"(1920|1600|1440|1200|1080|960|800|720|640|560|480)", lowered):
        score += 4
    if any(segment in lowered for segment in ["/upload", "/file", "/images", "/img", "/photo"]):
        score += 3
    if is_low_quality(url):
        score -= 18
    return score


def meta_images(base_url: str, page: str) -> list[str]:
    patterns = [
        r'<meta[^>]+property=["\']og:image(?::secure_url)?["\'][^>]+content=["\']([^"\']+)["\']',
        r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+property=["\']og:image(?::secure_url)?["\']',
        r'<meta[^>]+name=["\']twitter:image(?::src)?["\'][^>]+content=["\']([^"\']+)["\']',
        r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+name=["\']twitter:image(?::src)?["\']',
    ]
    found = []
    for pattern in patterns:
        found.extend(re.findall(pattern, page, flags=re.IGNORECASE))
    return [absolute_url(base_url, value) for value in found if value.strip()]


def inline_images(base_url: str, page: str) -> list[str]:
    attrs = ["src", "data-src", "data-original", "data-lazy", "data-url"]
    found = []
    for attr in attrs:
        found.extend(re.findall(rf'<img[^>]+{attr}=["\']([^"\']+)["\']', page, flags=re.IGNORECASE))
    return [absolute_url(base_url, value) for value in found if value.strip() and not value.strip().startswith("data:")]


def link_candidates(base_url: str, page: str, name: str) -> list[str]:
    tokens = name_tokens(name)
    candidates: list[tuple[int, str]] = []
    for match in re.finditer(r'<a\b[^>]*href=["\']([^"\']+)["\'][^>]*>(.*?)</a>', page, flags=re.IGNORECASE | re.DOTALL):
        href = html.unescape(match.group(1).strip())
        if not href or href.startswith(("javascript:", "mailto:", "tel:", "#")):
            continue
        next_url = urllib.parse.urljoin(base_url, href)
        if not same_domain(base_url, next_url):
            continue
        text = re.sub(r"<[^>]+>", "", match.group(2))
        haystack = normalize_text(f"{text} {href} {urllib.parse.unquote(next_url)}")
        score = 0
        if any(token in haystack for token in tokens):
            score += 30
        if any(word in haystack for word in DETAIL_LINK_WORDS):
            score += 10
        if "search" in haystack or "login" in haystack or "calendar" in haystack:
            score -= 12
        if score > 0:
            candidates.append((score, next_url.split("#", 1)[0]))

    candidates.sort(key=lambda item: item[0], reverse=True)
    deduped = []
    seen = set()
    for _, url in candidates:
        if url in seen:
            continue
        seen.add(url)
        deduped.append(url)
        if len(deduped) >= MAX_DETAIL_PAGES:
            break
    return deduped


def extract_image(site_url: str, name: str = "") -> str:
    if not site_url:
        return ""
    try:
        page = request_text(site_url)
    except (TimeoutError, socket.timeout, UnicodeDecodeError, urllib.error.URLError, urllib.error.HTTPError):
        return ""

    scored: list[tuple[int, str]] = []
    for url in meta_images(site_url, page):
        scored.append((score_image(url, "og"), url))
    for url in inline_images(site_url, page):
        scored.append((score_image(url, "inline"), url))

    for detail_url in link_candidates(site_url, page, name):
        try:
            detail_page = request_text(detail_url)
        except (TimeoutError, socket.timeout, UnicodeDecodeError, urllib.error.URLError, urllib.error.HTTPError):
            continue
        for url in meta_images(detail_url, detail_page):
            scored.append((score_image(url, "detail"), url))
        for url in inline_images(detail_url, detail_page):
            scored.append((score_image(url, "detail"), url))
        time.sleep(0.12)

    scored = [(score, url) for score, url in scored if score > 0 and not is_low_quality(url)]
    if not scored:
        return ""

    scored.sort(key=lambda item: item[0], reverse=True)
    return scored[0][1]


def should_replace(current_url: str) -> bool:
    return not current_url.strip() or is_low_quality(current_url)


def enrich_file(path: Path, cache: dict) -> tuple[int, int, int]:
    data = json.loads(path.read_text(encoding="utf-8"))
    changed = 0
    filled = 0
    replaced = 0

    for item in data:
        current = (item.get("image_url") or "").strip()
        if not should_replace(current):
            continue

        website = (item.get("website_url") or "").strip()
        if not website:
            continue

        cache_key = f"{website}#{item.get('name', '')}"
        if cache_key not in cache or is_low_quality(cache.get(cache_key) or ""):
            cache[cache_key] = extract_image(website, item.get("name", ""))
            save_cache(cache)
            time.sleep(0.25)

        next_image = (cache.get(cache_key) or "").strip()
        if not next_image and current and is_low_quality(current):
            item["image_url"] = ""
            changed += 1
            replaced += 1
            continue
        if not next_image or next_image == current:
            continue

        item["image_url"] = next_image
        changed += 1
        if current:
            replaced += 1
        else:
            filled += 1

    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return changed, filled, replaced


def main() -> None:
    cache = load_cache()
    total_changed = 0
    for path in DATA_FILES:
        changed, filled, replaced = enrich_file(path, cache)
        total_changed += changed
        print(f"{path.relative_to(ROOT)}: changed={changed}, filled={filled}, replaced={replaced}")
    save_cache(cache)
    print(f"total_changed={total_changed}")


if __name__ == "__main__":
    main()
