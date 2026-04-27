// Shared HMAC-signed cookie auth for the /team dashboard.
// Single shared password — appropriate for a 4-month volunteer team.
//
// Env vars:
//   TEAM_PASSWORD   shared password the team types at /team
//   TEAM_SECRET     HMAC key (any random ~32+ char string) for cookie signing

const crypto = require('crypto');

const COOKIE_NAME = 'hanning_team';
const TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function constantTimeEq(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  try { return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b)); }
  catch { return false; }
}

function makeToken(secret) {
  const exp = Date.now() + TTL_MS;
  const sig = crypto.createHmac('sha256', secret).update(String(exp)).digest('hex');
  return `${exp}.${sig}`;
}

function verifyToken(token, secret) {
  if (!token || !secret) return false;
  const [expStr, sig] = token.split('.');
  if (!expStr || !sig) return false;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || Date.now() > exp) return false;
  const expected = crypto.createHmac('sha256', secret).update(expStr).digest('hex');
  return constantTimeEq(expected, sig);
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  header.split(';').forEach((pair) => {
    const idx = pair.indexOf('=');
    if (idx < 0) return;
    const k = pair.slice(0, idx).trim();
    const v = pair.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  });
  return out;
}

function setCookieHeader(token) {
  const maxAge = Math.floor(TTL_MS / 1000);
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}

function clearCookieHeader() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

function isAuthenticated(event) {
  const secret = process.env.TEAM_SECRET;
  if (!secret) return false;
  const cookies = parseCookies(event.headers.cookie || event.headers.Cookie);
  return verifyToken(cookies[COOKIE_NAME], secret);
}

function unauthorized(extraHeaders = {}) {
  return {
    statusCode: 401,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
    body: JSON.stringify({ ok: false, error: 'Unauthorized' }),
  };
}

module.exports = {
  COOKIE_NAME,
  makeToken,
  verifyToken,
  parseCookies,
  setCookieHeader,
  clearCookieHeader,
  isAuthenticated,
  unauthorized,
  constantTimeEq,
};
