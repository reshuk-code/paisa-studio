import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { copyFileSync, existsSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Copy icon.png from mobile assets to public/ if not already there
const mobileIcon = resolve(__dirname, '../mobile/assets/images/icon.png')
const publicIcon = resolve(__dirname, 'public/icon.png')
try {
  if (existsSync(mobileIcon) && !existsSync(publicIcon)) {
    copyFileSync(mobileIcon, publicIcon)
    console.log('[paisa-studio] Copied icon.png from mobile assets')
  }
} catch(e) {
  console.warn('[paisa-studio] Could not auto-copy icon.png:', e.message)
}

export default defineConfig({
  plugins: [react()],
})
