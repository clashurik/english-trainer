"""Сквозной тест в настоящем браузере (Chromium без окна).
Проходит сценарии так, как это сделал бы человек, и снимает скриншоты.
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
KEY = "english-trainer-v1"


def re_cyr(s):
    return any("а" <= ch.lower() <= "я" or ch.lower() == "ё" for ch in s)


def saved(page):
    return json.loads(page.evaluate(f"localStorage.getItem('{KEY}')"))


errors = []


def new_page(browser, scheme="light"):
    page = browser.new_page(viewport={"width": 390, "height": 844}, color_scheme=scheme)
    page.on("pageerror", lambda e: errors.append(str(e)))
    # Внешние ресурсы (шрифты, скрипт Telegram) в песочнице недоступны — отвечаем пустотой
    page.route("**/*", lambda r: r.continue_() if r.request.url.startswith("file:") else r.fulfill(status=200, body=""))
    return page


with sync_playwright() as p:
    browser = p.chromium.launch()

    # ===== 1. Новый пользователь: ежедневное занятие, формы слова, примеры =====
    for scheme in ["light", "dark"]:
        page = new_page(browser, scheme)
        page.goto(URL)
        page.wait_for_timeout(300)
        assert page.is_hidden("#sheet"), "новичку окно «Что нового» не показываем"
        page.screenshot(path=str(OUT / f"1-home-{scheme}.png"), full_page=True)
        assert page.inner_text("#new-count") == "10", "на старте должно быть 10 новых слов"
        page.click("#start-btn")
        page.click("#reveal-btn")
        page.screenshot(path=str(OUT / f"2-answer-{scheme}.png"))
        if scheme == "dark":
            page.close()
            continue

        # Ищем в первых карточках слово с формами и проверяем панель
        found_forms = checked_examples = False
        page.click(".grade.g1")  # первое слово «забыли» — оно вернётся
        steps = 0
        while page.is_visible("#session") and steps < 40:
            page.click("#reveal-btn")
            word = page.inner_text("#c-word")
            assert page.locator("#c-ex b").count() == 1, f"в примере к «{word}» слово не подсвечено: {page.inner_text('#c-ex')}"
            if page.inner_text("#c-pos") != "фраза":
                assert "tappable" in (page.get_attribute("#c-word", "class") or ""), f"у слова «{word}» нет форм"
            if not checked_examples and page.is_visible("#ex-next"):
                before = page.inner_text("#c-ex")
                assert page.inner_text("#ex-pos") == "1/3", "у нового слова первый из трёх примеров"
                page.click("#ex-next")
                assert page.inner_text("#c-ex") != before and page.inner_text("#ex-pos") == "2/3"
                checked_examples = True
            if not found_forms and page.is_visible("#forms-btn"):
                assert "tappable" in page.get_attribute("#c-word", "class"), "слово с формами должно быть нажимаемым"
                page.click("#c-word")
                assert page.is_visible("#sheet"), "по нажатию на слово открываются формы"
                assert page.locator("#sheet .form-row, #sheet .irr-chip").count() > 0
                page.wait_for_timeout(300)  # дождаться конца анимации панели
                page.screenshot(path=str(OUT / "3-forms.png"))
                page.click("#sheet-close")
                assert page.is_hidden("#sheet")
                found_forms = True
            page.click(".grade.g3")
            steps += 1
        assert found_forms, "среди первых карточек не нашлось слова с формами"
        assert checked_examples, "не нашлось слова с несколькими примерами"
        assert steps == 10, f"ожидали 10 карточек после ошибки, было {steps}"
        assert page.inner_text("#d-reviewed") == "0" and page.inner_text("#d-new") == "10"
        page.screenshot(path=str(OUT / "4-done.png"), full_page=True)

        st = saved(page)
        assert len(st["cards"]) == 10 and st["meta"]["streak"] == 1
        assert st["meta"]["seenVersion"], "новичку сразу записываем текущую версию"
        page.reload()
        page.wait_for_timeout(300)
        assert page.is_hidden("#sheet")
        assert page.inner_text("#streak-num") == "1" and page.inner_text("#new-count") == "0"
        assert page.locator(".level-row.lv-A1 .level-count").inner_text().startswith("10 /")

        # ===== 2. Свободная тренировка RU → EN =====
        page.click("#practice-btn")
        assert "Подходит 10" in page.inner_text("#pr-found")
        page.click("#pr-dir [data-v='ru']")
        before = saved(page)["cards"]
        page.click("#pr-start")
        assert re_cyr(page.inner_text("#c-word")), "в режиме RU→EN сначала русский"
        assert page.is_hidden("#speak-btn")
        page.click("#reveal-btn")
        assert "tappable" not in (page.get_attribute("#c-word", "class") or ""), "в RU→EN русское слово не нажимается"
        page.click("#practice-grades [data-p='0']")
        steps = 0
        while page.is_visible("#session") and steps < 30:
            page.click("#reveal-btn")
            page.click("#practice-grades [data-p='1']")
            steps += 1
        assert steps == 10 and page.inner_text("#d-errors") == "1"
        after = saved(page)["cards"]
        changed = [k for k in after if after[k] != before[k]]
        assert len(changed) == 1 and after[changed[0]]["i"] == before[changed[0]]["i"]
        page.click("#home-btn")
        assert page.inner_text("#due-count") == "1"

        # ===== 3. Слова из уроков =====
        page.click("#lessons-btn")
        page.fill("#import-text", "doomscroll | бесконечно листать новости | I doomscroll before bed. | Я листаю новости перед сном.\n"
                                  "- be on the fence | колебаться, не решаться\nborrow | одалживать\nбез разделителя")
        page.click("#import-btn")
        res = page.inner_text("#import-result")
        assert "Добавлено: 2" in res and "borrow" in res and "Не распознано строк: 1" in res, res
        page.reload()
        page.wait_for_timeout(300)
        assert "2 слова из уроков" in page.inner_text("#lessons-sub")
        page.click("#practice-btn")
        page.click("#pr-set [data-v='lessons']")
        assert "Подходит 2" in page.inner_text("#pr-found")
        page.click("#practice [data-home]")

        # ===== 4. История версий =====
        page.click("#history-btn")
        n = page.locator(".release").count()
        assert n >= 4 and page.locator(".release.current .release-v").inner_text() == page.evaluate("APP_VERSION")
        page.screenshot(path=str(OUT / "5-history.png"), full_page=True)
        page.close()

    # ===== 5. Пользователь версии 1.1.0 обновляется =====
    page = new_page(browser)
    page.goto(URL)
    old_state = {
        "cards": {"time": {"r": 2, "i": 3, "e": 250, "d": 0, "l": 0}},
        "custom": [{"id": "doomscroll", "en": "doomscroll", "ru": "листать новости", "pos": "", "lvl": "MY",
                    "ex": "I doomscroll at night.", "exRu": "Я листаю новости ночью."}],
        "meta": {"streak": 3, "best": 3, "lastDone": None, "newDay": None, "newDone": 0,
                 "settings": {"newPerDay": 10, "levels": ["A1", "A2", "B1"]},
                 "practice": {"set": "studied", "levels": ["A1", "A2", "B1"], "kind": "all", "dir": "en", "count": 10}},
    }
    page.evaluate(f"localStorage.setItem('{KEY}', {json.dumps(json.dumps(old_state, ensure_ascii=False))})")
    page.reload()
    page.wait_for_timeout(300)
    assert page.is_visible("#sheet"), "после обновления старому пользователю показываем «Что нового»"
    assert page.inner_text("#sheet-title") == "Что нового"
    page.screenshot(path=str(OUT / "6-whats-new.png"))
    page.click("#sheet-ok")
    assert page.is_hidden("#sheet")
    st = saved(page)
    assert st["meta"]["seenVersion"] == page.evaluate("APP_VERSION")
    assert "B2" in st["meta"]["settings"]["levels"] and "B2" in st["meta"]["practice"]["levels"], "B2 включается тем, кто не менял уровни"
    assert st["custom"][0]["ex"] == [["I doomscroll at night.", "Я листаю новости ночью."]], "старое слово из урока переведено в новый формат"
    assert page.inner_text("#due-count") == "1", "прогресс старой версии на месте"
    page.reload()
    page.wait_for_timeout(300)
    assert page.is_hidden("#sheet"), "второй раз «Что нового» не показываем"
    page.close()
    browser.close()

if errors:
    print("Ошибки JavaScript:", *errors, sep="\n  ")
    sys.exit(1)
print(f"Сквозной тест пройден. Скриншоты: {OUT}")
