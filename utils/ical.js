'use strict';

function formatDate(dateStr) {
  return dateStr.replace(/-/g, '');
}

function escapeIcal(str) {
  return (str || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

function addDay(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function dayDiff(a, b) {
  return (new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400000;
}

function dtstamp() {
  return new Date().toISOString().replace(/[-:.]/g, '').slice(0, 15) + 'Z';
}

function buildVEvent({ uid, dtstart, dtend, summary, description, organizer, attendees, status, sequence }) {
  const lines = [
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${dtstamp()}`,
    `DTSTART;VALUE=DATE:${formatDate(dtstart)}`,
    `DTEND;VALUE=DATE:${formatDate(dtend)}`,
    `SUMMARY:${escapeIcal(summary)}`,
  ];
  if (description) lines.push(`DESCRIPTION:${escapeIcal(description)}`);
  if (organizer) lines.push(`ORGANIZER;CN=${escapeIcal(organizer.name)}:mailto:${organizer.email}`);
  if (attendees) {
    for (const a of attendees) {
      lines.push(`ATTENDEE;CN=${escapeIcal(a.name)};RSVP=${a.rsvp ? 'TRUE' : 'FALSE'}:mailto:${a.email}`);
    }
  }
  if (status) lines.push(`STATUS:${status}`);
  if (sequence !== undefined) lines.push(`SEQUENCE:${sequence}`);
  lines.push('TRANSP:OPAQUE', 'END:VEVENT');
  return lines.join('\r\n');
}

/**
 * Build a METHOD:REQUEST calendar invite for an accepted activity.
 * activity.dates is an already-parsed array of YYYY-MM-DD strings.
 */
function buildInvite({ activity, fromUser, toUser }) {
  const dates = [...activity.dates].sort();
  const uid = `${activity.id}@spontany.app`;
  const desc = [activity.link ? `Link: ${activity.link}` : '', 'via Spontany'].filter(Boolean).join('\n');

  // One event: consecutive → span; non-consecutive → one event per date
  const isConsecutive = dates.length === 1 ||
    dates.every((d, i) => i === 0 || dayDiff(dates[i - 1], d) === 1);

  let vevents;
  if (isConsecutive) {
    vevents = buildVEvent({
      uid,
      dtstart: dates[0],
      dtend: addDay(dates[dates.length - 1]),
      summary: activity.title,
      description: desc,
      organizer: { name: fromUser.name, email: fromUser.email },
      attendees: [
        { name: fromUser.name, email: fromUser.email, rsvp: false },
        { name: toUser.name,   email: toUser.email,   rsvp: true  },
      ],
      status: 'CONFIRMED',
    });
  } else {
    vevents = dates.map((d, i) => buildVEvent({
      uid: `${activity.id}-${i}@spontany.app`,
      dtstart: d,
      dtend: addDay(d),
      summary: activity.title,
      description: desc,
      organizer: { name: fromUser.name, email: fromUser.email },
      attendees: [
        { name: fromUser.name, email: fromUser.email, rsvp: false },
        { name: toUser.name,   email: toUser.email,   rsvp: true  },
      ],
      status: 'CONFIRMED',
    })).join('\r\n');
  }

  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Spontany//EN', 'METHOD:REQUEST', vevents, 'END:VCALENDAR', ''].join('\r\n');
}

/**
 * Build a METHOD:CANCEL for a deleted accepted activity.
 */
function buildCancellation({ activity, fromUser, toUser }) {
  const dates = [...activity.dates].sort();
  const vevent = buildVEvent({
    uid: `${activity.id}@spontany.app`,
    dtstart: dates[0],
    dtend: addDay(dates[dates.length - 1]),
    summary: `Cancelled: ${activity.title}`,
    organizer: { name: fromUser.name, email: fromUser.email },
    attendees: [
      { name: fromUser.name, email: fromUser.email, rsvp: false },
      { name: toUser.name,   email: toUser.email,   rsvp: false },
    ],
    status: 'CANCELLED',
    sequence: 1,
  });
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Spontany//EN', 'METHOD:CANCEL', vevent, 'END:VCALENDAR', ''].join('\r\n');
}

/**
 * Build a METHOD:PUBLISH iCal feed of all "self" (kids with you) custody days.
 * Used for the subscribe URL.
 */
function buildSubscribeFeed({ user, days }) {
  const stamp = dtstamp();
  const vevents = days
    .filter(d => d.owner === 'self')
    .map(d => [
      'BEGIN:VEVENT',
      `UID:custody-${d.date}-${user.id}@spontany.app`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${formatDate(d.date)}`,
      `DTEND;VALUE=DATE:${formatDate(addDay(d.date))}`,
      'SUMMARY:Kids with you',
      'TRANSP:OPAQUE',
      'END:VEVENT',
    ].join('\r\n'))
    .join('\r\n');

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Spontany//EN',
    `X-WR-CALNAME:Spontany \u2014 ${escapeIcal(user.name)}`,
    'X-WR-CALDESC:Custody days from Spontany',
    'METHOD:PUBLISH',
    vevents,
    'END:VCALENDAR',
    '',
  ].join('\r\n');
}

module.exports = { buildInvite, buildCancellation, buildSubscribeFeed };
