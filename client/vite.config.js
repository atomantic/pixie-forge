import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const API_PORT = process.env.VITE_API_PORT || 5570
const UI_PORT = process.env.VITE_PORT || 5571

export default defineConfig({
  plugins: [react()],
  server: {
    port: parseInt(UI_PORT),
    host: '0.0.0.0',
    proxy: {
      '/api': `http://localhost:${API_PORT}`,
      '/videos': `http://localhost:${API_PORT}`,
      '/thumbnails': `http://localhost:${API_PORT}`,
      '/images': `http://localhost:${API_PORT}`,
    },
  },
})
