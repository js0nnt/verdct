/** @type {import('tailwindcss').Config} */
export default {
  content: ['./popup.html', './src/popup/**/*.{ts,tsx}'],
  // Selector-based rather than 'media': the popup resolves the user's
  // light/dark/auto preference itself and stamps data-theme on <html>, so an
  // explicit choice can override the OS setting.
  darkMode: ['selector', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        // Neutral surfaces shared with the on-page UI in src/content/theme.ts.
        surface: { DEFAULT: '#ffffff', sunken: '#f5f5f5', dark: '#262626', darksunken: '#1c1c1c' },
        line: { DEFAULT: '#e4e4e4', strong: '#d4d4d4', dark: '#3a3a3a', darkstrong: '#4a4a4a' },
        ink: { DEFAULT: '#1f1f1f', muted: '#737373', faint: '#a3a3a3' },
        inkdark: { DEFAULT: '#ededed', muted: '#9e9e9e', faint: '#6f6f6f' },
        tone: { good: '#1f9d63', fair: '#c47f10', poor: '#d24b45' },
        tonedark: { good: '#3cc389', fair: '#e5a33c', poor: '#ef6a63' },
      },
    },
  },
  plugins: [],
};
