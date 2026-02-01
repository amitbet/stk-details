const express = require("express");
const cors = require("cors");
const multer = require("multer");
const path = require("path");

const { parseCsvForTickers, fetchSctrForTickers } = require("../shared/apiHandlers");

const upload = multer({ storage: multer.memoryStorage() });

function createApp({ rendererDir, enableCors } = {}) {
  const app = express();

  if (enableCors) {
    app.use(
      cors({
        origin: (origin, cb) => {
          // Allow Vite dev server.
          if (!origin) return cb(null, true);
          try {
            const u = new URL(origin);
            if ((u.hostname === "localhost" || u.hostname === "127.0.0.1") && u.protocol === "http:") return cb(null, true);
          } catch {
            // ignore
          }
          return cb(new Error("CORS blocked"), false);
        },
        credentials: false
      })
    );
  }

  app.use(express.json({ limit: "2mb" }));

  app.get("/api/health", (_req, res) => res.json({ ok: true }));

  app.post("/api/parse-csv", upload.single("file"), async (req, res) => {
    try {
      const buf = req.file?.buffer;
      if (!buf) return res.status(400).send("Missing CSV file field 'file'.");
      const text = buf.toString("utf8");
      const parsed = await parseCsvForTickers(text);
      return res.json(parsed);
    } catch (e) {
      return res.status(500).send(e?.message || String(e));
    }
  });

  app.post("/api/fetch-sctr", async (req, res) => {
    try {
      const tickers = Array.isArray(req.body?.tickers) ? req.body.tickers : [];
      const industrySource = req.body?.industrySource || "finviz";
      const result = await fetchSctrForTickers(tickers, industrySource);
      return res.json(result);
    } catch (e) {
      return res.status(500).send(e?.message || String(e));
    }
  });

  // Production: serve built renderer from the same origin so `fetch("/api/...")` works.
  // Note: In production Electron, API calls use IPC, but we still serve static files here.
  if (rendererDir) {
    app.use(express.static(rendererDir));
    app.get("*", (_req, res) => res.sendFile(path.join(rendererDir, "index.html")));
  }

  return app;
}

if (require.main === module) {
  const port = Number(process.env.PORT || 3002);
  const app = createApp({ enableCors: true });
  app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`Backend listening on http://localhost:${port}`);
  });
}

function startServer({ port = 3002, rendererDir, enableCors } = {}) {
  const app = createApp({ rendererDir, enableCors });
  const server = app.listen(port);
  const actualPort = server.address()?.port;
  return { app, server, port: actualPort };
}

module.exports = { createApp, startServer };
