"""Проверяет словарь в data/*.json и собирает из него words.js для приложения.

Запуск: python3 tools/build_words.py
Порядок слов в итоговом списке важен: новые слова приложение берёт сверху вниз.
Внутри каждого уровня: старые карточки (core.json), потом новые слова по полезности,
и равномерно вперемешку с ними — фразы.

Ошибки (сборка останавливается): нарушен формат, дубликаты, пропала старая карточка.
Предупреждения (записываются в data/work/warnings.txt): пример, где слово не нашлось.
"""
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
LEVELS = ["A1", "A2", "B1", "B2"]
POS = {"n", "v", "adj", "adv", "ph"}
CYR = re.compile(r"[А-Яа-яЁё]")
IRR = re.compile(r"^[a-z]+(/[a-z]+)?\|[a-z]+(/[a-z]+)?$")

errors, warnings = [], []


def err(where, msg):
    errors.append(f"{where}: {msg}")


def load(name):
    path = DATA / name
    if not path.exists() and "--partial" in sys.argv:
        return []
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception as e:  # noqa: BLE001
        err(name, f"не читается как JSON: {e}")
        return []


def stem_pattern(phrase):
    """Шаблон, который находит слово в любой форме: decide → decided, child → children."""
    words = re.sub(r"\b(sb|sth|someone|something|your|my|one's|oneself|yourself)\b", "", phrase.lower())
    parts = [p for p in re.split(r"[\s/]+", re.sub(r"[?!.,']", " ", words)) if p]
    if len(parts) > 1:
        parts = parts[1:]  # у фраз первый глагол часто неправильный (find out → found out): ищем остальное
    pats = []
    for p in parts[:3]:
        if len(p) <= 2:
            pats.append(re.escape(p))
            continue
        stem = p[:-1] if p[-1] in "ey" else p  # save → saving, try → tried
        stem = stem[: max(3, len(stem) - 1)] if len(stem) > 5 else stem
        pats.append(re.escape(stem))
    return re.compile(r"\b" + r".*?\b".join(pats), re.I | re.S) if pats else None


def check(card, where):
    for k in ("en", "ru", "pos", "lvl", "ex"):
        if not card.get(k):
            err(where, f"нет поля {k}")
            return False
    if card["pos"] not in POS:
        err(where, f"неизвестная часть речи {card['pos']}")
    if card["lvl"] not in LEVELS:
        err(where, f"неизвестный уровень {card['lvl']}")
    if CYR.search(card["en"]):
        err(where, "кириллица в английском слове")
    if not CYR.search(card["ru"]):
        err(where, "в переводе нет кириллицы")
    ex = card["ex"]
    if not isinstance(ex, list) or len(ex) != 3:
        err(where, "должно быть ровно 3 примера")
    else:
        pat = stem_pattern(card["en"])
        for i, pair in enumerate(ex):
            if not (isinstance(pair, list) and len(pair) == 2 and all(isinstance(s, str) and s.strip() for s in pair)):
                err(where, f"пример {i + 1}: нужна пара [англ., рус.]")
                continue
            if CYR.search(pair[0]):
                err(where, f"пример {i + 1}: кириллица в английском")
            if not CYR.search(pair[1]):
                err(where, f"пример {i + 1}: в переводе нет кириллицы")
            if pat and not pat.search(pair[0]) and card.get("irr") is None:
                warnings.append(f"{where}: пример {i + 1} без слова: {pair[0]}")
    irr = card.get("irr")
    if irr is not None and (card["pos"] != "v" or not IRR.match(irr)):
        err(where, f"поле irr только для глаголов, формат went|gone, а не {irr!r}")
    forms = card.get("forms", [])
    if not isinstance(forms, list) or len(forms) > 5:
        err(where, "forms: список до 4–5 элементов")
    else:
        for f in forms:
            if not (isinstance(f, list) and len(f) == 3 and f[1] in POS and f[0] and CYR.search(f[2] or "")):
                err(where, f"forms: неверный элемент {f}")
    note = card.get("note")
    if note is not None and not isinstance(note, str):
        err(where, "note: должна быть строкой")
    elif note and not CYR.search(note):
        warnings.append(f"{where}: подсказка без русского текста: {note}")
    return True


def main():
    core = load("core.json")
    phrases = load("phrases.json")
    generated = {lv: [] for lv in LEVELS}
    for path in sorted(DATA.glob("words-*.json")):
        for c in load(path.name):
            generated.setdefault(c.get("lvl"), []).append(c)

    # Старые карточки обязаны остаться: к ним привязан прогресс пользователей
    old_ids = json.loads((DATA / "work" / "existing-120.json").read_text(encoding="utf-8"))
    core_ids = {c.get("en", "").lower() for c in core}
    for w in old_ids:
        if w["id"] not in core_ids:
            err("core.json", f"пропала старая карточка «{w['en']}»")

    ordered = []
    for lv in LEVELS:
        words = [c for c in core if c.get("lvl") == lv and c.get("pos") != "ph"] + generated.get(lv, [])
        phr = [c for c in core if c.get("lvl") == lv and c.get("pos") == "ph"] + [c for c in phrases if c.get("lvl") == lv]
        # Фразы равномерно вперемешку со словами
        step = (len(words) + 1) / (len(phr) + 1) if phr else 0
        merged, pi = [], 0
        for i, w in enumerate(words):
            merged.append(w)
            while pi < len(phr) and (i + 1) >= step * (pi + 1):
                merged.append(phr[pi])
                pi += 1
        merged += phr[pi:]
        ordered += merged

    seen = {}
    for c in ordered:
        where = f"{c.get('en', '?')} [{c.get('lvl', '?')}]"
        if not check(c, where):
            continue
        cid = c["en"].lower()
        if cid in seen:
            err(where, f"дубликат (уже есть на уровне {seen[cid]})")
        seen[cid] = c["lvl"]

    (DATA / "work").mkdir(exist_ok=True)
    (DATA / "work" / "warnings.txt").write_text("\n".join(warnings), encoding="utf-8")
    if errors:
        print(f"ОШИБКИ ({len(errors)}):", *errors[:60], sep="\n  ")
        sys.exit(1)

    rows = [
        [c["en"], c["ru"], c["pos"], c["lvl"], c["ex"], c.get("irr") or 0, c.get("forms") or 0, c.get("note") or 0]
        for c in ordered
    ]
    body = ",\n".join(json.dumps(r, ensure_ascii=False, separators=(",", ":")) for r in rows)
    js = (
        "/*\n * words.js — словарь приложения. ФАЙЛ СОБИРАЕТСЯ АВТОМАТИЧЕСКИ, руками не править:\n"
        " * исходники лежат в data/*.json, сборка — python3 tools/build_words.py\n"
        " * Строка: [слово, перевод, часть речи, уровень, [[пример, перевод]×3], неправ. формы, однокоренные, подсказка]\n"
        " * Уровни — по списку CEFR-J Wordlist (Tono Lab, TUFS), порядок внутри уровня — по полезности.\n */\n"
        "(function (root) {\n  'use strict';\n  var RAW = [\n" + body + "\n  ];\n"
        "  root.WORDS = RAW.map(function (r) {\n"
        "    return { id: r[0].toLowerCase(), en: r[0], ru: r[1], pos: r[2], lvl: r[3], ex: r[4],\n"
        "      irr: r[5] || null, forms: r[6] || [], note: r[7] || '' };\n  });\n"
        "  if (typeof module !== 'undefined' && module.exports) module.exports = root.WORDS;\n"
        "})(typeof window !== 'undefined' ? window : globalThis);\n"
    )
    (ROOT / "words.js").write_text(js, encoding="utf-8")
    from collections import Counter

    by = Counter(c["lvl"] for c in ordered)
    ph = sum(1 for c in ordered if c["pos"] == "ph")
    print(f"Словарь: {len(ordered)} карточек ({', '.join(f'{lv} {by[lv]}' for lv in LEVELS)}; из них фраз {ph}). "
          f"Предупреждений: {len(warnings)}. words.js: {(ROOT / 'words.js').stat().st_size // 1024} КБ")


if __name__ == "__main__":
    main()
