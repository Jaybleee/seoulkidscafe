const DATA_URLS = {
  kids: ["../data/kids_cafes.json", "./data/kids_cafes.json", "/data/kids_cafes.json"],
  museums: ["../data/museums.json", "./data/museums.json", "/data/museums.json"],
};
const SEOUL_CENTER = [37.5665, 126.978];
const DEFAULT_ZOOM = 11;
const AGE_GROUPS = [
  { label: "영아", min: 0, max: 2 },
  { label: "유아", min: 3, max: 6 },
  { label: "초등", min: 7, max: 12 },
];
const WEEKDAYS = ["월", "화", "수", "목", "금", "토", "일"];
const TODAY_DAY = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", weekday: "short" }).format(new Date()).slice(0, 1);
const QUICK_FILTER_LABELS = {
  today: "오늘 운영",
  free: "무료",
  weekend: "주말 가능",
  official: "공식 링크",
};
const LINK_REVIEW_NAMES = new Set([
  "서울생활사박물관",
  "서울역사박물관 어린이박물관",
  "청계천박물관",
  "한양도성박물관",
  "허준박물관",
  "국립어린이과학관",
  "한국은행 화폐박물관",
  "서울우리소리박물관",
]);
const SEARCH_FALLBACK_NAMES = new Set(["허준박물관", "한국은행 화폐박물관", "서울우리소리박물관"]);

const state = {
  places: [],
  filtered: [],
  activeId: "",
  category: "all",
  quickFilters: new Set(),
  selectedAges: new Set(),
  selectedDays: new Set(),
  selectedKidsOptions: new Set(),
  markers: new Map(),
  map: null,
};

const elements = {
  searchInput: document.getElementById("search-input"),
  districtFilter: document.getElementById("district-filter"),
  themeFilter: document.getElementById("theme-filter"),
  feeFilter: document.getElementById("fee-filter"),
  resultCount: document.getElementById("result-count"),
  activeFilters: document.getElementById("active-filters"),
  filterToggle: document.getElementById("filter-toggle"),
  filterPanel: document.getElementById("filter-panel"),
  resetFilters: document.getElementById("reset-filters"),
  ageSummary: document.getElementById("age-summary"),
  daySummary: document.getElementById("day-summary"),
  kidsOptionSummary: document.getElementById("kids-option-summary"),
  ageFilter: document.getElementById("age-filter"),
  dayFilter: document.getElementById("day-filter"),
  kidsOptionFilter: document.getElementById("kids-option-filter"),
  cardList: document.getElementById("card-list"),
  cardTemplate: document.getElementById("place-card-template"),
  content: document.querySelector(".content"),
  mapViewToggle: document.getElementById("map-view-toggle"),
  listViewToggle: document.getElementById("list-view-toggle"),
  countAll: document.getElementById("count-all"),
  countKids: document.getElementById("count-kids"),
  countMuseums: document.getElementById("count-museums"),
  quickFilters: document.querySelector(".quick-filters"),
};

function clean(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function isValidCoordinate(value) {
  const number = Number(value);
  return Number.isFinite(number) && Math.abs(number) <= 180;
}

function parseNullableBoolean(value) {
  if (value === true || value === false) return value;
  if (typeof value !== "string") return null;
  if (value.toLowerCase() === "true") return true;
  if (value.toLowerCase() === "false") return false;
  return null;
}

function ageNumbersToGroups(numbers) {
  const unique = new Set();
  numbers.forEach((age) => {
    AGE_GROUPS.forEach((group) => {
      if (age >= group.min && age <= group.max) unique.add(group.label);
    });
  });
  return [...unique];
}

function parseKidsAgeGroups(ageText) {
  const match = clean(ageText).match(/(\d+)\s*~\s*(\d+)\s*세/);
  if (!match) return [];
  const start = Number(match[1]);
  const end = Number(match[2]);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) return [];
  return ageNumbersToGroups(Array.from({ length: end - start + 1 }, (_, index) => start + index));
}

function parseMuseumAgeGroups(value) {
  const ages = Array.isArray(value) ? value : [];
  return ages.filter((age) => ["영아", "유아", "초등"].includes(age));
}

function officialSearchUrl(name, district) {
  const query = encodeURIComponent(`${name} ${district} 공식`);
  return `https://search.naver.com/search.naver?query=${query}`;
}

function feeLabel(fee) {
  const value = clean(fee);
  if (!value) return "요금 확인";
  if (value === "무료" || value === "구민무료") return value;
  if (value === "일부유료") return "일부 유료";
  return value;
}

function daysFromText(value) {
  const text = clean(value);
  if (!text) return [];
  if (text.includes("시설별") || text.includes("체험별") || text.includes("자치구별")) return [];
  if (text.includes("매일") || text.includes("상시")) return [...WEEKDAYS];
  const compact = text.replace(/\s/g, "");
  const rangeMatch = compact.match(/([월화수목금토일])\s*[~-]\s*([월화수목금토일])/);
  if (rangeMatch) {
    const start = WEEKDAYS.indexOf(rangeMatch[1]);
    const end = WEEKDAYS.indexOf(rangeMatch[2]);
    if (start >= 0 && end >= start) return WEEKDAYS.slice(start, end + 1);
  }
  return WEEKDAYS.filter((day) => compact.includes(day));
}

function normalizeKidsCafe(record, index) {
  const operationDays = clean(record.operation_days, "운영일 확인 필요");
  const openSaturday = parseNullableBoolean(record.open_saturday);
  const openSunday = parseNullableBoolean(record.open_sunday);
  const days = daysFromText(operationDays);
  if (openSaturday === true && !days.includes("토")) days.push("토");
  if (openSunday === true && !days.includes("일")) days.push("일");
  return {
    id: `kids-${clean(record.id, String(index + 1))}`,
    category: "kids_cafe",
    categoryLabel: "키즈카페",
    subtype: clean(record.cafe_type, "서울형 키즈카페"),
    name: clean(record.name, "이름 확인 필요").replace(/^서울형\s*키즈카페\s*/u, "").replace(/^일반형\s*키즈카페\s*/u, ""),
    district: clean(record.district, "지역 확인 필요"),
    summary: clean(record.feature_summary, "놀이돌봄, 예약, 운영 조건을 확인해 방문 계획을 세울 수 있는 서울형 키즈카페입니다."),
    ageLabel: clean(record.age, "연령 확인 필요"),
    ageGroups: parseKidsAgeGroups(record.age),
    operationLabel: operationDays,
    days,
    infoLabel: [clean(record.capacity), clean(record.parking_info)].filter(Boolean).join(" · ") || "이용 정보 확인 필요",
    note: clean(record.closed_days) ? `휴관: ${clean(record.closed_days)}` : "",
    imageUrl: clean(record.image_url),
    primaryUrl: clean(record.detail_url),
    secondaryUrl: clean(record.reserve_url),
    primaryLabel: "이용안내",
    secondaryLabel: "예약",
    lat: isValidCoordinate(record.lat) ? Number(record.lat) : null,
    lng: isValidCoordinate(record.lng) ? Number(record.lng) : null,
    openSaturday,
    openSunday,
    parkingAvailable: parseNullableBoolean(record.parking_available),
    verificationStatus: "official_location",
    fee: "유료",
    hasOfficialLink: Boolean(clean(record.detail_url)),
    officialLinkReady: Boolean(clean(record.detail_url)),
    hasReservation: Boolean(clean(record.reserve_url)),
    badges: [
      days.includes(TODAY_DAY) ? "오늘 운영" : "",
      "예약 가능",
      parseNullableBoolean(record.parking_available) === true ? "주차 가능" : "",
    ].filter(Boolean),
    searchText: "",
  };
}

function museumSummary(record) {
  const theme = clean(record.theme, "서울미래아이");
  const keyword = clean(record.keyword, "체험");
  const age = Array.isArray(record.recommended_age) ? record.recommended_age.join(", ") : "아이";
  const fee = clean(record.fee, "요금 확인");
  const status =
    record.verification_status === "police_station_proxy"
      ? "청소년경찰학교는 관할 경찰서 기준 위치를 먼저 확인해 두었습니다."
      : "공식 페이지와 지도 정보를 함께 확인할 수 있습니다.";
  return `${theme} 주제의 ${keyword} 콘텐츠입니다. ${age} 아이와 ${fee}로 즐길 수 있는 방문 후보이며, ${status}`;
}

function normalizeMuseum(record, index) {
  const days = Array.isArray(record.pdf_operating_days) ? record.pdf_operating_days : [];
  const note = clean(record.notes);
  const placeName = clean(record.name, "박물관");
  const needsLinkReview = LINK_REVIEW_NAMES.has(placeName);
  const useSearchFallback = SEARCH_FALLBACK_NAMES.has(placeName);
  const websiteUrl = useSearchFallback ? "" : clean(record.website_url);
  const hasOfficialLink = Boolean(websiteUrl);
  const fee = clean(record.fee);
  const badges = [
    days.includes(TODAY_DAY) ? "오늘 운영" : "",
    feeLabel(fee),
    hasOfficialLink && !needsLinkReview ? "공식 링크" : needsLinkReview ? "링크 확인" : "공식 확인 필요",
    record.verification_status === "police_station_proxy" ? "위치 재확인" : "",
  ].filter(Boolean);
  return {
    id: `museum-${clean(record.id, String(index + 1))}`,
    category: "museum",
    categoryLabel: "박물관·체험",
    subtype: clean(record.theme, "서울미래아이"),
    name: placeName,
    district: clean(record.district, "지역 확인 필요"),
    summary: museumSummary(record),
    ageLabel: Array.isArray(record.recommended_age) ? record.recommended_age.join(", ") : "연령 확인 필요",
    ageGroups: parseMuseumAgeGroups(record.recommended_age),
    operationLabel: days.length ? days.join(", ") : "운영일 확인 필요",
    days,
    infoLabel: `${clean(record.keyword, "키워드 확인")} · ${feeLabel(fee)}`,
    note:
      note ||
      (needsLinkReview
        ? "공식 링크 응답 상태 재확인 필요: 방문 전 운영정보를 다시 확인해 주세요."
        : !hasOfficialLink
          ? "공식 페이지 미확인: 방문 전 검색 결과에서 운영정보를 확인해 주세요."
          : ""),
    imageUrl: clean(record.image_url),
    primaryUrl: websiteUrl || officialSearchUrl(placeName, clean(record.district, "서울")),
    secondaryUrl: "",
    primaryLabel: hasOfficialLink ? "공식 페이지" : "공식 검색",
    secondaryLabel: "",
    lat: isValidCoordinate(record.lat) ? Number(record.lat) : null,
    lng: isValidCoordinate(record.lng) ? Number(record.lng) : null,
    theme: clean(record.theme),
    fee,
    verificationStatus: clean(record.verification_status),
    hasOfficialLink,
    officialLinkReady: hasOfficialLink && !needsLinkReview,
    hasReservation: false,
    badges,
    searchText: "",
  };
}

function finalizePlace(place) {
  place.searchText = `${place.name} ${place.categoryLabel} ${place.subtype} ${place.district} ${place.summary} ${place.infoLabel}`.toLowerCase();
  return place;
}

async function loadJson(candidates) {
  let lastError;
  for (const url of candidates) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      return await response.json();
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("데이터를 불러오지 못했습니다.");
}

function fillSelect(select, values) {
  values.forEach((value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    select.append(option);
  });
}

function updateCounts() {
  elements.countAll.textContent = state.places.length.toLocaleString("ko-KR");
  elements.countKids.textContent = state.places.filter((place) => place.category === "kids_cafe").length.toLocaleString("ko-KR");
  elements.countMuseums.textContent = state.places.filter((place) => place.category === "museum").length.toLocaleString("ko-KR");
}

function initFilters() {
  const districts = [...new Set(state.places.flatMap((place) => place.district.split(";")).map((part) => part.trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, "ko")
  );
  const themes = [...new Set(state.places.filter((place) => place.category === "museum").map((place) => place.theme).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, "ko")
  );
  const fees = [...new Set(state.places.filter((place) => place.category === "museum").map((place) => place.fee).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, "ko")
  );
  fillSelect(elements.districtFilter, districts);
  fillSelect(elements.themeFilter, themes);
  fillSelect(elements.feeFilter, fees);
}

function updateFilterPanel(open) {
  elements.filterToggle.textContent = open ? "필터 닫기" : "필터 열기";
  elements.filterToggle.setAttribute("aria-expanded", String(open));
  elements.filterPanel.hidden = !open;
  elements.filterPanel.classList.toggle("is-collapsed", !open);
}

function updateCategoryTabs() {
  document.querySelectorAll(".mode-tab").forEach((button) => {
    const isActive = button.dataset.category === state.category;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  });
  const showMuseumFilters = state.category !== "kids_cafe";
  const showKidsFilters = state.category !== "museum";
  document.querySelectorAll(".museum-only").forEach((item) => {
    item.hidden = !showMuseumFilters;
  });
  document.querySelectorAll(".kids-only").forEach((item) => {
    item.hidden = !showKidsFilters;
  });
}

function updateChipState(container, selectedSet, dataKey) {
  container.querySelectorAll(`[data-${dataKey}]`).forEach((button) => {
    const value = button.dataset[dataKey.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())];
    const selected = selectedSet.has(value);
    button.classList.toggle("is-selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
}

function updateFilterSummaries() {
  const ages = [...state.selectedAges];
  const days = [...state.selectedDays];
  const kidsOptions = [...state.selectedKidsOptions].map((value) => (value === "weekend" ? "주말 운영" : "주차 가능"));
  elements.ageSummary.textContent = ages.length ? ages.join(", ") : "전체";
  elements.daySummary.textContent = days.length ? days.join(", ") : "전체";
  elements.kidsOptionSummary.textContent = kidsOptions.length ? kidsOptions.join(", ") : "전체";
  updateChipState(elements.ageFilter, state.selectedAges, "age");
  updateChipState(elements.dayFilter, state.selectedDays, "day");
  updateChipState(elements.kidsOptionFilter, state.selectedKidsOptions, "kids-option");
  elements.quickFilters.querySelectorAll("[data-quick-filter]").forEach((button) => {
    const selected = state.quickFilters.has(button.dataset.quickFilter);
    button.classList.toggle("is-selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
}

function activeSummary() {
  const parts = [];
  if (state.quickFilters.size) parts.push([...state.quickFilters].map((value) => QUICK_FILTER_LABELS[value]).join(", "));
  if (state.category !== "all") parts.push(state.category === "kids_cafe" ? "키즈카페" : "박물관·체험");
  if (elements.searchInput.value.trim()) parts.push(`검색: ${elements.searchInput.value.trim()}`);
  if (elements.districtFilter.value) parts.push(`자치구: ${elements.districtFilter.value}`);
  if (state.selectedAges.size) parts.push(`연령: ${[...state.selectedAges].join(", ")}`);
  if (state.selectedDays.size) parts.push(`요일: ${[...state.selectedDays].join(", ")}`);
  if (elements.themeFilter.value && state.category !== "kids_cafe") parts.push(`주제: ${elements.themeFilter.value}`);
  if (elements.feeFilter.value && state.category !== "kids_cafe") parts.push(`요금: ${elements.feeFilter.value}`);
  if (state.selectedKidsOptions.size && state.category !== "museum") {
    parts.push(
      [...state.selectedKidsOptions].map((value) => (value === "weekend" ? "주말 운영" : "주차 가능")).join(", ")
    );
  }
  return parts;
}

function filterPlaces() {
  const query = elements.searchInput.value.trim().toLowerCase();
  const district = elements.districtFilter.value;
  const theme = elements.themeFilter.value;
  const fee = elements.feeFilter.value;

  state.filtered = state.places.filter((place) => {
    const categoryMatch = state.category === "all" || place.category === state.category;
    const queryMatch = !query || place.searchText.includes(query);
    const districtMatch = !district || place.district.split(";").map((part) => part.trim()).includes(district);
    const ageMatch = state.selectedAges.size === 0 || [...state.selectedAges].some((age) => place.ageGroups.includes(age));
    const dayMatch = state.selectedDays.size === 0 || [...state.selectedDays].every((day) => place.days.includes(day));
    const themeMatch = state.category === "kids_cafe" || !theme || place.theme === theme;
    const feeMatch = state.category === "kids_cafe" || !fee || place.fee === fee;
    const quickMatch = [...state.quickFilters].every((option) => {
      if (option === "today") return place.days.includes(TODAY_DAY);
      if (option === "free") return place.fee === "무료" || place.fee === "구민무료";
      if (option === "weekend") return place.days.includes("토") || place.days.includes("일") || place.openSaturday === true || place.openSunday === true;
      if (option === "official") return place.officialLinkReady === true;
      return true;
    });
    const kidsOptionMatch =
      state.category === "museum" ||
      [...state.selectedKidsOptions].every((option) => {
        if (place.category !== "kids_cafe") return true;
        if (option === "weekend") return place.openSaturday === true || place.openSunday === true;
        if (option === "parking") return place.parkingAvailable === true;
        return true;
      });
    return categoryMatch && queryMatch && districtMatch && ageMatch && dayMatch && themeMatch && feeMatch && quickMatch && kidsOptionMatch;
  });

  if (!state.filtered.some((place) => place.id === state.activeId)) state.activeId = "";
  elements.resultCount.textContent = `${state.filtered.length.toLocaleString("ko-KR")}개 장소`;
  const summary = activeSummary();
  elements.activeFilters.hidden = summary.length === 0;
  elements.activeFilters.textContent = summary.join(" · ");
  updateFilterSummaries();
  renderCards();
  updateMarkers();
}

function initMap() {
  state.map = L.map("map", { zoomControl: true, scrollWheelZoom: true }).setView(SEOUL_CENTER, DEFAULT_ZOOM);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(state.map);

  const mapContainer = state.map.getContainer();
  const handleShowList = (event) => {
    const button = event.target.closest("[data-popup-action='show-list']");
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    showPlaceCardInList(button.dataset.placeId || state.activeId);
    state.map.closePopup();
  };
  mapContainer.addEventListener("click", handleShowList, true);
  mapContainer.addEventListener("pointerup", handleShowList, true);
}

function markerIcon(place) {
  const color = place.category === "kids_cafe" ? "#d96c2d" : place.verificationStatus === "police_station_proxy" ? "#2f6f8f" : "#19755d";
  return L.divIcon({
    className: "place-marker",
    html: `<span style="background:${color}"></span>`,
    iconSize: [19, 19],
    iconAnchor: [9, 9],
  });
}

function popupHtml(place) {
  const image = place.imageUrl
    ? `<img src="${escapeHtml(place.imageUrl)}" alt="${escapeHtml(place.name)}" />`
    : `<div class="popup-placeholder">${escapeHtml(place.categoryLabel)}</div>`;
  return `
    <div class="popup-card">
      <h3>${escapeHtml(place.name)}</h3>
      ${image}
      <p>${escapeHtml(place.summary)}</p>
      <button type="button" class="popup-list-button" data-popup-action="show-list" data-place-id="${escapeHtml(place.id)}">
        목록에서 상세보기
      </button>
    </div>
  `;
}

function updateMarkers() {
  state.markers.forEach((marker) => marker.remove());
  state.markers.clear();
  const bounds = [];
  state.filtered.forEach((place) => {
    if (place.lat === null || place.lng === null) return;
    const marker = L.marker([place.lat, place.lng], { icon: markerIcon(place) }).addTo(state.map);
    marker.bindPopup(popupHtml(place));
    marker.on("click", () => setActivePlace(place.id, true));
    state.markers.set(place.id, marker);
    bounds.push([place.lat, place.lng]);
  });
  if (bounds.length) {
    state.map.fitBounds(bounds, { padding: [30, 30], maxZoom: 14 });
  } else {
    state.map.setView(SEOUL_CENTER, DEFAULT_ZOOM);
  }
}

function orderedPlacesForCards() {
  if (!state.activeId) return state.filtered;
  return [...state.filtered].sort((a, b) => {
    if (a.id === state.activeId) return -1;
    if (b.id === state.activeId) return 1;
    return 0;
  });
}

function renderCards() {
  elements.cardList.innerHTML = "";
  if (!state.filtered.length) {
    elements.cardList.innerHTML = '<div class="place-card"><div></div><div><h2 class="name">조건에 맞는 장소가 없습니다.</h2><p class="summary">검색어나 필터를 조정해 주세요.</p></div></div>';
    return;
  }

  orderedPlacesForCards().forEach((place) => {
    const fragment = elements.cardTemplate.content.cloneNode(true);
    const card = fragment.querySelector(".place-card");
    const thumbWrap = fragment.querySelector(".thumb-wrap");
    const thumb = fragment.querySelector(".thumb");
    const placeholder = fragment.querySelector(".placeholder");
    const categoryChip = fragment.querySelector(".category-chip");
    const subtypeChip = fragment.querySelector(".subtype-chip");
    const districtChip = fragment.querySelector(".district-chip");
    const quickFacts = fragment.querySelector(".quick-facts");
    const name = fragment.querySelector(".name");
    const summary = fragment.querySelector(".summary");
    const age = fragment.querySelector(".age");
    const operation = fragment.querySelector(".operation");
    const info = fragment.querySelector(".info");
    const note = fragment.querySelector(".note");
    const mapButton = fragment.querySelector(".map-button");
    const primaryLink = fragment.querySelector(".primary-link");
    const secondaryLink = fragment.querySelector(".secondary-link");

    card.dataset.id = place.id;
    card.dataset.category = place.category;
    card.classList.toggle("is-active", place.id === state.activeId);
    categoryChip.textContent = place.categoryLabel;
    subtypeChip.textContent = place.subtype;
    districtChip.textContent = place.district;
    name.textContent = place.name;
    summary.textContent = place.summary;
    age.textContent = place.ageLabel || "연령 확인 필요";
    operation.textContent = place.operationLabel || "운영 확인 필요";
    info.textContent = place.infoLabel || "정보 확인 필요";
    note.textContent = place.note;
    note.hidden = !place.note;
    placeholder.textContent = place.categoryLabel;
    quickFacts.innerHTML = "";
    (place.badges || []).slice(0, 4).forEach((label) => {
      const badge = document.createElement("span");
      badge.className = "fact-badge";
      if (label.includes("확인") || label.includes("재확인")) badge.classList.add("needs-check");
      if (label.includes("무료")) badge.classList.add("free");
      badge.textContent = label;
      quickFacts.append(badge);
    });

    if (place.imageUrl) {
      thumb.src = place.imageUrl;
      thumb.alt = `${place.name} 대표 이미지`;
      thumbWrap.classList.add("has-image");
      thumb.addEventListener("error", () => {
        thumb.removeAttribute("src");
        thumbWrap.classList.remove("has-image");
      });
    }

    configureLink(primaryLink, place.primaryUrl, place.primaryLabel || "자세히 보기");
    configureLink(secondaryLink, place.secondaryUrl, place.secondaryLabel || "");

    card.addEventListener("click", (event) => {
      if (event.target.closest("a, button")) return;
      setActivePlace(place.id, true);
    });
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        setActivePlace(place.id, true);
      }
    });
    mapButton.addEventListener("click", () => setActivePlace(place.id, true));
    elements.cardList.append(fragment);
  });
}

function configureLink(anchor, url, label) {
  if (url && label) {
    anchor.href = url;
    anchor.textContent = label;
    anchor.hidden = false;
    anchor.removeAttribute("aria-disabled");
    return;
  }
  anchor.removeAttribute("href");
  anchor.textContent = label || "링크 없음";
  anchor.setAttribute("aria-disabled", "true");
  anchor.hidden = !label;
}

function highlightActiveCard() {
  document.querySelectorAll(".place-card").forEach((card) => {
    card.classList.toggle("is-active", card.dataset.id === state.activeId);
  });
}

function focusActiveCard() {
  const active = document.querySelector(`.place-card[data-id="${state.activeId}"]`);
  active?.scrollIntoView({ block: "start", behavior: "smooth" });
  active?.focus({ preventScroll: true });
}

function showPlaceCardInList(placeId = state.activeId) {
  if (!placeId) return;
  state.activeId = placeId;
  renderCards();
  if (window.innerWidth <= 900) updateMobilePanel("list");
  requestAnimationFrame(focusActiveCard);
}

function setActivePlace(placeId, openPopup = false) {
  state.activeId = placeId;
  renderCards();
  const place = state.filtered.find((item) => item.id === placeId);
  const marker = state.markers.get(placeId);
  if (place && marker && place.lat !== null && place.lng !== null) {
    const zoom = 14;
    const target = L.latLng(place.lat, place.lng);
    const offset = window.innerWidth <= 640 ? 150 : 110;
    const center = state.map.unproject(state.map.project(target, zoom).subtract([0, offset]), zoom);
    if (openPopup) state.map.once("moveend", () => marker.openPopup());
    state.map.flyTo(center, zoom, { duration: 0.45 });
  }
  if (window.innerWidth > 900) focusActiveCard();
}

function updateMobilePanel(panel) {
  elements.content.dataset.mobileView = panel;
  elements.mapViewToggle.classList.toggle("is-active", panel === "map");
  elements.listViewToggle.classList.toggle("is-active", panel === "list");
  elements.mapViewToggle.setAttribute("aria-selected", String(panel === "map"));
  elements.listViewToggle.setAttribute("aria-selected", String(panel === "list"));
  if (panel === "map") requestAnimationFrame(() => state.map.invalidateSize());
}

function resetFilters() {
  elements.searchInput.value = "";
  elements.districtFilter.value = "";
  elements.themeFilter.value = "";
  elements.feeFilter.value = "";
  state.quickFilters.clear();
  state.selectedAges.clear();
  state.selectedDays.clear();
  state.selectedKidsOptions.clear();
  state.activeId = "";
  updateFilterSummaries();
  filterPlaces();
}

function bindEvents() {
  elements.searchInput.addEventListener("input", filterPlaces);
  elements.districtFilter.addEventListener("change", filterPlaces);
  elements.themeFilter.addEventListener("change", filterPlaces);
  elements.feeFilter.addEventListener("change", filterPlaces);
  elements.filterToggle.addEventListener("click", () => {
    updateFilterPanel(elements.filterToggle.getAttribute("aria-expanded") !== "true");
  });
  elements.resetFilters.addEventListener("click", resetFilters);
  elements.mapViewToggle.addEventListener("click", () => updateMobilePanel("map"));
  elements.listViewToggle.addEventListener("click", () => updateMobilePanel("list"));
  elements.quickFilters.querySelectorAll("[data-quick-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      const value = button.dataset.quickFilter;
      state.quickFilters.has(value) ? state.quickFilters.delete(value) : state.quickFilters.add(value);
      filterPlaces();
    });
  });

  document.querySelectorAll(".mode-tab").forEach((button) => {
    button.addEventListener("click", () => {
      state.category = button.dataset.category || "all";
      state.activeId = "";
      updateCategoryTabs();
      filterPlaces();
    });
  });

  elements.ageFilter.querySelectorAll("[data-age]").forEach((button) => {
    button.addEventListener("click", () => {
      const value = button.dataset.age;
      state.selectedAges.has(value) ? state.selectedAges.delete(value) : state.selectedAges.add(value);
      filterPlaces();
    });
  });
  elements.dayFilter.querySelectorAll("[data-day]").forEach((button) => {
    button.addEventListener("click", () => {
      const value = button.dataset.day;
      state.selectedDays.has(value) ? state.selectedDays.delete(value) : state.selectedDays.add(value);
      filterPlaces();
    });
  });
  elements.kidsOptionFilter.querySelectorAll("[data-kids-option]").forEach((button) => {
    button.addEventListener("click", () => {
      const value = button.dataset.kidsOption;
      state.selectedKidsOptions.has(value) ? state.selectedKidsOptions.delete(value) : state.selectedKidsOptions.add(value);
      filterPlaces();
    });
  });
}

async function main() {
  initMap();
  bindEvents();
  try {
    const [kidsRaw, museumsRaw] = await Promise.all([loadJson(DATA_URLS.kids), loadJson(DATA_URLS.museums)]);
    const kids = kidsRaw.map(normalizeKidsCafe);
    const museums = museumsRaw.map(normalizeMuseum);
    state.places = [...kids, ...museums].map(finalizePlace);
    updateCounts();
    initFilters();
    updateCategoryTabs();
    updateFilterSummaries();
    updateMobilePanel("map");
    updateFilterPanel(false);
    filterPlaces();
  } catch (error) {
    console.error(error);
    elements.cardList.innerHTML =
      '<div class="place-card"><div></div><div><h2 class="name">데이터를 불러오지 못했습니다.</h2><p class="summary">JSON 경로와 정적 서버 상태를 확인해 주세요.</p></div></div>';
    elements.resultCount.textContent = "0개 장소";
  }
}

main();
