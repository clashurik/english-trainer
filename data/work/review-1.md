# Review 1 — core, words-A1-1..3, words-A2-1..3

Files: core.json (120), words-A1-1 (83), words-A1-2 (83), words-A1-3 (83), words-A2-1 (104), words-A2-2 (104), words-A2-3 (102) = 679 cards.

## Passes
- Mechanical pass (irr / pos v / forms / notes): 679 cards. 3 ex per card everywhere, no unknown fields. No irregular verb is missing `irr`; all V2|V3 forms are correct.
- Automated check (word present in each example, 5–14 words): 679 cards. Only short 3–4-word A1 lines in core.json fell outside the range. They are natural, so I left them.
- Close reading (random.seed(7), 30% per file): 206 cards (core 36, A1-1 25, A1-2 25, A1-3 25, A2-1 32, A2-2 32, A2-3 31).

## Changes (21 changes on 21 cards)

### Translation (1)
- brilliant: ru listed "яркий", but no example shows that meaning and it is rare at A2 → "блестящий, замечательный, отличный"

### Examples (7)
- style: ex3 "This hairstyle doesn't suit me." used "hairstyle", not "style" → "This jacket comes in three different styles." / "Эта куртка бывает трёх разных фасонов."
- clean: ex3 "Sorry, these towels in the bathroom aren't clean." sounded unnatural → "Excuse me, the towels in our room aren't clean." / "Извините, полотенца в нашем номере несвежие."
- correct: ex1 "Is this your correct email address?" sounded unnatural → "Is this email address correct?"
- adult: ex3 "As an adult, I finally enjoy vegetables." was an odd sentence → "Adults need about eight hours of sleep."
- suitable: ex2 was translated as "удобную обувь" (comfortable) → "обувь, подходящую для ходьбы"
- birthday: ex2 "When is your birthday this year — on a weekend?" was awkward → "When's your birthday? Is it in May?"
- child: ex1 "Every child loves holidays." was a childish textbook line → "Their child is only two years old."

### Forms (9)
- wonderful: wonder/v "интересоваться" is the wrong meaning for this family → wonder/n "чудо, удивление"
- wash: "washing machine" is a compound, not a word-family member → washing/n "стирка; бельё (для стирки)"
- slow: "slow down" (ph) is a phrasal verb, not a derived word → removed
- slowly: same "slow down" (ph) → removed
- life: lifelong "пожизненный" (legal/penal sense) → "на всю жизнь, давний"
- law: "legal" has a different root (Latin lex) → removed
- thought / meaning / beginning: the verb translations contained irr forms in brackets ("(thought|thought)" etc.) → plain translations "думать", "значить, иметь в виду", "начинать"

### Notes (4)
- fruit: "some fruit (не fruits)" wrongly implied "fruits" is an error → "обычно неисчисляемое: I eat a lot of fruit; fruits — только о разных видах фруктов"
- apartment: "апартаменты — тоже apartment" was confusing → removed that clause
- thirsty: "(не I want to drink)" — that phrase is not wrong → "так естественнее, чем I want to drink"
- worried: "не worried for" is not true ("worried for someone" exists) → "worried about something/someone — волноваться о чём-то/ком-то"

### irr (0)
No changes needed.

## Validation
All 7 files load as valid JSON (ensure_ascii=False, indent=2). The `en` lists and their order are unchanged, and every card still has exactly 3 examples.
