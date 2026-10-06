import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    port: 5174,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // ECharts is lazy-loaded (see AssistantMsg) and capped at its minimal
    // modular import set; the 558 kB dev-noise threshold has no real cost in
    // a local Electron bundle, so relax the web-oriented default warning.
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('echarts') || id.includes('zrender')) return 'echarts'
        },
      },
    },
  },
})
