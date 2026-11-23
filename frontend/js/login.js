import { api } from './api.js';
import { CONFIG } from './config.js';
import { DEMO_PASSWORD } from './seed-data.js';
import { getSession, homeFor, saveSession } from './session.js';
import { clearFieldErrors, setLoading, showFieldError } from './ui.js';

// Already logged in: go straight to the right page
const existing = getSession();
if (existing) location.replace(homeFor(existing.role));

const form = document.getElementById('login-form');
const errorBox = document.getElementById('login-error');
const passwordInput = document.getElementById('password');
const toggle = document.getElementById('toggle-password');

toggle.addEventListener('click', () => {
  const show = passwordInput.type === 'password';
  passwordInput.type = show ? 'text' : 'password';
  toggle.textContent = show ? 'Hide' : 'Show';
});

if (CONFIG.useMockData) {
  document.getElementById('demo-box').hidden = false;
  document.querySelectorAll('[data-demo]').forEach((button) => {
    button.addEventListener('click', () => {
      form.elements.email.value = button.dataset.demo;
      form.elements.password.value = DEMO_PASSWORD;
      form.requestSubmit();
    });
  });
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearFieldErrors(form);
  errorBox.classList.remove('show');

  const email = form.elements.email.value.trim();
  const password = form.elements.password.value;
  if (!email) return showFieldError(form, 'email', 'Enter your college email.');
  if (!password) return showFieldError(form, 'password', 'Enter your password.');

  const button = document.getElementById('login-btn');
  setLoading(button, true, 'Logging in');
  try {
    const result = await api.login(email, password);
    saveSession(result);
    location.replace(homeFor(result.role));
  } catch (error) {
    setLoading(button, false);
    if (error.field) {
      showFieldError(form, error.field, error.message);
    } else {
      errorBox.querySelector('p').textContent = error.message;
      errorBox.classList.add('show');
    }
  }
});
