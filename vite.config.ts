import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so the same bundle works on web, Electron (file://) and Capacitor.
  base: './',
  build: {
    target: 'es2022',
  },
});
