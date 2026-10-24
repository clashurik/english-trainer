# Проверка `gram` и `forms` — Корректор, партия 2

Файлы: `words-B1-1.json` (107), `words-B1-2.json` (107), `words-B1-3.json` (106), `words-B2-1.json` (100), `phrases.json` (120). Всего 540 карточек.

## Что проверено
1. Механический проход по всем 540 карточкам: `en | pos | irr | gram || forms`.
   - Орфография форм (удвоение согласной: cancelling, committing, occurring, betting, grabbing, cutting; -y → -ies/-ied: relies, denies, clarifies, justifies, hurried; -ie/-ee: guaranteeing). Ошибок нет.
   - comp/sup: односложные и на -y через -er/-est (prouder, tinier, guiltier, trickier, odder, keener, tougher, calmer, weirder), длинные через more/the most. Ошибок нет.
   - pl/unc: неисчисляемые (equipment, luggage, insurance, advice-тип, data, feedback, relief, nonsense и т. д.) и двойные случаи с уточнением (debt, pain, failure, demand, depression, criticism, investment, property). Ошибок нет; уточнения по-русски.
   - Неправильные глаголы (prove, bet, forgive, hang, overcome, misunderstand) — V2/V3 только в `irr`, в `gram` не дублируются; среди глаголов с `pastpp` неправильных нет.
   - Фразы: глагольная часть склоняется верно (woke/woken up, sat down, got along with, dealt with, fell out with, shown up и т. д.); выражения без глагола и готовые реплики — `[]`.
   - Несравниваемые прилагательные (main, legal, digital, entire, exhausted, shocked, vital, constant…) — `[]`.
2. Проверены все `forms` на предмет связи по смыслу (тип hard → hardly, busy → business).
3. Проверка подсветки: в каждом примере однословных карточек есть `en` или форма из `gram`/`irr` — расхождений нет. У фразовых глаголов с разрывом (turn the TV on, call you back, cheer her up) подсветка по целой фразе невозможна — это особенность фраз, а не ошибка `gram` (сообщаю для сведения).

## Правки
- ignore (B1-1): forms ignorance «незнание, невежество», ignorant «невежественный» — значение не связано с «игнорировать», вводит в заблуждение → удалены, forms = [].
- current (B1-1): forms currency «валюта» — по смыслу не связано с «текущий/течение» → удалено (оставлено currently).
- lately (B1-2): forms late «поздний» — ложная связь (lately ≠ поздно; об этом уже есть note) → удалено, forms = [].

Правок в `gram`: 0. Правок в `forms`: 3 карточки (4 записи).

Замечание вне задачи: у `current` pos = adj, но в `ru` и третьем примере — существительное «течение»; стоит решить Лексикографу.

Все файлы — валидный JSON, список и порядок `en` не изменены, в каждом `ex` по 3 пары. `build_words.py` не запускался.
