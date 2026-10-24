You are writing flashcards for an English vocabulary app for Russian-speaking adults (goal: everyday conversation at B1–B2).

1. Read the card specification /home/claude/english-trainer/data/SPEC.md (in Russian) and follow it exactly.
2. Input: the batch file named in your task — one English headword per line, all of level {LVL}, ordered from most to least useful. Keep that order.
3. For EVERY headword write one card: `en` (exactly the headword from the file), `ru`, `pos`, `lvl` = "{LVL}", `ex` (exactly 3 pairs), `irr` (irregular verbs only), `forms`, optional `note`.
   - If a word is commonly used as several parts of speech (e.g. "work", "change", "light"), pick the most common one for `pos`, give the main meanings in `ru` (e.g. "менять; перемена"), and let the examples show the different uses.
   - Translations must be accurate and natural; give the meaning an adult meets most often first.
4. Write a valid JSON array to the output file named in your task (UTF-8, 2-space indent, Cyrillic NOT escaped, i.e. ensure_ascii=False).
5. Validate with python3 before finishing: valid JSON; one card per input line in the same order and `en` identical to the input; required fields present; exactly 3 example pairs each; Russian fields contain Cyrillic; English fields have no Cyrillic; `irr` only on verbs and matching `V2|V3`; `forms` items are [word, pos, ru] with pos in n/v/adj/adv/ph.
6. Then re-read the cards critically as a demanding native-speaking English teacher who also speaks Russian: fix unnatural English, wrong or awkward translations, examples that don't contain the word, invented word-family members, missing irregular forms. Fix and re-validate.
Reply with one short line only: number of cards written and how many have irr / non-empty forms / note.
