/** Supported product-native execution is Linux-only. Mac native qualification is deferred,
 * not passed or skipped because a prerequisite probe failed. Low-level historical/development
 * controls do not authorize Mac product admission. Linux prerequisites remain mandatory. */
export const nativeIntegrationEnabled =
  process.env.BAZILION_TEST_NATIVE === '1' && process.platform === 'linux'
