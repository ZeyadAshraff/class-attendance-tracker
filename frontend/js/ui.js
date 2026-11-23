// Small helpers shared by every page: escaping, dates, status labels, the
// absence tally, messages, dialogs and form fields.

// Every value placed in HTML goes through esc(), so data can never add markup.
export function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

// "1 student", "2 students"
export function count(n, word, pluralWord = `${word}s`) {
  return `${n} ${n === 1 ? word : pluralWord}`;
}

// ---------- Dates ----------

const dateFormat = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
const dateTimeFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const timeFormat = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });

export const formatDate = (iso) => (iso ? dateFormat.format(new Date(iso)) : '');
export const formatDateTime = (iso) => (iso ? dateTimeFormat.format(new Date(iso)) : '');
export const formatTime = (iso) => (iso ? timeFormat.format(new Date(iso)) : '');

// ---------- Status labels ----------
// Three weights: quiet (grey outline), attention (black outline), strong (black).

const STATUS = {
  safe: ['', 'Safe'],
  first_warning: ['attention', 'First warning'],
  second_warning: ['strong', 'Second warning'],
  barred: ['strong', 'Barred from exam'],
  present: ['', 'Present'],
  absent: ['attention', 'Absent'],
  excused: ['', 'Excused'],
  pending: ['attention', 'Waiting'],
  approved: ['', 'Approved'],
  rejected: ['strong', 'Rejected'],
  open: ['strong', 'Open'],
  closed: ['', 'Closed']
};

export function status(name) {
  const [weight, label] = STATUS[name] || ['', name];
  return `<span class="status ${weight}">${esc(label)}</span>`;
}

// Names of the warning emails (warnings.level in the database)
const WARNING_NAMES = { first_warning: 'First warning', second_warning: 'Second warning', exam_barred: 'Exam bar' };
export const warningName = (level) => WARNING_NAMES[level] || level;

// ---------- The tally ----------
// One mark per absence the course allows: black = used, grey = still allowed.
// A gap follows each warning point, so with the 2 / 4 / 6 policy the marks
// are grouped in pairs. Absences beyond the limit appear after one more gap.
export function tally(used, { firstWarningAt, secondWarningAt, absenceLimit }) {
  let marks = '';
  for (let i = 1; i <= Math.max(used, absenceLimit); i += 1) {
    const startsGroup = i === firstWarningAt + 1 || i === secondWarningAt + 1 || i === absenceLimit + 1;
    marks += `<span class="mark${i <= used ? ' used' : ''}${startsGroup ? ' gap' : ''}"></span>`;
  }
  return `<div class="tally" role="img" aria-label="${used} absences, ${absenceLimit} allowed">${marks}</div>`;
}

// ---------- Loading, empty and error messages ----------

export function loading() {
  return '<p class="loading" role="status">Loading…</p>';
}

export function empty(text) {
  return `<p class="empty">${esc(text)}</p>`;
}

export function errorNote(error) {
  return `<div class="notice is-error" role="alert"><p><strong>This page could not load.</strong> ${esc(error.message)}</p></div>`;
}

// ---------- Buttons ----------

// Disables a button and shows a spinner while a request runs, then restores it
export function setLoading(button, isLoading, text = 'Saving') {
  if (isLoading) {
    button.dataset.label = button.innerHTML;
    button.disabled = true;
    button.innerHTML = `<span class="spinner" aria-hidden="true"></span>${esc(text)}`;
  } else {
    button.disabled = false;
    if (button.dataset.label) button.innerHTML = button.dataset.label;
  }
}

// ---------- Toast (short confirmation at the bottom of the screen) ----------

export function toast(message, type = 'success') {
  let region = document.querySelector('.toast-region');
  if (!region) {
    region = document.createElement('div');
    region.className = 'toast-region';
    region.setAttribute('role', 'status');
    region.setAttribute('aria-live', 'polite');
    document.body.append(region);
  }
  const item = document.createElement('div');
  item.className = `toast ${type}`;
  item.textContent = message;
  region.append(item);
  setTimeout(() => item.remove(), 4000);
}

// ---------- Dialogs ----------
// Uses the browser's <dialog> element: it keeps keyboard focus inside and
// closes with Esc. onSubmit(form) may throw an error; its message is shown
// under the field named in error.field, or at the top of the dialog.
export function openFormDialog({ title, body, submitLabel = 'Save', loadingText = 'Saving', onSubmit }) {
  const dialog = document.createElement('dialog');
  dialog.className = 'dialog';
  dialog.innerHTML = `
    <form novalidate>
      <div class="dialog-head">
        <h2>${esc(title)}</h2>
        <button type="button" class="dialog-close" data-close aria-label="Close">&times;</button>
      </div>
      <div class="dialog-body">
        <div class="notice is-error form-error" role="alert"><p></p></div>
        <div class="form">${body}</div>
      </div>
      <div class="dialog-foot">
        <button type="button" class="btn secondary" data-close>Cancel</button>
        <button type="submit" class="btn" data-submit>${esc(submitLabel)}</button>
      </div>
    </form>`;
  document.body.append(dialog);

  const form = dialog.querySelector('form');
  const formError = dialog.querySelector('.form-error');
  dialog.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', () => dialog.close()));
  dialog.addEventListener('close', () => dialog.remove());

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearFieldErrors(form);
    formError.classList.remove('show');
    const submit = dialog.querySelector('[data-submit]');
    setLoading(submit, true, loadingText);
    try {
      await onSubmit(form);
      dialog.close();
    } catch (error) {
      setLoading(submit, false);
      if (error.field && form.elements[error.field]) {
        showFieldError(form, error.field, error.message);
      } else {
        formError.querySelector('p').textContent = error.message;
        formError.classList.add('show');
      }
    }
  });

  dialog.showModal();
  const first = form.querySelector('.form input, .form select, .form textarea');
  if (first) first.focus();
}

export function confirmDialog({ title, message, confirmLabel, onConfirm }) {
  openFormDialog({
    title,
    body: `<p>${esc(message)}</p>`,
    submitLabel: confirmLabel,
    loadingText: 'Please wait',
    onSubmit: onConfirm
  });
}

// ---------- Form fields ----------

// Makes an error that openFormDialog shows under one field
export function fieldError(name, message) {
  const error = new Error(message);
  error.field = name;
  return error;
}

export function showFieldError(form, name, message) {
  const input = form.elements[name];
  input.setAttribute('aria-invalid', 'true');
  const errorEl = input.closest('.field')?.querySelector('.field-error');
  if (errorEl) errorEl.textContent = message;
  input.focus();
}

export function clearFieldErrors(form) {
  form.querySelectorAll('[aria-invalid]').forEach((el) => el.removeAttribute('aria-invalid'));
  form.querySelectorAll('.field-error').forEach((el) => { el.textContent = ''; });
}

let fieldNumber = 0;

// A labelled field with a hint and a place for its error message.
// type: text | email | password | number | textarea
export function field({ name, label, type = 'text', value = '', required = false, hint = '', attrs = '' }) {
  fieldNumber += 1;
  const id = `field-${fieldNumber}`; // links the <label> and the messages to the input
  const common = `id="${id}" name="${name}" aria-describedby="${id}-hint ${id}-error" ${required ? 'required' : ''} ${attrs}`;
  const control = type === 'textarea'
    ? `<textarea class="textarea" ${common}>${esc(value)}</textarea>`
    : `<input class="input" type="${type}" value="${esc(value)}" ${common}>`;
  return `
    <div class="field">
      <label for="${id}">${esc(label)}${required ? '' : ' <span class="req">(optional)</span>'}</label>
      ${control}
      <span class="hint" id="${id}-hint">${esc(hint)}</span>
      <span class="field-error" id="${id}-error"></span>
    </div>`;
}

// Checkboxes for choosing courses
export function courseChecks(name, courses, selectedIds = []) {
  if (courses.length === 0) return '<p class="quiet">There are no courses yet. Add a course first.</p>';
  const boxes = courses.map((c) => `
    <label class="choice">
      <input type="checkbox" name="${name}" value="${c.id}" ${selectedIds.includes(c.id) ? 'checked' : ''}>
      <span>${esc(c.code)}<span>${esc(c.name)}</span></span>
    </label>`);
  return `
    <fieldset class="field choices">
      <legend>Courses</legend>
      <div class="choice-grid">${boxes.join('')}</div>
      <span class="field-error"></span>
    </fieldset>`;
}

export function checkedValues(form, name) {
  return [...form.querySelectorAll(`input[name="${name}"]:checked`)].map((input) => Number(input.value));
}

// Starts a file download (a real link, or a temporary blob: link in preview mode)
export function triggerDownload(url, fileName) {
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName || '';
  document.body.append(link);
  link.click();
  link.remove();
}

// Runs fn only after the user stops typing for a moment
export function debounce(fn, ms = 250) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}
