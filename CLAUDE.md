# Memory

## Me
Ran, solo founder building Spontany — a scheduling app for divorcees to manage custody constraints and coordinate plans with partners and friend groups.

## People
| Who | Role |
|-----|------|
| **Ran** | Founder, sole developer, does everything — code, design, marketing |

## Terms
| Term | Meaning |
|------|---------|
| Spontany | The app — scheduling/calendar for divorcees |
| PWA | Progressive Web App — how Spontany is deployed (not native app store) |
| Railway | Cloud hosting platform where Spontany backend runs |
| "Know before you ask" | Core campaign tagline / hook |
| R/Z days | Custody day types in the calendar (appears in code) |
| Opportunities | Events/venues/activities that users can discover and plan around |
| Outcomes | Plans + outings generated from user-submitted opportunities |

## Projects
| Name | What |
|------|------|
| **Spontany MVP** | Node.js + Express + SQLite + Vanilla JS frontend, PWA. Calendar, partner invites, admin dashboard, push notifications. Hosted on Railway. ~1 week from friend testing. |
| **"Know Before You Ask" Campaign** | Pre-launch social ad campaign. $1K budget, Meta + TikTok + X. 4 ad sets, 48 Canva creatives. All docs in workspace folder. Target: 500+ signups in 2 weeks. |

## Stack
- **Backend:** Node.js (v22+), Express, SQLite (better-sqlite3)
- **Frontend:** Vanilla HTML/CSS/JS (no framework, no build step)
- **Email:** Resend
- **Images:** Sharp
- **Push:** web-push
- **Hosting:** Railway (with persistent volume for DB)
- **Domains:** spontany.io, spontany.club (registered at GoDaddy, not yet pointed)
- **Design:** Canva
- **Code:** Built with Claude
- **Creative/Messaging:** ChatGPT for copy, image/video generation

## Security
**Production stance:** Spontany has real (non-friend) users with custody and kid PII in the SQLite DB on Railway. Treat security suggestions with prod weight, not pre-launch weight.

### Secrets
- Never read or paste `.env` files or service-account JSONs into chat. Reference env vars by NAME (e.g. `ANTHROPIC_API_KEY`), never values.
- Rotation order: generate new key → update Railway → redeploy → verify endpoint → **then** revoke old. Reversing this breaks prod.
- Service-account JSONs belong in Railway only. Delete from `~/Downloads` immediately after pasting.

### Auth surface (4 schemes — don't add a 5th)
- **Magic links (Resend):** tokens must be single-use and short-lived; verify before granting session.
- **`ADMIN_TOKEN`:** gates ops endpoints. Never log it, never echo in error messages, never include in URLs.
- **Google OAuth:** verify `state` param on callback to prevent CSRF.
- **Push subscriptions / VAPID:** subscription endpoints are user-bound; never accept a `userId` from the client without auth.

### Database
- All DB access via `db.prepare(...)` (better-sqlite3 prepared statements). Never string-concat or template-literal SQL.

### PII (custody/kid data)
- Don't log: kid ages, partner names, phone numbers, full custody-day arrays.
- Don't return PII in error messages to the client.
- Don't put PII in URL params (path or query) — leaks into Railway access logs and browser history.

### Frontend (vanilla JS PWA)
- User-generated text (event titles, partner names, opportunity descriptions) → use `textContent`, not `innerHTML`. If `innerHTML` is required, sanitize first.
- Service worker: don't cache authenticated responses or PII.

### Before merging any change
- New endpoints have an auth check before processing.
- New env var is set in Railway *before* merging code that reads it.
- No hardcoded secrets, tokens, or invite codes in committed files.

## Brand
- **Voice:** Smart, fun, mature, sexy
- **Colors:** Dark navy (#0c0c15), deep purple (#131321), orange (#f97316), purple accent (#7c5cbf / #a78bfa), white text
- **Tagline:** "Finds your moments before they slip away."
- **Target audience:** Divorcees 35–55 with kids aged 0–14

## Preferences
- Solo founder — keep recommendations practical for one person
- Uses Claude for code/planning, ChatGPT for creative/messaging, Canva for design
- Prefers to build things himself rather than use heavy platforms
- Asks smart strategic questions — treat as a technical founder who thinks about the full picture

## Session context backups
Full history of decisions, fixes, and features built — read these at the start of any session to get full context:
- `docs/context-backup-2026-04-02.md` — cell colors, landing page, onboard restructure, match tool, logo replacement, contrast fixes, file consolidation
- `docs/context-backup-2026-04-02b.md` — carousel images fix, commit cleanup
