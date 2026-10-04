#!/usr/bin/env bash
# Murmur · local server
# The microphone and the camera only work on https or on localhost, never on file://
cd "$(dirname "$0")"
PORT="${1:-8931}"
echo "Murmur: http://localhost:$PORT"
( sleep 1; open "http://localhost:$PORT" 2>/dev/null || xdg-open "http://localhost:$PORT" 2>/dev/null ) &
exec python3 -m http.server "$PORT" --bind 127.0.0.1
