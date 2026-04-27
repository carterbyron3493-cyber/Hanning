// PATCH /.netlify/functions/update-status
// Body: { table: 'hanning_volunteers' | 'hanning_yard_signs', id, status?, assigned_to?, note?, by? }
// Auth-required.

const { isAuthenticated, unauthorized } = require('./_lib/auth');

const ALLOWED_TABLES = new Set(['hanning_volunteers', 'hanning_yard_signs']);

const VOLUNTEER_STATUSES = new Set(['new', 'contacted', 'assigned', 'onboarded', 'done', 'bad']);
const YARD_SIGN_STATUSES = new Set(['requested', 'out_for_delivery', 'delivered', 'declined', 'bad']);

exports.handler = async (event) => {
  if (!isAuthenticated(event)) return unauthorized();

  if (event.httpMethod !== 'POST' && event.httpMethod !== 'PATCH') {
    return { statusCode: 405, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: false, error: 'Method Not Allowed' }) };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: false, error: 'Invalid JSON' }) }; }

  const { table, id, status, assigned_to, note, by } = body;

  if (!ALLOWED_TABLES.has(table)) {
    return { statusCode: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: false, error: 'Invalid table' }) };
  }
  if (!id) {
    return { statusCode: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: false, error: 'Missing id' }) };
  }

  // Validate status against the table's allowed values
  if (status !== undefined) {
    const allowed = table === 'hanning_volunteers' ? VOLUNTEER_STATUSES : YARD_SIGN_STATUSES;
    if (!allowed.has(status)) {
      return { statusCode: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: false, error: 'Invalid status for table' }) };
    }
  }

  const update = { last_updated_at: new Date().toISOString() };
  if (status !== undefined) update.status = status;
  if (assigned_to !== undefined) update.assigned_to = assigned_to ? String(assigned_to).slice(0, 80) : null;
  if (note !== undefined) update.note = note ? String(note).slice(0, 2000) : null;
  if (by) update.last_updated_by = String(by).slice(0, 80);

  // For yard signs, set delivered_at when status flips to delivered
  if (table === 'hanning_yard_signs' && status === 'delivered') {
    update.delivered_at = new Date().toISOString();
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return { statusCode: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: false, error: 'Server misconfigured' }) };
  }

  try {
    const url = `${SUPABASE_URL}/rest/v1/${table}?id=eq.${encodeURIComponent(id)}`;
    const res = await fetch(url, {
      method: 'PATCH',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation',
      },
      body: JSON.stringify(update),
    });
    if (!res.ok) {
      const text = await res.text();
      console.error('Supabase patch failed', res.status, text);
      return { statusCode: 502, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: false, error: 'Upstream error' }) };
    }
    const rows = await res.json();
    const updated = rows && rows[0];

    // Best-effort activity log entry
    try {
      await fetch(`${SUPABASE_URL}/rest/v1/hanning_activity_log`, {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal',
        },
        body: JSON.stringify({
          table_name: table,
          row_id: id,
          changes: update,
          actor: update.last_updated_by || 'team',
          created_at: new Date().toISOString(),
        }),
      });
    } catch (e) { console.warn('activity log write failed', e.message); }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true, row: updated }),
    };
  } catch (err) {
    console.error('update-status threw:', err);
    return { statusCode: 502, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: false, error: 'Network error' }) };
  }
};
