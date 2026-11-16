# Montana Block Hub

The shop hub for Montana Block Co.: jobs, inventory, SOPs, reminders and an "Ask Claude" assistant, with individual logins and role-based permissions. Installs on phones and desktops from the browser.

## How it's put together

| Piece | Where | Notes |
|---|---|---|
| App (this repo) | GitHub Pages | Plain HTML/CSS/JS, no build step. Installable (PWA). |
| Logins, database, permissions | Supabase (free tier) | Row level security on every table. |
| Ask Claude | Supabase Edge Function `ask` | Claude Haiku 5.5, cached shop context, per-person daily cap, cost log. |
| Team management | Supabase Edge Function `admin-users` | Create logins, roles, deactivate, reset passwords. |

The publishable key in `config.js` is meant to be public; all data is protected by the database's access rules. Secret keys (Anthropic API key, Supabase service key) live only in Supabase's server function secrets and are never in this repo.

## Roles

| Role | Can |
|---|---|
| Shop | See jobs, update job status/notes, adjust inventory counts, read SOPs, use Ask Claude |
| Lead | Everything above, plus create jobs and inventory items, see suppliers |
| Admin | Everything above, plus edit SOPs and notes, manage shop/lead logins, see activity and usage |
| Owner | Everything, including managing admins |

New logins get a temporary password and must choose their own at first sign-in.

## Files

- `index.html`, `app.js`, `styles.css`, `config.js` — the app
- `manifest.webmanifest`, `sw.js`, `icons/` — install support
- `supabase/migrations/` — database schema and access rules
- `supabase/functions/` — server functions

## Email Studio (`/email-studio/`)

A separate installable app for marketing email: Claude writes each email and draws its header graphic in the brand themes, Mitchell reviews and approves, and only then can it be sent through Omnisend.

- **Approval lock (enforced in the database):** only the owner can approve (`mkt_approve`), approval is tied to the exact content, and any edit cancels it. Status can't be set to approved/sent any other way.
- **Sending:** `mkt-send` re-checks owner + approved + unchanged content + typed SEND before handing the email to Omnisend. Proofs go only to @mtblock.com inboxes.
- **Writing:** `mkt-generate` uses Claude Sonnet with the Brand Kit and the live Shopify catalog. Usage is logged in `mkt_ai_log`.
- Schema: `supabase/migrations/010_email_studio.sql`, seed: `011_email_studio_seed.sql`.
