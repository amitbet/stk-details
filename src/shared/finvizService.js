/**
 * Fetch industry and sector classifications from Finviz.
 * Finviz doesn't have a public API, so we scrape their quote pages.
 * Uses persistent caching to avoid rate limits (429 errors).
 */

const fs = require("fs");
const path = require("path");

// Persistent cache file path
const CACHE_FILE = path.join(__dirname, "../../.cache/finviz-industry-cache.json");
const CACHE_TTL_MS = 180 * 24 * 60 * 60 * 1000; // 6 months cache (industry categories change rarely)

// In-memory cache
const finvizCache = new Map();

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
              "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
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
function loadFinvizCache() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const data = fs.readFileSync(CACHE_FILE, "utf8");
      const cache = JSON.parse(data);
      const now = Date.now();
      
      // Load valid entries into memory
      for (const [ticker, entry] of Object.entries(cache)) {
        if (entry.timestamp && (now - entry.timestamp < CACHE_TTL_MS)) {
          finvizCache.set(ticker.toUpperCase(), entry.data);
        }
      }
      console.log(`[Finviz] Loaded ${finvizCache.size} cached entries from disk`);
    }
  } catch (error) {
    console.warn(`[Finviz] Failed to load cache:`, error.message);
  }
}

/**
 * Save cache to disk
 */
function saveFinvizCache() {
  try {
    const cacheDir = path.dirname(CACHE_FILE);
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }
    
    const cacheObj = {};
    for (const [ticker, data] of finvizCache.entries()) {
      cacheObj[ticker] = {
        data,
        timestamp: Date.now()
      };
    }
    
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cacheObj, null, 2), "utf8");
  } catch (error) {
    console.warn(`[Finviz] Failed to save cache:`, error.message);
  }
}

/**
 * Fetch industry and sector for a single ticker from Finviz
 */
async function fetchFinvizIndustrySector(ticker) {
  const symbol = String(ticker || "").trim().toUpperCase();
  if (!symbol) return null;

  // Check in-memory cache first
  const cached = finvizCache.get(symbol);
  if (cached) {
    return cached;
  }

  try {
    // Finviz quote page URL
    const url = `https://finviz.com/quote.ashx?t=${encodeURIComponent(symbol)}`;
    const resp = await httpFetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9"
      }
    });

    if (!resp.ok) {
      console.error(`[Finviz] HTTP error for ${symbol}: status ${resp.status}`);
      return null;
    }

    const html = await resp.text();
    
    // Parse industry and sector from HTML
    // Finviz uses a snapshot table structure
    // Try multiple patterns to find the data
    
    let industry = null;
    let sector = null;
    
    // Method 1: Look for snapshot table - pattern: Sector</td><td[^>]*>([^<]+)</td>
    const sectorPatterns = [
      /Sector<\/td>\s*<td[^>]*>([^<]+)<\/td>/i,
      /Sector[:\s]*<\/td>\s*<td[^>]*>([^<]+)<\/td>/i,
      /snapshot-td2[^>]*>Sector<\/td>\s*<td[^>]*>([^<]+)<\/td>/i,
      /Sector[^<]*<\/td>\s*<td[^>]*class="snapshot-td2"[^>]*>([^<]+)<\/td>/i
    ];
    
    for (const pattern of sectorPatterns) {
      const match = html.match(pattern);
      if (match && match[1]) {
        sector = match[1].trim().replace(/&nbsp;/g, " ").replace(/\s+/g, " ");
        if (sector && sector.length > 0 && sector !== "Sector") {
          break;
        }
      }
    }
    
    // Method 2: Look for Industry
    const industryPatterns = [
      /Industry<\/td>\s*<td[^>]*>([^<]+)<\/td>/i,
      /Industry[:\s]*<\/td>\s*<td[^>]*>([^<]+)<\/td>/i,
      /snapshot-td2[^>]*>Industry<\/td>\s*<td[^>]*>([^<]+)<\/td>/i,
      /Industry[^<]*<\/td>\s*<td[^>]*class="snapshot-td2"[^>]*>([^<]+)<\/td>/i
    ];
    
    for (const pattern of industryPatterns) {
      const match = html.match(pattern);
      if (match && match[1]) {
        industry = match[1].trim().replace(/&nbsp;/g, " ").replace(/\s+/g, " ");
        if (industry && industry.length > 0 && industry !== "Industry") {
          break;
        }
      }
    }
    
    // Method 3: Look for data in tooltip/hover text (Finviz shows industry in peer links)
    if (!industry) {
      // Pattern: <b>Company Name</b>Industry Name <span>•</span>
      const tooltipMatch = html.match(/<b>[^<]+<\/b>([^<•]+)<span[^>]*>•<\/span>/i);
      if (tooltipMatch && tooltipMatch[1]) {
        const potentialIndustry = tooltipMatch[1].trim();
        // Make sure it's not just the company name
        if (potentialIndustry.length > 3 && potentialIndustry.length < 100) {
          industry = potentialIndustry;
        }
      }
    }
    
    // Method 4: Try to find in meta tags or structured data
    if (!sector || !industry) {
      const metaMatch = html.match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']+)["']/i);
      if (metaMatch) {
        const desc = metaMatch[1];
        // Sometimes sector/industry is in the description
        const sectorMatch = desc.match(/(Technology|Healthcare|Financial|Consumer|Energy|Industrial|Materials|Utilities|Real Estate|Communication)/i);
        if (sectorMatch && !sector) {
          sector = sectorMatch[1];
        }
      }
    }

    const result = (sector || industry) ? { sector, industry, source: "Finviz" } : null;
    
    // Cache the result (even if null, to avoid repeated failed attempts)
    if (result) {
      finvizCache.set(symbol, result);
      // Save to disk periodically
      if (finvizCache.size % 5 === 0) {
        saveFinvizCache();
      }
    } else {
      // Cache null for 7 days to avoid hammering APIs
      finvizCache.set(symbol, null);
    }

    return result;
  } catch (error) {
    console.error(`[Finviz] Error fetching data for ${symbol}:`, error.message || error);
    return null;
  }
}

/**
 * Fetch industry and sector for multiple tickers (with aggressive rate limiting to avoid 429)
 */
async function fetchFinvizIndustrySectorBatch(tickers, options = {}) {
  const { delayMs = 2000, maxConcurrent = 1 } = options; // Very conservative defaults
  const results = new Map();
  
  // Filter out tickers we already have cached
  const uncachedTickers = tickers.filter(t => {
    const symbol = String(t).trim().toUpperCase();
    return !finvizCache.has(symbol) || finvizCache.get(symbol) === null;
  });
  
  console.log(`[Finviz] ${uncachedTickers.length}/${tickers.length} tickers need fetching (${tickers.length - uncachedTickers.length} cached)`);
  
  // Return cached results immediately
  for (const ticker of tickers) {
    const symbol = String(ticker).trim().toUpperCase();
    const cached = finvizCache.get(symbol);
    if (cached) {
      results.set(symbol, cached);
    }
  }
  
  // Process uncached tickers one at a time with delays to avoid rate limits
  for (const ticker of uncachedTickers) {
    try {
      const data = await fetchFinvizIndustrySector(ticker);
      if (data) {
        results.set(String(ticker).trim().toUpperCase(), data);
      }
      // Aggressive rate limiting: wait between each request
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    } catch (error) {
      if (error.message && error.message.includes("429")) {
        console.warn(`[Finviz] Rate limited, stopping batch fetch`);
        break; // Stop if we hit rate limit
      }
      console.error(`[Finviz] Error fetching ${ticker}:`, error.message);
    }
  }
  
  // Save cache to disk after batch processing
  saveFinvizCache();

  return results;
}

// Load cache on module load
loadFinvizCache();

module.exports = {
  fetchFinvizIndustrySector,
  fetchFinvizIndustrySectorBatch,
  clearCache: () => {
    finvizCache.clear();
    try {
      if (fs.existsSync(CACHE_FILE)) {
        fs.unlinkSync(CACHE_FILE);
      }
    } catch (error) {
      // Ignore
    }
  }
};
