import { defineConfig } from 'tsdown'
import ApiSnapshot from 'tsnapi/rolldown'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    cli: 'src/cli/index.ts',
    browser: 'src/browser/index.ts',
    vite: 'src/vite/index.ts',
  },
  format: ['esm'],
  dts: true,
  plugins: [
    ApiSnapshot(),
  ],
})
