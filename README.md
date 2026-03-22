# Custody Calendar App

## Quick Start (Local)

### 1. Install Node.js
Download from https://nodejs.org (LTS version). Run the installer. Restart VS Code.

### 2. Install dependencies
Open the terminal in VS Code, navigate to this folder, and run:
```
npm install
```

### 3. Start the server
```
npm start
```

Open http://localhost:3000 in your browser.

### 4. First-time setup
- Enter your name → you'll get your personal calendar URL
- Import your existing HTML backup: click "Import backup" on the calendar page
- Go to Connections → "Invite partner" → copy and send the link

---

## Deploy to Railway (so your partner can access it)

1. Push this folder to a GitHub repo
2. Go to https://railway.app → "New Project" → "Deploy from GitHub repo"
3. Select your repo → Railway auto-detects Node.js and deploys
4. Go to Settings → add these environment variables:
   - `BASE_URL` = your Railway URL (e.g. `https://custody-calendar.up.railway.app`)
   - `DATABASE_PATH` = `/data/calendar.db`
5. Add a Volume in Railway (for persistent storage): mount it at `/data`
6. Visit your Railway URL → complete setup

---

## How it works

| Person | URL | Can see |
|---|---|---|
| You (owner) | `/calendar?token=YOUR_TOKEN` | Everything |
| Partner | `/partner?token=PARTNER_TOKEN` | Their calendar + your custody days (when approved) |
| Co-parent | Download the "Share" HTML file | Your R/Z days only |

### Partner invite flow
1. You → "Invite partner" → copy link → send via WhatsApp/text
2. Partner opens link → answers 7 quick questions about their custody pattern
3. Partner requests to view your calendar
4. You see a notification → click Review → choose duration + auto-renew → Approve
5. Partner can now see your custody days overlaid on their own calendar

### Auto-renew
When approving access, check "Automatically renew" so your partner doesn't need to re-request every month.
You can toggle this on/off anytime from your Connections panel.
