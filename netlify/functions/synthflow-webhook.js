// POST /.netlify/functions/synthflow-webhook?token=SYNTHFLOW_WEBHOOK_TOKEN
//
// One unified end-of-call webhook from the Synthflow campaign phone agent.
// Synthflow only fires ONE webhook at end-of-call, so all routing happens here:
//
//   1. Token check (rejects unauthorized calls)
//   2. Always insert to hanning_volunteers if we have a name/phone/email — every
//      caller becomes a searchable lead in the team dashboard
//   3. If intent === "yard_sign" OR yard_address provided, ALSO insert to
//      hanning_yard_signs — supporter ends up on both lists
//   4. Send a single email alert summarizing the call
//
// Skip events: Synthflow can fire start-of-call pings; we only process end-of-call.

const { sendNotificationEmail, emailShell, row } = require('./_lib/notify');

const INTEREST_LABELS = {
  yard_sign: 'Wants a yard sign',
  phone_bank: 'Phone bank',
  canvass: 'Knock doors / canvass',
  event: 'Help at an event',
  donate: 'Donate',
  endorse: 'Endorse publicly',
};

const VALID_INTERESTS = new Set(Object.keys(INTEREST_LABELS));
const VALID_INTENTS = new Set(['volunteer','yard_sign','donate','info','callback','voting_info','other']);

// Synthflow sometimes pings before/during a call. Skip anything that's not end-of-call.
const SKIP_STATUSES = new Set([
  'started','initiated','ringing','in_progress','in-progress','begin','queued','call_inbound'
]);

function pickStatus(payload) {
  return String(payload?.status || payload?.event || payload?.type || '').toLowerCase();
}

// Normalize whatever Synthflow sends into a clean, predictable shape.
// We accept variables either nested under common keys or at the top level.
function extractVars(body) {
  const v = body.variables || body.call_variables || body.data || {};
  const top = body;
  const pull = (k) => v[k] ?? top[k] ?? null;

  const interestsRaw = pull('interests');
  let interests = [];
  if (Array.isArray(interestsRaw)) {
    interests = interestsRaw.map(String);
  } else if (typeof interestsRaw === 'string' && interestsRaw.trim()) {
    interests = interestsRaw.split(/[,;|]/).map((s) => s.trim()).filter(Boolean);
  }
  interests = interests.filter((i) => VALID_INTERESTS.has(i));

  let intent = String(pull('intent') || '').toLowerCase();
  if (!VALID_INTENTS.has(intent)) intent = 'other';

  const consented = pull('consented_to_contact');

  return {
    intent,
    first_name: pull('first_name') || pull('caller_first_name'),
    last_name: pull('last_name') || pull('caller_last_name'),
    email: pull('email') || pull('caller_email'),
    phone: pull('phone') || pull('caller_phone') || pull('lead_phone'),
    zip: pull('zip') || pull('caller_zip'),
    interests,
    note: pull('note') || pull('callback_reason') || '',
    yard_address: pull('yard_address') || pull('caller_address'),
    yard_city: pull('yard_city') || pull('caller_city'),
    yard_zip: pull('yard_zip'),
    yard_note: pull('yard_note'),
    consented_to_contact: consented === true || consented === 'true' || consented === 'yes',
    call_id: pull('call_id') || body?.call?.call_id || null,
    transcript: pull('transcript') || body?.call?.transcript || null,
  };
}

function clean(s, max = 240) {
  if (s === null || s === undefined) return null;
  const out = String(s).trim().slice(0, max);
  return out || null;
}

async function supabaseInsert(supaUrl, supaKey, table, record) {
  const res = await fetch(`${supaUrl}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      apikey: supaKey,
      Authorization: `Bearer ${supaKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(record),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${table} ${res.status}: ${text}`);
  }
}

exports.handler = async (event) => {
  const HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: HEADERS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: HEADERS, body: 'Method Not Allowed' };

  // Token check (matches the existing lobbii-site synthflow-webhook pattern)
  const expected = process.env.SYNTHFLOW_WEBHOOK_TOKEN;
  const provided = (event.queryStringParameters || {}).token;
  if (!expected) {
    console.error('SYNTHFLOW_WEBHOOK_TOKEN not configured');
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ ok: false, error: 'Server misconfigured' }) };
  }
  if (provided !== expected) {
    return { statusCode: 401, headers: HEADERS, body: JSON.stringify({ ok: false, error: 'Unauthorized' }) };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ ok: false, error: 'Invalid JSON' }) }; }

  // Skip start-of-call pings — only process end-of-call payloads
  const status = pickStatus(body);
  if (SKIP_STATUSES.has(status)) {
    console.log('[synthflow] skipped non-end status:', status);
    return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ ok: true, skipped: status }) };
  }

  const v = extractVars(body);

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('Missing Supabase env vars');
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ ok: false, error: 'Server misconfigured' }) };
  }

  const inserted = { volunteer: false, yard_sign: false };
  const errors = [];

  // ── 1. Insert volunteer record if we have anything contactable ──
  const hasContact = v.first_name || v.last_name || v.phone || v.email;
  if (hasContact) {
    const noteParts = [
      `Source: AI phone agent (intent: ${v.intent})`,
      v.note ? `Notes: ${v.note}` : null,
      v.transcript ? `Transcript excerpt: ${String(v.transcript).slice(0, 800)}` : null,
      v.call_id ? `Call ID: ${v.call_id}` : null,
    ].filter(Boolean).join(' · ');

    const volunteerRecord = {
      first_name: clean(v.first_name, 80) || 'Unknown',
      last_name: clean(v.last_name, 80) || 'Caller',
      email: clean(v.email, 200) ? clean(v.email, 200).toLowerCase() : `phone-${Date.now()}@noemail.local`,
      phone: clean(v.phone, 40),
      zip: clean(v.zip, 10),
      interests: v.interests,
      note: noteParts.slice(0, 2000),
      status: 'new',
      source_ip: event.headers['x-forwarded-for'] || event.headers['client-ip'] || null,
      user_agent: 'synthflow-voice-agent',
      created_at: new Date().toISOString(),
    };

    try {
      await supabaseInsert(SUPABASE_URL, SUPABASE_KEY, 'hanning_volunteers', volunteerRecord);
      inserted.volunteer = true;
    } catch (err) {
      console.error('[synthflow] volunteer insert failed:', err.message);
      errors.push(`volunteer: ${err.message}`);
    }
  }

  // ── 2. Also insert yard-sign request if applicable ──
  const wantsYardSign =
    v.intent === 'yard_sign' || v.interests.includes('yard_sign');
  const hasDeliveryInfo = v.yard_address && (v.yard_city || v.yard_zip);

  if (wantsYardSign && hasDeliveryInfo) {
    const yardRecord = {
      name: [clean(v.first_name, 80), clean(v.last_name, 80)].filter(Boolean).join(' ') || 'Caller',
      phone: clean(v.phone, 40) || '0000000000',
      email: clean(v.email, 200) ? clean(v.email, 200).toLowerCase() : null,
      address: clean(v.yard_address, 240),
      city: clean(v.yard_city, 80) || 'Broken Arrow',
      zip: clean(v.yard_zip, 10) || clean(v.zip, 10) || '00000',
      note: clean(`Source: AI phone agent. ${v.yard_note || ''}`.trim(), 1000),
      status: 'requested',
      source_ip: event.headers['x-forwarded-for'] || event.headers['client-ip'] || null,
      user_agent: 'synthflow-voice-agent',
      created_at: new Date().toISOString(),
    };

    try {
      await supabaseInsert(SUPABASE_URL, SUPABASE_KEY, 'hanning_yard_signs', yardRecord);
      inserted.yard_sign = true;
    } catch (err) {
      console.error('[synthflow] yard sign insert failed:', err.message);
      errors.push(`yard_sign: ${err.message}`);
    }
  }

  // ── 3. Email alert (single email summarizing the call) ──
  if (inserted.volunteer || inserted.yard_sign) {
    const fullName = [v.first_name, v.last_name].filter(Boolean).join(' ') || 'Unknown caller';
    const interestList = v.interests.map((i) => INTEREST_LABELS[i] || i).join(', ');
    const fullAddress = inserted.yard_sign
      ? `${v.yard_address}, ${v.yard_city || 'Broken Arrow'} ${v.yard_zip || v.zip || ''}`
      : null;

    let badge = '📞 New phone signup';
    if (inserted.yard_sign && inserted.volunteer) badge = '📞🪧 Phone signup + yard sign';
    else if (inserted.yard_sign) badge = '🪧 Phone yard sign request';
    else if (v.intent === 'callback') badge = '📞 Phone callback request';
    else if (v.intent === 'other') badge = '📞 Phone — other';

    try {
      await sendNotificationEmail({
        subject: `${badge} · ${fullName}`,
        text: [
          `${badge} — Hanning campaign`,
          ``,
          `Name:      ${fullName}`,
          v.email ? `Email:     ${v.email}` : null,
          v.phone ? `Phone:     ${v.phone}` : null,
          v.zip ? `ZIP:       ${v.zip}` : null,
          interestList ? `Wants to:  ${interestList}` : null,
          fullAddress ? `Yard sign: ${fullAddress}` : null,
          v.note ? `Note:      ${v.note}` : null,
          `Intent:    ${v.intent}`,
          v.call_id ? `Call ID:   ${v.call_id}` : null,
        ].filter(Boolean).join('\n'),
        html: emailShell({
          heading: badge,
          subhead: fullName,
          rows: [
            row('Email', v.email),
            row('Phone', v.phone),
            row('ZIP', v.zip),
            row('Wants to', interestList || '—'),
            row('Yard sign', fullAddress),
            row('Note', v.note),
            row('Intent', v.intent),
            row('Call ID', v.call_id),
          ].join(''),
          footerNote: 'Open the team dashboard at /team/dashboard.html to log status and follow up.',
        }),
      });
    } catch (err) {
      console.warn('[synthflow] notification email failed (non-blocking):', err.message);
    }
  }

  if (errors.length && !inserted.volunteer && !inserted.yard_sign) {
    return {
      statusCode: 502,
      headers: HEADERS,
      body: JSON.stringify({ ok: false, error: 'All inserts failed', errors }),
    };
  }

  return {
    statusCode: 200,
    headers: HEADERS,
    body: JSON.stringify({ ok: true, inserted, errors: errors.length ? errors : undefined }),
  };
};
