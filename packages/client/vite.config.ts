import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5173,
    open: false,
  },
  // The workspace packages ship raw TypeScript source (their entry points are
  // `.ts` files). Excluding them from dep pre-bundling lets Vite transform them
  // as first-class source, so edits in core/content hot-reload the client.
  optimizeDeps: {
    exclude: ['@td/core', '@td/content'],
  },
});
