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

LOW_QUALITY_WORDS = [
    "logo",
    "favicon",
    "/ico",
    "ico_",
    "ic_",
    "sns_logo",
    "preview_logo",
    "symbol",
    "popup",
    "nuri",
    "close_btn",
    "img_closed",
    "today_close",
    "waiting",
    "bookthumb",
    "shopping-phinf",
    "mark_holiday",
    "mobileinfo",
    "map.png",
    "blank",
    "spacer",
    "btn_",
]

SKIP_WORDS = [
    "icon",
    "/ico",
    "ico_",
    "ic_",
    "favicon",
    "blank",
    "spacer",
    "popup",
    "close_btn",
    "img_closed",
    "today_close",
    "waiting",
    "bookthumb",
    "shopping-phinf",
    "mark_holiday",
    "mobileinfo",
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
]


def load_cache() -> dict:
    if CACHE_PATH.exists():
        return json.loads(CACHE_PATH.read_text(encoding="utf-8"))
    return {}


def save_cache(cache: dict) -> None:
    CACHE_PATH.write_text(json.dumps(cache, ensure_ascii=False, indent=2), encoding="utf-8")


def request_text(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=20) as response:
        raw = response.read()
        charset = response.headers.get_content_charset() or "utf-8"
    return raw.decode(charset, errors="replace")


def absolute_url(base_url: str, image_url: str) -> str:
    image_url = html.unescape(image_url.strip())
    if image_url.startswith("//"):
        scheme = urllib.parse.urlparse(base_url).scheme or "https"
        return f"{scheme}:{image_url}"
    return urllib.parse.urljoin(base_url, image_url)


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


def extract_image(site_url: str) -> str:
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

        if website not in cache or is_low_quality(cache.get(website) or ""):
            cache[website] = extract_image(website)
            save_cache(cache)
            time.sleep(0.25)

        next_image = (cache.get(website) or "").strip()
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
