const { fetchSctrJson } = require("./sctrService");
const Papa = require("papaparse");

function detectDelimiter(csvText) {
  const line = String(csvText || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (!line) return undefined; // let Papa decide
  const tabs = (line.match(/\t/g) || []).length;
  const commas = (line.match(/,/g) || []).length;
  return tabs > commas ? "\t" : ",";
}

function detectTickerColumnIndex(rows, columns) {
  if (!Array.isArray(columns) || columns.length === 0) return 0;

  // Prefer common header names.
  const normalized = columns.map((c) => String(c || "").trim().toLowerCase());
  const preferred = ["ticker", "symbol", "tick", "sym", "symbols", "tickers"];
  for (const p of preferred) {
    const idx = normalized.findIndex((c) => c === p || c.includes(p));
    if (idx >= 0) return idx;
  }

  // Otherwise, score columns based on how many values look like tickers.
  let bestIdx = 0;
  let bestScore = -1;
  for (let i = 0; i < columns.length; i++) {
    const name = columns[i];
    let score = 0;
    let seen = 0;
    for (const row of rows) {
      if (!row) continue;
      const v = row[name];
      const t = normalizeTickerCandidate(v);
      if (t) score++;
      seen++;
      if (seen >= 200) break; // cap work
    }
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }
  return bestIdx;
}

function normalizeTickerCandidate(v) {
  let s = v == null ? "" : String(v);
  s = s.trim();
  if (!s) return "";

  // Strip wrapping quotes.
  s = s.replace(/^"+|"+$/g, "");

  // Match Go behavior: take text before a double quote if present.
  const quoteIdx = s.indexOf('"');
  if (quoteIdx >= 0) s = s.slice(0, quoteIdx);

  s = s.trim();
  if (!s) return "";

  // Remove exchange prefixes like "NASDAQ:TSLA" → "TSLA"
  const colonIdx = s.lastIndexOf(":");
  if (colonIdx >= 0 && colonIdx < s.length - 1) s = s.slice(colonIdx + 1).trim();

  // Basic ticker sanity: uppercase letters/numbers/dot/dash, 1-10 chars.
  const cand = s.toUpperCase();
  if (cand === "TICKER" || cand === "SYMBOL") return "";
  if (!/^[A-Z0-9.\-]{1,10}$/.test(cand)) return "";
  return cand;
}

async function parseCsvForTickers(csvText) {
  const delimiter = detectDelimiter(csvText);

  // First try: header=true (common case).
  const first = Papa.parse(csvText, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: false,
    delimiter
  });

  let rows = Array.isArray(first.data) ? first.data.filter((r) => r && typeof r === "object") : [];
  let columns = rows.length > 0 ? Object.keys(rows[0]) : [];

  // Fallback: header=false (CSV without headers).
  if (columns.length === 0) {
    const second = Papa.parse(csvText, {
      header: false,
      skipEmptyLines: true,
      dynamicTyping: false,
      delimiter
    });

    const arrRows = Array.isArray(second.data) ? second.data : [];
    if (arrRows.length > 0 && Array.isArray(arrRows[0])) {
      const width = Math.max(...arrRows.map((r) => (Array.isArray(r) ? r.length : 0)), 0);
      columns = Array.from({ length: width }, (_, i) => `col_${i}`);
      rows = arrRows.map((r) => {
        const obj = {};
        for (let i = 0; i < width; i++) obj[columns[i]] = r?.[i];
        return obj;
      });
    }
  }

  const tickerColumnIndex = detectTickerColumnIndex(rows, columns);
  const tickerColumnName = columns[tickerColumnIndex] || "";

  const tickers = [];
  for (const row of rows) {
    const raw = row?.[tickerColumnName];
    const t = normalizeTickerCandidate(raw);
    if (t) tickers.push(t);
  }

  const unique = Array.from(new Set(tickers));

  return {
    columns,
    tickerColumnIndex,
    tickerColumnName,
    tickers: unique
  };
}

function calculateIndustrySectorStats(allRecords) {
  // Calculate averages and stats for each industry and sector
  const industryStats = {};
  const sectorStats = {};

  for (const record of allRecords) {
    const sctr = typeof record.SCTR === "number" ? record.SCTR : null;
    if (sctr === null) continue;

    const industry = String(record.industry || "").trim();
    const sector = String(record.sector || "").trim();

    if (industry) {
      if (!industryStats[industry]) {
        industryStats[industry] = { sum: 0, count: 0, values: [] };
      }
      industryStats[industry].sum += sctr;
      industryStats[industry].count++;
      industryStats[industry].values.push(sctr);
    }

    if (sector) {
      if (!sectorStats[sector]) {
        sectorStats[sector] = { sum: 0, count: 0, values: [] };
      }
      sectorStats[sector].sum += sctr;
      sectorStats[sector].count++;
      sectorStats[sector].values.push(sctr);
    }
  }

  // Calculate averages and percentiles
  const result = { industries: {}, sectors: {} };

  for (const [industry, stats] of Object.entries(industryStats)) {
    if (stats.count > 0) {
      const avg = stats.sum / stats.count;
      const sorted = [...stats.values].sort((a, b) => a - b);
      result.industries[industry] = {
        avg,
        count: stats.count,
        min: sorted[0],
        max: sorted[sorted.length - 1],
        median: sorted[Math.floor(sorted.length / 2)]
      };
    }
  }

  for (const [sector, stats] of Object.entries(sectorStats)) {
    if (stats.count > 0) {
      const avg = stats.sum / stats.count;
      const sorted = [...stats.values].sort((a, b) => a - b);
      result.sectors[sector] = {
        avg,
        count: stats.count,
        min: sorted[0],
        max: sorted[sorted.length - 1],
        median: sorted[Math.floor(sorted.length / 2)]
      };
    }
  }

  return result;
}

function calculateRelativeStrength(record, stats) {
  const sctr = typeof record.SCTR === "number" ? record.SCTR : null;
  if (sctr === null) return { industryRS: null, sectorRS: null };

  const industry = String(record.industry || "").trim();
  const sector = String(record.sector || "").trim();

  let industryRS = null;
  let sectorRS = null;

  if (industry && stats.industries[industry]) {
    const indStats = stats.industries[industry];
    if (indStats.avg > 0) {
      // Relative strength as percentage above/below average
      industryRS = ((sctr - indStats.avg) / indStats.avg) * 100;
    }
  }

  if (sector && stats.sectors[sector]) {
    const secStats = stats.sectors[sector];
    if (secStats.avg > 0) {
      sectorRS = ((sctr - secStats.avg) / secStats.avg) * 100;
    }
  }

  return { industryRS, sectorRS };
}

async function fetchSctrForTickers(tickers) {
  const normalized = tickers
    .map((t) => String(t || "").trim().toUpperCase())
    .filter(Boolean);

  if (normalized.length === 0) return { records: [], stats: { industries: {}, sectors: {} } };

  // Fetch ALL records to calculate industry/sector statistics
  const all = await fetchSctrJson({});
  const wanted = new Set(normalized);
  const records = all.filter((r) => wanted.has(String(r.symbol || "").toUpperCase()));

  // Calculate industry/sector statistics from all records
  const stats = calculateIndustrySectorStats(all);

  // Add relative strength to each record
  const recordsWithRS = records.map((record) => {
    const rs = calculateRelativeStrength(record, stats);
    return {
      ...record,
      industryRS: rs.industryRS,
      sectorRS: rs.sectorRS
    };
  });

  // Stable-ish: keep higher SCTR first by default.
  recordsWithRS.sort((a, b) => {
    const sa = typeof a.SCTR === "number" ? a.SCTR : -Infinity;
    const sb = typeof b.SCTR === "number" ? b.SCTR : -Infinity;
    if (sa === sb) return String(a.symbol).localeCompare(String(b.symbol));
    return sb - sa;
  });

  return { records: recordsWithRS, stats };
}

module.exports = {
  parseCsvForTickers,
  fetchSctrForTickers
};
