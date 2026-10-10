import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// A plain Vite server for the design harnesses: badges at /, the popup at
// /popup.html. The CRXJS extension build is deliberately left out so
// `preview/` renders as an ordinary page.
export default defineConfig({
  root: 'preview',
  plugins: [react()],
  server: { port: 5199, host: '127.0.0.1' },
});
