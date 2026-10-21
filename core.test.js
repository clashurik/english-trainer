// Автотесты логики. Запуск: node tests/core.test.js
const assert = require('node:assert/strict');
const Core = require('../js/core.js');
const WORDS = require('../js/words.js');

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok  ' + name); }

const DAY = 20000;

test('словарь: уникальные id и все поля заполнены', () => {
  const ids = new Set();
  for (const w of WORDS) {
    assert.ok(!ids.has(w.id), 'дубликат ' + w.id);
    ids.add(w.id);
    for (const k of ['en', 'ru', 'pos', 'lvl', 'ex', 'exRu']) assert.ok(w[k], w.id + ': пустое поле ' + k);
    assert.match(w.lvl, /^(A1|A2|B1|B2)$/);
    assert.match(w.pos, /^(n|v|adj|adv|ph)$/);
  }
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

console.log(`\nВсе тесты пройдены: ${passed}`);
