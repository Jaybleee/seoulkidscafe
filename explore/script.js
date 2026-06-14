const DATA_URLS = {
  kids: ["../data/kids_cafes.json", "./data/kids_cafes.json", "/data/kids_cafes.json"],
  museums: ["../data/museums.json", "./data/museums.json", "/data/museums.json"],
  libraries: ["../data/libraries.json", "./data/libraries.json", "/data/libraries.json"],
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
  parking: "주차",
  favorites: "즐겨찾기",
};
const FAVORITES_KEY = "seoulKidsMapFavorites";
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
const CATEGORY_LABELS = {
  all: "전체",
  kids_cafe: "키즈카페",
  museum: "박물관·체험",
  library: "도서관",
};
const MUSEUM_LINK_OVERRIDES = {
  G밸리산업박물관: "https://gvmuseum.seoul.go.kr/",
  국립경찰박물관: "https://www.policemuseum.go.kr/",
  국립국악원: "https://www.gugak.go.kr/",
  국립기상박물관: "https://science.kma.go.kr/museum/",
  서울아트책보고: "https://artbookbogo.kr/",
  서울새활용플라자: "https://www.seoulup.or.kr/",
  키즈오토파크: "https://www.kidsautopark.org/",
  "키즈오토파크(서울)": "https://www.kidsautopark.org/",
};
const MUSEUM_PARKING_AVAILABLE_NAMES = new Set([
  "국립중앙박물관 어린이박물관",
  "국립항공박물관",
  "전쟁기념관 어린이박물관",
  "서대문자연사박물관",
  "서울기록원",
  "서울생활사박물관",
  "서울역사박물관 어린이박물관",
  "서울시립과학관",
  "서울에너지드림센터",
  "서울하수도과학관",
  "서울새활용플라자",
  "서울식물원",
  "송파책박물관",
  "은평역사한옥박물관",
  "허준박물관",
  "국립현대미술관 서울",
  "국회박물관",
]);

const state = {
  places: [],
  filtered: [],
  activeId: "",
  pinActiveToTop: false,
  category: "all",
  quickFilters: new Set(),
  selectedAges: new Set(),
  selectedDays: new Set(),
  selectedKidsOptions: new Set(),
  favorites: new Set(loadFavorites()),
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
  topbar: document.querySelector(".topbar"),
  searchToggle: document.getElementById("search-toggle"),
  content: document.querySelector(".content"),
  mapViewToggle: document.getElementById("map-view-toggle"),
  listViewToggle: document.getElementById("list-view-toggle"),
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

function loadFavorites() {
  try {
    const parsed = JSON.parse(localStorage.getItem(FAVORITES_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveFavorites() {
  try {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify([...state.favorites]));
  } catch {
    // Storage can be unavailable in some private browsing contexts.
  }
}

function toggleFavorite(placeId) {
  if (state.favorites.has(placeId)) {
    state.favorites.delete(placeId);
  } else {
    state.favorites.add(placeId);
  }
  saveFavorites();
  filterPlaces();
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

function compactKidsAgeLabel(ageText) {
  const text = clean(ageText);
  const match = text.match(/(\d+)\s*~\s*(\d+)\s*세/);
  if (!match) return text || "연령 확인";
  return `${match[1]}~${match[2]}세`;
}

function parseMuseumAgeGroups(value) {
  const ages = Array.isArray(value) ? value : [];
  return ages.filter((age) => ["영아", "유아", "초등"].includes(age));
}

function officialSearchUrl(name, district) {
  const query = encodeURIComponent(`${name} ${district} 공식`);
  return `https://search.naver.com/search.naver?query=${query}`;
}

function naverMapUrl(place) {
  const query = encodeURIComponent([place.name, place.address, place.district].filter(Boolean).join(" "));
  return `https://map.naver.com/p/search/${query}`;
}

function popupDirectLabel(place) {
  if (place.secondaryUrl) return "예약하기";
  const label = clean(place.primaryLabel).replace(/\s*→$/, "");
  if (!label || label.includes("공식") || label.includes("검색")) return "공식 페이지";
  if (label.includes("예약")) return "예약";
  return label.replace(/\s*보기$/, "");
}

function feeLabel(fee) {
  const value = clean(fee);
  if (!value) return "요금 확인";
  if (value === "무료" || value === "구민무료") return value;
  if (value === "일부유료") return "일부 유료";
  return value;
}

function todayStatus(days) {
  if (!days.length) return "운영 확인";
  return days.includes(TODAY_DAY) ? "🟢 오늘 운영" : "⚫ 오늘 휴무";
}

function fact(label, tone = "") {
  return { label, tone };
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
  const ageLabel = compactKidsAgeLabel(record.age);
  const parkingAvailable = parseNullableBoolean(record.parking_available);
  const parkingLabel = parkingAvailable === true ? "주차 가능" : parkingAvailable === false ? "주차 제한" : "주차 확인";
  const originalSummary = clean(record.feature_summary);
  const parentSummary = [
    `${ageLabel} 아이가 예약제로 이용하는 서울형 실내 놀이공간입니다.`,
    originalSummary ? originalSummary.replaceAll(" · ", ", ") : "운영 조건과 준비물을 확인해 방문 계획을 세우기 좋습니다.",
    `${parkingLabel}이며, 휴관일과 결제 방식은 방문 전 확인하세요.`,
  ].join(" ");
  return {
    id: `kids-${clean(record.id, String(index + 1))}`,
    category: "kids_cafe",
    categoryLabel: "키즈카페",
    subtype: clean(record.cafe_type, "서울형 키즈카페"),
    name: clean(record.name, "이름 확인 필요").replace(/^서울형\s*키즈카페\s*/u, "").replace(/^일반형\s*키즈카페\s*/u, ""),
    district: clean(record.district, "지역 확인 필요"),
    summary: parentSummary,
    ageLabel,
    ageGroups: parseKidsAgeGroups(record.age),
    operationLabel: operationDays,
    days,
    infoLabel: [clean(record.capacity), clean(record.parking_info)].filter(Boolean).join(" · ") || "이용 정보 확인 필요",
    note: clean(record.closed_days) ? `휴관: ${clean(record.closed_days)}` : "",
    imageUrl: clean(record.image_url),
    primaryUrl: clean(record.detail_url),
    secondaryUrl: clean(record.reserve_url),
    primaryLabel: "이용안내",
    secondaryLabel: "예약하기 →",
    reservationType: "umppa",
    reservationUrl: clean(record.reserve_url),
    lat: isValidCoordinate(record.lat) ? Number(record.lat) : null,
    lng: isValidCoordinate(record.lng) ? Number(record.lng) : null,
    openSaturday,
    openSunday,
    parkingAvailable,
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
    statusLabel: todayStatus(days),
    facts: [
      fact(ageLabel, "age"),
      fact("유료", "fee"),
      fact(parkingAvailable === true ? "주차 가능" : "주차 확인", "parking"),
    ],
    searchText: "",
  };
}

function museumSummary(record) {
  const theme = clean(record.theme, "서울미래아이");
  const keyword = clean(record.keyword, "체험");
  const age = Array.isArray(record.recommended_age) ? record.recommended_age.join(", ") : "아이";
  const fee = feeLabel(record.fee);
  const status =
    record.verification_status === "police_station_proxy"
      ? "청소년경찰학교는 관할 경찰서별 프로그램 여부를 먼저 확인하고 예약 문의가 필요합니다."
      : "전시 구성과 체험 프로그램 일정을 공식 페이지에서 확인해 방문 시간을 정하기 좋습니다.";
  return `${keyword}를 아이 눈높이로 접하는 ${theme}형 공간입니다. ${age} 아이와 ${fee}로 방문하기 좋은 후보이며, ${status}`;
}

function normalizeMuseum(record, index) {
  const days = Array.isArray(record.pdf_operating_days) ? record.pdf_operating_days : [];
  const note = clean(record.notes);
  const placeName = clean(record.name, "박물관");
  const needsLinkReview = LINK_REVIEW_NAMES.has(placeName);
  const useSearchFallback = SEARCH_FALLBACK_NAMES.has(placeName);
  const websiteUrl = MUSEUM_LINK_OVERRIDES[placeName] || (useSearchFallback ? "" : clean(record.website_url));
  const hasOfficialLink = Boolean(websiteUrl);
  const fee = clean(record.fee);
  const parkingAvailable = MUSEUM_PARKING_AVAILABLE_NAMES.has(placeName);
  const badges = [
    days.includes(TODAY_DAY) ? "오늘 운영" : "",
    feeLabel(fee),
    parkingAvailable ? "주차 가능" : "",
    needsLinkReview ? "링크 확인" : "",
    record.verification_status === "police_station_proxy" ? "위치 재확인" : "",
  ].filter(Boolean);
  const ageLabel = Array.isArray(record.recommended_age) ? record.recommended_age.join(", ") : "연령 확인";
  const facts = [fact(ageLabel, "age"), fact(feeLabel(fee), "fee")];
  if (parkingAvailable) facts.push(fact("주차 가능", "parking"));
  facts.push(fact(clean(record.keyword, "체험"), "topic"));
  return {
    id: `museum-${clean(record.id, String(index + 1))}`,
    category: "museum",
    categoryLabel: "박물관·체험",
    subtype: clean(record.theme, "서울미래아이"),
    name: placeName,
    district: clean(record.district, "지역 확인 필요"),
    summary: museumSummary(record),
    ageLabel,
    ageGroups: parseMuseumAgeGroups(record.recommended_age),
    operationLabel: days.length ? days.join(", ") : "운영일 확인 필요",
    days,
    infoLabel: `${clean(record.keyword, "키워드 확인")} · ${feeLabel(fee)}`,
    note:
      note ||
      (needsLinkReview
        ? "방문 전 운영정보를 다시 확인해 주세요."
        : !hasOfficialLink
          ? "공식 페이지 미확인: 방문 전 검색 결과에서 운영정보를 확인해 주세요."
          : ""),
    imageUrl: clean(record.image_url),
    primaryUrl: websiteUrl || officialSearchUrl(placeName, clean(record.district, "서울")),
    secondaryUrl: "",
    primaryLabel: hasOfficialLink ? "공식 페이지 →" : "공식 검색",
    secondaryLabel: "",
    reservationType: hasOfficialLink ? "external" : "none",
    reservationUrl: "",
    lat: isValidCoordinate(record.lat) ? Number(record.lat) : null,
    lng: isValidCoordinate(record.lng) ? Number(record.lng) : null,
    theme: clean(record.theme),
    fee,
    verificationStatus: clean(record.verification_status),
    hasOfficialLink,
    officialLinkReady: hasOfficialLink && !needsLinkReview,
    hasReservation: false,
    parkingAvailable,
    badges,
    statusLabel: todayStatus(days),
    facts,
    searchText: "",
  };
}

function normalizeLibrary(record, index) {
  const days = Array.isArray(record.operating_days) ? record.operating_days : daysFromText(record.operating_days);
  const ageGroups = Array.isArray(record.recommended_age) ? parseMuseumAgeGroups(record.recommended_age) : ["영아", "유아", "초등"];
  const websiteUrl = clean(record.website_url);
  const parkingAvailable = parseNullableBoolean(record.parking_available);
  return {
    id: `library-${clean(record.id, String(index + 1))}`,
    category: "library",
    categoryLabel: "도서관",
    subtype: clean(record.library_type, "어린이도서관"),
    name: clean(record.name, "어린이도서관"),
    district: clean(record.district, "지역 확인 필요"),
    address: clean(record.address),
    summary: clean(record.summary, "그림책과 어린이 자료, 독서문화 프로그램을 함께 확인할 수 있는 어린이도서관입니다."),
    ageLabel: ageGroups.join(", ") || "영아, 유아, 초등",
    ageGroups,
    operationLabel: days.length ? days.join(", ") : clean(record.operation_label, "운영일 확인 필요"),
    days,
    infoLabel: clean(record.info_label, "자료실 · 독서문화 프로그램"),
    note: clean(record.note),
    imageUrl: clean(record.image_url),
    primaryUrl: websiteUrl,
    secondaryUrl: "",
    primaryLabel: websiteUrl ? "공식 페이지 →" : "",
    secondaryLabel: "",
    reservationType: websiteUrl ? "external" : "none",
    reservationUrl: "",
    lat: isValidCoordinate(record.lat) ? Number(record.lat) : null,
    lng: isValidCoordinate(record.lng) ? Number(record.lng) : null,
    theme: "도서관",
    fee: "무료",
    verificationStatus: clean(record.verification_status, "official_location"),
    hasOfficialLink: Boolean(websiteUrl),
    officialLinkReady: Boolean(websiteUrl),
    hasReservation: false,
    openSaturday: days.includes("토"),
    openSunday: days.includes("일"),
    parkingAvailable,
    badges: [days.includes(TODAY_DAY) ? "오늘 운영" : "", "무료", parkingAvailable === true ? "주차 가능" : ""].filter(Boolean),
    statusLabel: todayStatus(days),
    facts: [fact(ageGroups.join(", ") || "어린이", "age"), fact("무료", "free")].concat(
      parkingAvailable === true ? [fact("주차 가능", "parking")] : []
    ),
    searchText: "",
  };
}

function finalizePlace(place) {
  place.searchText = `${place.name} ${place.categoryLabel} ${place.subtype} ${place.district} ${place.address || ""} ${place.summary} ${place.infoLabel}`.toLowerCase();
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
  // Counts were intentionally removed from the category tabs for mobile space.
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
  elements.filterToggle.setAttribute("aria-expanded", String(open));
  elements.filterToggle.setAttribute("aria-label", open ? "필터 닫기" : "필터 열기");
  elements.filterPanel.hidden = !open;
  elements.filterPanel.classList.toggle("is-collapsed", !open);
}

function updateCategoryTabs() {
  document.querySelectorAll(".mode-tab").forEach((button) => {
    const isActive = button.dataset.category === state.category;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  });
  const showMuseumFilters = state.category === "all" || state.category === "museum";
  const showKidsFilters = state.category === "all" || state.category === "kids_cafe";
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
  elements.quickFilters.querySelectorAll("[data-quick-age]").forEach((button) => {
    const selected = state.selectedAges.has(button.dataset.quickAge);
    button.classList.toggle("is-selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
}

function activeSummary() {
  const parts = [];
  if (state.quickFilters.size) parts.push([...state.quickFilters].map((value) => QUICK_FILTER_LABELS[value]).join(", "));
  if (state.category !== "all") parts.push(CATEGORY_LABELS[state.category] || state.category);
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
      if (option === "parking") return place.parkingAvailable === true;
      if (option === "favorites") return state.favorites.has(place.id);
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

  if (!state.filtered.some((place) => place.id === state.activeId)) {
    state.activeId = "";
    state.pinActiveToTop = false;
  }
  elements.resultCount.textContent = `${state.filtered.length.toLocaleString("ko-KR")}곳 표시 중`;
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
  const color =
    place.category === "kids_cafe"
      ? "#e07b39"
      : place.category === "library"
        ? "#6366f1"
        : "#2d6a4f";
  return L.divIcon({
    className: "place-marker",
    html: `<span style="background:${color}"></span>`,
    iconSize: [19, 19],
    iconAnchor: [9, 9],
  });
}

function popupHtml(place) {
  const image = place.imageUrl
    ? `<img src="${escapeHtml(place.imageUrl)}" alt="${escapeHtml(place.name)}" onerror="this.hidden=true;this.nextElementSibling.hidden=false;" /><div class="popup-placeholder" hidden>${escapeHtml(place.categoryLabel)}</div>`
    : `<div class="popup-placeholder">${escapeHtml(place.categoryLabel)}</div>`;
  const facts = (place.facts || [])
    .slice(0, 3)
    .map((item) => `<span>${escapeHtml(item.label)}</span>`)
    .join("");
  const directUrl = place.secondaryUrl || place.primaryUrl;
  const directLabel = directUrl ? popupDirectLabel(place) : "";
  const directAction = directUrl
    ? `<a class="popup-action primary" href="${escapeHtml(directUrl)}" target="_blank" rel="noreferrer noopener">${escapeHtml(directLabel)}</a>`
    : "";
  const naverAction = `<a class="popup-action naver" href="${escapeHtml(naverMapUrl(place))}" target="_blank" rel="noreferrer noopener">네이버지도</a>`;
  return `
    <div class="popup-card">
      <div class="popup-meta">
        <span>${escapeHtml(place.district)}</span>
        <strong>${escapeHtml(place.categoryLabel)}</strong>
      </div>
      <h3>${escapeHtml(place.name)}</h3>
      ${image}
      <p class="popup-summary">${escapeHtml(place.summary || "")}</p>
      <div class="popup-facts">${facts}</div>
      <div class="popup-actions">
        <button type="button" class="popup-action" data-popup-action="show-list" data-place-id="${escapeHtml(place.id)}">세부내용</button>
        ${naverAction}
        ${directAction}
      </div>
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
    marker.on("click", () => setActivePlace(place.id, { openPopup: true, pinToTop: true }));
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
  if (!state.activeId || !state.pinActiveToTop) return state.filtered;
  return [...state.filtered].sort((a, b) => {
    if (a.id === state.activeId) return -1;
    if (b.id === state.activeId) return 1;
    return 0;
  });
}

function renderCards() {
  elements.cardList.innerHTML = "";
  if (!state.filtered.length) {
    elements.cardList.innerHTML =
      '<div class="empty-state"><strong>조건에 맞는 장소가 없어요</strong><p>검색어나 필터를 조금 바꿔볼까요?</p><button type="button" data-empty-reset>초기화하고 다시 보기</button></div>';
    elements.cardList.querySelector("[data-empty-reset]")?.addEventListener("click", resetFilters);
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
    const statusChip = fragment.querySelector(".status-chip");
    const favoriteButton = fragment.querySelector(".favorite-button");
    const quickFacts = fragment.querySelector(".quick-facts");
    const name = fragment.querySelector(".name");
    const summary = fragment.querySelector(".summary");
    const age = fragment.querySelector(".age");
    const operation = fragment.querySelector(".operation");
    const info = fragment.querySelector(".info");
    const note = fragment.querySelector(".note");
    const mapButton = fragment.querySelector(".map-button");
    const naverLink = fragment.querySelector(".naver-link");
    const primaryLink = fragment.querySelector(".primary-link");
    const secondaryLink = fragment.querySelector(".secondary-link");

    card.dataset.id = place.id;
    card.dataset.category = place.category;
    card.classList.toggle("is-favorite", state.favorites.has(place.id));
    card.classList.toggle("is-active", place.id === state.activeId);
    categoryChip.textContent = place.categoryLabel;
    subtypeChip.textContent = place.subtype;
    districtChip.textContent = place.district;
    const statusLabel = place.statusLabel || "운영 확인";
    statusChip.textContent = statusLabel;
    statusChip.classList.toggle("is-closed", statusLabel.includes("휴무"));
    favoriteButton.textContent = state.favorites.has(place.id) ? "♥" : "♡";
    favoriteButton.setAttribute("aria-label", state.favorites.has(place.id) ? "즐겨찾기 해제" : "즐겨찾기 저장");
    name.textContent = place.name;
    summary.textContent = place.summary;
    age.textContent = place.ageLabel || "연령 확인 필요";
    operation.textContent = place.operationLabel || "운영 확인 필요";
    info.textContent = place.infoLabel || "정보 확인 필요";
    note.textContent = place.note;
    note.hidden = !place.note;
    placeholder.textContent = place.categoryLabel;
    quickFacts.innerHTML = "";
    (place.facts || []).slice(0, 4).forEach((item) => {
      const badge = document.createElement("span");
      badge.className = "fact-badge";
      if (item.tone) badge.classList.add(item.tone);
      if (item.label.includes("확인") || item.label.includes("재확인")) badge.classList.add("needs-check");
      if (item.label.includes("무료")) badge.classList.add("free");
      badge.textContent = item.label;
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

    configureLink(naverLink, naverMapUrl(place), "네이버지도 보기");
    configureLink(primaryLink, place.primaryUrl, place.primaryLabel || "자세히 보기");
    configureLink(secondaryLink, place.secondaryUrl, place.secondaryLabel || "");

    card.addEventListener("click", (event) => {
      if (event.target.closest("a, button")) return;
      setActivePlace(place.id, { openPopup: false, pinToTop: false });
    });
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        setActivePlace(place.id, { openPopup: false, pinToTop: false });
      }
    });
    mapButton.addEventListener("click", () => setActivePlace(place.id, { openPopup: true, pinToTop: false, switchToMap: true }));
    favoriteButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggleFavorite(place.id);
    });
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
  anchor.textContent = "";
  anchor.setAttribute("aria-disabled", "true");
  anchor.hidden = true;
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
  state.pinActiveToTop = true;
  renderCards();
  updateMobilePanel("list");
  requestAnimationFrame(focusActiveCard);
}

function setActivePlace(placeId, options = {}) {
  const { openPopup = false, pinToTop = false, switchToMap = false } = options;
  state.activeId = placeId;
  state.pinActiveToTop = pinToTop;
  renderCards();
  const place = state.filtered.find((item) => item.id === placeId);
  const marker = state.markers.get(placeId);
  if (place && marker && place.lat !== null && place.lng !== null) {
    if (switchToMap) updateMobilePanel("map");
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
  state.pinActiveToTop = false;
  updateFilterSummaries();
  filterPlaces();
}

function bindEvents() {
  elements.searchToggle.addEventListener("click", () => {
    const open = !elements.topbar.classList.contains("is-search-open");
    elements.topbar.classList.toggle("is-search-open", open);
    elements.searchToggle.setAttribute("aria-expanded", String(open));
    elements.searchToggle.setAttribute("aria-label", open ? "검색 닫기" : "검색 열기");
    if (open) requestAnimationFrame(() => elements.searchInput.focus());
  });
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
  elements.quickFilters.querySelectorAll("[data-quick-age]").forEach((button) => {
    button.addEventListener("click", () => {
      const value = button.dataset.quickAge;
      state.selectedAges.has(value) ? state.selectedAges.delete(value) : state.selectedAges.add(value);
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
    const [kidsRaw, museumsRaw, librariesRaw] = await Promise.all([
      loadJson(DATA_URLS.kids),
      loadJson(DATA_URLS.museums),
      loadJson(DATA_URLS.libraries).catch(() => []),
    ]);
    const kids = kidsRaw.map(normalizeKidsCafe);
    const museums = museumsRaw.map(normalizeMuseum);
    const libraries = librariesRaw.map(normalizeLibrary);
    state.places = [...kids, ...museums, ...libraries].map(finalizePlace);
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
    elements.resultCount.textContent = "0곳 표시 중";
  }
}

main();
