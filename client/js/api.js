'use strict';

const API_BASE = '/api';

function getToken() { return localStorage.getItem('token'); }
function setToken(t) { localStorage.setItem('token', t); }
function clearToken() { localStorage.removeItem('token'); localStorage.removeItem('user'); }
function getUser() {
  try { return JSON.parse(localStorage.getItem('user') || 'null'); } catch { return null; }
}
function setUser(u) { localStorage.setItem('user', JSON.stringify(u)); }

async function apiFetch(path, options = {}) {
  const token = getToken();
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(API_BASE + path, { ...options, headers });
  let data;
  try { data = await res.json(); } catch { data = {}; }
  if (!res.ok) throw { status: res.status, message: data.error || 'Request failed', data };
  return data;
}

const api = {
  get:    (path)         => apiFetch(path),
  post:   (path, body)   => apiFetch(path, { method: 'POST', body: JSON.stringify(body) }),
  put:    (path, body)   => apiFetch(path, { method: 'PUT',  body: JSON.stringify(body) }),
  delete: (path)         => apiFetch(path, { method: 'DELETE' }),
};

// Redirect to correct role page if already logged in
function redirectIfLoggedIn() {
  const user = getUser();
  const token = getToken();
  if (user && token) {
    const map = { DONOR: '/donor', RIDER: '/rider', SHELTER: '/shelter', ADMIN: '/admin' };
    const target = map[user.role];
    if (target && !window.location.pathname.startsWith(target)) {
      window.location.href = target;
    }
  }
}

function logout() {
  clearToken();
  window.location.href = '/';
}

// Format unix timestamp to readable string
function fmtTime(unixSec) {
  if (!unixSec) return '—';
  return new Date(unixSec * 1000).toLocaleString();
}

function fmtTimeAgo(unixSec) {
  if (!unixSec) return '—';
  const diff = Math.floor(Date.now() / 1000) - unixSec;
  if (diff < 60)  return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff/60)}m ago`;
  return `${Math.floor(diff/3600)}h ago`;
}

function fmtExpiry(expiryUnixSec) {
  const nowSec = Math.floor(Date.now() / 1000);
  const diff = expiryUnixSec - nowSec;
  if (diff <= 0) return { label: 'Expired', cls: 'badge-red', mins: 0, pct: 0 };
  const mins = Math.floor(diff / 60);
  const pct = Math.min(100, (diff / (120 * 60)) * 100); // assume 2hr baseline
  const cls = mins < 15 ? 'badge-red' : mins < 30 ? 'badge-yellow' : 'badge-green';
  return { label: `${mins}m left`, cls, mins, pct };
}

function statusBadge(status) {
  const map = {
    PENDING:       'badge-yellow',
    MATCHED:       'badge-blue',
    IN_TRANSIT:    'badge-teal',
    DELIVERED:     'badge-green',
    EXPIRED:       'badge-gray',
    CANCELLED:     'badge-gray',
    AVAILABLE:     'badge-green',
    RESERVED:      'badge-yellow',
    ASSIGNED:      'badge-blue',
    REROUTED:      'badge-orange',
    FAILED:        'badge-red',
    CONFIRMED:     'badge-green',
    OFFLINE:       'badge-gray',
    BREAKDOWN:     'badge-red',
    BUSY:          'badge-yellow',
    PICKED_UP:     'badge-blue',
    SIMULATED_SUCCESS: 'badge-green',
  };
  return `<span class="badge ${map[status] || 'badge-gray'}">${status?.replace(/_/g,' ')}</span>`;
}

function aidTypeBadge(type) {
  const map = { FOOD: 'badge-green', MEDICAL: 'badge-red', KIT: 'badge-blue' };
  const icons = { FOOD: '🍱', MEDICAL: '💊', KIT: '🧰' };
  return `<span class="badge ${map[type] || 'badge-gray'}">${icons[type] || ''} ${type}</span>`;
}

/* ============================================================
   TOAST SYSTEM
   ============================================================ */
let toastContainer;
function ensureToastContainer() {
  if (!toastContainer) {
    toastContainer = document.createElement('div');
    toastContainer.className = 'toast-container';
    document.body.appendChild(toastContainer);
  }
}

function toast(type, title, msg, duration = 4000) {
  ensureToastContainer();
  const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `
    <span class="toast-icon">${icons[type] || 'ℹ️'}</span>
    <div class="toast-body">
      <div class="toast-title">${title}</div>
      ${msg ? `<div class="toast-msg">${msg}</div>` : ''}
    </div>
  `;
  toastContainer.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transform = 'translateX(100%)'; el.style.transition = '.3s'; setTimeout(() => el.remove(), 300); }, duration);
}

/* ============================================================
   MODAL HELPERS
   ============================================================ */
function openModal(html) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `<div class="modal">${html}</div>`;
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
  return overlay;
}

function closeModal(overlay) { overlay?.remove(); }
