const { fetchSctrJson } = require("./sctrService");
const { calculateIndustryMA50 } = require("./maService");
const { fetchFinvizIndustrySectorBatch } = require("./finvizService");
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

function calculateRelativeStrength(record, stats, finvizToStockChartsMap = null) {
  const sctr = typeof record.SCTR === "number" ? record.SCTR : null;
  if (sctr === null) return { industryRS: null, sectorRS: null };

  let industry = String(record.industry || "").trim();
  const sector = String(record.sector || "").trim();

  // If using Finviz industry names, try to map to StockCharts industry for stats lookup
  // This allows comparing Finviz-classified stocks against the full StockCharts dataset
  if (finvizToStockChartsMap && finvizToStockChartsMap.has(industry)) {
    const mappedIndustry = finvizToStockChartsMap.get(industry);
    // Use StockCharts industry name for stats, but keep Finviz name for display
    industry = mappedIndustry;
  }

  let industryRS = null;
  let sectorRS = null;

  if (industry && stats.industries[industry]) {
    const indStats = stats.industries[industry];
    if (indStats.avg > 0 && indStats.count > 1) {
      // Relative strength as percentage above/below average
      // Only calculate if we have more than 1 stock in the industry (otherwise RS would always be 0)
      industryRS = ((sctr - indStats.avg) / indStats.avg) * 100;
      
      // Debug logging for NVDA or other high SCTR stocks
      if (record.symbol === "NVDA" || (sctr > 50 && industryRS < 0)) {
        console.log(`[RS] ${record.symbol} (Finviz: "${String(record.industry || "").trim()}", Stats: "${industry}"): SCTR=${sctr}, Industry Avg=${indStats.avg.toFixed(2)}, Count=${indStats.count}, RS=${industryRS.toFixed(2)}%`);
      }
    } else if (indStats.count === 1) {
      // Only one stock in industry, can't calculate meaningful RS
      industryRS = null;
    }
  } else if (record.symbol === "NVDA") {
    console.log(`[RS] NVDA: Industry "${String(record.industry || "").trim()}" not found in stats. Available industries:`, Object.keys(stats.industries).slice(0, 10));
  }

  if (sector && stats.sectors[sector]) {
    const secStats = stats.sectors[sector];
    if (secStats.avg > 0 && secStats.count > 1) {
      sectorRS = ((sctr - secStats.avg) / secStats.avg) * 100;
    } else if (secStats.count === 1) {
      sectorRS = null;
    }
  }

  return { industryRS, sectorRS };
}

async function fetchSctrForTickers(tickers, industrySource = "finviz") {
  const normalized = tickers
    .map((t) => String(t || "").trim().toUpperCase())
    .filter(Boolean);

  if (normalized.length === 0) return { records: [], stats: { industries: {}, sectors: {} }, missingTickers: [] };

  // Fetch ALL records to calculate industry/sector statistics
  const all = await fetchSctrJson({});
  const wanted = new Set(normalized);
  const records = all.filter((r) => wanted.has(String(r.symbol || "").toUpperCase()));
  
  // Find missing tickers
  const foundSymbols = new Set(records.map((r) => String(r.symbol || "").toUpperCase()));
  const missingTickers = normalized.filter((t) => !foundSymbols.has(t));
  
  if (missingTickers.length > 0) {
    console.log(`[API] Missing tickers (not found in SCTR database): ${missingTickers.join(", ")}`);
  }
  console.log(`[API] Requested ${normalized.length} tickers, found ${records.length} records`);
  console.log(`[API] Using industry source: ${industrySource}`);

  // Fetch industry/sector data based on selected source
  let industrySectorData = new Map();
  
  if (industrySource === "finviz") {
    // Use Finviz for industry/sector (with aggressive caching to avoid 429 errors)
    try {
      console.log(`[API] Fetching Finviz industry/sector data for ${normalized.length} tickers (with persistent cache)...`);
      // Very conservative rate limiting: 2 second delay, 1 at a time
      const finvizData = await fetchFinvizIndustrySectorBatch(normalized, { delayMs: 2000, maxConcurrent: 1 });
      // Merge Finviz data into results
      for (const [ticker, data] of finvizData.entries()) {
        if (data && (data.industry || data.sector)) {
          industrySectorData.set(ticker, data);
        }
      }
      const finvizSuccessCount = Array.from(finvizData.values()).filter(v => v && (v.industry || v.sector)).length;
      console.log(`[API] Retrieved Finviz data for ${finvizSuccessCount}/${normalized.length} tickers`);
    } catch (error) {
      console.warn(`[API] Finviz fetch failed (rate limited?):`, error.message);
    }
  } else if (industrySource === "yahoo") {
    // Use Yahoo Finance (if implemented)
    const { fetchYahooIndustrySectorBatch } = require("./yahooIndustryService");
    try {
      console.log(`[API] Fetching Yahoo Finance industry/sector data for ${normalized.length} tickers...`);
      const yahooData = await fetchYahooIndustrySectorBatch(normalized, { delayMs: 100, maxConcurrent: 5 });
      for (const [ticker, data] of yahooData.entries()) {
        if (data && (data.industry || data.sector)) {
          industrySectorData.set(ticker, data);
        }
      }
      const yahooSuccessCount = Array.from(yahooData.values()).filter(v => v && (v.industry || v.sector)).length;
      console.log(`[API] Retrieved Yahoo Finance data for ${yahooSuccessCount}/${normalized.length} tickers`);
    } catch (error) {
      console.warn(`[API] Yahoo Finance fetch failed:`, error.message);
    }
  }
  // If industrySource is "stockcharts" or anything else, use StockCharts data (no external fetch)

  // Enrich records with Yahoo/Finviz industry/sector (override StockCharts data)
  const enrichedRecords = records.map((record) => {
    const symbol = String(record.symbol || "").toUpperCase();
    const externalData = industrySectorData.get(symbol);
    
    if (externalData && (externalData.industry || externalData.sector)) {
      return {
        ...record,
        industry: externalData.industry || record.industry,
        sector: externalData.sector || record.sector,
        industrySource: externalData.source || "Yahoo",
        sectorSource: externalData.source || "Yahoo"
      };
    }
    
    return {
      ...record,
      industrySource: "StockCharts",
      sectorSource: "StockCharts"
    };
  });

  // Also enrich missing tickers with Finviz data for potential future use
  const missingWithFinviz = missingTickers.map((ticker) => {
    const finviz = finvizData.get(ticker);
    return {
      symbol: ticker,
      industry: finviz?.industry || null,
      sector: finviz?.sector || null,
      industrySource: finviz?.industry ? "Finviz" : null,
      sectorSource: finviz?.sector ? "Finviz" : null
    };
  });

  // Calculate industry/sector statistics
  // IMPORTANT: When using Finviz, we need to ensure consistent industry naming
  // For stats, we should use ALL StockCharts records (which have consistent naming)
  // but when calculating RS for enriched records, we need to match their Finviz industry names
  // to the StockCharts industry names
  
  // Build a mapping of Finviz industry -> StockCharts industry for better matching
  const finvizToStockChartsMap = new Map();
  for (const record of enrichedRecords) {
    const symbol = String(record.symbol || "").toUpperCase();
    const finvizIndustry = String(record.industry || "").trim();
    const originalRecord = all.find((r) => String(r.symbol || "").toUpperCase() === symbol);
    if (originalRecord && finvizIndustry) {
      const stockChartsIndustry = String(originalRecord.industry || "").trim();
      if (stockChartsIndustry && finvizIndustry !== stockChartsIndustry) {
        // Map Finviz industry to StockCharts industry
        if (!finvizToStockChartsMap.has(finvizIndustry)) {
          finvizToStockChartsMap.set(finvizIndustry, stockChartsIndustry);
        }
      }
    }
  }
  
  // For stats calculation, use StockCharts data (all records) for consistency
  // This ensures we have a complete dataset with consistent industry names
  const stats = calculateIndustrySectorStats(all);
  
  // When calculating RS for enriched records with Finviz industries,
  // map Finviz industry names to StockCharts industry names for stats lookup
  // This allows us to compare Finviz-classified stocks against the full StockCharts dataset

  // Calculate 50-day MA position for industries in the results
  const industryMA50 = {};
  const industriesInResults = new Set();
  for (const record of enrichedRecords) {
    const industry = String(record.industry || "").trim();
    if (industry && !industriesInResults.has(industry)) {
      industriesInResults.add(industry);
    }
  }

  // Calculate MA50 for each unique industry (caching and ETFs make this faster)
  const industriesArray = Array.from(industriesInResults);
  
  // Helper to add timeout to promises
  const withTimeout = (promise, timeoutMs = 30000) => {
    return Promise.race([
      promise,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Timeout")), timeoutMs)
      )
    ]);
  };

  const ma50Promises = industriesArray.map(async (industry) => {
    // Use enrichedRecords (with Finviz/StockCharts industry names) instead of all
    const industryRecords = enrichedRecords.filter((r) => String(r.industry || "").trim() === industry);
    if (industryRecords.length === 0) {
      console.log(`[API] No records found for industry: "${industry}"`);
      return null;
    }
    
    console.log(`[API] Calculating MA50 for industry: "${industry}" with ${industryRecords.length} records`);
    
    try {
      // Pass allEnriched so it can find other stocks in the same industry for stock-based calculation
      const ma50Data = await withTimeout(
        calculateIndustryMA50(industryRecords, allEnriched),
        30000 // 30 second timeout per industry
      );
      return { industry, data: ma50Data };
    } catch (error) {
      console.error(`Error calculating MA50 for industry ${industry}:`, error.message || error);
      return null;
    }
  });

  // Wait for all MA50 calculations (with timeout per industry)
  const ma50Results = await Promise.allSettled(ma50Promises);
  for (const result of ma50Results) {
    if (result.status === "fulfilled" && result.value && result.value.data) {
      industryMA50[result.value.industry] = result.value.data;
      console.log(`[API] Successfully got MA50 for industry: ${result.value.industry}`);
    } else if (result.status === "rejected") {
      console.error(`[API] MA50 promise rejected:`, result.reason);
    } else if (result.status === "fulfilled" && result.value && !result.value.data) {
      console.log(`[API] MA50 returned null for industry: ${result.value.industry}`);
    }
  }
  
  console.log(`[API] Total industries processed: ${industriesArray.length}, successful: ${Object.keys(industryMA50).length}`);

  // Add relative strength and MA50 info to each record
  const recordsWithRS = enrichedRecords.map((record) => {
    const rs = calculateRelativeStrength(record, stats, finvizToStockChartsMap);
    const industry = String(record.industry || "").trim();
    const industryMA50Data = industryMA50[industry] || null;

    const enrichedRecord = {
      ...record,
      industryRS: rs.industryRS,
      sectorRS: rs.sectorRS,
      industryAboveMA50: industryMA50Data?.aboveMA ?? null,
      industryPercentAboveMA50: industryMA50Data?.percentAboveMA50 ?? null
    };

    // Debug logging for first few records
    if (records.indexOf(record) < 3) {
      console.log(`[API] Record ${record.symbol} (${industry}):`, {
        hasMA50Data: !!industryMA50Data,
        aboveMA: enrichedRecord.industryAboveMA50,
        percentAbove: enrichedRecord.industryPercentAboveMA50,
        availableIndustries: Object.keys(industryMA50)
      });
    }

    return enrichedRecord;
  });

  // Stable-ish: keep higher SCTR first by default.
  recordsWithRS.sort((a, b) => {
    const sa = typeof a.SCTR === "number" ? a.SCTR : -Infinity;
    const sb = typeof b.SCTR === "number" ? b.SCTR : -Infinity;
    if (sa === sb) return String(a.symbol).localeCompare(String(b.symbol));
    return sb - sa;
  });

  return { records: recordsWithRS, stats: { ...stats, industryMA50 }, missingTickers };
}

module.exports = {
  parseCsvForTickers,
  fetchSctrForTickers
};
