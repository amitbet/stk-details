const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("path");
const fs = require("fs");

const { startServer } = require("./server");
const { parseCsvForTickers, fetchSctrForTickers } = require("../shared/apiHandlers");

let backend;

async function createWindow({ baseUrl }) {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, "preload.js")
    }
  });

  const isDev = process.env.NODE_ENV === "development";
  if (isDev) {
    await win.loadURL(baseUrl);
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    await win.loadURL(baseUrl);
  }
}

async function startDev() {
  // Backend is expected to be run separately (VSCode launch config) on :3002.
  const port = Number(process.env.VITE_PORT || 5173);
  const baseUrl = process.env.VITE_DEV_SERVER_URL || `http://localhost:${port}`;
  await createWindow({ baseUrl });
}

async function startProd() {
  // In production, we can use IPC only (no HTTP server needed)
  // But we still need to serve the static files, so we'll use a minimal server
  const appPath = app.getAppPath();
  
  // Try unpacked path first (when asarUnpack is used)
  const resourcesPath = appPath.includes("app.asar")
    ? appPath.replace(/app\.asar.*$/, "")
    : appPath;
  
  const unpackedRendererDir = path.join(resourcesPath, "app.asar.unpacked", "dist", "renderer");
  const asarRendererDir = path.join(appPath, "dist", "renderer");
  
  let rendererDir;
  if (fs.existsSync(unpackedRendererDir)) {
    rendererDir = unpackedRendererDir;
  } else if (fs.existsSync(asarRendererDir)) {
    rendererDir = asarRendererDir;
  } else {
    // Fallback: try relative to __dirname
    rendererDir = path.join(__dirname, "..", "..", "dist", "renderer");
  }
  
  // Verify index.html exists
  const indexHtml = path.join(rendererDir, "index.html");
  if (!fs.existsSync(indexHtml)) {
    console.error(`Renderer index.html not found at: ${indexHtml}`);
    console.error(`App path: ${appPath}`);
    console.error(`Resources path: ${resourcesPath}`);
    console.error(`Tried unpacked: ${unpackedRendererDir}`);
    console.error(`Tried asar: ${asarRendererDir}`);
    throw new Error(`Renderer files not found. Tried: ${rendererDir}`);
  }
  
  // Start minimal server just for serving static files (IPC handles API calls)
  backend = startServer({ port: 0, rendererDir, enableCors: false });
  await createWindow({ baseUrl: `http://localhost:${backend.port}` });
}

// IPC handlers for API calls (used in production Electron)
ipcMain.handle("api:parse-csv", async (_event, csvText) => {
  try {
    const result = await parseCsvForTickers(csvText);
    return { success: true, data: result };
  } catch (error) {
    return { success: false, error: error?.message || String(error) };
  }
});

ipcMain.handle("api:fetch-sctr", async (_event, tickers, industrySource) => {
  try {
    const result = await fetchSctrForTickers(tickers, industrySource);
    return { success: true, data: result };
  } catch (error) {
    return { success: false, error: error?.message || String(error) };
  }
});

app.whenReady().then(async () => {
  const isDev = process.env.NODE_ENV === "development";
  if (isDev) await startDev();
  else await startProd();

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      const isDevNow = process.env.NODE_ENV === "development";
      if (isDevNow) await startDev();
      else await startProd();
    }
  });
});

app.on("window-all-closed", () => {
  if (backend?.server) backend.server.close();
  if (process.platform !== "darwin") app.quit();
});

ipcMain.handle("saveTextFile", async (_event, { defaultPath, content }) => {
  const win = BrowserWindow.getFocusedWindow();
  const result = await dialog.showSaveDialog(win, {
    defaultPath: defaultPath || "output.csv",
    filters: [{ name: "CSV", extensions: ["csv"] }, { name: "All Files", extensions: ["*"] }]
  });
  if (result.canceled || !result.filePath) return { canceled: true };
  const fs = require("fs");
  fs.writeFileSync(result.filePath, content, "utf8");
  return { canceled: false, filePath: result.filePath };
});
