import React from "react";
import { useTheme } from "../ThemeContext.jsx";

export default function DarkModeToggle() {
  const { isDark, setIsDark } = useTheme();

  return (
    <button
      type="button"
      onClick={() => setIsDark(!isDark)}
      style={styles.button}
      title={isDark ? "Switch to light mode" : "Switch to dark mode"}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
    >
      <span style={styles.icon}>{isDark ? "☀️" : "🌙"}</span>
    </button>
  );
}

const styles = {
  button: {
    position: "fixed",
    top: 12,
    right: 12,
    width: 36,
    height: 36,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    border: "1px solid var(--border)",
    background: "var(--bg-secondary)",
    borderRadius: "50%",
    cursor: "pointer",
    fontSize: 18,
    color: "var(--text-primary)",
    transition: "all 0.2s ease",
    boxShadow: "0 2px 4px rgba(0,0,0,0.1)",
    zIndex: 1000
  },
  icon: {
    fontSize: 18,
    lineHeight: 1
  }
};
