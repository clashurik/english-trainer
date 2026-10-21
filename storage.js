/*
 * storage.js — где хранится прогресс.
 *
 * Внутри Telegram используем CloudStorage: это облачное хранилище, которое Telegram
 * даёт каждому Mini App. Прогресс привязан к вашему аккаунту и виден с любого устройства.
 * Ограничения Telegram: до 1024 ключей, значение до 4096 символов. Поэтому прогресс
 * режется на куски по 4000 символов: ключи c0, c1, c2… и ключ n с их количеством.
 *
 * Вне Telegram (обычный браузер) прогресс хранится в памяти браузера (localStorage).
 * Копия в localStorage ведётся и внутри Telegram — на случай, если облако недоступно.
 */
(function (root) {
  'use strict';

  var LOCAL_KEY = 'english-trainer-v1';
  var CHUNK = 4000;

  function tgCloud() {
    var tg = root.Telegram && root.Telegram.WebApp;
    if (!tg || !tg.initData || !tg.CloudStorage) return null;
    if (tg.isVersionAtLeast && !tg.isVersionAtLeast('6.9')) return null;
    return tg.CloudStorage;
  }

  // Превращаем функции CloudStorage с колбэками в Promise, чтобы писать async/await.
  function cloudGet(cs, keys) {
    return new Promise(function (resolve, reject) {
      cs.getItems(keys, function (err, values) { err ? reject(err) : resolve(values || {}); });
    });
  }
  function cloudSet(cs, key, value) {
    return new Promise(function (resolve, reject) {
      cs.setItem(key, value, function (err) { err ? reject(err) : resolve(); });
    });
  }

  function readLocal() {
    try {
      var raw = root.localStorage.getItem(LOCAL_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  function writeLocal(state) {
    try { root.localStorage.setItem(LOCAL_KEY, JSON.stringify(state)); } catch (e) { /* хранилище недоступно — не страшно */ }
  }

  async function load() {
    var cs = tgCloud();
    if (cs) {
      try {
        var head = await cloudGet(cs, ['n', 'meta']);
        var n = parseInt(head.n, 10) || 0;
        if (n > 0 && head.meta) {
          var keys = [];
          for (var k = 0; k < n; k++) keys.push('c' + k);
          var parts = await cloudGet(cs, keys);
          var data = JSON.parse(keys.map(function (key) { return parts[key] || ''; }).join(''));
          var meta = JSON.parse(head.meta);
          // Новый формат: { c: прогресс, w: слова из уроков }. Старый (v1): просто прогресс.
          if (data && data.c) return { cards: data.c, custom: data.w || [], meta: meta };
          return { cards: data, custom: [], meta: meta };
        }
      } catch (e) {
        console.warn('CloudStorage недоступен, берём локальную копию', e);
      }
    }
    return readLocal();
  }

  var timer = null;
  // Сохраняем не сразу, а через полсекунды тишины: так при быстрых ответах не будет десятков записей.
  function save(state) {
    writeLocal(state);
    clearTimeout(timer);
    timer = setTimeout(function () { saveCloud(state); }, 500);
  }

  async function saveCloud(state) {
    var cs = tgCloud();
    if (!cs) return;
    try {
      var json = JSON.stringify({ c: state.cards, w: state.custom || [] });
      var n = Math.max(1, Math.ceil(json.length / CHUNK));
      for (var k = 0; k < n; k++) await cloudSet(cs, 'c' + k, json.slice(k * CHUNK, (k + 1) * CHUNK));
      await cloudSet(cs, 'meta', JSON.stringify(state.meta));
      await cloudSet(cs, 'n', String(n)); // пишем последним: пока n старое, читается старая целая версия
    } catch (e) {
      console.warn('Не удалось сохранить в CloudStorage', e);
    }
  }

  async function reset() {
    try { root.localStorage.removeItem(LOCAL_KEY); } catch (e) { /* ничего */ }
    var cs = tgCloud();
    if (cs) { try { await cloudSet(cs, 'n', '0'); } catch (e) { /* ничего */ } }
  }

  root.AppStorage = { load: load, save: save, reset: reset, isCloud: function () { return !!tgCloud(); } };
})(typeof window !== 'undefined' ? window : globalThis);
