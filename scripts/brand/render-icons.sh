#!/bin/sh
# Renders favicon.ico (16, 32, 48) and apple-icon.png (180) from src/app/icon.svg.
set -e
cd "$(dirname "$0")/../.."
C="${CHROME_PATH:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
TMP=$(mktemp -d)
render() { # size, background, inset, out
  cat > "$TMP/page.html" <<HTML
<!doctype html><style>html,body{margin:0;background:$2}img{display:block;width:$(($1 - $3 * 2))px;height:$(($1 - $3 * 2))px;margin:$3px}</style>
<img src="file://$PWD/src/app/icon.svg">
HTML
  "$C" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 --default-background-color=00000000 \
    --window-size="$1,$1" --screenshot="$4" "file://$TMP/page.html" >/dev/null 2>&1
}
for s in 16 32 48; do render $s transparent 0 "$TMP/$s.png"; done
# iOS fills transparency with black, so the touch icon sits on the Ember ground.
render 180 '#110810' 18 src/app/apple-icon.png
python3 scripts/brand/make-ico.py src/app/favicon.ico "$TMP/16.png" "$TMP/32.png" "$TMP/48.png"
rm -rf "$TMP"
