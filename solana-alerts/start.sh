#!/usr/bin/env sh
cd "$(dirname "$0")" || exit 1
[ -f .env ] || cp .env.example .env
exec node server.js
