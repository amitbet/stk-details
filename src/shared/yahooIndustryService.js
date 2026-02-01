/**
 * Fetch industry and sector classifications from Yahoo Finance.
 * Yahoo Finance is more reliable and less rate-limited than Finviz.
 */

const fs = require("fs");
const path = require("path");

// Persistent cache file path
const CACHE_FILE = path.join(__dirname, "../../.cache/yahoo-industry-cache.json");
const CACHE_TTL_MS = 180 * 24 * 60 * 60 * 1000; // 6 months cache (industry categories change rarely)

// In-memory cache
let industryCache = new Map();

// Use Node's https module if fetch is not available (Node < 18)
let httpFetch;
if (typeof fetch !== "undefined") {
  httpFetch = fetch;
} else {
  const https = require("https");
  const { URL } = require("url");
  httpFetch = async (url, options = {}) => {
    return new Promise((resolve, reject) => {
      try {
        const urlObj = new URL(url);
        const req = https.request(
          {
            hostname: urlObj.hostname,
            path: urlObj.pathname + urlObj.search,
            method: options.method || "GET",
            headers: {
              "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
              ...(options.headers || {})
            }
          },
          (res) => {
            let data = "";
            res.on("data", (chunk) => {
              data += chunk;
            });
            res.on("end", () => {
              try {
                resolve({
                  ok: res.statusCode >= 200 && res.statusCode < 300,
                  status: res.statusCode,
                  text: async () => data,
                  json: async () => JSON.parse(data)
                });
              } catch (parseError) {
                reject(new Error(`Failed to parse response: ${parseError.message}`));
              }
            });
          }
        );
        req.on("error", reject);
        req.setTimeout(10000, () => {
          req.destroy();
          reject(new Error("Request timeout"));
        });
        req.end();
      } catch (error) {
        reject(error);
      }
    });
  };
}

/**
 * Load cache from disk
 */
function loadCache() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const data = fs.readFileSync(CACHE_FILE, "utf8");
      const cache = JSON.parse(data);
      const now = Date.now();
      
      // Load valid entries into memory
      for (const [ticker, entry] of Object.entries(cache)) {
        if (entry.timestamp && (now - entry.timestamp < CACHE_TTL_MS)) {
          industryCache.set(ticker.toUpperCase(), entry.data);
        }
      }
      console.log(`[Yahoo] Loaded ${industryCache.size} cached entries from disk`);
    }
  } catch (error) {
    console.warn(`[Yahoo] Failed to load cache:`, error.message);
  }
}

/**
 * Save cache to disk
 */
function saveCache() {
  try {
    const cacheDir = path.dirname(CACHE_FILE);
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }
    
    const cacheObj = {};
    for (const [ticker, data] of industryCache.entries()) {
      cacheObj[ticker] = {
        data,
        timestamp: Date.now()
      };
    }
    
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cacheObj, null, 2), "utf8");
  } catch (error) {
    console.warn(`[Yahoo] Failed to save cache:`, error.message);
  }
}

/**
 * Fetch industry and sector for a single ticker from Yahoo Finance
 */
async function fetchYahooIndustrySector(ticker) {
  const symbol = String(ticker || "").trim().toUpperCase();
  if (!symbol) return null;

  // Check in-memory cache first
  const cached = industryCache.get(symbol);
  if (cached) {
    return cached;
  }

  try {
    // Yahoo Finance quote summary endpoint
    // This endpoint provides company info including sector and industry
    const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${symbol}?modules=assetProfile`;
    
    const resp = await httpFetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
      }
    });

    if (!resp.ok) {
      if (resp.status === 404) {
        // Ticker not found
        return null;
      }
      console.error(`[Yahoo] HTTP error for ${symbol}: status ${resp.status}`);
      return null;
    }

    const data = await resp.json();
    const result = data?.quoteSummary?.result?.[0]?.assetProfile;
    
    if (!result) {
      return null;
    }

    const industry = result.industry ? String(result.industry).trim() : null;
    const sector = result.sector ? String(result.sector).trim() : null;

    const resultData = (sector || industry) ? { sector, industry, source: "Yahoo" } : null;
    
    // Cache the result (even if null, to avoid repeated failed attempts)
    if (resultData) {
      industryCache.set(symbol, resultData);
      // Save to disk periodically (every 10 new entries)
      if (industryCache.size % 10 === 0) {
        saveCache();
      }
    } else {
      // Cache null for 1 day to avoid hammering APIs
      industryCache.set(symbol, null);
    }

    return resultData;
  } catch (error) {
    console.error(`[Yahoo] Error fetching data for ${symbol}:`, error.message || error);
    return null;
  }
}

/**
 * Fetch industry and sector for multiple tickers (with rate limiting)
 */
async function fetchYahooIndustrySectorBatch(tickers, options = {}) {
  const { delayMs = 100, maxConcurrent = 5 } = options;
  const results = new Map();
  
  // Process in batches to avoid overwhelming Yahoo Finance
  const batches = [];
  for (let i = 0; i < tickers.length; i += maxConcurrent) {
    batches.push(tickers.slice(i, i + maxConcurrent));
  }

  for (const batch of batches) {
    const promises = batch.map(async (ticker) => {
      const data = await fetchYahooIndustrySector(ticker);
      return { ticker, data };
    });
    
    const batchResults = await Promise.allSettled(promises);
    for (const result of batchResults) {
      if (result.status === "fulfilled" && result.value) {
        const { ticker, data } = result.value;
        if (data) {
          results.set(ticker.toUpperCase(), data);
        }
      }
    }
    
    // Rate limiting between batches
    if (batches.indexOf(batch) < batches.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  // Save cache to disk after batch processing
  saveCache();

  return results;
}

// Load cache on module load
loadCache();

module.exports = {
  fetchYahooIndustrySector,
  fetchYahooIndustrySectorBatch,
  clearCache: () => {
    industryCache.clear();
    try {
      if (fs.existsSync(CACHE_FILE)) {
        fs.unlinkSync(CACHE_FILE);
      }
    } catch (error) {
      // Ignore
    }
  }
};
