import React, { useMemo, useState } from "react";
import { ThemeProvider, useTheme } from "./ThemeContext.jsx";
import CSVUpload from "./components/CSVUpload.jsx";
import ManualInput from "./components/ManualInput.jsx";
import ResultsTable from "./components/ResultsTable.jsx";
import ExportButton from "./components/ExportButton.jsx";
import DarkModeToggle from "./components/DarkModeToggle.jsx";
import { fetchSctr } from "./utils/api.js";

function AppContent() {
  const { isDark } = useTheme();
  const [tickers, setTickers] = useState([]);
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [lastSource, setLastSource] = useState("");

  const tickerCount = useMemo(() => tickers.length, [tickers]);

  async function fetchSctrData(nextTickers) {
    const unique = Array.from(new Set(nextTickers.map((t) => t.toUpperCase().trim()).filter(Boolean)));
    setTickers(unique);
    setError("");
    setRecords([]);
    if (unique.length === 0) return;

    setLoading(true);
    try {
      const data = await fetchSctr(unique);
      setRecords(Array.isArray(data.records) ? data.records : []);
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={styles.page}>
      <DarkModeToggle />
      <div style={styles.header}>
        <div>
          <div style={styles.title}>stock details</div>
          <div style={styles.subtitle}>Fetch SCTR for your ticker lists (CSV drag/drop or manual input).</div>
        </div>
        <div style={styles.headerRight}>
          <div style={styles.meta}>
            <div>
              <span style={styles.metaLabel}>Tickers:</span> <strong>{tickerCount}</strong>
            </div>
            {lastSource ? (
              <div>
                <span style={styles.metaLabel}>Source:</span> <strong>{lastSource}</strong>
              </div>
            ) : null}
          </div>
          <ExportButton records={records} disabled={records.length === 0} />
        </div>
      </div>

      <div style={styles.controls}>
        <CSVUpload
          onTickers={(t, meta) => {
            setLastSource(meta?.source || "CSV");
            fetchSctrData(t);
          }}
        />
        <ManualInput
          onTickers={(t) => {
            setLastSource("Manual");
            fetchSctrData(t);
          }}
        />
      </div>

      {error ? <div style={styles.error}>{error}</div> : null}
      <ResultsTable records={records} loading={loading} />

      {/* Only show footer in browser dev mode (Vite), not in Electron (dev or prod) */}
      {typeof window !== "undefined" && !window.electronAPI && window.location.hostname === "localhost" ? (
        <div style={styles.footer}>
          Backend expected at <code style={styles.code}>http://localhost:3002</code> (proxy via Vite <code style={styles.code}>/api</code>).
        </div>
      ) : null}
    </div>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AppContent />
    </ThemeProvider>
  );
}

const styles = {
  page: {
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, "Apple Color Emoji", "Segoe UI Emoji"',
    padding: "24px 20px",
    maxWidth: 1400,
    margin: "0 auto",
    minHeight: "100vh",
    background: "var(--bg-primary)",
    color: "var(--text-primary)",
    transition: "background-color 0.2s ease, color 0.2s ease"
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 20,
    marginBottom: 24,
    paddingBottom: 20,
    borderBottom: "1px solid var(--border)"
  },
  headerRight: {
    display: "flex",
    alignItems: "flex-start",
    gap: 12,
    flexWrap: "wrap"
  },
  title: {
    fontSize: 28,
    fontWeight: 700,
    background: "linear-gradient(135deg, var(--accent-primary) 0%, var(--accent-secondary) 100%)",
    WebkitBackgroundClip: "text",
    WebkitTextFillColor: "transparent",
    backgroundClip: "text",
    marginBottom: 4
  },
  subtitle: {
    marginTop: 4,
    color: "var(--text-secondary)",
    fontSize: 14
  },
  controls: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 20,
    marginBottom: 24
  },
  meta: {
    fontSize: 13,
    color: "var(--text-secondary)",
    display: "flex",
    flexDirection: "column",
    gap: 4
  },
  metaLabel: {
    color: "var(--text-tertiary)",
    marginRight: 4
  },
  error: {
    background: "var(--error-bg)",
    border: "1px solid var(--error-border)",
    color: "var(--error-text)",
    padding: 12,
    borderRadius: 10,
    marginBottom: 16,
    fontSize: 14
  },
  footer: {
    marginTop: 32,
    paddingTop: 20,
    fontSize: 12,
    color: "var(--text-tertiary)",
    textAlign: "center",
    borderTop: "1px solid var(--border)"
  },
  code: {
    background: "var(--bg-code)",
    padding: "2px 6px",
    borderRadius: 4,
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
    fontSize: 11
  }
};
