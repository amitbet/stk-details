const DEFAULT_URL = "https://stockcharts.com/j-sum/sum?cmd=sctr&view=L&timeframe=I";

/**
 * Fetch StockCharts SCTR JSON and return normalized records.
 * The upstream JSON is an array of objects with keys like:
 *   date, symbol, name, SCTR, delta, close, marketCap, vol, industry, sector
 */
async function fetchSctrJson({ url = DEFAULT_URL, timeoutMs = 20000 } = {}) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; sctr-csv-bot/1.0; +https://example.com)",
        Accept: "application/json, text/javascript, */*; q=0.01",
        "Accept-Language": "en-US,en;q=0.9",
        Referer: "https://stockcharts.com/freecharts/sctr.html"
      }
    });
    if (!resp.ok) {
      throw new Error(`StockCharts HTTP ${resp.status}`);
    }
    const raw = await resp.json();
    if (!Array.isArray(raw)) return [];
    return normalizeRecords(raw);
  } finally {
    clearTimeout(t);
  }
}

function normalizeRecords(raw) {
  const out = [];
  let asOfDate = "";
  for (const item of raw) {
    if (item && typeof item === "object" && "date" in item) {
      const d = toString(item.date);
      if (d) asOfDate = parseDate(d) || asOfDate;
      if (!("symbol" in item)) continue;
    }
    const symbol = toString(item?.symbol);
    if (!symbol) continue;
    const d = parseDate(toString(item?.date)) || asOfDate || "";
    out.push({
      date: d,
      symbol: symbol,
      name: toString(item?.name),
      SCTR: toNumber(item?.SCTR),
      delta: toNumber(item?.delta),
      close: toNumber(item?.close),
      marketCap: toNumber(item?.marketCap),
      vol: toInt(item?.vol),
      industry: toString(item?.industry),
      sector: toString(item?.sector)
    });
  }
  return out;
}

function toString(v) {
  if (v == null) return "";
  return String(v).trim();
}

function toNumber(v) {
  const s = toString(v);
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function toInt(v) {
  const s = toString(v);
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

function parseDate(s) {
  const t = toString(s);
  if (!t) return "";

  // Go ref handled: "2 Jan 2006", "02 Jan 2006", "2006-01-02".
  // Here we preserve YYYY-MM-DD when present; otherwise best-effort.
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;

  const m = t.match(/^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})$/);
  if (m) {
    const day = String(m[1]).padStart(2, "0");
    const mon = monthToNum(m[2]);
    const year = m[3];
    if (mon) return `${year}-${mon}-${day}`;
  }
  return "";
}

function monthToNum(mon) {
  const map = {
    Jan: "01",
    Feb: "02",
    Mar: "03",
    Apr: "04",
    May: "05",
    Jun: "06",
    Jul: "07",
    Aug: "08",
    Sep: "09",
    Oct: "10",
    Nov: "11",
    Dec: "12"
  };
  const key = String(mon || "").slice(0, 3);
  return map[key] || "";
}

module.exports = {
  DEFAULT_URL,
  fetchSctrJson
};

