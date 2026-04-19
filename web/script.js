const DATA_URL_CANDIDATES = [
  "../data/kids_cafes.json",
  "./data/kids_cafes.json",
  "/data/kids_cafes.json",
];
const SEOUL_CENTER = [37.5665, 126.978];
const DEFAULT_ZOOM = 11;

const state = {
  cafes: [],
  filtered: [],
  activeId: "",
  selectedAges: new Set(),
  selectedWeekendDays: new Set(),
  markers: new Map(),
  currentLocationMarker: null,
  currentLocationCircle: null,
  map: null,
};

const elements = {
  searchInput: document.getElementById("search-input"),
  districtFilter: document.getElementById("district-filter"),
  resultCount: document.getElementById("result-count"),
  activeFilters: document.getElementById("active-filters"),
  filterToggle: document.getElementById("filter-toggle"),
  filterPanel: document.getElementById("filter-panel"),
  filterBackdrop: document.getElementById("filter-backdrop"),
  resetFilters: document.getElementById("reset-filters"),
  mapViewToggle: document.getElementById("map-view-toggle"),
  listViewToggle: document.getElementById("list-view-toggle"),
  totalCount: document.getElementById("total-count"),
  districtCount: document.getElementById("district-count"),
  ageFilter: document.getElementById("age-filter"),
  ageSelectionSummary: document.getElementById("age-selection-summary"),
  weekendFilter: document.getElementById("weekend-filter"),
  weekendSelectionSummary: document.getElementById("weekend-selection-summary"),
  cardList: document.getElementById("card-list"),
  cardTemplate: document.getElementById("card-template"),
  content: document.querySelector(".content"),
};

function sanitizeText(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function normalizeCafeName(value) {
  return sanitizeText(value)
    .replace(/^서울형\s*키즈카페\s*/u, "")
    .replace(/^일반형\s*키즈카페\s*/u, "")
    .trim();
}

function parseNullableBoolean(value) {
  if (value === true || value === false) {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") {
      return true;
    }
    if (normalized === "false") {
      return false;
    }
  }
  return null;
}

function isValidCoordinate(value) {
  const num = Number(value);
  return Number.isFinite(num) && Math.abs(num) <= 180;
}

function parseSupportedAges(ageText) {
  const match = ageText.match(/(\d+)\s*~\s*(\d+)\s*세/);
  if (!match) {
    return [];
  }

  const start = Number(match[1]);
  const end = Number(match[2]);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) {
    return [];
  }

  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

function normalizeCafe(record, index) {
  return {
    id: sanitizeText(record.id, `kc_${String(index + 1).padStart(3, "0")}`),
    name: normalizeCafeName(record.name) || "이름 미상",
    district: sanitizeText(record.district),
    address: sanitizeText(record.address, "주소 정보 없음"),
    phone: sanitizeText(record.phone, "문의처 정보 없음"),
    age: sanitizeText(record.age, "정보 없음"),
    capacity: sanitizeText(record.capacity, "정보 없음"),
    image_url: sanitizeText(record.image_url),
    reserve_url: sanitizeText(record.reserve_url),
    detail_url: sanitizeText(record.detail_url),
    cafe_type: sanitizeText(record.cafe_type, "키즈카페"),
    operation_period: sanitizeText(record.operation_period),
    operation_days: sanitizeText(record.operation_days, "운영일 정보 없음"),
    closed_days: sanitizeText(record.closed_days),
    feature_summary: sanitizeText(record.feature_summary),
    parking_info: sanitizeText(record.parking_info),
    open_saturday: parseNullableBoolean(record.open_saturday),
    open_sunday: parseNullableBoolean(record.open_sunday),
    parking_available: parseNullableBoolean(record.parking_available),
    source_url: sanitizeText(record.source_url),
    lat: isValidCoordinate(record.lat) ? Number(record.lat) : null,
    lng: isValidCoordinate(record.lng) ? Number(record.lng) : null,
    supported_ages: parseSupportedAges(sanitizeText(record.age)),
  };
}

function countDistinctDistricts(cafes) {
  return new Set(cafes.map((cafe) => cafe.district).filter(Boolean)).size;
}

function availableAges(cafes) {
  return [...new Set(cafes.flatMap((cafe) => cafe.supported_ages))].sort((a, b) => a - b);
}

function updateSummary(cafes) {
  if (elements.totalCount) {
    elements.totalCount.textContent = cafes.length.toLocaleString("ko-KR");
  }
  if (elements.districtCount) {
    elements.districtCount.textContent = countDistinctDistricts(cafes).toLocaleString("ko-KR");
  }
}

function updateActiveFilterSummary() {
  const parts = [];
  const query = elements.searchInput.value.trim();
  const district = elements.districtFilter.value;
  const selectedAges = [...state.selectedAges].sort((a, b) => a - b);
  const selectedWeekend = [...state.selectedWeekendDays].map((day) => (day === "saturday" ? "토" : "일"));

  if (query) {
    parts.push(`검색: ${query}`);
  }
  if (district) {
    parts.push(`자치구: ${district}`);
  }
  if (selectedAges.length > 0) {
    parts.push(`연나이: ${selectedAges.join(", ")}세`);
  }
  if (selectedWeekend.length > 0) {
    parts.push(`운영일: ${selectedWeekend.join(", ")}`);
  }

  if (parts.length === 0) {
    elements.activeFilters.hidden = true;
    elements.activeFilters.textContent = "";
    return;
  }

  elements.activeFilters.hidden = false;
  elements.activeFilters.textContent = parts.join(" · ");
}

function updateFilterPanel(open) {
  elements.filterToggle.textContent = open ? "필터 닫기" : "필터 열기";
  elements.filterToggle.setAttribute("aria-expanded", String(open));
  elements.filterPanel.hidden = !open;
  elements.filterBackdrop.hidden = !open;
  elements.filterPanel.classList.toggle("is-collapsed", !open);
  elements.filterBackdrop.classList.toggle("is-visible", open);
}

function toggleFilterPanel() {
  const isOpen = elements.filterToggle.getAttribute("aria-expanded") === "true";
  updateFilterPanel(!isOpen);
}

function updateMobilePanel(panel) {
  elements.content.dataset.mobileView = panel;
  elements.mapViewToggle?.classList.toggle("is-active", panel === "map");
  elements.listViewToggle?.classList.toggle("is-active", panel === "list");
  elements.mapViewToggle?.setAttribute("aria-selected", String(panel === "map"));
  elements.listViewToggle?.setAttribute("aria-selected", String(panel === "list"));

  if (panel === "map") {
    requestAnimationFrame(() => {
      state.map?.invalidateSize();
      if (window.innerWidth <= 960 && state.activeId) {
        const marker = state.markers.get(state.activeId);
        marker?.openPopup();
      }
    });
  }

  if (panel === "list" && window.innerWidth <= 960 && state.activeId) {
    requestAnimationFrame(() => {
      const activeCard = document.querySelector(`.cafe-card[data-id="${state.activeId}"]`);
      activeCard?.scrollIntoView({ block: "start", behavior: "smooth" });
    });
  }
}

function updateAgeSelectionSummary() {
  const selected = [...state.selectedAges].sort((a, b) => a - b);
  if (selected.length === 0) {
    elements.ageSelectionSummary.textContent = "전체 연령";
    return;
  }
  elements.ageSelectionSummary.textContent = `${selected.join(", ")} 선택`;
}

function renderAgeFilter(cafes) {
  elements.ageFilter.innerHTML = "";

  availableAges(cafes).forEach((age) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "age-chip";
    button.textContent = String(age);
    button.setAttribute("aria-label", `${age}세`);
    button.dataset.age = String(age);
    button.classList.toggle("is-selected", state.selectedAges.has(age));
    button.setAttribute("aria-pressed", String(state.selectedAges.has(age)));
    button.addEventListener("click", () => {
      if (state.selectedAges.has(age)) {
        state.selectedAges.delete(age);
      } else {
        state.selectedAges.add(age);
      }
      renderAgeFilter(state.cafes);
      updateAgeSelectionSummary();
      filterCafes();
    });
    elements.ageFilter.append(button);
  });

  updateAgeSelectionSummary();
}

function updateWeekendSelectionSummary() {
  const selected = [...state.selectedWeekendDays];
  if (selected.length === 0) {
    elements.weekendSelectionSummary.textContent = "전체 운영일";
    return;
  }

  const labels = selected.map((day) => (day === "saturday" ? "토" : "일"));
  elements.weekendSelectionSummary.textContent = `${labels.join(", ")} 선택`;
}

function renderWeekendFilter() {
  elements.weekendFilter.querySelectorAll("[data-weekend]").forEach((button) => {
    const day = button.dataset.weekend;
    const isSelected = state.selectedWeekendDays.has(day);
    button.classList.toggle("is-selected", isSelected);
    button.setAttribute("aria-pressed", String(isSelected));
  });
  updateWeekendSelectionSummary();
}

function weekendLabel(dayName, isOpen) {
  if (isOpen === true) {
    return `${dayName} 운영`;
  }
  if (isOpen === false) {
    return `${dayName} 휴무`;
  }
  return `${dayName} 확인 필요`;
}

function parkingStatusLabel(cafe) {
  if (cafe.parking_available === true) {
    return "주차 가능";
  }
  if (cafe.parking_available === false) {
    return "주차 불가";
  }
  if (cafe.parking_info) {
    return "주차 정보 확인";
  }
  return "주차 정보 없음";
}

function focusActiveCard(options = {}) {
  const { behavior = "smooth", block = "nearest" } = options;
  const activeCard = document.querySelector(`.cafe-card[data-id="${state.activeId}"]`);
  activeCard?.scrollIntoView({ block, behavior });
  activeCard?.focus({ preventScroll: true });
}

function showCafeCardInList(cafeId = state.activeId) {
  if (!cafeId) {
    return;
  }

  state.activeId = cafeId;
  highlightActiveCard();

  if (window.innerWidth <= 960) {
    updateMobilePanel("list");
    return;
  }

  focusActiveCard({ block: "start" });
}

function initMap() {
  state.map = L.map("map", {
    zoomControl: true,
    scrollWheelZoom: true,
  }).setView(SEOUL_CENTER, DEFAULT_ZOOM);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(state.map);

  const mapContainer = state.map.getContainer();
  const handleShowList = (domEvent) => {
    const detailButton = domEvent.target.closest("[data-popup-action='show-list']");
    if (!detailButton) {
      return;
    }

    domEvent.preventDefault();
    domEvent.stopPropagation();

    const cafeId = detailButton.getAttribute("data-cafe-id") || state.activeId;
    showCafeCardInList(cafeId);
    state.map.closePopup();
  };

  mapContainer.addEventListener("pointerup", handleShowList, true);
  mapContainer.addEventListener("click", handleShowList, true);
}

function showCurrentLocation() {
  if (!("geolocation" in navigator)) {
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (position) => {
      const { latitude, longitude, accuracy } = position.coords;
      const latlng = [latitude, longitude];

      state.currentLocationMarker?.remove();
      state.currentLocationCircle?.remove();

      state.currentLocationMarker = L.circleMarker(latlng, {
        radius: 8,
        weight: 3,
        color: "#ffffff",
        fillColor: "#2563eb",
        fillOpacity: 1,
      })
        .addTo(state.map)
        .bindPopup("현재 위치");

      state.currentLocationCircle = L.circle(latlng, {
        radius: Math.max(accuracy || 0, 60),
        color: "#2563eb",
        weight: 1,
        fillColor: "#2563eb",
        fillOpacity: 0.12,
      }).addTo(state.map);
    },
    () => {
      // Ignore denied or unavailable location; map should still work without it.
    },
    {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 300000,
    }
  );
}

function popupHtml(cafe) {
  const imageBlock = cafe.image_url
    ? `<img src="${cafe.image_url}" alt="${escapeHtml(cafe.name)}" />`
    : '<div class="popup-placeholder">이미지 없음</div>';
  const listDetailButton = `<button type="button" class="popup-text-button popup-list-button" data-popup-action="show-list" data-cafe-id="${escapeHtml(
    cafe.id
  )}">목록에서 상세보기</button>`;
  const guideButton = cafe.detail_url
    ? `<a class="guide-button" href="${cafe.detail_url}" target="_blank" rel="noreferrer noopener">이용안내</a>`
    : "";
  const reserveButton = cafe.reserve_url
    ? `<a class="reserve-button" href="${cafe.reserve_url}" target="_blank" rel="noreferrer noopener">예약 페이지</a>`
    : "";

  return `
    <div class="popup-card">
      <h3>${escapeHtml(cafe.name)}</h3>
      ${imageBlock}
      <div class="card-actions popup-primary-action">
        ${listDetailButton}
      </div>
      <div class="card-actions popup-link-actions">
        ${guideButton}
        ${reserveButton}
      </div>
    </div>
  `;
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function updateMarkers() {
  state.markers.forEach((marker) => marker.remove());
  state.markers.clear();

  const bounds = [];
  state.filtered.forEach((cafe) => {
    if (cafe.lat === null || cafe.lng === null) {
      return;
    }
    const marker = L.marker([cafe.lat, cafe.lng]).addTo(state.map);
    marker.bindPopup(popupHtml(cafe));
    marker.on("click", () => setActiveCafe(cafe.id, true));
    state.markers.set(cafe.id, marker);
    bounds.push([cafe.lat, cafe.lng]);
  });

  if (bounds.length > 0) {
    state.map.fitBounds(bounds, { padding: [30, 30], maxZoom: 14 });
  } else {
    state.map.setView(SEOUL_CENTER, DEFAULT_ZOOM);
  }
}

function fillDistrictFilter(cafes) {
  const districts = [...new Set(cafes.map((cafe) => cafe.district).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, "ko")
  );
  districts.forEach((district) => {
    const option = document.createElement("option");
    option.value = district;
    option.textContent = district;
    elements.districtFilter.append(option);
  });
}

function filterCafes() {
  const query = elements.searchInput.value.trim().toLowerCase();
  const district = elements.districtFilter.value;

  state.filtered = state.cafes.filter((cafe) => {
    const matchesDistrict = !district || cafe.district === district;
    const matchesAge =
      state.selectedAges.size === 0 || [...state.selectedAges].every((age) => cafe.supported_ages.includes(age));
    const matchesWeekend =
      state.selectedWeekendDays.size === 0 ||
      [...state.selectedWeekendDays].every((day) =>
        day === "saturday" ? cafe.open_saturday === true : cafe.open_sunday === true
      );
    const haystack = `${cafe.name} ${cafe.address} ${cafe.cafe_type} ${cafe.feature_summary} ${cafe.parking_info}`.toLowerCase();
    const matchesQuery = !query || haystack.includes(query);
    return matchesDistrict && matchesAge && matchesWeekend && matchesQuery;
  });

  if (!state.filtered.some((cafe) => cafe.id === state.activeId)) {
    state.activeId = "";
  }

  elements.resultCount.textContent = `${state.filtered.length}개 지점`;
  updateActiveFilterSummary();
  renderCards();
  updateMarkers();
  if (state.activeId) {
    highlightActiveCard();
  }
}

function renderCards() {
  elements.cardList.innerHTML = "";

  if (state.filtered.length === 0) {
    const emptyState = document.createElement("div");
    emptyState.className = "empty-state";
    emptyState.innerHTML =
      "<strong>조건에 맞는 키즈카페가 없습니다.</strong><p>검색어를 줄이거나 자치구 필터를 초기화해 보세요.</p>";
    elements.cardList.append(emptyState);
    return;
  }

  const isDesktop = window.innerWidth > 960;
  const visibleCafes =
    isDesktop && state.activeId
      ? [...state.filtered].sort((a, b) => {
          if (a.id === state.activeId) {
            return -1;
          }
          if (b.id === state.activeId) {
            return 1;
          }
          return 0;
        })
      : state.filtered;

  visibleCafes.forEach((cafe) => {
    const fragment = elements.cardTemplate.content.cloneNode(true);
    const card = fragment.querySelector(".cafe-card");
    const thumbWrap = fragment.querySelector(".thumb-wrap");
    const thumb = fragment.querySelector(".thumb");
    const typeChip = fragment.querySelector(".type-chip");
    const district = fragment.querySelector(".district");
    const name = fragment.querySelector(".name");
    const address = fragment.querySelector(".address");
    const featureSummary = fragment.querySelector(".feature-summary");
    const saturdayStatus = fragment.querySelector(".saturday-status");
    const sundayStatus = fragment.querySelector(".sunday-status");
    const parkingStatus = fragment.querySelector(".parking-status");
    const parkingInfo = fragment.querySelector(".parking-info");
    const age = fragment.querySelector(".age");
    const capacity = fragment.querySelector(".capacity");
    const operationDays = fragment.querySelector(".operation-days");
    const phone = fragment.querySelector(".phone");
    const cardHint = fragment.querySelector(".card-hint");
    const guideButton = fragment.querySelector(".guide-button");
    const reserveButton = fragment.querySelector(".reserve-button");

    card.dataset.id = cafe.id;
    card.setAttribute("aria-label", `${cafe.name} 카드 열기`);
    typeChip.textContent = cafe.cafe_type;
    district.textContent = cafe.district || "자치구 미상";
    name.textContent = cafe.name;
    address.textContent = cafe.address;
    featureSummary.textContent = cafe.feature_summary || "이용안내 기준 주요 특징 정보가 준비 중입니다.";
    saturdayStatus.textContent = weekendLabel("토", cafe.open_saturday);
    sundayStatus.textContent = weekendLabel("일", cafe.open_sunday);
    parkingStatus.textContent = parkingStatusLabel(cafe);
    parkingInfo.textContent = cafe.parking_info || "주차 정보가 별도로 안내되지 않았습니다.";
    age.textContent = cafe.age;
    capacity.textContent = cafe.capacity;
    operationDays.textContent = cafe.operation_period
      ? `${cafe.operation_days} / ${cafe.operation_period}`
      : cafe.operation_days;
    phone.textContent = cafe.phone;

    if (cafe.image_url) {
      thumb.src = cafe.image_url;
      thumb.alt = `${cafe.name} 대표 이미지`;
      thumbWrap.classList.add("has-image");
      thumb.addEventListener("error", () => {
        thumb.removeAttribute("src");
        thumbWrap.classList.remove("has-image");
      });
    }

    if (cafe.detail_url) {
      guideButton.href = cafe.detail_url;
    } else {
      guideButton.removeAttribute("href");
      guideButton.setAttribute("aria-disabled", "true");
      guideButton.textContent = "이용안내 없음";
    }

    if (cafe.reserve_url) {
      reserveButton.href = cafe.reserve_url;
    } else if (cafe.source_url) {
      reserveButton.href = cafe.source_url;
      reserveButton.textContent = "원본 보기";
    } else {
      reserveButton.removeAttribute("href");
      reserveButton.setAttribute("aria-disabled", "true");
      reserveButton.textContent = "링크 없음";
    }

    card.addEventListener("click", (event) => {
      if (event.target.closest(".reserve-button, .guide-button, .card-hint")) {
        return;
      }
      setActiveCafe(cafe.id, true);
    });

    cardHint.addEventListener("click", () => {
      if (window.innerWidth <= 960) {
        updateMobilePanel("map");
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            setActiveCafe(cafe.id, true);
          });
        });
        return;
      }
      setActiveCafe(cafe.id, true);
    });

    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        setActiveCafe(cafe.id, true);
      }
    });

    elements.cardList.append(fragment);
  });
}

function highlightActiveCard() {
  document.querySelectorAll(".cafe-card").forEach((card) => {
    card.classList.toggle("is-active", card.dataset.id === state.activeId);
  });
}

function setActiveCafe(cafeId, openPopup = false) {
  state.activeId = cafeId;
  highlightActiveCard();
  updateSelectionHint();

  const cafe = state.filtered.find((item) => item.id === cafeId);
  const marker = state.markers.get(cafeId);
  if (cafe && marker && cafe.lat !== null && cafe.lng !== null) {
    const zoom = 14;
    const target = L.latLng(cafe.lat, cafe.lng);
    const verticalOffset = window.innerWidth <= 640 ? 160 : 120;
    const adjustedCenter = state.map.unproject(state.map.project(target, zoom).subtract([0, verticalOffset]), zoom);

    if (openPopup) {
      state.map.once("moveend", () => marker.openPopup());
    }

    state.map.flyTo(adjustedCenter, zoom, { duration: 0.5 });
  }

  if (window.innerWidth > 960) {
    focusActiveCard();
  }

}

function resetFilters() {
  elements.searchInput.value = "";
  elements.districtFilter.value = "";
  state.selectedAges.clear();
  state.selectedWeekendDays.clear();
  renderAgeFilter(state.cafes);
  renderWeekendFilter();
  updateAgeSelectionSummary();
  filterCafes();
  elements.searchInput.focus();
}

async function loadData() {
  for (const url of DATA_URL_CANDIDATES) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        continue;
      }
      const raw = await response.json();
      return Array.isArray(raw) ? raw.map(normalizeCafe) : [];
    } catch (error) {
      console.warn(`Failed to load data from ${url}`, error);
    }
  }

  throw new Error("데이터 파일을 불러오지 못했습니다.");
}

function bindEvents() {
  elements.searchInput.addEventListener("input", filterCafes);
  elements.districtFilter.addEventListener("change", filterCafes);
  elements.filterToggle.addEventListener("click", toggleFilterPanel);
  elements.filterBackdrop.addEventListener("click", () => updateFilterPanel(false));
  elements.resetFilters.addEventListener("click", resetFilters);
  elements.mapViewToggle?.addEventListener("click", () => updateMobilePanel("map"));
  elements.listViewToggle?.addEventListener("click", () => updateMobilePanel("list"));
  elements.weekendFilter.querySelectorAll("[data-weekend]").forEach((button) => {
    button.addEventListener("click", () => {
      const day = button.dataset.weekend;
      if (state.selectedWeekendDays.has(day)) {
        state.selectedWeekendDays.delete(day);
      } else {
        state.selectedWeekendDays.add(day);
      }
      renderWeekendFilter();
      filterCafes();
    });
  });
}

async function main() {
  initMap();
  showCurrentLocation();
  bindEvents();

  try {
    state.cafes = await loadData();
    updateSummary(state.cafes);
    fillDistrictFilter(state.cafes);
    renderAgeFilter(state.cafes);
    renderWeekendFilter();
    updateMobilePanel("map");
    updateFilterPanel(false);
    filterCafes();
  } catch (error) {
    elements.cardList.innerHTML =
      '<div class="empty-state"><strong>데이터를 불러오지 못했습니다.</strong><p>정적 서버 경로와 JSON 파일 존재 여부를 확인해 주세요.</p></div>';
    elements.resultCount.textContent = "0개 지점";
    console.error(error);
  }
}

main();
