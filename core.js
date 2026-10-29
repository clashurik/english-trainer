/*
 * core.js — «мозг» приложения: интервальное повторение (SRS), очередь на день,
 * серия дней и статистика. Здесь нет ничего про экран, только чистая логика,
 * поэтому этот файл можно проверять автоматическими тестами (см. tests/core.test.js).
 *
 * Как устроена карточка (состояние одного слова):
 *   r — сколько раз подряд вы вспомнили слово (repetitions)
 *   i — текущий интервал в днях (через сколько дней показать снова)
 *   e — «лёгкость» слова ×100 (ease). 250 = интервал растёт в 2,5 раза
 *   d — номер дня, когда слово пора повторить (due)
 *   l — сколько раз слово было забыто (lapses)
 */
(function (root) {
  'use strict';

  var DAY_MS = 86400000;
  var MIN_EASE = 130;
  var MAX_INTERVAL = 365;
  var LEARNED_INTERVAL = 21; // слово «выучено», если следующий показ не раньше чем через 3 недели

  // Номер текущего дня по местному времени (а не по UTC), чтобы день менялся в полночь.
  function dayNumber(now) {
    now = now || new Date();
    return Math.floor((now.getTime() - now.getTimezoneOffset() * 60000) / DAY_MS);
  }

  function newCard(day) {
    return { r: 0, i: 0, e: 250, d: day, l: 0 };
  }

  /*
   * Главная функция SRS. Оценки:
   *   1 — «Забыл»: слово начинается заново и вернётся ещё в этом же занятии
   *   2 — «Трудно»: интервал растёт медленно, лёгкость снижается
   *   3 — «Хорошо»: обычный рост интервала
   *   4 — «Легко»: интервал растёт быстрее, лёгкость повышается
   * Это упрощённый вариант алгоритма SM-2, на котором много лет работает Anki.
   */
  function schedule(card, grade, day) {
    var c = { r: card.r, i: card.i, e: card.e, d: card.d, l: card.l };

    if (grade === 1) {
      c.l += 1;
      c.r = 0;
      c.i = 0;
      c.e = Math.max(MIN_EASE, c.e - 20);
      c.d = day;
      return c;
    }

    var next;
    if (c.r === 0) {
      next = grade === 4 ? 4 : 1;
    } else if (c.r === 1) {
      next = grade === 2 ? 2 : grade === 3 ? 3 : 6;
    } else {
      var factor = c.e / 100;
      if (grade === 2) next = c.i * 1.2;
      else if (grade === 3) next = c.i * factor;
      else next = c.i * factor * 1.3;
      next = Math.max(c.i + 1, Math.round(next));
    }

    if (grade === 2) c.e = Math.max(MIN_EASE, c.e - 15);
    if (grade === 4) c.e = c.e + 15;

    c.i = Math.min(MAX_INTERVAL, next);
    c.r += 1;
    c.d = day + c.i;
    return c;
  }

  // Подписи на кнопках: через сколько дней слово вернётся при каждой оценке.
  function preview(card, day) {
    var out = {};
    for (var g = 1; g <= 4; g++) out[g] = schedule(card, g, day).i;
    return out;
  }

  /*
   * Очередь на сегодня: сначала слова, которым пришёл срок, затем новые.
   * Новые берутся только из выбранных уровней, по порядку списка (от частых к редким).
   */
  /*
   * meta.priority — слова, которые вы сами добавили из словаря. Они идут первыми
   * и сверх дневной нормы новых слов: вы выбрали их сознательно.
   */
  function buildQueue(words, cards, settings, meta, day) {
    var due = [];
    var fresh = [];
    var newDoneToday = meta.newDay === day ? meta.newDone : 0;
    var newLeft = Math.max(0, settings.newPerDay - newDoneToday);
    var levels = settings.levels;
    var known = {};
    words.forEach(function (w) { known[w.id] = true; });
    var priority = (meta.priority || []).filter(function (id) { return known[id] && !cards[id]; });
    var isPriority = {};
    priority.forEach(function (id) { isPriority[id] = true; });
    var regular = [];

    for (var k = 0; k < words.length; k++) {
      var w = words[k];
      var c = cards[w.id];
      if (c) {
        if (c.d <= day) due.push(w.id);
      } else if (!isPriority[w.id] && regular.length < newLeft && levels.indexOf(w.lvl) !== -1) {
        regular.push(w.id);
      }
    }
    fresh = priority.concat(regular);

    due.sort(function (a, b) { return cards[a].d - cards[b].d; });
    return { due: due.slice(0, 150), fresh: fresh, priority: priority };
  }

  // Смешиваем: после каждых трёх повторений одно новое слово, чтобы занятие не было монотонным.
  // lead — слова, которые идут в самом начале (добавленные из словаря)
  function mixQueue(due, fresh, lead) {
    var out = (lead || []).slice();
    var di = 0, fi = 0;
    while (di < due.length || fi < fresh.length) {
      for (var n = 0; n < 3 && di < due.length; n++) out.push(due[di++]);
      if (fi < fresh.length) out.push(fresh[fi++]);
    }
    return out;
  }

  // Серия дней: занимались вчера — серия растёт, пропустили — начинается заново.
  function completeDay(meta, day) {
    var m = Object.assign({}, meta);
    if (m.lastDone === day) return m;
    m.streak = m.lastDone === day - 1 ? (m.streak || 0) + 1 : 1;
    m.best = Math.max(m.best || 0, m.streak);
    m.lastDone = day;
    return m;
  }

  function currentStreak(meta, day) {
    if (meta.lastDone === day || meta.lastDone === day - 1) return meta.streak || 0;
    return 0;
  }

  function stats(words, cards) {
    var byLevel = {};
    var learned = 0, learning = 0;
    for (var k = 0; k < words.length; k++) {
      var w = words[k];
      var lv = byLevel[w.lvl] || (byLevel[w.lvl] = { total: 0, seen: 0, learned: 0 });
      lv.total += 1;
      var c = cards[w.id];
      if (!c) continue;
      lv.seen += 1;
      if (c.i >= LEARNED_INTERVAL) { lv.learned += 1; learned += 1; }
      else learning += 1;
    }
    return { total: words.length, learned: learned, learning: learning, byLevel: byLevel };
  }

  /*
   * Свободная тренировка: какие слова в неё попадут.
   *   set:    'studied' — уже встречались, 'hard' — были ошибки или слово даётся тяжело,
   *           'lessons' — слова из уроков, 'all' — весь словарь
   *   levels: какие уровни брать (для 'lessons' не учитывается)
   *   kind:   'all' | 'words' (без фраз) | 'phrases' (только фразы)
   */
  function practicePool(words, cards, opts) {
    var out = [];
    for (var k = 0; k < words.length; k++) {
      var w = words[k];
      var c = cards[w.id];
      if (opts.set === 'studied' && !c) continue;
      if (opts.set === 'hard' && !(c && (c.l > 0 || c.e < 250))) continue;
      if (opts.set === 'lessons' && w.lvl !== 'MY') continue;
      if (opts.set !== 'lessons' && opts.levels && opts.levels.indexOf(w.lvl) === -1) continue;
      if (opts.kind === 'words' && w.pos === 'ph') continue;
      if (opts.kind === 'phrases' && w.pos !== 'ph') continue;
      out.push(w.id);
    }
    return out;
  }

  // Перемешивание (алгоритм Фишера — Йетса). rnd можно подменить в тестах.
  function shuffle(arr, rnd) {
    rnd = rnd || Math.random;
    var a = arr.slice();
    for (var k = a.length - 1; k > 0; k--) {
      var j = Math.floor(rnd() * (k + 1));
      var t = a[k]; a[k] = a[j]; a[j] = t;
    }
    return a;
  }

  /*
   * Разбор списка слов из урока. Одна строка — одно слово:
   *   слово | перевод | пример | перевод примера
   * Пример и его перевод необязательны. Вместо | можно использовать табуляцию.
   * Строки, начинающиеся с #, пропускаются (это комментарии).
   */
  function parseImport(text, existingIds) {
    var seen = {};
    var result = { words: [], skipped: [], bad: [] };
    String(text).split(/\r?\n/).forEach(function (line) {
      var s = line.trim();
      if (!s || s.charAt(0) === '#') return;
      s = s.replace(/^[-*•\d.)\s]+(?=[A-Za-z])/, ''); // убираем маркеры списка: «- », «1. »
      var parts = s.split(/\s*[|\t]\s*/);
      if (parts.length < 2 || !parts[0] || !parts[1]) { result.bad.push(line.trim()); return; }
      var en = parts[0].trim();
      var id = en.toLowerCase();
      if ((existingIds && existingIds[id]) || seen[id]) { result.skipped.push(en); return; }
      seen[id] = true;
      var ex = (parts[2] || '').trim();
      result.words.push({
        id: id, en: en, ru: parts[1].trim(), pos: /\s/.test(en) ? 'ph' : '', lvl: 'MY',
        ex: ex ? [[ex, (parts[3] || '').trim()]] : [], forms: [], gram: [], irr: null, note: ''
      });
    });
    return result;
  }

  /*
   * Слова из уроков, сохранённые версией 1.1.0, хранили один пример строкой (ex + exRu).
   * Приводим их к новому виду: ex — список пар [пример, перевод].
   */
  function normalizeCustom(w) {
    if (Array.isArray(w.ex)) return Object.assign({ forms: [], gram: [], irr: null, note: '' }, w);
    var ex = w.ex ? [[w.ex, w.exRu || '']] : [];
    return { id: w.id, en: w.en, ru: w.ru, pos: w.pos || '', lvl: 'MY', ex: ex, forms: [], gram: [], irr: null, note: '' };
  }

  // Общий список слов: сначала свои из уроков, потом словарь. Если слово есть и там и там, берём своё.
  function mergeWords(custom, base) {
    var mine = {};
    custom.forEach(function (w) { mine[w.id] = true; });
    return custom.concat(base.filter(function (w) { return !mine[w.id]; }));
  }

  // Какой пример показать: при каждом новом удачном повторе или ошибке — следующий по кругу
  function exampleIndex(card, count) {
    if (!count) return -1;
    return card ? (card.r + card.l) % count : 0;
  }

  // Сравнение версий вида 1.2.0: −1, 0 или 1
  function compareVersions(a, b) {
    var x = String(a).split('.'), y = String(b).split('.');
    for (var k = 0; k < 3; k++) {
      var d = (parseInt(x[k], 10) || 0) - (parseInt(y[k], 10) || 0);
      if (d) return d < 0 ? -1 : 1;
    }
    return 0;
  }

  /*
   * Что показать в окне «Что нового»:
   *   новый пользователь (нет прогресса) — ничего;
   *   знаем, какую версию человек видел, — всё, что вышло после неё;
   *   прогресс есть, а версия неизвестна (заходил до 1.2.0) — только последнюю версию.
   */
  function whatsNew(changelog, seenVersion, hasProgress) {
    if (!changelog.length) return [];
    if (seenVersion) return changelog.filter(function (e) { return compareVersions(e.v, seenVersion) > 0; });
    return hasProgress ? [changelog[0]] : [];
  }

  /*
   * Все написания слова, по которым его можно найти в примере:
   * само слово, формы неправильного глагола (felt, found) и грамматические формы (children, tried).
   */
  function wordVariants(w) {
    var out = [w.en];
    if (w.irr) w.irr.split('|').forEach(function (p) { p.split('/').forEach(function (x) { out.push(x); }); });
    (w.gram || []).forEach(function (g) { if (g[0]) out.push(g[0]); });
    return out;
  }

  var PLACEHOLDER = /\b(sb|sth|someone|something|one's|oneself)\b/gi;
  var FILLER = /^(a|an|the|my|your|his|her|its|our|their|be|is|am|are|was|were|been|being)$/i;
  var GAP = "(?:\\s+[\\w']+){0,3}?\\s+"; // между словами фразы — до трёх других слов
  function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  /*
   * Где в примере стоит слово: {start, end} или null.
   * 1) Точное совпадение с любой формой. В фразах между словами допускается до двух слов,
   *    чтобы находить разделённые фразовые глаголы: turn down → «turned the offer down».
   * 2) Если не нашлось — поиск по основе слова (decide → decided, try → tries).
   */
  function findWord(example, variants) {
    // Служебные слова внутри фраз часто меняются (make a mistake → makes mistakes, your mind → my mind,
    // be late → I'm late), поэтому в фразах из нескольких слов их не ищем.
    var split = function (v) { return v.replace(/[?!.,]/g, ' ').replace(PLACEHOLDER, ' ').trim().split(/\s+/).filter(Boolean); };
    var noFiller = function (t) {
      var core = t.filter(function (x) { return !FILLER.test(x); });
      return t.length > 1 && core.length && core.length < t.length ? core : null;
    };
    // Пропускать слова внутри можно только во фразах (turn the TV on). У форм одного слова
    // (most aware, more expensive) пропусков нет, иначе подсветится полпредложения.
    var isPhrase = split(variants[0] || '').length > 1;
    var gap = isPhrase ? GAP : '\\s+';
    var base = split(variants[0] || '');  // начальная форма — для поиска по основе
    var full = variants.map(split).filter(function (t) { return t.length; });
    full.sort(function (a, b) { return b.join(' ').length - a.join(' ').length; });
    // Сначала фраза целиком (Here you are), потом без служебных слов (make a mistake → makes mistakes)
    var list = full.concat(full.map(noFiller).filter(Boolean));

    for (var k = 0; k < list.length; k++) {
      var re = new RegExp("(^|[^\\w'])(" + list[k].map(escapeRe).join(gap) + ")(?![\\w])", 'i');
      var m = re.exec(example);
      if (m) {
        var start = m.index + m[1].length;
        return { start: start, end: start + m[2].length };
      }
    }

    if (!base.length) return null;
    var baseCore = noFiller(base) || base;
    var parts = baseCore.map(function (p) {
      var stem = p.length > 2 ? p.replace(/(e|y)$/i, '') : p;
      return escapeRe(stem) + "[\\w']*";
    });
    var m2 = new RegExp("(^|[^\\w'])(" + parts.join(gap) + ")", 'i').exec(example);
    if (!m2) return null;
    var s2 = m2.index + m2[1].length;
    return { start: s2, end: s2 + m2[2].length };
  }

  // ---------- Режим ввода ответа ----------

  /*
   * Приводим ответ к простому виду, чтобы не придираться к мелочам:
   * регистр, знаки препинания, апострофы, «to» перед глаголом, артикль в начале,
   * сокращения (whats = what's = what is, dont = don't = do not, id like = I'd like = I would like).
   * slots = true: sb/sth и притяжательные слова во фразах (your, my) превращаются в метку SLOT —
   * на её месте в ответе может стоять до трёх любых слов (look after him, make up my mind).
   */
  var SLOT = 'zqslotz';
  var CONTRACTIONS = {
    dont: 'do not', doesnt: 'does not', didnt: 'did not', isnt: 'is not', arent: 'are not', wasnt: 'was not',
    werent: 'were not', havent: 'have not', hasnt: 'has not', hadnt: 'had not', wouldnt: 'would not',
    couldnt: 'could not', shouldnt: 'should not', cant: 'cannot', wont: 'will not', im: 'i am', ive: 'i have',
    id: 'i would', youre: 'you are', theyre: 'they are', youve: 'you have', youll: 'you will', theyll: 'they will',
    whats: 'what is', thats: 'that is', its: 'it is', theres: 'there is', heres: 'here is', hes: 'he is',
    shes: 'she is', whos: 'who is', wheres: 'where is', hows: 'how is'
  };

  function normalizeAnswer(s, slots) {
    var t = String(s || '').toLowerCase().replace(/[’`´']/g, '');
    t = t.replace(PLACEHOLDER, slots ? ' ' + SLOT + ' ' : ' ');
    t = t.replace(/[^a-z0-9 -]/g, ' ').replace(/-/g, ' ').replace(/\s+/g, ' ').trim();
    if (slots && t.indexOf(' ') !== -1) t = t.replace(/\b(my|your|his|her|their|our)\b/g, SLOT);
    t = t.split(' ').map(function (x) { return CONTRACTIONS[x] || x; }).join(' ');
    t = t.replace(/ can not\b/g, ' cannot');
    t = t.replace(/^to (?=\S)/, '').replace(/^(a|an|the) (?=\S)/, '');
    return t;
  }

  // Ответ подходит к слову: точное совпадение, а во фразах со SLOT на его месте — до трёх любых слов
  function matchesTarget(a, en) {
    var withSlots = normalizeAnswer(en, true);
    if (withSlots.indexOf(SLOT) === -1) return a === withSlots;
    var src = (' ' + withSlots).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(new RegExp(' ' + SLOT, 'g'), '(?: \\S+){0,3}');
    return new RegExp('^' + src + '$').test(' ' + a);
  }

  // Расстояние Левенштейна: сколько букв надо вставить, удалить или заменить
  function editDistance(a, b) {
    var prev = [], cur, k, j;
    for (j = 0; j <= b.length; j++) prev[j] = j;
    for (k = 1; k <= a.length; k++) {
      cur = [k];
      for (j = 1; j <= b.length; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a.charAt(k - 1) === b.charAt(j - 1) ? 0 : 1));
      }
      prev = cur;
    }
    return prev[b.length];
  }

  /*
   * Проверка напечатанного ответа. Результат:
   *   'empty' — ничего не введено
   *   'ok'    — верно
   *   'typo'  — опечатка: одна буква (в длинных словах — две)
   *   'alt'   — это другое слово с похожим переводом (synonyms — список таких слов)
   *   'wrong' — неверно
   * known — все слова словаря (нормализованные) как объект: если ответ — другое настоящее слово
   * (honey вместо money), это не опечатка, а ошибка.
   */
  function checkAnswer(input, w, synonyms, known) {
    var a = normalizeAnswer(input);
    if (!a) return 'empty';
    var targets = [w.en].concat(showVariants(w));
    for (var t = 0; t < targets.length; t++) if (matchesTarget(a, targets[t])) return 'ok';
    var alts = (synonyms || []).map(function (x) { return normalizeAnswer(x); });
    if (alts.indexOf(a) !== -1) return 'alt';
    if (known && known[a]) return 'wrong';
    var target = normalizeAnswer(w.en);
    var limit = target.length >= 9 ? 2 : target.length >= 4 ? 1 : 0;
    if (limit && editDistance(a, target) <= limit) return 'typo';
    return 'wrong';
  }

  // Поле show: как показывать слово, если en в одиночку звучит неестественно (lot → a lot / a lot of).
  // Варианты через « / » — все принимаются как верный ответ; прогресс по-прежнему привязан к en.
  function showVariants(w) { return w && w.show ? String(w.show).split(' / ') : []; }
  function label(w) { return w && w.show ? w.show : w.en; }
  function sayText(w) { return showVariants(w)[0] || w.en; }

  // Подсказка: первая буква каждого слова, остальные буквы — подчёркивания. look after → l___ a____
  function answerHint(en) {
    return String(en).replace(PLACEHOLDER, '…').replace(/[A-Za-z][A-Za-z'’]*/g, function (word) {
      return word.charAt(0) + word.slice(1).replace(/[A-Za-z]/g, '_');
    }).replace(/\s+/g, ' ').trim();
  }

  // ---------- Поиск по словарю ----------
  function normSearch(s) { return String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[’`]/g, "'").replace(/\s+/g, ' ').trim(); }

  /*
   * Ищет и по-английски, и по-русски. Сначала точные совпадения, потом начало слова, потом вхождение.
   * Возвращает { ids: первые limit найденных, total: сколько всего }.
   */
  function searchWords(words, query, limit) {
    var q = normSearch(query);
    if (!q) return { ids: [], total: 0 };
    var hits = [];
    words.forEach(function (w, idx) {
      var en = normSearch(w.en);
      var ru = normSearch(w.ru);
      var ruParts = ru.split(/[,;()/]+/).map(function (x) { return x.trim(); });
      var score = -1;
      if (en === q) score = 0;
      else if (ruParts.indexOf(q) !== -1) score = 1;
      else if (en.indexOf(q) === 0) score = 2;
      else if ((' ' + en).indexOf(' ' + q) !== -1) score = 3;
      else if (ruParts.some(function (p) { return p.indexOf(q) === 0 || p.indexOf(' ' + q) !== -1; })) score = 4;
      else if (en.indexOf(q) !== -1) score = 5;
      else if (ru.indexOf(q) !== -1) score = 6;
      if (score >= 0) hits.push([score, idx, w.id]);
    });
    hits.sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
    return { ids: hits.slice(0, limit || 30).map(function (h) { return h[2]; }), total: hits.length };
  }

  // ---------- Резервная копия ----------
  var BACKUP_APP = 'english-trainer';

  function makeBackup(state, version, now) {
    return {
      app: BACKUP_APP, format: 2, version: version || '', saved: (now || new Date()).toISOString(),
      cards: packCards(state.cards), custom: state.custom || [], meta: state.meta
    };
  }

  // Формат 2 короче: вместо {"r":1,"i":1,"e":250,"d":20752,"l":0} — [1,1,250,20752,0]
  var CARD_KEYS = ['r', 'i', 'e', 'd', 'l'];
  function packCards(cards) {
    var out = {};
    Object.keys(cards).forEach(function (id) { var c = cards[id]; out[id] = CARD_KEYS.map(function (k) { return c[k]; }); });
    return out;
  }
  function unpackCard(c) {
    if (!Array.isArray(c)) return c;
    var o = {};
    CARD_KEYS.forEach(function (k, n) { o[k] = c[n]; });
    return o;
  }

  function isCard(c) {
    return c && typeof c === 'object' && ['r', 'i', 'e', 'd', 'l'].every(function (k) { return typeof c[k] === 'number' && isFinite(c[k]); });
  }

  /*
   * Разбор копии из файла или вставленного текста. Возвращает
   *   { ok: true, state: {cards, custom, meta}, info: {cards, learned, streak, best, custom, saved} }
   *   или { ok: false, error: 'понятное объяснение' }.
   */
  function parseBackup(text) {
    var data;
    try { data = JSON.parse(String(text || '').trim()); } catch (e) {
      return { ok: false, error: 'Это не похоже на резервную копию: текст повреждён или скопирован не целиком.' };
    }
    if (!data || data.app !== BACKUP_APP || typeof data.cards !== 'object' || !data.cards || typeof data.meta !== 'object' || !data.meta) {
      return { ok: false, error: 'Это не резервная копия English Trainer.' };
    }
    var cards = {}, bad = 0, learned = 0;
    Object.keys(data.cards).forEach(function (id) {
      var c = unpackCard(data.cards[id]);
      if (!isCard(c)) { bad += 1; return; }
      cards[id] = { r: c.r, i: c.i, e: c.e, d: c.d, l: c.l };
      if (c.i >= LEARNED_INTERVAL) learned += 1;
    });
    if (bad) return { ok: false, error: 'В копии повреждены записи о ' + bad + ' словах. Попробуйте другой файл.' };
    var custom = Array.isArray(data.custom) ? data.custom.filter(function (w) { return w && w.id && w.en && w.ru; }).map(normalizeCustom) : [];
    var meta = data.meta;
    if (meta.settings !== undefined && (typeof meta.settings !== 'object' || !meta.settings)) delete meta.settings;
    return {
      ok: true,
      state: { cards: cards, custom: custom, meta: meta },
      info: {
        cards: Object.keys(cards).length, learned: learned, custom: custom.length,
        streak: meta.streak || 0, best: meta.best || 0, lastDone: meta.lastDone, saved: data.saved || '', version: data.version || ''
      }
    };
  }

  var Core = {
    normalizeAnswer: normalizeAnswer,
    editDistance: editDistance,
    checkAnswer: checkAnswer,
    label: label,
    sayText: sayText,
    answerHint: answerHint,
    searchWords: searchWords,
    makeBackup: makeBackup,
    parseBackup: parseBackup,
    wordVariants: wordVariants,
    findWord: findWord,
    normalizeCustom: normalizeCustom,
    mergeWords: mergeWords,
    exampleIndex: exampleIndex,
    compareVersions: compareVersions,
    whatsNew: whatsNew,
    practicePool: practicePool,
    shuffle: shuffle,
    parseImport: parseImport,
    dayNumber: dayNumber,
    newCard: newCard,
    schedule: schedule,
    preview: preview,
    buildQueue: buildQueue,
    mixQueue: mixQueue,
    completeDay: completeDay,
    currentStreak: currentStreak,
    stats: stats,
    LEARNED_INTERVAL: LEARNED_INTERVAL
  };

  root.Core = Core;
  if (typeof module !== 'undefined' && module.exports) module.exports = Core;
})(typeof window !== 'undefined' ? window : globalThis);
