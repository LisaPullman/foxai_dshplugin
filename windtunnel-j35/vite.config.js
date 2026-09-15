import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
  },
  server: {
    port: 5188,
    host: true,
  },
  preview: {
    port: 5189,
    host: true,
  },
});
