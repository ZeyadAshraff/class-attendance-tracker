// Example data used in two places, so both always show the same people:
//   - frontend/js/mock-api.js  (the preview pages, no backend needed)
//   - database/setup.js        (fills the Neon database: npm run db:setup)
//
// The story: a Computer Science cohort of 24 students in week 10 of the
// term. Every student takes 6 courses: 4 core courses and 2 of 4 electives.
// Each course meets twice a week, so 9 finished weeks = 18 sessions.
//
// Attendance policy (the same for every course):
//   2 absences  -> first warning email
//   4 absences  -> second warning email
//   6 absences  -> the most a student may miss
//   7 absences  -> barred from the course's unseen exam
// An approved excuse turns an absence into "excused", which does not count.
//
// Random choices use a fixed seed, so every run creates exactly the same data.

const POLICY = { firstWarningAt: 2, secondWarningAt: 4, absenceLimit: 6 };

// Password of every example account (database/.env SEED_PASSWORD can replace it)
export const DEMO_PASSWORD = 'Attend2026!';

const TERM_START = '2026-09-20'; // Sunday of week 1
const WEEKS_DONE = 9;
const EMAIL_DOMAIN = 'example.edu';
const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I, O, 0 or 1

// day: 0 = Sunday ... 4 = Thursday. Two sessions a week per course.
const COURSES = [
  { code: '25CSCI37H', name: 'Introduction to Cloud Computing', instructor: 'Mona Hassan', core: true, slots: [[0, 10], [2, 12]] },
  { code: '25CSCI38H', name: 'Database Systems', instructor: 'Mona Hassan', core: true, slots: [[0, 12], [3, 10]] },
  { code: '25CSCI35H', name: 'Computer Networks', instructor: 'Karim Adel', core: true, slots: [[1, 9], [3, 12]] },
  { code: '25CSCI32H', name: 'Software Engineering', instructor: 'Heba Mansour', core: true, slots: [[1, 11], [4, 9]] },
  { code: '25CSCI36H', name: 'Artificial Intelligence', instructor: 'Tarek Fouad', core: false, slots: [[2, 9], [4, 11]] },
  { code: '25CSCI33H', name: 'Human-Computer Interaction', instructor: 'Heba Mansour', core: false, slots: [[1, 14], [3, 14]] },
  { code: '25CSCI34H', name: 'Operating Systems', instructor: 'Rania Samir', core: false, slots: [[0, 14], [2, 14]] },
  { code: '25MATH24H', name: 'Probability and Statistics', instructor: 'Amr Gaber', core: false, slots: [[2, 16], [4, 13]] }
];

const STUDENTS = [
  'Omar Khaled', 'Nour Ahmed', 'Youssef Ali', 'Salma Mostafa', 'Hana Ibrahim', 'Mariam Adel',
  'Ahmed Samy', 'Farida Hesham', 'Karim Nabil', 'Laila Fathy', 'Mostafa Reda', 'Jana Wael',
  'Seif Emad', 'Malak Sherif', 'Hassan Tamer', 'Rana Magdy', 'Adham Yasser', 'Nada Hossam',
  'Ziad Walid', 'Habiba Ashraf', 'Marwan Essam', 'Yara Khalil', 'Mohamed Saad', 'Dina Ramy'
];

// The 6 possible pairs of electives; student number i takes pair i % 6
const ELECTIVE_PAIRS = [[4, 5], [4, 6], [4, 7], [5, 6], [5, 7], [6, 7]];

// How many sessions a student missed in one course, as a weighted list:
// 34% missed none, 24% missed one, 15% two, ... 1% missed eight.
const MISSED_WEIGHTS = [34, 24, 15, 10, 6, 4, 3, 3, 1];

// Fixed cases so the demo accounts show every situation
const FIXED_MISSED = {
  'omar.khaled': { '25CSCI37H': 5, '25CSCI38H': 2, '25CSCI35H': 1, '25CSCI32H': 0 },
  'youssef.ali': { '25CSCI37H': 8 },
  'nour.ahmed': { '25CSCI37H': 0, '25CSCI38H': 0 }
};

const GOOD_REASONS = [
  'I had a fever and stayed home. I can bring the doctor\'s note to the next lecture.',
  'Hospital appointment for my mother; I had to go with her. The appointment letter is with me.',
  'The train from Tanta was cancelled that morning and the next one arrived after the lecture.',
  'I was representing the faculty at the regional programming contest.',
  'Family emergency, I had to travel to Alexandria for two days.',
  'Dental surgery that morning. Medical report available.'
];
const WEAK_REASONS = [
  'Overslept, sorry.',
  'I had a lot of assignments that week.',
  'I forgot the lecture was moved to this hall.',
  'Traffic was bad.'
];

// Park-Miller random numbers: the same seed always gives the same sequence
function makeRandom(seed) {
  let state = seed;
  return function random() {
    state = (state * 16807) % 2147483647;
    return (state - 1) / 2147483646;
  };
}

function pickWeighted(random, weights) {
  const total = weights.reduce((sum, w) => sum + w, 0);
  let roll = random() * total;
  for (let i = 0; i < weights.length; i += 1) {
    roll -= weights[i];
    if (roll < 0) return i;
  }
  return 0;
}

function emailOf(fullName) {
  return `${fullName.toLowerCase().replace(/[^a-z ]/g, '').trim().replace(/\s+/g, '.')}@${EMAIL_DOMAIN}`;
}

// Day 0 of week 1 is TERM_START. Hours are Cairo time (UTC+2).
function sessionTime(week, day, hour) {
  const date = new Date(`${TERM_START}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + (week - 1) * 7 + day);
  date.setUTCHours(hour - 2, 0, 0, 0);
  return date;
}

const addMinutes = (date, minutes) => new Date(date.getTime() + minutes * 60 * 1000);
const addDays = (date, days) => new Date(date.getTime() + days * 24 * 60 * 60 * 1000);

export function buildSeedData() {
  const random = makeRandom(2026);

  // ---------- People ----------
  const users = [{ id: 1, fullName: 'System Administrator', email: `admin@${EMAIL_DOMAIN}`, role: 'admin' }];
  const instructorNames = [...new Set(COURSES.map((c) => c.instructor))];
  for (const name of instructorNames) {
    users.push({ id: users.length + 1, fullName: `Dr. ${name}`, email: emailOf(name), role: 'instructor' });
  }
  for (const name of STUDENTS) {
    users.push({ id: users.length + 1, fullName: name, email: emailOf(name), role: 'student' });
  }
  const userByName = (name) => users.find((u) => u.fullName === name || u.fullName === `Dr. ${name}`);
  const students = users.filter((u) => u.role === 'student');

  // ---------- Courses and who belongs to them ----------
  const courses = COURSES.map((c, i) => ({ id: i + 1, code: c.code, name: c.name, ...POLICY }));
  const members = [];
  COURSES.forEach((c, i) => members.push({ courseId: i + 1, userId: userByName(c.instructor).id, roleInCourse: 'instructor' }));
  students.forEach((student, n) => {
    const courseIndexes = [0, 1, 2, 3, ...ELECTIVE_PAIRS[n % ELECTIVE_PAIRS.length]];
    for (const index of courseIndexes) members.push({ courseId: index + 1, userId: student.id, roleInCourse: 'student' });
  });

  // ---------- Sessions: two a week for 9 weeks ----------
  const sessions = [];
  COURSES.forEach((c, i) => {
    for (let week = 1; week <= WEEKS_DONE; week += 1) {
      for (const [day, hour] of c.slots) {
        const openedAt = sessionTime(week, day, hour);
        let code = '';
        for (let k = 0; k < 6; k += 1) code += CODE_LETTERS[Math.floor(random() * CODE_LETTERS.length)];
        sessions.push({
          id: 0,
          courseId: i + 1,
          code,
          openedBy: userByName(c.instructor).id,
          openedAt: openedAt.toISOString(),
          expiresAt: addMinutes(openedAt, 10).toISOString(),
          closedAt: addMinutes(openedAt, 15).toISOString(),
          status: 'closed'
        });
      }
    }
  });
  sessions.sort((a, b) => a.openedAt.localeCompare(b.openedAt));
  sessions.forEach((s, i) => { s.id = i + 1; });

  // ---------- Attendance, excuses and warnings ----------
  const attendance = [];
  const excuses = [];
  const warnings = [];

  for (const member of members.filter((m) => m.roleInCourse === 'student')) {
    const student = users.find((u) => u.id === member.userId);
    const course = courses.find((c) => c.id === member.courseId);
    const courseSessions = sessions.filter((s) => s.courseId === course.id);

    // How many sessions this student missed, and which ones
    const fixed = FIXED_MISSED[student.email.split('@')[0]]?.[course.code];
    const missedCount = fixed ?? pickWeighted(random, MISSED_WEIGHTS);
    const order = courseSessions.map((s) => ({ s, sortKey: random() })).sort((a, b) => a.sortKey - b.sortKey);
    const missed = new Set(order.slice(0, missedCount).map((x) => x.s.id));

    const records = courseSessions.map((s) => {
      const record = {
        id: attendance.length + 1,
        sessionId: s.id,
        studentId: student.id,
        courseId: course.id,
        status: missed.has(s.id) ? 'absent' : 'present',
        checkedInAt: missed.has(s.id) ? null : addMinutes(new Date(s.openedAt), 1 + Math.floor(random() * 9)).toISOString()
      };
      attendance.push(record);
      return record;
    });

    // About one absence in four gets an excuse. Recent ones (the last two
    // weeks) are still waiting; older ones are decided: most are approved.
    const absences = records.filter((r) => r.status === 'absent');
    absences.forEach((record, index) => {
      const session = courseSessions.find((s) => s.id === record.sessionId);
      const isOmarCloud = student.email.startsWith('omar.khaled') && course.code === '25CSCI37H';
      let status = null;
      if (isOmarCloud) {
        // Demo: Omar's first Cloud absence was excused, his last one is waiting
        if (index === 0) status = 'approved';
        if (index === absences.length - 1) status = 'pending';
      } else if (fixed === undefined && random() < 0.25) {
        const recent = new Date(session.openedAt) >= sessionTime(WEEKS_DONE - 1, 0, 0);
        status = recent ? 'pending' : random() < 0.7 ? 'approved' : 'rejected';
      }
      if (!status) return;

      const reasons = status === 'rejected' ? WEAK_REASONS : GOOD_REASONS;
      const sent = addDays(new Date(session.openedAt), 1);
      excuses.push({
        id: excuses.length + 1,
        attendanceRecordId: record.id,
        studentId: student.id,
        reason: reasons[Math.floor(random() * reasons.length)],
        status,
        createdAt: sent.toISOString(),
        reviewedBy: status === 'pending' ? null : session.openedBy,
        reviewedAt: status === 'pending' ? null : addDays(sent, 1).toISOString()
      });
      if (status === 'approved') record.status = 'excused';
    });

    // Warning emails, sent when the session that reached each level closed
    let counted = 0;
    for (const record of records) {
      if (record.status !== 'absent') continue;
      counted += 1;
      const level = counted === POLICY.firstWarningAt ? 'first_warning'
        : counted === POLICY.secondWarningAt ? 'second_warning'
          : counted === POLICY.absenceLimit + 1 ? 'exam_barred' : null;
      if (!level) continue;
      const session = courseSessions.find((s) => s.id === record.sessionId);
      warnings.push({ id: warnings.length + 1, studentId: student.id, courseId: course.id, level, sentAt: session.closedAt, emailResult: 'sent' });
    }
  }

  return { users, courses, members, sessions, attendance, excuses, warnings, reports: [] };
}
