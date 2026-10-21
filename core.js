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

  var Core = {
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
