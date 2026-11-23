// Instructor pages: the class session (code on screen), excuse requests,
// absence limits and reports.
import { api } from './api.js';
import { bindCourseSelect, courseSelect, pickCourse, renderFlags, renderReports } from './course-views.js';
import { requireRole } from './session.js';
import { pageHead, startShell } from './shell.js';
import {
  confirmDialog, empty, errorNote, esc, field, formatDate, formatDateTime,
  formatTime, loading, setLoading, showFieldError, status, toast, warningName
} from './ui.js';

const session = requireRole('instructor');
let shell;

// The number on the Excuses tab: excuses waiting in all your courses
async function refreshCount() {
  try {
    const courses = await api.getMyCourses();
    shell.setCount('excuses', courses.reduce((sum, c) => sum + c.pendingExcuses, 0));
  } catch {
    // the number on the tab is optional
  }
}

// ---------- Class session ----------

function minutesAndSeconds(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

// The open session: big code for the projector, countdown, who checked in
function showOpenSession(container, open, onClosed) {
  const sheet = document.createElement('section');
  sheet.className = 'session-sheet';
  sheet.setAttribute('aria-label', `Open session for ${open.courseCode}`);
  sheet.innerHTML = `
    <div class="section-head">
      <div><h2>${esc(open.courseCode)} ${esc(open.courseName)}</h2><p>Opened at ${esc(formatTime(open.openedAt))}</p></div>
      ${status('open')}
    </div>
    <div class="session-grid">
      <div>
        <p class="quiet">Show this code on the screen. Students type it on the Check in page.</p>
        <p class="code-display mt-2" aria-label="Session code ${esc(open.code.split('').join(' '))}">${esc(open.code)}</p>
        <p class="mt-5" data-clock></p>
      </div>
      <div>
        <h3>Checked in: <span data-count>-</span></h3>
        <ul class="checked-list" data-list aria-live="polite"></ul>
        <button class="btn wide mt-5" data-close>Close session and mark absences</button>
        <p class="small quiet mt-2">Everyone who has not checked in is marked absent, and warning emails that are due are sent.</p>
      </div>
    </div>`;
  container.append(sheet);

  // Two timers: the countdown every second, the check-in list every 4 seconds.
  // They stop by themselves once this sheet is no longer on the page.
  const timers = [setInterval(updateClock, 1000), setInterval(loadList, 4000)];

  function stillShown() {
    if (sheet.isConnected) return true;
    timers.forEach(clearInterval);
    return false;
  }

  function updateClock() {
    if (!stillShown()) return;
    const left = Date.parse(open.expiresAt) - Date.now();
    sheet.querySelector('[data-clock]').innerHTML = left > 0
      ? `Check-in closes in <span class="countdown">${minutesAndSeconds(left)}</span>`
      : '<strong>The code has expired.</strong> Close the session to record absences.';
  }

  async function loadList() {
    if (!stillShown()) return;
    try {
      const live = await api.getSessionLive(open.id);
      sheet.querySelector('[data-count]').textContent = `${live.checkedIn.length} of ${live.enrolledCount}`;
      sheet.querySelector('[data-list]').innerHTML = live.checkedIn.length
        ? live.checkedIn.map((s) => `<li><span>${esc(s.studentName)}</span><span class="quiet num">${esc(formatTime(s.checkedInAt))}</span></li>`).join('')
        : '<li class="quiet">Nobody yet. This list updates by itself.</li>';
    } catch {
      // keep the last list; the next try is in 4 seconds
    }
  }

  updateClock();
  loadList();

  sheet.querySelector('[data-close]').addEventListener('click', () => {
    confirmDialog({
      title: `Close the ${open.courseCode} session?`,
      message: 'Students who have not checked in will be marked absent. This cannot be undone.',
      confirmLabel: 'Close session',
      onConfirm: async () => onClosed(await api.closeSession(open.id))
    });
  });
}

// The message shown after a session is closed
function closedNotice(s) {
  const warned = s.warningsSent.map((w) => `${esc(w.studentName)} (${warningName(w.level).toLowerCase()})`);
  return `
    <section class="notice mb-4" role="status">
      <p><strong>${esc(s.session.courseCode)} session closed.</strong> ${s.present} present, ${s.absent} marked absent (${s.attendanceRate}% attendance).</p>
      <p>${warned.length ? `Warning ${warned.length === 1 ? 'email' : 'emails'} sent to ${warned.join(', ')}.` : 'No warning emails were due.'}</p>
    </section>`;
}

// notice: optional message shown at the top (used right after closing a session)
async function renderSession(container, params, notice = '') {
  const head = pageHead('Class session');
  container.innerHTML = head + loading();
  let courses;
  try {
    courses = await api.getMyCourses();
  } catch (error) {
    container.innerHTML = head + errorNote(error);
    return;
  }
  if (courses.length === 0) {
    container.innerHTML = head + empty('You need a course before you can open a session.');
    return;
  }

  const open = courses.filter((c) => c.openSession);
  const free = courses.filter((c) => !c.openSession);
  const preferred = pickCourse(free.length ? free : courses, params);

  container.innerHTML = `${head}
    ${notice}
    <div id="open-sessions"></div>
    ${free.length ? `
    <section class="${open.length ? 'section' : ''}" aria-labelledby="open-title">
      <h2 id="open-title" class="mb-4">${open.length ? 'Open another session' : 'Open a session'}</h2>
      <form class="form narrow" novalidate>
        <div class="form-row">
          ${courseSelect(free, preferred.id, 'open-course')}
          ${field({ name: 'durationMinutes', label: 'Check-in stays open for', type: 'number', value: '10', required: true, hint: 'Minutes, from 1 to 60.', attrs: 'min="1" max="60" step="1" inputmode="numeric"' })}
        </div>
        <div><button class="btn" type="submit">Open session and show code</button></div>
      </form>
    </section>` : ''}`;

  const onClosed = (summary) => {
    toast(`${summary.session.courseCode} session closed`);
    refreshCount();
    renderSession(container, new URLSearchParams(`course=${summary.session.courseId}`), closedNotice(summary));
  };
  for (const course of open) {
    showOpenSession(container.querySelector('#open-sessions'), { ...course.openSession, courseCode: course.code, courseName: course.name }, onClosed);
  }

  const form = container.querySelector('form');
  if (!form) return; // every course already has an open session
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const minutes = Number(form.elements.durationMinutes.value);
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 60) {
      showFieldError(form, 'durationMinutes', 'Enter a whole number of minutes from 1 to 60.');
      return;
    }
    const button = form.querySelector('button');
    setLoading(button, true, 'Opening');
    try {
      const opened = await api.openSession(Number(form.querySelector('#open-course').value), minutes);
      toast(`${opened.courseCode} session open`);
      renderSession(container, params);
    } catch (error) {
      setLoading(button, false);
      if (error.field) showFieldError(form, error.field, error.message);
      else toast(error.message, 'error');
    }
  });
}

// ---------- Excuse requests ----------

const FILTERS = [['pending', 'Waiting'], ['approved', 'Approved'], ['rejected', 'Rejected']];

async function renderExcuses(container, params) {
  const head = pageHead('Excuse requests');
  container.innerHTML = head + loading();
  let courses;
  try {
    courses = await api.getMyCourses();
  } catch (error) {
    container.innerHTML = head + errorNote(error);
    return;
  }
  if (courses.length === 0) {
    container.innerHTML = head + empty('Excuse requests appear here for the courses you teach.');
    return;
  }

  // The course and the filter are kept in the address: #excuses?course=2&status=approved
  const course = pickCourse(courses, params);
  const filter = FILTERS.some(([value]) => value === params.get('status')) ? params.get('status') : 'pending';
  const courseOptions = courses.map((c) => ({ ...c, name: c.pendingExcuses ? `${c.name} (${c.pendingExcuses} waiting)` : c.name }));

  container.innerHTML = `${head}
    <div class="toolbar">${courseSelect(courseOptions, course.id)}</div>
    <div class="filter" role="group" aria-label="Show">
      ${FILTERS.map(([value, label]) => `<button type="button" data-filter="${value}" aria-pressed="${value === filter}">${label}</button>`).join('')}
    </div>
    <div id="excuse-list">${loading()}</div>`;

  bindCourseSelect(container, 'excuses');
  container.querySelectorAll('[data-filter]').forEach((button) => {
    button.addEventListener('click', () => { location.hash = `excuses?course=${course.id}&status=${button.dataset.filter}`; });
  });

  const list = container.querySelector('#excuse-list');
  const load = async () => {
    try {
      const excuses = await api.listCourseExcuses(course.id, filter);
      if (excuses.length === 0) {
        list.innerHTML = empty(filter === 'pending'
          ? `No excuse is waiting for ${course.code}. New requests from students appear here.`
          : `No ${filter} excuses for ${course.code} yet.`);
        return;
      }
      const rows = excuses.map((e) => `
        <tr>
          <td data-label="Student">${esc(e.studentName)}<span class="sub">${esc(e.studentEmail)}</span></td>
          <td data-label="Absence" class="nowrap">${esc(formatDate(e.sessionDate))}<span class="sub">sent ${esc(formatDateTime(e.createdAt))}</span></td>
          <td data-label="Reason" class="reason">${esc(e.reason)}</td>
          <td class="row-actions">${filter === 'pending'
            ? `<span class="decision"><button class="btn small" data-decide="approve" data-id="${e.id}">Approve</button><button class="btn secondary small" data-decide="reject" data-id="${e.id}">Reject</button></span>`
            : `${status(e.status)}<span class="sub">${esc(formatDateTime(e.reviewedAt))}</span>`}</td>
        </tr>`);
      list.innerHTML = `<div class="table-wrap"><table class="table"><thead><tr><th>Student</th><th>Absence</th><th>Reason</th><th class="right">${filter === 'pending' ? 'Decision' : 'Decided'}</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>`;

      list.querySelectorAll('[data-decide]').forEach((button) => {
        button.addEventListener('click', async () => {
          button.closest('tr').querySelectorAll('button').forEach((b) => { b.disabled = true; });
          setLoading(button, true, button.dataset.decide === 'approve' ? 'Approving' : 'Rejecting');
          try {
            const result = await api.reviewExcuse(button.dataset.id, button.dataset.decide);
            toast(`Excuse ${result.status} for ${result.studentName}`);
          } catch (error) {
            toast(error.message, 'error');
          }
          await load();
          refreshCount();
        });
      });
    } catch (error) {
      list.innerHTML = errorNote(error);
    }
  };
  await load();
}

if (session) {
  shell = startShell({
    session,
    routes: [
      { id: 'session', label: 'Class session', render: renderSession },
      { id: 'excuses', label: 'Excuses', render: renderExcuses, count: true },
      { id: 'flags', label: 'Absence limits', render: (c, p) => renderFlags(c, p, api.getMyCourses) },
      { id: 'reports', label: 'Reports', render: (c, p) => renderReports(c, p, api.getMyCourses) }
    ]
  });
  refreshCount();
}
