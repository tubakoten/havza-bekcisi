// Havza Bekçisi – istemci tarafı
// Harita, göl sınırı, yer arama, analiz, önceliklendirme, tarih geçmişi ve test istatistikleri.

/* ---------- Sabitler ---------- */

const ESRI_CURRENT = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const waybackTileUrl = (release, tile) =>
  `https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/WMTS/1.0.0/default028mm/MapServer/tile/${release}/${tile.z}/${tile.y}/${tile.x}`;

// Ana Overpass sunucusu yavaşsa sırayla yedeklere geçilir
const OVERPASS_URLS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];
const OVERPASS_TIMEOUT_MS = 20000;
// (güney, batı, kuzey, doğu) kutusu içinde adı "Büyükçekmece" geçen su alanları
const OVERPASS_QUERY =
  '[out:json][timeout:25];nwr["natural"="water"]["name"~"Büyükçekmece"](40.95,28.40,41.25,28.75);out geom;';

// Yer arama: OpenStreetMap Nominatim, Büyükçekmece havzası çevresiyle sınırlı
const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const SEARCH_VIEWBOX = "28.30,41.30,28.80,40.95"; // batı, kuzey, doğu, güney

const STORAGE_KEY = "havza-bekcisi:points:v1";
const LAKE_CACHE_KEY = "havza-bekcisi:lake:v1";
const SOURCE_KEY = "havza-bekcisi:source:v1"; // "file": sonuçlar test-results.json'dan yüklendi
const SEED_FILE = "test-results.json";

const CATEGORY_LABELS = {
  kacak_dokum: "Kaçak döküm şüphesi",
  yasal_insaat: "Yasal inşaat",
  tarim: "Tarım",
  yol_altyapi: "Yol veya altyapı",
  degisim_yok: "Değişim yok",
  belirsiz: "Belirsiz",
};
const CATEGORY_WEIGHT = { kacak_dokum: 1, belirsiz: 0.5 };
const LEVELS = {
  yuksek: { label: "Yüksek öncelik", color: "#a9561c" },
  orta: { label: "Orta öncelik", color: "#b98a24" },
  dusuk: { label: "Düşük öncelik", color: "#4e6b3b" },
};

const $ = (sel) => document.querySelector(sel);

/* ---------- Durum ---------- */

let points = loadPoints();
let releases = [];
let pending = null; // haritada seçilmiş ama henüz analiz edilmemiş nokta
let pendingMarker = null;
let openId = null; // açık kartın id'si
let placeFound = false; // rehberin 1. adımı tamamlandı mı
let activeTab = "analyze";
let resultFilter = "all"; // all | high | unlabeled
const historyOpen = new Set(); // tarih geçmişi bölümü açık olan kartlar
const lakeLines = [];
const lakePolygons = [];
const markers = new Map();
let selectedHalo = null;

/* ---------- Kayıt ---------- */

function loadPoints() {
  try {
    return (JSON.parse(localStorage.getItem(STORAGE_KEY)) ?? []).map(normalizePoint);
  } catch {
    return [];
  }
}

// Eski kayıtları "analiz geçmişi" yapısına taşır
function normalizePoint(p) {
  if (!Array.isArray(p.analyses)) {
    p.analyses = [
      {
        beforeRelease: p.beforeRelease,
        beforeDate: p.beforeDate,
        result: p.result,
        model: p.model,
        createdAt: p.createdAt,
      },
    ];
  }
  if (p.viewRelease === undefined || p.viewRelease === null) p.viewRelease = p.beforeRelease;
  return p;
}

function savePoints() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(points));
  } catch {
    setStatus("Sonuçlar tarayıcıya kaydedilemedi; sayfa yenilenirse kaybolur.", true);
  }
}

// Bir analizi noktanın geçerli (öncelik ve istatistikte kullanılan) analizi yapar
function setActiveAnalysis(p, analysis) {
  p.beforeRelease = analysis.beforeRelease;
  p.beforeDate = analysis.beforeDate;
  p.result = analysis.result;
  p.model = analysis.model;
  p.viewRelease = analysis.beforeRelease;
  p.score = priorityOf(analysis.result, p.distanceKm);
}

function dateOfRelease(releaseNum, fallback = null) {
  return releases.find((r) => r.releaseNum === releaseNum)?.date ?? fallback;
}

/* ---------- Yardımcılar ---------- */

function setHint(text, isError = false) {
  const node = $("#mapHint");
  node.textContent = text;
  node.classList.toggle("is-error", isError);
}

function setStatus(text, isError = false) {
  const node = $("#status");
  node.textContent = text;
  node.classList.toggle("is-error", isError);
}

function formatDate(iso) {
  if (!iso) return "bilinmeyen tarih";
  return new Date(`${iso}T00:00:00`).toLocaleDateString("tr-TR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function formatDistance(km) {
  if (km === null || km === undefined) return "bilinmiyor";
  if (km === 0) return "göl sınırı içinde";
  if (km < 1) return `${Math.round(km * 1000).toLocaleString("tr-TR")} m`;
  return `${km.toLocaleString("tr-TR", { maximumFractionDigits: 2 })} km`;
}

function formatKm(km) {
  if (km === null || km === undefined) return "göle mesafe bilinmiyor";
  if (km === 0) return "göl sınırı içinde";
  return `göle ${formatDistance(km)}`;
}

// İSKİ havza koruma bantları (göl kıyısından yaklaşık mesafeye göre)
function protectionBand(km) {
  if (km === null || km === undefined) return { label: "Bilinmiyor", tone: "muted" };
  if (km <= 0.3) return { label: "Mutlak koruma alanı", tone: "high" };
  if (km <= 1) return { label: "Kısa mesafeli koruma alanı", tone: "mid" };
  if (km <= 2) return { label: "Orta mesafeli koruma alanı", tone: "low" };
  return { label: "Uzun mesafeli koruma alanı", tone: "muted" };
}

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value);
  }
  for (const child of [].concat(children)) if (child) node.append(child);
  return node;
}

/* ---------- Sekmeler ve rehber ---------- */

function setTab(name) {
  activeTab = name;
  const analyze = name === "analyze";
  $("#tabAnalyze").setAttribute("aria-selected", String(analyze));
  $("#tabResults").setAttribute("aria-selected", String(!analyze));
  $("#panelAnalyze").hidden = !analyze;
  $("#panelResults").hidden = analyze;
}

function renderSteps() {
  const current = pending ? 3 : placeFound ? 2 : 1;
  for (const li of document.querySelectorAll("#steps li")) {
    const step = Number(li.dataset.step);
    li.classList.toggle("is-current", step === current);
    li.classList.toggle("is-done", step < current);
  }
}

/* ---------- Harita ---------- */

const map = L.map("map", { zoomControl: true }).setView([41.08, 28.56], 12);
L.tileLayer(ESRI_CURRENT, {
  maxZoom: 19,
  attribution: "Görüntü: Esri World Imagery",
}).addTo(map);

function updateZoomReadout() {
  $("#coordZoom").textContent = String(map.getZoom());
}
map.on("mousemove", (e) => {
  $("#coordLatLon").textContent = `${e.latlng.lat.toFixed(5)}° K, ${e.latlng.lng.toFixed(5)}° D`;
});
map.on("zoomend", updateZoomReadout);

map.on("zoomend", () => {
  if (!placeFound && map.getZoom() >= 15) {
    placeFound = true;
    renderSteps();
  }
});

map.on("click", (e) => {
  pending = { lat: e.latlng.lat, lon: e.latlng.lng };
  if (pendingMarker) {
    pendingMarker.setLatLng(e.latlng);
  } else {
    pendingMarker = L.circleMarker(e.latlng, {
      radius: 9,
      color: "#ffffff",
      weight: 3,
      fillColor: "#16252b",
      fillOpacity: 1,
      dashArray: "4 3",
    }).addTo(map);
  }
  placeFound = true;
  $("#selection").hidden = false;
  $("#selCoords").textContent = `${pending.lat.toFixed(5)}, ${pending.lon.toFixed(5)}`;
  setStatus("");
  setTab("analyze");
  renderSteps();
  setHint("Nokta seçildi. Sağ paneldeki “Bu noktayı analiz et” butonuna bas.");
});

async function fetchOverpass() {
  let lastError = null;
  for (const url of OVERPASS_URLS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), OVERPASS_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: "POST",
        body: new URLSearchParams({ data: OVERPASS_QUERY }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!data.elements?.length) throw new Error("sonuç boş");
      return data;
    } catch (err) {
      lastError = err.name === "AbortError" ? new Error("zaman aşımı") : err;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError ?? new Error("Overpass'a ulaşılamadı");
}

async function loadLake() {
  try {
    let data = null;
    try {
      data = JSON.parse(localStorage.getItem(LAKE_CACHE_KEY));
    } catch {
      data = null;
    }
    if (!data?.elements?.length) {
      data = await fetchOverpass();
      try {
        localStorage.setItem(LAKE_CACHE_KEY, JSON.stringify(data));
      } catch {
        // önbellek dolu olabilir; bir dahaki sefere yeniden çekilir
      }
    }

    const rings = [];
    for (const item of data.elements ?? []) {
      if (item.type === "way" && item.geometry) rings.push(item.geometry);
      if (item.type === "relation" && item.members) {
        for (const member of item.members) {
          if (member.geometry && member.role !== "inner") rings.push(member.geometry);
        }
      }
    }
    if (!rings.length) throw new Error("göl sınırı bulunamadı");

    const group = L.featureGroup();
    for (const ring of rings) {
      L.polyline(ring.map((p) => [p.lat, p.lon]), { color: "#7fd0e6", weight: 2, interactive: false }).addTo(group);
      const coords = ring.map((p) => [p.lon, p.lat]);
      if (coords.length >= 2) lakeLines.push(turf.lineString(coords));
      const first = coords[0];
      const last = coords[coords.length - 1];
      if (coords.length >= 4 && first[0] === last[0] && first[1] === last[1]) {
        lakePolygons.push(turf.polygon([coords]));
      }
    }
    group.addTo(map);
    fitToContent(group.getBounds());
    setHint("Bir mahalle ara ya da haritada yakınlaşıp şüpheli bir alana tıkla.");
    recomputeDistances();
  } catch (err) {
    fitToContent();
    setHint(`Göl sınırı yüklenemedi (${err.message}). Analiz çalışır ama göle mesafe hesaplanamaz.`, true);
  }
}

// Kayıtlı nokta varsa haritayı noktalara, yoksa göle sığdırır
function fitToContent(lakeBounds = null) {
  if (points.length) {
    const bounds = L.latLngBounds(points.map((p) => [p.lat, p.lon])).pad(0.4);
    map.fitBounds(bounds, { maxZoom: 15, padding: [24, 24] });
  } else if (lakeBounds) {
    map.fitBounds(lakeBounds, { padding: [24, 24] });
  }
}

function distanceToLakeKm(lat, lon) {
  if (!lakeLines.length) return null;
  const pt = turf.point([lon, lat]);
  if (lakePolygons.some((poly) => turf.booleanPointInPolygon(pt, poly))) return 0;
  return Math.min(...lakeLines.map((line) => turf.pointToLineDistance(pt, line, { units: "kilometers" })));
}

// Göl sonradan yüklenirse, mesafesi olmayan noktaları güncelle
function recomputeDistances() {
  let changed = false;
  for (const p of points) {
    if (p.distanceKm === null || p.distanceKm === undefined) {
      p.distanceKm = distanceToLakeKm(p.lat, p.lon);
      p.score = priorityOf(p.result, p.distanceKm);
      changed = true;
    }
  }
  if (changed) {
    savePoints();
    render();
  }
}

/* ---------- Önceliklendirme ---------- */

function priorityOf(result, distanceKm) {
  const weight = CATEGORY_WEIGHT[result.kategori] ?? 0.1;
  const d = distanceKm ?? 2; // mesafe bilinmiyorsa nötr bir varsayım
  return result.guven * weight * (1 / (1 + d));
}

function levelOf(score) {
  if (score >= 0.5) return "yuksek";
  if (score >= 0.2) return "orta";
  return "dusuk";
}

/* ---------- Yer arama ---------- */

let searchMarker = null;
let lastSearchAt = 0;

function goToPlace(place) {
  const [south, north, west, east] = place.boundingbox.map(Number);
  map.fitBounds([[south, west], [north, east]], { maxZoom: 16, padding: [20, 20] });
  const latlng = [Number(place.lat), Number(place.lon)];
  if (searchMarker) searchMarker.setLatLng(latlng);
  else {
    searchMarker = L.circleMarker(latlng, {
      radius: 12,
      color: "#7fd0e6",
      weight: 3,
      fill: false,
      interactive: false,
    }).addTo(map);
  }
  $("#searchResults").hidden = true;
  placeFound = true;
  renderSteps();
  setHint(`${place.name || place.display_name.split(",")[0]} bölgesindesin. Şüpheli bir toprak veya moloz yığınının tam üstüne tıkla.`);
}

async function searchPlace(query) {
  const q = query.trim();
  const list = $("#searchResults");
  if (!q) return;

  // Nominatim kuralı: saniyede en fazla bir istek
  const wait = 1100 - (Date.now() - lastSearchAt);
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastSearchAt = Date.now();

  list.hidden = false;
  list.innerHTML = "";
  list.append(el("li", { class: "search-info", text: "Aranıyor…" }));

  const params = new URLSearchParams({
    q,
    format: "jsonv2",
    countrycodes: "tr",
    viewbox: SEARCH_VIEWBOX,
    bounded: "1",
    limit: "5",
    "accept-language": "tr",
  });

  try {
    const res = await fetch(`${NOMINATIM_URL}?${params}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const places = await res.json();
    list.innerHTML = "";

    if (!places.length) {
      list.append(el("li", { class: "search-info", text: `"${q}" havza çevresinde bulunamadı. Farklı bir yazımla dene.` }));
      return;
    }
    if (places.length === 1) {
      goToPlace(places[0]);
      return;
    }
    for (const place of places) {
      list.append(
        el("li", {}, [
          el("button", {
            type: "button",
            class: "search-result",
            text: place.display_name.split(",").slice(0, 3).join(","),
            onclick: () => goToPlace(place),
          }),
        ])
      );
    }
  } catch (err) {
    list.innerHTML = "";
    list.append(el("li", { class: "search-info is-error", text: `Arama yapılamadı (${err.message}).` }));
  }
}

/* ---------- Eski tarih listesi ---------- */

// Varsayılan eski tarih: geçen yıl ya da öncesindeki son yaz (Haziran–Eylül) sürümü.
// Erken uyarı için yakın geçmişle karşılaştırırız; kış görüntüleri ise kar ve
// çıplak bitki örtüsü yüzünden yanlış alarma yol açıyor.
function defaultRelease(list) {
  const maxYear = new Date().getFullYear() - 1;
  const summers = list.filter((r) => {
    const [year, month] = r.date.split("-").map(Number);
    return year <= maxYear && month >= 6 && month <= 9;
  });
  return summers.length ? summers[summers.length - 1] : list[0];
}

async function loadReleases() {
  const select = $("#beforeSelect");
  try {
    const res = await fetch("/api/releases");
    const data = await res.json();
    releases = data.releases ?? [];
    if (!releases.length) throw new Error("liste boş");
    select.innerHTML = "";
    for (const r of releases) {
      select.append(el("option", { value: String(r.releaseNum), text: formatDate(r.date) }));
    }
    select.value = String(defaultRelease(releases).releaseNum);
    if (data.fallback) {
      setStatus("Tarih listesi alınamadı; varsayılan olarak 2014 görüntüsü kullanılıyor.", true);
    }
  } catch {
    releases = [{ releaseNum: 10, date: "2014-02-20" }];
    select.innerHTML = "";
    select.append(el("option", { value: "10", text: formatDate("2014-02-20") }));
  }
  // Kartlardaki tarih seçicileri tam listeyle yeniden çiz
  if (points.length) render();
}

/* ---------- Analiz ---------- */

// Sunucudan analiz ister; Gemini yoğunsa bekleyip en fazla 3 kez dener.
// onRetry(mesaj): tekrar denemeden önce kullanıcıya gösterilecek durum metni
async function requestAnalysis(lat, lon, releaseNum, onRetry = () => {}) {
  const MAX_ATTEMPTS = 3;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const res = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lat, lon, beforeRelease: releaseNum }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok) return body;
    if (body.retryable && attempt < MAX_ATTEMPTS) {
      onRetry(`Gemini şu an yoğun, ${attempt * 4} saniye sonra tekrar deneniyor (${attempt + 1}/${MAX_ATTEMPTS})…`);
      await new Promise((resolve) => setTimeout(resolve, attempt * 4000));
      continue;
    }
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  throw new Error("Analiz yapılamadı.");
}

async function analyze() {
  if (!pending) return;
  const button = $("#analyzeBtn");
  const box = $("#selection");
  const label = button.querySelector(".analyze-label");
  const releaseNum = Number($("#beforeSelect").value);
  const { lat, lon } = pending;

  button.disabled = true;
  box.classList.add("is-loading");
  label.textContent = "Analiz ediliyor…";
  setStatus("Uydu görüntüleri alınıyor, Gemini karşılaştırıyor. Bu 5–15 saniye sürebilir.");

  try {
    const data = await requestAnalysis(lat, lon, releaseNum, (msg) => setStatus(msg));

    const distanceKm = distanceToLakeKm(lat, lon);
    const analysis = {
      beforeRelease: releaseNum,
      beforeDate: dateOfRelease(releaseNum),
      result: data.result,
      model: data.model,
      createdAt: new Date().toISOString(),
    };
    const point = {
      id: crypto.randomUUID(),
      lat,
      lon,
      createdAt: analysis.createdAt,
      tile: data.tile,
      distanceKm,
      analyses: [analysis],
      truth: null, // true: gerçekte kaçak döküm, false: değil
    };
    setActiveAnalysis(point, analysis);
    points.push(point);
    savePoints();

    pending = null;
    if (pendingMarker) {
      map.removeLayer(pendingMarker);
      pendingMarker = null;
    }
    box.hidden = true;
    setStatus("");
    openId = point.id;
    renderSteps();
    setTab("results");
    render();
    setHint("Analiz tamamlandı. Yeni bir nokta için haritaya tekrar tıklayabilirsin.");
    document.querySelector(`[data-id="${point.id}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (err) {
    setStatus(`Analiz yapılamadı: ${err.message}`, true);
  } finally {
    button.disabled = false;
    box.classList.remove("is-loading");
    label.textContent = "Bu noktayı analiz et";
  }
}

/* ---------- Test istatistikleri ---------- */

function computeStats() {
  let tp = 0, fp = 0, fn = 0, tn = 0;
  for (const p of points) {
    if (p.truth === null || p.truth === undefined) continue;
    const predicted = p.result.kategori === "kacak_dokum";
    if (predicted && p.truth) tp++;
    else if (predicted && !p.truth) fp++;
    else if (!predicted && p.truth) fn++;
    else tn++;
  }
  return { tp, fp, fn, tn, labeled: tp + fp + fn + tn };
}

function renderStats() {
  const s = computeStats();
  $("#statTested").textContent = String(s.labeled);
  $("#statCaught").textContent = s.tp + s.fn ? `${s.tp}/${s.tp + s.fn}` : "–";
  $("#statFalse").textContent = String(s.fp);
  $("#statAccuracy").textContent = s.labeled ? `%${Math.round(((s.tp + s.tn) / s.labeled) * 100)}` : "–";
}

/* ---------- Kartlar ---------- */

function buildCompare(p) {
  const viewRelease = p.viewRelease ?? p.beforeRelease;
  const viewDate = dateOfRelease(viewRelease, viewRelease === p.beforeRelease ? p.beforeDate : null);
  const beforeYear = viewDate ? new Date(`${viewDate}T00:00:00`).getFullYear() : "eski";

  const wrap = el("div", { class: "compare" });
  const range = el("input", {
    class: "compare-range",
    type: "range",
    min: "0",
    max: "100",
    value: "50",
    "aria-label": "Eski ve güncel görüntü arasında kaydır",
  });
  range.addEventListener("input", () => wrap.style.setProperty("--pos", `${range.value}%`));

  wrap.append(
    el("img", { class: "before", src: waybackTileUrl(viewRelease, p.tile), alt: `Önce: ${formatDate(viewDate)}` }),
    el("img", { class: "after", src: p.tile.afterUrl, alt: "Sonra: güncel görüntü" }),
    el("span", { class: "divider", "aria-hidden": "true" }, [el("span", { class: "handle", text: "⇆" })]),
    el("span", { class: "pin", style: `left:${p.tile.fx}%;top:${p.tile.fy}%`, "aria-hidden": "true" }),
    el("span", { class: "tag tag-before", text: `Önce: ${beforeYear}` }),
    el("span", { class: "tag tag-after", text: "Sonra: güncel" }),
    range
  );

  return [
    wrap,
    el("p", { class: "compare-hint", text: "Görüntünün üzerinde sağa sola sürükleyerek eski ve güncel hâli karşılaştır. Halka, tıkladığın noktayı gösterir." }),
  ];
}

function buildFacts(p) {
  const band = protectionBand(p.distanceKm);
  const fact = (label, value, extra = "") =>
    el("div", { class: `fact ${extra}` }, [el("dt", { text: label }), el("dd", { text: value })]);
  return el("dl", { class: "facts" }, [
    fact("Göle mesafe", formatDistance(p.distanceKm)),
    fact("Koruma bandı (yaklaşık)", band.label, `tone-${band.tone}`),
    fact("Yapay zekâ güveni", p.result.ayni_goruntu ? "Sorulmadı" : `%${Math.round(p.result.guven * 100)}`),
    fact("Karşılaştırılan tarih", formatDate(p.beforeDate)),
  ]);
}

function buildVerdict(p) {
  const box = el("div", { class: "verdict" });
  box.append(el("p", { class: "verdict-label", text: `Gemini'nin yorumu: ${formatDate(p.beforeDate)} ile güncel görüntü` }));
  if (p.result.aciklama) box.append(el("p", { class: "explain", text: p.result.aciklama }));
  if (p.result.gorulen_isaretler.length) {
    box.append(el("ul", { class: "signs" }, p.result.gorulen_isaretler.map((s) => el("li", { text: s }))));
  }
  return box;
}

// Aynı noktayı farklı eski tarihlerle karşılaştırma bölümü (katlanabilir)
function buildHistory(p) {
  const details = el("details", { class: "history" });
  if (historyOpen.has(p.id) || p.analyses.length > 1 || p.viewRelease !== p.beforeRelease) details.open = true;
  details.addEventListener("toggle", () => {
    if (details.open) historyOpen.add(p.id);
    else historyOpen.delete(p.id);
  });

  details.append(el("summary", { text: "Başka bir tarihle karşılaştır" }));
  const body = el("div", { class: "history-body" });

  // 1) Tarih seçici: değiştirince eski görüntü anında değişir, Gemini çağrılmaz
  const select = el("select", { "aria-label": "Karşılaştırma tarihi" });
  const options = releases.length ? releases : [{ releaseNum: p.beforeRelease, date: p.beforeDate }];
  for (const r of options) select.append(el("option", { value: String(r.releaseNum), text: formatDate(r.date) }));
  select.value = String(p.viewRelease);
  select.addEventListener("change", () => {
    p.viewRelease = Number(select.value);
    historyOpen.add(p.id);
    savePoints();
    render();
  });

  // 2) Eylem: seçilen tarih analiz edilmediyse analiz et, edildiyse o analizi göster
  const existing = p.analyses.find((a) => a.beforeRelease === p.viewRelease);
  const isActive = existing && p.beforeRelease === p.viewRelease;
  const status = el("p", { class: "history-status", role: "status" });
  const action = el("button", { type: "button", class: "primary small" });

  if (isActive) {
    action.textContent = "Bu tarihin analizi gösteriliyor";
    action.disabled = true;
  } else if (existing) {
    action.textContent = "Bu tarihin analizini göster";
    action.addEventListener("click", () => {
      setActiveAnalysis(p, existing);
      savePoints();
      render();
    });
  } else {
    action.textContent = "Gemini ile bu tarihi analiz et";
    action.addEventListener("click", async () => {
      const releaseNum = p.viewRelease;
      action.disabled = true;
      select.disabled = true;
      action.textContent = "Analiz ediliyor…";
      status.textContent = "Gemini karşılaştırıyor…";
      status.classList.remove("is-error");
      try {
        const data = await requestAnalysis(p.lat, p.lon, releaseNum, (msg) => {
          status.textContent = msg;
        });
        const analysis = {
          beforeRelease: releaseNum,
          beforeDate: dateOfRelease(releaseNum),
          result: data.result,
          model: data.model,
          createdAt: new Date().toISOString(),
        };
        p.analyses.push(analysis);
        setActiveAnalysis(p, analysis);
        savePoints();
        render();
      } catch (err) {
        status.textContent = `Analiz yapılamadı: ${err.message}`;
        status.classList.add("is-error");
        action.disabled = false;
        select.disabled = false;
        action.textContent = "Gemini ile bu tarihi analiz et";
      }
    });
  }

  body.append(
    el("p", { class: "help", text: "Tarihi değiştirince eski görüntü hemen güncellenir. Analiz için butona bas." }),
    el("div", { class: "history-row" }, [select, action]),
    status
  );

  // 3) Analiz edilmiş tarihler arasında geçiş
  if (p.analyses.length > 1) {
    const sorted = [...p.analyses].sort((a, b) => String(a.beforeDate).localeCompare(String(b.beforeDate)));
    body.append(
      el("div", { class: "analysis-chips" }, [
        el("span", { text: "Analiz edilen tarihler:" }),
        ...sorted.map((a) =>
          el("button", {
            type: "button",
            class: "analysis-chip",
            "aria-pressed": String(a.beforeRelease === p.beforeRelease),
            text: `${formatDate(a.beforeDate)}: ${a.result.ayni_goruntu ? "Görüntü aynı" : CATEGORY_LABELS[a.result.kategori] ?? a.result.kategori}`,
            onclick: () => {
              setActiveAnalysis(p, a);
              savePoints();
              render();
            },
          })
        ),
      ])
    );
  }

  details.append(body);
  return details;
}

function buildTruth(p) {
  const setTruth = (value) => {
    p.truth = p.truth === value ? null : value;
    savePoints();
    render();
  };
  // Butonların dili sistemin tahminine göre değişir; kaydedilen değer hep "gerçekte döküm var mı?"
  const predicted = p.result.kategori === "kacak_dokum";
  const yesText = predicted ? "Doğrula: kaçak döküm" : "Gözden kaçmış döküm";
  const noText = predicted ? "Yanlış alarm" : "Doğru: döküm yok";
  return el("div", { class: "truth" }, [
    el("p", { text: "Görüntülere bakarak sonucu değerlendir:" }),
    el("div", { class: "segmented" }, [
      el("button", {
        type: "button",
        class: "seg-yes",
        "aria-pressed": String(p.truth === true),
        text: yesText,
        onclick: () => setTruth(true),
      }),
      el("button", {
        type: "button",
        class: "seg-no",
        "aria-pressed": String(p.truth === false),
        text: noText,
        onclick: () => setTruth(false),
      }),
    ]),
  ]);
}

function buildCard(p) {
  const level = levelOf(p.score);
  const isOpen = p.id === openId;
  const card = el("li", { class: `card level-${level}${isOpen ? " is-open" : ""}`, "data-id": p.id });
  const confidence = Math.round(p.result.guven * 100);

  const sameImage = Boolean(p.result.ayni_goruntu);
  const pills = [el("span", { class: "pill pill-level", text: LEVELS[level].label })];
  if (sameImage) pills.push(el("span", { class: "pill pill-same", text: "Görüntü değişmemiş" }));
  if (p.truth !== null && p.truth !== undefined) {
    const predicted = p.result.kategori === "kacak_dokum";
    const correct = predicted === p.truth;
    pills.push(
      el("span", {
        class: `pill ${correct ? "pill-correct" : "pill-wrong"}`,
        text: correct ? "Sistem doğru" : "Sistem yanıldı",
      })
    );
  }

  const head = el(
    "button",
    {
      class: "card-head",
      type: "button",
      "aria-expanded": String(isOpen),
      onclick: () => {
        openId = isOpen ? null : p.id;
        render();
        if (!isOpen) map.panTo([p.lat, p.lon]);
      },
    },
    [
      el("span", { class: "pills" }, pills),
      el("span", {
        class: "cat",
        text: sameImage ? "Karşılaştırma yapılamadı" : CATEGORY_LABELS[p.result.kategori] ?? p.result.kategori,
      }),
      el("span", { class: "meta" }, [
        el("span", { class: "conf" }, [
          el("span", { class: "conf-bar" }, [el("span", { class: "conf-fill", style: `width:${confidence}%` })]),
          el("span", { text: sameImage ? "Gemini'ye sorulmadı" : `%${confidence} güven` }),
        ]),
        el("span", { text: formatKm(p.distanceKm) }),
      ]),
    ]
  );
  card.append(head);

  if (isOpen) {
    const body = el("div", { class: "card-body" });
    body.append(buildFacts(p), ...buildCompare(p), buildVerdict(p), buildTruth(p), buildHistory(p));
    body.append(
      el("div", { class: "card-foot" }, [
        el("span", { text: `${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}` }),
        el("button", {
          class: "delete",
          type: "button",
          text: "Noktayı sil",
          onclick: () => {
            if (!confirm("Bu nokta ve sonucu silinsin mi?")) return;
            points = points.filter((x) => x.id !== p.id);
            if (openId === p.id) openId = null;
            savePoints();
            render();
          },
        }),
      ])
    );
    card.append(body);
  }
  return card;
}

/* ---------- Harita işaretleri ---------- */

function renderMarkers() {
  for (const marker of markers.values()) map.removeLayer(marker);
  markers.clear();
  if (selectedHalo) {
    map.removeLayer(selectedHalo);
    selectedHalo = null;
  }

  for (const p of points) {
    const level = levelOf(p.score);
    const isOpen = p.id === openId;
    const marker = L.circleMarker([p.lat, p.lon], {
      radius: isOpen ? 10 : 7,
      color: "#ffffff",
      weight: isOpen ? 3 : 2,
      fillColor: LEVELS[level].color,
      fillOpacity: 1,
    })
      .addTo(map)
      .bindTooltip(`${CATEGORY_LABELS[p.result.kategori] ?? ""} (%${Math.round(p.result.guven * 100)})`)
      .on("click", (e) => {
        L.DomEvent.stopPropagation(e);
        openId = p.id;
        setTab("results");
        render();
        document.querySelector(`[data-id="${p.id}"]`)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      });
    if (isOpen) marker.bringToFront();
    markers.set(p.id, marker);

    if (isOpen) {
      selectedHalo = L.circleMarker([p.lat, p.lon], {
        radius: 18,
        color: "#ffffff",
        weight: 2,
        dashArray: "5 4",
        fill: false,
        interactive: false,
        className: "selected-halo",
      }).addTo(map);
    }
  }
}

/* ---------- Genel çizim ---------- */

const FILTERS = [
  { id: "all", label: "Tümü", test: () => true },
  { id: "high", label: "Yüksek öncelik", test: (p) => levelOf(p.score) === "yuksek" },
  { id: "unlabeled", label: "Değerlendirilmemiş", test: (p) => p.truth === null || p.truth === undefined },
];

function renderFilters() {
  const box = $("#filters");
  box.innerHTML = "";
  box.hidden = !points.length;
  for (const f of FILTERS) {
    const count = points.filter(f.test).length;
    box.append(
      el("button", {
        type: "button",
        class: "filter",
        "aria-pressed": String(resultFilter === f.id),
        onclick: () => {
          resultFilter = f.id;
          render();
        },
      }, [el("span", { text: f.label }), el("span", { class: "filter-count", text: String(count) })])
    );
  }
}

function render() {
  const list = $("#cards");
  list.innerHTML = "";
  const filter = FILTERS.find((f) => f.id === resultFilter) ?? FILTERS[0];
  const sorted = [...points].sort((a, b) => b.score - a.score);
  const visible = sorted.filter(filter.test);
  for (const p of visible) list.append(buildCard(p));
  $("#filterEmpty").hidden = !(points.length && !visible.length);
  renderFilters();

  const count = points.length;
  $("#resultCount").textContent = String(count);
  $("#empty").hidden = count > 0;
  $("#listSummary").textContent = count ? `${count} nokta, önceliğe göre sıralı` : "";
  $("#exportBtn").disabled = !count;
  $("#exportJsonBtn").disabled = !count;
  $("#seedNote").hidden = !(count && localStorage.getItem(SOURCE_KEY) === "file");
  $("#clearBtn").disabled = !count;

  renderMarkers();
  renderStats();
  renderSteps();
}

/* ---------- CSV dışa aktarma ---------- */

function exportCsv() {
  if (!points.length) return;
  const header = ["enlem", "boylam", "eski_tarih", "kategori", "guven", "gole_mesafe_km", "oncelik_puani", "gercek_durum", "aciklama"];
  const escape = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const rows = points.map((p) => [
    p.lat.toFixed(6),
    p.lon.toFixed(6),
    p.beforeDate ?? "",
    p.result.kategori,
    p.result.guven.toFixed(2),
    p.distanceKm === null || p.distanceKm === undefined ? "" : p.distanceKm.toFixed(3),
    p.score.toFixed(3),
    p.truth === null || p.truth === undefined ? "" : p.truth ? "kacak_dokum" : "degil",
    p.result.aciklama,
  ]);
  const csv = [header, ...rows].map((r) => r.map(escape).join(",")).join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
  const link = el("a", { href: URL.createObjectURL(blob), download: "havza-bekcisi-sonuclar.csv" });
  document.body.append(link);
  link.click();
  link.remove();
}

/* ---------- Test sonuçlarını dışa aktarma ve siteye gömme ---------- */

function exportJson() {
  if (!points.length) return;
  const blob = new Blob([JSON.stringify(points, null, 2)], { type: "application/json" });
  const link = el("a", { href: URL.createObjectURL(blob), download: SEED_FILE });
  document.body.append(link);
  link.click();
  link.remove();
}

// Ziyaretçinin hiç kaydı yoksa (ör. jüri siteyi ilk kez açıyorsa) public/test-results.json'u yükler.
// Ziyaretçi daha önce "Tümünü temizle" dediyse kayıt boş dizi olarak durur ve dosya tekrar yüklenmez.
async function seedFromFile() {
  if (localStorage.getItem(STORAGE_KEY) !== null) return;
  try {
    const res = await fetch(SEED_FILE, { cache: "no-store" });
    if (!res.ok) return; // dosya yoksa sessizce geç
    const data = await res.json();
    if (!Array.isArray(data) || !data.length) return;
    points = data.map(normalizePoint);
    savePoints();
    localStorage.setItem(SOURCE_KEY, "file");
    setTab("results");
    render();
  } catch {
    // dosya bozuksa boş uygulamayla devam et
  }
}

/* ---------- Olaylar ve başlatma ---------- */

$("#tabAnalyze").addEventListener("click", () => setTab("analyze"));
$("#tabResults").addEventListener("click", () => setTab("results"));
$("#emptyStart").addEventListener("click", () => setTab("analyze"));

$("#searchForm").addEventListener("submit", (e) => {
  e.preventDefault();
  searchPlace($("#searchInput").value);
});

for (const chip of document.querySelectorAll(".chip")) {
  chip.addEventListener("click", () => {
    $("#searchInput").value = chip.dataset.q;
    searchPlace(chip.dataset.q);
  });
}

$("#analyzeBtn").addEventListener("click", analyze);
$("#exportBtn").addEventListener("click", exportCsv);
$("#exportJsonBtn").addEventListener("click", exportJson);
$("#clearBtn").addEventListener("click", () => {
  if (!points.length) return;
  if (!confirm(`${points.length} noktanın tamamı ve test işaretlemeleri silinsin mi?`)) return;
  points = [];
  openId = null;
  historyOpen.clear();
  localStorage.removeItem(SOURCE_KEY);
  savePoints();
  render();
});

// Kayıtlı sonuç varsa Sonuçlar sekmesiyle aç
setTab(points.length ? "results" : "analyze");
updateZoomReadout();
render();
(async () => {
  await seedFromFile();
  loadReleases();
  loadLake();
})();