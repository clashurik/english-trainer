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
  /*
   * seed — число от id слова (seedOf): слегка сдвигает длинные интервалы (±5%),
   * чтобы слова, выученные в один день, не возвращались все разом.
   * Если слово повторили позже срока и всё равно вспомнили, просрочка засчитывается в интервал
   * (как в Anki): пропуски не наказывают двойной работой.
   */
  function schedule(card, grade, day, seed) {
    var c = { r: card.r, i: card.i, e: card.e, d: card.d, l: card.l };
    var late = c.r >= 2 ? Math.max(0, day - c.d) : 0;

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
      if (grade === 2) next = (c.i + late / 4) * 1.2;
      else if (grade === 3) next = (c.i + late / 2) * factor;
      else next = (c.i + late) * factor * 1.3;
      next = Math.max(c.i + 1, Math.round(next));
      if (seed != null && next >= 7) {
        var spread = Math.max(1, Math.round(next * 0.05));
        var frac = ((seed * 9301 + 49297 + c.r * 233) % 233280) / 233280;
        next = Math.max(c.i + 1, next + Math.round((frac * 2 - 1) * spread));
      }
    }

    if (grade === 2) c.e = Math.max(MIN_EASE, c.e - 15);
    if (grade === 4) c.e = c.e + 15;

    c.i = Math.min(MAX_INTERVAL, next);
    c.r += 1;
    c.d = day + c.i;
    return c;
  }

  // Подписи на кнопках: через сколько дней слово вернётся при каждой оценке.
  function preview(card, day, seed) {
    var out = {};
    for (var g = 1; g <= 4; g++) out[g] = schedule(card, g, day, seed).i;
    return out;
  }

  // Число от id слова для разброса интервалов (одно и то же у слова всегда)
  function seedOf(id) {
    var h = 0;
    for (var k = 0; k < id.length; k++) h = (h * 31 + id.charCodeAt(k)) % 100003;
    return h;
  }

  /*
   * Размер занятия: сколько максимум повторений и новых слов в день.
   * Всё, что не влезло, ждёт следующего дня (первыми идут самые «рискованные» слова).
   */
  var SIZES = {
    light: { rev: 20, fresh: 5 },
    normal: { rev: 40, fresh: 10 },
    intense: { rev: 80, fresh: 20 }
  };
  function sizeOf(settings) { return SIZES[settings.size] || SIZES.normal; }

  // Хорошо выученное слово (интервал от 3 недель): в режиме ввода проверяется быстро, «помню / не помню»
  function isQuick(card) { return !!(card && card.r >= 2 && card.i >= LEARNED_INTERVAL); }

  // Риск забыть: насколько слово просрочено относительно своего интервала, плюс трудность и ошибки
  function risk(c, day) {
    return (day - c.d + 1) / Math.max(1, c.i) + (c.e < 200 ? 0.5 : 0) + Math.min(c.l, 3) * 0.2;
  }

  /*
   * Доли новых слов по уровням после словарного теста.
   * vocab — сколько слов каждого уровня человек знает (0…1). Чем больше незнакомых, тем больше доля;
   * минимум 5%, чтобы базовые слова не пропадали совсем.
   */
  function levelWeights(vocab, levels) {
    var raw = {}, out = {}, MIN = 0.05;
    // «Рубеж» — первый уровень, где знакомо меньше 60% слов: его учить сейчас.
    // Каждый уровень выше рубежа получает вдвое меньше, чтобы новичку не сыпались слова B2.
    var front = -1;
    levels.forEach(function (lv, k) {
      var p = vocab && typeof vocab[lv] === 'number' ? vocab[lv] : null;
      raw[lv] = p === null ? 0.5 : Math.max(0.001, 1 - p);
      if (front < 0 && p !== null && p < 0.6) front = k;
      if (front >= 0 && k > front) raw[lv] *= Math.pow(0.5, k - front);
    });
    // Пропорционально незнакомым словам, но каждому уровню не меньше 5% занятия
    var floor = {}, changed = true;
    while (changed) {
      changed = false;
      var free = 1 - Object.keys(floor).length * MIN, sum = 0;
      levels.forEach(function (lv) { if (!floor[lv]) sum += raw[lv]; });
      levels.forEach(function (lv) {
        out[lv] = floor[lv] ? MIN : (sum ? raw[lv] / sum * free : 0);
        if (!floor[lv] && out[lv] < MIN && levels.length * MIN <= 1) { floor[lv] = true; changed = true; }
      });
    }
    return out;
  }

  // Разложить n мест по уровням пропорционально весам (метод наибольших остатков)
  function splitByWeights(n, weights) {
    var lv = Object.keys(weights), out = {}, used = 0;
    var rest = lv.map(function (l) { var x = n * weights[l]; out[l] = Math.floor(x); used += out[l]; return [x - out[l], l]; });
    rest.sort(function (a, b) { return b[0] - a[0]; });
    for (var k = 0; used < n && k < rest.length; k++, used++) out[rest[k][1]] += 1;
    return out;
  }

  /*
   * Очередь на сегодня.
   *   due      — повторения, самые рискованные первыми, не больше потолка размера занятия
   *   backlog  — сколько повторений не влезло и ждёт следующих дней
   *   fresh    — новые слова. Пока висит хвост повторений, новых меньше (вплоть до нуля):
   *              каждое новое слово — это будущие повторения
   *   priority — слова, которые человек сам добавил из словаря: первыми и сверх нормы
   * После словарного теста (meta.vocab) новые слова набираются по долям уровней,
   * иначе — по порядку списка, от простых к сложным.
   */
  function buildQueue(words, cards, settings, meta, day) {
    var size = sizeOf(settings);
    var revDone = meta.revDay === day ? (meta.revDone || 0) : 0;
    var revLeft = Math.max(0, (settings.revCap || size.rev) - revDone);
    var newDoneToday = meta.newDay === day ? meta.newDone : 0;
    var levels = settings.levels;
    var known = {};
    words.forEach(function (w) { known[w.id] = true; });
    var priority = (meta.priority || []).filter(function (id) { return known[id] && !cards[id]; });
    var isPriority = {};
    priority.forEach(function (id) { isPriority[id] = true; });

    var allDue = [], candidates = {};
    for (var k = 0; k < words.length; k++) {
      var w = words[k];
      var c = cards[w.id];
      if (c) {
        if (c.d <= day) allDue.push(w.id);
      } else if (!isPriority[w.id] && levels.indexOf(w.lvl) !== -1) {
        (candidates[w.lvl] = candidates[w.lvl] || []).push(w.id);
      }
    }
    allDue.sort(function (a, b) { return risk(cards[b], day) - risk(cards[a], day) || cards[a].d - cards[b].d; });
    var due = allDue.slice(0, revLeft);
    var backlog = allDue.length - due.length;

    // Хвост: если повторений больше половины потолка, новых слов меньше; при полуторном потолке — ноль
    var cap = size.rev;
    var load = (allDue.length - cap / 2) / cap;
    var factor = settings.noBacklogCut ? 1 : Math.max(0, Math.min(1, 1 - load));
    var perDay = settings.newPerDay != null ? settings.newPerDay : size.fresh;
    var newLeft = Math.round(Math.max(0, perDay - newDoneToday) * factor);

    var regular = [];
    if (meta.vocab) {
      // Слова из уроков (MY) — первыми и вне долей, остальные места делятся по уровням
      regular = (candidates.MY || []).slice(0, newLeft);
      var real = levels.filter(function (lv) { return /^[AB][12]$/.test(lv) && candidates[lv]; });
      var quota = splitByWeights(newLeft - regular.length, levelWeights(meta.vocab, real));
      var spare = 0;
      real.forEach(function (lv) {
        var take = candidates[lv].slice(0, quota[lv]);
        spare += quota[lv] - take.length;
        regular = regular.concat(take);
        candidates[lv] = candidates[lv].slice(take.length);
      });
      // Уровень закончился — добираем из остальных, начиная с самых «незнакомых»
      var order = real.slice().sort(function (a, b) { return (meta.vocab[a] || 0) - (meta.vocab[b] || 0); });
      order.forEach(function (lv) { while (spare > 0 && candidates[lv].length) { regular.push(candidates[lv].shift()); spare--; } });
    } else {
      for (var j = 0; j < words.length && regular.length < newLeft; j++) {
        var lvl = words[j].lvl, list = candidates[lvl];
        if (list && list[0] === words[j].id) regular.push(list.shift());
      }
    }

    return { due: due, fresh: priority.concat(regular), priority: priority, backlog: backlog };
  }

  /*
   * Уточнение словарного уровня по ежедневным ответам: первая оценка нового слова двигает
   * долю знакомых слов его уровня на 5% в нужную сторону.
   */
  function calibrate(vocab, lvl, knew) {
    if (!vocab || typeof vocab[lvl] !== 'number') return vocab;
    var out = Object.assign({}, vocab);
    var p = out[lvl];
    out[lvl] = Math.round((knew ? p + 0.05 * (1 - p) : p - 0.05 * p) * 1000) / 1000;
    return out;
  }

  // ---------- Словарный тест ----------
  /*
   * Тест идёт блоками по уровням: A1 (6 слов), A2 (10), B1 (11), B2 (11) — до 38 вопросов, ~5 минут.
   * Вопрос: английское слово и 4 перевода, плюс «Не знаю» (чтобы не угадывали наугад).
   * Если на уровне знакомо меньше 35% слов, выше не идём: дальше доля оценивается как половина предыдущей.
   */
  var TEST_PLAN = [['A1', 6], ['A2', 10], ['B1', 11], ['B2', 11]];
  var TEST_STOP = 0.35;

  function ruMain(ru) { return String(ru).split(/[;(]/)[0].trim(); }
  function ruTokens(ru) {
    return String(ru).toLowerCase().replace(/ё/g, 'е').split(/[^а-я]+/).filter(function (t) { return t.length > 2; });
  }

  // Слова блока: только из словаря (не из уроков), без слов без русского перевода
  function testWords(words, lvl, n, rnd) {
    var pool = words.filter(function (w) { return w.lvl === lvl && w.pos !== 'ph' && ruMain(w.ru); });
    return shuffle(pool, rnd).slice(0, n).map(function (w) { return w.id; });
  }

  // Вопрос: 3 неверных варианта той же части речи, без общих слов в переводе с правильным
  function testQuestion(words, id, rnd) {
    rnd = rnd || Math.random;
    var w = null;
    for (var k = 0; k < words.length; k++) if (words[k].id === id) { w = words[k]; break; }
    var right = ruMain(w.ru), tk = ruTokens(w.ru), seen = {};
    seen[right] = true;
    var same = shuffle(words.filter(function (x) { return x.pos === w.pos && x.lvl !== 'MY'; }), rnd);
    var rest = shuffle(words.filter(function (x) { return x.lvl !== 'MY'; }), rnd);
    var opts = [];
    same.concat(rest).some(function (x) {
      var r = ruMain(x.ru);
      if (!r || seen[r] || x.id === id) return false;
      if (ruTokens(x.ru).some(function (t) { return tk.indexOf(t) !== -1; })) return false;
      seen[r] = true;
      opts.push(r);
      return opts.length === 3;
    });
    var at = Math.floor(rnd() * 4);
    opts.splice(at, 0, right);
    return { id: id, lvl: w.lvl, prompt: label(w), options: opts, correct: at };
  }

  // Доля знакомых слов с поправкой на угадывание: каждый неверный ответ «съедает» треть верного
  function testScore(r) {
    var n = r.right + r.wrong + r.skip;
    if (!n) return 0;
    return Math.round(Math.max(0, (r.right - r.wrong / 3) / n) * 100) / 100;
  }

  // Итог: доли по всем уровням (непройденные — по половине предыдущего) и подпись уровня
  function testResult(results) {
    var vocab = {}, prev = 1;
    TEST_PLAN.forEach(function (p) {
      var r = results[p[0]];
      vocab[p[0]] = r ? testScore(r) : Math.round(prev / 2 * 100) / 100;
      prev = vocab[p[0]];
    });
    var level = 'ниже A1';
    TEST_PLAN.forEach(function (p) { if (vocab[p[0]] >= 0.6) level = p[0]; });
    return { vocab: vocab, level: level };
  }

  // Карточка для слова, которое человек уверенно знает: вернётся на быструю проверку через 1–3 недели
  function knownCard(id, day) {
    var wait = 7 + seedOf(id) % 15;
    return { r: 2, i: LEARNED_INTERVAL, e: 250, d: day + wait, l: 0 };
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

  // Огонёк серии: цвет меняется на 1, 10, 30, 50, 100, 200 и 365 днях подряд
  var FLAMES = [[1, 'orange', 'оранжевый'], [10, 'teal', 'бирюзовый'], [30, 'green', 'зелёный'], [50, 'blue', 'синий'],
    [100, 'purple', 'фиолетовый'], [200, 'gold', 'золотой'], [365, 'rainbow', 'радужный']];
  // Номер ступени (-1 — серии нет) и сколько дней до следующей
  function flameTier(streak) {
    var t = -1;
    for (var k = 0; k < FLAMES.length; k++) if (streak >= FLAMES[k][0]) t = k;
    var next = FLAMES[t + 1];
    return { tier: t, color: t < 0 ? 'none' : FLAMES[t][1], name: t < 0 ? '' : FLAMES[t][2],
      next: next ? next[0] : null, nextName: next ? next[2] : '' };
  }

  function stats(words, cards) {
    var byLevel = {};
    var learned = 0, learning = 0;
    for (var k = 0; k < words.length; k++) {
      var w = words[k];
      var lv = byLevel[w.lvl] || (byLevel[w.lvl] = { total: 0, seen: 0, learned: 0 });
      lv.total += 1;
      var c = cards[w.id];
      if (!c || (c.r === 2 && c.i >= LEARNED_INTERVAL)) continue; // нет карточки или знакомо по тесту и ещё не проверено
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
      var en = normSearch(w.show ? w.en + ' / ' + w.show : w.en);
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
    FLAMES: FLAMES,
    flameTier: flameTier,
    TEST_PLAN: TEST_PLAN,
    TEST_STOP: TEST_STOP,
    testWords: testWords,
    testQuestion: testQuestion,
    testScore: testScore,
    testResult: testResult,
    knownCard: knownCard,
    seedOf: seedOf,
    SIZES: SIZES,
    isQuick: isQuick,
    levelWeights: levelWeights,
    splitByWeights: splitByWeights,
    calibrate: calibrate,
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
