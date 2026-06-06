import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { execSync } from 'child_process'

let commitHash = 'N/A'
let commitDate = 'N/A'
try {
  commitHash = execSync('git rev-parse --short HEAD').toString().trim()
  commitDate = execSync('git log -1 --format=%cd --date=format:"%Y-%m-%d %H:%M:%S"').toString().trim()
} catch (e) {
  // Fallback if git is not available during compile
  commitHash = 'N/A'
}

const buildTime = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: './',
  define: {
    __BUILD_METADATA__: JSON.stringify({
      version: 'v1.8.3',
      commitHash,
      commitDate,
      buildTime,
    })
  }
})
