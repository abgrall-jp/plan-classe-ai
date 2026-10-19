import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// La clé Gemini reste sur le serveur : rien n'est injecté dans le navigateur.
export default defineConfig({
  server: {
    port: 3000,
    host: '0.0.0.0',
  },
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
});
