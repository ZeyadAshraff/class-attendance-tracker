// Pages shared by instructors and administrators (Course and Reports Service):
// absence limits with warning emails, and attendance reports.
// Each page gets loadCourses: instructors see their own courses, admins all.
import { api } from './api.js';
import { pageHead } from './shell.js';
import {
  empty, errorNote, esc, formatDateTime, loading, setLoading, status, tally,
  toast, triggerDownload, warningName
} from './ui.js';

export function courseSelect(courses, selectedId, id = 'course-select') {
  const options = courses.map((c) => `<option value="${c.id}" ${c.id === selectedId ? 'selected' : ''}>${esc(c.code)} ${esc(c.name)}</option>`);
  return `
    <div class="field">
      <label for="${id}">Course</label>
      <select class="select" id="${id}">${options.join('')}</select>
    </div>`;
}

// The chosen course is kept in the address (#flags?course=2), so the back
// button and a page refresh keep it.
export function bindCourseSelect(container, routeId) {
  container.querySelector('#course-select').addEventListener('change', (event) => {
    location.hash = `${routeId}?course=${event.target.value}`;
  });
}

// The course named in the address, or the first one
export function pickCourse(courses, params) {
  const wanted = Number(params.get('course'));
  return courses.find((c) => c.id === wanted) || courses[0];
}

// Loads the course list. Returns null (and shows why) when there is nothing to show.
async function loadCourseList(container, head, loadCourses) {
  container.innerHTML = head + loading();
  try {
    const courses = await loadCourses();
    if (courses.length > 0) return courses;
    container.innerHTML = head + empty('There are no courses yet.');
  } catch (error) {
    container.innerHTML = head + errorNote(error);
  }
  return null;
}

// ---------- Absence limits ----------

export async function renderFlags(container, params, loadCourses) {
  const head = pageHead('Absence limits', '<button class="btn" id="warn-btn">Send due warning emails</button>');
  const courses = await loadCourseList(container, head, loadCourses);
  if (!courses) return;

  const course = pickCourse(courses, params);
  container.innerHTML = `${head}
    <div class="toolbar">${courseSelect(courses, course.id)}</div>
    <div id="flags-body">${loading()}</div>`;
  bindCourseSelect(container, 'flags');

  const body = container.querySelector('#flags-body');
  const load = async () => {
    try {
      const rows = await api.getCourseFlags(course.id);
      if (rows.length === 0) {
        body.innerHTML = empty(`No students are enrolled in ${course.code} yet.`);
        return;
      }
      const tableRows = rows.map((r) => `
        <tr>
          <td data-label="Student">${esc(r.studentName)}<span class="sub">${esc(r.email)}</span></td>
          <td data-label="Absences">${tally(r.absent, r)}<span class="sub">${r.absent} of ${r.absenceLimit} allowed</span></td>
          <td data-label="Attended" class="num">${r.attendancePercent}%<span class="sub">${r.excused} excused</span></td>
          <td data-label="Status">${status(r.status)}</td>
          <td data-label="Last warning">${r.lastWarning
            ? `${warningName(r.lastWarning.level)}<span class="sub">${esc(formatDateTime(r.lastWarning.sentAt))}</span>`
            : '<span class="quiet">None sent</span>'}</td>
        </tr>`);
      body.innerHTML = `
        <div class="table-wrap"><table class="table">
          <thead><tr><th>Student</th><th>Absences</th><th class="num">Attended</th><th>Status</th><th>Last warning</th></tr></thead>
          <tbody>${tableRows.join('')}</tbody>
        </table></div>`;
    } catch (error) {
      body.innerHTML = errorNote(error);
    }
  };
  await load();

  container.querySelector('#warn-btn').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    setLoading(button, true, 'Sending');
    try {
      const sent = await api.sendWarnings(course.id);
      toast(sent.length
        ? `Warning ${sent.length === 1 ? 'email' : 'emails'} sent to ${sent.map((w) => w.studentName).join(', ')}`
        : 'No warnings are due. Each student gets one email per level.');
      await load();
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      setLoading(button, false);
    }
  });
}

// ---------- Reports ----------

// [value sent to the API, name, what the file contains]
const CONTENTS = [
  ['course', 'One row per student', 'Present, absent and excused totals, attendance rate and status.'],
  ['session', 'One row per session', 'Date, code, and how many were present, absent and excused.'],
  ['student', 'Full register', 'Every student in every session, with the check-in time.']
];
const contentName = (scope) => CONTENTS.find(([value]) => value === scope)?.[1] || scope;

export async function renderReports(container, params, loadCourses) {
  const head = pageHead('Reports');
  const courses = await loadCourseList(container, head, loadCourses);
  if (!courses) return;

  const course = pickCourse(courses, params);
  container.innerHTML = `${head}
    <form class="form narrow" novalidate>
      ${courseSelect(courses, course.id)}
      <fieldset class="field choices">
        <legend>Contents</legend>
        ${CONTENTS.map(([value, name, text], i) => `
          <label class="choice"><input type="radio" name="scope" value="${value}" ${i === 0 ? 'checked' : ''}><span>${name}<span>${text}</span></span></label>`).join('')}
      </fieldset>
      <fieldset class="field choices">
        <legend>File type</legend>
        <label class="choice"><input type="radio" name="format" value="csv" checked><span>CSV</span></label>
        <label class="choice"><input type="radio" name="format" value="json"><span>JSON</span></label>
      </fieldset>
      <div><button class="btn" type="submit">Create report</button></div>
    </form>
    <section class="section" aria-labelledby="made-title">
      <h2 id="made-title">Reports for ${esc(course.code)}</h2>
      <div id="report-list">${loading()}</div>
    </section>`;
  bindCourseSelect(container, 'reports');

  const list = container.querySelector('#report-list');
  const loadList = async () => {
    try {
      const reports = await api.listReports(course.id);
      if (reports.length === 0) {
        list.innerHTML = empty(`No reports for ${course.code} yet. Create one with the form above.`);
        return;
      }
      const rows = reports.map((r) => `
        <tr>
          <td data-label="Report">${esc(contentName(r.scope))}<span class="sub">${esc(r.format.toUpperCase())} file</span></td>
          <td data-label="Created">${esc(formatDateTime(r.createdAt))}<span class="sub">by ${esc(r.createdByName)}</span></td>
          <td class="row-actions"><button class="btn secondary small" data-download="${r.id}">Download</button></td>
        </tr>`);
      list.innerHTML = `<div class="table-wrap"><table class="table"><thead><tr><th>Report</th><th>Created</th><th><span class="sr-only">File</span></th></tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
      list.querySelectorAll('[data-download]').forEach((button) => {
        button.addEventListener('click', async () => {
          setLoading(button, true, 'Preparing');
          try {
            const { url, fileName } = await api.downloadReport(button.dataset.download);
            triggerDownload(url, fileName);
          } catch (error) {
            toast(error.message, 'error');
          } finally {
            setLoading(button, false);
          }
        });
      });
    } catch (error) {
      list.innerHTML = errorNote(error);
    }
  };
  await loadList();

  const form = container.querySelector('form');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = form.querySelector('button[type="submit"]');
    setLoading(button, true, 'Creating');
    try {
      await api.generateReport({ courseId: course.id, scope: form.elements.scope.value, format: form.elements.format.value });
      toast('Report created');
      await loadList();
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      setLoading(button, false);
    }
  });
}
