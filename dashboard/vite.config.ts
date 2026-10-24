import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The brain bindings live in ../brain/bindings, outside this folder.
export default defineConfig({
  plugins: [react()],
  server: { fs: { allow: ['..'] }, host: true },
});
