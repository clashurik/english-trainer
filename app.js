/*
 * app.js — интерфейс: показывает экраны и связывает кнопки с логикой из core.js.
 *
 * Состояние приложения (state):
 *   cards  — прогресс по словам: { "borrow": {r,i,e,d,l}, ... }
 *   custom — ваши слова из уроков (у них уровень "MY")
 *   meta   — серия дней, сколько новых слов взято сегодня, настройки
 *
 * Экраны: home (главный), session (карточки), done (итог),
 *         practice (настройка тренировки), lessons (слова из уроков).
 */
(function () {
  'use strict';

  var Core = window.Core;
  var BASE_WORDS = window.WORDS;

  var POS = { n: 'существительное', v: 'глагол', adj: 'прилагательное', adv: 'наречие', ph: 'фраза' };
  var LEVEL_LABEL = { MY: 'Урок' };
  var LEVELS = ['A1', 'A2', 'B1', 'B2'].filter(function (lv) { return BASE_WORDS.some(function (w) { return w.lvl === lv; }); });

  var DEFAULT_META = {
    streak: 0, best: 0, lastDone: null, newDay: null, newDone: 0,
    settings: { newPerDay: 10, levels: LEVELS.slice() },
    practice: { set: 'studied', levels: LEVELS.slice(), kind: 'all', dir: 'en', count: 10 }
  };
  function freshMeta() { return JSON.parse(JSON.stringify(DEFAULT_META)); }

  var state = { cards: {}, custom: [], meta: freshMeta() };
  var session = null;
  var words = [];   // все слова: сначала ваши из уроков, потом общий словарь
  var byId = {};
  var $ = function (id) { return document.getElementById(id); };

  function indexWords() {
    words = state.custom.concat(BASE_WORDS);
    byId = {};
    words.forEach(function (w) { byId[w.id] = w; });
  }
  function levelsAll() { return state.custom.length ? LEVELS.concat('MY') : LEVELS.slice(); }
  function levelLabel(lv) { return LEVEL_LABEL[lv] || lv; }

  // Слова из уроков всегда участвуют в ежедневном задании, независимо от выбранных уровней
  function dailySettings(extra) {
    return Object.assign({}, state.meta.settings, { levels: state.meta.settings.levels.concat('MY') }, extra || {});
  }

  // ---------- Telegram ----------
  var tg = window.Telegram && window.Telegram.WebApp;
  var inTelegram = !!(tg && tg.initData);
  if (inTelegram) {
    tg.ready();
    tg.expand();
    var applyTheme = function () { document.documentElement.setAttribute('data-theme', tg.colorScheme === 'dark' ? 'dark' : 'light'); };
    applyTheme();
    tg.onEvent('themeChanged', applyTheme);
    tg.BackButton.onClick(function () { session ? quitSession() : goHome(); });
  }
  function haptic(kind) {
    try { if (inTelegram) tg.HapticFeedback.impactOccurred(kind || 'light'); } catch (e) { /* не поддерживается */ }
  }

  function save() { AppStorage.save(state); }
  function today() { return Core.dayNumber(); }

  // ---------- Главный экран ----------
  function renderHome() {
    var day = today();
    var q = Core.buildQueue(words, state.cards, dailySettings(), state.meta, day);
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
      ? 'Задание выполнено. Можно потренироваться свободно или взять ещё новых слов после занятия.'
      : 'Примерно ' + minutes + ' ' + plural(minutes, 'минута', 'минуты', 'минут');

    var n = state.custom.length;
    $('lessons-sub').textContent = n
      ? n + ' ' + plural(n, 'слово', 'слова', 'слов') + ' из уроков. Добавить ещё'
      : 'Добавить слова из занятий с репетитором';

    renderLevels();
    renderSettings();
  }

  function renderLevels() {
    var st = Core.stats(words, state.cards);
    var box = $('level-rows');
    box.innerHTML = '';
    levelsAll().forEach(function (lv) {
      var s = st.byLevel[lv];
      if (!s) return;
      var learning = s.seen - s.learned;
      var row = document.createElement('div');
      row.className = 'level-row lv-' + lv;
      row.innerHTML =
        '<span class="lvl">' + levelLabel(lv) + '</span>' +
        '<div class="level-track" role="img" aria-label="' + levelLabel(lv) + ': выучено ' + s.learned + ', в изучении ' + learning + ', всего ' + s.total + '">' +
        '<span class="learned" style="width:' + pct(s.learned, s.total) + '%"></span>' +
        '<span class="seen" style="width:' + pct(learning, s.total) + '%"></span></div>' +
        '<span class="level-count">' + s.seen + ' / ' + s.total + '</span>';
      box.appendChild(row);
    });
  }

  function renderSettings() {
    radioGroup($('new-per-day'), [5, 10, 15, 20], state.meta.settings.newPerDay, function (n) {
      state.meta.settings.newPerDay = n; save(); renderHome();
    });

    var chips = $('level-toggles');
    chips.innerHTML = '';
    LEVELS.forEach(function (lv) {
      var on = state.meta.settings.levels.indexOf(lv) !== -1;
      chips.appendChild(chip(lv, on, function () {
        var list = state.meta.settings.levels;
        if (on && list.length === 1) return; // хотя бы один уровень должен остаться
        state.meta.settings.levels = on ? list.filter(function (x) { return x !== lv; }) : list.concat(lv);
        save(); renderHome();
      }));
    });

    $('storage-note').textContent = AppStorage.isCloud()
      ? 'В облаке Telegram: прогресс сохранится на любом устройстве.'
      : 'В этом браузере. Внутри Telegram прогресс будет храниться в облаке.';
  }

  // ---------- Ежедневное занятие ----------
  function startDaily(extraNew) {
    var day = today();
    var q = Core.buildQueue(words, state.cards, dailySettings(), state.meta, day);
    var fresh = q.fresh;
    if (extraNew) {
      // «Ещё 5 слов»: берём следующие новые слова сверх дневного лимита
      fresh = Core.buildQueue(words, state.cards, dailySettings({ newPerDay: 9999 }), {}, day).fresh.slice(0, extraNew);
    }
    var queue = Core.mixQueue(q.due, fresh);
    if (!queue.length) return;
    beginSession({ mode: 'daily', dir: 'en', queue: queue });
  }

  // ---------- Свободная тренировка ----------
  var SET_HINT = {
    studied: 'Слова, которые уже встречались в ежедневных занятиях.',
    hard: 'Слова, в которых были ошибки или которые даются тяжелее остальных.',
    lessons: 'Все слова, добавленные из уроков, включая ещё не изученные.',
    all: 'Весь словарь, включая слова, которые вы ещё не начинали.'
  };

  function practicePool() {
    var p = state.meta.practice;
    return Core.practicePool(words, state.cards, { set: p.set, kind: p.kind, levels: p.levels });
  }

  function renderPractice() {
    var p = state.meta.practice;
    var update = function () { save(); renderPractice(); };

    optionGroup($('pr-set'), p.set, function (v) { p.set = v; update(); });
    optionGroup($('pr-kind'), p.kind, function (v) { p.kind = v; update(); });
    optionGroup($('pr-dir'), p.dir, function (v) { p.dir = v; update(); });
    optionGroup($('pr-count'), String(p.count), function (v) { p.count = Number(v); update(); });
    $('pr-set-hint').textContent = SET_HINT[p.set];

    $('pr-levels-row').hidden = p.set === 'lessons';
    var chips = $('pr-levels');
    chips.innerHTML = '';
    levelsAll().forEach(function (lv) {
      var on = p.levels.indexOf(lv) !== -1;
      chips.appendChild(chip(levelLabel(lv), on, function () {
        p.levels = on ? p.levels.filter(function (x) { return x !== lv; }) : p.levels.concat(lv);
        update();
      }, lv));
    });

    var n = practicePool().length;
    $('pr-start').disabled = n === 0;
    $('pr-found').textContent = n === 0
      ? (p.set === 'lessons' ? 'Пока нет слов из уроков. Добавьте их на экране «Слова из уроков».'
        : p.set === 'hard' ? 'Трудных слов пока нет. Отлично!'
        : 'Под эти условия не подходит ни одно слово. Измените набор или уровни.')
      : 'Подходит ' + n + ' ' + plural(n, 'слово', 'слова', 'слов') + '. В тренировку попадут ' + Math.min(n, p.count || n) + ' в случайном порядке.';
  }

  function startPractice() {
    var p = state.meta.practice;
    var pool = Core.shuffle(practicePool());
    if (p.count) pool = pool.slice(0, p.count);
    if (!pool.length) return;
    beginSession({ mode: 'practice', dir: p.dir, queue: pool });
  }

  // ---------- Карточки (общие для обоих режимов) ----------
  function beginSession(opts) {
    session = {
      mode: opts.mode, dir: opts.dir, queue: opts.queue, total: opts.queue.length,
      done: 0, reviewed: 0, fresh: 0, errors: 0, firstTry: 0, revealed: false, newIds: {}, missed: {}
    };
    $('keys-hint').textContent = session.mode === 'daily'
      ? 'Пробел — показать, 1–4 — оценка'
      : 'Пробел — показать, 1 — не помню, 2 — помню';
    show('session');
    showCard();
  }

  function showCard() {
    var w = byId[session.queue[0]];
    var ruFirst = session.dir === 'ru';
    session.revealed = false;

    $('card').className = 'card lv-' + w.lvl;
    $('c-lvl').textContent = levelLabel(w.lvl);
    $('c-pos').textContent = POS[w.pos] || '';
    $('c-new').hidden = !(session.mode === 'daily' && !state.cards[w.id]);
    $('c-word').textContent = ruFirst ? w.ru : w.en;
    $('c-ru').textContent = ruFirst ? w.en : w.ru;
    $('c-ex').innerHTML = w.ex ? highlight(w.ex, w.en) : '';
    $('c-ex').hidden = !w.ex;
    $('c-exru').textContent = w.exRu || '';
    $('c-exru').hidden = !w.exRu;
    $('speak-btn').hidden = ruFirst; // в режиме RU→EN озвучка выдала бы ответ
    $('c-answer').hidden = true;
    $('reveal-btn').hidden = false;
    $('grades').hidden = true;
    $('practice-grades').hidden = true;

    $('counter').textContent = session.done + ' / ' + session.total;
    $('bar-fill').style.width = (session.done / session.total * 100) + '%';
  }

  function reveal() {
    if (!session || session.revealed) return;
    session.revealed = true;
    if (session.mode === 'daily') {
      var w = byId[session.queue[0]];
      var p = Core.preview(state.cards[w.id] || Core.newCard(today()), today());
      for (var g = 1; g <= 4; g++) $('p' + g).textContent = intervalLabel(p[g]);
      $('grades').hidden = false;
    } else {
      $('practice-grades').hidden = false;
    }
    $('speak-btn').hidden = false;
    $('c-answer').hidden = false;
    $('reveal-btn').hidden = true;
  }

  // Оценка в ежедневном занятии: двигает слово по расписанию SRS
  function grade(g) {
    if (!session || !session.revealed || session.mode !== 'daily') return;
    var day = today();
    var id = session.queue.shift();
    var wasNew = !state.cards[id];
    var card = state.cards[id] || Core.newCard(day);

    if (wasNew) {
      if (state.meta.newDay !== day) { state.meta.newDay = day; state.meta.newDone = 0; }
      state.meta.newDone += 1;
      session.fresh += 1;
      session.newIds[id] = true; // если слово забудут, при повторном показе оно всё ещё «новое»
    }

    state.cards[id] = Core.schedule(card, g, day);
    haptic(g === 1 ? 'medium' : 'light');

    if (g === 1) {
      session.errors += 1;
      session.queue.splice(Math.min(3, session.queue.length), 0, id); // вернётся через 3 карточки
    } else {
      session.done += 1;
      if (!session.newIds[id]) session.reviewed += 1;
    }
    save();
    next();
  }

  // Ответ в тренировке: расписание не меняется, забытое слово ставится в ближайшее ежедневное задание
  function practiceAnswer(remember) {
    if (!session || !session.revealed || session.mode !== 'practice') return;
    var id = session.queue.shift();
    haptic(remember ? 'light' : 'medium');

    if (remember) {
      session.done += 1;
      if (!session.missed[id]) session.firstTry += 1;
    } else {
      session.errors += 1;
      session.missed[id] = true;
      session.queue.splice(Math.min(3, session.queue.length), 0, id);
      var c = state.cards[id];
      if (c && c.d > today()) {
        state.cards[id] = Object.assign({}, c, { d: today() });
        save();
      }
    }
    next();
  }

  function next() {
    if (session.queue.length) showCard();
    else finishSession();
  }

  function finishSession() {
    var s = session;
    session = null;
    if (s.mode === 'daily') {
      var day = today();
      var before = state.meta.lastDone;
      state.meta = Core.completeDay(state.meta, day);
      save();
      setDone('Занятие завершено', s.errors === 0 ? 'Без единой ошибки' : 'Отличная работа',
        ['Повторено', s.reviewed], ['Новых слов', s.fresh], ['Ошибок', s.errors]);
      var n = state.meta.streak;
      $('done-streak').textContent = before === day
        ? 'Сегодняшний день уже засчитан. Серия: ' + n + ' ' + plural(n, 'день', 'дня', 'дней') + '.'
        : n === 1 ? 'Первый день серии. Возвращайтесь завтра, чтобы она росла.'
        : 'Серия выросла до ' + n + ' ' + plural(n, 'дня', 'дней', 'дней') + ' подряд.';
      $('more-btn').textContent = 'Ещё 5 новых слов';
    } else {
      var missed = Object.keys(s.missed).length;
      setDone('Тренировка завершена', missed === 0 ? 'Всё вспомнили' : 'Хорошая тренировка',
        ['Карточек', s.total], ['Сразу вспомнили', s.firstTry], ['Не вспомнили', missed]);
      $('done-streak').textContent = missed
        ? 'Слова, которые не вспомнили, появятся в ближайшем ежедневном задании.'
        : 'Тренировка не влияет на серию дней: её засчитывает ежедневное задание.';
      $('more-btn').textContent = 'Ещё одна тренировка';
    }
    $('more-btn').setAttribute('data-mode', s.mode);
    haptic('heavy');
    show('done');
  }

  function setDone(eyebrow, title, a, b, c) {
    $('done').querySelector('.eyebrow').textContent = eyebrow;
    $('done-title').textContent = title;
    $('d-l1').textContent = a[0]; $('d-reviewed').textContent = a[1];
    $('d-l2').textContent = b[0]; $('d-new').textContent = b[1];
    $('d-l3').textContent = c[0]; $('d-errors').textContent = c[1];
  }

  function quitSession() {
    session = null;
    goHome();
  }

  // ---------- Слова из уроков ----------
  function renderLessons() {
    var n = state.custom.length;
    $('my-count').textContent = n ? 'Ваши слова: ' + n : 'Ваши слова';
    var list = $('my-words');
    list.innerHTML = '';
    if (!n) {
      list.innerHTML = '<li class="empty">Пока пусто. Добавленные слова появятся здесь и в ежедневном задании.</li>';
      return;
    }
    state.custom.slice().reverse().forEach(function (w) {
      var li = document.createElement('li');
      li.innerHTML = '<div><div class="w-en"></div><div class="w-ru"></div></div>';
      li.querySelector('.w-en').textContent = w.en;
      li.querySelector('.w-ru').textContent = w.ru;
      var del = document.createElement('button');
      del.type = 'button';
      del.className = 'del';
      del.textContent = 'Удалить';
      del.setAttribute('aria-label', 'Удалить ' + w.en);
      del.onclick = function () {
        state.custom = state.custom.filter(function (x) { return x.id !== w.id; });
        delete state.cards[w.id];
        indexWords(); save(); renderLessons();
      };
      li.appendChild(del);
      list.appendChild(li);
    });
  }

  function importWords() {
    var res = Core.parseImport($('import-text').value, byId);
    var out = $('import-result');
    var msg = [];
    if (res.words.length) {
      state.custom = state.custom.concat(res.words);
      indexWords(); save();
      msg.push('Добавлено: ' + res.words.length + '. Они появятся в ежедневном задании первыми.');
    }
    if (res.skipped.length) msg.push('Уже были в словаре: ' + res.skipped.join(', ') + '.');
    if (res.bad.length) msg.push('Не распознано строк: ' + res.bad.length + '. Нужна вертикальная черта между словом и переводом: «слово | перевод».');
    if (!msg.length) msg.push('Вставьте хотя бы одну строку вида «слово | перевод».');
    out.textContent = msg.join(' ');
    out.className = 'import-result ' + (res.words.length ? 'ok' : 'err');
    if (res.words.length && !res.bad.length) $('import-text').value = '';
    renderLessons();
  }

  function copyAsk() {
    var text = $('ask-text').textContent;
    var done = function () { $('copy-ask').textContent = 'Скопировано'; setTimeout(function () { $('copy-ask').textContent = 'Скопировать'; }, 1500); };
    try {
      navigator.clipboard.writeText(text).then(done, selectAsk);
    } catch (e) { selectAsk(); }
  }
  function selectAsk() {
    var r = document.createRange();
    r.selectNodeContents($('ask-text'));
    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
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
    ['home', 'session', 'done', 'practice', 'lessons'].forEach(function (s) { $(s).hidden = s !== name; });
    if (inTelegram) { name === 'home' || name === 'done' ? tg.BackButton.hide() : tg.BackButton.show(); }
    window.scrollTo(0, 0);
  }
  function goHome() { show('home'); renderHome(); }

  // Группа кнопок «выбери одно» с готовыми кнопками в разметке (data-v)
  function optionGroup(box, value, onPick) {
    Array.prototype.forEach.call(box.querySelectorAll('button'), function (b) {
      b.setAttribute('aria-checked', String(b.getAttribute('data-v') === value));
      b.onclick = function () { onPick(b.getAttribute('data-v')); };
    });
  }
  // Группа «выбери одно», кнопки создаются из списка значений
  function radioGroup(box, values, value, onPick) {
    box.innerHTML = '';
    values.forEach(function (v) {
      var b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(v === value));
      b.textContent = v;
      b.onclick = function () { onPick(v); };
      box.appendChild(b);
    });
  }
  function chip(label, on, onClick, lv) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip lv-' + (lv || label);
    b.setAttribute('aria-pressed', String(on));
    b.textContent = label;
    b.onclick = onClick;
    return b;
  }

  function pct(a, b) { return b ? (a / b) * 100 : 0; }

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
  $('start-btn').onclick = function () { startDaily(0); };
  $('practice-btn').onclick = function () { show('practice'); renderPractice(); };
  $('lessons-btn').onclick = function () { show('lessons'); renderLessons(); };
  $('pr-start').onclick = startPractice;
  $('import-btn').onclick = importWords;
  $('copy-ask').onclick = copyAsk;
  Array.prototype.forEach.call(document.querySelectorAll('[data-home]'), function (b) { b.onclick = goHome; });

  $('reveal-btn').onclick = reveal;
  $('card').onclick = function (e) { if (!e.target.closest('.speak')) reveal(); };
  $('speak-btn').onclick = function () { if (session) speak(byId[session.queue[0]].en); };
  $('quit-btn').onclick = quitSession;
  Array.prototype.forEach.call(document.querySelectorAll('#grades .grade'), function (b) {
    b.onclick = function () { grade(Number(b.getAttribute('data-g'))); };
  });
  Array.prototype.forEach.call(document.querySelectorAll('#practice-grades .grade'), function (b) {
    b.onclick = function () { practiceAnswer(b.getAttribute('data-p') === '1'); };
  });

  $('home-btn').onclick = goHome;
  $('more-btn').onclick = function () {
    if ($('more-btn').getAttribute('data-mode') === 'practice') { show('practice'); renderPractice(); }
    else startDaily(5);
  };

  $('reset-btn').onclick = function () { $('reset-confirm').hidden = false; $('reset-btn').hidden = true; };
  $('reset-no').onclick = function () { $('reset-confirm').hidden = true; $('reset-btn').hidden = false; };
  $('reset-yes').onclick = async function () {
    await AppStorage.reset();
    state = { cards: {}, custom: state.custom, meta: freshMeta() }; // слова из уроков сохраняем
    save();
    $('reset-confirm').hidden = true; $('reset-btn').hidden = false;
    renderHome();
  };

  document.addEventListener('keydown', function (e) {
    if (!session) return;
    if (e.code === 'Space' || e.key === 'Enter') { e.preventDefault(); reveal(); return; }
    if (session.mode === 'daily' && /^[1-4]$/.test(e.key)) grade(Number(e.key));
    if (session.mode === 'practice' && (e.key === '1' || e.key === '2')) practiceAnswer(e.key === '2');
  });

  // ---------- Запуск ----------
  indexWords();
  AppStorage.load().then(function (saved) {
    if (saved && saved.cards && saved.meta) {
      state.cards = saved.cards;
      state.custom = saved.custom || [];
      state.meta = Object.assign(freshMeta(), saved.meta);
      state.meta.settings = Object.assign(freshMeta().settings, saved.meta.settings);
      state.meta.practice = Object.assign(freshMeta().practice, saved.meta.practice);
    }
    indexWords();
    renderHome();
  });
  renderHome();
})();
