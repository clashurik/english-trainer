Task for the Proofreader (role: /home/claude/english-trainer/.claude/agents/proofreader.md; spec: data/SPEC.md, section «Грамматические формы (`gram`)»).

The `gram` field was just added to every card by other agents. Check it in the files named in your assignment:
1. Mechanical pass over ALL cards: print every card as `en | pos | irr | gram` and judge each line. Look for: misspelled forms (stopping, planning, travelled, tried, studies, lying), wrong comp/sup (gooder, more big, the bigger), nouns marked unc that are countable (or the reverse), missing forms the rules require, irregular verbs treated as regular (or V2/V3 duplicated in gram), phrases whose verb part is inflected wrongly, notes in the 3rd element that are wrong or not in Russian.
2. Also check `forms` entries that were added recently (the Lexicographers mentioned e.g. hard → hardly, especially → special, busy → business, fear → fear): a forms entry must be a real word-family member whose meaning is clearly related; remove misleading ones (hardly ≠ "твёрдо/трудно").
3. Fix directly in the JSON (never change `en` or card order; ensure_ascii=False, indent=2), then run `python3 tools/build_words.py` ONLY AT THE VERY END and only if your assignment says so — otherwise don't run it.
4. Report to the file named in your assignment: what you checked and a list of changes `word: was → now`.
Reply with one line: cards checked, changes made by kind.
