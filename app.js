/*
 * app.js — интерфейс: показывает экраны и связывает кнопки с логикой из core.js.
 *
 * Состояние приложения (state):
 *   cards  — прогресс по словам: { "borrow": {r,i,e,d,l}, ... }
 *   custom — ваши слова из уроков (у них уровень "MY")
 *   meta   — серия дней, сколько новых слов взято сегодня, настройки
 *
 * Экраны: home (главный), session (карточки), done (итог), practice (настройка тренировки),
 *         lessons (слова из уроков), dict (словарь), history (история версий).
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
    priority: [], // слова, добавленные из словаря вне очереди
    settings: { newPerDay: 10, levels: LEVELS.slice(), typeMode: false },
    practice: { set: 'studied', levels: LEVELS.slice(), kind: 'all', dir: 'en', count: 10 }
  };
  function freshMeta() { return JSON.parse(JSON.stringify(DEFAULT_META)); }

  var state = { cards: {}, custom: [], meta: freshMeta() };
  var session = null;
  var words = [];   // все слова: сначала ваши из уроков, потом общий словарь
  var byId = {};
  var byRu = {};    // перевод → английские слова с таким же переводом (для проверки синонимов)
  var SCREENS = ['home', 'session', 'done', 'practice', 'lessons', 'dict', 'history'];
  var $ = function (id) { return document.getElementById(id); };

  function indexWords() {
    words = Core.mergeWords(state.custom, BASE_WORDS);
    byId = {};
    byRu = {};
    words.forEach(function (w) {
      byId[w.id] = w;
      var key = w.ru.toLowerCase().trim();
      (byRu[key] = byRu[key] || []).push(w.en);
    });
  }
  function synonymsOf(w) {
    return (byRu[w.ru.toLowerCase().trim()] || []).filter(function (en) { return en !== w.en; });
  }
  function current() { return byId[session.queue[0]]; }
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
    tg.BackButton.onClick(function () {
      if (!$('sheet').hidden) closeSheet();
      else if (session) quitSession();
      else goHome();
    });
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

    var queued = queuedIds().length;
    $('dict-sub').textContent = queued
      ? 'Ждут ближайшего занятия: ' + queued + ' ' + plural(queued, 'слово', 'слова', 'слов') + '. Найти ещё'
      : 'Найти слово, посмотреть карточку и добавить в изучение';
    $('type-toggle').checked = typeMode();

    $('app-version').textContent = window.APP_VERSION || '';
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
    $('pr-type-toggle').checked = typeMode();
    $('pr-dir-row').hidden = typeMode();
    $('pr-type-toggle').closest('.switch-row').querySelector('.switch-sub').textContent = typeMode()
      ? 'Видите перевод и пишете слово по-английски. Направление в этом режиме — RU → EN'
      : 'Выключено: карточки, вы сами оцениваете, вспомнили ли слово';

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
  function typeMode() { return !!state.meta.settings.typeMode; }
  function setTypeMode(on) { state.meta.settings.typeMode = !!on; save(); }

  function beginSession(opts) {
    var type = typeMode();
    session = {
      mode: opts.mode, dir: type ? 'ru' : opts.dir, type: type, queue: opts.queue, total: opts.queue.length,
      done: 0, reviewed: 0, fresh: 0, errors: 0, firstTry: 0, revealed: false, newIds: {}, missed: {}
    };
    $('keys-hint').textContent = type ? 'Enter — проверить, ещё раз Enter — дальше'
      : session.mode === 'daily' ? 'Пробел — показать, 1–4 — оценка'
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
    $('c-word').className = 'headword';
    $('c-word').removeAttribute('role');
    $('c-word').removeAttribute('tabindex');
    $('c-ru').textContent = ruFirst ? w.en : w.ru;
    $('c-irr').hidden = !w.irr;
    $('c-irr').innerHTML = w.irr ? irrLine(w) : '';
    $('c-note').hidden = !w.note;
    $('c-note').textContent = w.note || '';
    $('forms-btn').hidden = !hasForms(w);

    // Пример: в ежедневном занятии — следующий по кругу при каждом новом показе, в тренировке — случайный
    var n = w.ex.length;
    session.exIdx = session.mode === 'daily'
      ? Core.exampleIndex(state.cards[w.id], n)
      : (n ? Math.floor(Math.random() * n) : -1);
    renderExample(w);

    $('speak-btn').hidden = ruFirst; // в режиме RU→EN озвучка выдала бы ответ
    $('c-answer').hidden = true;
    $('reveal-btn').hidden = session.type;
    $('grades').hidden = true;
    $('practice-grades').hidden = true;

    // Режим ввода: поле для ответа вместо кнопки «Показать перевод»
    session.typed = null;
    session.hintUsed = false;
    $('type-box').hidden = !session.type;
    $('type-controls').hidden = !session.type;
    $('type-next').hidden = true;
    if (session.type) {
      var input = $('type-input');
      input.value = '';
      input.disabled = false;
      input.className = 'type-input';
      input.placeholder = 'Напишите по-английски';
      $('type-mask').hidden = true;
      $('type-result').hidden = true;
      input.focus();
    }

    $('counter').textContent = session.done + ' / ' + session.total;
    $('bar-fill').style.width = (session.done / session.total * 100) + '%';
  }

  function reveal() {
    if (!session || session.revealed || session.type) return;
    if (session.mode === 'daily') {
      var w = byId[session.queue[0]];
      var p = Core.preview(state.cards[w.id] || Core.newCard(today()), today());
      for (var g = 1; g <= 4; g++) $('p' + g).textContent = intervalLabel(p[g]);
      $('grades').hidden = false;
    } else {
      $('practice-grades').hidden = false;
    }
    openAnswer();
  }

  // Показать ответ на карточке (общая часть для карточек и режима ввода)
  function openAnswer() {
    session.revealed = true;
    $('speak-btn').hidden = false;
    $('c-answer').hidden = false;
    $('reveal-btn').hidden = true;

    // После ответа на английское слово можно нажать, чтобы увидеть его формы
    var w2 = byId[session.queue[0]];
    if (session.dir !== 'ru' && hasForms(w2)) {
      $('c-word').className = 'headword tappable';
      $('c-word').setAttribute('role', 'button');
      $('c-word').setAttribute('tabindex', '0');
      $('c-word').setAttribute('aria-label', w2.en + ': показать формы слова');
    }
  }

  // ---------- Режим ввода ответа ----------
  function useHint() {
    if (!session || !session.type || session.typed) return;
    session.hintUsed = true;
    $('type-mask').textContent = Core.answerHint(current().en);
    $('type-mask').hidden = false;
    $('type-input').focus();
  }

  function setTypeResult(kind, html) {
    $('type-result').className = 'type-result ' + kind;
    $('type-result').innerHTML = html;
    $('type-result').hidden = false;
  }

  /*
   * Проверка напечатанного ответа. Оценка ставится сама:
   *   верно → «Хорошо» (с подсказкой — «Трудно»), опечатка → «Трудно», неверно → «Забыл».
   * Кнопка под «Дальше» позволяет поправить: «Было легко» или «Засчитать как верный».
   */
  function checkTyped(giveUp) {
    if (!session || !session.type || session.typed) return;
    var w = current();
    var input = giveUp ? '' : $('type-input').value;
    var res = giveUp ? 'wrong' : Core.checkAnswer(input, w, synonymsOf(w));
    if (res === 'empty') { $('type-input').focus(); return; }
    if (res === 'alt') {
      setTypeResult('alt', 'Тоже подходит по смыслу, но здесь загадано другое слово. Попробуйте ещё раз' +
        (session.hintUsed ? '.' : ' или возьмите подсказку.'));
      $('type-input').select();
      return;
    }
    var g = res === 'ok' ? (session.hintUsed ? 2 : 3) : res === 'typo' ? 2 : 1;
    session.typed = { res: res, grade: g };
    var en = '<b>' + escapeHtml(w.en) + '</b>';
    $('type-input').disabled = true;
    $('type-input').placeholder = giveUp ? 'не знаю' : '';
    $('type-input').className = 'type-input is-' + res + (giveUp ? ' gave-up' : '');
    if (res === 'ok') setTypeResult('ok', session.hintUsed ? 'Верно, с подсказкой.' : 'Верно!');
    else if (res === 'typo') setTypeResult('typo', 'Почти: опечатка. Правильно: ' + en);
    else setTypeResult('wrong', (giveUp ? 'Правильный ответ: ' : 'Неверно. Правильно: ') + en);
    haptic(res === 'wrong' ? 'medium' : 'light');
    openAnswer();

    var label = 'Дальше';
    if (session.mode === 'daily') {
      var days = Core.preview(state.cards[w.id] || Core.newCard(today()), today())[g];
      label += g === 1 ? ' · повторим в этом занятии' : ' · вернётся через ' + intervalLabel(days);
    }
    $('next-btn').textContent = label;
    var over = $('override-btn');
    over.hidden = !(res !== 'ok' || (session.mode === 'daily' && !session.hintUsed));
    over.textContent = res === 'ok' ? 'Было легко — показать реже' : 'Засчитать как верный ответ';
    $('type-controls').hidden = true;
    $('type-next').hidden = false;
    $('next-btn').focus();
  }

  function finishTyped(override) {
    if (!session || !session.typed) return;
    var t = session.typed;
    if (session.mode === 'daily') grade(override ? (t.res === 'ok' ? 4 : 3) : t.grade);
    else practiceAnswer(override || t.res !== 'wrong');
  }

  // ---------- Примеры ----------
  function renderExample(w) {
    var n = w.ex.length, i = session.exIdx;
    $('c-exbox').hidden = n === 0;
    if (!n) return;
    $('c-ex').innerHTML = highlight(w.ex[i][0], w);
    $('c-exru').textContent = w.ex[i][1] || '';
    $('c-exru').hidden = !w.ex[i][1];
    $('ex-next').hidden = n < 2;
    $('ex-pos').textContent = (i + 1) + '/' + n;
  }

  function nextExample() {
    if (!session) return;
    var w = byId[session.queue[0]];
    if (w.ex.length < 2) return;
    session.exIdx = (session.exIdx + 1) % w.ex.length;
    renderExample(w);
  }

  // ---------- Формы слова ----------
  function hasForms(w) { return !!(w.irr || (w.forms && w.forms.length) || (w.gram && w.gram.length)); }

  // Подписи к грамматическим формам, в порядке показа
  var GRAM = [
    ['pl', 'множественное число'], ['unc', 'неисчисляемое: нет множественного числа'],
    ['s3', 'he / she / it'], ['ing', 'форма на -ing'], ['pastpp', 'прошедшее и причастие (V2 = V3)'],
    ['past', 'прошедшее (V2)'], ['pp', 'причастие (V3)'], ['comp', 'сравнительная степень'], ['sup', 'превосходная степень']
  ];

  function irrLine(w) {
    var p = w.irr.split('|');
    return escapeHtml(w.en) + ' → <b>' + escapeHtml(p[0]) + '</b> → <b>' + escapeHtml(p[1]) + '</b>';
  }

  function openForms() {
    if (!session || !session.revealed) return;
    var w = byId[session.queue[0]];
    if (!hasForms(w)) return;
    var html = '<p class="sheet-sub">' + escapeHtml(w.ru) + '</p>' + formsHtml(w) +
      '<p class="small">Нажмите на слово, чтобы услышать произношение.</p>';
    openSheet(w.en, html, false);
  }

  function formsHtml(w) {
    var html = '';
    if (w.irr) {
      var p = w.irr.split('|');
      html += '<div class="group-label">Неправильный глагол</div><div class="irr-row">' +
        irrChip(w.en, 'начальная') + irrChip(p[0], 'прошедшее, V2') + irrChip(p[1], 'причастие, V3') + '</div>';
    }
    var gram = (w.gram || []).slice().sort(function (a, b) {
      return GRAM.findIndex(function (g) { return g[0] === a[1]; }) - GRAM.findIndex(function (g) { return g[0] === b[1]; });
    });
    if (gram.length) {
      html += '<div class="group-label">Грамматические формы</div><ul class="form-list">' +
        gram.map(function (g) {
          var label = (GRAM.filter(function (x) { return x[0] === g[1]; })[0] || ['', g[1]])[1];
          var note = g[2] ? '<span class="f-ru">' + escapeHtml(g[2]) + '</span>' : '';
          if (!g[0]) return '<li><div class="form-row static"><span class="f-en muted">—</span><span class="f-pos">' + label + '</span>' + note + '</div></li>';
          return '<li><button class="form-row" type="button" data-say="' + escapeHtml(g[0]) + '">' +
            '<span class="f-en">' + escapeHtml(g[0]) + '</span><span class="f-pos">' + label + '</span>' + note + '</button></li>';
        }).join('') + '</ul>';
    }
    // Однокоренные без повторов: feeling уже есть среди грамматических форм feel
    var shown = {};
    gram.forEach(function (g) { shown[g[0].toLowerCase()] = true; });
    var family = w.forms.filter(function (f) { return !shown[f[0].toLowerCase()]; });
    if (family.length) {
      html += '<div class="group-label">Однокоренные слова</div><ul class="form-list">' +
        family.map(function (f) {
          return '<li><button class="form-row" type="button" data-say="' + escapeHtml(f[0]) + '">' +
            '<span class="f-en">' + escapeHtml(f[0]) + '</span><span class="f-pos">' + escapeHtml(POS[f[1]] || f[1]) + '</span>' +
            '<span class="f-ru">' + escapeHtml(f[2]) + '</span></button></li>';
        }).join('') + '</ul>';
    }
    return html;
  }

  function irrChip(word, label) {
    return '<button class="irr-chip" type="button" data-say="' + escapeHtml(word) + '"><b>' + escapeHtml(word) + '</b><small>' + label + '</small></button>';
  }

  // ---------- Нижняя панель ----------
  var sheetOnOk = null;
  function openSheet(title, html, withOk, onOk) {
    $('sheet-title').textContent = title;
    $('sheet-body').innerHTML = html;
    $('sheet-ok').hidden = !withOk;
    sheetOnOk = onOk || null;
    $('sheet').hidden = false;
    if (inTelegram) tg.BackButton.show();
    (withOk ? $('sheet-ok') : $('sheet-close')).focus();
  }
  function closeSheet() {
    if ($('sheet').hidden) return;
    $('sheet').hidden = true;
    if (sheetOnOk) { var f = sheetOnOk; sheetOnOk = null; f(); }
    var shown = SCREENS.filter(function (s) { return !$(s).hidden; })[0];
    if (inTelegram && (shown === 'home' || shown === 'done')) tg.BackButton.hide();
  }

  // ---------- Версии ----------
  function releaseHtml(e, current) {
    return '<article class="release' + (current ? ' current' : '') + '">' +
      '<div class="release-meta"><span class="release-v">' + e.v + '</span><span class="release-date">' + formatDate(e.date) + '</span></div>' +
      '<h3>' + escapeHtml(e.title) + '</h3><ul>' +
      e.items.map(function (i) { return '<li>' + escapeHtml(i) + '</li>'; }).join('') + '</ul></article>';
  }

  function renderHistory() {
    $('releases').innerHTML = (window.CHANGELOG || []).map(function (e, k) { return releaseHtml(e, k === 0); }).join('');
  }

  function maybeShowWhatsNew(hadProgress) {
    var list = Core.whatsNew(window.CHANGELOG || [], state.meta.seenVersion, hadProgress);
    var markSeen = function () { state.meta.seenVersion = window.APP_VERSION; save(); };
    if (!list.length) {
      if (state.meta.seenVersion !== window.APP_VERSION) markSeen();
      return;
    }
    var html = list.map(function (e) {
      return '<div><div class="group-label">' + e.v + ' · ' + escapeHtml(e.title) + '</div><ul>' +
        e.items.map(function (i) { return '<li>' + escapeHtml(i) + '</li>'; }).join('') + '</ul></div>';
    }).join('');
    openSheet('Что нового', html, true, markSeen);
  }

  function formatDate(iso) {
    var p = iso.split('-');
    return new Date(+p[0], +p[1] - 1, +p[2]).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
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
      state.meta.priority = state.meta.priority.filter(function (x) { return x !== id; });
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

  // ---------- Словарь ----------
  function queuedIds() {
    return state.meta.priority.filter(function (id) { return byId[id] && !state.cards[id]; });
  }

  function wordStatus(w) {
    var c = state.cards[w.id];
    if (!c) return state.meta.priority.indexOf(w.id) !== -1 ? ['queued', 'в очереди'] : ['new', 'не начато'];
    return c.i >= Core.LEARNED_INTERVAL ? ['learned', 'выучено'] : ['learning', 'в изучении'];
  }

  function openDict() {
    show('dict');
    renderDict();
    $('dict-q').focus();
  }

  function renderDict() {
    var q = $('dict-q').value;
    var ids, info;
    if (!q.trim()) {
      ids = queuedIds();
      info = ids.length
        ? 'Добавлены вами и ждут ближайшего занятия: ' + ids.length + '. Найдите ещё слово по-английски или по-русски.'
        : 'В словаре ' + words.length + ' ' + plural(words.length, 'слово', 'слова', 'слов') + ' и фраз. Введите слово по-английски или по-русски.';
    } else {
      var r = Core.searchWords(words, q, 40);
      ids = r.ids;
      info = r.total === 0 ? 'Ничего не нашлось. Попробуйте начало слова или другой перевод.'
        : r.total > ids.length ? 'Найдено ' + r.total + ', показаны первые ' + ids.length + '. Уточните запрос.'
        : 'Найдено: ' + r.total;
    }
    $('dict-info').textContent = info;
    $('dict-list').innerHTML = ids.map(function (id) {
      var w = byId[id], st = wordStatus(w);
      return '<li><button class="dict-row lv-' + w.lvl + '" type="button" data-id="' + escapeHtml(id) + '">' +
        '<span class="lvl">' + levelLabel(w.lvl) + '</span>' +
        '<span class="d-main"><span class="d-en">' + escapeHtml(w.en) + '</span><span class="d-ru">' + escapeHtml(w.ru) + '</span></span>' +
        '<span class="d-status st-' + st[0] + '">' + st[1] + '</span></button></li>';
    }).join('');
  }

  var sheetWordId = null;
  function openWordSheet(id) {
    var w = byId[id];
    if (!w) return;
    openSheet(w.en, wordSheetHtml(w), false);
    sheetWordId = id;
  }

  function wordSheetHtml(w) {
    var c = state.cards[w.id], day = today(), st = wordStatus(w);
    var status, action = '';
    if (st[0] === 'new') {
      status = 'Вы ещё не начинали это слово.';
      action = '<button class="primary" type="button" data-act="add">Добавить в изучение</button>' +
        '<p class="small">Слово появится первым в ближайшем занятии, сверх дневной нормы новых слов.</p>';
    } else if (st[0] === 'queued') {
      status = 'Добавлено. Появится первым в ближайшем занятии.';
      action = '<button class="ghost" type="button" data-act="remove">Убрать из очереди</button>';
    } else if (c.d <= day) {
      status = (st[0] === 'learned' ? 'Выучено' : 'В изучении') + '. Уже есть в сегодняшнем занятии.';
    } else {
      status = (st[0] === 'learned' ? 'Выучено' : 'В изучении') + '. Следующий повтор через ' + intervalLabel(c.d - day) + '.';
      action = '<button class="ghost" type="button" data-act="review">Повторить в ближайшем занятии</button>';
    }
    var html = '<div class="ws-meta lv-' + w.lvl + '"><span class="lvl">' + levelLabel(w.lvl) + '</span>' +
      '<span class="pos">' + (POS[w.pos] || '') + '</span>' +
      '<button class="speak" type="button" data-say="' + escapeHtml(w.en) + '">' + $('speak-btn').innerHTML + '</button></div>' +
      '<p class="ws-ru">' + escapeHtml(w.ru) + '</p>' +
      (w.irr ? '<p class="irr">' + irrLine(w) + '</p>' : '') +
      '<div class="ws-status st-' + st[0] + '"><p>' + status + '</p>' + action + '</div>';
    if (w.ex.length) {
      html += '<div class="group-label">Примеры</div>' + w.ex.map(function (e) {
        return '<div class="example-box"><p class="example">' + highlight(e[0], w) + '</p>' +
          (e[1] ? '<p class="example-ru">' + escapeHtml(e[1]) + '</p>' : '') + '</div>';
      }).join('');
    }
    if (w.note) html += '<p class="note">' + escapeHtml(w.note) + '</p>';
    return html + formsHtml(w);
  }

  function wordAction(act) {
    var id = sheetWordId, w = byId[id];
    if (!w) return;
    var pr = state.meta.priority.filter(function (x) { return x !== id; });
    if (act === 'add') pr.push(id);
    state.meta.priority = pr;
    if (act === 'review' && state.cards[id]) state.cards[id] = Object.assign({}, state.cards[id], { d: today() });
    haptic('light');
    save();
    $('sheet-body').innerHTML = wordSheetHtml(w);
    if (!$('dict').hidden) renderDict();
  }

  // ---------- Резервная копия ----------
  function backupText() { return JSON.stringify(Core.makeBackup(state, window.APP_VERSION)); }

  function openBackup() {
    var n = Object.keys(state.cards).length, m = state.custom.length;
    openSheet('Резервная копия',
      '<p>В копию попадут ' + n + ' ' + plural(n, 'слово', 'слова', 'слов') + ' с прогрессом, ' + m + ' ' +
      plural(m, 'слово', 'слова', 'слов') + ' из уроков, серия дней и настройки.</p>' +
      '<div class="sheet-actions"><button class="primary" type="button" data-act="download">Скачать файл</button>' +
      '<button class="ghost" type="button" data-act="copy">Скопировать текст</button></div>' +
      '<p class="import-result" id="backup-msg" role="status"></p>' +
      '<p class="small">В Telegram на телефоне файл может не скачаться. Тогда нажмите «Скопировать текст» и отправьте его себе в «Избранное». Чтобы восстановить, этот текст достаточно вставить.</p>',
      false);
  }

  function backupMsg(text, ok) {
    $('backup-msg').textContent = text;
    $('backup-msg').className = 'import-result ' + (ok ? 'ok' : 'err');
  }

  function downloadBackup() {
    try {
      var blob = new Blob([backupText()], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'english-trainer-' + new Date().toISOString().slice(0, 10) + '.json';
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
      backupMsg('Файл отправлен в загрузки. Если ничего не появилось, скопируйте текст.', true);
    } catch (e) {
      backupMsg('Скачать не получилось. Скопируйте текст.', false);
    }
  }

  function copyBackup() {
    var text = backupText();
    var fallback = function () {
      backupMsg('Автоматически скопировать не получилось. Текст выделен ниже — скопируйте его.', false);
      var ta = document.createElement('textarea');
      ta.rows = 5; ta.readOnly = true; ta.value = text; ta.id = 'backup-text';
      $('backup-msg').after(ta);
      ta.focus(); ta.select();
    };
    try {
      navigator.clipboard.writeText(text).then(function () {
        backupMsg('Скопировано. Отправьте текст себе в «Избранное» Telegram или сохраните в заметки.', true);
      }, fallback);
    } catch (e) { fallback(); }
  }

  var pendingRestore = null;
  function openRestore() {
    pendingRestore = null;
    openSheet('Восстановить прогресс',
      '<p class="small">Выберите файл копии или вставьте её текст. Прогресс, который сейчас в приложении, будет заменён.</p>' +
      '<button class="ghost" type="button" data-act="pick">Выбрать файл</button>' +
      '<textarea id="restore-text" rows="5" spellcheck="false" placeholder="Или вставьте текст копии"></textarea>' +
      '<button class="primary" type="button" data-act="check-backup">Проверить копию</button>' +
      '<div id="restore-out" class="restore-out" role="status"></div>',
      false);
  }

  function checkBackup() {
    var r = Core.parseBackup($('restore-text').value);
    var out = $('restore-out');
    pendingRestore = null;
    if (!r.ok) { out.innerHTML = '<p class="import-result err">' + escapeHtml(r.error) + '</p>'; return; }
    pendingRestore = r.state;
    var i = r.info, now = Object.keys(state.cards).length;
    var when = i.saved ? new Date(i.saved).toLocaleString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'без даты';
    out.innerHTML = '<p class="import-result ok">Копия от ' + escapeHtml(when) + ': ' + i.cards + ' ' + plural(i.cards, 'слово', 'слова', 'слов') +
      ' с прогрессом (выучено ' + i.learned + '), ' + i.custom + ' из уроков, рекорд серии ' + i.best + '.</p>' +
      '<div class="confirm"><span>Заменить текущий прогресс (' + now + ' ' + plural(now, 'слово', 'слова', 'слов') + ') этой копией?</span>' +
      '<div class="confirm-actions"><button class="danger-solid" type="button" data-act="apply-backup">Заменить</button></div></div>';
  }

  function applyBackup() {
    if (!pendingRestore) return;
    applySaved(pendingRestore);
    pendingRestore = null;
    state.meta.seenVersion = window.APP_VERSION;
    indexWords();
    save();
    renderHome();
    var n = Object.keys(state.cards).length;
    openSheet('Прогресс восстановлен', '<p>Восстановлено ' + n + ' ' + plural(n, 'слово', 'слова', 'слов') + ' с прогрессом и ваши настройки.</p>', true);
  }

  function readRestoreFile() {
    var f = $('restore-file').files[0];
    if (!f) return;
    var reader = new FileReader();
    reader.onload = function () {
      if ($('restore-text')) { $('restore-text').value = String(reader.result); checkBackup(); }
      $('restore-file').value = '';
    };
    reader.readAsText(f);
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
    SCREENS.forEach(function (s) { $(s).hidden = s !== name; });
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

  // Выделяем слово в примере в любой его форме: feel → felt, child → children, turn down → turned it down
  function highlight(example, w) {
    var r = Core.findWord(example, Core.wordVariants(w));
    if (!r) return escapeHtml(example);
    return escapeHtml(example.slice(0, r.start)) + '<b>' + escapeHtml(example.slice(r.start, r.end)) + '</b>' + escapeHtml(example.slice(r.end));
  }

  // ---------- Кнопки и клавиатура ----------
  $('start-btn').onclick = function () { startDaily(0); };
  $('practice-btn').onclick = function () { show('practice'); renderPractice(); };
  $('lessons-btn').onclick = function () { show('lessons'); renderLessons(); };
  $('dict-btn').onclick = openDict;
  $('dict-q').oninput = renderDict;
  $('dict-list').onclick = function (e) {
    var row = e.target.closest('.dict-row');
    if (row) openWordSheet(row.getAttribute('data-id'));
  };
  $('type-toggle').onchange = function () { setTypeMode($('type-toggle').checked); };
  $('pr-type-toggle').onchange = function () { setTypeMode($('pr-type-toggle').checked); renderPractice(); };
  $('check-btn').onclick = function () { checkTyped(false); };
  $('giveup-btn').onclick = function () { checkTyped(true); };
  $('hint-btn').onclick = useHint;
  $('next-btn').onclick = function () { finishTyped(false); };
  $('override-btn').onclick = function () { finishTyped(true); };
  $('backup-btn').onclick = openBackup;
  $('restore-btn').onclick = openRestore;
  $('restore-file').onchange = readRestoreFile;
  $('pr-start').onclick = startPractice;
  $('import-btn').onclick = importWords;
  $('copy-ask').onclick = copyAsk;
  Array.prototype.forEach.call(document.querySelectorAll('[data-home]'), function (b) { b.onclick = goHome; });

  $('history-btn').onclick = function () { show('history'); renderHistory(); };
  $('reveal-btn').onclick = reveal;
  $('card').onclick = function (e) {
    if (e.target.closest('.speak, .link-btn, .forms-btn, .type-box')) return;
    if (session && session.revealed && e.target.closest('.headword.tappable')) { openForms(); return; }
    reveal();
  };
  $('c-word').addEventListener('keydown', function (e) {
    if ((e.key === 'Enter' || e.key === ' ') && $('c-word').classList.contains('tappable')) { e.preventDefault(); e.stopPropagation(); openForms(); }
  });
  $('ex-next').onclick = nextExample;
  $('forms-btn').onclick = openForms;
  $('sheet-close').onclick = closeSheet;
  $('sheet-ok').onclick = closeSheet;
  $('sheet').onclick = function (e) {
    if (e.target === $('sheet')) { closeSheet(); return; }
    var say = e.target.closest('[data-say]');
    if (say) { speak(say.getAttribute('data-say')); return; }
    var act = e.target.closest('[data-act]');
    if (!act) return;
    var a = act.getAttribute('data-act');
    if (a === 'add' || a === 'remove' || a === 'review') wordAction(a);
    else if (a === 'download') downloadBackup();
    else if (a === 'copy') copyBackup();
    else if (a === 'pick') $('restore-file').click();
    else if (a === 'check-backup') checkBackup();
    else if (a === 'apply-backup') applyBackup();
  };
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
    state.meta.seenVersion = window.APP_VERSION;
    save();
    $('reset-confirm').hidden = true; $('reset-btn').hidden = false;
    renderHome();
  };

  document.addEventListener('keydown', function (e) {
    if (!$('sheet').hidden) { if (e.key === 'Escape') closeSheet(); return; }
    if (!session) return;
    if (session.type) {
      if (e.target.tagName === 'BUTTON' && e.target.id !== 'next-btn') return; // Enter на кнопке нажимает её саму
      if (e.key === 'Enter') { e.preventDefault(); session.typed ? finishTyped(false) : checkTyped(false); }
      return;
    }
    if (e.target === $('c-word') && (e.key === 'Enter' || e.key === ' ')) return;
    if (e.code === 'Space' || e.key === 'Enter') { e.preventDefault(); reveal(); return; }
    if (session.mode === 'daily' && /^[1-4]$/.test(e.key)) grade(Number(e.key));
    if (session.mode === 'practice' && (e.key === '1' || e.key === '2')) practiceAnswer(e.key === '2');
  });

  // ---------- Запуск ----------
  // Сохранённое состояние (из хранилища или резервной копии) → state, с настройками по умолчанию для новых полей
  function applySaved(saved) {
    var meta = saved.meta || {};
    state.cards = saved.cards || {};
    state.custom = (saved.custom || []).map(Core.normalizeCustom);
    state.meta = Object.assign(freshMeta(), meta);
    state.meta.settings = Object.assign(freshMeta().settings, meta.settings);
    state.meta.practice = Object.assign(freshMeta().practice, meta.practice);
    if (!Array.isArray(state.meta.priority)) state.meta.priority = [];
    if (!Array.isArray(state.meta.settings.levels) || !state.meta.settings.levels.length) state.meta.settings.levels = LEVELS.slice();
    if (!Array.isArray(state.meta.practice.levels)) state.meta.practice.levels = LEVELS.slice();
  }

  indexWords();
  AppStorage.load().then(function (saved) {
    var hadProgress = false;
    if (saved && saved.cards && saved.meta) {
      applySaved(saved);
      hadProgress = Object.keys(state.cards).length > 0 || state.custom.length > 0;

      // До 1.2.0 уровня B2 не было. Кто не трогал уровни (выбраны все старые), тому включаем B2.
      if (!saved.meta.seenVersion) {
        [state.meta.settings, state.meta.practice].forEach(function (s) {
          if (['A1', 'A2', 'B1'].every(function (lv) { return s.levels.indexOf(lv) !== -1; }) && s.levels.indexOf('B2') === -1 && LEVELS.indexOf('B2') !== -1) {
            s.levels = s.levels.concat('B2');
          }
        });
      }
    }
    indexWords();
    renderHome();
    maybeShowWhatsNew(hadProgress);
  });
  renderHome();
})();
