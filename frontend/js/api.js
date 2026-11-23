// Every call the pages make goes through `api`.
// While CONFIG.useMockData is true it uses the placeholder backend (mock-api.js);
// set it to false to call the real services with fetch().
import { CONFIG } from './config.js';
import { ApiError } from './errors.js';
import * as mock from './mock-api.js';
import { getSession } from './session.js';

async function request(service, method, path, body) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const session = getSession();
  if (session) headers.Authorization = `Bearer ${session.token}`;

  let response;
  try {
    response = await fetch(`${CONFIG.services[service]}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Cannot reach the server. Check that the service is running.');
  }

  if (response.status === 204) return null; // success with no body (logout, delete)

  let data = null;
  try {
    data = await response.json();
  } catch {
    // the answer was not JSON; the status code below still says what happened
  }
  if (!response.ok) {
    const error = data?.error ?? {};
    throw new ApiError(response.status, error.code || 'HTTP_ERROR', error.message || `Request failed (${response.status}).`, error.field);
  }
  return data;
}

const q = (value) => encodeURIComponent(value);

// Paths from report 6.1. Lines marked NEW are needed by the pages but are not
// in the report's API table yet.
const real = {
  // Shared login
  login: (email, password) => request('student', 'POST', '/auth/login', { email, password }),
  logout: () => request('student', 'POST', '/auth/logout'),

  // Student Service
  getMyAttendanceSummary: () => request('student', 'GET', '/students/me/attendance-summary'),
  getMyAttendance: () => request('student', 'GET', '/students/me/attendance'), // NEW
  getMyExcuses: () => request('student', 'GET', '/students/me/excuses'), // NEW
  checkIn: (code) => request('student', 'POST', '/attendance/check-in', { code }),
  submitExcuse: (attendanceRecordId, reason) => request('student', 'POST', '/excuses', { attendanceRecordId, reason }),
  listStudents: (search = '') => request('student', 'GET', `/students?search=${q(search)}`),
  createStudent: (data) => request('student', 'POST', '/students', data),
  updateStudent: (id, data) => request('student', 'PATCH', `/students/${id}`, data),
  deleteStudent: (id) => request('student', 'DELETE', `/students/${id}`),

  // Instructor and Session Service
  getMyCourses: () => request('session', 'GET', '/instructors/me/courses'), // NEW
  openSession: (courseId, durationMinutes) => request('session', 'POST', '/sessions', { courseId, durationMinutes }),
  getSessionLive: (id) => request('session', 'GET', `/sessions/${id}`), // NEW
  closeSession: (id) => request('session', 'PATCH', `/sessions/${id}/close`),
  listCourseExcuses: (courseId, status) => request('session', 'GET', `/courses/${courseId}/excuses?status=${q(status)}`),
  reviewExcuse: (id, decision) => request('session', 'PATCH', `/excuses/${id}/review`, { decision }),
  listInstructors: (search = '') => request('session', 'GET', `/instructors?search=${q(search)}`),
  createInstructor: (data) => request('session', 'POST', '/instructors', data),
  updateInstructor: (id, data) => request('session', 'PATCH', `/instructors/${id}`, data),
  deleteInstructor: (id) => request('session', 'DELETE', `/instructors/${id}`),

  // Course and Reports Service
  listCourses: (search = '') => request('course', 'GET', `/courses?search=${q(search)}`),
  createCourse: (data) => request('course', 'POST', '/courses', data),
  updateCourse: (id, data) => request('course', 'PATCH', `/courses/${id}`, data),
  deleteCourse: (id) => request('course', 'DELETE', `/courses/${id}`),
  getCourseFlags: (courseId) => request('course', 'GET', `/courses/${courseId}/flags`),
  sendWarnings: (courseId) => request('course', 'POST', `/courses/${courseId}/warnings`),
  generateReport: (data) => request('course', 'POST', '/reports', data),
  listReports: (courseId) => request('course', 'GET', `/reports${courseId ? `?courseId=${q(courseId)}` : ''}`), // NEW
  downloadReport: (id) => request('course', 'GET', `/reports/${id}/download`)
};

export const api = CONFIG.useMockData ? mock : real;
