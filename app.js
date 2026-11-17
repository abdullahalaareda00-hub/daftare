'use strict';

const APP_VERSION = '1.0.0';
const STORAGE_KEY = 'daftar_app_v2';
const LEGACY_KEY = 'daftarAlhisas_v1';
const DAY_NAMES = ['السبت', 'الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة'];
const DEFAULT_SCHEDULE = [
  ['فيزياء', 'إنجليزي', 'رياضيات'],
  ['تاريخ', 'رياضيات', 'مواد شرعية'],
  ['عربي', 'فيزياء'],
  ['إنجليزي', 'رياضيات'],
  ['تاريخ', 'رياضيات', 'مواد شرعية'],
  ['عربي', 'فيزياء'],
  ['مواد شرعية']
];

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
const clone = (value) => JSON.parse(JSON.stringify(value));
const escapeHTML = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const makeId = () => (window.crypto && crypto.randomUUID ? crypto.randomUUID() : `task-${Date.now()}-${Math.random().toString(16).slice(2)}`);

function parseDate(value) {
  if (!value) return null;
  const match = String(value).match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12);
  return Number.isNaN(date.getTime()) ? null : date;
}
function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function addDays(date, amount) {
  const result = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12);
  result.setDate(result.getDate() + amount);
  return result;
}
function getWeekStart(date) {
  const offset = (date.getDay() + 1) % 7; // Saturday is day zero in this app.
  return addDays(date, -offset);
}
function getDayIndex(date) { return (date.getDay() + 1) % 7; }
function formatDate(date, options = { day: 'numeric', month: 'long', year: 'numeric' }) {
  return new Intl.DateTimeFormat('ar-EG', options).format(date);
}
function formatShortDate(date) {
  return new Intl.DateTimeFormat('ar-EG', { day: 'numeric', month: 'short' }).format(date);
}
function normalizeSchedule(raw) {
  const schedule = Array.from({ length: 7 }, () => []);
  if (Array.isArray(raw)) {
    raw.slice(0, 7).forEach((items, index) => {
      const values = Array.isArray(items) ? items : (typeof items === 'string' ? items.split(/[،,]/) : []);
      schedule[index] = [...new Set(values.map((item) => String(item ?? '').trim()).filter(Boolean))];
    });
  } else if (raw && typeof raw === 'object') {
    DAY_NAMES.forEach((name, index) => {
      const value = raw[name] ?? raw[index] ?? raw[String(index)];
      const values = Array.isArray(value) ? value : (typeof value === 'string' ? value.split(/[،,]/) : []);
      schedule[index] = [...new Set(values.map((item) => String(item ?? '').trim()).filter(Boolean))];
    });
  }
  return schedule;
}
function normalizeTask(raw, index = 0) {
  if (!raw || typeof raw !== 'object') return null;
  const text = String(raw.text ?? raw.title ?? raw.name ?? raw.content ?? raw.description ?? '').trim();
  if (!text) return null;
  const subject = String(raw.subject ?? raw.material ?? raw.lesson ?? raw.course ?? 'مواد أخرى').trim() || 'مواد أخرى';
  const possibleDate = raw.date ?? raw.dueDate ?? raw.createdDate ?? raw.dayDate;
  let date = parseDate(possibleDate);
  if (!date && typeof raw.day === 'string') {
    const dayIndex = DAY_NAMES.indexOf(raw.day.trim());
    if (dayIndex >= 0) date = addDays(getWeekStart(new Date()), dayIndex);
  }
  if (!date && Number.isInteger(raw.dayIndex) && raw.dayIndex >= 0 && raw.dayIndex < 7) {
    date = addDays(getWeekStart(new Date()), raw.dayIndex);
  }
  if (!date) date = new Date();
  return {
    id: String(raw.id ?? raw.taskId ?? `migrated-${index}-${makeId()}`),
    text,
    subject,
    date: dateKey(date),
    completed: Boolean(raw.completed ?? raw.done ?? raw.isCompleted ?? raw.checked),
    createdAt: raw.createdAt ?? new Date().toISOString(),
    updatedAt: raw.updatedAt ?? raw.createdAt ?? new Date().toISOString()
  };
}
function extractLegacyData(legacy) {
  if (Array.isArray(legacy)) return { schedule: DEFAULT_SCHEDULE, tasks: legacy };
  if (!legacy || typeof legacy !== 'object') return { schedule: DEFAULT_SCHEDULE, tasks: [] };
  const schedule = legacy.schedule ?? legacy.weeklySchedule ?? legacy.timetable ?? legacy.days ?? legacy.table ?? DEFAULT_SCHEDULE;
  const tasks = legacy.tasks ?? legacy.homework ?? legacy.assignments ?? legacy.wajibat ?? [];
  return { schedule, tasks: Array.isArray(tasks) ? tasks : [] };
}
function normalizeData(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const schedule = normalizeSchedule(source.schedule ?? DEFAULT_SCHEDULE);
  const tasks = Array.isArray(source.tasks) ? source.tasks.map(normalizeTask).filter(Boolean) : [];
  const uniqueTasks = [];
  const seen = new Set();
  for (const task of tasks) {
    if (seen.has(task.id)) task.id = makeId();
    seen.add(task.id);
    uniqueTasks.push(task);
  }
  return { schemaVersion: 2, schedule, tasks: uniqueTasks, updatedAt: source.updatedAt ?? new Date().toISOString() };
}

function loadData() {
  let storage = null;
  try { storage = window.localStorage; } catch (_) { /* private mode / storage disabled */ }
  if (!storage) return { data: normalizeData({}), storageBlocked: true, notice: 'التخزين المحلي غير متاح في هذا المتصفح؛ ستظل البيانات مؤقتة حتى إغلاق الصفحة.' };

  const currentRaw = storage.getItem(STORAGE_KEY);
  if (currentRaw !== null) {
    try {
      return { data: normalizeData(JSON.parse(currentRaw)), storageBlocked: false, notice: '' };
    } catch (_) {
      return { data: normalizeData({}), storageBlocked: true, notice: 'تعذرت قراءة بيانات دفتر الحالية. لم يتم استبدال الملف التالف حفاظًا على بياناتك.' };
    }
  }

  const legacyRaw = storage.getItem(LEGACY_KEY);
  if (legacyRaw !== null) {
    try {
      const legacy = JSON.parse(legacyRaw);
      const extracted = extractLegacyData(legacy);
      const migrated = normalizeData({ schedule: extracted.schedule, tasks: extracted.tasks });
      const serialized = JSON.stringify(migrated);
      storage.setItem(STORAGE_KEY, serialized);
      if (storage.getItem(STORAGE_KEY) !== serialized) throw new Error('Migration verification failed');
      // Keep the legacy key untouched. It is the user's rollback copy.
      return { data: migrated, storageBlocked: false, notice: 'تم ترحيل بيانات النسخة السابقة بنجاح، مع الاحتفاظ بنسختها الأصلية.' };
    } catch (_) {
      return { data: normalizeData({}), storageBlocked: true, notice: 'لم يكتمل ترحيل بيانات النسخة السابقة. لم نحذف المصدر القديم أو نكتب فوقه.' };
    }
  }

  const initial = normalizeData({ schedule: DEFAULT_SCHEDULE, tasks: [] });
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(initial));
    return { data: initial, storageBlocked: false, notice: '' };
  } catch (_) {
    return { data: initial, storageBlocked: true, notice: 'تعذر تفعيل الحفظ المحلي. تحقق من مساحة التخزين وإعدادات المتصفح.' };
  }
}

const loaded = loadData();
let data = loaded.data;
let storageBlocked = loaded.storageBlocked;
let activePage = 'home';
let selectedDate = dateKey(new Date());
let weekOffset = 0;
let searchQuery = '';
let searchFilter = 'all';
let scheduleDraft = clone(data.schedule);
let pendingServiceWorker = null;
let toastTimer = null;

function saveData() {
  data.updatedAt = new Date().toISOString();
  if (storageBlocked) return false;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    return true;
  } catch (_) {
    storageBlocked = true;
    showStorageNotice('فشل حفظ التغييرات على الجهاز. لا تغلق الصفحة قبل تصدير نسخة احتياطية إن أمكن.');
    return false;
  }
}
function showStorageNotice(message) {
  const notice = $('#storageNotice');
  notice.textContent = message;
  notice.classList.remove('hidden');
}
function showToast(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2300);
}
function getCurrentWeekStart() { return getWeekStart(new Date()); }
function getVisibleWeekStart() { return addDays(getCurrentWeekStart(), weekOffset * 7); }
function getWeekLabel() {
  if (weekOffset === 0) return 'الأسبوع الحالي';
  if (weekOffset === -1) return 'الأسبوع السابق';
  if (weekOffset === 1) return 'الأسبوع القادم';
  return weekOffset < 0 ? `قبل ${Math.abs(weekOffset)} أسابيع` : `بعد ${weekOffset} أسابيع`;
}
function setSelectedDate(date) {
  selectedDate = dateKey(date);
  const selectedStart = getWeekStart(date);
  const currentStart = getCurrentWeekStart();
  weekOffset = Math.round((selectedStart - currentStart) / (7 * 86400000));
}
function tasksForDate(date) { return data.tasks.filter((task) => task.date === date); }
function subjectsForDate(date) {
  const parsed = parseDate(date);
  const scheduled = data.schedule[getDayIndex(parsed)] || [];
  const assigned = tasksForDate(date).map((task) => task.subject);
  return [...new Set([...scheduled, ...assigned])];
}
function countWeekTasks(start) {
  const startKey = dateKey(start);
  const endKey = dateKey(addDays(start, 6));
  const tasks = data.tasks.filter((task) => task.date >= startKey && task.date <= endKey);
  return { pending: tasks.filter((task) => !task.completed).length, completed: tasks.filter((task) => task.completed).length };
}
function renderTodayCard() {
  const today = new Date();
  $('#todayDay').textContent = new Intl.DateTimeFormat('ar-EG', { weekday: 'long' }).format(today);
  $('#todayDate').textContent = formatDate(today);
}
function renderWeekPanel(targetId) {
  const start = getVisibleWeekStart();
  const end = addDays(start, 6);
  const selected = parseDate(selectedDate);
  const weekDays = Array.from({ length: 7 }, (_, index) => addDays(start, index));
  const html = `
    <div class="week-panel">
      <div class="week-topline">
        <div><div class="week-label">${getWeekLabel()}</div><div class="week-range">${formatShortDate(start)} — ${formatDate(end, { day: 'numeric', month: 'long', year: 'numeric' })}</div></div>
        <div class="week-controls">
          <button type="button" data-action="week-next" aria-label="الأسبوع التالي" title="الأسبوع التالي">›</button>
          <button type="button" data-action="week-prev" aria-label="الأسبوع السابق" title="الأسبوع السابق">‹</button>
        </div>
      </div>
      <div class="days-strip" role="group" aria-label="أيام الأسبوع">
        ${weekDays.map((day, index) => {
          const key = dateKey(day);
          const isSelected = key === selectedDate;
          const isToday = key === dateKey(new Date());
          return `<button type="button" class="day-button${isSelected ? ' selected' : ''}${isToday ? ' today' : ''}" data-action="select-day" data-date="${key}" aria-pressed="${isSelected}"><span class="day-name">${DAY_NAMES[index]}</span><span class="day-number">${new Intl.DateTimeFormat('ar-EG', { day: 'numeric' }).format(day)}</span></button>`;
        }).join('')}
      </div>
      <div class="selected-day-panel">${renderSelectedDay(selected)}</div>
    </div>`;
  const target = document.getElementById(targetId);
  if (target) target.innerHTML = html;
}
function renderSelectedDay(date) {
  const key = dateKey(date);
  const isToday = key === dateKey(new Date());
  const subjects = subjectsForDate(key);
  const heading = `<div class="selected-day-heading"><div><div class="selected-day-title">${DAY_NAMES[getDayIndex(date)]}</div><div class="selected-day-date">${formatDate(date)}</div></div>${isToday ? '<span class="today-badge">اليوم</span>' : ''}</div>`;
  if (!subjects.length) {
    return `${heading}<div class="empty-day"><strong>لا توجد مواد مسجلة لهذا اليوم</strong>يمكنك إضافة المواد من صفحة الإعدادات.</div>`;
  }
  const cards = subjects.map((subject) => {
    const subjectTasks = tasksForDate(key).filter((task) => task.subject === subject);
    const done = subjectTasks.filter((task) => task.completed).length;
    const taskMarkup = subjectTasks.length ? `<div class="task-list">${subjectTasks.map((task) => `
      <div class="task-row${task.completed ? ' is-completed' : ''}">
        <input class="task-check" type="checkbox" data-action="toggle-task" data-task-id="${escapeHTML(task.id)}" ${task.completed ? 'checked' : ''} aria-label="${task.completed ? 'إلغاء إكمال' : 'إنهاء'} ${escapeHTML(task.text)}">
        <div class="task-text">${escapeHTML(task.text)}</div>
        <div class="task-actions">
          <button class="mini-action" type="button" data-action="edit-task" data-task-id="${escapeHTML(task.id)}" aria-label="تعديل الواجب" title="تعديل"><svg viewBox="0 0 24 24"><path d="m4 16.5-.8 4.3 4.3-.8L19 8.5 15.5 5Z"/><path d="m13.8 6.7 3.5 3.5"/></svg></button>
          <button class="mini-action delete" type="button" data-action="delete-task" data-task-id="${escapeHTML(task.id)}" aria-label="حذف الواجب" title="حذف"><svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5"/></svg></button>
        </div>
      </div>`).join('')}</div>` : '<div class="no-task">لا يوجد واجب مسجل</div>';
    return `<article class="subject-card"><div class="subject-head"><div class="subject-name">${escapeHTML(subject)}</div><div class="subject-progress">${done} من ${subjectTasks.length} مكتمل</div></div>${taskMarkup}<form class="quick-add-row" data-form="quick-add-task" data-subject="${escapeHTML(subject)}" data-date="${key}"><input name="quickText" type="text" maxlength="180" placeholder="اكتب واجبًا جديدًا..." aria-label="واجب جديد لمادة ${escapeHTML(subject)}"><button type="submit">إضافة</button></form><button class="add-task-trigger" type="button" data-action="add-task" data-subject="${escapeHTML(subject)}" data-date="${key}"><span>＋</span><span>إضافة بتفاصيل</span></button></article>`;
  }).join('');
  return `${heading}<div class="subject-list">${cards}</div>`;
}
function renderStats() {
  const counts = countWeekTasks(getVisibleWeekStart());
  $('#pendingCount').textContent = new Intl.NumberFormat('ar-EG').format(counts.pending);
  $('#completedCount').textContent = new Intl.NumberFormat('ar-EG').format(counts.completed);
}
function renderScheduleEditor() {
  $('#scheduleEditor').innerHTML = scheduleDraft.map((subjects, index) => `
    <div class="editor-day" data-editor-day="${index}">
      <span class="editor-day-title">${DAY_NAMES[index]}</span>
      <div class="subject-chips">${subjects.length ? subjects.map((subject, subjectIndex) => `<span class="subject-chip">${escapeHTML(subject)}<button type="button" data-action="remove-subject" data-day="${index}" data-subject-index="${subjectIndex}" aria-label="حذف مادة ${escapeHTML(subject)}">×</button></span>`).join('') : '<span class="no-task">لا توجد مواد</span>'}</div>
      <form class="add-subject-row" data-form="add-subject" data-day="${index}"><input name="subject" type="text" maxlength="35" placeholder="اسم مادة جديدة" aria-label="إضافة مادة ليوم ${DAY_NAMES[index]}"><button type="submit">إضافة</button></form>
    </div>`).join('');
}
function renderSearchResults() {
  const searchInput = $('#searchInput');
  if (searchInput && searchInput.value !== searchQuery) searchInput.value = searchQuery;
  const query = searchQuery.trim().toLocaleLowerCase('ar');
  const results = data.tasks.filter((task) => {
    const matchesQuery = !query || task.text.toLocaleLowerCase('ar').includes(query) || task.subject.toLocaleLowerCase('ar').includes(query);
    const matchesFilter = searchFilter === 'all' || (searchFilter === 'completed' ? task.completed : !task.completed);
    return matchesQuery && matchesFilter;
  }).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  $('#resultCount').textContent = `${new Intl.NumberFormat('ar-EG').format(results.length)} نتيجة`;
  $('#searchResults').innerHTML = results.length ? results.map((task) => {
    const date = parseDate(task.date);
    return `<button class="result-card" type="button" data-action="open-result" data-task-id="${escapeHTML(task.id)}"><div class="result-top"><span class="result-subject">${escapeHTML(task.subject)}</span><span class="result-status${task.completed ? ' done' : ''}">${task.completed ? 'مكتمل' : 'غير مكتمل'}</span></div><div class="result-text">${escapeHTML(task.text)}</div><div class="result-date">${DAY_NAMES[getDayIndex(date)]} · ${formatDate(date)}</div></button>`;
  }).join('') : `<div class="empty-results">${query ? 'لا توجد نتائج مطابقة لبحثك.' : 'لا توجد واجبات مسجلة بهذه التصفية بعد.'}</div>`;
  $$('.filter-chip').forEach((button) => button.classList.toggle('active', button.dataset.filter === searchFilter));
}
function render() {
  renderTodayCard();
  renderStats();
  renderWeekPanel('homeWeekPanel');
  renderWeekPanel('archiveWeekPanel');
  renderScheduleEditor();
  renderSearchResults();
  $$('.view').forEach((view) => view.classList.toggle('active', view.id === `view-${activePage}`));
  $$('.nav-item').forEach((button) => {
    const active = button.dataset.page === activePage;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
  });
}

function openModal(content) {
  const root = $('#modalRoot');
  root.innerHTML = `<div class="modal-card" role="dialog" aria-modal="true">${content}</div>`;
  root.classList.remove('hidden');
  root.setAttribute('aria-hidden', 'false');
  const firstInput = $('input:not([type="hidden"]), select, button', root);
  if (firstInput) setTimeout(() => firstInput.focus(), 30);
}
function closeModal() {
  const root = $('#modalRoot');
  root.classList.add('hidden');
  root.setAttribute('aria-hidden', 'true');
  root.innerHTML = '';
}
function openTaskModal({ task = null, subject = '', date = selectedDate, initialText = '' } = {}) {
  const isEdit = Boolean(task);
  const allSubjects = [...new Set([...data.schedule.flat(), ...data.tasks.map((item) => item.subject), subject].filter(Boolean))];
  if (subject && !allSubjects.includes(subject)) allSubjects.push(subject);
  if (!allSubjects.length) allSubjects.push('مواد أخرى');
  const selectedSubject = task?.subject ?? subject ?? allSubjects[0];
  const options = allSubjects.map((item) => `<option value="${escapeHTML(item)}" ${item === selectedSubject ? 'selected' : ''}>${escapeHTML(item)}</option>`).join('');
  openModal(`
    <div class="modal-grip"></div>
    <h2 class="modal-title">${isEdit ? 'تعديل الواجب' : 'إضافة واجب جديد'}</h2>
    <p class="modal-description">${isEdit ? 'عدّل نص الواجب أو انقله إلى مادة أخرى.' : 'اكتب المطلوب وحدد المادة المرتبط بها.'}</p>
    <form id="taskForm" data-task-id="${isEdit ? escapeHTML(task.id) : ''}" data-date="${escapeHTML(task?.date ?? date)}">
      <div class="form-field"><label for="taskText">الواجب</label><input id="taskText" name="text" type="text" maxlength="180" required placeholder="مثال: حل تدريبات الدرس الثالث" value="${isEdit ? escapeHTML(task.text) : escapeHTML(initialText)}"></div>
      <div class="form-field"><label for="taskSubject">المادة</label><select id="taskSubject" name="subject">${options}</select></div>
      <div class="modal-actions"><button class="modal-cancel" type="button" data-action="close-modal">إلغاء</button><button class="modal-confirm" type="submit">${isEdit ? 'حفظ التعديل' : 'إضافة الواجب'}</button></div>
    </form>`);
}
function openConfirmModal({ title, description, confirmText = 'تأكيد الحذف', danger = true, onConfirm }) {
  openModal(`<div class="modal-grip"></div><h2 class="modal-title">${escapeHTML(title)}</h2><p class="modal-description">راجع العملية قبل التأكيد.</p><div class="confirm-copy">${escapeHTML(description)}</div><div class="modal-actions"><button class="modal-cancel" type="button" data-action="close-modal">إلغاء</button><button class="modal-confirm${danger ? ' danger' : ''}" type="button" id="confirmAction">${escapeHTML(confirmText)}</button></div>`);
  $('#confirmAction').addEventListener('click', () => { closeModal(); onConfirm(); });
}
function findTask(taskId) { return data.tasks.find((task) => task.id === taskId); }
function changeTaskStatus(taskId, completed) {
  const task = findTask(taskId);
  if (!task) return;
  task.completed = completed;
  task.updatedAt = new Date().toISOString();
  saveData();
  render();
}
function deleteTask(taskId) {
  const task = findTask(taskId);
  if (!task) return;
  openConfirmModal({ title: 'حذف الواجب؟', description: `سيتم حذف واجب «${task.text}» من مادة «${task.subject}». لا يمكن التراجع عن هذه الخطوة.`, onConfirm: () => {
    data.tasks = data.tasks.filter((item) => item.id !== taskId);
    saveData(); render(); showToast('تم حذف الواجب');
  } });
}
function shiftWeek(amount) {
  const date = parseDate(selectedDate);
  setSelectedDate(addDays(date, amount * 7));
  render();
}
function goToday() {
  setSelectedDate(new Date());
  activePage = 'home';
  render();
}
function switchPage(page) {
  if (!['home', 'weeks', 'search', 'settings'].includes(page)) return;
  if (page === 'settings') scheduleDraft = clone(data.schedule);
  activePage = page;
  render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
function exportBackup() {
  const backup = { app: 'دفتر', version: APP_VERSION, exportedAt: new Date().toISOString(), data };
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `daftar-backup-${dateKey(new Date())}.json`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  showToast('تم تجهيز النسخة الاحتياطية');
}
function saveSchedule() {
  data.schedule = normalizeSchedule(scheduleDraft);
  saveData();
  render();
  showToast('تم حفظ جدول الحصص');
}
function handleAction(actionElement) {
  const action = actionElement.dataset.action;
  if (!action) return;
  switch (action) {
    case 'today': goToday(); break;
    case 'week-prev': shiftWeek(-1); break;
    case 'week-next': shiftWeek(1); break;
    case 'select-day': setSelectedDate(parseDate(actionElement.dataset.date)); render(); break;
    case 'add-task': openTaskModal({ subject: actionElement.dataset.subject, date: actionElement.dataset.date }); break;
    case 'edit-task': { const task = findTask(actionElement.dataset.taskId); if (task) openTaskModal({ task }); break; }
    case 'delete-task': deleteTask(actionElement.dataset.taskId); break;
    case 'close-modal': closeModal(); break;
    case 'remove-subject': {
      const day = Number(actionElement.dataset.day);
      const subjectIndex = Number(actionElement.dataset.subjectIndex);
      if (scheduleDraft[day]) scheduleDraft[day].splice(subjectIndex, 1);
      renderScheduleEditor();
      break;
    }
    case 'save-schedule': saveSchedule(); break;
    case 'export-data': exportBackup(); break;
    case 'delete-completed': {
      const count = data.tasks.filter((task) => task.completed).length;
      if (!count) { showToast('لا توجد واجبات مكتملة لحذفها'); break; }
      openConfirmModal({ title: 'حذف الواجبات المكتملة؟', description: `سيتم حذف ${count} واجبًا مكتملًا من جميع الأسابيع. الواجبات غير المكتملة ستظل كما هي. يُفضّل تصدير نسخة احتياطية أولًا.`, onConfirm: () => {
        data.tasks = data.tasks.filter((task) => !task.completed);
        saveData(); render(); showToast('تم حذف الواجبات المكتملة');
      } });
      break;
    }
    case 'clear-search': searchQuery = ''; $('#searchInput').value = ''; renderSearchResults(); break;
    case 'open-result': {
      const task = findTask(actionElement.dataset.taskId);
      if (!task) break;
      setSelectedDate(parseDate(task.date));
      activePage = 'home';
      render();
      window.scrollTo({ top: 0, behavior: 'smooth' });
      break;
    }
    case 'refresh-app': if (pendingServiceWorker) pendingServiceWorker.postMessage({ type: 'SKIP_WAITING' }); else window.location.reload(); break;
  }
}

document.addEventListener('click', (event) => {
  const actionElement = event.target.closest('[data-action]');
  if (actionElement) { handleAction(actionElement); return; }
  const navButton = event.target.closest('[data-page]');
  if (navButton) { switchPage(navButton.dataset.page); return; }
  const filterButton = event.target.closest('[data-filter]');
  if (filterButton) { searchFilter = filterButton.dataset.filter; renderSearchResults(); }
});
document.addEventListener('change', (event) => {
  const input = event.target;
  if (input.matches('[data-action="toggle-task"]')) changeTaskStatus(input.dataset.taskId, input.checked);
});
document.addEventListener('submit', (event) => {
  const form = event.target;
  if (form.id === 'taskForm') {
    event.preventDefault();
    const formData = new FormData(form);
    const text = String(formData.get('text') ?? '').trim();
    const subject = String(formData.get('subject') ?? '').trim();
    if (!text || !subject) return;
    const taskId = form.dataset.taskId;
    if (taskId) {
      const task = findTask(taskId);
      if (task) { task.text = text; task.subject = subject; task.updatedAt = new Date().toISOString(); }
      saveData(); closeModal(); render(); showToast('تم تعديل الواجب');
    } else {
      const date = parseDate(form.dataset.date) || parseDate(selectedDate);
      data.tasks.push({ id: makeId(), text, subject, date: dateKey(date), completed: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      saveData(); closeModal(); render(); showToast('تمت إضافة الواجب');
    }
    return;
  }
  if (form.matches('[data-form="quick-add-task"]')) {
    event.preventDefault();
    const input = $('input[name="quickText"]', form);
    const initialText = input.value.trim();
    if (!initialText) { input.focus(); return; }
    openTaskModal({ subject: form.dataset.subject, date: form.dataset.date, initialText });
    return;
  }
  if (form.matches('[data-form="add-subject"]')) {
    event.preventDefault();
    const day = Number(form.dataset.day);
    const input = $('input[name="subject"]', form);
    const subject = input.value.trim();
    if (!subject) { input.focus(); return; }
    if (!scheduleDraft[day].some((item) => item.toLocaleLowerCase('ar') === subject.toLocaleLowerCase('ar'))) scheduleDraft[day].push(subject);
    renderScheduleEditor();
    const newInput = $(`[data-editor-day="${day}"] input[name="subject"]`);
    if (newInput) newInput.focus();
  }
});
$('#searchInput').addEventListener('input', (event) => { searchQuery = event.target.value; renderSearchResults(); });
$('#modalRoot').addEventListener('click', (event) => { if (event.target.id === 'modalRoot') closeModal(); });
document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !$('#modalRoot').classList.contains('hidden')) closeModal(); });

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (!window.isSecureContext && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') return;
  navigator.serviceWorker.register('./sw.js').then((registration) => {
    if (registration.waiting) { pendingServiceWorker = registration.waiting; $('#updateNotice').classList.remove('hidden'); }
    registration.addEventListener('updatefound', () => {
      const worker = registration.installing;
      if (!worker) return;
      worker.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) {
          pendingServiceWorker = worker;
          $('#updateNotice').classList.remove('hidden');
        }
      });
    });
  }).catch(() => { /* The app remains usable without service-worker support. */ });
  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  });
}

let installPrompt = null;
window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  installPrompt = event;
  // Installation is exposed by the browser's own menu; no fake install control is shown.
});
window.addEventListener('appinstalled', () => { installPrompt = null; showToast('تم تثبيت دفتر على جهازك'); });

if (loaded.notice) showStorageNotice(loaded.notice);
render();
registerServiceWorker();
