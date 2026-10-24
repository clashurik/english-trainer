# Проверка `gram` и `forms` — партия 1

Файлы: core.json (120), words-A1-1 (83), words-A1-2 (83), words-A1-3 (83), words-A2-1 (104), words-A2-2 (104), words-A2-3 (102). Всего 679 карточек.

## Что проверено
- Все 679 карточек просмотрены построчно в виде `en | pos | irr | gram | ru | forms`.
- Орфография форм (stopping, travelling/travelled, tries/tried, studies, preferring, regretting, admitting, agreeing и т. п.): ошибок нет.
- comp/sup: ошибок вроде gooder / more big нет; good→better/the best, bad→worse/the worst, little→less/the least (с уточнением), good-looking→better-looking.
- Неправильные глаголы: у всех есть `irr`, V2/V3 в `gram` не дублируются; у правильных есть `pastpp`.
- Фразы: формы глагольной части верные (get up → got up, take part in → took/taken part in, look forward to → looked forward to и т. д.).
- unc/pl: ошибок не найдено; двойные случаи (coffee, tea, fruit, cheese, experience, weight, law, quality и др.) снабжены уточнениями по-русски.
- Недавние `forms`: hard ↔ hardly, special ↔ especially, busy → business, fear → fear (v) и остальные.

## Правки
- hard (words-A1-1): в forms было hardly «едва, почти не» — не наречие от hard по смыслу, вводит в заблуждение → удалено.
- hardly (words-A2-2): в forms было hard «трудный; твёрдый» — то же самое → удалено.
- quickly (words-A1-3): sup «the most quickly» (у наречия артикль the не ставится) → «most quickly» (как у recently).
- badly (words-A2-2): sup «the worst» → «worst» (наречие: He played worst).
- room (words-A1-3): уточнение «= место — неисч.: no room» читалось как будто rooms = «место» → «„место“ — неисч.: no room».

## Проверено и оставлено
- special ↔ especially: однокоренные, смысл явно связан (особый → особенно).
- busy → business: исторически busy + -ness («занятость» → «дело»), связь объяснима — оставлено.
- fear → fear (v), head/hand/joke → v: та же основа, другая часть речи, по правилам SPEC.
- conduct → conductor: однокоренное (conduct также «дирижировать») — оставлено.
- people → peoples (pl) с уточнением «peoples = народы» — корректно.

Итого: 679 карточек, 5 правок (forms — 2, gram sup — 2, уточнение в gram — 1). JSON валиден, список и порядок `en` не изменились. build_words.py не запускался.
