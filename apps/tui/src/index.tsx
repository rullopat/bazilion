import { render } from 'ink'
import { App } from './app.tsx'
import { type ClientConfig, loadClientConfig } from './client.ts'

let config: ClientConfig
try {
  config = loadClientConfig()
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err)
  process.stderr.write(`bazi: ${msg}\n`)
  process.exit(1)
}

render(<App config={config} />)
