# Groups — Epic Spec (v1)

**Status:** Draft for pressure-test
**Date:** 2026-05-01

## Concept

A **group** is a creator-owned, named roster of people you can invite to events in one tap. Lightweight by design — no group chat, no shared calendar, no roles. Just a saved crew.

One concept covers all use cases (friends, co-parent's family, kid's school parents, etc.). Users self-segregate by making separate groups.

## Decisions locked

| # | Decision |
|---|---|
| Group types | One concept ("Group"). No subtypes. |
| Visibility | Full roster visible to all accepted members on join. Keep it simple. |
| Membership | Invite-and-accept. No silent adds. |
| Editing | Creator-only (solo-owned). |
| Partner relationship | Stays separate — partner has custody semantics groups don't. |
| Non-users | Receive group-worded invite, complete onboarding, then land in group. |
| Re-invite a decliner | Allowed; creator sees "previously declined" state. |
| New members + in-flight events | Only get future events, not existing invites. |
| Pending members at event time | Skipped. Group fan-out goes to accepted members only. |
| Group name uniqueness | Per-creator unique. |
| Placement | Groups live inside the existing **Contacts** screen. No dedicated tab. |
| Primary creation path | Post-event-invite prompt when 2+ people are invited. Manual create in Contacts is secondary. |

## Data model (aligned with existing schema in `db.js`)

Spontany's existing tables: `users`, `connections` (requester/target with approved status), `outings` (events) with `outing_invitees`, `magic_links` (token-based invite acceptance, used by partner flow).

New tables:

```
groups
  id, creator_user_id, name, created_at

group_members
  id, group_id, user_id (nullable for unregistered),
  invited_phone, invited_email,
  status: pending | accepted | declined | removed | left,
  invited_at, responded_at

outing_group_origin   -- audit trail: "this outing was group-fanned"
  outing_id, group_id, sent_at
```

**Reuse, not extend:**
- Group-join invites reuse the existing `magic_links` flow (same as partner invites in [routes/auth.js:51](routes/auth.js#L51)). New row in `magic_links` carrying a `group_id` reference.
- Group event invites still create individual rows in `outing_invitees`. The group is only the originator — event-side logic stays untouched. `outing_group_origin` is purely for analytics / host-side "Invited via *Trivia Crew*" label.

**Implicit invariant:** group members must be drawn from the creator's *approved* `connections`. Same pool that the contacts picker uses today. (Inviting a non-connection means first sending a friend request, then adding to group — same as today's flow before inviting to an outing.)

## Screens & graft points

All group management lives inside the existing **Contacts** screen ([public/connections.html](public/connections.html)) — no new tab.

1. **Contacts screen (extended)** — `connections.html`. Today renders contact cards via `renderConnectionsList()` ([connections.html:711-795](public/connections.html#L711)) into `#connections-list` ([connections.html:452](public/connections.html#L452)), fed by `/api/connections/all` ([connections.html:1252](public/connections.html#L1252)). Add a *Groups* section above the connection list, plus a *New group* button alongside the existing `#contacts-picker-btn` ([connections.html:409](public/connections.html#L409)).
2. **Group detail panel** — in-place expand within Contacts. Name, full roster with status, rename/delete (creator only), leave (member). No standalone page.
3. **Create / edit group dialog** — name field + member picker drawn from approved connections. Same component used by manual create and the post-invite prompt.
4. **Post-outing-invite prompt** — primary creation path. Inserted right after `inviteStep3()`'s POST to `/api/outings` resolves successfully ([calendar.html:6059](public/calendar.html#L6059)), before WhatsApp queue ([calendar.html:6066](public/calendar.html#L6066)). Modal: *"Save these {N} people as a group for future invites?"* — Skip / Save.
5. **Group-join acceptance** — reuses partner-invite pattern. Magic-token link → `GET /api/auth/verify/:token` ([routes/auth.js:105-130](routes/auth.js#L105)) with `group_id` carried in `magic_links` row → landing screen confirms join.
6. **Outing invite screen (calendar.html)** — extend `openInviteModal()` ([calendar.html:5413](public/calendar.html#L5413)) with a "Groups" row above individual people. Tapping a group expands its accepted members into the existing selection `Set` ([calendar.html:6023-6034](public/calendar.html#L6023)) so the rest of the flow is unchanged.
7. **Crafter (share-craft sheet) WHO row** — extend `renderSCWho()` ([calendar.html:8967-9010](public/calendar.html#L8967)) so group "tabs" sit inline with the profile-circle chips in `#sc-who-row`. A group tab visually echoes a `.sc-who-chip` (avatar slot becomes a stacked-avatars / group icon, name = group name). Tapping a group toggles all its accepted members into `_sc.selWho` (a Set) and re-renders. Tapping again deselects them. Group tabs sort with the WHO chips by availability (free → unknown → busy) using the same `_availTier` logic, where the group's tier is the best tier among its members.

   **Empty-state teaser:** if the user has zero groups, a single non-functional-looking chip appears at the end of the WHO row with a "+" / stacked-people icon and copy *"Create a group of friends?"*. Tapping opens the same create-group dialog used in Contacts and the post-invite prompt, pre-populated with whoever is currently selected in `_sc.selWho` (so the tap is a natural "you're already picking these people, save them as a group" gesture). The teaser disappears as soon as the user has at least one group.

## Flows

### Creation paths
- **Primary (organic):** After inviting 2+ people to an event, prompt: *"Is this a group you want to save for future invites?"* Members pre-populated, name field focused, Skip / Save.
- **Secondary (manual):** Contacts screen → *New group* → name + members → send. For users who want to set up a crew before any event exists.

### Lifecycle

| Moment | Who | Effect |
|---|---|---|
| Create | Creator | Group exists, members are *pending*. Notifications fan out. |
| Accept | Member | Status → *accepted*. Now eligible for group event invites. Sees full roster. |
| Decline | Member | Status → *declined*. Creator can re-invite. |
| Invite group to event | Creator | Fans out individual event invites to *accepted* members only. |
| Add member | Creator | New member is *pending*; gets join invite. Does not receive in-flight event invites. |
| Remove member | Creator | Status → *removed*. Quiet notification. Future group invites skip them. |
| Leave | Member | Self-removal. Same effect as removed but member-initiated. |
| Rename | Creator | Members notified quietly on next interaction (not push). |
| Delete | Creator | Group is gone. Already-sent event invites stand. No retroactive cancel. |

## UX micro-decisions

- **Notification copy (group join):** "Ran invited you to a group: *Trivia Crew*." Deep-link to acceptance screen.
- **Notification copy (event via group):** Same as a normal event invite — invitee doesn't need to know it came via group fan-out. (Internal: log the `group_id` for analytics.)
- **Roster display:** Names + avatar. No phone numbers shown. Status badges (pending/accepted) visible to creator only; members just see accepted members.
- **Empty state:** "Groups let you invite the same crew over and over. Create one to get started." with example chips.

## Out of scope for v1

- Group chat / messaging
- Shared calendar or free/busy view across group
- Member-initiated invites (only creator invites)
- Roles / co-admins / ownership transfer
- Group-level event polls or "who's in?" before scheduling
- Nested groups
- Discoverable / public groups
- Group avatars or custom themes

## Open questions

1. **Hard limits** — max members per group? max groups per user? Suggest: 50 / 20 for v1, soft-enforced.
2. **Creator deletes account** — group is deleted, members notified? Or transferred? Suggest: deleted, since "solo-owned" means no transfer concept.
3. **What appears on the event card** — when an event was group-invited, does the host see "Invited via *Trivia Crew*" tag? Useful for them; nothing for invitees. Suggest: yes, host-side only.
4. **Push permissions on group join invite** — non-users obviously can't get push; SMS/email handles them. Existing users get push. Reuses notification infrastructure already in place.
5. **Rate limiting re-invites** — if creator re-invites a decliner who declines again, do we cool down? Suggest: no v1, but log so we can detect abuse later.
6. **Crafter group selection — atomic or expanded?** When a user picks a group in the crafter WHO row, we expand its members into `_sc.selWho` (individual chips light up too). Should the summary then say "Trivia Crew" (atomic) or list members (expanded)? Suggest: list members in summary, but show "Invited via *Trivia Crew*" tag host-side after send. Avoids the edge case where partial-selection of a group would render ambiguously.
7. **Group tab availability tier** — when sorting WHO row by free/unknown/busy, what tier does a group sit in? Suggest: best tier among accepted members (so a group with at least one free member sorts as "free"). Alternative: all-free / any-free / all-busy as a three-state. Best-tier is simpler and matches the optimistic framing.

## Suggested build order

1. **Schema** — add `groups`, `group_members`, `outing_group_origin` to `db.js`. Add prepared queries.
2. **Group CRUD API** in `routes/api.js` — create, rename, delete, add member, remove member, leave, list-for-user.
3. **Contacts screen extension** — Groups section + detail panel + create/edit dialog inside `connections.html`. Reuses existing connection-card styles. Manual *New group* button.
4. **Group-join invite** — *deferred for v1.* The approved-connection invariant means every invitee already has an account + token, so the partner-invite-style magic-link landing isn't needed yet. Push + SMS deep-link to /connections.html (with the user's existing token) cover the reach paths. The `magic_links.group_id` column was added preemptively; the verify-path branch can be wired later if SMS-only friction shows up in real use.
5. **Post-outing-invite "save as group?" prompt** — hook into `inviteStep3()` after successful POST. Primary creation path.
6. **Outing invite screen integration** — Groups row in `openInviteModal()`; tapping a group expands accepted members into selection Set.
7. **Crafter WHO row integration** — group tabs inline in `#sc-who-row` + empty-state teaser chip. Reuses same expand-into-Set behavior as step 6.
8. **Fan-out + audit** — when an outing is created with a group selection, write `outing_group_origin` row. Already-existing `outing_invitees` insertion handles the rest.
9. **Polish** — empty states, removed/left toast notifications, host-side "Invited via *Trivia Crew*" label on outing card.

Most heavy lifting (auth tokens, push, invite acceptance, contacts UI) is already built — Groups largely composes existing pieces.

Estimate: ~1 week solo, depending on how much existing invite plumbing is reusable.
