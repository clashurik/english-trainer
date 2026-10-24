"""Собирает dist/preview.html — один файл со всеми стилями и скриптами внутри.
Нужен, чтобы опубликовать превью приложения как страницу claude.ai и открыть его в браузере.
В Telegram используется обычный index.html, этот файл туда не идёт.

Заодно проверяет, что номер версии в index.html (?v=…) совпадает с changelog.js.
Запуск: python3 tools/build_preview.py
"""
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
html = (ROOT / "index.html").read_text(encoding="utf-8")

# Проверка версии: если забыть поменять ?v=, Telegram может показать старые файлы
version = re.search(r"v: '(\d+\.\d+\.\d+)'", (ROOT / "changelog.js").read_text(encoding="utf-8")).group(1)
used = set(re.findall(r'\?v=([\d.]+)"', html))
if used != {version}:
    sys.exit(f"Версия в index.html {sorted(used)} не совпадает с changelog.js ({version}). Поменяйте все ?v=… на ?v={version}")


def block(name):
    m = re.search(rf"<!--BUILD:{name}-->(.*?)<!--/BUILD:{name}-->", html, re.S)
    return m.group(1).strip()


head = re.sub(
    r'<link rel="stylesheet" href="style\.css[^"]*">',
    lambda _: "<style>\n" + (ROOT / "style.css").read_text(encoding="utf-8") + "\n</style>",
    block("HEAD"),
)
body = block("BODY")
scripts = "\n".join(
    "<script>\n" + (ROOT / f).read_text(encoding="utf-8") + "\n</script>"
    for f in ["changelog.js", "words.js", "core.js", "storage.js", "app.js"]
)

out = ROOT / "dist" / "preview.html"
out.parent.mkdir(exist_ok=True)
out.write_text(head + "\n" + body + "\n" + scripts + "\n", encoding="utf-8")
print(f"Готово: {out} ({out.stat().st_size // 1024} КБ), версия {version}")
