"""Собирает preview.html — один файл со всеми стилями и скриптами внутри.
Нужен, чтобы опубликовать превью приложения как страницу claude.ai и открыть его в браузере.
В Telegram используется обычный index.html, этот файл туда не идёт.

Запуск: python3 tools/build_preview.py
"""
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent
html = (ROOT / "index.html").read_text(encoding="utf-8")


def block(name):
    m = re.search(rf"<!--BUILD:{name}-->(.*?)<!--/BUILD:{name}-->", html, re.S)
    return m.group(1).strip()


head = block("HEAD").replace(
    '<link rel="stylesheet" href="style.css">',
    "<style>\n" + (ROOT / "style.css").read_text(encoding="utf-8") + "\n</style>",
)
body = block("BODY")
scripts = "\n".join(
    "<script>\n" + (ROOT / "js" / f).read_text(encoding="utf-8") + "\n</script>"
    for f in ["words.js", "core.js", "storage.js", "app.js"]
)

out = ROOT / "dist" / "preview.html"
out.parent.mkdir(exist_ok=True)
out.write_text(head + "\n" + body + "\n" + scripts + "\n", encoding="utf-8")
print(f"Готово: {out} ({out.stat().st_size // 1024} КБ)")
