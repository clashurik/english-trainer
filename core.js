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
  function buildQueue(words, cards, settings, meta, day) {
    var due = [];
    var fresh = [];
    var newDoneToday = meta.newDay === day ? meta.newDone : 0;
    var newLeft = Math.max(0, settings.newPerDay - newDoneToday);
    var levels = settings.levels;

    for (var k = 0; k < words.length; k++) {
      var w = words[k];
      var c = cards[w.id];
      if (c) {
        if (c.d <= day) due.push(w.id);
      } else if (fresh.length < newLeft && levels.indexOf(w.lvl) !== -1) {
        fresh.push(w.id);
      }
    }

    due.sort(function (a, b) { return cards[a].d - cards[b].d; });
    return { due: due.slice(0, 150), fresh: fresh };
  }

  // Смешиваем: после каждых трёх повторений одно новое слово, чтобы занятие не было монотонным.
  function mixQueue(due, fresh) {
    var out = [];
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
        ex: ex ? [[ex, (parts[3] || '').trim()]] : [], forms: [], irr: null, note: ''
      });
    });
    return result;
  }

  /*
   * Слова из уроков, сохранённые версией 1.1.0, хранили один пример строкой (ex + exRu).
   * Приводим их к новому виду: ex — список пар [пример, перевод].
   */
  function normalizeCustom(w) {
    if (Array.isArray(w.ex)) return Object.assign({ forms: [], irr: null, note: '' }, w);
    var ex = w.ex ? [[w.ex, w.exRu || '']] : [];
    return { id: w.id, en: w.en, ru: w.ru, pos: w.pos || '', lvl: 'MY', ex: ex, forms: [], irr: null, note: '' };
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

  var Core = {
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
