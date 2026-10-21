// Refuse unsupported Node releases before linking or bootstrapping the daemon.
import './runtime-version.ts'

await import('./main.ts')
