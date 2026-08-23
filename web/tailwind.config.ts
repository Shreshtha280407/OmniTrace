import type { Config } from "tailwindcss";

/**
 * OmniTrace design tokens.
 *
 * The palette is deliberately narrow: a graphite ground, one electric teal
 * that means "evidence / provenance / active", one muted ultraviolet that
 * means "cross-modal relationship", and three state colours. Modality hues
 * are a separate, fixed four-way scale — they are data encoding, not
 * decoration, and are the same in the graph, the inspector and the badges.
 */
const config: Config = {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // ── graphite ground ────────────────────────────────────────────
        ink: {
          950: "#06070A", // page void, behind the WebGL canvas
          900: "#090B0F", // app background
          850: "#0B0E13",
          800: "#0E1117", // panel surface
          750: "#12161D", // raised surface
          700: "#171C25", // input / card
          600: "#1E242F", // hairline border (strong)
          550: "#242B38",
          500: "#2A3140",
          400: "#3D4658",
          300: "#5A6577", // disabled / faint text
          200: "#8B96A8", // secondary text
          100: "#C2CAD6", // body text
          50: "#E8ECF2", // primary text
        },
        // ── primary signal: evidence, provenance, active state ─────────
        signal: {
          100: "#D3FBF5",
          200: "#A5F5EA",
          300: "#5EEBDC",
          400: "#2ADCC8",
          500: "#19D6C4", // canonical
          600: "#0FAE9F",
          700: "#0C8479",
          800: "#0A5C55",
          900: "#083D39",
        },
        // ── secondary signal: cross-modal / contextual relationship ────
        uv: {
          200: "#D6D0F5",
          300: "#B4A9E8",
          400: "#9488DD",
          500: "#7A6DC9", // canonical
          600: "#6154A8",
          700: "#483D80",
          800: "#2F2857",
        },
        // ── states ─────────────────────────────────────────────────────
        validated: {
          400: "#5FC79B",
          500: "#46A578", // muted green — confirmed / validated
          600: "#348160",
          900: "#12281F",
        },
        caution: {
          400: "#E8BC6A",
          500: "#D99A3C", // amber — missing evidence / partial
          600: "#B07726",
          900: "#2B1F0C",
        },
        fault: {
          400: "#E87070",
          500: "#D64545", // disciplined red — errors only
          600: "#AE3333",
          900: "#2B1010",
        },
        // ── modality encoding (fixed, four-way, used as data) ──────────
        modality: {
          speech: "#19D6C4",
          visual: "#4C9BE8",
          image: "#9488DD",
          document: "#D98E6A",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        display: ["var(--font-display)", "Georgia", "serif"],
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      fontSize: {
        // Editorial display scale — only used on the marketing surface.
        "display-xl": ["clamp(3.25rem, 8vw, 6.5rem)", { lineHeight: "0.95", letterSpacing: "-0.03em" }],
        "display-lg": ["clamp(2.5rem, 5.5vw, 4.25rem)", { lineHeight: "1.0", letterSpacing: "-0.025em" }],
        "display-md": ["clamp(1.875rem, 3.5vw, 2.75rem)", { lineHeight: "1.08", letterSpacing: "-0.02em" }],
        // Product scale — dense, calm.
        "ui-2xs": ["0.6875rem", { lineHeight: "1rem", letterSpacing: "0.02em" }],
        "ui-xs": ["0.75rem", { lineHeight: "1.125rem" }],
        "ui-sm": ["0.8125rem", { lineHeight: "1.25rem" }],
        "ui-base": ["0.875rem", { lineHeight: "1.5rem" }],
        "ui-lg": ["1rem", { lineHeight: "1.625rem" }],
      },
      borderRadius: {
        xs: "4px",
        sm: "6px",
        md: "10px",
        lg: "12px",
        xl: "16px",
        "2xl": "20px",
      },
      boxShadow: {
        // Restrained depth: a hairline top highlight plus a soft drop.
        panel: "0 1px 0 0 rgba(255,255,255,0.035) inset, 0 8px 24px -12px rgba(0,0,0,0.8)",
        raised: "0 1px 0 0 rgba(255,255,255,0.05) inset, 0 16px 40px -20px rgba(0,0,0,0.9)",
        drawer: "0 0 0 1px rgba(255,255,255,0.06), -24px 0 64px -24px rgba(0,0,0,0.95)",
        "signal-focus": "0 0 0 1px rgba(25,214,196,0.5), 0 0 0 4px rgba(25,214,196,0.12)",
      },
      spacing: {
        rail: "17rem", // left sessions rail
        inspector: "23rem", // right evidence inspector
      },
      transitionTimingFunction: {
        // One easing curve for state changes, one for camera-like motion.
        state: "cubic-bezier(0.32, 0.72, 0, 1)",
        cinematic: "cubic-bezier(0.16, 1, 0.3, 1)",
      },
      keyframes: {
        "fade-up": {
          from: { opacity: "0", transform: "translateY(8px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        "draw-line": {
          from: { strokeDashoffset: "1" },
          to: { strokeDashoffset: "0" },
        },
        "pulse-soft": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.45" },
        },
        shimmer: {
          "100%": { transform: "translateX(100%)" },
        },
        "caret-blink": {
          "0%, 70%, 100%": { opacity: "1" },
          "20%, 50%": { opacity: "0" },
        },
      },
      animation: {
        "fade-up": "fade-up 0.5s cubic-bezier(0.16, 1, 0.3, 1) both",
        "fade-in": "fade-in 0.4s ease-out both",
        "pulse-soft": "pulse-soft 1.8s ease-in-out infinite",
        shimmer: "shimmer 1.6s infinite",
        "caret-blink": "caret-blink 1.1s steps(1) infinite",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;
