// POST /.netlify/functions/team-login
// Body: { password }
// On match: sets HMAC-signed cookie. Returns { ok: true }.
// On mismatch: 401.

const { makeToken, setCookieHeader, constantTimeEq } = require('./_lib/auth');

exports.handler = async (event) => {
  const baseHeaders = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Credentials': 'true',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: baseHeaders, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: baseHeaders, body: JSON.stringify({ ok: false, error: 'Method Not Allowed' }) };

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, headers: baseHeaders, body: JSON.stringify({ ok: false, error: 'Invalid JSON' }) }; }

  const expected = process.env.TEAM_PASSWORD;
  const secret = process.env.TEAM_SECRET;
  if (!expected || !secret) {
    console.error('TEAM_PASSWORD or TEAM_SECRET not set');
    return { statusCode: 500, headers: baseHeaders, body: JSON.stringify({ ok: false, error: 'Server misconfigured' }) };
  }

  // Always do the comparison, even with bogus input, to avoid timing differences
  const provided = String(body.password || '');
  const ok = constantTimeEq(provided, expected);

  // Tiny artificial delay to mitigate brute force (bursty)
  await new Promise((r) => setTimeout(r, 250));

  if (!ok) {
    return { statusCode: 401, headers: baseHeaders, body: JSON.stringify({ ok: false, error: 'Wrong password' }) };
  }

  const token = makeToken(secret);
  return {
    statusCode: 200,
    headers: { ...baseHeaders, 'Set-Cookie': setCookieHeader(token) },
    body: JSON.stringify({ ok: true }),
  };
};
