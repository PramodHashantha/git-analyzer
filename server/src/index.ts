import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createApp } from './app'

const PORT = Number(process.env.PORT ?? 3001)
const HOST = '127.0.0.1'
const isProd = process.env.NODE_ENV === 'production'
const __dirname = path.dirname(fileURLToPath(import.meta.url))

const app = createApp(isProd ? path.resolve(__dirname, '../../dist') : undefined)

app.listen(PORT, HOST, () => {
  console.log(`Git Contribution Dashboard backend listening on http://${HOST}:${PORT}`)
})
