export const colors = {
  // Brand
  primary: "#6366f1",     // indigo-500
  primaryHover: "#4f46e5",
  accent: "#22d3ee",      // cyan-400 — live/realtime feel
  success: "#22c55e",     // green-500 — escrow released
  warning: "#f59e0b",     // amber-500 — pending
  danger: "#ef4444",      // red-500 — refund / brand-safety pull

  // USDC / on-chain
  usdc: "#2775ca",

  // Surfaces (dark-first)
  bg: "#0a0a0f",
  surface: "#111118",
  surfaceAlt: "#1a1a24",
  border: "#2a2a38",

  // Text
  textPrimary: "#f0f0f5",
  textSecondary: "#9090a8",
  textMuted: "#55556a",
} as const;

export const spacing = {
  xs: "4px",
  sm: "8px",
  md: "16px",
  lg: "24px",
  xl: "32px",
  "2xl": "48px",
} as const;

export const radius = {
  sm: "6px",
  md: "10px",
  lg: "16px",
  full: "9999px",
} as const;

export const fontSizes = {
  xs: "0.75rem",
  sm: "0.875rem",
  base: "1rem",
  lg: "1.125rem",
  xl: "1.25rem",
  "2xl": "1.5rem",
  "3xl": "1.875rem",
} as const;
