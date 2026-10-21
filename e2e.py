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

def re_cyr(s):
    return any("а" <= ch.lower() <= "я" or ch.lower() == "ё" for ch in s)


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
            assert "10 / 50" in page.inner_text("#level-rows"), "у A1 должно быть 10 начатых слов"
            page.screenshot(path=str(OUT / "5-home-after.png"), full_page=True)

            # --- Свободная тренировка: 10 изученных слов, RU → EN ---
            page.click("#practice-btn")
            assert "Подходит 10" in page.inner_text("#pr-found")
            page.click("#pr-dir [data-v='ru']")
            page.screenshot(path=str(OUT / "6-practice-setup.png"), full_page=True)
            before = json.loads(page.evaluate("localStorage.getItem('english-trainer-v1')"))["cards"]
            page.click("#pr-start")
            first_word = page.inner_text("#c-word")
            assert re_cyr(first_word), f"в режиме RU→EN сначала показывается русский перевод, а не «{first_word}»"
            assert page.is_hidden("#speak-btn"), "озвучка до ответа выдала бы перевод"
            page.click("#reveal-btn")
            page.screenshot(path=str(OUT / "7-practice-card.png"))
            page.click("#practice-grades [data-p='0']")  # не помню
            steps = 0
            while page.is_visible("#session") and steps < 30:
                page.click("#reveal-btn")
                page.click("#practice-grades [data-p='1']")
                steps += 1
            assert steps == 10, f"ожидали 10 карточек после ошибки, было {steps}"
            assert page.inner_text("#d-errors") == "1"
            after = json.loads(page.evaluate("localStorage.getItem('english-trainer-v1')"))["cards"]
            changed = [k for k in after if after[k] != before[k]]
            assert len(changed) == 1, f"тренировка должна изменить только забытое слово, изменено: {changed}"
            k = changed[0]
            assert after[k]["d"] < before[k]["d"] and after[k]["i"] == before[k]["i"], "забытое слово — в ближайшее задание, интервал тот же"
            page.click("#home-btn")
            assert page.inner_text("#due-count") == "1", "забытое на тренировке слово должно появиться в задании"

            # --- Импорт слов из урока ---
            page.click("#lessons-btn")
            page.fill("#import-text", "commute | ездить на работу | I commute by metro. | Я езжу на работу на метро.\n"
                                      "- run out of | закончиться (о запасах)\nborrow | одалживать\nбез разделителя")
            page.click("#import-btn")
            res = page.inner_text("#import-result")
            assert "Добавлено: 2" in res and "borrow" in res and "Не распознано строк: 1" in res, res
            page.screenshot(path=str(OUT / "8-lessons.png"), full_page=True)
            page.reload()
            page.wait_for_timeout(300)
            assert "2 слова из уроков" in page.inner_text("#lessons-sub"), "свои слова должны пережить перезагрузку"
            assert "Урок" in page.inner_text("#level-rows")
            page.click("#practice-btn")
            page.click("#pr-set [data-v='lessons']")
            assert "Подходит 2" in page.inner_text("#pr-found")
            page.screenshot(path=str(OUT / "9-home-final.png"), full_page=True)
        page.close()
    browser.close()

if errors:
    print("Ошибки JavaScript:", *errors, sep="\n  ")
    sys.exit(1)
print(f"Сквозной тест пройден. Скриншоты: {OUT}")
