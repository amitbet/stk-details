const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("path");

const { startServer } = require("./server");

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
  const rendererDir = path.join(__dirname, "..", "..", "dist", "renderer");
  backend = startServer({ port: 0, rendererDir, enableCors: false });
  await createWindow({ baseUrl: `http://localhost:${backend.port}` });
}

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

