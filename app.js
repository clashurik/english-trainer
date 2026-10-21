/*
 * app.js — интерфейс: показывает экраны и связывает кнопки с логикой из core.js.
 *
 * Состояние приложения (state):
 *   cards — прогресс по словам: { "borrow": {r,i,e,d,l}, ... }
 *   meta  — серия дней, сколько новых слов уже взято сегодня, настройки
 */
(function () {
  'use strict';

  var Core = window.Core;
  var WORDS = window.WORDS;
  var byId = {};
  WORDS.forEach(function (w) { byId[w.id] = w; });

  var POS = { n: 'существительное', v: 'глагол', adj: 'прилагательное', adv: 'наречие', ph: 'фраза' };
  var LEVELS = ['A1', 'A2', 'B1', 'B2'].filter(function (lv) { return WORDS.some(function (w) { return w.lvl === lv; }); });

  var DEFAULT_META = {
    streak: 0, best: 0, lastDone: null, newDay: null, newDone: 0,
    settings: { newPerDay: 10, levels: LEVELS.slice() }
  };

  var state = { cards: {}, meta: JSON.parse(JSON.stringify(DEFAULT_META)) };
  var session = null;
  var $ = function (id) { return document.getElementById(id); };

  // ---------- Telegram ----------
  var tg = window.Telegram && window.Telegram.WebApp;
  var inTelegram = !!(tg && tg.initData);
  if (inTelegram) {
    tg.ready();
    tg.expand();
    var applyTheme = function () { document.documentElement.setAttribute('data-theme', tg.colorScheme === 'dark' ? 'dark' : 'light'); };
    applyTheme();
    tg.onEvent('themeChanged', applyTheme);
    tg.BackButton.onClick(function () { quitSession(); });
  }
  function haptic(kind) {
    try { if (inTelegram) tg.HapticFeedback.impactOccurred(kind || 'light'); } catch (e) { /* не поддерживается */ }
  }

  function save() { AppStorage.save(state); }
  function today() { return Core.dayNumber(); }

  // ---------- Главный экран ----------
  function renderHome() {
    var day = today();
    var q = Core.buildQueue(WORDS, state.cards, state.meta.settings, state.meta, day);
    var streak = Core.currentStreak(state.meta, day);

    $('today-date').textContent = new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
    $('streak-num').textContent = streak;
    $('streak-label').textContent = plural(streak, 'день подряд', 'дня подряд', 'дней подряд');
    $('streak-best').textContent = state.meta.lastDone === day
      ? 'Сегодня уже занимались. Рекорд: ' + (state.meta.best || 0)
      : 'Рекорд: ' + (state.meta.best || 0);
    $('due-count').textContent = q.due.length;
    $('new-count').textContent = q.fresh.length;

    var total = q.due.length + q.fresh.length;
    $('start-btn').disabled = total === 0;
    $('start-btn').textContent = total === 0 ? 'На сегодня всё' : 'Начать занятие';
    var minutes = Math.max(1, Math.round((q.due.length * 8 + q.fresh.length * 20) / 60));
    $('start-hint').textContent = total === 0
      ? 'Новые слова закончились или достигнут дневной лимит. Можно взять ещё в настройках.'
      : 'Примерно ' + minutes + ' ' + plural(minutes, 'минута', 'минуты', 'минут');

    renderLevels();
    renderSettings();
  }

  function renderLevels() {
    var st = Core.stats(WORDS, state.cards);
    var box = $('level-rows');
    box.innerHTML = '';
    LEVELS.forEach(function (lv) {
      var s = st.byLevel[lv];
      var row = document.createElement('div');
      row.className = 'level-row lv-' + lv;
      var learnedPct = s.total ? (s.learned / s.total) * 100 : 0;
      var seenPct = s.total ? ((s.seen - s.learned) / s.total) * 100 : 0;
      row.innerHTML =
        '<span class="lvl">' + lv + '</span>' +
        '<div class="level-track" role="img" aria-label="' + lv + ': выучено ' + s.learned + ', изучается ' + (s.seen - s.learned) + ' из ' + s.total + '">' +
        '<span class="learned" style="width:' + learnedPct + '%"></span><span class="seen" style="width:' + seenPct + '%"></span></div>' +
        '<span class="level-count">' + s.learned + ' / ' + s.total + '</span>';
      box.appendChild(row);
    });
  }

  function renderSettings() {
    var seg = $('new-per-day');
    seg.innerHTML = '';
    [5, 10, 15, 20].forEach(function (n) {
      var b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(state.meta.settings.newPerDay === n));
      b.textContent = n;
      b.onclick = function () { state.meta.settings.newPerDay = n; save(); renderHome(); };
      seg.appendChild(b);
    });

    var chips = $('level-toggles');
    chips.innerHTML = '';
    LEVELS.forEach(function (lv) {
      var on = state.meta.settings.levels.indexOf(lv) !== -1;
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip lv-' + lv;
      b.setAttribute('aria-pressed', String(on));
      b.textContent = lv;
      b.onclick = function () {
        var list = state.meta.settings.levels;
        if (on && list.length === 1) return; // хотя бы один уровень должен остаться
        state.meta.settings.levels = on ? list.filter(function (x) { return x !== lv; }) : list.concat(lv);
        save(); renderHome();
      };
      chips.appendChild(b);
    });

    $('storage-note').textContent = AppStorage.isCloud()
      ? 'В облаке Telegram: прогресс сохранится на любом устройстве.'
      : 'В этом браузере. Внутри Telegram прогресс будет храниться в облаке.';
  }

  // ---------- Занятие ----------
  function startSession(extraNew) {
    var day = today();
    var q = Core.buildQueue(WORDS, state.cards, state.meta.settings, state.meta, day);
    var fresh = q.fresh;
    if (extraNew) {
      // «Ещё 5 слов»: берём следующие новые слова сверх дневного лимита
      var more = Object.assign({}, state.meta.settings, { newPerDay: 9999 });
      fresh = Core.buildQueue(WORDS, state.cards, more, { newDay: null }, day).fresh.slice(0, extraNew);
    }
    var queue = Core.mixQueue(q.due, fresh);
    if (!queue.length) return;

    session = { queue: queue, total: queue.length, done: 0, reviewed: 0, fresh: 0, errors: 0, revealed: false, newIds: {} };
    show('session');
    if (inTelegram) tg.BackButton.show();
    showCard();
  }

  function showCard() {
    var w = byId[session.queue[0]];
    var isNew = !state.cards[w.id];
    session.revealed = false;

    $('card').className = 'card lv-' + w.lvl;
    $('c-lvl').textContent = w.lvl;
    $('c-pos').textContent = POS[w.pos] || '';
    $('c-new').hidden = !isNew;
    $('c-word').textContent = w.en;
    $('c-ru').textContent = w.ru;
    $('c-ex').innerHTML = highlight(w.ex, w.en);
    $('c-exru').textContent = w.exRu;
    $('c-answer').hidden = true;
    $('reveal-btn').hidden = false;
    $('grades').hidden = true;

    $('counter').textContent = session.done + ' / ' + session.total;
    $('bar-fill').style.width = (session.done / session.total * 100) + '%';
  }

  function reveal() {
    if (!session || session.revealed) return;
    session.revealed = true;
    var w = byId[session.queue[0]];
    var card = state.cards[w.id] || Core.newCard(today());
    var p = Core.preview(card, today());
    for (var g = 1; g <= 4; g++) $('p' + g).textContent = intervalLabel(p[g]);
    $('c-answer').hidden = false;
    $('reveal-btn').hidden = true;
    $('grades').hidden = false;
  }

  function grade(g) {
    if (!session || !session.revealed) return;
    var day = today();
    var id = session.queue.shift();
    var wasNew = !state.cards[id];
    var card = state.cards[id] || Core.newCard(day);

    if (wasNew) {
      if (state.meta.newDay !== day) { state.meta.newDay = day; state.meta.newDone = 0; }
      state.meta.newDone += 1;
      session.fresh += 1;
      session.newIds[id] = true; // запоминаем: если слово забудут, при повторном показе оно всё ещё «новое»
    }

    state.cards[id] = Core.schedule(card, g, day);
    haptic(g === 1 ? 'medium' : 'light');

    if (g === 1) {
      // Забытое слово вернётся через 3 карточки (или в конце, если карточек меньше)
      session.errors += 1;
      session.queue.splice(Math.min(3, session.queue.length), 0, id);
    } else {
      session.done += 1;
      if (!session.newIds[id]) session.reviewed += 1;
    }
    save();

    if (session.queue.length) showCard();
    else finishSession();
  }

  function finishSession() {
    var day = today();
    var before = state.meta.lastDone;
    state.meta = Core.completeDay(state.meta, day);
    save();

    $('d-reviewed').textContent = session.reviewed;
    $('d-new').textContent = session.fresh;
    $('d-errors').textContent = session.errors;
    $('done-title').textContent = session.errors === 0 ? 'Без единой ошибки' : 'Отличная работа';
    var n = state.meta.streak;
    $('done-streak').textContent = before === day
      ? 'Сегодняшний день уже засчитан. Серия: ' + n + ' ' + plural(n, 'день', 'дня', 'дней') + '.'
      : n === 1 ? 'Первый день серии. Возвращайтесь завтра, чтобы она росла.'
      : 'Серия выросла до ' + n + ' ' + plural(n, 'дня', 'дней', 'дней') + ' подряд.';
    if (inTelegram) tg.BackButton.hide();
    haptic('heavy');
    session = null;
    show('done');
  }

  function quitSession() {
    session = null;
    if (inTelegram) tg.BackButton.hide();
    show('home');
    renderHome();
  }

  // ---------- Озвучка ----------
  function speak(text) {
    if (!('speechSynthesis' in window)) return;
    var u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US';
    u.rate = 0.9;
    var voice = speechSynthesis.getVoices().filter(function (v) { return /^en(-|_)/i.test(v.lang); })[0];
    if (voice) u.voice = voice;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  }

  // ---------- Вспомогательное ----------
  function show(name) {
    ['home', 'session', 'done'].forEach(function (s) { $(s).hidden = s !== name; });
    window.scrollTo(0, 0);
  }

  function intervalLabel(days) {
    if (days === 0) return 'сейчас';
    if (days < 30) return days + ' д';
    if (days < 365) return Math.round(days / 30) + ' мес';
    return '1 год';
  }

  function plural(n, one, few, many) {
    var m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
    return many;
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }

  // Выделяем слово в примере, включая его формы: decide → decided, look forward to → looking forward to
  function highlight(example, word) {
    var parts = word.replace(/[?!.]/g, '').trim().split(/\s+/).map(function (p) {
      var stem = p.length > 3 ? p.replace(/(e|y)$/i, '') : p;
      return stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + "[\\w']*";
    });
    var m = new RegExp('\\b' + parts.join('\\s+'), 'i').exec(example);
    if (!m) return escapeHtml(example);
    return escapeHtml(example.slice(0, m.index)) + '<b>' + escapeHtml(m[0]) + '</b>' + escapeHtml(example.slice(m.index + m[0].length));
  }

  // ---------- Кнопки и клавиатура ----------
  $('start-btn').onclick = function () { startSession(0); };
  $('reveal-btn').onclick = reveal;
  $('card').onclick = function (e) { if (!e.target.closest('.speak')) reveal(); };
  $('speak-btn').onclick = function () { if (session) speak(byId[session.queue[0]].en); };
  $('quit-btn').onclick = quitSession;
  $('home-btn').onclick = function () { show('home'); renderHome(); };
  $('more-btn').onclick = function () { startSession(5); };
  Array.prototype.forEach.call(document.querySelectorAll('.grade'), function (b) {
    b.onclick = function () { grade(Number(b.getAttribute('data-g'))); };
  });
  $('reset-btn').onclick = function () { $('reset-confirm').hidden = false; $('reset-btn').hidden = true; };
  $('reset-no').onclick = function () { $('reset-confirm').hidden = true; $('reset-btn').hidden = false; };
  $('reset-yes').onclick = async function () {
    await AppStorage.reset();
    state = { cards: {}, meta: JSON.parse(JSON.stringify(DEFAULT_META)) };
    $('reset-confirm').hidden = true; $('reset-btn').hidden = false;
    renderHome();
  };
  document.addEventListener('keydown', function (e) {
    if (!session) return;
    if (e.code === 'Space' || e.key === 'Enter') { e.preventDefault(); reveal(); }
    if (/^[1-4]$/.test(e.key)) grade(Number(e.key));
  });

  // ---------- Запуск ----------
  AppStorage.load().then(function (saved) {
    if (saved && saved.cards && saved.meta) {
      state.cards = saved.cards;
      state.meta = Object.assign({}, DEFAULT_META, saved.meta);
      state.meta.settings = Object.assign({}, DEFAULT_META.settings, saved.meta.settings);
    }
    renderHome();
  });
  renderHome();
})();
