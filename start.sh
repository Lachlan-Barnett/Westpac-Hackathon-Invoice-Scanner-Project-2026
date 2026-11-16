#!/bin/sh
cd "$(dirname "$0")"
[ -d node_modules ] || npm install
[ -f .env ] || cp .env.example .env
npm start
