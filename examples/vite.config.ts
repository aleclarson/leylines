import { defineConfig } from 'vite'
import { scopedLogsVitePlugin } from 'leylines/vite'

export default defineConfig({
  plugins: [
    scopedLogsVitePlugin({
      path: '.leylines/logs.sqlite',
      scope: 'browser',
      captureConsole: ['warn', 'error'],
      captureErrors: true,
      captureRejections: true,
    }),
  ],
})
