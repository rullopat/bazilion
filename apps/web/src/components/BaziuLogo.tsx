// The Baziu portrait — used as the brand logo in prominent slots (TopNav,
// login header) and as the favicon. Served as a static asset from
// /public/baziu.svg. For tiny decorative paw accents (footer credit, inline
// "dedicated to Baziu") keep using ./PawIcon — the embedded raster inside
// this SVG renders muddily below ~16px.

interface BaziuLogoProps {
  className?: string
}

export function BaziuLogo({ className }: BaziuLogoProps) {
  return (
    <img
      src="/baziu.svg"
      alt=""
      aria-hidden="true"
      draggable={false}
      className={className}
    />
  )
}
