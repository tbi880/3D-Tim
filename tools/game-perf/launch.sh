#!/bin/bash
# Starts a Chrome of its own (throwaway profile, DevTools protocol on port 9333, no vsync or frame-rate limit) on
# the game. By default with a Pico-like user agent, so the game creates its canvas with 4x multisampling as it
# does in a headset; NOMSAA=1 uses a desktop user agent.
PROFILE="${TMPDIR:-/tmp}/eod-perf-chrome"
UA="Mozilla/5.0 (X11; Linux x86_64; PICO 4 OS5.8.0 like Quest) AppleWebKit/537.36 (KHTML, like Gecko) PicoBrowser/3.3.38 Chrome/105.0.5195.68 VR Safari/537.36"
[ -n "$NOMSAA" ] && UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36"
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --user-data-dir="$PROFILE" --remote-debugging-port=9333 \
    --no-first-run --no-default-browser-check --ignore-certificate-errors \
    --disable-backgrounding-occluded-windows --disable-renderer-backgrounding --disable-background-timer-throttling \
    --disable-gpu-vsync --disable-frame-rate-limit --autoplay-policy=no-user-gesture-required \
    --window-size=1600,900 --window-position=100,100 --user-agent="$UA" \
    "https://localhost:5173/echoes_of_dawn" > /dev/null 2>&1 &
