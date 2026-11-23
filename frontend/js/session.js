// The login token lives in sessionStorage: it is gone when the tab closes,
// and two tabs can be logged in as different roles (useful for testing).
const KEY = 'cat-session';

const HOME_PAGES = {
  student: 'student.html',
  instructor: 'instructor.html',
  admin: 'admin.html'
};

export function getSession() {
  try {
    const session = JSON.parse(sessionStorage.getItem(KEY));
    if (!session || !session.token) return null;
    if (session.expiresAt && Date.parse(session.expiresAt) <= Date.now()) {
      clearSession();
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

export function saveSession(session) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(session));
  } catch {
    // Storage blocked (private mode): the user must log in again on each page
  }
}

export function clearSession() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // nothing to clear
  }
}

export function homeFor(role) {
  return HOME_PAGES[role] || 'index.html';
}

// Sends the visitor to the login page, or to their own role's page.
export function requireRole(role) {
  const session = getSession();
  if (!session) {
    location.replace('index.html');
    return null;
  }
  if (session.role !== role) {
    location.replace(homeFor(session.role));
    return null;
  }
  return session;
}
