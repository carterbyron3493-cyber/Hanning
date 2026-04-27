// POST /.netlify/functions/submit-volunteer
// Body: { first_name, last_name, email, phone?, zip?, interests?, note?, website? (honeypot) }
// 1. Inserts into Supabase table `hanning_volunteers`.
// 2. Sends an email alert to NOTIFY_EMAIL via Resend.
// (Future) 3. Queues a one-time Twilio confirmation SMS once 10DLC clears.

const { sendNotificationEmail, emailShell, row } = require('./_lib/notify');

const INTEREST_LABELS = {
  yard_sign: 'Wants a yard sign',
  phone_bank: 'Phone bank',
  canvass: 'Knock doors / canvass',
  event: 'Help at an event',
  donate: 'Donate',
  endorse: 'Endorse publicly',
};

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
    status: 'new',
    source_ip: event.headers['x-forwarded-for'] || event.headers['client-ip'] || null,
    user_agent: event.headers['user-agent'] || null,
    created_at: new Date().toISOString(),
  };

  // 1. Insert into Supabase
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

  // 2. Send email alert (soft-fail, never blocks form completion)
  const fullName = `${record.first_name} ${record.last_name}`;
  const interestList = (record.interests || [])
    .map((i) => INTEREST_LABELS[i] || i)
    .join(', ');

  try {
    await sendNotificationEmail({
      subject: `🟢 New volunteer · ${fullName}`,
      text: [
        `New volunteer signup — Hanning campaign`,
        ``,
        `Name:     ${fullName}`,
        `Email:    ${record.email}`,
        record.phone ? `Phone:    ${record.phone}` : null,
        record.zip ? `ZIP:      ${record.zip}` : null,
        interestList ? `Wants to: ${interestList}` : null,
        record.note ? `Note:     ${record.note}` : null,
        ``,
        `Time: ${record.created_at}`,
      ].filter(Boolean).join('\n'),
      html: emailShell({
        heading: 'New volunteer signup',
        subhead: fullName,
        rows: [
          row('Email', record.email),
          row('Phone', record.phone),
          row('ZIP', record.zip),
          row('Wants to', interestList || '—'),
          row('Note', record.note),
          row('When', new Date(record.created_at).toLocaleString('en-US', { timeZone: 'America/Chicago' }) + ' CT'),
        ].join(''),
        footerNote: 'Open the team dashboard to log status, assign, and follow up.',
      }),
    });
  } catch (err) {
    console.warn('Notification email failed (non-blocking):', err.message);
  }

  return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ ok: true }) };
};
