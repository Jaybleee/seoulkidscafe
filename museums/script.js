const DATA_URLS = ["../data/museums.json", "./data/museums.json", "/data/museums.json"];
const SEOUL_CENTER = [37.5665, 126.978];

const state = {
  museums: [],
  filtered: [],
  markers: new Map(),
  activeId: "",
  map: null,
};

const elements = {
  search: document.getElementById("search-input"),
  theme: document.getElementById("theme-filter"),
  district: document.getElementById("district-filter"),
  age: document.getElementById("age-filter"),
  fee: document.getElementById("fee-filter"),
  reset: document.getElementById("reset-filters"),
  resultCount: document.getElementById("result-count"),
  activeSummary: document.getElementById("active-summary"),
  totalCount: document.getElementById("total-count"),
  verifiedCount: document.getElementById("verified-count"),
  imageCount: document.getElementById("image-count"),
  cardList: document.getElementById("card-list"),
  template: document.getElementById("card-template"),
  workspace: document.querySelector(".workspace"),
  showMap: document.getElementById("show-map"),
  showList: document.getElementById("show-list"),
};

function text(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function isNumber(value) {
  return Number.isFinite(Number(value));
}

function normalize(record, index) {
  return {
    id: text(record.id, `museum-${index + 1}`),
    name: text(record.name, "이름 확인 필요"),
    theme: text(record.theme, "기타"),
    keyword: text(record.keyword),
    district: text(record.district, "지역 확인 필요"),
    recommended_age: asArray(record.recommended_age),
    fee: text(record.fee, "요금 확인 필요"),
    pdf_operating_days: asArray(record.pdf_operating_days),
    address: text(record.address, "주소 확인 필요"),
    lat: isNumber(record.lat) ? Number(record.lat) : null,
    lng: isNumber(record.lng) ? Number(record.lng) : null,
    website_url: text(record.website_url),
    image_url: text(record.image_url),
    source_type: text(record.source_type, "pdf"),
    verification_status: text(record.verification_status, "needs_review"),
    notes: text(record.notes),
  };
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function loadData() {
  let lastError;
  for (const url of DATA_URLS) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`);
      }
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

function initFilters() {
  const themes = [...new Set(state.museums.map((item) => item.theme))].sort((a, b) => a.localeCompare(b, "ko"));
  const districts = [...new Set(state.museums.flatMap((item) => item.district.split(";")).map((v) => v.trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, "ko")
  );
  const fees = [...new Set(state.museums.map((item) => item.fee))].sort((a, b) => a.localeCompare(b, "ko"));
  fillSelect(elements.theme, themes);
  fillSelect(elements.district, districts);
  fillSelect(elements.fee, fees);
}

function updateStats() {
  elements.totalCount.textContent = state.museums.length.toLocaleString("ko-KR");
  elements.verifiedCount.textContent = state.museums
    .filter((item) => item.verification_status === "geocoded" || item.verification_status === "naver_search")
    .length.toLocaleString("ko-KR");
  elements.imageCount.textContent = state.museums.filter((item) => item.image_url).length.toLocaleString("ko-KR");
}

function initMap() {
  state.map = L.map("map", { scrollWheelZoom: true }).setView(SEOUL_CENTER, 11);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(state.map);
}

function markerColor(item) {
  if (item.verification_status === "geocoded" || item.verification_status === "naver_search") return "#19755d";
  if (item.verification_status === "police_station_proxy") return "#2f6f8f";
  return "#d84f3f";
}

function markerIcon(item) {
  return L.divIcon({
    className: "museum-marker",
    html: `<span style="background:${markerColor(item)}"></span>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });
}

function popupHtml(item) {
  const image = item.image_url
    ? `<img src="${escapeHtml(item.image_url)}" alt="${escapeHtml(item.name)}" />`
    : `<div class="popup-placeholder">${escapeHtml(item.theme)}</div>`;
  const link = item.website_url ? `<a href="${escapeHtml(item.website_url)}" target="_blank" rel="noreferrer noopener">공식 페이지</a>` : "";
  return `
    <div class="popup-card">
      <h3>${escapeHtml(item.name)}</h3>
      ${image}
      <p>${escapeHtml(item.keyword)} · ${escapeHtml(item.district)}</p>
      <p>${escapeHtml(statusLabel(item))}</p>
      ${link}
    </div>
  `;
}

function updateMarkers() {
  state.markers.forEach((marker) => marker.remove());
  state.markers.clear();
  const bounds = [];

  state.filtered.forEach((item) => {
    if (item.lat === null || item.lng === null) return;
    const marker = L.marker([item.lat, item.lng], { icon: markerIcon(item) }).addTo(state.map);
    marker.bindPopup(popupHtml(item));
    marker.on("click", () => setActive(item.id, false));
    state.markers.set(item.id, marker);
    bounds.push([item.lat, item.lng]);
  });

  if (bounds.length > 0) {
    state.map.fitBounds(bounds, { padding: [32, 32], maxZoom: 14 });
  } else {
    state.map.setView(SEOUL_CENTER, 11);
  }
}

function statusLabel(item) {
  if (item.verification_status === "geocoded") return "좌표 확인";
  if (item.verification_status === "naver_search") return "네이버 위치 확인";
  if (item.verification_status === "police_station_proxy") return "경찰서 위치 기준";
  if (item.verification_status === "approximate") return "자치구 임시 위치";
  return "정보 확인 필요";
}

function activeSummary() {
  const parts = [];
  if (elements.search.value.trim()) parts.push(`검색: ${elements.search.value.trim()}`);
  if (elements.theme.value) parts.push(`주제: ${elements.theme.value}`);
  if (elements.district.value) parts.push(`지역: ${elements.district.value}`);
  if (elements.age.value) parts.push(`연령: ${elements.age.value}`);
  if (elements.fee.value) parts.push(`요금: ${elements.fee.value}`);
  return parts.length ? parts.join(" · ") : "필터 없음";
}

function filterMuseums() {
  const query = elements.search.value.trim().toLowerCase();
  const theme = elements.theme.value;
  const district = elements.district.value;
  const age = elements.age.value;
  const fee = elements.fee.value;

  state.filtered = state.museums.filter((item) => {
    const haystack = `${item.name} ${item.theme} ${item.keyword} ${item.district} ${item.address}`.toLowerCase();
    return (
      (!query || haystack.includes(query)) &&
      (!theme || item.theme === theme) &&
      (!district || item.district.split(";").map((v) => v.trim()).includes(district)) &&
      (!age || item.recommended_age.includes(age)) &&
      (!fee || item.fee === fee)
    );
  });

  if (!state.filtered.some((item) => item.id === state.activeId)) {
    state.activeId = "";
  }

  elements.resultCount.textContent = `${state.filtered.length.toLocaleString("ko-KR")}개 표시 중`;
  elements.activeSummary.textContent = activeSummary();
  renderCards();
  updateMarkers();
}

function renderCards() {
  elements.cardList.innerHTML = "";
  if (state.filtered.length === 0) {
    elements.cardList.innerHTML = `<div class="museum-card"><div></div><div><h2 class="name">조건에 맞는 시설이 없습니다.</h2><p class="keyword">검색어나 필터를 조정해 주세요.</p></div></div>`;
    return;
  }

  state.filtered.forEach((item) => {
    const fragment = elements.template.content.cloneNode(true);
    const card = fragment.querySelector(".museum-card");
    const imageBox = fragment.querySelector(".image-box");
    const thumb = fragment.querySelector(".thumb");
    const fallbackTheme = fragment.querySelector(".fallback-theme");
    const theme = fragment.querySelector(".theme-chip");
    const district = fragment.querySelector(".district-chip");
    const status = fragment.querySelector(".status-chip");
    const name = fragment.querySelector(".name");
    const keyword = fragment.querySelector(".keyword");
    const age = fragment.querySelector(".age");
    const fee = fragment.querySelector(".fee");
    const days = fragment.querySelector(".days");
    const address = fragment.querySelector(".address");
    const notes = fragment.querySelector(".notes");
    const mapButton = fragment.querySelector(".map-button");
    const siteButton = fragment.querySelector(".site-button");

    card.dataset.id = item.id;
    theme.textContent = item.theme;
    district.textContent = item.district;
    status.textContent = statusLabel(item);
    status.classList.toggle("is-verified", item.verification_status === "geocoded" || item.verification_status === "naver_search");
    name.textContent = item.name;
    keyword.textContent = `#${item.keyword}`;
    age.textContent = item.recommended_age.join(", ") || "확인 필요";
    fee.textContent = item.fee;
    days.textContent = item.pdf_operating_days.join(", ") || "확인 필요";
    address.textContent = item.address;
    fallbackTheme.textContent = item.theme;
    notes.textContent = item.notes || (item.verification_status === "approximate" ? "자치구 중심 좌표로 임시 표시 중입니다." : "");
    notes.hidden = !notes.textContent;

    if (item.image_url) {
      thumb.src = item.image_url;
      thumb.alt = `${item.name} 대표 이미지`;
      imageBox.classList.add("has-image");
      thumb.addEventListener("error", () => {
        imageBox.classList.remove("has-image");
        thumb.removeAttribute("src");
      });
    }

    if (item.website_url) {
      siteButton.href = item.website_url;
    } else {
      siteButton.removeAttribute("href");
      siteButton.setAttribute("aria-disabled", "true");
      siteButton.textContent = "공식 페이지 확인 필요";
    }

    card.addEventListener("click", (event) => {
      if (event.target.closest("a, button")) return;
      setActive(item.id, true);
    });
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        setActive(item.id, true);
      }
    });
    mapButton.addEventListener("click", () => setActive(item.id, true));
    elements.cardList.append(fragment);
  });
  highlightActive();
}

function highlightActive() {
  document.querySelectorAll(".museum-card").forEach((card) => {
    card.classList.toggle("is-active", card.dataset.id === state.activeId);
  });
}

function setActive(id, openPopup) {
  state.activeId = id;
  highlightActive();
  const item = state.filtered.find((entry) => entry.id === id);
  const marker = state.markers.get(id);
  if (!item || !marker) return;
  state.map.setView([item.lat, item.lng], Math.max(state.map.getZoom(), 14), { animate: true });
  if (openPopup) marker.openPopup();
  if (window.innerWidth <= 860) setMobileView("map");
}

function setMobileView(view) {
  elements.workspace.dataset.mobileView = view;
  elements.showMap.classList.toggle("is-active", view === "map");
  elements.showList.classList.toggle("is-active", view === "list");
  elements.showMap.setAttribute("aria-selected", String(view === "map"));
  elements.showList.setAttribute("aria-selected", String(view === "list"));
  if (view === "map") requestAnimationFrame(() => state.map.invalidateSize());
}

async function init() {
  initMap();
  const raw = await loadData();
  state.museums = raw.map(normalize);
  state.filtered = [...state.museums];
  initFilters();
  updateStats();
  filterMuseums();

  [elements.search, elements.theme, elements.district, elements.age, elements.fee].forEach((element) => {
    element.addEventListener("input", filterMuseums);
    element.addEventListener("change", filterMuseums);
  });
  elements.reset.addEventListener("click", () => {
    elements.search.value = "";
    elements.theme.value = "";
    elements.district.value = "";
    elements.age.value = "";
    elements.fee.value = "";
    filterMuseums();
  });
  elements.showMap.addEventListener("click", () => setMobileView("map"));
  elements.showList.addEventListener("click", () => setMobileView("list"));
}

init().catch((error) => {
  console.error(error);
  elements.cardList.innerHTML = `<div class="museum-card"><div></div><div><h2 class="name">데이터를 불러오지 못했습니다.</h2><p class="keyword">${escapeHtml(error.message)}</p></div></div>`;
});
