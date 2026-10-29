import { defineConfig } from 'vite';

const apiPort = process.env.VITE_API_PORT ?? '3000';

export default defineConfig({
  publicDir: '../../assets',
  server: {
    host: true,
    port: 5173,
    allowedHosts: ['.ts.net'],
    proxy: {
      '/api': { target: `http://127.0.0.1:${apiPort}`, changeOrigin: true },
      '/ws': { target: `ws://127.0.0.1:${apiPort}`, ws: true },
    },
  },
});