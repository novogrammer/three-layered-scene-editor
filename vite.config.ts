import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    rolldownOptions: {
      input: { editor: 'index.html', viewer: 'viewer.html' },
    },
  },
})
