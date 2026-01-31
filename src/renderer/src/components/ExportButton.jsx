import React from "react";
import { useTheme } from "../ThemeContext.jsx";

function toCsv(records) {
  const cols = ["date", "symbol", "name", "SCTR", "delta", "close", "marketCap", "vol", "industry", "sector"];
  const escape = (v) => {
    const s = v == null ? "" : String(v);
    if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [cols.join(",")];
  for (const r of records || []) {
    lines.push(cols.map((c) => escape(r?.[c])).join(","));
  }
  return lines.join("\n") + "\n";
}

export default function ExportButton({ records, disabled }) {
  const { isDark } = useTheme();

  async function onExport() {
    const csv = toCsv(records);

    // If running inside Electron and a preload exposes an API, use it.
    if (window?.electronAPI?.saveTextFile) {
      await window.electronAPI.saveTextFile({
        defaultPath: "sctr.csv",
        content: csv
      });
      return;
    }

    // Browser fallback (Vite dev): download a file.
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "sctr.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <button
      type="button"
      onClick={onExport}
      disabled={disabled}
      style={{
        ...styles.button,
        ...(disabled ? styles.disabled : null)
      }}
    >
      📥 Export CSV
    </button>
  );
}

const styles = {
  button: {
    border: "1px solid var(--border)",
    background: "var(--bg-secondary)",
    color: "var(--text-primary)",
    borderRadius: 8,
    padding: "8px 14px",
    cursor: "pointer",
    fontWeight: 600,
    fontSize: 13,
    transition: "all 0.2s ease",
    boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
    display: "flex",
    alignItems: "center",
    gap: 6
  },
  disabled: {
    opacity: 0.5,
    cursor: "not-allowed",
    boxShadow: "none"
  }
};
