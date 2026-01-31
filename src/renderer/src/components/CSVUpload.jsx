import React, { useCallback, useRef, useState } from "react";
import { useTheme } from "../ThemeContext.jsx";
import { parseCsvFromFile } from "../utils/api.js";

export default function CSVUpload({ onTickers }) {
  const { isDark } = useTheme();
  const inputRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);
  const [status, setStatus] = useState("");

  const parseFile = useCallback(
    async (file) => {
      if (!file) return;
      setStatus(`Parsing ${file.name}...`);
      try {
        const data = await parseCsvFromFile(file);
        const tickers = Array.isArray(data.tickers) ? data.tickers : [];
        setStatus(`Found ${tickers.length} tickers (column: ${data.tickerColumnName ?? data.tickerColumnIndex ?? "?"}).`);
        onTickers?.(tickers, { source: "CSV" });
      } catch (e) {
        setStatus(`Error: ${e?.message || String(e)}`);
      }
    },
    [onTickers]
  );

  function onBrowse() {
    inputRef.current?.click();
  }

  return (
    <div>
      <div style={styles.label}>CSV drag & drop</div>
      <div
        style={{
          ...styles.drop,
          ...(dragOver ? styles.dropOver : null)
        }}
        onDragEnter={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setDragOver(true);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setDragOver(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setDragOver(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setDragOver(false);
          const file = e.dataTransfer?.files?.[0];
          parseFile(file);
        }}
      >
        <div style={styles.dropIcon}>📄</div>
        <div style={styles.dropTitle}>Drop a CSV here</div>
        <div style={styles.dropHint}>We'll auto-detect the ticker/symbol column.</div>
        <button type="button" onClick={onBrowse} style={styles.button}>
          Browse…
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv,application/vnd.ms-excel"
          style={{ display: "none" }}
          onChange={(e) => parseFile(e.target.files?.[0])}
        />
      </div>
      {status ? <div style={styles.status}>{status}</div> : null}
    </div>
  );
}

const styles = {
  label: {
    fontSize: 13,
    fontWeight: 600,
    color: "var(--text-secondary)",
    marginBottom: 8,
    textTransform: "uppercase",
    letterSpacing: "0.5px"
  },
  drop: {
    borderWidth: "2px",
    borderStyle: "dashed",
    borderColor: "var(--border)",
    borderRadius: 12,
    padding: 32,
    background: "var(--bg-secondary)",
    textAlign: "center",
    transition: "all 0.2s ease",
    cursor: "pointer"
  },
  dropOver: {
    borderColor: "var(--accent-primary)",
    background: "var(--accent-bg)",
    transform: "scale(1.01)"
  },
  dropIcon: {
    fontSize: 48,
    marginBottom: 12
  },
  dropTitle: {
    fontWeight: 600,
    fontSize: 16,
    color: "var(--text-primary)",
    marginBottom: 6
  },
  dropHint: {
    fontSize: 13,
    color: "var(--text-secondary)",
    marginBottom: 16
  },
  button: {
    border: "1px solid var(--border)",
    background: "var(--bg-primary)",
    color: "var(--text-primary)",
    borderRadius: 8,
    padding: "10px 20px",
    cursor: "pointer",
    fontSize: 14,
    fontWeight: 500,
    transition: "all 0.2s ease",
    boxShadow: "0 1px 3px rgba(0,0,0,0.1)"
  },
  status: {
    marginTop: 10,
    fontSize: 13,
    color: "var(--text-secondary)",
    padding: "8px 12px",
    background: "var(--bg-secondary)",
    borderRadius: 6
  }
};
