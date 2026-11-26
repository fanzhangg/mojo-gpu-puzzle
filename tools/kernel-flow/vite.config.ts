import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  base: './',
  plugins: [react(), viteSingleFile()],
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 2000 },
});
