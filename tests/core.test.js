// Автотесты логики. Запуск: node tests/core.test.js
const assert = require('node:assert/strict');
const Core = require('../core.js');
const WORDS = require('../words.js');

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok  ' + name); }

const DAY = 20000;

test('словарь: уникальные id и все поля заполнены', () => {
  const ids = new Set();
  for (const w of WORDS) {
    assert.ok(!ids.has(w.id), 'дубликат ' + w.id);
    ids.add(w.id);
    for (const k of ['en', 'ru', 'pos', 'lvl']) assert.ok(w[k], w.id + ': пустое поле ' + k);
    assert.match(w.lvl, /^(A1|A2|B1|B2)$/);
    assert.match(w.pos, /^(n|v|adj|adv|ph)$/);
    assert.ok(Array.isArray(w.ex) && w.ex.length >= 1, w.id + ': нет примеров');
    assert.ok(Array.isArray(w.forms), w.id + ': forms не список');
  }
});

test('словарь: все 120 слов первой версии на месте (к ним привязан прогресс)', () => {
  const ids = new Set(WORDS.map(w => w.id));
  const old = require('../data/work/existing-120.json');
  for (const w of old) assert.ok(ids.has(w.id), 'пропало слово ' + w.en);
});

test('новое слово: «Хорошо» → завтра, «Легко» → через 4 дня', () => {
  const c = Core.newCard(DAY);
  assert.equal(Core.schedule(c, 3, DAY).d, DAY + 1);
  assert.equal(Core.schedule(c, 4, DAY).d, DAY + 4);
});

test('«Забыл» сбрасывает слово и оставляет его на сегодня', () => {
  let c = Core.newCard(DAY);
  c = Core.schedule(c, 3, DAY);
  c = Core.schedule(c, 3, DAY + 1);
  c = Core.schedule(c, 1, DAY + 4);
  assert.equal(c.r, 0);
  assert.equal(c.d, DAY + 4);
  assert.equal(c.l, 1);
  assert.equal(c.e, 230);
});

test('интервалы растут при ответах «Хорошо»: 1 → 3 → 8 → 20 → 50', () => {
  let c = Core.newCard(DAY), day = DAY;
  const seen = [];
  for (let k = 0; k < 5; k++) { c = Core.schedule(c, 3, day); seen.push(c.i); day = c.d; }
  assert.deepEqual(seen, [1, 3, 8, 20, 50]);
});

test('«Трудно» растёт медленнее «Хорошо», «Легко» быстрее', () => {
  let c = Core.newCard(DAY);
  c = Core.schedule(c, 3, DAY); c = Core.schedule(c, 3, DAY + 1);
  const p = Core.preview(c, DAY + 4);
  assert.ok(p[2] < p[3] && p[3] < p[4], JSON.stringify(p));
  assert.ok(p[2] > c.i, 'даже «Трудно» не уменьшает интервал');
});

test('лёгкость не опускается ниже 1.3', () => {
  let c = Core.newCard(DAY);
  for (let k = 0; k < 20; k++) c = Core.schedule(c, 1, DAY);
  assert.equal(c.e, 130);
});

test('очередь: новые слова только из выбранных уровней и в пределах лимита', () => {
  const settings = { newPerDay: 5, levels: ['B1'] };
  const q = Core.buildQueue(WORDS, {}, settings, {}, DAY);
  assert.equal(q.fresh.length, 5);
  assert.ok(q.fresh.every(id => WORDS.find(w => w.id === id).lvl === 'B1'));
});

test('очередь: лимит учитывает уже взятые сегодня новые слова', () => {
  const q = Core.buildQueue(WORDS, {}, { newPerDay: 10, levels: ['A1'] }, { newDay: DAY, newDone: 7 }, DAY);
  assert.equal(q.fresh.length, 3);
});

test('очередь: слова с наступившим сроком идут в повторение, будущие — нет', () => {
  const cards = { time: { r: 1, i: 1, e: 250, d: DAY, l: 0 }, friend: { r: 1, i: 3, e: 250, d: DAY + 2, l: 0 } };
  const q = Core.buildQueue(WORDS, cards, { newPerDay: 0, levels: ['A1'] }, {}, DAY);
  assert.deepEqual(q.due, ['time']);
});

test('смешивание: одно новое слово после каждых трёх повторений', () => {
  assert.deepEqual(Core.mixQueue(['a', 'b', 'c', 'd'], ['N1', 'N2']), ['a', 'b', 'c', 'N1', 'd', 'N2']);
});

test('серия дней: растёт подряд, сбрасывается после пропуска', () => {
  let m = {};
  m = Core.completeDay(m, DAY); assert.equal(m.streak, 1);
  m = Core.completeDay(m, DAY); assert.equal(m.streak, 1, 'второе занятие за день не считается');
  m = Core.completeDay(m, DAY + 1); assert.equal(m.streak, 2);
  assert.equal(Core.currentStreak(m, DAY + 2), 2, 'вчера занимались — серия ещё жива');
  assert.equal(Core.currentStreak(m, DAY + 3), 0, 'пропуск — серия сгорела');
  m = Core.completeDay(m, DAY + 3); assert.equal(m.streak, 1);
  assert.equal(m.best, 2);
});

test('статистика: выученным считается слово с интервалом от 21 дня', () => {
  const cards = { time: { r: 4, i: 21, e: 250, d: 0, l: 0 }, friend: { r: 2, i: 8, e: 250, d: 0, l: 0 } };
  const s = Core.stats(WORDS, cards);
  assert.equal(s.learned, 1);
  assert.equal(s.learning, 1);
  assert.equal(s.byLevel.A1.seen, 2);
});

test('тренировка: «изученные» — только слова с прогрессом', () => {
  const cards = { time: { r: 1, i: 1, e: 250, d: 0, l: 0 }, 'by the way': { r: 1, i: 1, e: 250, d: 0, l: 0 } };
  assert.deepEqual(Core.practicePool(WORDS, cards, { set: 'studied', kind: 'all' }).sort(), ['by the way', 'time']);
});

test('тренировка: фильтры «трудные», «только фразы», уровни', () => {
  const cards = {
    time: { r: 1, i: 1, e: 250, d: 0, l: 1 },        // была ошибка
    friend: { r: 3, i: 8, e: 250, d: 0, l: 0 },      // всё хорошо
    'by the way': { r: 1, i: 1, e: 235, d: 0, l: 0 } // даётся тяжело
  };
  assert.deepEqual(Core.practicePool(WORDS, cards, { set: 'hard', kind: 'all' }).sort(), ['by the way', 'time']);
  assert.deepEqual(Core.practicePool(WORDS, cards, { set: 'studied', kind: 'phrases' }), ['by the way']);
  assert.deepEqual(Core.practicePool(WORDS, cards, { set: 'studied', kind: 'all', levels: ['A1'] }).sort(), ['friend', 'time']);
});

test('тренировка: «из уроков» берёт только свои слова, даже не изученные', () => {
  const mine = [{ id: 'commute', en: 'commute', ru: 'ездить на работу', pos: '', lvl: 'MY', ex: '', exRu: '' }];
  assert.deepEqual(Core.practicePool(mine.concat(WORDS), {}, { set: 'lessons', kind: 'all', levels: ['A1'] }), ['commute']);
});

test('перемешивание не теряет и не дублирует слова', () => {
  const a = ['a', 'b', 'c', 'd', 'e'];
  const s = Core.shuffle(a);
  assert.deepEqual(s.slice().sort(), a);
  assert.deepEqual(a, ['a', 'b', 'c', 'd', 'e'], 'исходный массив не меняется');
});

test('импорт: разбирает строки, примеры необязательны, маркеры списка убираются', () => {
  const r = Core.parseImport([
    '# слова урока 3',
    'commute | ездить на работу | I commute by train. | Я езжу на работу на поезде.',
    '- run out of | закончиться (о запасах)',
    '2. errand\tпоручение, дело',
    '',
    'просто строка без разделителя'
  ].join('\n'), {});
  assert.equal(r.words.length, 3);
  assert.deepEqual(r.words.map(w => w.en), ['commute', 'run out of', 'errand']);
  assert.deepEqual(r.words[0].ex, [['I commute by train.', 'Я езжу на работу на поезде.']]);
  assert.deepEqual(r.words[2].ex, [], 'без примера — пустой список');
  assert.equal(r.words[1].pos, 'ph', 'выражение из нескольких слов — фраза');
  assert.ok(r.words.every(w => w.lvl === 'MY'));
  assert.equal(r.bad.length, 1);
});

test('импорт: повторы и уже существующие слова пропускаются', () => {
  const r = Core.parseImport('Borrow | одалживать\ncommute | ездить\ncommute | ездить', { borrow: true });
  assert.deepEqual(r.words.map(w => w.id), ['commute']);
  assert.deepEqual(r.skipped, ['Borrow', 'commute']);
});

test('слова из уроков версии 1.1.0 переводятся в новый формат', () => {
  const old = { id: 'commute', en: 'commute', ru: 'ездить', pos: '', lvl: 'MY', ex: 'I commute.', exRu: 'Я езжу.' };
  assert.deepEqual(Core.normalizeCustom(old).ex, [['I commute.', 'Я езжу.']]);
  assert.deepEqual(Core.normalizeCustom({ id: 'x', en: 'x', ru: 'икс', ex: '', exRu: '' }).ex, []);
  const fresh = Core.parseImport('errand | дело', {}).words[0];
  assert.deepEqual(Core.normalizeCustom(fresh), fresh, 'новый формат не меняется');
});

test('своё слово из урока заменяет такое же слово словаря, без дубликатов', () => {
  const mine = [{ id: 'borrow', en: 'borrow', ru: 'мой перевод', lvl: 'MY' }];
  const all = Core.mergeWords(mine, WORDS);
  assert.equal(all.filter(w => w.id === 'borrow').length, 1);
  assert.equal(all[0].ru, 'мой перевод');
  assert.equal(all.length, WORDS.length);
});

test('примеры меняются по кругу с каждым показом', () => {
  assert.equal(Core.exampleIndex(null, 3), 0, 'новое слово — первый пример');
  assert.equal(Core.exampleIndex({ r: 1, l: 0 }, 3), 1);
  assert.equal(Core.exampleIndex({ r: 2, l: 0 }, 3), 2);
  assert.equal(Core.exampleIndex({ r: 2, l: 1 }, 3), 0);
  assert.equal(Core.exampleIndex({ r: 5, l: 0 }, 1), 0, 'один пример — всегда он');
  assert.equal(Core.exampleIndex({ r: 1, l: 0 }, 0), -1, 'примеров нет');
});

test('сравнение версий', () => {
  assert.equal(Core.compareVersions('1.2.0', '1.1.0'), 1);
  assert.equal(Core.compareVersions('1.0.1', '1.0.1'), 0);
  assert.equal(Core.compareVersions('1.10.0', '1.9.3'), 1, 'числа, а не строки');
  assert.equal(Core.compareVersions('1.0.0', '1.0.1'), -1);
});

test('«Что нового»: кому и что показывать', () => {
  const log = require('../changelog.js');
  assert.deepEqual(Core.whatsNew(log, null, false), [], 'новичку ничего');
  assert.deepEqual(Core.whatsNew(log, null, true).map(e => e.v), [log[0].v], 'старому пользователю — последнюю');
  assert.deepEqual(Core.whatsNew(log, log[0].v, true), [], 'уже видел — ничего');
  assert.deepEqual(Core.whatsNew(log, '1.0.0', true).map(e => e.v), log.filter(e => e.v !== '1.0.0').map(e => e.v));
});

test('история версий: по убыванию, без повторов, у каждой даты и пункты', () => {
  const log = require('../changelog.js');
  for (let i = 1; i < log.length; i++) assert.equal(Core.compareVersions(log[i - 1].v, log[i].v), 1);
  for (const e of log) { assert.match(e.date, /^\d{4}-\d{2}-\d{2}$/); assert.ok(e.items.length); }
});

test('подсветка: слово находится в любой форме', () => {
  const at = (ex, w) => { const r = Core.findWord(ex, Core.wordVariants(w)); return r && ex.slice(r.start, r.end); };
  assert.equal(at('She felt tired after the long flight.', { en: 'feel', irr: 'felt|felt' }), 'felt');
  assert.equal(at('I found the exam quite easy.', { en: 'find', irr: 'found|found' }), 'found');
  assert.equal(at('She told me about her trip.', { en: 'tell', irr: 'told|told' }), 'told');
  assert.equal(at('I learnt a lot.', { en: 'learn', irr: 'learnt/learned|learnt/learned' }), 'learnt');
  assert.equal(at('I need to change my password.', { en: 'change' }), 'change');
  assert.equal(at('Their children are at school.', { en: 'child', gram: [['children', 'pl']] }), 'children');
  assert.equal(at('He tried again.', { en: 'try', gram: [] }), 'tried', 'по основе, даже без gram');
  assert.equal(at('She turned the offer down.', { en: 'turn down', gram: [['turned down', 'pastpp']] }), 'turned the offer down');
  assert.equal(at('Who looks after your dog?', { en: 'look after sb', gram: [['looks after', 's3']] }), 'looks after');
  assert.equal(at('Hi, Anna! How are you?', { en: 'How are you?' }), 'How are you');
  assert.equal(at('A cat sat on the mat.', { en: 'at' }), null, 'внутри другого слова не ищем');
  assert.equal(at("Most people aren't aware of this problem.", { en: 'aware', gram: [['more aware', 'comp'], ['most aware', 'sup']] }), 'aware',
    'у формы одного слова нельзя перепрыгивать через слова');
  assert.equal(at('Here you are, your coffee.', { en: 'Here you are' }), 'Here you are', 'фраза целиком, со служебными словами');
  assert.equal(at('Everyone makes mistakes.', { en: 'make a mistake', gram: [['makes a mistake', 's3']] }), 'makes mistakes');
  assert.equal(at("Sorry I'm late for the meeting.", { en: 'be late for', gram: [] }), 'late for');
});

test('подсветка: каждый пример словаря содержит своё слово', () => {
  const missed = [];
  for (const w of WORDS) for (const [ex] of w.ex) if (!Core.findWord(ex, Core.wordVariants(w))) missed.push(w.en + ': ' + ex);
  assert.equal(missed.length, 0, 'слово не найдено в примерах:\n' + missed.join('\n'));
});

// ---------- 1.3.0 ----------
test('ввод ответа: не придираемся к регистру, знакам, to, артиклю, sb/sth, сокращениям', () => {
  const ok = (input, en) => assert.equal(Core.checkAnswer(input, { en }), 'ok', input + ' → ' + en);
  ok('Borrow', 'borrow');
  ok('  to borrow ', 'borrow');
  ok('look after', 'look after sb');
  ok('take for granted', 'take sth for granted');
  ok('what is wrong', "What's wrong?");
  ok("what’s the point", "What's the point?");
  ok('how are you', 'How are you?');
  ok('an apple', 'apple');
  ok('well-known', 'well known');
  assert.equal(Core.checkAnswer('', { en: 'borrow' }), 'empty');
  assert.equal(Core.checkAnswer('  ?! ', { en: 'borrow' }), 'empty');
});

test('ввод ответа: опечатка, синоним, ошибка', () => {
  assert.equal(Core.checkAnswer('borow', { en: 'borrow' }), 'typo');
  assert.equal(Core.checkAnswer('brrow', { en: 'borrow' }), 'typo');
  assert.equal(Core.checkAnswer('bring', { en: 'borrow' }), 'wrong');
  assert.equal(Core.checkAnswer('cat', { en: 'car' }), 'wrong', 'в коротких словах опечаток не прощаем');
  assert.equal(Core.checkAnswer('enviroment', { en: 'environment' }), 'typo');
  assert.equal(Core.checkAnswer('envirnmnt', { en: 'environment' }), 'typo', 'в длинных словах — до двух букв');
  assert.equal(Core.checkAnswer('envrnmnt', { en: 'environment' }), 'wrong');
  assert.equal(Core.checkAnswer('lend', { en: 'borrow' }, ['lend']), 'alt');
  assert.equal(Core.checkAnswer('borrow', { en: 'borrow' }, ['borrow']), 'ok', 'верный ответ важнее синонима');
});

test('подсказка: первые буквы', () => {
  assert.equal(Core.answerHint('borrow'), 'b_____');
  assert.equal(Core.answerHint('look after sb'), 'l___ a____ …');
  assert.equal(Core.answerHint("What's up?"), "W___'_ u_?");
});

test('поиск: по-английски и по-русски, сначала точные', () => {
  const words = [
    { id: 'borrowing', en: 'borrowing', ru: 'заимствование' },
    { id: 'borrow', en: 'borrow', ru: 'одалживать, брать взаймы' },
    { id: 'take', en: 'take', ru: 'брать' },
    { id: 'look after sb', en: 'look after sb', ru: 'заботиться о ком-то' },
    { id: 'tree', en: 'tree', ru: 'ёлка' }
  ];
  assert.deepEqual(Core.searchWords(words, 'borrow').ids, ['borrow', 'borrowing']);
  assert.deepEqual(Core.searchWords(words, 'брать').ids, ['take', 'borrow'], 'точный перевод выше вхождения');
  assert.deepEqual(Core.searchWords(words, 'after').ids, ['look after sb'], 'по второму слову фразы');
  assert.deepEqual(Core.searchWords(words, 'елка').ids, ['tree'], 'ё = е');
  assert.equal(Core.searchWords(words, '   ').total, 0);
  assert.equal(Core.searchWords(words, 'o', 2).ids.length, 2);
  assert.equal(Core.searchWords(words, 'o', 2).total, 3);
  assert.ok(Core.searchWords(WORDS, 'time').ids[0] === 'time', 'в настоящем словаре time находится первым');
});

test('слова из словаря идут первыми и сверх нормы, изученные выпадают из очереди', () => {
  const words = [{ id: 'a', lvl: 'A1' }, { id: 'b', lvl: 'A1' }, { id: 'c', lvl: 'A1' }, { id: 'z', lvl: 'B2' }];
  const settings = { newPerDay: 2, levels: ['A1'] };
  let q = Core.buildQueue(words, {}, settings, { priority: ['z', 'gone'] }, DAY);
  assert.deepEqual(q.fresh, ['z', 'a', 'b'], 'z первым, даже из невыбранного уровня; несуществующие пропущены');
  q = Core.buildQueue(words, {}, settings, { priority: ['b'] }, DAY);
  assert.deepEqual(q.fresh, ['b', 'a', 'c'], 'без повторов');
  q = Core.buildQueue(words, { z: Core.newCard(DAY) }, settings, { priority: ['z'], newDay: DAY, newDone: 2 }, DAY);
  assert.deepEqual(q.fresh, [], 'начатое слово больше не новое, норма выбрана');
});

test('резервная копия: туда и обратно', () => {
  const state = {
    cards: { time: { r: 3, i: 25, e: 260, d: DAY + 5, l: 1 }, go: { r: 1, i: 1, e: 250, d: DAY, l: 0 } },
    custom: [{ id: 'doomscroll', en: 'doomscroll', ru: 'листать новости', pos: '', lvl: 'MY', ex: [], forms: [], gram: [], irr: null, note: '' }],
    meta: { streak: 4, best: 9, lastDone: DAY, settings: { newPerDay: 15, levels: ['A1'], typeMode: true }, priority: ['go'] }
  };
  const text = JSON.stringify(Core.makeBackup(state, '1.3.0', new Date('2026-10-25T10:00:00Z')));
  const r = Core.parseBackup(text);
  assert.ok(r.ok);
  assert.deepEqual(r.state.cards, state.cards);
  assert.deepEqual(r.state.custom, state.custom);
  assert.deepEqual(r.state.meta, state.meta);
  assert.equal(r.info.cards, 2); assert.equal(r.info.learned, 1); assert.equal(r.info.streak, 4); assert.equal(r.info.custom, 1);
  assert.equal(r.info.saved, '2026-10-25T10:00:00.000Z');
});

test('резервная копия: понятные ошибки на чужом и битом тексте', () => {
  assert.match(Core.parseBackup('{"app":"english-trainer","cards":').error, /повреждён|не целиком/);
  assert.match(Core.parseBackup('{"foo":1}').error, /не резервная копия/);
  assert.match(Core.parseBackup('').error, /повреждён/);
  const broken = JSON.stringify({ app: 'english-trainer', format: 1, cards: { a: { r: 1 } }, meta: {} });
  assert.match(Core.parseBackup(broken).error, /повреждены записи о 1/);
});

test('замечания Тестировщика 1.3.0: апострофы, слоты, настоящие слова, компактная копия', () => {
  const ok = (input, en) => assert.equal(Core.checkAnswer(input, { en }), 'ok', input + ' → ' + en);
  ok('dont worry', "Don't worry");
  ok('whats up', "What's up?");
  ok('im sorry', "I'm sorry");
  ok('its up to you', "It's up to you");
  ok('cant stand', "can't stand");
  ok('I would like', "I'd like");
  ok('id like', "I'd like");
  ok('i do not know', "I don't know");
  ok('ill', 'ill');
  ok('look after him', 'look after sb');
  ok('look after my little sister', 'look after sb');
  ok('take it for granted', 'take sth for granted');
  ok('make up my mind', 'make up your mind');
  ok('in my opinion', 'in my opinion');
  assert.equal(Core.checkAnswer('look', { en: 'look after sb' }), 'wrong');
  assert.equal(Core.checkAnswer('honey', { en: 'money' }, [], { honey: true, money: true }), 'wrong', 'настоящее слово — не опечатка');
  assert.equal(Core.checkAnswer('mony', { en: 'money' }, [], { honey: true, money: true }), 'typo');
  assert.equal(Core.answerHint("I'm sorry"), "I'_ s____");
  assert.equal(Core.answerHint("can't stand"), "c__'_ s____");
  // Компактная копия читается, старая (формат 1, объекты) — тоже
  const cards = { time: { r: 3, i: 25, e: 260, d: 20005, l: 1 } };
  const packed = Core.makeBackup({ cards, custom: [], meta: {} }, '1.3.0');
  assert.deepEqual(packed.cards.time, [3, 25, 260, 20005, 1]);
  assert.deepEqual(Core.parseBackup(JSON.stringify(packed)).state.cards, cards);
  const v1 = JSON.stringify({ app: 'english-trainer', format: 1, cards, meta: { settings: null } });
  const r1 = Core.parseBackup(v1);
  assert.deepEqual(r1.state.cards, cards);
  assert.equal(r1.state.meta.settings, undefined, 'испорченные настройки отбрасываются');
});

test('очередь: добавленные из словаря — в самом начале занятия', () => {
  const q = Core.buildQueue([{ id: 'a', lvl: 'A1' }, { id: 'b', lvl: 'A1' }, { id: 'p', lvl: 'B2' }],
    { a: { r: 1, i: 1, e: 250, d: DAY, l: 0 } }, { newPerDay: 5, levels: ['A1'] }, { priority: ['p'] }, DAY);
  assert.deepEqual(q.priority, ['p']);
  assert.deepEqual(Core.mixQueue(q.due, q.fresh.slice(q.priority.length), q.priority), ['p', 'a', 'b']);
});

test('show: естественная форма слова принимается и показывается', () => {
  const lot = WORDS.find(w => w.id === 'lot');
  assert.equal(lot.show, 'a lot / a lot of');
  assert.doesNotMatch(lot.ru, /[a-z]/i, 'ответ не должен быть в переводе');
  for (const a of ['lot', 'a lot', 'a lot of', 'A LOT OF']) assert.equal(Core.checkAnswer(a, lot), 'ok', a);
  assert.equal(Core.label(lot), 'a lot / a lot of');
  assert.equal(Core.sayText(lot), 'a lot');
  assert.equal(Core.label({ en: 'decide' }), 'decide');
});

// ---------- 1.4.0: занятие без завала ----------
const mk = (n, lvl, pre) => Array.from({ length: n }, (_, k) => ({ id: (pre || lvl) + k, lvl }));
const dueCard = (late, i, e, l) => ({ r: 3, i, e: e || 250, d: DAY - late, l: l || 0 });

test('очередь: повторений не больше потолка размера занятия, остальное — в хвост', () => {
  const ws = mk(100, 'A1'); const cards = {};
  ws.forEach(w => { cards[w.id] = dueCard(1, 10); });
  const q = Core.buildQueue(ws, cards, { size: 'light', levels: ['A1'] }, {}, DAY);
  assert.equal(q.due.length, 20);
  assert.equal(q.backlog, 80);
  const q2 = Core.buildQueue(ws, cards, { size: 'light', levels: ['A1'] }, { revDay: DAY, revDone: 15 }, DAY);
  assert.equal(q2.due.length, 5, 'уже сделанные сегодня повторения вычитаются');
});

test('очередь: первыми идут самые рискованные слова', () => {
  const ws = mk(3, 'A1'); const cards = { A10: dueCard(0, 60), A11: dueCard(10, 5), A12: dueCard(0, 3, 150, 2) };
  const q = Core.buildQueue(ws, cards, { size: 'normal', levels: ['A1'] }, {}, DAY);
  assert.deepEqual(q.due, ['A11', 'A12', 'A10']);
});

test('очередь: при большом хвосте новых слов меньше, при полуторном потолке — ни одного', () => {
  const ws = mk(200, 'A1'); const cards = {};
  const run = n => { const c = {}; ws.slice(0, n).forEach(w => { c[w.id] = dueCard(0, 5); }); return Core.buildQueue(ws, c, { size: 'normal', levels: ['A1'] }, {}, DAY).fresh.length; };
  assert.equal(run(10), 10);
  assert.equal(run(40), 5);
  assert.equal(run(70), 0);
  assert.equal(Core.buildQueue(ws, cards, { size: 'intense', levels: ['A1'] }, {}, DAY).fresh.length, 20);
});

test('очередь: после теста новые слова набираются по долям незнакомых', () => {
  const ws = [...mk(50, 'A1'), ...mk(50, 'A2'), ...mk(50, 'B1'), ...mk(50, 'B2')];
  const vocab = { A1: 0.95, A2: 0.85, B1: 0.6, B2: 0.35 };
  const q = Core.buildQueue(ws, {}, { size: 'intense', levels: ['A1', 'A2', 'B1', 'B2'] }, { vocab }, DAY);
  const by = l => q.fresh.filter(id => id.startsWith(l)).length;
  assert.equal(q.fresh.length, 20);
  assert.ok(by('B2') > by('B1') && by('B1') > by('A2') && by('A2') >= by('A1'), JSON.stringify([by('A1'), by('A2'), by('B1'), by('B2')]));
  assert.ok(by('A1') >= 1, 'базовые слова не пропадают совсем');
  const w = Core.levelWeights(vocab, ['A1', 'A2', 'B1', 'B2']);
  assert.ok(Math.abs(Object.values(w).reduce((a, b) => a + b) - 1) < 1e-9);
  const w2 = Core.levelWeights({ A1: 1, A2: 1, B1: 0, B2: 0.05 }, ['A1', 'A2', 'B1', 'B2']);
  assert.ok(Math.abs(w2.A1 - 0.05) < 1e-9 && Math.abs(w2.A2 - 0.05) < 1e-9, 'минимум 5% у знакомых уровней');
  assert.ok(Math.abs(Object.values(w2).reduce((a, b) => a + b) - 1) < 1e-9);
});

test('очередь: если уровень закончился, места добираются из других', () => {
  const ws = [...mk(1, 'B2'), ...mk(30, 'A2')];
  const q = Core.buildQueue(ws, {}, { size: 'normal', levels: ['A2', 'B2'] }, { vocab: { A2: 0.9, B2: 0.1 } }, DAY);
  assert.equal(q.fresh.length, 10);
});

test('уточнение уровня: знакомое слово двигает долю вверх, незнакомое — вниз', () => {
  assert.ok(Core.calibrate({ B1: 0.5 }, 'B1', true).B1 > 0.5);
  assert.ok(Core.calibrate({ B1: 0.5 }, 'B1', false).B1 < 0.5);
  assert.equal(Core.calibrate(null, 'B1', true), null);
});

test('интервалы: разброс у разных слов и бонус за просрочку', () => {
  const c = { r: 4, i: 30, e: 250, d: DAY, l: 0 };
  const set = new Set(['apple', 'table', 'river', 'dog', 'house', 'quiet'].map(id => Core.schedule(c, 3, DAY, Core.seedOf(id)).i));
  assert.ok(set.size > 1, 'интервалы разъезжаются');
  for (const v of set) assert.ok(v >= 71 && v <= 79, 'разброс не больше 5%: ' + v);
  assert.equal(Core.schedule(c, 3, DAY, 7).i, Core.preview(c, DAY, 7)[3], 'подпись кнопки совпадает с расписанием');
  const late = Core.schedule({ ...c, d: DAY - 20 }, 3, DAY).i;
  assert.ok(late > Core.schedule(c, 3, DAY).i, 'вспомнил после пропуска — интервал больше');
});

test('быстрый режим: только для хорошо выученных слов', () => {
  assert.equal(Core.isQuick({ r: 4, i: 25 }), true);
  assert.equal(Core.isQuick({ r: 2, i: 6 }), false);
  assert.equal(Core.isQuick(undefined), false);
});

// ---------- 1.4.0: словарный тест ----------
const seeded = (n) => () => { n = (n * 16807) % 2147483647; return n / 2147483647; };

test('тест: вопросы по всему словарю корректны — 4 разных варианта, правильный один', () => {
  const rnd = seeded(42);
  let checked = 0;
  for (const [lvl, n] of Core.TEST_PLAN) {
    const ids = Core.testWords(WORDS, lvl, 60, rnd);
    assert.equal(ids.length, 60);
    for (const id of ids) {
      const q = Core.testQuestion(WORDS, id, rnd);
      assert.equal(q.options.length, 4, id);
      assert.equal(new Set(q.options).size, 4, id + ': повтор варианта');
      const w = WORDS.find(x => x.id === id);
      assert.ok(w.ru.startsWith(q.options[q.correct]), id);
      assert.doesNotMatch(q.prompt, /[а-я]/i);
      checked++;
    }
  }
  assert.ok(checked >= 240);
});

test('тест: поправка на угадывание и досрочная остановка', () => {
  assert.equal(Core.testScore({ right: 10, wrong: 0, skip: 0 }), 1);
  assert.equal(Core.testScore({ right: 6, wrong: 3, skip: 1 }), 0.5);
  assert.equal(Core.testScore({ right: 1, wrong: 9, skip: 0 }), 0);
  const r = Core.testResult({ A1: { right: 6, wrong: 0, skip: 0 }, A2: { right: 9, wrong: 0, skip: 1 }, B1: { right: 3, wrong: 3, skip: 5 } });
  assert.deepEqual(r.vocab, { A1: 1, A2: 0.9, B1: 0.18, B2: 0.09 });
  assert.equal(r.level, 'A2');
  assert.equal(Core.testResult({ A1: { right: 1, wrong: 2, skip: 3 } }).level, 'ниже A1');
});

test('тест: знакомое слово получает длинный интервал и попадает в быструю проверку', () => {
  const c = Core.knownCard('decide', DAY);
  assert.ok(Core.isQuick(c));
  assert.ok(c.d >= DAY + 7 && c.d <= DAY + 21);
});

test('огонёк: ступени серии', () => {
  assert.equal(Core.flameTier(0).tier, -1);
  assert.equal(Core.flameTier(1).color, 'orange');
  assert.equal(Core.flameTier(9).next, 10);
  assert.equal(Core.flameTier(10).color, 'teal');
  assert.equal(Core.flameTier(49).color, 'green');
  assert.equal(Core.flameTier(50).color, 'blue');
  assert.equal(Core.flameTier(400).color, 'rainbow');
  assert.equal(Core.flameTier(400).next, null);
});

console.log(`\nВсе тесты пройдены: ${passed}`);
