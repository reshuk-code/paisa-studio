import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { copyFileSync, existsSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Copy icon.png from mobile assets to public/ if available (local dev only).
// On Render the mobile folder won't exist — that's fine, icon.png should
// already be committed to public/ for production builds.
try {
  const mobileIcon = resolve(__dirname, '../mobile/assets/images/icon.png')
  const publicIcon = resolve(__dirname, 'public/icon.png')
  if (existsSync(mobileIcon) && !existsSync(publicIcon)) {
    copyFileSync(mobileIcon, publicIcon)
    console.log('[paisa-studio] Copied icon.png from mobile assets')
  }
} catch (e) {
  // Silent in CI/Render — icon.png must be committed to public/
}

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
})
