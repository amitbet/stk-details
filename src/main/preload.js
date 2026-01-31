const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  saveTextFile: (opts) => ipcRenderer.invoke("saveTextFile", opts),
  // API methods - use IPC in Electron, fallback to fetch in browser
  parseCsv: (csvText) => ipcRenderer.invoke("api:parse-csv", csvText),
  fetchSctr: (tickers) => ipcRenderer.invoke("api:fetch-sctr", tickers)
});
