#!/bin/sh
# Renders the landing hero's particle images into public/hero/.
set -e
cd "$(dirname "$0")"
C="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
mkdir -p ../../public/hero
"$C" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 --default-background-color=00000000 \
  --window-size=2400,860 --screenshot="$PWD/../../public/hero/panel.png" "file://$PWD/art.html"
"$C" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 --default-background-color=00000000 \
  --window-size=1100,860 --screenshot="$PWD/../../public/hero/panel-mobile.png" "file://$PWD/art.html?mobile"
