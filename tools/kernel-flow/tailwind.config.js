import animate from 'tailwindcss-animate';

const c = name => `hsl(var(--${name}) / <alpha-value>)`;

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    container: { center: true, padding: '1rem' },
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      colors: {
        border: c('border'), input: c('input'), ring: c('ring'), background: c('background'), foreground: c('foreground'),
        primary: { DEFAULT: c('primary'), foreground: c('primary-foreground') },
        secondary: { DEFAULT: c('secondary'), foreground: c('secondary-foreground') },
        destructive: { DEFAULT: c('destructive'), foreground: c('destructive-foreground') },
        muted: { DEFAULT: c('muted'), foreground: c('muted-foreground') },
        accent: { DEFAULT: c('accent'), foreground: c('accent-foreground') },
        popover: { DEFAULT: c('popover'), foreground: c('popover-foreground') },
        card: { DEFAULT: c('card'), foreground: c('card-foreground') },
        read: { DEFAULT: c('read'), soft: c('read-soft') },
        write: { DEFAULT: c('write'), soft: c('write-soft'), foreground: c('write-foreground') },
        wait: { DEFAULT: c('wait'), soft: c('wait-soft') },
        masked: { DEFAULT: c('masked'), soft: c('masked-soft') },
        ok: { DEFAULT: c('ok'), soft: c('ok-soft') },
        run: { DEFAULT: c('run'), soft: c('run-soft') },
      },
      borderRadius: { lg: 'var(--radius)', md: 'calc(var(--radius) - 2px)', sm: 'calc(var(--radius) - 4px)' },
      keyframes: {
        pulsew: { '0%': { boxShadow: '0 0 0 0 hsl(var(--write) / 0.55)' }, '100%': { boxShadow: '0 0 0 8px hsl(var(--write) / 0)' } },
      },
      animation: { pulsew: 'pulsew 600ms ease-out' },
    },
  },
  plugins: [animate],
};
