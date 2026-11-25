#!/usr/bin/env bash
# Remakes apps/cli/assets/Bazilion.icns, the Bazilion app's icon on macOS, from the web UI's logo:
# the cat on a cream rounded square with a soft shadow. Needs macOS (sips, iconutil), rsvg-convert
# and ImageMagick.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
rsvg-convert -w 700 -h 700 "$root/apps/web/public/baziu.svg" -o "$work/cat.png"
magick -size 1024x1024 xc:none -fill '#f4f1eb' -draw 'roundrectangle 100,100 923,923 185,185' "$work/base.png"
magick "$work/base.png" \
  \( "$work/base.png" -alpha extract -blur 0x18 -level 0,60% -background black -alpha shape \
     -channel A -evaluate multiply 0.35 +channel \) -compose dst-over -geometry +0+12 -composite \
  "$work/cat.png" -geometry +162+150 -compose over -composite "$work/icon.png"
mkdir "$work/Bazilion.iconset"
for size in 16 32 128 256 512; do
  sips -z "$size" "$size" "$work/icon.png" --out "$work/Bazilion.iconset/icon_${size}x${size}.png" >/dev/null
  double=$((size * 2))
  sips -z "$double" "$double" "$work/icon.png" --out "$work/Bazilion.iconset/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns "$work/Bazilion.iconset" -o "$root/apps/cli/assets/Bazilion.icns"
echo "wrote apps/cli/assets/Bazilion.icns"
