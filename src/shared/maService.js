/**
 * Calculate 50-day moving average position for industries.
 * Uses known industry/sector ETFs when available, otherwise calculates from individual stocks.
 * Includes persistent disk caching to avoid redundant API calls.
 */

const fs = require("fs");
const path = require("path");

// Use Node's https module if fetch is not available (Node < 18)
let httpFetch;
if (typeof fetch !== "undefined") {
  // Use native fetch if available (Node 18+ or Electron)
  httpFetch = fetch;
} else {
  // Fallback to https module for older Node versions
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
              "User-Agent": "Mozilla/5.0 (compatible; stock-details/1.0)",
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
                  json: async () => JSON.parse(data),
                  text: async () => data
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

// Persistent cache files
const PRICES_CACHE_FILE = path.join(__dirname, "../../.cache/ma50-prices-cache.json");
const INDUSTRY_MA50_CACHE_FILE = path.join(__dirname, "../../.cache/ma50-industry-cache.json");
const PRICES_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 1 day cache for price data
const INDUSTRY_MA50_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 1 day cache for MA50 calculations

// In-memory caches (loaded from disk)
const pricesCache = new Map();
const industryMA50Cache = new Map();

// Mapping of industries to known ETF tickers
// Includes both StockCharts and Finviz industry name variations
const INDUSTRY_ETF_MAP = {
  // Semiconductors
  Semiconductors: "SMH", // VanEck Semiconductor ETF
  "Semiconductor Equipment": "SMH",
  
  // Technology sectors
  Software: "IGV", // iShares Expanded Tech-Software Sector ETF
  "Software - Application": "IGV",
  "Software - Infrastructure": "IGV",
  "Software - System": "IGV",
  "Internet Content & Information": "FDN", // First Trust Dow Jones Internet Index
  "Information Technology Services": "IGV",
  
  // Consumer Discretionary - Retail
  "Broadline Retailers": "XRT", // SPDR S&P Retail ETF
  "Specialty Retail": "XRT",
  "Internet Retail": "XRT", // Finviz name
  "Discount Stores": "XRT", // Finviz name
  "Department Stores": "XRT", // Finviz name
  "Apparel Retail": "XRT", // Finviz name
  "Home Improvement Retail": "XRT", // Finviz name
  
  // Consumer Discretionary - Automotive
  "Automotive": "CARZ", // First Trust NASDAQ Global Auto Index
  "Automobiles": "CARZ", // First Trust NASDAQ Global Auto Index
  "Auto Manufacturers": "CARZ", // Finviz name
  "Auto Parts": "CARZ",
  "Auto & Truck Dealerships": "CARZ", // Finviz name
  
  // Consumer Discretionary - Other
  "Hotels & Motels": "PEJ", // Invesco Dynamic Leisure and Entertainment ETF
  "Restaurants": "PEJ",
  "Entertainment": "PEJ",
  "Leisure": "PEJ", // Finviz name
  "Recreational Vehicles": "PEJ", // Finviz name
  
  // Financials
  "Banks - Regional": "KRE", // SPDR S&P Regional Banking ETF
  "Banks - Diversified": "KBE", // SPDR S&P Bank ETF
  "Regional Banks": "KRE", // Finviz name
  "Money Center Banks": "KBE", // Finviz name
  "Capital Markets": "IAI", // iShares U.S. Broker-Dealers & Securities Exchanges ETF
  "Investment Brokerage": "IAI", // Finviz name
  "Insurance": "KIE", // SPDR S&P Insurance ETF
  "Property & Casualty Insurance": "KIE", // Finviz name
  "Life Insurance": "KIE", // Finviz name
  
  // Healthcare
  "Biotechnology": "XBI", // SPDR S&P Biotech ETF
  "Drug Manufacturers": "PJP", // Invesco Dynamic Pharmaceuticals ETF
  "Drug Manufacturers - Major": "PJP", // Finviz name
  "Drug Manufacturers - Specialty & Generic": "PJP", // Finviz name
  "Medical Devices": "IHI", // iShares U.S. Medical Devices ETF
  "Medical Instruments & Supplies": "IHI", // Finviz name
  "Healthcare Plans": "IHF", // iShares U.S. Healthcare Providers ETF
  "Health Care Plans": "IHF", // Finviz name
  
  // Energy
  "Oil & Gas": "XLE", // Energy Select Sector SPDR Fund
  "Oil & Gas E&P": "XOP", // SPDR S&P Oil & Gas Exploration & Production ETF
  "Oil & Gas Drilling": "XOP", // Finviz name
  "Oil & Gas Refining & Marketing": "XLE", // Finviz name
  "Oil & Gas Pipelines": "XLE", // Finviz name
  
  // Industrials
  "Aerospace & Defense": "ITA", // iShares U.S. Aerospace & Defense ETF
  "Aerospace/Defense": "ITA", // Finviz name
  "Industrial Machinery": "XLI", // Industrial Select Sector SPDR Fund
  "Railroads": "IYT", // iShares Transportation Average ETF
  "Railroads": "IYT", // Finviz name
  "Airlines": "JETS", // U.S. Global Jets ETF
  "Shipping": "SEA", // Invesco Shipping ETF
  
  // Materials
  "Gold": "GDX", // VanEck Gold Miners ETF
  "Steel": "SLX", // VanEck Steel ETF
  "Chemicals": "IYM", // iShares U.S. Basic Materials ETF
  "Chemicals - Major Diversified": "IYM", // Finviz name
  
  // Utilities
  "Utilities": "XLU", // Utilities Select Sector SPDR Fund
  "Electric Utilities": "XLU", // Finviz name
  "Gas Utilities": "XLU", // Finviz name
  
  // Real Estate
  "REITs": "VNQ", // Vanguard Real Estate ETF
  "Real Estate": "VNQ",
  "REIT - Residential": "VNQ", // Finviz name
  "REIT - Retail": "VNQ", // Finviz name
  "REIT - Office": "VNQ" // Finviz name
};

// Sector ETF mapping
const SECTOR_ETF_MAP = {
  Technology: "XLK", // Technology Select Sector SPDR Fund
  "Consumer Discretionary": "XLY", // Consumer Discretionary Select Sector SPDR Fund
  "Consumer Staples": "XLP", // Consumer Staples Select Sector SPDR Fund
  Financials: "XLF", // Financial Select Sector SPDR Fund
  Healthcare: "XLV", // Health Care Select Sector SPDR Fund
  Energy: "XLE", // Energy Select Sector SPDR Fund
  Industrials: "XLI", // Industrial Select Sector SPDR Fund
  Materials: "XLB", // Materials Select Sector SPDR Fund
  Utilities: "XLU", // Utilities Select Sector SPDR Fund
  "Real Estate": "XLRE", // Real Estate Select Sector SPDR Fund
  "Communication Services": "XLC" // Communication Services Select Sector SPDR Fund
};

/**
 * Load prices cache from disk
 */
function loadPricesCache() {
  try {
    if (fs.existsSync(PRICES_CACHE_FILE)) {
      const data = fs.readFileSync(PRICES_CACHE_FILE, "utf8");
      const cache = JSON.parse(data);
      const now = Date.now();
      
      // Load valid entries into memory
      for (const [key, entry] of Object.entries(cache)) {
        if (entry.timestamp && (now - entry.timestamp < PRICES_CACHE_TTL_MS)) {
          pricesCache.set(key, entry.data);
        }
      }
      console.log(`[MA50] Loaded ${pricesCache.size} cached price entries from disk`);
    }
  } catch (error) {
    console.warn(`[MA50] Failed to load prices cache:`, error.message);
  }
}

/**
 * Save prices cache to disk
 */
function savePricesCache() {
  try {
    const cacheDir = path.dirname(PRICES_CACHE_FILE);
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }
    
    const cacheObj = {};
    for (const [key, data] of pricesCache.entries()) {
      cacheObj[key] = {
        data,
        timestamp: Date.now()
      };
    }
    
    fs.writeFileSync(PRICES_CACHE_FILE, JSON.stringify(cacheObj, null, 2), "utf8");
  } catch (error) {
    console.warn(`[MA50] Failed to save prices cache:`, error.message);
  }
}

/**
 * Load industry MA50 cache from disk
 */
function loadIndustryMA50Cache() {
  try {
    if (fs.existsSync(INDUSTRY_MA50_CACHE_FILE)) {
      const data = fs.readFileSync(INDUSTRY_MA50_CACHE_FILE, "utf8");
      const cache = JSON.parse(data);
      const now = Date.now();
      
      // Load valid entries into memory
      for (const [industry, entry] of Object.entries(cache)) {
        if (entry.timestamp && (now - entry.timestamp < INDUSTRY_MA50_CACHE_TTL_MS)) {
          industryMA50Cache.set(industry, entry.data);
        }
      }
      console.log(`[MA50] Loaded ${industryMA50Cache.size} cached industry MA50 entries from disk`);
    }
  } catch (error) {
    console.warn(`[MA50] Failed to load industry MA50 cache:`, error.message);
  }
}

/**
 * Save industry MA50 cache to disk
 */
function saveIndustryMA50Cache() {
  try {
    const cacheDir = path.dirname(INDUSTRY_MA50_CACHE_FILE);
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }
    
    const cacheObj = {};
    for (const [industry, data] of industryMA50Cache.entries()) {
      cacheObj[industry] = {
        data,
        timestamp: Date.now()
      };
    }
    
    fs.writeFileSync(INDUSTRY_MA50_CACHE_FILE, JSON.stringify(cacheObj, null, 2), "utf8");
  } catch (error) {
    console.warn(`[MA50] Failed to save industry MA50 cache:`, error.message);
  }
}

async function fetchHistoricalPrices(symbol, days = 90) {
  // Check cache first
  const cacheKey = `prices_${symbol}_${days}`;
  const cached = pricesCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  // Yahoo Finance API endpoint (no key required)
  // Request 90 calendar days to ensure we get at least 50 trading days
  const endDate = Math.floor(Date.now() / 1000);
  const startDate = endDate - 90 * 24 * 60 * 60; // 90 days ago in seconds

  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&period1=${startDate}&period2=${endDate}`;
    const resp = await httpFetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; stock-details/1.0)"
      }
    });

    if (!resp.ok) {
      console.error(`[MA50] HTTP error fetching ${symbol}: status ${resp.status}`);
      try {
        const errorText = await resp.text();
        console.error(`[MA50] Error response body: ${errorText.substring(0, 200)}`);
      } catch (e) {
        // Ignore text parsing errors
      }
      return null;
    }

    const data = await resp.json();
    if (!data) {
      console.error(`[MA50] No data returned for ${symbol}`);
      return null;
    }
    
    const result = data?.chart?.result?.[0];
    if (!result || !result.timestamp || !result.indicators?.quote?.[0]?.close) {
      console.error(`[MA50] Invalid data structure for ${symbol}:`, {
        hasChart: !!data?.chart,
        hasResult: !!result,
        hasTimestamp: !!result?.timestamp,
        hasClose: !!result?.indicators?.quote?.[0]?.close,
        resultKeys: result ? Object.keys(result) : [],
        indicators: result?.indicators ? Object.keys(result.indicators) : []
      });
      return null;
    }

    const timestamps = result.timestamp;
    const closes = result.indicators.quote[0].close;
    const prices = [];

    for (let i = 0; i < timestamps.length && i < closes.length; i++) {
      if (closes[i] != null && timestamps[i] != null) {
        prices.push({
          date: new Date(timestamps[i] * 1000).toISOString().split("T")[0],
          close: closes[i]
        });
      }
    }

    const resultData = prices.length >= 50 ? prices : null;
    
    if (resultData) {
      pricesCache.set(cacheKey, resultData);
      // Save to disk periodically (every 10 new entries)
      if (pricesCache.size % 10 === 0) {
        savePricesCache();
      }
    }
    
    return resultData;
  } catch (error) {
    console.error(`[MA50] Error fetching historical data for ${symbol}:`, error.message || error);
    console.error(`[MA50] Error stack:`, error.stack);
    return null;
  }
}

function calculateMA(prices, period = 50) {
  if (!prices || prices.length < period) return null;

  const recent = prices.slice(-period);
  const sum = recent.reduce((acc, p) => acc + (p.close || 0), 0);
  return sum / period;
}

async function calculateIndustryMA50FromETF(etfSymbol) {
  const prices = await fetchHistoricalPrices(etfSymbol, 90);
  if (!prices || prices.length < 50) {
    return null;
  }

  const ma50 = calculateMA(prices, 50);
  const currentPrice = prices[prices.length - 1]?.close;

  if (ma50 == null || currentPrice == null) {
    return null;
  }

  return {
    currentIndex: currentPrice,
    ma50,
    aboveMA: currentPrice > ma50,
    percentAboveMA50: ((currentPrice - ma50) / ma50) * 100,
    source: "ETF"
  };
}

async function calculateIndustryMA50FromStocks(industryRecords, allRecords) {
  // Get all stocks in this industry
  const industryName = industryRecords[0]?.industry;
  if (!industryName) return null;

  const allIndustryStocks = allRecords.filter(
    (r) => String(r.industry || "").trim() === industryName
  );

  if (allIndustryStocks.length === 0) return null;

  // Sample up to 20 stocks to build industry index (or use all if smaller)
  const stocksToCheck = allIndustryStocks.length <= 20
    ? allIndustryStocks
    : allIndustryStocks.slice(0, 20);

  // Fetch historical data for stocks (with rate limiting)
  const stockPrices = [];
  for (const stock of stocksToCheck) {
    const symbol = String(stock.symbol || "").trim();
    if (!symbol) continue;

    const prices = await fetchHistoricalPrices(symbol, 90);
    if (prices && prices.length >= 50) {
      stockPrices.push({ symbol, prices });
    }

    // Rate limiting: small delay between requests
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  if (stockPrices.length === 0) return null;

  // Build industry index: average price across all stocks for each day
  const dateSet = new Set();
  for (const { prices } of stockPrices) {
    for (const p of prices) {
      dateSet.add(p.date);
    }
  }

  const dates = Array.from(dateSet).sort();
  if (dates.length < 50) return null;

  // Calculate industry index for each date (average of all stocks' prices)
  const industryIndex = [];
  for (const date of dates) {
    const pricesForDate = [];
    for (const { prices } of stockPrices) {
      const price = prices.find((p) => p.date === date);
      if (price && price.close != null) {
        pricesForDate.push(price.close);
      }
    }

    if (pricesForDate.length > 0) {
      const avgPrice = pricesForDate.reduce((sum, p) => sum + p, 0) / pricesForDate.length;
      industryIndex.push({ date, close: avgPrice });
    }
  }

  if (industryIndex.length < 50) return null;

  // Calculate 50-day MA of the industry index
  const ma50 = calculateMA(industryIndex, 50);
  const currentIndex = industryIndex[industryIndex.length - 1]?.close;

  if (ma50 == null || currentIndex == null) return null;

  return {
    currentIndex,
    ma50,
    aboveMA: currentIndex > ma50,
    percentAboveMA50: ((currentIndex - ma50) / ma50) * 100,
    source: "calculated",
    stocksUsed: stockPrices.length,
    totalStocks: allIndustryStocks.length
  };
}

function findETFForIndustry(industryName) {
  // Exact match first
  if (INDUSTRY_ETF_MAP[industryName]) {
    return INDUSTRY_ETF_MAP[industryName];
  }

  // Fuzzy matching for common variations
  const normalized = industryName.toLowerCase();
  
  // Semiconductors variations
  if (normalized.includes("semiconductor")) {
    return "SMH";
  }
  
  // Software variations
  if (normalized.includes("software")) {
    return "IGV";
  }
  
  // Retail variations (including Finviz names)
  if (normalized.includes("retail") || normalized.includes("retailer") || 
      normalized.includes("discount store") || normalized.includes("internet retail")) {
    return "XRT";
  }
  
  // Automotive/Automobile variations (including Finviz names)
  if (normalized.includes("auto") || normalized.includes("automobile") || 
      normalized.includes("auto manufacturer")) {
    return "CARZ";
  }
  
  // Banking variations
  if (normalized.includes("bank")) {
    return normalized.includes("regional") ? "KRE" : "KBE";
  }
  
  // Capital Markets / Investment variations
  if (normalized.includes("capital market") || normalized.includes("investment") ||
      normalized.includes("broker") || normalized.includes("securities")) {
    return "IAI";
  }
  
  // Biotech variations
  if (normalized.includes("biotech") || normalized.includes("biotechnology")) {
    return "XBI";
  }
  
  // Medical/Healthcare variations
  if (normalized.includes("medical device") || normalized.includes("medical instrument")) {
    return "IHI";
  }
  if (normalized.includes("drug") || normalized.includes("pharmaceutical")) {
    return "PJP";
  }
  
  // Energy variations
  if (normalized.includes("oil") || normalized.includes("gas")) {
    return normalized.includes("exploration") || normalized.includes("e&p") || normalized.includes("drilling") ? "XOP" : "XLE";
  }
  
  // Aerospace variations
  if (normalized.includes("aerospace") || normalized.includes("defense")) {
    return "ITA";
  }
  
  return null;
}

async function calculateIndustryMA50(industryRecords, allRecords) {
  const industryName = industryRecords[0]?.industry;
  const sectorName = industryRecords[0]?.sector;
  
  if (!industryName) {
    console.log(`[MA50] No industry name found for records`);
    return null;
  }

  console.log(`[MA50] Calculating MA50 for industry: "${industryName}" (sector: "${sectorName}")`);

  // Check cache first
  const cached = industryMA50Cache.get(industryName);
  if (cached) {
    console.log(`[MA50] Using cached result for industry: ${industryName}`);
    return cached;
  }

  let result = null;
  let usedETF = null;
  let usedSource = null;

  // Try to use known ETF first (exact match or fuzzy)
  let etfSymbol = INDUSTRY_ETF_MAP[industryName] || findETFForIndustry(industryName);
  
  if (etfSymbol) {
    usedETF = etfSymbol;
    usedSource = "industry";
    console.log(`[MA50] Found industry ETF ${etfSymbol} for "${industryName}"`);
  }
  
  // If no industry ETF found, try sector ETF as fallback
  if (!etfSymbol && sectorName) {
    etfSymbol = SECTOR_ETF_MAP[sectorName];
    if (etfSymbol) {
      usedETF = etfSymbol;
      usedSource = "sector";
      console.log(`[MA50] No industry ETF for "${industryName}", using sector ETF ${etfSymbol} for sector "${sectorName}"`);
    } else {
      console.log(`[MA50] No sector ETF found for sector: "${sectorName}"`);
    }
  }
  
  if (etfSymbol) {
    console.log(`[MA50] Using ETF ${etfSymbol} (${usedSource}) for industry: "${industryName}"`);
    try {
      result = await calculateIndustryMA50FromETF(etfSymbol);
      if (result) {
        console.log(`[MA50] Successfully calculated MA50 from ETF ${etfSymbol}: aboveMA=${result.aboveMA}, percent=${result.percentAboveMA50?.toFixed(2)}%`);
      } else {
        console.log(`[MA50] ETF ${etfSymbol} returned null result`);
      }
    } catch (error) {
      console.error(`[MA50] Error fetching ETF ${etfSymbol} for industry ${industryName}:`, error.message || error);
    }
  } else {
    console.log(`[MA50] No ETF found for industry: "${industryName}"${sectorName ? ` or sector: "${sectorName}"` : ""}, will calculate from stocks`);
  }

  // Fallback to calculating from individual stocks if ETF not available or failed
  if (!result) {
    try {
      console.log(`[MA50] Calculating MA50 from stocks for industry: "${industryName}"`);
      const industryStocks = allRecords.filter(
        (r) => String(r.industry || "").trim() === industryName
      );
      console.log(`[MA50] Found ${industryStocks.length} stocks in industry "${industryName}"`);
      
      result = await calculateIndustryMA50FromStocks(industryRecords, allRecords);
      if (result) {
        console.log(`[MA50] Successfully calculated MA50 from stocks: aboveMA=${result.aboveMA}, percent=${result.percentAboveMA50?.toFixed(2)}%`);
      } else {
        console.log(`[MA50] Stock calculation returned null result for industry: "${industryName}"`);
      }
    } catch (error) {
      console.error(`[MA50] Error calculating MA50 from stocks for industry ${industryName}:`, error.message || error);
    }
  }

  // Cache the result (even if null, to avoid repeated failed attempts)
  if (result) {
    industryMA50Cache.set(industryName, result);
    // Save to disk periodically
    if (industryMA50Cache.size % 5 === 0) {
      saveIndustryMA50Cache();
    }
    console.log(`[MA50] Cached result for industry: "${industryName}"`);
  } else {
    // Cache null for 1 day to avoid hammering APIs
    industryMA50Cache.set(industryName, null);
    console.log(`[MA50] Cached null result for industry: "${industryName}" (will retry tomorrow)`);
  }

  return result;
}

// Load caches on module load
loadPricesCache();
loadIndustryMA50Cache();

module.exports = {
  calculateIndustryMA50,
  fetchHistoricalPrices,
  clearCache: () => {
    pricesCache.clear();
    industryMA50Cache.clear();
    try {
      if (fs.existsSync(PRICES_CACHE_FILE)) {
        fs.unlinkSync(PRICES_CACHE_FILE);
      }
      if (fs.existsSync(INDUSTRY_MA50_CACHE_FILE)) {
        fs.unlinkSync(INDUSTRY_MA50_CACHE_FILE);
      }
    } catch (error) {
      // Ignore
    }
  }
};
