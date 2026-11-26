// The Bazilion release this daemon is: the version of the published `bazilion` package, which
// bundles the daemon (the daemon's own package is private and not versioned).

import pkg from '../../../cli/package.json' with { type: 'json' }

export const BAZILION_VERSION: string = pkg.version
