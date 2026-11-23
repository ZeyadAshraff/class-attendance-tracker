// PLACEHOLDER BACKEND. Used while CONFIG.useMockData is true.
// Every function here has the same name, input and output as the real call in
// api.js, and applies the same rules from report 6.1 (status codes included),
// so the pages work unchanged when the real services are switched on.
// Data is kept in localStorage so the three role pages share it (open the
// instructor page in one tab and the student page in another).
// The example data comes from seed-data.js, the same file the database seed uses.
import { ApiError } from './errors.js';
import { buildSeedData, DEMO_PASSWORD } from './seed-data.js';
import { getSession } from './session.js';

const STORAGE_KEY = 'cat-preview-db-v2';
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

// ---------- Example data ----------

// The shared example data, plus the next free id for each kind of row
function buildDb() {
  const data = buildSeedData();
  const nextAfter = (rows) => rows.reduce((max, row) => Math.max(max, row.id), 0) + 1;
  return {
    ...data,
    nextId: {
      user: nextAfter(data.users),
      course: nextAfter(data.courses),
      session: nextAfter(data.sessions),
      record: nextAfter(data.attendance),
      excuse: nextAfter(data.excuses),
      warning: nextAfter(data.warnings),
      report: nextAfter(data.reports)
    }
  };
}

// ---------- Storage ----------

let db = null; // loaded by sync()

function readStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeStorage() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
  } catch {
    // storage blocked: the data lives only until the page reloads
  }
}

// Runs at the start of every call: reads the latest data (another tab may have
// changed it), or creates the example data the first time.
function sync() {
  db = readStorage() || db;
  if (!db) {
    db = buildDb();
    writeStorage();
  }
}

export function resetMockData() {
  db = buildDb();
  writeStorage();
}

// ---------- Helpers ----------

// A short pause, like a real network request, so loading states can be seen
const wait = (ms = 280) => new Promise((resolve) => { setTimeout(resolve, ms); });

function fail(status, code, message, field) {
  throw new ApiError(status, code, message, field);
}

function requireRole(...roles) {
  const session = getSession();
  if (!session) fail(401, 'UNAUTHORIZED', 'A valid login token is required.');
  if (!roles.includes(session.role)) fail(403, 'FORBIDDEN', 'Your role is not allowed to do this.');
  return { ...session.user, role: session.role };
}

const nextId = (kind) => {
  const id = db.nextId[kind];
  db.nextId[kind] += 1;
  return id;
};

const userById = (id) => db.users.find((u) => u.id === id);
const courseById = (id) => db.courses.find((c) => c.id === id);
const membersOf = (courseId, role) => db.members.filter((m) => m.courseId === courseId && m.roleInCourse === role);
const coursesOfUser = (userId) => db.members.filter((m) => m.userId === userId).map((m) => courseById(m.courseId)).filter(Boolean);
const isMember = (courseId, userId) => db.members.some((m) => m.courseId === courseId && m.userId === userId);

function requireCourseAccess(courseId, user) {
  const course = courseById(Number(courseId));
  if (!course) fail(404, 'COURSE_NOT_FOUND', 'Course not found.');
  if (user.role !== 'admin' && !isMember(course.id, user.id)) {
    fail(403, 'NOT_YOUR_COURSE', 'You do not teach this course.');
  }
  return course;
}

// Attendance policy: first warning, second warning, then (one absence over
// the limit) barred from the course's unseen exam
function classify(absences, course) {
  if (absences > course.absenceLimit) return 'barred';
  if (absences >= course.secondWarningAt) return 'second_warning';
  if (absences >= course.firstWarningAt) return 'first_warning';
  return 'safe';
}

function studentTotals(studentId, course) {
  const records = db.attendance.filter((r) => r.studentId === studentId && r.courseId === course.id);
  const present = records.filter((r) => r.status === 'present').length;
  const absent = records.filter((r) => r.status === 'absent').length;
  const excused = records.filter((r) => r.status === 'excused').length;
  const total = records.length;
  return {
    present,
    absent,
    excused,
    totalSessions: total,
    attendancePercent: total ? Math.round((present / total) * 100) : 100,
    absenceLimit: course.absenceLimit,
    firstWarningAt: course.firstWarningAt,
    secondWarningAt: course.secondWarningAt,
    absencesRemaining: Math.max(course.absenceLimit - absent, 0),
    status: classify(absent, course)
  };
}

function excuseView(excuse) {
  const record = db.attendance.find((r) => r.id === excuse.attendanceRecordId);
  const session = record && db.sessions.find((s) => s.id === record.sessionId);
  const course = record && courseById(record.courseId);
  const student = userById(excuse.studentId);
  return {
    ...excuse,
    studentName: student ? student.fullName : 'Deleted student',
    studentEmail: student ? student.email : '',
    courseId: course ? course.id : null,
    courseCode: course ? course.code : '',
    courseName: course ? course.name : '',
    sessionDate: session ? session.openedAt : null
  };
}

function personView(user) {
  const courses = coursesOfUser(user.id);
  return { id: user.id, fullName: user.fullName, email: user.email, courseIds: courses.map((c) => c.id), courses: courses.map((c) => ({ id: c.id, code: c.code })) };
}

function matches(text, search) {
  return text.toLowerCase().includes(search.trim().toLowerCase());
}

function checkSearch(search) {
  if (String(search || '').length > 100) fail(400, 'VALIDATION_ERROR', 'Search text must contain at most 100 characters.');
}

function randomCode() {
  let code = '';
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  for (const byte of bytes) code += CODE_ALPHABET[byte % CODE_ALPHABET.length];
  return code;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validatePerson({ fullName, email, password, courseIds }, { creating, ignoreId }) {
  if (creating || fullName !== undefined) {
    if (typeof fullName !== 'string' || fullName.trim().length < 1 || fullName.trim().length > 100) {
      fail(400, 'VALIDATION_ERROR', 'Name must contain between 1 and 100 characters.', 'fullName');
    }
  }
  if (creating || email !== undefined) {
    if (typeof email !== 'string' || !EMAIL_PATTERN.test(email.trim())) {
      fail(400, 'VALIDATION_ERROR', 'Email must be a valid email address.', 'email');
    }
    const taken = db.users.some((u) => u.email === email.trim().toLowerCase() && u.id !== ignoreId);
    if (taken) fail(409, 'EMAIL_TAKEN', 'Another account already uses this email.', 'email');
  }
  if (creating && (typeof password !== 'string' || password.length < 8 || password.length > 128)) {
    fail(400, 'VALIDATION_ERROR', 'Password must contain between 8 and 128 characters.', 'password');
  }
  if (courseIds !== undefined) {
    if (!Array.isArray(courseIds)) fail(400, 'VALIDATION_ERROR', 'Course ids must be a list.');
    const missing = courseIds.find((id) => !courseById(id));
    if (missing !== undefined) fail(404, 'COURSE_NOT_FOUND', `Course ${missing} does not exist.`);
  }
}

function setMemberships(userId, courseIds, roleInCourse) {
  db.members = db.members.filter((m) => m.userId !== userId);
  for (const courseId of new Set(courseIds)) {
    db.members.push({ courseId, userId, roleInCourse });
  }
}

// ---------- Shared login ----------

export async function login(email, password) {
  await wait(450);
  sync();
  if (typeof email !== 'string' || !EMAIL_PATTERN.test(email.trim())) {
    fail(400, 'VALIDATION_ERROR', 'Email must be a valid email address.', 'email');
  }
  if (typeof password !== 'string' || password.length === 0) {
    fail(400, 'VALIDATION_ERROR', 'Password is required.', 'password');
  }
  const user = db.users.find((u) => u.email === email.trim().toLowerCase());
  if (!user || password !== DEMO_PASSWORD) {
    fail(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');
  }
  return {
    token: `preview-${randomCode()}${randomCode()}`,
    role: user.role,
    expiresAt: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(),
    user: { id: user.id, fullName: user.fullName, email: user.email }
  };
}

export async function logout() {
  await wait(150);
  return null;
}

// ---------- Student Service ----------

export async function getMyAttendanceSummary() {
  await wait();
  sync();
  const me = requireRole('student');
  return coursesOfUser(me.id).map((course) => ({
    courseId: course.id,
    courseCode: course.code,
    courseName: course.name,
    ...studentTotals(me.id, course)
  }));
}

export async function getMyAttendance() {
  await wait();
  sync();
  const me = requireRole('student');
  return db.attendance
    .filter((r) => r.studentId === me.id)
    .map((record) => {
      const session = db.sessions.find((s) => s.id === record.sessionId);
      const course = courseById(record.courseId);
      const excuse = db.excuses.find((e) => e.attendanceRecordId === record.id);
      return {
        ...record,
        courseCode: course.code,
        courseName: course.name,
        sessionDate: session.openedAt,
        excuseStatus: excuse ? excuse.status : null
      };
    })
    .sort((a, b) => Date.parse(b.sessionDate) - Date.parse(a.sessionDate));
}

export async function getMyExcuses() {
  await wait();
  sync();
  const me = requireRole('student');
  return db.excuses
    .filter((e) => e.studentId === me.id)
    .map(excuseView)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

export async function checkIn(code) {
  await wait(500);
  sync();
  const me = requireRole('student');
  const cleanCode = String(code || '').trim().toUpperCase();
  if (!cleanCode) fail(400, 'VALIDATION_ERROR', 'Enter the session code.', 'code');

  const session = db.sessions.find((s) => s.code === cleanCode && s.status === 'open');
  if (!session) fail(404, 'SESSION_NOT_FOUND', 'No open session has this code. Check the code on the screen.', 'code');
  if (Date.parse(session.expiresAt) <= Date.now()) fail(410, 'SESSION_EXPIRED', 'This code has expired. Ask your instructor.', 'code');
  if (!isMember(session.courseId, me.id)) fail(403, 'NOT_ENROLLED', 'You are not enrolled in the course of this session.', 'code');
  if (db.attendance.some((r) => r.sessionId === session.id && r.studentId === me.id)) {
    fail(409, 'ALREADY_CHECKED_IN', 'You have already checked in to this session.', 'code');
  }

  const record = {
    id: nextId('record'),
    sessionId: session.id,
    studentId: me.id,
    courseId: session.courseId,
    status: 'present',
    checkedInAt: new Date().toISOString()
  };
  db.attendance.push(record);
  writeStorage();
  const course = courseById(session.courseId);
  return { ...record, courseCode: course.code, courseName: course.name };
}

export async function submitExcuse(attendanceRecordId, reason) {
  await wait(400);
  sync();
  const me = requireRole('student');
  const text = typeof reason === 'string' ? reason.trim() : '';
  if (text.length < 1 || text.length > 500) fail(400, 'VALIDATION_ERROR', 'Reason must contain between 1 and 500 characters.', 'reason');
  const record = db.attendance.find((r) => r.id === Number(attendanceRecordId));
  if (!record) fail(404, 'RECORD_NOT_FOUND', 'Attendance record not found.');
  if (record.studentId !== me.id) fail(403, 'FORBIDDEN', 'This attendance record is not yours.');
  if (record.status !== 'absent') fail(409, 'NOT_ABSENT', 'You can only excuse a session marked absent.');
  if (db.excuses.some((e) => e.attendanceRecordId === record.id)) fail(409, 'EXCUSE_EXISTS', 'You already sent an excuse for this absence.');

  const excuse = {
    id: nextId('excuse'),
    attendanceRecordId: record.id,
    studentId: me.id,
    reason: text,
    status: 'pending',
    createdAt: new Date().toISOString(),
    reviewedBy: null,
    reviewedAt: null
  };
  db.excuses.push(excuse);
  writeStorage();
  return excuseView(excuse);
}

// ---------- Instructor and Session Service ----------

export async function getMyCourses() {
  await wait();
  sync();
  const me = requireRole('instructor');
  // Each course with its open session (if any) and how many excuses wait for a decision
  return coursesOfUser(me.id).map((course) => {
    const pendingExcuses = db.excuses.filter((e) => e.status === 'pending' && excuseView(e).courseId === course.id).length;
    const open = db.sessions.find((s) => s.courseId === course.id && s.status === 'open');
    return { ...course, pendingExcuses, openSession: open ? { ...open } : null };
  });
}

export async function openSession(courseId, durationMinutes) {
  await wait(400);
  sync();
  const me = requireRole('instructor');
  const course = requireCourseAccess(courseId, me);
  const minutes = Number(durationMinutes);
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 60) {
    fail(400, 'VALIDATION_ERROR', 'Duration must be a whole number of minutes from 1 to 60.', 'durationMinutes');
  }
  if (db.sessions.some((s) => s.courseId === course.id && s.status === 'open')) {
    fail(409, 'SESSION_ALREADY_OPEN', 'This course already has an open session. Close it first.');
  }

  let code = randomCode();
  while (db.sessions.some((s) => s.status === 'open' && s.code === code)) code = randomCode();
  const now = Date.now();
  const session = {
    id: nextId('session'),
    courseId: course.id,
    code,
    openedBy: me.id,
    openedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + minutes * 60 * 1000).toISOString(),
    closedAt: null,
    status: 'open'
  };
  db.sessions.push(session);
  writeStorage();
  return { ...session, courseCode: course.code, courseName: course.name };
}

export async function getSessionLive(sessionId) {
  await wait(150);
  sync();
  const me = requireRole('instructor');
  const session = db.sessions.find((s) => s.id === Number(sessionId));
  if (!session) fail(404, 'SESSION_NOT_FOUND', 'Session not found.');
  const course = requireCourseAccess(session.courseId, me);
  const checkedIn = db.attendance
    .filter((r) => r.sessionId === session.id && r.status === 'present')
    .map((r) => ({ studentId: r.studentId, studentName: userById(r.studentId)?.fullName || 'Student', checkedInAt: r.checkedInAt }))
    .sort((a, b) => Date.parse(b.checkedInAt) - Date.parse(a.checkedInAt));
  return {
    ...session,
    courseCode: course.code,
    courseName: course.name,
    enrolledCount: membersOf(course.id, 'student').length,
    checkedIn
  };
}

// Sends every warning email a student has reached and not received yet
function evaluateWarnings(course) {
  const sent = [];
  for (const member of membersOf(course.id, 'student')) {
    const absences = studentTotals(member.userId, course).absent;
    const reached = [];
    if (absences >= course.firstWarningAt) reached.push('first_warning');
    if (absences >= course.secondWarningAt) reached.push('second_warning');
    if (absences > course.absenceLimit) reached.push('exam_barred');
    for (const level of reached) {
      const already = db.warnings.some((w) => w.studentId === member.userId && w.courseId === course.id && w.level === level);
      if (already) continue;
      const warning = { id: nextId('warning'), studentId: member.userId, courseId: course.id, level, sentAt: new Date().toISOString(), emailResult: 'sent (preview, no email)' };
      db.warnings.push(warning);
      sent.push({ ...warning, studentName: userById(member.userId)?.fullName });
    }
  }
  return sent;
}

export async function closeSession(sessionId) {
  await wait(600);
  sync();
  const me = requireRole('instructor');
  const session = db.sessions.find((s) => s.id === Number(sessionId));
  if (!session) fail(404, 'SESSION_NOT_FOUND', 'Session not found.');
  const course = requireCourseAccess(session.courseId, me);
  if (session.status !== 'open') fail(409, 'SESSION_CLOSED', 'This session is already closed.');

  session.status = 'closed';
  session.closedAt = new Date().toISOString();

  // Student Service: mark everyone without a record as absent
  const students = membersOf(course.id, 'student');
  for (const member of students) {
    const hasRecord = db.attendance.some((r) => r.sessionId === session.id && r.studentId === member.userId);
    if (!hasRecord) {
      db.attendance.push({ id: nextId('record'), sessionId: session.id, studentId: member.userId, courseId: course.id, status: 'absent', checkedInAt: null });
    }
  }
  // Course and Reports Service: send the warnings that are due
  const warningsSent = evaluateWarnings(course);
  writeStorage();

  const records = db.attendance.filter((r) => r.sessionId === session.id);
  const present = records.filter((r) => r.status === 'present').length;
  return {
    session: { ...session, courseCode: course.code, courseName: course.name },
    present,
    absent: records.length - present,
    attendanceRate: students.length ? Math.round((present / students.length) * 100) : 0,
    warningsSent
  };
}

export async function listCourseExcuses(courseId, status = 'pending') {
  await wait();
  sync();
  const me = requireRole('instructor');
  const course = requireCourseAccess(courseId, me);
  if (!['pending', 'approved', 'rejected'].includes(status)) fail(400, 'VALIDATION_ERROR', 'Status must be pending, approved or rejected.');
  return db.excuses
    .map(excuseView)
    .filter((e) => e.courseId === course.id && e.status === status)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

export async function reviewExcuse(excuseId, decision) {
  await wait(400);
  sync();
  const me = requireRole('instructor');
  if (!['approve', 'reject'].includes(decision)) fail(400, 'VALIDATION_ERROR', 'Decision must be approve or reject.');
  const excuse = db.excuses.find((e) => e.id === Number(excuseId));
  if (!excuse) fail(404, 'EXCUSE_NOT_FOUND', 'Excuse not found.');
  const record = db.attendance.find((r) => r.id === excuse.attendanceRecordId);
  requireCourseAccess(record.courseId, me);
  if (excuse.status !== 'pending') fail(409, 'ALREADY_DECIDED', 'This excuse was already decided.');

  excuse.status = decision === 'approve' ? 'approved' : 'rejected';
  excuse.reviewedBy = me.id;
  excuse.reviewedAt = new Date().toISOString();
  if (decision === 'approve') record.status = 'excused';
  writeStorage();
  return excuseView(excuse);
}

// ---------- Course and Reports Service ----------

export async function getCourseFlags(courseId) {
  await wait();
  sync();
  const me = requireRole('instructor', 'admin');
  const course = requireCourseAccess(courseId, me);
  const order = { barred: 0, second_warning: 1, first_warning: 2, safe: 3 };
  return membersOf(course.id, 'student')
    .map((member) => {
      const student = userById(member.userId);
      const lastWarning = db.warnings
        .filter((w) => w.studentId === member.userId && w.courseId === course.id)
        .sort((a, b) => Date.parse(b.sentAt) - Date.parse(a.sentAt))[0];
      return {
        studentId: student.id,
        studentName: student.fullName,
        email: student.email,
        ...studentTotals(student.id, course),
        lastWarning: lastWarning ? { level: lastWarning.level, sentAt: lastWarning.sentAt } : null
      };
    })
    .sort((a, b) => order[a.status] - order[b.status] || b.absent - a.absent);
}

export async function sendWarnings(courseId) {
  await wait(700);
  sync();
  const me = requireRole('instructor', 'admin');
  const course = requireCourseAccess(courseId, me);
  const sent = evaluateWarnings(course);
  writeStorage();
  return sent;
}

const REPORT_SCOPES = ['course', 'student', 'session'];
const REPORT_FORMATS = ['csv', 'json'];

export async function generateReport({ courseId, scope, format }) {
  await wait(700);
  sync();
  const me = requireRole('instructor', 'admin');
  const course = requireCourseAccess(courseId, me);
  if (!REPORT_SCOPES.includes(scope)) fail(400, 'VALIDATION_ERROR', 'Scope must be course, student or session.', 'scope');
  if (!REPORT_FORMATS.includes(format)) fail(400, 'VALIDATION_ERROR', 'Format must be csv or json.', 'format');
  const report = { id: nextId('report'), courseId: course.id, scope, format, createdBy: me.id, createdAt: new Date().toISOString() };
  db.reports.push(report);
  writeStorage();
  return { ...report, courseCode: course.code };
}

export async function listReports(courseId) {
  await wait();
  sync();
  const me = requireRole('instructor', 'admin');
  const allowed = me.role === 'admin' ? db.courses : coursesOfUser(me.id);
  const allowedIds = new Set(allowed.map((c) => c.id));
  return db.reports
    .filter((r) => allowedIds.has(r.courseId) && (!courseId || r.courseId === Number(courseId)))
    .map((r) => ({ ...r, courseCode: courseById(r.courseId)?.code || '', createdByName: userById(r.createdBy)?.fullName || '-' }))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

function reportRows(report) {
  const course = courseById(report.courseId);
  const students = membersOf(course.id, 'student').map((m) => userById(m.userId));
  const sessions = db.sessions.filter((s) => s.courseId === course.id && s.status === 'closed');
  if (report.scope === 'course') {
    return students.map((s) => {
      const t = studentTotals(s.id, course);
      return { student: s.fullName, email: s.email, present: t.present, absent: t.absent, excused: t.excused, attendancePercent: t.attendancePercent, absencesRemaining: t.absencesRemaining, status: t.status };
    });
  }
  if (report.scope === 'session') {
    return sessions.map((session) => {
      const records = db.attendance.filter((r) => r.sessionId === session.id);
      const present = records.filter((r) => r.status === 'present').length;
      return { date: session.openedAt, code: session.code, present, absent: records.filter((r) => r.status === 'absent').length, excused: records.filter((r) => r.status === 'excused').length, attendanceRate: records.length ? Math.round((present / records.length) * 100) : 0 };
    });
  }
  return db.attendance
    .filter((r) => r.courseId === course.id)
    .map((r) => ({ student: userById(r.studentId)?.fullName, date: db.sessions.find((s) => s.id === r.sessionId)?.openedAt, status: r.status, checkedInAt: r.checkedInAt || '' }));
}

function toCsv(rows) {
  if (rows.length === 0) return '';
  const headers = Object.keys(rows[0]);
  const cell = (value) => {
    const text = String(value ?? '');
    const safe = /^[=+\-@]/.test(text) ? `'${text}` : text; // stops spreadsheet formulas
    return /[",\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
  };
  return [headers.join(','), ...rows.map((row) => headers.map((h) => cell(row[h])).join(','))].join('\n');
}

export async function downloadReport(reportId) {
  await wait(300);
  sync();
  const me = requireRole('instructor', 'admin');
  const report = db.reports.find((r) => r.id === Number(reportId));
  if (!report) fail(404, 'REPORT_NOT_FOUND', 'Report not found.');
  const course = requireCourseAccess(report.courseId, me);
  const rows = reportRows(report);
  const content = report.format === 'csv' ? toCsv(rows) : JSON.stringify(rows, null, 2);
  const blob = new Blob([content], { type: report.format === 'csv' ? 'text/csv' : 'application/json' });
  return { url: URL.createObjectURL(blob), fileName: `${course.code}-${report.scope}-report-${report.id}.${report.format}` };
}

// ---------- Admin: students (Student Service) and instructors (Instructor and Session Service) ----------
// Listing, adding and editing work the same way for both; only the role differs.

async function listPeople(role, search) {
  await wait();
  sync();
  requireRole('admin');
  checkSearch(search);
  return db.users
    .filter((u) => u.role === role && (matches(u.fullName, search) || matches(u.email, search)))
    .map(personView);
}

async function createPerson(role, { fullName, email, password, courseIds = [] }) {
  await wait(400);
  sync();
  requireRole('admin');
  validatePerson({ fullName, email, password, courseIds }, { creating: true });
  const user = { id: nextId('user'), fullName: fullName.trim(), email: email.trim().toLowerCase(), role };
  db.users.push(user);
  setMemberships(user.id, courseIds, role);
  writeStorage();
  return personView(user);
}

async function updatePerson(role, id, changes) {
  await wait(400);
  sync();
  requireRole('admin');
  const user = db.users.find((u) => u.id === Number(id) && u.role === role);
  if (!user) fail(404, `${role.toUpperCase()}_NOT_FOUND`, `No ${role} has this id.`);
  validatePerson(changes, { creating: false, ignoreId: user.id });
  if (changes.fullName !== undefined) user.fullName = changes.fullName.trim();
  if (changes.email !== undefined) user.email = changes.email.trim().toLowerCase();
  if (changes.courseIds !== undefined) setMemberships(user.id, changes.courseIds, role);
  writeStorage();
  return personView(user);
}

export const listStudents = (search = '') => listPeople('student', search);
export const createStudent = (data) => createPerson('student', data);
export const updateStudent = (id, changes) => updatePerson('student', id, changes);

export const listInstructors = (search = '') => listPeople('instructor', search);
export const createInstructor = (data) => createPerson('instructor', data);
export const updateInstructor = (id, changes) => updatePerson('instructor', id, changes);

// Deleting a student also deletes their attendance, excuses and warnings
export async function deleteStudent(id) {
  await wait(400);
  sync();
  requireRole('admin');
  const user = db.users.find((u) => u.id === Number(id) && u.role === 'student');
  if (!user) fail(404, 'STUDENT_NOT_FOUND', 'No student has this id.');
  const recordIds = new Set(db.attendance.filter((r) => r.studentId === user.id).map((r) => r.id));
  db.users = db.users.filter((u) => u.id !== user.id);
  db.members = db.members.filter((m) => m.userId !== user.id);
  db.attendance = db.attendance.filter((r) => r.studentId !== user.id);
  db.excuses = db.excuses.filter((e) => !recordIds.has(e.attendanceRecordId));
  db.warnings = db.warnings.filter((w) => w.studentId !== user.id);
  writeStorage();
  return null;
}

// Deleting an instructor keeps the sessions they ran (opened by: nobody)
export async function deleteInstructor(id) {
  await wait(400);
  sync();
  requireRole('admin');
  const user = db.users.find((u) => u.id === Number(id) && u.role === 'instructor');
  if (!user) fail(404, 'INSTRUCTOR_NOT_FOUND', 'No instructor has this id.');
  db.users = db.users.filter((u) => u.id !== user.id);
  db.members = db.members.filter((m) => m.userId !== user.id);
  db.sessions.forEach((s) => { if (s.openedBy === user.id) s.openedBy = null; });
  writeStorage();
  return null;
}

// ---------- Courses (Course and Reports Service) ----------

function courseView(course) {
  return {
    ...course,
    studentCount: membersOf(course.id, 'student').length,
    instructors: membersOf(course.id, 'instructor').map((m) => userById(m.userId)?.fullName).filter(Boolean),
    sessionCount: db.sessions.filter((s) => s.courseId === course.id).length
  };
}

// 1 <= first warning < second warning <= absence limit
function validatePolicy({ firstWarningAt, secondWarningAt, absenceLimit }) {
  if (!Number.isInteger(firstWarningAt) || firstWarningAt < 1) {
    fail(400, 'VALIDATION_ERROR', 'First warning must be a whole number of at least 1.', 'firstWarningAt');
  }
  if (!Number.isInteger(secondWarningAt) || secondWarningAt <= firstWarningAt) {
    fail(400, 'VALIDATION_ERROR', 'Second warning must be a whole number above the first warning.', 'secondWarningAt');
  }
  if (!Number.isInteger(absenceLimit) || absenceLimit < secondWarningAt || absenceLimit > 50) {
    fail(400, 'VALIDATION_ERROR', 'Absences allowed must be at least the second warning and at most 50.', 'absenceLimit');
  }
}

export async function listCourses(search = '') {
  await wait();
  sync();
  requireRole('student', 'instructor', 'admin');
  checkSearch(search);
  return db.courses
    .filter((c) => matches(c.code, search) || matches(c.name, search))
    .map(courseView);
}

export async function createCourse({ code, name, firstWarningAt, secondWarningAt, absenceLimit }) {
  await wait(400);
  sync();
  requireRole('admin');
  const cleanCode = String(code || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{2,12}$/.test(cleanCode)) fail(400, 'VALIDATION_ERROR', 'Code must be 2 to 12 letters or digits.', 'code');
  if (typeof name !== 'string' || name.trim().length < 1 || name.trim().length > 100) fail(400, 'VALIDATION_ERROR', 'Name must contain between 1 and 100 characters.', 'name');
  validatePolicy({ firstWarningAt, secondWarningAt, absenceLimit });
  if (db.courses.some((c) => c.code === cleanCode)) fail(409, 'COURSE_CODE_TAKEN', 'Another course already uses this code.', 'code');
  const course = { id: nextId('course'), code: cleanCode, name: name.trim(), firstWarningAt, secondWarningAt, absenceLimit };
  db.courses.push(course);
  writeStorage();
  return courseView(course);
}

export async function updateCourse(id, { name, firstWarningAt, secondWarningAt, absenceLimit }) {
  await wait(400);
  sync();
  requireRole('admin');
  const course = courseById(Number(id));
  if (!course) fail(404, 'COURSE_NOT_FOUND', 'Course not found.');
  if (name !== undefined && (typeof name !== 'string' || name.trim().length < 1 || name.trim().length > 100)) {
    fail(400, 'VALIDATION_ERROR', 'Name must contain between 1 and 100 characters.', 'name');
  }
  const policy = {
    firstWarningAt: firstWarningAt ?? course.firstWarningAt,
    secondWarningAt: secondWarningAt ?? course.secondWarningAt,
    absenceLimit: absenceLimit ?? course.absenceLimit
  };
  validatePolicy(policy);
  if (name !== undefined) course.name = name.trim();
  Object.assign(course, policy);
  writeStorage();
  return courseView(course);
}

export async function deleteCourse(id) {
  await wait(400);
  sync();
  requireRole('admin');
  const course = courseById(Number(id));
  if (!course) fail(404, 'COURSE_NOT_FOUND', 'Course not found.');
  if (db.sessions.some((s) => s.courseId === course.id)) {
    fail(409, 'COURSE_HAS_SESSIONS', 'This course has recorded sessions, so it cannot be deleted.');
  }
  db.courses = db.courses.filter((c) => c.id !== course.id);
  db.members = db.members.filter((m) => m.courseId !== course.id);
  db.warnings = db.warnings.filter((w) => w.courseId !== course.id);
  db.reports = db.reports.filter((r) => r.courseId !== course.id);
  writeStorage();
  return null;
}
