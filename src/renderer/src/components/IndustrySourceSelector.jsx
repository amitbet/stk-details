import React from "react";
import { useTheme } from "../ThemeContext.jsx";

const INDUSTRY_SOURCES = [
  { value: "finviz", label: "Finviz", description: "Finviz industry definitions (cached)" },
  { value: "stockcharts", label: "StockCharts", description: "StockCharts SCTR data" },
  { value: "yahoo", label: "Yahoo Finance", description: "Yahoo Finance classifications" }
];

export default function IndustrySourceSelector({ value, onChange }) {
  const { isDark } = useTheme();

  return (
    <div style={styles.container}>
      <label style={styles.label} htmlFor="industry-source">
        Industry Source:
      </label>
      <select
        id="industry-source"
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        style={styles.select}
      >
        {INDUSTRY_SOURCES.map((source) => (
          <option key={source.value} value={source.value}>
            {source.label}
          </option>
        ))}
      </select>
      <div style={styles.description}>
        {INDUSTRY_SOURCES.find((s) => s.value === value)?.description}
      </div>
    </div>
  );
}

const styles = {
  container: {
    display: "flex",
    flexDirection: "column",
    gap: 6
  },
  label: {
    fontSize: 13,
    fontWeight: 600,
    color: "var(--text-secondary)",
    textTransform: "uppercase",
    letterSpacing: "0.5px"
  },
  select: {
    padding: "8px 12px",
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--bg-secondary)",
    color: "var(--text-primary)",
    fontSize: 14,
    cursor: "pointer",
    transition: "all 0.2s ease",
    fontFamily: "inherit",
    minWidth: 150
  },
  description: {
    fontSize: 11,
    color: "var(--text-tertiary)",
    fontStyle: "italic"
  }
};
