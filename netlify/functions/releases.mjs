
const CAPABILITIES_URL =
  "https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/WMTS/1.0.0/WMTSCapabilities.xml";

const FALLBACK = [{ releaseNum: 10, date: "2014-02-20" }];

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...extraHeaders },
  });
}

export default async () => {
  try {
    const res = await fetch(CAPABILITIES_URL);
    if (!res.ok) throw new Error(`Wayback HTTP ${res.status}`);
    const xml = await res.text();

    const releases = [];
    for (const block of xml.split("<Layer>").slice(1)) {
      const title = block.match(/<ows:Title>([^<]+)<\/ows:Title>/)?.[1] ?? "";
      const date = title.match(/(\d{4}-\d{2}-\d{2})/)?.[1];
      const template = block.match(/template="([^"]+)"/)?.[1] ?? "";
      const releaseNum = template.match(/\/tile\/(\d+)\//)?.[1];
      if (date && releaseNum) releases.push({ releaseNum: Number(releaseNum), date });
    }

    if (!releases.length) throw new Error("Sürüm listesi çözümlenemedi");

    releases.sort((a, b) => a.date.localeCompare(b.date));
    return json({ releases }, 200, { "Cache-Control": "public, max-age=86400" });
  } catch (err) {
    return json({ releases: FALLBACK, fallback: true, error: err.message });
  }
};

export const config = { path: "/api/releases" };
