Act as the Lexicographer: first read /home/claude/english-trainer/.claude/agents/lexicographer.md (your role) and /home/claude/english-trainer/data/SPEC.md, especially the section «Грамматические формы (`gram`)».

Task: add the `gram` field to EVERY card of the file named in your assignment, exactly per the spec:
- codes: pl, unc, s3, ing, pastpp, comp, sup; past/pp only inside phrases with an irregular verb; [] when nothing applies (non-gradable adjectives, adverbs without common comparison, fixed expressions without a verb).
- nouns: pl or unc (both uses → pl with a short Russian note). Regular verbs: s3, ing, pastpp. Irregular verbs (they have `irr`): s3 and ing only. Gradable adjectives: comp and sup ("the biggest", "the most expensive"). Phrases with a verb: inflect the verb part ("gave up" past, "given up" pp, "giving up" ing; "looked after" pastpp, "looking after" ing); if the phrase has sb/sth, keep them as in `en`.
- Spelling must be exactly right: stopping, planning, visiting, tried, studies, lying, dying, bigger, happier, the happiest.
- Do not change any other field. One exception: if `forms` is empty and a genuinely common word-family member of another part of speech exists, you may add it (never invent; inflections never go to forms).

Validate with python3: every card has `gram` (list of [form, code] or [form, code, note]); codes valid; nouns have pl or unc; regular verbs have s3+ing+pastpp; verbs with irr have no past/pp/pastpp; `en` list and order unchanged; still valid JSON (ensure_ascii=False, indent=2). Then reread all gram forms critically and fix mistakes.
Reply with one line: cards processed, how many got non-empty gram, how many forms you added.
