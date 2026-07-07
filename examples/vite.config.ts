import { defineConfig } from 'vite'
import { leylines } from 'leylines/vite'

export default defineConfig({
  plugins: [
    leylines({
      path: '.leylines/logs.sqlite',
      scope: 'browser',
      captureConsole: ['warn', 'error'],
      captureErrors: true,
      captureRejections: true,
    }),
  ],
})
