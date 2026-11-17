const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { webcrypto } = require('node:crypto');

class FakeClassList {
  constructor() { this.values = new Set(); }
  add(value) { this.values.add(value); }
  remove(value) { this.values.delete(value); }
  contains(value) { return this.values.has(value); }
  toggle(value, force) {
    const shouldAdd = force === undefined ? !this.values.has(value) : Boolean(force);
    if (shouldAdd) this.values.add(value); else this.values.delete(value);
    return shouldAdd;
  }
}
class FakeElement {
  constructor() { this.textContent = ''; this.innerHTML = ''; this.classList = new FakeClassList(); this.dataset = {}; this.value = ''; this.listeners = {}; }
  addEventListener(type, callback) { (this.listeners[type] ||= []).push(callback); }
  setAttribute() {}
  removeAttribute() {}
  focus() {}
  click() {}
  appendChild() {}
  remove() {}
}
function makeContext(seed = {}) {
  const store = new Map(Object.entries(seed));
  const localStorage = {
    getItem(key) { return store.has(key) ? store.get(key) : null; },
    setItem(key, value) { store.set(key, String(value)); },
    removeItem(key) { store.delete(key); },
    key(index) { return [...store.keys()][index] ?? null; },
    get length() { return store.size; }
  };
  const elements = new Map();
  const getElement = (key) => { if (!elements.has(key)) elements.set(key, new FakeElement()); return elements.get(key); };
  const document = {
    querySelector(selector) { return getElement(selector); },
    querySelectorAll() { return []; },
    getElementById(id) { return getElement(`#${id}`); },
    addEventListener() {},
    createElement() { return new FakeElement(); },
    body: new FakeElement()
  };
  const window = {
    localStorage,
    crypto: webcrypto,
    isSecureContext: false,
    addEventListener() {},
    scrollTo() {}
  };
  const context = {
    window, document, localStorage, navigator: {}, crypto: webcrypto,
    console, Date, Math, Intl, JSON, String, Number, Boolean, Array, Object, Set, Map,
    Blob, URL, setTimeout, clearTimeout,
    globalThis: null
  };
  context.globalThis = context;
  const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  vm.runInNewContext(source + `\nglobalThis.__test = {\n  getData: () => data,\n  getSelectedDate: () => selectedDate,\n  getWeekOffset: () => weekOffset,\n  saveData, setSelectedDate, shiftWeek, countWeekTasks,\n  changeTaskStatus, findTask, renderSearchResults,\n  getStorageBlocked: () => storageBlocked\n};`, context, { filename: 'app.js' });
  return { context, localStorage, elements };
}

// Initial schedule and local persistence.
const app = makeContext();
const api = app.context.__test;
assert.deepEqual(Array.from(api.getData().schedule[0]), ['فيزياء', 'إنجليزي', 'رياضيات']);
assert.equal(api.getData().schedule.length, 7);
assert.ok(app.localStorage.getItem('daftar_app_v2'));

// Add, edit, complete, and retain a task with its own date.
const task = { id: 'smoke-1', text: 'حل تدريبات الدرس', subject: 'فيزياء', date: api.getSelectedDate(), completed: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
api.getData().tasks.push(task);
assert.equal(api.saveData(), true);
task.text = 'حل تدريبات الدرس بعد التعديل';
task.subject = 'رياضيات';
api.saveData();
api.changeTaskStatus('smoke-1', true);
assert.equal(api.findTask('smoke-1').completed, true);
assert.equal(api.countWeekTasks(new Date()).completed, 1);
assert.equal(JSON.parse(app.localStorage.getItem('daftar_app_v2')).tasks[0].subject, 'رياضيات');

// Week navigation uses Saturday as the first day and preserves the weekday.
const before = api.getSelectedDate();
api.shiftWeek(-1);
assert.equal(api.getWeekOffset(), -1);
const after = api.getSelectedDate();
const beforeDate = new Date(`${before}T12:00:00`);
const afterDate = new Date(`${after}T12:00:00`);
assert.equal(Math.round((beforeDate - afterDate) / 86400000), 7);

// Safe legacy migration: new key is written and the source key remains intact.
const legacyPayload = JSON.stringify({ tasks: [{ id: 'old-1', text: 'واجب قديم', subject: 'عربي', date: '2026-11-14', done: true }] });
const migrated = makeContext({ daftarAlhisas_v1: legacyPayload });
const migratedData = migrated.context.__test.getData();
assert.equal(migratedData.tasks.length, 1);
assert.equal(migratedData.tasks[0].completed, true);
assert.ok(migrated.localStorage.getItem('daftar_app_v2'));
assert.equal(migrated.localStorage.getItem('daftarAlhisas_v1'), legacyPayload);

// Corrupt current data must not be overwritten.
const corrupt = makeContext({ daftar_app_v2: '{not-json', daftarAlhisas_v1: legacyPayload });
assert.equal(corrupt.context.__test.getStorageBlocked(), true);
assert.equal(corrupt.localStorage.getItem('daftar_app_v2'), '{not-json');
assert.equal(corrupt.localStorage.getItem('daftarAlhisas_v1'), legacyPayload);

console.log('PASS: initial schedule, local save, task update/completion, week navigation, safe migration, and corruption guard.');
