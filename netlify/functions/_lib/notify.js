// Shared notification helpers for Hanning campaign Netlify functions.
//
// sendNotificationEmail({ subject, html, text }) → Promise<void>
//   Sends a transactional alert via Resend to the configured NOTIFY_EMAIL.
//   Soft-fails — never blocks the form submission if mail fails. Logs only.
//
// Env vars:
//   RESEND_API_KEY     required to actually send (otherwise becomes a no-op)
//   NOTIFY_EMAIL       destination address (e.g. hello@lobbii.net or team@...)
//   NOTIFY_FROM        sender (defaults to Resend onboarding sender)

async function sendNotificationEmail({ subject, html, text }) {
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.NOTIFY_EMAIL;
  const from = process.env.NOTIFY_FROM || 'Hanning Campaign <onboarding@resend.dev>';

  if (!apiKey || !to) {
    console.log('[notify] Skipped — RESEND_API_KEY or NOTIFY_EMAIL not set');
    return;
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject,
        html,
        text,
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      console.warn('[notify] Resend non-2xx', res.status, body);
    } else {
      console.log('[notify] Sent to', to);
    }
  } catch (err) {
    console.warn('[notify] Resend threw', err.message);
  }
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function row(label, value) {
  if (value === undefined || value === null || value === '') return '';
  const v = Array.isArray(value) ? value.join(', ') : String(value);
  return `<tr>
    <td style="padding:8px 16px 8px 0;color:#6B6F7D;font-size:13px;letter-spacing:0.5px;text-transform:uppercase;font-weight:600;vertical-align:top;width:160px;">${escapeHtml(label)}</td>
    <td style="padding:8px 0;color:#1A1A1A;font-size:15px;vertical-align:top;">${escapeHtml(v)}</td>
  </tr>`;
}

function emailShell({ heading, subhead, rows, footerNote }) {
  return `<!doctype html>
<html><body style="margin:0;background:#FAF6EE;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1A1A1A;">
  <div style="max-width:640px;margin:0 auto;padding:24px;">
    <div style="background:#C1272D;color:#FAF6EE;padding:20px 28px;border-radius:8px 8px 0 0;">
      <div style="font-size:11px;letter-spacing:3px;text-transform:uppercase;font-weight:700;opacity:0.85;">Hanning 2026 · Alert</div>
      <h1 style="margin:6px 0 0;font-family:Georgia,serif;font-size:24px;font-weight:700;">${escapeHtml(heading)}</h1>
      ${subhead ? `<div style="margin-top:6px;font-size:14px;opacity:0.9;">${escapeHtml(subhead)}</div>` : ''}
    </div>
    <div style="background:#FFFFFF;padding:24px 28px;border-radius:0 0 8px 8px;border:1px solid rgba(26,26,26,0.10);border-top:0;">
      <table style="border-collapse:collapse;width:100%;">${rows}</table>
      ${footerNote ? `<div style="margin-top:24px;padding-top:16px;border-top:1px solid rgba(26,26,26,0.08);font-size:13px;color:#6B6F7D;">${escapeHtml(footerNote)}</div>` : ''}
    </div>
    <div style="text-align:center;margin-top:16px;font-size:11px;color:#6B6F7D;letter-spacing:0.5px;">
      Authorized and paid for by James Hanning for Wagoner County Commissioner District 1.
    </div>
  </div>
</body></html>`;
}

module.exports = { sendNotificationEmail, emailShell, row, escapeHtml };
