const fs = require("node:fs");
const path = require("node:path");

const calendarUrl =
  process.env.CALENDAR_ICS_URL ||
  "https://calendar.google.com/calendar/ical/46n8rnvi72qkqhpktso1nb0a5g%40group.calendar.google.com/public/basic.ics";

const outputPath = path.join(__dirname, "..", "calendar", "calendar-events.json");

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

async function main() {
  const response = await fetch(calendarUrl);
  if (!response.ok) {
    throw new Error(`Calendar request failed: ${response.status}`);
  }

  const ics = await response.text();
  const today = startOfToday();
  const horizon = addDays(today, 180);
  const events = expandRecurringEvents(parseCalendar(ics), today, horizon)
    .filter((event) => event.end ? new Date(event.end) >= today : new Date(event.start) >= today)
    .sort((left, right) => new Date(left.start) - new Date(right.start))
    .slice(0, 120);

  fs.writeFileSync(
    outputPath,
    JSON.stringify(
      {
        updatedAt: new Date().toISOString(),
        events
      },
      null,
      2
    ) + "\n"
  );
}

function parseCalendar(ics) {
  return unfoldLines(ics)
    .join("\n")
    .split("BEGIN:VEVENT")
    .slice(1)
    .map((block) => block.split("END:VEVENT")[0])
    .map(parseEvent)
    .filter((event) => event.title && event.start);
}

function parseEvent(block) {
  const fields = {};

  for (const line of block.split(/\r?\n/)) {
    const separator = line.indexOf(":");
    if (separator === -1) {
      continue;
    }

    const rawName = line.slice(0, separator);
    const value = decodeIcsText(line.slice(separator + 1));
    const [name, ...params] = rawName.split(";");
    const key = name.toUpperCase();
    fields[key] = fields[key] || [];
    fields[key].push({ value, params });
  }

  const startField = first(fields.DTSTART);
  const endField = first(fields.DTEND);

  return {
    uid: valueOf(fields.UID),
    title: valueOf(fields.SUMMARY) || "Untitled event",
    start: parseIcsDate(startField),
    end: parseIcsDate(endField),
    allDay: isAllDay(startField),
    location: valueOf(fields.LOCATION),
    rrule: valueOf(fields.RRULE),
    exdates: dateValues(fields.EXDATE),
    recurrenceId: parseIcsDate(first(fields["RECURRENCE-ID"]))
  };
}

function expandRecurringEvents(events, rangeStart, rangeEnd) {
  const overrides = new Map();

  for (const event of events) {
    if (!event.uid || !event.recurrenceId) {
      continue;
    }
    overrides.set(event.uid + "|" + dateKey(new Date(event.recurrenceId)), event);
  }

  const expanded = [];

  for (const event of events) {
    if (event.rrule) {
      expanded.push(...expandEventRecurrence(event, rangeStart, rangeEnd, overrides));
      continue;
    }
    expanded.push(stripInternalFields(event));
  }

  return expanded;
}

function expandEventRecurrence(event, rangeStart, rangeEnd, overrides) {
  const rule = parseRRule(event.rrule);
  if (rule.FREQ !== "WEEKLY" && rule.FREQ !== "DAILY") {
    return [stripInternalFields(event)];
  }

  const start = new Date(event.start);
  const end = event.end ? new Date(event.end) : null;
  const duration = end ? end.getTime() - start.getTime() : 0;
  const until = rule.UNTIL ? new Date(parseIcsDate({ value: rule.UNTIL, params: [] })) : rangeEnd;
  const limit = until < rangeEnd ? until : rangeEnd;
  const interval = Math.max(Number.parseInt(rule.INTERVAL || "1", 10), 1);
  const exdates = new Set((event.exdates || []).map((value) => dateKey(new Date(value))));
  const byDays = (rule.BYDAY || "").split(",").filter(Boolean);
  const occurrences = [];
  let count = 0;

  for (let cursor = new Date(start); cursor <= limit; cursor = addDays(cursor, 1)) {
    if (!matchesFrequency(cursor, start, rule.FREQ, interval, byDays)) {
      continue;
    }
    if (cursor < rangeStart && addMs(cursor, duration) < rangeStart) {
      continue;
    }

    const key = dateKey(cursor);
    if (exdates.has(key) || overrides.has(event.uid + "|" + key)) {
      continue;
    }

    count += 1;
    if (rule.COUNT && count > Number.parseInt(rule.COUNT, 10)) {
      break;
    }

    const occurrence = Object.assign({}, event, {
      start: event.allDay ? formatAllDayDateTime(cursor) : cursor.toISOString(),
      end: end ? (event.allDay ? formatAllDayDateTime(addMs(cursor, duration)) : addMs(cursor, duration).toISOString()) : ""
    });
    occurrences.push(stripInternalFields(occurrence));
  }

  return occurrences;
}

function matchesFrequency(date, start, frequency, interval, byDays) {
  if (frequency === "DAILY") {
    return daysBetween(start, date) % interval === 0;
  }

  if (frequency === "WEEKLY") {
    const weekOffset = Math.floor(daysBetween(startOfWeek(start), startOfWeek(date)) / 7);
    if (weekOffset % interval !== 0) {
      return false;
    }
    if (!byDays.length) {
      return date.getDay() === start.getDay();
    }
    return byDays.includes(["SU", "MO", "TU", "WE", "TH", "FR", "SA"][date.getDay()]);
  }

  return false;
}

function parseRRule(value) {
  return String(value || "")
    .split(";")
    .filter(Boolean)
    .reduce((rule, part) => {
      const [key, ruleValue] = part.split("=");
      rule[key] = ruleValue;
      return rule;
    }, {});
}

function stripInternalFields(event) {
  return {
    title: event.title,
    start: event.start,
    end: event.end,
    allDay: event.allDay,
    location: event.location
  };
}

function unfoldLines(ics) {
  return ics.replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "").split(/\r?\n/);
}

function first(values) {
  return values && values[0];
}

function valueOf(values) {
  return values && values[0] ? values[0].value : "";
}

function dateValues(values) {
  return (values || []).flatMap((field) =>
    field.value.split(",").map((value) => parseIcsDate({ value, params: field.params }))
  );
}

function isAllDay(field) {
  return Boolean(field && field.params.some((param) => param.toUpperCase() === "VALUE=DATE"));
}

function parseIcsDate(field) {
  if (!field || !field.value) {
    return "";
  }

  if (isAllDay(field)) {
    const value = field.value;
    return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T00:00:00`;
  }

  const value = field.value;
  if (value.endsWith("Z")) {
    return new Date(
      `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T${value.slice(9, 11)}:${value.slice(11, 13)}:${value.slice(13, 15)}Z`
    ).toISOString();
  }

  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T${value.slice(9, 11)}:${value.slice(11, 13)}:${value.slice(13, 15)}`;
}

function decodeIcsText(value) {
  return value
    .replace(/\\n/g, " ")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\")
    .trim();
}

function startOfToday() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function addDays(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function addMs(date, ms) {
  return new Date(date.getTime() + ms);
}

function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function formatAllDayDateTime(date) {
  return `${dateKey(date)}T00:00:00`;
}

function startOfWeek(date) {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  start.setDate(start.getDate() - start.getDay());
  return start;
}

function daysBetween(start, end) {
  const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  return Math.round((endDay - startDay) / 86400000);
}
