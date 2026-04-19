const { scopedPreflightStyles, isolateInsideOfContainer } = require('tailwindcss-scoped-preflight');

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{ts,tsx}'],
  darkMode: ['class', '.jchat-root.dark'],
  theme: {
    extend: {
      colors: {
        ink: 'var(--jc-ink)',
        'ink-soft': 'var(--jc-ink-soft)',
        muted: 'var(--jc-muted)',
        line: 'var(--jc-line)',
        paper: 'var(--jc-paper)',
        'paper-2': 'var(--jc-paper-2)',
        brand: 'var(--jc-brand)',
        'brand-ink': 'var(--jc-brand-ink)',
        'brand-soft': 'var(--jc-brand-soft)',
        accent: 'var(--jc-accent)',
        danger: 'var(--jc-danger)',
        success: 'var(--jc-success)',
        'code-bg': 'var(--jc-code-bg)',
        'code-fg': 'var(--jc-code-fg)',
        'header-bg': 'var(--jc-header-bg)',
        'header-fg': 'var(--jc-header-fg)',
        'input-bg': 'var(--jc-input-bg)',
        'input-bg-2': 'var(--jc-input-bg-2)',
      },
      fontFamily: {
        sans: ['"IBM Plex Sans"', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'sans-serif'],
        serif: ['Fraunces', '"Source Serif Pro"', 'Georgia', 'serif'],
        mono: ['"JetBrains Mono"', '"Fira Code"', 'ui-monospace', 'Consolas', 'monospace'],
      },
      fontSize: {
        'xs-plus': '11.5px',
        'sm-plus': '13.5px',
      },
      borderRadius: {
        DEFAULT: '4px',
        lg: '10px',
      },
      boxShadow: {
        panel: '0 1px 0 rgba(255,255,255,.5) inset, 0 24px 60px -20px rgba(0,0,0,.35), 0 4px 12px -6px rgba(0,0,0,.25)',
        fab: '0 1px 0 rgba(255,255,255,.08) inset, 0 10px 24px -8px rgba(31,27,22,.45)',
      },
      keyframes: {
        'pop-in': {
          '0%': { transform: 'scale(.05)', opacity: '0', filter: 'blur(2px)' },
          '60%': { transform: 'scale(1.02)', opacity: '1', filter: 'blur(0)' },
          '100%': { transform: 'scale(1)', opacity: '1', filter: 'blur(0)' },
        },
        'pop-out': {
          '0%': { transform: 'scale(1)', opacity: '1' },
          '100%': { transform: 'scale(.05)', opacity: '0', filter: 'blur(2px)' },
        },
        'fade-in': {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to: { opacity: '1', transform: 'none' },
        },
        'jc-pulse': {
          '0%, 100%': { boxShadow: '0 0 0 0 rgba(243,119,38,.55), 0 10px 24px -8px rgba(31,27,22,.45)' },
          '50%': { boxShadow: '0 0 0 12px rgba(243,119,38,0), 0 10px 24px -8px rgba(31,27,22,.45)' },
        },
      },
      animation: {
        'pop-in': 'pop-in .32s cubic-bezier(.2,.9,.25,1.15)',
        'pop-out': 'pop-out .26s cubic-bezier(.45,0,.6,.4) forwards',
        'fade-in': 'fade-in .25s cubic-bezier(.2,.8,.2,1)',
        'jc-pulse': 'jc-pulse 1.6s ease-in-out infinite',
      },
    },
  },
  plugins: [
    scopedPreflightStyles({
      isolationStrategy: isolateInsideOfContainer('.jchat-root'),
    }),
    require('tailwindcss-animate'),
  ],
};
