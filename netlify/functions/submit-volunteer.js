// POST /.netlify/functions/submit-volunteer
// Body: { first_name, last_name, email, phone?, zip?, interests?, note?, website? (honeypot) }
// Inserts into Supabase table `hanning_volunteers`.

exports.handler = async (event) => {
  const HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: HEADERS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: HEADERS, body: 'Method Not Allowed' };

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ ok: false, error: 'Invalid JSON' }) };
  }

  // Honeypot
  if (body.website) return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ ok: true }) };

  // Basic validation
  if (!body.first_name || !body.last_name || !body.email) {
    return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ ok: false, error: 'Missing required fields' }) };
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('Missing Supabase env vars');
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ ok: false, error: 'Server misconfigured' }) };
  }

  const record = {
    first_name: String(body.first_name).trim().slice(0, 80),
    last_name: String(body.last_name).trim().slice(0, 80),
    email: String(body.email).trim().toLowerCase().slice(0, 200),
    phone: body.phone ? String(body.phone).trim().slice(0, 40) : null,
    zip: body.zip ? String(body.zip).trim().slice(0, 10) : null,
    interests: Array.isArray(body.interests) ? body.interests.slice(0, 12) : [],
    note: body.note ? String(body.note).trim().slice(0, 2000) : null,
    source_ip: event.headers['x-forwarded-for'] || event.headers['client-ip'] || null,
    user_agent: event.headers['user-agent'] || null,
    created_at: new Date().toISOString(),
  };

  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/hanning_volunteers`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify(record),
    });
    if (!res.ok) {
      const text = await res.text();
      console.error('Supabase insert failed', res.status, text);
      return { statusCode: 502, headers: HEADERS, body: JSON.stringify({ ok: false, error: 'Upstream error' }) };
    }
  } catch (err) {
    console.error('Fetch to Supabase threw:', err);
    return { statusCode: 502, headers: HEADERS, body: JSON.stringify({ ok: false, error: 'Network error' }) };
  }

  return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ ok: true }) };
};
