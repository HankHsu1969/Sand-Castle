import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: { port: 5199, open: false },
  build: { chunkSizeWarningLimit: 1500 },
});
