// Administrator pages: students, instructors, courses, absence limits and
// reports.
import { api } from './api.js';
import { renderFlags, renderReports } from './course-views.js';
import { requireRole } from './session.js';
import { pageHead, startShell } from './shell.js';
import {
  checkedValues, confirmDialog, count, courseChecks, debounce, empty, errorNote,
  esc, field, fieldError, loading, openFormDialog, toast
} from './ui.js';

const session = requireRole('admin');

// ---------- Students and instructors ----------
// The same page for both; only the API calls and the words change.
// The list reloads as the admin types in the search box.

function peoplePage(kind) {
  const isStudent = kind === 'student';
  const word = isStudent ? 'student' : 'instructor';
  const title = isStudent ? 'Students' : 'Instructors';
  const calls = isStudent
    ? { list: api.listStudents, create: api.createStudent, update: api.updateStudent, remove: api.deleteStudent }
    : { list: api.listInstructors, create: api.createInstructor, update: api.updateInstructor, remove: api.deleteInstructor };

  function personDialog(courses, person, onSaved) {
    const editing = Boolean(person);
    openFormDialog({
      title: editing ? `Edit ${person.fullName}` : `Add a ${word}`,
      submitLabel: editing ? 'Save changes' : `Add ${word}`,
      body: `
        ${field({ name: 'fullName', label: 'Full name', value: person?.fullName || '', required: true, attrs: 'maxlength="100" autocomplete="off"' })}
        ${field({ name: 'email', label: 'College email', type: 'email', value: person?.email || '', required: true, attrs: 'maxlength="254" autocomplete="off"' })}
        ${editing ? '' : field({ name: 'password', label: 'First password', type: 'password', required: true, hint: 'At least 8 characters.', attrs: 'minlength="8" maxlength="128" autocomplete="new-password"' })}
        ${courseChecks('courseIds', courses, person?.courseIds || [])}`,
      onSubmit: async (form) => {
        const fullName = form.elements.fullName.value.trim();
        const email = form.elements.email.value.trim();
        if (!fullName) throw fieldError('fullName', 'Enter the full name.');
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw fieldError('email', 'Enter an email such as name@college.edu.');
        const data = { fullName, email, courseIds: checkedValues(form, 'courseIds') };
        if (!editing) {
          data.password = form.elements.password.value;
          if (data.password.length < 8) throw fieldError('password', 'Use at least 8 characters.');
        }
        const saved = editing ? await calls.update(person.id, data) : await calls.create(data);
        toast(editing ? `Saved ${saved.fullName}` : `Added ${saved.fullName}`);
        onSaved();
      }
    });
  }

  return async function renderPeople(container) {
    container.innerHTML = pageHead(title, `<button class="btn" id="add-btn">Add ${word}</button>`) + `
      <div class="toolbar">
        <div class="field search-field">
          <label for="search">Search by name or email</label>
          <input class="input" type="search" id="search" maxlength="100" autocomplete="off">
        </div>
        <p class="quiet count-note" id="result-count" aria-live="polite"></p>
      </div>
      <div id="people-list">${loading()}</div>`;

    let courses = [];
    let people = [];
    const list = container.querySelector('#people-list');
    const search = container.querySelector('#search');

    const load = async () => {
      try {
        [people, courses] = await Promise.all([calls.list(search.value), api.listCourses('')]);
        container.querySelector('#result-count').textContent = count(people.length, word);
        if (people.length === 0) {
          list.innerHTML = search.value
            ? empty(`No ${word} matches "${search.value}". Check the spelling or search by email.`)
            : empty(`There are no ${word}s yet. Use "Add ${word}" to create the first account.`);
          return;
        }
        const rows = people.map((p) => `
          <tr>
            <td data-label="Name">${esc(p.fullName)}</td>
            <td data-label="Email">${esc(p.email)}</td>
            <td data-label="Courses">${p.courses.length ? esc(p.courses.map((c) => c.code).join(', ')) : '<span class="quiet">None</span>'}</td>
            <td class="row-actions">
              <button class="link-btn" data-edit="${p.id}" aria-label="Edit ${esc(p.fullName)}">Edit</button>
              <button class="link-btn" data-delete="${p.id}" aria-label="Delete ${esc(p.fullName)}">Delete</button>
            </td>
          </tr>`);
        list.innerHTML = `<div class="table-wrap"><table class="table"><thead><tr><th>Name</th><th>Email</th><th>Courses</th><th><span class="sr-only">Actions</span></th></tr></thead><tbody>${rows.join('')}</tbody></table></div>`;

        list.querySelectorAll('[data-edit]').forEach((button) => {
          button.addEventListener('click', () => personDialog(courses, people.find((p) => p.id === Number(button.dataset.edit)), load));
        });
        list.querySelectorAll('[data-delete]').forEach((button) => {
          button.addEventListener('click', () => {
            const person = people.find((p) => p.id === Number(button.dataset.delete));
            confirmDialog({
              title: `Delete ${person.fullName}?`,
              message: isStudent
                ? 'Their enrolments, attendance records and excuses are deleted too. This cannot be undone.'
                : 'Their course assignments are removed. Sessions they ran stay in the records. This cannot be undone.',
              confirmLabel: `Delete ${word}`,
              onConfirm: async () => {
                await calls.remove(person.id);
                toast(`Deleted ${person.fullName}`);
                load();
              }
            });
          });
        });
      } catch (error) {
        list.innerHTML = errorNote(error);
      }
    };

    search.addEventListener('input', debounce(load, 250));
    container.querySelector('#add-btn').addEventListener('click', () => personDialog(courses, null, load));
    await load();
  };
}

// ---------- Courses ----------

function courseDialog(course, onSaved) {
  const editing = Boolean(course);
  openFormDialog({
    title: editing ? `Edit ${course.code}` : 'Add a course',
    submitLabel: editing ? 'Save changes' : 'Add course',
    body: `
      <div class="form-row">
        ${field({ name: 'code', label: 'Course code', value: course?.code || '', required: !editing, hint: editing ? 'The code cannot be changed.' : 'For example 25CSCI37H.', attrs: `maxlength="12" autocomplete="off" ${editing ? 'readonly' : ''}` })}
        ${field({ name: 'name', label: 'Course name', value: course?.name || '', required: true, attrs: 'maxlength="100" autocomplete="off"' })}
      </div>
      <div class="form-row three">
        ${field({ name: 'firstWarningAt', label: 'First warning at', type: 'number', value: course?.firstWarningAt ?? 2, required: true, hint: 'Absences.', attrs: 'min="1" max="50" step="1" inputmode="numeric"' })}
        ${field({ name: 'secondWarningAt', label: 'Second warning at', type: 'number', value: course?.secondWarningAt ?? 4, required: true, hint: 'Absences.', attrs: 'min="1" max="50" step="1" inputmode="numeric"' })}
        ${field({ name: 'absenceLimit', label: 'Absences allowed', type: 'number', value: course?.absenceLimit ?? 6, required: true, hint: 'One more bars the student from the unseen exam.', attrs: 'min="1" max="50" step="1" inputmode="numeric"' })}
      </div>`,
    onSubmit: async (form) => {
      const code = form.elements.code.value.trim().toUpperCase();
      const name = form.elements.name.value.trim();
      const firstWarningAt = Number(form.elements.firstWarningAt.value);
      const secondWarningAt = Number(form.elements.secondWarningAt.value);
      const absenceLimit = Number(form.elements.absenceLimit.value);
      if (!editing && !/^[A-Z0-9]{2,12}$/.test(code)) throw fieldError('code', 'Use 2 to 12 letters or digits.');
      if (!name) throw fieldError('name', 'Enter the course name.');
      if (!Number.isInteger(firstWarningAt) || firstWarningAt < 1) throw fieldError('firstWarningAt', 'Enter a whole number of at least 1.');
      if (!Number.isInteger(secondWarningAt) || secondWarningAt <= firstWarningAt) throw fieldError('secondWarningAt', `Enter a whole number above ${firstWarningAt}.`);
      if (!Number.isInteger(absenceLimit) || absenceLimit < secondWarningAt) throw fieldError('absenceLimit', `Enter a whole number of at least ${secondWarningAt}.`);
      const saved = editing
        ? await api.updateCourse(course.id, { name, firstWarningAt, secondWarningAt, absenceLimit })
        : await api.createCourse({ code, name, firstWarningAt, secondWarningAt, absenceLimit });
      toast(editing ? `Saved ${saved.code}` : `Added ${saved.code}`);
      onSaved();
    }
  });
}

async function renderCourses(container) {
  container.innerHTML = pageHead('Courses', '<button class="btn" id="add-btn">Add course</button>') + `
    <div class="toolbar">
      <div class="field search-field">
        <label for="search">Search by code or name</label>
        <input class="input" type="search" id="search" maxlength="100" autocomplete="off">
      </div>
    </div>
    <div id="course-list">${loading()}</div>`;

  const list = container.querySelector('#course-list');
  const search = container.querySelector('#search');
  let courses = [];

  const load = async () => {
    try {
      courses = await api.listCourses(search.value);
      if (courses.length === 0) {
        list.innerHTML = search.value ? empty(`No course matches "${search.value}".`) : empty('There are no courses yet. Use "Add course" to create the first one.');
        return;
      }
      const rows = courses.map((c) => `
        <tr>
          <td data-label="Course"><strong>${esc(c.code)}</strong><span class="sub">${esc(c.name)}</span></td>
          <td data-label="Instructor">${c.instructors.length ? esc(c.instructors.join(', ')) : '<span class="quiet">Not assigned</span>'}</td>
          <td data-label="Students" class="num">${c.studentCount}</td>
          <td data-label="First warning" class="num">${c.firstWarningAt}</td>
          <td data-label="Second warning" class="num">${c.secondWarningAt}</td>
          <td data-label="Absences allowed" class="num">${c.absenceLimit}</td>
          <td data-label="Sessions held" class="num">${c.sessionCount}</td>
          <td class="row-actions">
            <button class="link-btn" data-edit="${c.id}" aria-label="Edit ${esc(c.code)}">Edit</button>
            <button class="link-btn" data-delete="${c.id}" aria-label="Delete ${esc(c.code)}">Delete</button>
          </td>
        </tr>`);
      list.innerHTML = `<div class="table-wrap"><table class="table"><thead><tr><th>Course</th><th>Instructor</th><th class="num">Students</th><th class="num">First warning</th><th class="num">Second warning</th><th class="num">Absences allowed</th><th class="num">Sessions held</th><th><span class="sr-only">Actions</span></th></tr></thead><tbody>${rows.join('')}</tbody></table></div>`;

      list.querySelectorAll('[data-edit]').forEach((button) => {
        button.addEventListener('click', () => courseDialog(courses.find((c) => c.id === Number(button.dataset.edit)), load));
      });
      list.querySelectorAll('[data-delete]').forEach((button) => {
        button.addEventListener('click', () => {
          const course = courses.find((c) => c.id === Number(button.dataset.delete));
          confirmDialog({
            title: `Delete ${course.code}?`,
            message: course.sessionCount
              ? `${course.code} has ${count(course.sessionCount, 'recorded session')}, so it cannot be deleted. Attendance records must be kept.`
              : 'The course and its enrolments are removed. This cannot be undone.',
            confirmLabel: 'Delete course',
            onConfirm: async () => {
              await api.deleteCourse(course.id);
              toast(`Deleted ${course.code}`);
              load();
            }
          });
        });
      });
    } catch (error) {
      list.innerHTML = errorNote(error);
    }
  };

  search.addEventListener('input', debounce(load, 250));
  container.querySelector('#add-btn').addEventListener('click', () => courseDialog(null, load));
  await load();
}

if (session) {
  const allCourses = () => api.listCourses('');
  startShell({
    session,
    routes: [
      { id: 'students', label: 'Students', render: peoplePage('student') },
      { id: 'instructors', label: 'Instructors', render: peoplePage('instructor') },
      { id: 'courses', label: 'Courses', render: renderCourses },
      { id: 'flags', label: 'Absence limits', render: (c, p) => renderFlags(c, p, allCourses) },
      { id: 'reports', label: 'Reports', render: (c, p) => renderReports(c, p, allCourses) }
    ]
  });
}
