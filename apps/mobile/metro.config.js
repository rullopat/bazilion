// pnpm + Expo monorepo config.
//
// - `watchFolders` gets the workspace root APPENDED (not replaced) so Metro
//   picks up live edits to `@bazilion/client` / `@bazilion/api-types` during
//   dev while still keeping Expo's own watched paths.
//
// - `nodeModulesPaths` also includes the workspace root's `node_modules` so
//   hoisted deps resolve. Hierarchical lookup stays enabled (the Expo
//   default) — this lets Metro fall back to pnpm's `.pnpm/*` symlink store
//   for transitive peers that aren't hoisted to `apps/mobile/node_modules`.
//   Safe as long as there's exactly one copy of `react-native` / `react` in
//   the tree; a fresh `pnpm install` after SDK bumps keeps it that way.

const { getDefaultConfig } = require('expo/metro-config')
const path = require('node:path')

const projectRoot = __dirname
const workspaceRoot = path.resolve(projectRoot, '../..')

const config = getDefaultConfig(projectRoot)

config.watchFolders = [...(config.watchFolders ?? []), workspaceRoot]
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
]

module.exports = config
