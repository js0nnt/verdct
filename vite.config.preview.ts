import { defineConfig } from 'vite';

// A plain Vite server for the badge design harness. The CRXJS extension build
// is deliberately left out so `preview/` renders as an ordinary page.
export default defineConfig({
  root: 'preview',
  server: { port: 5199 },
});
