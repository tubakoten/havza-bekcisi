const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
// Ana model yoğunsa denenecek daha hafif model
const FALLBACK_MODEL = process.env.GEMINI_FALLBACK_MODEL || "gemini-3.5-flash-lite";
// Geçici yoğunluk / kota hataları: başka modelle veya biraz sonra tekrar denenebilir
const RETRYABLE_STATUS = new Set([429, 500, 503]);
const ZOOM = 17; // İstanbul enleminde bir tile yaklaşık 230 m x 230 m

const waybackUrl = (release, z, y, x) =>
  `https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/WMTS/1.0.0/default028mm/MapServer/tile/${release}/${z}/${y}/${x}`;
const currentUrl = (z, y, x) =>
  `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;

const CATEGORIES = ["kacak_dokum", "yasal_insaat", "tarim", "yol_altyapi", "degisim_yok", "belirsiz"];

const SYSTEM_PROMPT = `Sen uzaktan algılama konusunda uzman bir analistsin ve İstanbul'daki içme suyu havzalarında kaçak hafriyat, moloz ve atık dökümünü tespit etmeye yardım ediyorsun.

Sana aynı yaklaşık 230 m x 230 m alanın iki uydu görüntüsü verilecek: ilki ÖNCE (eski tarih), ikincisi SONRA (güncel).

Görevin: iki tarih arasında yüzeyde ne değiştiğini belirlemek ve bunun kaçak döküm olup olmadığını değerlendirmek.

Kaçak döküm işaretleri: düzensiz şekilli toprak veya moloz yığınları, toprak yol ucunda biten ya da yolla düzgün bağlantısı olmayan yeni çıplak alanlar, bitki örtüsünün düzensiz kaybı, karışık renkli atık, kamyon izleri.
Yasal inşaat işaretleri: düzenli parsel sınırları, bina temeli veya iskeleti, düzgün geometrik kazı, şantiye düzeni.
Tarım: sürülmüş tarla, mevsimsel bitki değişimi, düzenli sıralar.

Bunlar kaçak döküm DEĞİLDİR, "kacak_dokum" seçme:
- Kar, buz veya don (özellikle kış görüntülerinde beyaz alanlar).
- Bitkilerin mevsime göre renk değiştirmesi: yeşilden sarıya, kahverengiye veya kızıla dönmesi.
- Göl veya su seviyesinin yükselip alçalması; suyun çekilmesiyle açığa çıkan göl tabanı ya da orada yeni biten bitkiler.
- Sazlık ve sulak alan bitkileri, kıyı boyunca çalılar ve ağaçlar.
- Tarlanın sürülmesi, ekilmesi veya hasat edilmesi.
- Bulut, gölge, ışık ve görüntü kalitesi farkları.
Bu tür farkları gördüysen ve başka bir değişim yoksa "degisim_yok" ya da uygun kategoriyi (ör. "tarim") seç.

"kacak_dokum" seçmek için SONRA görüntüsünde, ÖNCE görüntüsünde olmayan, sınırları belirgin, yığın veya öbek şeklinde, çoğunlukla gri, bej, beyaz ya da karışık renkli malzeme görmelisin. Yalnızca renk farkı yeterli değildir. Emin değilsen "belirsiz" seç ve güveni 0,5'in altında tut.

Kurallar:
- Görüntüler aynı görünüyorsa "degisim_yok" seç.
- Görüntü kalitesi düşükse, bulut veya "veri yok" görüntüsü varsa ya da emin değilsen "belirsiz" seç ve güveni düşük tut. Tahmin uydurma.
- "aciklama" alanını Türkçe, en fazla iki cümle olarak yaz.
- "gorulen_isaretler" alanına görüntüde gerçekten gördüğün en fazla dört somut işareti Türkçe yaz.`;

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    degisim_var: { type: "BOOLEAN" },
    kategori: { type: "STRING", enum: CATEGORIES },
    guven: { type: "NUMBER" },
    gorulen_isaretler: { type: "ARRAY", items: { type: "STRING" } },
    aciklama: { type: "STRING" },
  },
  required: ["degisim_var", "kategori", "guven", "gorulen_isaretler", "aciklama"],
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function tileOf(lat, lon, z) {
  const n = 2 ** z;
  const latRad = (lat * Math.PI) / 180;
  const xf = ((lon + 180) / 360) * n;
  const yf = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  const x = Math.floor(xf);
  const y = Math.floor(yf);
  // fx, fy: noktanın tile içindeki konumu (yüzde)
  return { x, y, fx: (xf - x) * 100, fy: (yf - y) * 100 };
}

async function fetchImage(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const mimeType = (res.headers.get("content-type") || "image/jpeg").split(";")[0];
  const data = Buffer.from(await res.arrayBuffer()).toString("base64");
  return { mimeType, data };
}

function normalize(raw) {
  const kategori = CATEGORIES.includes(raw?.kategori) ? raw.kategori : "belirsiz";
  const guven = Math.min(1, Math.max(0, Number(raw?.guven) || 0));
  return {
    degisim_var: Boolean(raw?.degisim_var),
    kategori,
    guven,
    gorulen_isaretler: Array.isArray(raw?.gorulen_isaretler) ? raw.gorulen_isaretler.slice(0, 4).map(String) : [],
    aciklama: typeof raw?.aciklama === "string" ? raw.aciklama : "",
  };
}

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Yalnızca POST isteği desteklenir." }, 405);

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return json({ error: "Sunucuda GEMINI_API_KEY tanımlı değil." }, 500);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "İstek gövdesi okunamadı." }, 400);
  }

  const lat = Number(body.lat);
  const lon = Number(body.lon);
  const release = Number(body.beforeRelease);
  if (![lat, lon, release].every(Number.isFinite)) {
    return json({ error: "Enlem, boylam ve önce tarihi gerekli." }, 400);
  }
  if (lat < 40.8 || lat > 41.6 || lon < 27.9 || lon > 29.95) {
    return json({ error: "Seçilen nokta İstanbul sınırlarının dışında." }, 400);
  }

  const { x, y, fx, fy } = tileOf(lat, lon, ZOOM);
  const beforeUrl = waybackUrl(release, ZOOM, y, x);
  const afterUrl = currentUrl(ZOOM, y, x);

  let before, after;
  try {
    [before, after] = await Promise.all([fetchImage(beforeUrl), fetchImage(afterUrl)]);
  } catch (err) {
    return json({ error: `Uydu görüntüsü alınamadı (${err.message}).` }, 502);
  }

  if (before.data === after.data) {
    return json({
      result: {
        degisim_var: false,
        kategori: "degisim_yok",
        guven: 0,
        gorulen_isaretler: [],
        aciklama:
          "Seçilen tarihteki görüntü güncel görüntüyle birebir aynı. Bu bölge için o tarihten sonra yeni uydu görüntüsü yayımlanmamış; daha eski bir tarih seç.",
        ayni_goruntu: true,
      },
      model: null,
      tile: { z: ZOOM, x, y, fx, fy, beforeUrl, afterUrl },
    });
  }

  const payload = {
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [
      {
        role: "user",
        parts: [
          { text: "ÖNCE görüntüsü:" },
          { inlineData: before },
          { text: "SONRA görüntüsü:" },
          { inlineData: after },
          { text: "Bu iki görüntüyü karşılaştır ve sonucu şemaya uygun JSON olarak ver." },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.2,
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA,
    },
  };

  const models = [...new Set([MODEL, FALLBACK_MODEL].filter(Boolean))];
  let data = null;
  let usedModel = null;
  let primaryError = null; // ana modelin hatası kullanıcıya gösterilir
  let retryable = false; // herhangi bir model geçici bir hata verdiyse sonra tekrar denenebilir

  for (const [index, model] of models.entries()) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
          body: JSON.stringify(payload),
        }
      );
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        data = body;
        usedModel = model;
        break;
      }
      const message = body?.error?.message ?? `HTTP ${res.status}`;
      const isTemporary = RETRYABLE_STATUS.has(res.status);
      if (index === 0) primaryError = message;
      else console.warn(`Yedek model (${model}) kullanılamadı: ${message}`);
      retryable = retryable || isTemporary;
      if (index === 0 && !isTemporary) break;
    } catch (err) {
      if (index === 0) primaryError = err.message;
      retryable = true;
    }
  }

  if (!data) {
    return json(
      { error: `Gemini hatası: ${primaryError ?? "bilinmeyen hata"}`, retryable },
      retryable ? 503 : 502
    );
  }

  const text = (data?.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("");
  let parsed;
  try {
    parsed = JSON.parse(text.replace(/```json|```/g, "").trim());
  } catch {
    return json({ error: "Gemini yanıtı JSON olarak okunamadı.", raw: text.slice(0, 500) }, 502);
  }

  return json({
    result: normalize(parsed),
    model: usedModel,
    tile: { z: ZOOM, x, y, fx, fy, beforeUrl, afterUrl },
  });
};

export const config = { path: "/api/analyze" };
