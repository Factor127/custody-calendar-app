# Spontany Match — Custody Compatibility Check
## Screen-by-screen copy

---

### SCREEN 1 — Hook (landing page / ad destination)

**URL:** `spontany.io/match`

**Headline:**
Do your schedules actually work?

**Subline:**
Two custody schedules. One answer. Find out if your free nights line up — before the conversation gets awkward.

**CTA:**
Check your match →

**Fine print:**
Free. Private. Takes 30 seconds.

---

### SCREEN 2 — Your schedule

**Header:**
Your custody days

**Sub:**
Tap the days your kids are with you. That's it.

*[Week picker — same UI as onboarding]*

**CTA:**
Next →

---

### SCREEN 3 — The fork

**Header:**
Now, their schedule.

**Option A (card/button):**
I know their days
*Sub:* "I'll enter their schedule myself."

**Option B (card/button):**
Let them fill it in
*Sub:* "I'll send them a link — more private."

---

## PATH A — I know their schedule

### SCREEN 4A — Their schedule (entered by you)

**Header:**
Their custody days

**Sub:**
Tap the days their kids are with them.

*[Same week picker, second pass]*

**CTA:**
Show me the match →

---

### SCREEN 5A — The result

**Big number (hero):**
*[Calculated]* e.g. **11 free nights** this month

**Subline:**
You're both free [X]% of the time. Here's what the next 3 months look like.

*[3-month calendar overlay — green = both free, muted = mismatch]*

**Verdict variants (dynamic, based on overlap %):**

- **High overlap (60%+):** "Your schedules are practically made for each other."
- **Medium overlap (30–59%):** "Enough overlap to make it work — if you want to."
- **Low overlap (10–29%):** "It's tight. But the right nights matter more than the number."
- **Minimal overlap (<10%):** "Honestly? The schedules don't make it easy. But now you know."

**CTA block (two options):**

Primary: Save my calendar →
*Sub:* "Your schedule is already entered. Add your name and email to keep it."

Secondary: Send them this result →
*Sub:* "Share via WhatsApp or link."

---

### SCREEN 6A — Quick signup (if they tap "Save my calendar")

**Header:**
Save your calendar

**Sub:**
You've already done the hard part. Just a name and email so you can come back.

*[Name, email — schedule already stored in session]*

**CTA:**
Save →

**After save — soft nudge:**
"Want [them] to have their own calendar too? Send them an invite."
*[WhatsApp / copy link — standard invite flow]*

---

## PATH B — Let them fill it in

### SCREEN 4B — Send the link

**Header:**
Send them a link

**Sub:**
They'll enter their own schedule. When they're done, you'll both see the result.

**Message preview (editable):**
"Hey — I found this thing that checks if our custody schedules line up. Fill yours in and we'll both see the answer: [link]"

**Share buttons:**
- Send via WhatsApp
- Copy link
- Share...

---

### SCREEN 5B — Your signup (capture while waiting)

**Header:**
One last thing

**Sub:**
Drop your name and email so we can let you know when they fill theirs in.

*[Name, email]*

**CTA:**
Notify me →

---

### SCREEN 6B — Waiting state

**Header:**
Waiting for [their name / "them"]...

**Sub:**
We'll send you a push notification the moment they fill in their schedule.

**Visual:**
*[Subtle animation — two calendars slowly aligning, or a simple pulse/loading state]*

**Below:**
"While you wait — want to see your own free days?"
*[Link to their calendar view — they're already signed up]*

---

## PERSON B's FLOW (opened the link)

### SCREEN B1 — Personalised hook

**Header:**
[Name] wants to check your match

**Sub:**
They've entered their custody schedule. Now enter yours — and you'll both see how your free nights line up.

**CTA:**
Enter my schedule →

**Fine print:**
Takes 30 seconds. Your schedule stays private.

---

### SCREEN B2 — Their schedule

**Header:**
Your custody days

**Sub:**
Tap the days your kids are with you.

*[Week picker]*

**CTA:**
See the result →

---

### SCREEN B3 — Signup (before revealing result)

**Header:**
Almost there

**Sub:**
Name and email so you can save your result and come back.

*[Name, email]*

**CTA:**
Show me the match →

---

### SCREEN B4 — The result (same as Screen 5A)

*[Same overlap view — big number, 3-month calendar, verdict line]*

**Additional CTA for Person B:**
"Save my calendar" → full onboarding with schedule pre-filled

---

## PERSON A NOTIFICATION

**Push / Email subject:**
Your match results are in.

**Body:**
[Name] filled in their schedule. Tap to see how your free nights line up.

**CTA:**
See results →

*[Opens Screen 5A with both schedules now real]*

---

## AD COPY IDEAS (for driving traffic to /match)

**Hook 1 — The doubt**
"You like them. But will your custody schedules actually work?"

**Hook 2 — The tension**
"3 dates in. Great chemistry. But you still haven't asked about the kids."

**Hook 3 — The practical**
"2 custody schedules. 30 seconds. 1 answer."

**Hook 4 — The exit**
"Looking for a reason that isn't 'it's not you, it's me'? Try: 'our schedules don't line up.'"

**Hook 5 — The direct**
"Before you catch feelings — check the calendar."

---

## NOTES

**What this reuses from existing codebase:**
- Week picker component (onboarding)
- Calendar overlap view (done screen)
- Overlap calculation logic
- Invite link generation pattern
- Push notification infrastructure
- WhatsApp share pattern

**New things needed:**
- `/match` route + page
- `/match/:token` route for Person B
- DB table: `match_requests` (token, schedule_a, schedule_b, status)
- Overlap computed client-side for Path A (instant), server-side for Path B (when B completes)
- Notification trigger when Person B completes

**Key UX decisions:**
- No signup required to see the result in Path A (friction-free). Signup is the *save* action.
- Path B requires signup for both (email needed for notification). But it's earned — they want the answer.
- Verdict lines are neutral, not judgmental. Low overlap isn't "bad" — it's information.
- The "exit" use case is real and valid. Don't hide from it in the copy.
