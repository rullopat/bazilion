/** Real kernel prerequisites remain mandatory; no absence/probe-based skip or platform simulation. */
export const nativeIntegrationEnabled =
  process.env.BAZILION_TEST_NATIVE === '1' &&
  (process.platform === 'linux' || (process.platform === 'darwin' && process.arch === 'arm64'))
