// Baziu palette + font-family aliases — mirrors apps/web/src/styles.css.
// Custom font names (BaziuDisplay / BaziuBody / …) are registered in
// app/_layout.tsx via useFonts so each weight gets its own family (RN
// ignores fontWeight when fontFamily is custom on iOS).

export const colors = {
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

  // Semantic aliases (match shadcn token names from web)
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
} as const

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
