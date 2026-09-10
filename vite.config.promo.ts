import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Plain Vite server for the Chrome Web Store asset harness. The CRXJS build is
// left out so promo/ renders as an ordinary page.
export default defineConfig({
  root: 'promo',
  plugins: [react()],
  server: { port: 5300 },
});
