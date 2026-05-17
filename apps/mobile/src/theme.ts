// Baziu palette + font-family aliases — mirrors apps/web/src/styles.css.
// Custom font names (BaziuDisplay / BaziuBody / …) are registered in
// app/_layout.tsx via useFonts so each weight gets its own family (RN
// ignores fontWeight when fontFamily is custom on iOS).
//
// Two palettes ship: `lightColors` (cream + sapphire, the default) and
// `darkColors` (deep seal mask + brighter sapphire — "Mask & Moonlight").
// Active palette resolves via the useColors() hook in theme-context.tsx.

export type Colors = {
  // Raw palette
  cream: string
  ivory: string
  frost: string
  fawn: string
  chocolate: string
  charcoal: string
  mocha: string
  mochaLight: string
  sapphire: string
  sapphireDeep: string
  sapphireLight: string
  sapphireGlow: string
  rose: string
  snow: string
  destructive: string

  // Semantic aliases (match shadcn token names from web)
  background: string
  foreground: string
  card: string
  cardForeground: string
  primary: string
  primaryForeground: string
  secondary: string
  secondaryForeground: string
  muted: string
  mutedForeground: string
  accent: string
  accentForeground: string
  border: string
}

export const lightColors: Colors = {
  // Raw palette
  cream: '#F5F0E8',
  ivory: '#FAF8F4',
  frost: '#E8E2D8',
  fawn: '#D4CAB8',
  chocolate: '#3D2B1F',
  charcoal: '#2A1F16',
  mocha: '#7A6555',
  mochaLight: '#9E8E7E',
  sapphire: '#4A7C9B',
  sapphireDeep: '#3A6580',
  sapphireLight: '#6BA3C2',
  sapphireGlow: 'rgba(74, 124, 155, 0.12)',
  rose: '#C4878A',
  snow: '#FFFFFF',
  destructive: '#9B3D3D',

  // Semantic aliases
  background: '#F5F0E8',
  foreground: '#3D2B1F',
  card: '#FFFFFF',
  cardForeground: '#3D2B1F',
  primary: '#4A7C9B',
  primaryForeground: '#FFFFFF',
  secondary: '#FAF8F4',
  secondaryForeground: '#3D2B1F',
  muted: '#FAF8F4',
  mutedForeground: '#9E8E7E',
  accent: 'rgba(74, 124, 155, 0.12)',
  accentForeground: '#3A6580',
  border: '#E8E2D8',
}

// "Mask & Moonlight" — the Neva at twilight. Seal-point mask = page bg,
// cream body fur = text, sapphire eyes glow brighter on dark fur.
export const darkColors: Colors = {
  // Raw palette
  cream: '#1A140F',
  ivory: '#211A13',
  frost: '#3B2E24',
  fawn: '#5C4A3D',
  chocolate: '#F5F0E8',
  charcoal: '#FAF8F4',
  mocha: '#C4B3A0',
  mochaLight: '#A89789',
  sapphire: '#7BB4D2',
  sapphireDeep: '#5E9BBA',
  sapphireLight: '#A0CEE3',
  sapphireGlow: 'rgba(123, 180, 210, 0.18)',
  rose: '#D89A9D',
  snow: '#2A211A',
  destructive: '#D87878',

  // Semantic aliases
  background: '#1A140F',
  foreground: '#F5F0E8',
  card: '#2A211A',
  cardForeground: '#F5F0E8',
  primary: '#7BB4D2',
  primaryForeground: '#0F0A07',
  secondary: '#211A13',
  secondaryForeground: '#F5F0E8',
  muted: '#211A13',
  mutedForeground: '#A89789',
  accent: 'rgba(123, 180, 210, 0.18)',
  accentForeground: '#A0CEE3',
  border: '#3B2E24',
}

// Default export kept for module-level usage that doesn't (yet) react to
// theme changes — `_layout.tsx`'s Stack screenOptions used to read this
// statically. Anything rendering inside a ThemeProvider should call
// useColors() from theme-context.ts so it re-renders on theme change.
export const colors: Colors = lightColors

export const fonts = {
  display: 'BaziuDisplay',
  body: 'BaziuBody',
  bodyMedium: 'BaziuBodyMedium',
  bodyBold: 'BaziuBodyBold',
  mono: 'BaziuMono',
} as const

export const radii = {
  sm: 6,
  md: 10,
  lg: 16,
  xl: 22,
} as const

export type ThemeMode = 'system' | 'light' | 'dark'
