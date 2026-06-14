import json
import time
import urllib.parse
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DATA_PATH = ROOT / "data" / "libraries_seed.json"
OUT_PATH = ROOT / "data" / "libraries.json"
CACHE_PATH = ROOT / "data" / "library_geocode_cache.json"


def load_cache():
    if CACHE_PATH.exists():
        return json.loads(CACHE_PATH.read_text(encoding="utf-8"))
    return {}


def request_geocode(query):
    params = urllib.parse.urlencode(
        {
            "q": query,
            "format": "jsonv2",
            "limit": "1",
            "addressdetails": "1",
        }
    )
    req = urllib.request.Request(
        f"https://nominatim.openstreetmap.org/search?{params}",
        headers={"User-Agent": "seoul-kids-map/1.0 (local data preparation)"},
    )
    with urllib.request.urlopen(req, timeout=20) as response:
        data = json.loads(response.read().decode("utf-8"))
    return data[0] if data else None


def geocode(item, cache):
    queries = [
        f"{item['address']}, 서울, 대한민국",
        f"{item['name']}, {item['district']}, 서울, 대한민국",
        f"{item['name']}, 서울, 대한민국",
    ]
    for query in queries:
        if query in cache:
            result = cache[query]
        else:
            result = request_geocode(query)
            cache[query] = result
            CACHE_PATH.write_text(json.dumps(cache, ensure_ascii=False, indent=2), encoding="utf-8")
            time.sleep(1.1)
        if result:
            return result
    CACHE_PATH.write_text(json.dumps(cache, ensure_ascii=False, indent=2), encoding="utf-8")
    time.sleep(1.1)
    return None


def main():
    seed = json.loads(DATA_PATH.read_text(encoding="utf-8"))
    cache = load_cache()
    enriched = []
    failures = []
    for item in seed:
        result = geocode(item, cache)
        next_item = dict(item)
        if result:
            next_item["lat"] = float(result["lat"])
            next_item["lng"] = float(result["lon"])
            next_item["verification_status"] = "address_geocoded"
        else:
            failures.append(item["name"])
            next_item["lat"] = None
            next_item["lng"] = None
            next_item["verification_status"] = "address_pending"
        enriched.append(next_item)
    OUT_PATH.write_text(json.dumps(enriched, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"wrote {len(enriched)} libraries")
    if failures:
        print("failed:")
        for name in failures:
            print(f"- {name}")


if __name__ == "__main__":
    main()
