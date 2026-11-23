// Student pages: check in (the main page), your attendance, absences and excuses.
import { api } from './api.js';
import { requireRole } from './session.js';
import { pageHead, startShell } from './shell.js';
import {
  count, empty, errorNote, esc, field, fieldError, formatDate, formatDateTime,
  formatTime, loading, openFormDialog, setLoading, status, tally, toast
} from './ui.js';

const session = requireRole('student');

// ---------- Check in ----------

function renderCheckIn(container) {
  container.innerHTML = pageHead('Check in');
  const box = document.createElement('div');
  box.className = 'checkin';
  container.append(box);

  const showForm = () => {
    box.innerHTML = `
      <form class="form" novalidate>
        <div class="field">
          <label for="code">Session code</label>
          <input class="code-input" id="code" name="code" maxlength="6" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="K7Q2XM" aria-describedby="code-hint code-error" required>
          <span class="hint" id="code-hint">Letters and numbers only. The code stops working when the instructor closes the session.</span>
          <span class="field-error" id="code-error" role="alert"></span>
        </div>
        <div><button type="submit" class="btn">Check in</button></div>
      </form>`;

    const form = box.querySelector('form');
    const input = form.elements.code;
    const errorEl = box.querySelector('#code-error');

    // Capital letters and digits only, as the student types
    input.addEventListener('input', () => {
      input.value = input.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
      input.removeAttribute('aria-invalid');
      errorEl.textContent = '';
    });

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (input.value.length === 0) {
        input.setAttribute('aria-invalid', 'true');
        errorEl.textContent = 'Type the code shown in class.';
        input.focus();
        return;
      }
      const button = form.querySelector('button');
      setLoading(button, true, 'Checking in');
      try {
        showDone(await api.checkIn(input.value));
      } catch (error) {
        setLoading(button, false);
        input.setAttribute('aria-invalid', 'true');
        errorEl.textContent = error.message;
        input.select();
      }
    });
    input.focus();
  };

  const showDone = (record) => {
    box.innerHTML = `
      <div role="status">
        <h2>Checked in to ${esc(record.courseCode)}</h2>
        <p class="lead mt-2">${esc(record.courseName)}. Recorded at ${esc(formatTime(record.checkedInAt))}.</p>
        <p class="mt-5"><a href="#attendance">See your attendance</a><button class="link-btn ml-5" id="again">Enter another code</button></p>
      </div>`;
    box.querySelector('#again').addEventListener('click', showForm);
    toast(`Checked in to ${record.courseCode}`);
  };

  showForm();
}

// ---------- Your attendance ----------

function allowanceSentence(c) {
  if (c.status === 'barred') return `<strong>${c.absent} absences.</strong> Barred from the unseen exam.`;
  if (c.absencesRemaining === 0) return `<strong>${c.absent} of ${c.absenceLimit}</strong> allowed absences used. None left.`;
  return `<strong>${c.absent} of ${c.absenceLimit}</strong> allowed absences used. ${c.absencesRemaining} left.`;
}

function courseRow(c) {
  return `
    <li class="course-row">
      <div><div class="course-code">${esc(c.courseCode)}</div><div class="course-name">${esc(c.courseName)}</div></div>
      <div class="allowance">${tally(c.absent, c)}<p>${allowanceSentence(c)}</p></div>
      <div class="record">
        <p>${c.present} present, ${c.absent} absent, ${c.excused} excused</p>
        <p>Attended ${c.attendancePercent}% of ${count(c.totalSessions, 'session')}</p>
      </div>
      <div class="course-status">${status(c.status)}</div>
    </li>`;
}

async function renderAttendance(container) {
  const head = pageHead('Your attendance');
  container.innerHTML = head + loading();
  try {
    const courses = await api.getMyAttendanceSummary();
    if (courses.length === 0) {
      container.innerHTML = head + empty('You are not enrolled in any course yet. Courses are added by the administrator when your account is created.');
      return;
    }
    container.innerHTML = `${head}
      <section aria-labelledby="courses-title">
        <h2 id="courses-title" class="mb-4">Absences by course</h2>
        <ul class="course-list">${courses.map(courseRow).join('')}</ul>
      </section>`;
  } catch (error) {
    container.innerHTML = head + errorNote(error);
  }
}

// ---------- Absences and excuses ----------

function excuseDialog(record, onSent) {
  openFormDialog({
    title: `Excuse for ${record.courseCode}, ${formatDate(record.sessionDate)}`,
    submitLabel: 'Send excuse',
    loadingText: 'Sending',
    body: field({
      name: 'reason',
      label: 'Reason',
      type: 'textarea',
      required: true,
      hint: 'Up to 500 characters. Mention any document you can show, such as a medical note.',
      attrs: 'maxlength="500"'
    }),
    onSubmit: async (form) => {
      const reason = form.elements.reason.value.trim();
      if (!reason) throw fieldError('reason', 'Write the reason before sending.');
      await api.submitExcuse(record.id, reason);
      toast('Excuse sent');
      onSent();
    }
  });
}

async function renderExcuses(container) {
  const head = pageHead('Absences and excuses');
  container.innerHTML = head + loading();
  try {
    const [records, excuses] = await Promise.all([api.getMyAttendance(), api.getMyExcuses()]);
    // Every absence, plus sessions that are excused (they had an absence first)
    const absences = records.filter((r) => r.status === 'absent' || r.excuseStatus);

    const absenceRows = absences.map((r) => `
      <tr>
        <td data-label="Date" class="nowrap">${esc(formatDate(r.sessionDate))}</td>
        <td data-label="Course">${esc(r.courseCode)}<span class="sub">${esc(r.courseName)}</span></td>
        <td data-label="Recorded as">${status(r.status)}</td>
        <td class="row-actions">${r.excuseStatus
          ? status(r.excuseStatus)
          : `<button class="btn secondary small" data-excuse="${r.id}">Send excuse</button>`}</td>
      </tr>`);

    const excuseRows = excuses.map((e) => `
      <tr>
        <td data-label="Course">${esc(e.courseCode)}<span class="sub">Absence on ${esc(formatDate(e.sessionDate))}</span></td>
        <td data-label="Reason" class="reason">${esc(e.reason)}</td>
        <td data-label="Sent" class="nowrap">${esc(formatDateTime(e.createdAt))}</td>
        <td data-label="Decision">${status(e.status)}</td>
      </tr>`);

    container.innerHTML = `${head}
      <section aria-labelledby="absences-title">
        <h2 id="absences-title" class="mb-4">Your absences</h2>
        ${absences.length
          ? `<div class="table-wrap"><table class="table"><thead><tr><th>Date</th><th>Course</th><th>Recorded as</th><th class="right">Excuse</th></tr></thead><tbody>${absenceRows.join('')}</tbody></table></div>`
          : empty('You have no absences. Every session so far is recorded as present.')}
      </section>
      <section class="section" aria-labelledby="sent-title">
        <h2 id="sent-title">Excuses you sent</h2>
        ${excuses.length
          ? `<div class="table-wrap"><table class="table"><thead><tr><th>Course</th><th>Reason</th><th>Sent</th><th>Decision</th></tr></thead><tbody>${excuseRows.join('')}</tbody></table></div>`
          : empty('You have not sent an excuse yet. Use "Send excuse" next to an absence above.')}
      </section>`;

    container.querySelectorAll('[data-excuse]').forEach((button) => {
      const record = records.find((r) => r.id === Number(button.dataset.excuse));
      button.addEventListener('click', () => excuseDialog(record, () => renderExcuses(container)));
    });
  } catch (error) {
    container.innerHTML = head + errorNote(error);
  }
}

if (session) {
  startShell({
    session,
    // The first tab is the page students land on after logging in
    routes: [
      { id: 'check-in', label: 'Check in', render: renderCheckIn },
      { id: 'attendance', label: 'Your attendance', render: renderAttendance },
      { id: 'excuses', label: 'Excuses', render: renderExcuses }
    ]
  });
}
