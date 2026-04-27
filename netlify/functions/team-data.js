// GET /.netlify/functions/team-data
// Returns all volunteers and yard sign requests, with voter-file match flags.
// Auth-required (HMAC cookie).

const { isAuthenticated, unauthorized } = require('./_lib/auth');

async function fetchTable(supaUrl, supaKey, table, limit = 1000) {
  const url = `${supaUrl}/rest/v1/${table}?select=*&order=created_at.desc&limit=${limit}`;
  const res = await fetch(url, {
    headers: {
      'apikey': supaKey,
      'Authorization': `Bearer ${supaKey}`,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase ${table} ${res.status}: ${text}`);
  }
  return res.json();
}

exports.handler = async (event) => {
  if (!isAuthenticated(event)) return unauthorized();

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return { statusCode: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: false, error: 'Server misconfigured' }) };
  }

  try {
    const [volunteers, yardSigns] = await Promise.all([
      fetchTable(SUPABASE_URL, SUPABASE_KEY, 'hanning_volunteers'),
      fetchTable(SUPABASE_URL, SUPABASE_KEY, 'hanning_yard_signs'),
    ]);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      },
      body: JSON.stringify({
        ok: true,
        volunteers,
        yard_signs: yardSigns,
        fetched_at: new Date().toISOString(),
      }),
    };
  } catch (err) {
    console.error('team-data failed:', err);
    return { statusCode: 502, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: false, error: 'Upstream error' }) };
  }
};
