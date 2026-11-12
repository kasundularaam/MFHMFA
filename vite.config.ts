import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  root: path.resolve(__dirname, 'web'),
  plugins: [react()],
  build: {
    outDir: path.resolve(__dirname, 'dist/web'),
    emptyOutDir: true,
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (
            id.includes('node_modules/@codemirror') ||
            id.includes('node_modules/@uiw/react-codemirror') ||
            id.includes('node_modules/@lezer')
          ) {
            return 'codemirror';
          }
          if (
            id.includes('node_modules/@radix-ui') ||
            id.includes('node_modules/zustand') ||
            id.includes('node_modules/immer') ||
            id.includes('node_modules/dompurify') ||
            id.includes('node_modules/idb-keyval')
          ) {
            return 'ui-vendor';
          }
          return undefined;
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:48333',
      '/mcp': 'http://localhost:48333',
    },
  },
});
