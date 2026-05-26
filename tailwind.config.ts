import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      // Branding renkleri CSS variables üzerinden runtime'da set edilir.
      // Bkz: src/config/branding.ts
      colors: {
        primary: {
          DEFAULT: 'rgb(var(--color-primary) / <alpha-value>)',
          foreground: 'rgb(var(--color-primary-foreground) / <alpha-value>)',
        },
        accent: {
          DEFAULT: 'rgb(var(--color-accent) / <alpha-value>)',
          foreground: 'rgb(var(--color-accent-foreground) / <alpha-value>)',
        },
        background: 'rgb(var(--color-background) / <alpha-value>)',
        foreground: 'rgb(var(--color-foreground) / <alpha-value>)',
        muted: {
          DEFAULT: 'rgb(var(--color-muted) / <alpha-value>)',
          foreground: 'rgb(var(--color-muted-foreground) / <alpha-value>)',
        },
        border: 'rgb(var(--color-border) / <alpha-value>)',
      },
      fontFamily: {
        sans: ['system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      // Saha ekibinin eldivenle bile kullanabileceği büyük tap target'lar
      spacing: {
        'tap-min': '2.75rem', // 44px — minimum interactive touch
      },
      minHeight: {
        'tap-min': '2.75rem',
      },
      minWidth: {
        'tap-min': '2.75rem',
      },
    },
  },
  plugins: [],
} satisfies Config;
