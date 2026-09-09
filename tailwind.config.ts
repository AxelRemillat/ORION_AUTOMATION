import type { Config } from "tailwindcss";

/**
 * Les couleurs pointent vers les canaux RVB definis dans app/globals.css
 * (triplets « R G B »), ce qui permet aux modificateurs d'opacite de Tailwind
 * — `bg-surface-2/60` — de fonctionner sur tous les tokens.
 *
 * Les noms historiques (fg, border, accent, success, warning, danger, info)
 * sont conserves : ils sont largement utilises par les ecrans metier. Ils
 * pointent desormais sur la palette Ciel & Lagon.
 */
const token = (name: string) => `rgb(var(--rgb-${name}) / <alpha-value>)`;

const config: Config = {
  // Le theme est porte par data-theme sur <html> ; la variante `dark:` suit.
  darkMode: ["selector", '[data-theme="dark"]'],
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Surfaces et structure
        bg: token("bg"),
        surface: token("surface"),
        "surface-2": token("surface-2"),
        elev: token("elev"),
        line: token("line"),
        "line-soft": token("line-soft"),
        border: token("line"), // alias historique de `line`

        // Texte
        fg: token("text"),
        text: token("text"),
        muted: token("muted"),
        faint: token("faint"),

        // Marque
        primary: {
          DEFAULT: token("primary"),
          strong: token("primary-strong"),
          fg: token("on-primary"),
        },
        accent: {
          // alias historique de `primary`
          DEFAULT: token("primary"),
          hover: token("primary-strong"),
          fg: token("on-primary"),
        },
        cyan: token("cyan"),
        teal: token("teal"),
        deep: token("deep"),
        violet: token("violet"),

        // Encres : meme teinte assombrie, pour du TEXTE sur aplat teinte (AA).
        "primary-ink": token("primary-ink"),
        "cyan-ink": token("cyan-ink"),
        "teal-ink": token("teal-ink"),
        "violet-ink": token("violet-ink"),
        "good-ink": token("good-ink"),
        "warn-ink": token("warn-ink"),
        "lost-ink": token("lost-ink"),

        // Semantique — volontairement distincte de la couleur de marque
        good: token("good"),
        warn: token("warn"),
        lost: token("lost"),
        success: token("good"), // alias historique
        warning: token("warn"), // alias historique
        danger: token("lost"), // alias historique
        info: token("cyan"), // alias historique
      },
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        display: ["var(--font-display)", "var(--font-sans)", "ui-sans-serif", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      borderRadius: {
        DEFAULT: "0.625rem",
        lg: "0.875rem",
        xl: "1.125rem",
        "2xl": "1.5rem",
      },
      boxShadow: {
        mist: "var(--shadow)",
        card: "var(--shadow)",
        overlay: "0 28px 70px -24px rgba(12, 44, 62, 0.42)",
      },
      backgroundImage: {
        brand: "var(--accent-grad)",
        halo: "var(--halo)",
        app: "var(--bg-grad)",
      },
      keyframes: {
        "fade-in": { from: { opacity: "0" }, to: { opacity: "1" } },
        "slide-up": {
          from: { opacity: "0", transform: "translateY(8px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "fade-in": "fade-in 160ms ease-out",
        "slide-up": "slide-up 200ms cubic-bezier(0.22, 1, 0.36, 1)",
      },
    },
  },
  plugins: [],
};

export default config;
