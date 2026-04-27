// POST /.netlify/functions/team-logout
// Clears the auth cookie.

const { clearCookieHeader } = require('./_lib/auth');

exports.handler = async () => ({
  statusCode: 200,
  headers: {
    'Content-Type': 'application/json',
    'Set-Cookie': clearCookieHeader(),
  },
  body: JSON.stringify({ ok: true }),
});
