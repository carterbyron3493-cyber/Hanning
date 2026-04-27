# Hanning for Wagoner County Commissioner, District 1 — Campaign Site

Production site for the 2026 re-election campaign of Commissioner James Hanning.
Built by [Lobbii](https://lobbii.net) for Carter Byron.

Deploy target: **Netlify** → `staging.jameshanningforwagonercocommissioner.com` during build, apex domain on cutover.

---

## Stack

- Static HTML / CSS / JS — no framework, no build step
- [Netlify](https://www.netlify.com/) for hosting + Functions
- [Supabase](https://supabase.com/) for the CRM (volunteer + yard-sign capture)
- [Stripe](https://donate.stripe.com/aFa8wPct15Y5grP53143S00) for donations (committee Stripe link, not handled on-site)
- Google Fonts: `Fraunces` (head), `Inter` (body), `Dancing Script` (optional script accents)

---

## Repo layout

```
hanning-site/
├── index.html
├── about.html
├── priorities.html
├── take-action.html
├── 404.html
├── netlify.toml
├── assets/
│   ├── css/styles.css     ← full design system
│   ├── js/main.js         ← countdown + nav + forms
│   └── img/*              ← photos pulled from the Elementor site
└── netlify/functions/
    ├── submit-volunteer.js
    └── submit-yard-sign.js
```

---

## Environment variables (set in Netlify UI)

| Key | Notes |
|---|---|
| `SUPABASE_URL` | `https://nzqdpzymvthzzbyrrhew.supabase.co` (reuse existing Lobbii Supabase) |
| `SUPABASE_SERVICE_KEY` | Service role key from Supabase → Settings → API |
| `RESEND_API_KEY` | API key from [resend.com](https://resend.com) → API Keys. Free tier: 100 emails/day, 3K/month. |
| `NOTIFY_EMAIL` | Where new-signup alerts go. During build phase: `hello@lobbii.net`. Switch to `team@jameshanning…` once the campaign team is ready. |
| `NOTIFY_FROM` | Optional. Sender display. Default: `Hanning Campaign <onboarding@resend.dev>`. After verifying the campaign domain in Resend, switch to e.g. `alerts@jameshanningforwagonercocommissioner.com`. |

---

## Supabase schema

Run these once in the Supabase SQL editor:

```sql
-- Volunteers
create table if not exists hanning_volunteers (
  id uuid primary key default gen_random_uuid(),
  first_name text not null,
  last_name text not null,
  email text not null,
  phone text,
  zip text,
  interests text[] default array[]::text[],
  note text,
  status text default 'new',          -- new | contacted | assigned | onboarded | done | bad
  assigned_to text,                    -- name/initials of team coordinator
  source_ip text,
  user_agent text,
  created_at timestamptz default now(),
  last_updated_at timestamptz,
  last_updated_by text
);

create index if not exists hanning_volunteers_email_idx on hanning_volunteers (email);
create index if not exists hanning_volunteers_created_idx on hanning_volunteers (created_at desc);
create index if not exists hanning_volunteers_status_idx on hanning_volunteers (status);

-- Yard signs
create table if not exists hanning_yard_signs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text not null,
  email text,
  address text not null,
  city text not null,
  zip text not null,
  note text,
  status text default 'requested',  -- requested | out_for_delivery | delivered | declined
  delivered_at timestamptz,
  source_ip text,
  user_agent text,
  created_at timestamptz default now()
);

create index if not exists hanning_yard_signs_created_idx on hanning_yard_signs (created_at desc);
create index if not exists hanning_yard_signs_status_idx on hanning_yard_signs (status);
```

RLS can stay off since only the service role key writes, and the dashboard will read via the master dashboard pattern from the Lobbii stack.

---

## Deploy

### Initial deploy

1. Connect the `hanning` GitHub repo to Netlify (New site → Import from Git).
2. Build settings: **publish dir = `.`**, build command = blank, functions dir = `netlify/functions`.
3. Set `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` in **Site settings → Environment variables**.
4. Deploy. Verify functions appear under **Functions** tab.
5. Test a form submission end-to-end (check Supabase `hanning_volunteers` for the row).

### Domain setup

**Staging (during build):**
- Netlify auto-assigns a `.netlify.app` URL (rename it to something tidy like `hanning-staging.netlify.app`)
- Optional: point `staging.jameshanningforwagonercocommissioner.com` at Netlify as a branch subdomain

**Cutover day:**
- Update DNS `A/ALIAS` at the apex domain to Netlify's load balancer
- `www` → CNAME to the Netlify subdomain
- HTTPS provisions automatically via Netlify's Let's Encrypt integration

---

## Dashboard integration (future)

The Hanning dashboard will live alongside the other Lobbii client dashboards at
`lobbii.net/dashboard/hanning.html`. It reads the same two Supabase tables via
the anon key and renders volunteer signups + yard-sign request queue.

Add to the Netlify webhook router's slug list when we're ready to ingest call logs
from the Synthflow AI phone agent.

---

## Editing after handoff

- **Copy changes:** every page's content is plain HTML — edit the file, commit, Netlify auto-deploys.
- **Images:** drop a JPG/PNG into `assets/img/`, reference it by path.
- **Adding a page:** copy `about.html`, rename, change content. Add the link to every page's `nav-links` div.
- **Colors / type:** all design tokens live at the top of `assets/css/styles.css` (`:root` block). Change once, applies everywhere.

---

## Countdown

The corner countdown targets **Tuesday, June 16, 2026 at 7:00 AM CDT** (polls open).
It auto-switches to "PRIMARY DAY · Vote today — June 16" on election morning.

Edit `TARGET` in `/assets/js/main.js` if the election date moves.

---

## License / ownership

Code: © 2026 Lobbii LLC. All voter / supporter data captured by this site is owned by
the Hanning campaign committee per the services agreement.

Disclaimer: *Paid for by James Hanning for Wagoner County Commissioner District 1.*
