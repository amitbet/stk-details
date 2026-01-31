import React, { useMemo, useState } from "react";
import { useTheme } from "../ThemeContext.jsx";

function extractTickers(text) {
  return Array.from(
    new Set(
      String(text)
        .split(/[\s,;\t\r\n]+/g)
        .map((t) => t.trim().replace(/^"+|"+$/g, "").toUpperCase())
        .filter(Boolean)
    )
  );
}

export default function ManualInput({ onTickers }) {
  const { isDark } = useTheme();
  const [value, setValue] = useState("");
  const preview = useMemo(() => extractTickers(value), [value]);

  return (
    <div>
      <div style={styles.label}>Manual input</div>
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={"Paste tickers separated by comma, space, or newline.\nExample: AAPL MSFT TSLA"}
        style={styles.textarea}
      />
      <div style={styles.row}>
        <div style={styles.preview}>
          <span style={styles.previewLabel}>Detected:</span> <strong>{preview.length}</strong>
        </div>
        <button
          type="button"
          style={{
            ...styles.button,
            ...(preview.length === 0 ? styles.buttonDisabled : null)
          }}
          onClick={() => onTickers?.(preview)}
          disabled={preview.length === 0}
        >
          Fetch SCTR
        </button>
      </div>
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
  textarea: {
    width: "100%",
    height: 140,
    borderRadius: 12,
    border: "1px solid var(--border)",
    padding: 12,
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
    fontSize: 13,
    background: "var(--bg-secondary)",
    color: "var(--text-primary)",
    resize: "vertical",
    transition: "all 0.2s ease"
  },
  row: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 10
  },
  preview: {
    fontSize: 13,
    color: "var(--text-secondary)"
  },
  previewLabel: {
    color: "var(--text-tertiary)",
    marginRight: 4
  },
  button: {
    border: "none",
    background: "var(--accent-primary)",
    color: "white",
    borderRadius: 8,
    padding: "10px 20px",
    cursor: "pointer",
    fontSize: 14,
    fontWeight: 600,
    transition: "all 0.2s ease",
    boxShadow: "0 2px 4px rgba(0,0,0,0.1)"
  },
  buttonDisabled: {
    opacity: 0.5,
    cursor: "not-allowed",
    boxShadow: "none"
  }
};
