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
  assert.equal(Core.answerHint("What's up?"), "W___'s u_?");
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

console.log(`\nВсе тесты пройдены: ${passed}`);
