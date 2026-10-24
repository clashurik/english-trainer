#!/bin/sh
# Полная проверка проекта одной командой: ./check.sh
set -e
cd "$(dirname "$0")"
echo "1. Сборка и проверка словаря"; python3 tools/build_words.py
echo "2. Тесты логики"; node tests/core.test.js
echo "3. Синтаксис скриптов"; for f in changelog.js app.js core.js storage.js words.js; do node --check "$f"; done; echo "  ok"
echo "4. Сквозной тест в браузере"; python3 tests/e2e.py
echo "5. Сборка превью и проверка версии"; python3 tools/build_preview.py
