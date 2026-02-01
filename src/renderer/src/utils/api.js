// API service that uses IPC in Electron, falls back to HTTP fetch in browser dev mode

async function parseCsv(csvText) {
  // Use IPC if available (Electron), otherwise use HTTP fetch (browser dev)
  if (window.electronAPI?.parseCsv) {
    const result = await window.electronAPI.parseCsv(csvText);
    if (!result.success) {
      throw new Error(result.error || "Failed to parse CSV");
    }
    return result.data;
  } else {
    // Browser dev mode: use HTTP
    const form = new FormData();
    const blob = new Blob([csvText], { type: "text/csv" });
    form.append("file", blob, "input.csv");
    
    const resp = await fetch("/api/parse-csv", {
      method: "POST",
      body: form
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(text || `HTTP ${resp.status}`);
    }
    return await resp.json();
  }
}

async function parseCsvFromFile(file) {
  // Read file as text first
  const text = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = reject;
    reader.readAsText(file);
  });
  
  return parseCsv(text);
}

async function fetchSctr(tickers, industrySource = "finviz") {
  // Use IPC if available (Electron), otherwise use HTTP fetch (browser dev)
  if (window.electronAPI?.fetchSctr) {
    const result = await window.electronAPI.fetchSctr(tickers, industrySource);
    if (!result.success) {
      throw new Error(result.error || "Failed to fetch SCTR");
    }
    return result.data;
  } else {
    // Browser dev mode: use HTTP
    const resp = await fetch("/api/fetch-sctr", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tickers, industrySource })
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(text || `HTTP ${resp.status}`);
    }
    return await resp.json();
  }
}

export { parseCsv, parseCsvFromFile, fetchSctr };
