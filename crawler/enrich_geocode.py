from __future__ import annotations

import csv
import json
import time
from pathlib import Path

import pandas as pd
from geopy.exc import GeocoderRateLimited, GeocoderServiceError
from geopy.geocoders import Nominatim


ROOT_DIR = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT_DIR / "data"
RAW_CSV_PATH = DATA_DIR / "kids_cafes_raw.csv"
CSV_PATH = DATA_DIR / "kids_cafes.csv"
JSON_PATH = DATA_DIR / "kids_cafes.json"
CACHE_PATH = DATA_DIR / "geocode_cache.json"
FAILURES_PATH = DATA_DIR / "geocode_failures.csv"
MAX_RETRIES = 3


def load_cache() -> dict[str, dict[str, float]]:
    if not CACHE_PATH.exists():
        return {}
    return json.loads(CACHE_PATH.read_text(encoding="utf-8"))


def save_cache(cache: dict[str, dict[str, float]]) -> None:
    CACHE_PATH.write_text(json.dumps(cache, ensure_ascii=False, indent=2), encoding="utf-8")


def geocode_address(geolocator: Nominatim, cache: dict[str, dict[str, float]], address: str) -> tuple[str, str]:
    if not address:
        return "", ""
    cached = cache.get(address)
    if cached:
        return str(cached["lat"]), str(cached["lng"])
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            location = geolocator.geocode(address, country_codes="kr", timeout=20)
        except GeocoderRateLimited:
            time.sleep(2 * attempt)
            continue
        if not location:
            return "", ""
        cache[address] = {"lat": location.latitude, "lng": location.longitude}
        time.sleep(1)
        return str(location.latitude), str(location.longitude)
    return "", ""


def main() -> None:
    if not RAW_CSV_PATH.exists():
        raise FileNotFoundError(f"Missing source CSV: {RAW_CSV_PATH}")

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    frame = pd.read_csv(RAW_CSV_PATH).fillna("")
    cache = load_cache()
    geolocator = Nominatim(user_agent="seoul-kids-cafe-map")
    failures: list[dict[str, str]] = []

    for idx, row in frame.iterrows():
        current_lat = str(row.get("lat", "")).strip()
        current_lng = str(row.get("lng", "")).strip()
        if current_lat and current_lng:
            continue
        try:
            lat, lng = geocode_address(geolocator, cache, str(row.get("address", "")))
        except GeocoderServiceError:
            lat, lng = "", ""
        if lat and lng:
            frame.at[idx, "lat"] = lat
            frame.at[idx, "lng"] = lng
        else:
            failures.append(
                {
                    "id": str(row.get("id", "")),
                    "name": str(row.get("name", "")),
                    "address": str(row.get("address", "")),
                }
            )

    save_cache(cache)
    frame.to_csv(CSV_PATH, index=False, encoding="utf-8-sig")
    JSON_PATH.write_text(
        frame.to_json(orient="records", force_ascii=False, indent=2),
        encoding="utf-8",
    )

    with FAILURES_PATH.open("w", newline="", encoding="utf-8-sig") as handle:
        writer = csv.DictWriter(handle, fieldnames=["id", "name", "address"])
        writer.writeheader()
        writer.writerows(failures)

    print(f"Saved enriched CSV to {CSV_PATH}")
    print(f"Saved JSON to {JSON_PATH}")
    print(f"Geocode failures: {len(failures)}")


if __name__ == "__main__":
    main()
