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

    # ===== 6. Режим ввода ответа (1.3.0) =====
    answer_js = "WORDS.find(w => w.ru === document.getElementById('c-word').textContent).en"
    for scheme in ["light", "dark"]:
        page = new_page(browser, scheme)
        page.goto(URL)
        page.wait_for_timeout(300)
        page.click("#type-toggle")
        assert saved(page)["meta"]["settings"]["typeMode"] is True, "тумблер сохраняется"
        page.click("#start-btn")
        assert page.is_hidden("#reveal-btn") and page.is_visible("#type-input"), "в режиме ввода — поле вместо кнопки"
        assert re_cyr(page.inner_text("#c-word")), "показываем перевод"
        assert page.is_hidden("#speak-btn"), "озвучка до ответа выдала бы слово"
        page.keyboard.press("Enter")
        assert page.is_hidden("#type-next"), "пустой ответ не проверяем"

        # Верный ответ с «to» и заглавными буквами
        en = page.evaluate(answer_js)
        page.fill("#type-input", "To " + en.upper())
        page.keyboard.press("Enter")
        assert page.inner_text("#type-result") == "Верно!", page.inner_text("#type-result")
        assert "вернётся через 1 д" in page.inner_text("#next-btn")
        assert page.is_visible("#c-answer") and page.inner_text("#c-ru") == en
        page.screenshot(path=str(OUT / f"7-typed-ok-{scheme}.png"))
        if scheme == "dark":
            page.close()
            continue
        page.keyboard.press("Enter")  # сразу — игнорируется
        page.wait_for_timeout(400)
        page.keyboard.press("Enter")
        assert len(saved(page)["cards"]) == 1 and page.inner_text("#counter") == "1 / 10"

        # Подсказка, затем «Не знаю»: слово вернётся в этом же занятии
        page.click("#hint-btn")
        en2 = page.evaluate(answer_js)
        assert page.inner_text("#type-mask").startswith(en2[0]), "подсказка — первая буква"
        page.click("#giveup-btn")
        assert "Правильный ответ" in page.inner_text("#type-result") and en2 in page.inner_text("#type-result")
        assert "повторим в этом занятии" in page.inner_text("#next-btn")
        page.screenshot(path=str(OUT / "8-typed-wrong.png"))
        page.click("#next-btn")
        assert page.inner_text("#counter") == "1 / 10", "забытое слово не засчитано"

        # Неверный ответ, но «Засчитать как верный»
        en3 = page.evaluate(answer_js)
        page.fill("#type-input", "qqqq")
        page.click("#check-btn")
        assert page.inner_text("#type-result").startswith("Неверно")
        page.click("#override-btn")
        st = saved(page)
        assert st["cards"][en3.lower()]["i"] == 1 and st["cards"][en3.lower()]["l"] == 0, "засчитано как «Хорошо»"
        # Опечатка: меняем одну букву в длинном слове
        en4 = page.evaluate(answer_js)
        if len(en4) >= 4 and " " not in en4:
            page.fill("#type-input", en4[:-1] + ("x" if en4[-1] != "x" else "z"))
            page.keyboard.press("Enter")
            assert page.inner_text("#type-result").startswith("Почти"), page.inner_text("#type-result")
            page.keyboard.press("Enter")  # сразу — игнорируется
            page.wait_for_timeout(400)
            page.keyboard.press("Enter")
        page.click("#quit-btn")

        # В тренировке направление скрыто, выключение тумблера возвращает карточки
        page.click("#practice-btn")
        assert page.is_hidden("#pr-dir-row") and page.is_checked("#pr-type-toggle")
        page.click("#pr-type-toggle")
        assert page.is_visible("#pr-dir-row")
        page.click("#practice [data-home]")
        assert not page.is_checked("#type-toggle"), "один переключатель на главном и в тренировке"
        page.click("#start-btn")
        assert page.is_visible("#reveal-btn") and page.is_hidden("#type-box")
        page.close()

    # ===== 7. Словарь (1.3.0) =====
    page = new_page(browser)
    page.goto(URL)
    page.wait_for_timeout(300)
    page.click("#dict-btn")
    assert "В словаре" in page.inner_text("#dict-info")
    page.fill("#dict-q", "время")
    assert "time" in [t.lower() for t in page.locator(".d-en").all_inner_texts()], "поиск по-русски"
    page.fill("#dict-q", "borrow")
    assert page.locator(".d-en").first.inner_text() == "borrow"
    assert page.locator(".d-status").first.inner_text() == "не начато"
    page.screenshot(path=str(OUT / "9-dict.png"), full_page=True)
    page.locator(".dict-row").first.click()
    assert page.is_visible("#sheet") and page.inner_text("#sheet-title") == "borrow"
    assert page.locator("#sheet .example-box").count() == 3, "в карточке словаря все примеры"
    page.click("#sheet [data-act='add']")
    assert page.is_visible("#sheet [data-act='remove']")
    page.wait_for_timeout(300)
    page.screenshot(path=str(OUT / "10-dict-word.png"))
    page.click("#sheet-close")
    assert page.locator(".d-status").first.inner_text() == "в очереди"
    page.fill("#dict-q", "")
    assert page.locator(".d-en").all_inner_texts() == ["borrow"], "пустой поиск показывает очередь"
    page.click("#dict [data-home]")
    assert page.inner_text("#new-count") == "11", "добавленное слово — сверх дневной нормы"
    assert "Ждут ближайшего занятия: 1" in page.inner_text("#dict-sub")
    page.click("#start-btn")
    assert page.inner_text("#c-word") == "borrow", "добавленное слово идёт первым"
    page.click("#reveal-btn")
    page.click(".grade.g3")
    assert saved(page)["meta"]["priority"] == [], "после первого показа слово уходит из очереди"

    # ===== 8. Резервная копия (1.3.0) =====
    page.click("#quit-btn")
    before = saved(page)
    page.click("#settings summary")
    page.click("#backup-btn")
    with page.expect_download() as dl:
        page.click("#sheet [data-act='download']")
    backup_path = OUT / "backup.json"
    dl.value.save_as(str(backup_path))
    data = json.loads(backup_path.read_text(encoding="utf-8"))
    packed = {k: [c[x] for x in "riedl"] for k, c in before["cards"].items()}
    assert data["app"] == "english-trainer" and data["format"] == 2 and data["cards"] == packed, "компактный формат копии"
    assert dl.value.suggested_filename.startswith("english-trainer-")
    page.click("#sheet-close")

    page.click("#reset-btn")
    page.click("#reset-yes")
    assert saved(page)["cards"] == {}

    page.click("#restore-btn")
    page.fill("#restore-text", "просто текст")
    page.click("#sheet [data-act='check-backup']")
    assert "не похоже" in page.inner_text("#restore-out")
    page.set_input_files("#restore-file", str(backup_path))
    page.wait_for_selector("#sheet [data-act='apply-backup']")
    assert "1 слово с прогрессом" in page.inner_text("#restore-out"), page.inner_text("#restore-out")
    page.screenshot(path=str(OUT / "11-restore.png"))
    page.click("#sheet [data-act='apply-backup']")
    assert page.inner_text("#sheet-title") == "Прогресс восстановлен"
    page.click("#sheet-ok")
    after = saved(page)
    assert after["cards"] == before["cards"] and after["meta"]["streak"] == before["meta"]["streak"]
    page.reload()
    page.wait_for_timeout(300)
    assert page.is_hidden("#sheet"), "после восстановления «Что нового» не показываем"
    assert saved(page)["cards"] == before["cards"], "восстановленное сохраняется"
    page.close()

    # ===== 1.4.0: словарный тест, огонёк, размер занятия, отметка ошибки, хвост повторений =====
    for scheme in ["light", "dark"]:
        page = new_page(browser, scheme)
        page.goto(URL)
        page.wait_for_timeout(300)
        assert page.is_visible("#test-banner"), "новичку предлагаем тест"
        page.click("#test-banner")
        page.screenshot(path=str(OUT / f"12-test-intro-{scheme}.png"))
        page.click("#test-start")
        asked = 0
        while page.is_visible("#test-q") and asked < 60:
            page.wait_for_selector("#test-options:not(.locked) .test-opt")
            if asked == 2:
                page.screenshot(path=str(OUT / f"13-test-q-{scheme}.png"))
            # Знаем всё A1–A2, на B1 жмём «Не знаю»: тест должен остановиться после B1
            lvl = page.inner_text("#test-lvl")
            if lvl in ("A1", "A2"):
                ru = page.evaluate("(w) => WORDS.find(v => Core.label(v) === w).ru", page.inner_text("#test-word"))
                opts = page.locator("#test-options .test-opt")
                texts = opts.all_inner_texts()
                k = next(i for i, t in enumerate(texts) if ru.startswith(t.split("\n")[-1].strip()))
                opts.nth(k).click()
            else:
                page.click("#test-skip")
            asked += 1
            page.wait_for_timeout(1200)
        assert page.is_visible("#test-res"), "тест закончился"
        assert asked == 6 + 10 + 11, f"после B1 тест останавливается: {asked}"
        page.screenshot(path=str(OUT / f"14-test-result-{scheme}.png"), full_page=True)
        st = saved(page)
        assert st["meta"]["vocabTest"]["level"] == "A2", st["meta"]["vocabTest"]
        assert st["meta"]["vocab"]["A1"] == 1 and st["meta"]["vocab"]["B1"] == 0, st["meta"]["vocab"]
        assert len(st["cards"]) == 16, "знакомые слова получили карточки"
        page.click("#test-res [data-home]")
        assert page.is_hidden("#test-banner"), "после теста баннер не показываем"
        page.click("#settings summary")
        assert "A2" in page.inner_text("#vocab-info")
        page.close()

    # Хвост: 100 просроченных слов, «Лёгкое» занятие — 20 повторений, новых нет; огонёк серии
    page = new_page(browser)
    page.goto(URL)
    page.wait_for_timeout(300)
    page.evaluate("""() => {
      const day = Core.dayNumber(), cards = {};
      WORDS.slice(0, 100).forEach((w, k) => { cards[w.id] = k < 10 ? { r: 3, i: 30, e: 250, d: day - 25, l: 0 } : { r: 3, i: 5, e: 250, d: day - 1, l: 0 }; });
      localStorage.setItem('english-trainer-v1', JSON.stringify({ cards, custom: [], meta: {
        streak: 9, best: 9, lastDone: day - 1, seenVersion: window.APP_VERSION, settings: { size: 'light', typeMode: true } } }));
    }""")
    page.reload()
    page.wait_for_timeout(300)
    assert page.inner_text("#due-count") == "20", page.inner_text("#due-count")
    assert page.inner_text("#new-count") == "0", "при большом хвосте новых слов нет"
    assert "80 повторений подождут" in page.inner_text("#start-hint"), page.inner_text("#start-hint")
    assert page.get_attribute("#home-flame", "data-c") == "orange"
    page.click("#start-btn")
    quick = typed = 0
    while page.is_visible("#session"):
        if page.is_visible("#quick-note"):
            quick += 1
            page.click("#reveal-btn")
            if quick == 1:
                page.click("#report-btn")
                assert "Отмечено" in page.inner_text("#report-btn")
                page.screenshot(path=str(OUT / "15-quick.png"))
            page.click(".grade.g3")
        else:
            typed += 1
            page.fill("#type-input", "zzz")
            page.keyboard.press("Enter")
            page.click("#override-btn")
    assert quick > 0 and typed > 0, (quick, typed)
    assert page.get_attribute("#done-flame", "data-c") == "teal", "10-й день — бирюзовый огонёк"
    assert "бирюзовый" in page.inner_text("#tier-text")
    assert "Ещё порция" in page.inner_text("#more-btn")
    page.screenshot(path=str(OUT / "16-done-flame.png"), full_page=True)
    page.click("#more-btn")
    assert page.inner_text("#counter") == "0 / 10", "ещё порция — 10 повторений"
    page.click("#quit-btn")
    page.goto(URL)
    page.wait_for_timeout(300)
    page.click("#settings summary")
    assert page.is_visible("#reports-row")
    assert "Отмечено карточек: 1" in page.inner_text("#reports-info")
    page.click("#session-size [data-v='intense']")
    assert "до 80 повторений" in page.inner_text("#size-hint")
    page.screenshot(path=str(OUT / "17-settings.png"), full_page=True)
    page.close()
    browser.close()

if errors:
    print("Ошибки JavaScript:", *errors, sep="\n  ")
    sys.exit(1)
print(f"Сквозной тест пройден. Скриншоты: {OUT}")
