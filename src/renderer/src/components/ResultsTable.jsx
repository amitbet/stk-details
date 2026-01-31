import React, { useMemo, useState } from "react";
import { useTheme } from "../ThemeContext.jsx";

function compare(a, b) {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b));
}

const columns = [
  { key: "date", label: "Date" },
  { key: "symbol", label: "Symbol" },
  { key: "name", label: "Name" },
  { key: "SCTR", label: "SCTR" },
  { key: "delta", label: "Δ" },
  { key: "close", label: "Close" },
  { key: "marketCap", label: "MktCap(M)" },
  { key: "vol", label: "Vol" },
  { key: "industry", label: "Industry" },
  { key: "sector", label: "Sector" }
];

export default function ResultsTable({ records, loading }) {
  const { isDark } = useTheme();
  const [sortKey, setSortKey] = useState("SCTR");
  const [sortDir, setSortDir] = useState("desc");

  const sorted = useMemo(() => {
    const copy = Array.isArray(records) ? [...records] : [];
    copy.sort((ra, rb) => {
      const c = compare(ra?.[sortKey], rb?.[sortKey]);
      return sortDir === "asc" ? c : -c;
    });
    return copy;
  }, [records, sortKey, sortDir]);

  function toggleSort(nextKey) {
    if (sortKey === nextKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(nextKey);
      setSortDir(nextKey === "SCTR" ? "desc" : "asc");
    }
  }

  return (
    <div style={styles.wrap}>
      <div style={styles.topRow}>
        <div style={styles.topTitle}>Results</div>
        {loading ? <div style={styles.loading}>Loading…</div> : null}
      </div>

      {sorted.length === 0 && !loading ? <div style={styles.empty}>No results yet.</div> : null}

      {sorted.length > 0 ? (
        <div style={styles.tableWrap}>
          <table style={styles.table}>
            <thead>
              <tr>
                {columns.map((c) => (
                  <th
                    key={c.key}
                    style={styles.th}
                    onClick={() => toggleSort(c.key)}
                    title="Click to sort"
                  >
                    {c.label}
                    {sortKey === c.key ? <span style={styles.sort}> {sortDir === "asc" ? "▲" : "▼"}</span> : null}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((r, idx) => (
                <tr key={r.symbol} style={{ ...styles.tr, ...(idx % 2 === 0 ? styles.trEven : null) }}>
                  <td style={styles.td}>{r.date}</td>
                  <td style={{ ...styles.td, ...styles.mono }}>{r.symbol}</td>
                  <td style={styles.td}>{r.name}</td>
                  <td style={{ ...styles.td, ...styles.num }}>{fmt(r.SCTR, 1)}</td>
                  <td style={{ ...styles.td, ...styles.num }}>{fmt(r.delta, 1)}</td>
                  <td style={{ ...styles.td, ...styles.num }}>{fmt(r.close, 2)}</td>
                  <td style={{ ...styles.td, ...styles.num }}>{fmt(r.marketCap, 2)}</td>
                  <td style={{ ...styles.td, ...styles.num }}>{fmtInt(r.vol)}</td>
                  <td style={styles.td}>{r.industry}</td>
                  <td style={styles.td}>{r.sector}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

function fmt(v, p) {
  if (v == null || v === "") return "";
  const n = Number(v);
  if (Number.isNaN(n)) return String(v);
  return n.toFixed(p);
}

function fmtInt(v) {
  if (v == null || v === "") return "";
  const n = Number(v);
  if (Number.isNaN(n)) return String(v);
  return Math.trunc(n).toString();
}

const styles = {
  wrap: {
    border: "1px solid var(--border)",
    borderRadius: 12,
    padding: 16,
    background: "var(--bg-secondary)",
    boxShadow: "0 2px 8px rgba(0,0,0,0.05)"
  },
  topRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12
  },
  topTitle: {
    fontWeight: 700,
    fontSize: 18,
    color: "var(--text-primary)"
  },
  loading: {
    fontSize: 13,
    color: "var(--text-secondary)"
  },
  empty: {
    padding: 24,
    color: "var(--text-tertiary)",
    fontSize: 14,
    textAlign: "center"
  },
  tableWrap: {
    overflowX: "auto",
    borderRadius: 8
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: 13
  },
  th: {
    textAlign: "left",
    borderBottom: "2px solid var(--border)",
    padding: "12px 10px",
    position: "sticky",
    top: 0,
    background: "var(--bg-secondary)",
    cursor: "pointer",
    whiteSpace: "nowrap",
    fontWeight: 600,
    color: "var(--text-secondary)",
    transition: "background-color 0.15s ease"
  },
  tr: {
    borderBottom: "1px solid var(--border)",
    transition: "background-color 0.15s ease"
  },
  trEven: {
    background: "var(--bg-primary)"
  },
  td: {
    padding: "10px 10px",
    verticalAlign: "top",
    color: "var(--text-primary)"
  },
  mono: {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
    fontWeight: 600
  },
  num: {
    textAlign: "right",
    whiteSpace: "nowrap",
    fontVariantNumeric: "tabular-nums"
  },
  sort: {
    fontSize: 11,
    color: "var(--accent-primary)",
    marginLeft: 4
  }
};
