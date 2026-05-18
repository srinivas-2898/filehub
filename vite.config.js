import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        dashboard: resolve(__dirname, 'dashboard.html'),
        profile: resolve(__dirname, 'profile.html'),
        'forgot-password': resolve(__dirname, 'forgot-password.html'),
        'reset-password': resolve(__dirname, 'reset-password.html'),
      },
    },
  },
});
