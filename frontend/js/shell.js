// The frame every signed-in page shares: header with tabs, the preview note,
// and switching between tabs with the URL hash (#attendance, #check-in, ...).
import { api } from './api.js';
import { CONFIG } from './config.js';
import { resetMockData } from './mock-api.js';
import { clearSession } from './session.js';
import { esc } from './ui.js';

const ROLE_NAMES = { student: 'Student', instructor: 'Instructor', admin: 'Administrator' };

// routes: [{ id, label, render(container, params), count }]
export function startShell({ session, routes }) {
  const app = document.getElementById('app');

  app.innerHTML = `
    <a class="skip-link" href="#main">Skip to content</a>
    <div class="site-header-wrap">
      <header class="site-header">
        <a class="wordmark" href="#${routes[0].id}">
          <span class="tally mini" aria-hidden="true"><span class="mark used"></span><span class="mark used"></span><span class="mark used"></span><span class="mark"></span></span>
          Attendance Tracker
        </a>
        <nav class="tabs" aria-label="Pages">
          ${routes.map((r) => `<a href="#${r.id}" data-route="${r.id}">${esc(r.label)}${r.count ? '<span class="tab-count" hidden></span>' : ''}</a>`).join('')}
        </nav>
        <div class="account">
          <div class="who">${esc(session.user.fullName)}<span>${esc(ROLE_NAMES[session.role])}</span></div>
          <button class="btn secondary small" id="logout-btn">Log out</button>
        </div>
      </header>
    </div>
    ${CONFIG.useMockData ? `
    <div class="preview-note-wrap">
      <p class="preview-note">Preview: these pages show example data and save nothing to a server. <button type="button" id="reset-demo">Reset the example data</button></p>
    </div>` : ''}
    <main class="page" id="main" tabindex="-1"></main>`;

  const main = document.getElementById('main');

  document.getElementById('logout-btn').addEventListener('click', async () => {
    try {
      await api.logout();
    } catch {
      // the token is removed from this browser either way
    }
    clearSession();
    location.replace('index.html');
  });

  const resetButton = document.getElementById('reset-demo');
  if (resetButton) {
    resetButton.addEventListener('click', () => {
      resetMockData();
      location.reload();
    });
  }

  // Shows the tab named in the address (#check-in). Each tab gets a new, empty
  // container; if the user switches tabs while a page is still loading, the
  // old container is already gone, so its late results are never shown.
  async function render() {
    const [routeId, query = ''] = location.hash.slice(1).split('?');
    const route = routes.find((r) => r.id === routeId) || routes[0];

    app.querySelectorAll('[data-route]').forEach((link) => {
      if (link.dataset.route === route.id) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
    document.title = `${route.label} - Attendance Tracker`;

    const container = document.createElement('div');
    main.replaceChildren(container);
    await route.render(container, new URLSearchParams(query));
    // Move keyboard focus to the new page, unless the page already put it in
    // one of its own fields (the check-in code box)
    if (container.isConnected && !main.contains(document.activeElement)) main.focus({ preventScroll: true });
  }

  window.addEventListener('hashchange', render);
  render();

  return {
    // Shows a number next to a tab (e.g. excuses waiting); 0 hides it
    setCount(routeId, n) {
      const el = app.querySelector(`[data-route="${routeId}"] .tab-count`);
      if (!el) return;
      el.hidden = !n;
      el.textContent = String(n);
      el.setAttribute('aria-label', `${n} waiting`);
    }
  };
}

// Page title, with buttons on the right
export function pageHead(title, actionsHtml = '') {
  return `
    <div class="page-head">
      <h1>${esc(title)}</h1>
      ${actionsHtml ? `<div class="actions">${actionsHtml}</div>` : ''}
    </div>`;
}
