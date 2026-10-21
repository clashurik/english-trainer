"""Сквозной тест в настоящем браузере (Chromium без окна).
Проходит полное занятие так, как это сделал бы человек, и снимает скриншоты.
Запуск: python3 tests/e2e.py [папка_для_скриншотов]
"""
import json
import pathlib
import sys

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else ROOT / "dist" / "shots")
OUT.mkdir(parents=True, exist_ok=True)
URL = (ROOT / "index.html").as_uri()

errors = []
with sync_playwright() as p:
    browser = p.chromium.launch()
    for scheme in ["light", "dark"]:
        page = browser.new_page(viewport={"width": 390, "height": 844}, color_scheme=scheme)
        page.on("pageerror", lambda e: errors.append(str(e)))
        # Внешние ресурсы (шрифты, скрипт Telegram) в песочнице недоступны — отвечаем пустотой
        page.route("**/*", lambda r: r.continue_() if r.request.url.startswith("file:") else r.fulfill(status=200, body=""))
        page.goto(URL)
        page.wait_for_timeout(300)
        page.screenshot(path=str(OUT / f"1-home-{scheme}.png"), full_page=True)

        assert page.inner_text("#new-count") == "10", "на старте должно быть 10 новых слов"
        page.click("#start-btn")
        page.screenshot(path=str(OUT / f"2-card-{scheme}.png"))
        page.click("#reveal-btn")
        page.screenshot(path=str(OUT / f"3-answer-{scheme}.png"))

        if scheme == "light":
            # Первое слово «забываем» — оно должно вернуться в очередь
            page.click(".grade.g1")
            steps = 0
            while page.is_visible("#session") and steps < 40:
                page.click("#reveal-btn")
                page.click(".grade.g3")
                steps += 1
            assert page.is_visible("#done"), "занятие не завершилось"
            assert steps == 10, f"ожидали 10 карточек после ошибки, было {steps}"
            assert page.inner_text("#d-errors") == "1"
            assert page.inner_text("#d-reviewed") == "0", "забытое новое слово не должно считаться повторённым"
            assert page.inner_text("#d-new") == "10"
            page.screenshot(path=str(OUT / "4-done-light.png"), full_page=True)

            state = json.loads(page.evaluate("localStorage.getItem('english-trainer-v1')"))
            assert len(state["cards"]) == 10, "должно сохраниться 10 карточек"
            assert state["meta"]["streak"] == 1

            # Перезагрузка: прогресс должен подняться из хранилища
            page.reload()
            page.wait_for_timeout(300)
            assert page.inner_text("#streak-num") == "1"
            assert page.inner_text("#new-count") == "0", "дневной лимит новых слов исчерпан"
            page.screenshot(path=str(OUT / "5-home-after.png"), full_page=True)
        page.close()
    browser.close()

if errors:
    print("Ошибки JavaScript:", *errors, sep="\n  ")
    sys.exit(1)
print(f"Сквозной тест пройден. Скриншоты: {OUT}")
