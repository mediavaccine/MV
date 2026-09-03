import * as api from '../api.js';
import { button, field, h, mount, toast } from '../ui.js';

export function renderLogin(container, onSignedIn) {
  const email = h('input', { type: 'email', autocomplete: 'username', required: true });
  const password = h('input', { type: 'password', autocomplete: 'current-password', required: true });
  const submit = button('Sign in', () => attempt(), 'primary');

  async function attempt() {
    if (!email.value || !password.value) {
      toast('Enter an email address and password.', 'error');
      return;
    }
    submit.disabled = true;
    submit.textContent = 'Signing in…';
    try {
      await api.signIn(email.value.trim(), password.value);
      onSignedIn();
    } catch (error) {
      toast(error.message, 'error');
      password.value = '';
    } finally {
      submit.disabled = false;
      submit.textContent = 'Sign in';
    }
  }

  const form = h('form', {
    class: 'login',
    onsubmit: (event) => { event.preventDefault(); attempt(); },
  },
    h('h1', {}, 'Seating Kiosk'),
    h('p', { class: 'muted' }, 'Control Center'),
    field('Email', email),
    field('Password', password),
    submit);

  mount(container, h('div', { class: 'login-wrap' }, form));
  email.focus();
}
