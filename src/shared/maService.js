/**
 * Calculate 50-day moving average position for industries.
 * Uses known industry/sector ETFs when available, otherwise calculates from individual stocks.
 * Includes caching to avoid redundant API calls.
 */

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

// Cache for industry MA50 results (keyed by industry name)
const ma50Cache = new Map();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour cache

// Mapping of industries to known ETF tickers
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
  
  // Consumer Discretionary
  "Broadline Retailers": "XRT", // SPDR S&P Retail ETF
  "Specialty Retail": "XRT",
  "Automotive": "CARZ", // First Trust NASDAQ Global Auto Index
  "Automobiles": "CARZ", // First Trust NASDAQ Global Auto Index
  "Auto Parts": "CARZ",
  "Hotels & Motels": "PEJ", // Invesco Dynamic Leisure and Entertainment ETF
  "Restaurants": "PEJ",
  "Entertainment": "PEJ",
  
  // Financials
  "Banks - Regional": "KRE", // SPDR S&P Regional Banking ETF
  "Banks - Diversified": "KBE", // SPDR S&P Bank ETF
  "Capital Markets": "IAI", // iShares U.S. Broker-Dealers & Securities Exchanges ETF
  "Insurance": "KIE", // SPDR S&P Insurance ETF
  
  // Healthcare
  "Biotechnology": "XBI", // SPDR S&P Biotech ETF
  "Drug Manufacturers": "PJP", // Invesco Dynamic Pharmaceuticals ETF
  "Medical Devices": "IHI", // iShares U.S. Medical Devices ETF
  "Healthcare Plans": "IHF", // iShares U.S. Healthcare Providers ETF
  
  // Energy
  "Oil & Gas": "XLE", // Energy Select Sector SPDR Fund
  "Oil & Gas E&P": "XOP", // SPDR S&P Oil & Gas Exploration & Production ETF
  
  // Industrials
  "Aerospace & Defense": "ITA", // iShares U.S. Aerospace & Defense ETF
  "Industrial Machinery": "XLI", // Industrial Select Sector SPDR Fund
  "Railroads": "IYT", // iShares Transportation Average ETF
  
  // Materials
  "Gold": "GDX", // VanEck Gold Miners ETF
  "Steel": "SLX", // VanEck Steel ETF
  "Chemicals": "IYM", // iShares U.S. Basic Materials ETF
  
  // Utilities
  "Utilities": "XLU", // Utilities Select Sector SPDR Fund
  
  // Real Estate
  "REITs": "VNQ", // Vanguard Real Estate ETF
  "Real Estate": "VNQ"
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

async function fetchHistoricalPrices(symbol, days = 90) {
  // Check cache first
  const cacheKey = `prices_${symbol}_${days}`;
  const cached = ma50Cache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.data;
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
      // Cache the result
      ma50Cache.set(cacheKey, { data: resultData, timestamp: Date.now() });
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
  
  // Retail variations
  if (normalized.includes("retail") || normalized.includes("retailer")) {
    return "XRT";
  }
  
  // Automotive/Automobile variations
  if (normalized.includes("auto") || normalized.includes("automobile")) {
    return "CARZ";
  }
  
  // Banking variations
  if (normalized.includes("bank")) {
    return normalized.includes("regional") ? "KRE" : "KBE";
  }
  
  // Biotech variations
  if (normalized.includes("biotech") || normalized.includes("biotechnology")) {
    return "XBI";
  }
  
  // Medical/Healthcare variations
  if (normalized.includes("medical device")) {
    return "IHI";
  }
  if (normalized.includes("drug") || normalized.includes("pharmaceutical")) {
    return "PJP";
  }
  
  // Energy variations
  if (normalized.includes("oil") || normalized.includes("gas")) {
    return normalized.includes("exploration") || normalized.includes("e&p") ? "XOP" : "XLE";
  }
  
  // Aerospace variations
  if (normalized.includes("aerospace") || normalized.includes("defense")) {
    return "ITA";
  }
  
  return null;
}

async function calculateIndustryMA50(industryRecords, allRecords) {
  const industryName = industryRecords[0]?.industry;
  if (!industryName) {
    console.log(`[MA50] No industry name found for records`);
    return null;
  }

  // Check cache first
  const cacheKey = `industry_ma50_${industryName}`;
  const cached = ma50Cache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    console.log(`[MA50] Using cached result for industry: ${industryName}`);
    return cached.data;
  }

  let result = null;

  // Try to use known ETF first (exact match or fuzzy)
  const etfSymbol = INDUSTRY_ETF_MAP[industryName] || findETFForIndustry(industryName);
  if (etfSymbol) {
    console.log(`[MA50] Using ETF ${etfSymbol} for industry: ${industryName}`);
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
    console.log(`[MA50] No ETF found for industry: ${industryName}, will calculate from stocks`);
  }

  // Fallback to calculating from individual stocks if ETF not available or failed
  if (!result) {
    try {
      console.log(`[MA50] Calculating MA50 from stocks for industry: ${industryName}`);
      result = await calculateIndustryMA50FromStocks(industryRecords, allRecords);
      if (result) {
        console.log(`[MA50] Successfully calculated MA50 from stocks: aboveMA=${result.aboveMA}, percent=${result.percentAboveMA50?.toFixed(2)}%`);
      } else {
        console.log(`[MA50] Stock calculation returned null result for industry: ${industryName}`);
      }
    } catch (error) {
      console.error(`[MA50] Error calculating MA50 from stocks for industry ${industryName}:`, error.message || error);
    }
  }

  // Cache the result (even if null, to avoid repeated failed attempts)
  if (result) {
    ma50Cache.set(cacheKey, { data: result, timestamp: Date.now() });
    console.log(`[MA50] Cached result for industry: ${industryName}`);
  } else {
    // Cache null for 5 minutes to avoid hammering APIs
    ma50Cache.set(cacheKey, { data: null, timestamp: Date.now() - (CACHE_TTL_MS - 5 * 60 * 1000) });
    console.log(`[MA50] Cached null result (5min TTL) for industry: ${industryName}`);
  }

  return result;
}

module.exports = {
  calculateIndustryMA50,
  fetchHistoricalPrices,
  clearCache: () => ma50Cache.clear()
};
