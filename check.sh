#!/bin/sh
# Полная проверка проекта одной командой: ./check.sh
set -e
cd "$(dirname "$0")"
echo "1. Тесты логики"; node tests/core.test.js
echo "2. Синтаксис скриптов"; for f in app.js core.js storage.js words.js; do node --check "$f"; done; echo "  ok"
echo "3. Сквозной тест в браузере"; python3 tests/e2e.py
echo "4. Сборка превью"; python3 tools/build_preview.py
