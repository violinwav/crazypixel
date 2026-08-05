import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  // The shared package ships raw TypeScript (no build step during dev) - tell Vite to
  // transform it as source instead of pre-bundling it like a normal node_modules package.
  optimizeDeps: { exclude: ['@crazypixel/shared'] },
});
