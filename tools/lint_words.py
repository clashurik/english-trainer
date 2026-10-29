#!/usr/bin/env python3
"""Линтер смысла карточек: находит то, что пропускает build_words.py.

  python3 tools/lint_words.py            — отчёт в data/work/lint.txt, код 1 при ошибках
  python3 tools/lint_words.py --json F   — найденные карточки списком в файл F (задание Корректору)

Проверки (ошибка = ломает задание, совет = стоит посмотреть):
  ERR ru-latin    латиница в переводе: ответ подсказан в вопросе («много (a lot)»).
                  Исключения: «(мн. ч. children)» и т. п. — пометка через исключения ниже.
  ERR show        поле show не содержит en, или задано не строкой.
  ERR dup-ru      два одинаковых перевода у разных карточек одного уровня — ответ угадать нельзя.
  ERR ex-dup      повторяющиеся примеры в одной карточке.
  ERR bare        одиночное слово, которое почти не живёт без окружения (lot, sake, behalf...):
                  нужно поле show с естественной формой («a lot»).
  WRN ex-len      пример короче 3 или длиннее 18 слов.
"""
import json, re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
LAT = re.compile(r"[A-Za-z]")
# Латиница допустима: пометка о мн. числе, формах, сокращения единиц.
LAT_OK = re.compile(r"\((?:мн\.\s*ч\.|ед\.\s*ч\.|прош\.\s*вр\.)[^)]*\)|\b(?:TV|SMS|IT|CV|PhD|OK|USB|Wi-Fi|e-mail)\b")
# Слова, которые в речи почти всегда идут с соседями. Показывать их надо в форме show.
BARE = {"lot", "sake", "behalf", "accordance", "spite"}


def cards():
    for f in sorted(DATA.glob("*.json")):
        for i, c in enumerate(json.loads(f.read_text(encoding="utf-8"))):
            yield f.name, i, c


def lint():
    found = []  # (уровень, файл, en, код, текст)
    by_ru = {}
    for fname, i, c in cards():
        en, ru = c["en"], c["ru"]
        add = lambda lvl, code, msg: found.append((lvl, fname, en, code, msg))
        if LAT.search(LAT_OK.sub("", ru)):
            add("ERR", "ru-latin", f"латиница в переводе: {ru}")
        show = c.get("show")
        if show is not None and (not isinstance(show, str) or en.lower() not in show.lower()):
            add("ERR", "show", f"show должен содержать «{en}»: {show!r}")
        if show is None and en.lower() in BARE:
            add("ERR", "bare", "одиночное слово, нужно show с естественной формой")
        exs = [p[0].strip().lower() for p in c.get("ex", [])]
        if len(set(exs)) != len(exs):
            add("ERR", "ex-dup", "повторяются примеры")
        for p in c.get("ex", []):
            n = len(p[0].split())
            if n < 3 or n > 18:
                add("WRN", "ex-len", f"{n} слов: {p[0]}")
        key = (c["lvl"], ru.strip().lower())
        by_ru.setdefault(key, []).append((fname, en))
    for (lvl, ru), lst in by_ru.items():
        if len(lst) > 1:
            names = ", ".join(e for _, e in lst)
            for fname, en in lst:
                found.append(("ERR", fname, en, "dup-ru", f"тот же перевод «{ru}» у: {names}"))
    return found


def main():
    found = lint()
    lines = [f"{l} {code:9} {f:18} {en:22} {msg}" for l, f, en, code, msg in sorted(found)]
    (DATA / "work" / "lint.txt").write_text("\n".join(lines), encoding="utf-8")
    errs = sum(1 for x in found if x[0] == "ERR")
    print(f"  линтер: ошибок {errs}, советов {len(found) - errs} (data/work/lint.txt)")
    if "--json" in sys.argv:
        out = Path(sys.argv[sys.argv.index("--json") + 1])
        want = {(f, en) for _, f, en, _, _ in found}
        rows = [dict(file=f, **c, problems=[m for _, ff, e, _, m in found if (ff, e) == (f, c["en"])])
                for f, _, c in cards() if (f, c["en"]) in want]
        out.write_text(json.dumps(rows, ensure_ascii=False, indent=1), encoding="utf-8")
    sys.exit(1 if errs else 0)


if __name__ == "__main__":
    main()
