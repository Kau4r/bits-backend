// Minimal RFC-5545 RRULE expander tailored to the subset produced by the
// frontend RecurrenceModal. Supports:
//   FREQ=DAILY|WEEKLY|MONTHLY|YEARLY
//   INTERVAL=N
//   BYDAY=MO,WE   (weekly)
//   BYDAY=1MO     (monthly/yearly positional, n is 1..4 or -1)
//   BYMONTHDAY=N
//   BYMONTH=N
//   COUNT=N
//   UNTIL=YYYYMMDDTHHMMSSZ
//
// We avoid `rrule` npm dep to keep the backend lean. If you ever need
// BYHOUR/BYMINUTE/BYSETPOS-on-WEEKLY/etc, swap this for the library.

const DAY_CODE_TO_INDEX = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

const parseUntil = (raw) => {
  if (!raw) return null;
  const match = String(raw).match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})Z?)?$/);
  if (!match) return null;
  const [, y, m, d, h = '23', mi = '59', s = '59'] = match;
  return new Date(Date.UTC(+y, +m - 1, +d, +h, +mi, +s));
};

const parseByDayToken = (token) => {
  const match = String(token).trim().match(/^(-?\d+)?([A-Z]{2})$/);
  if (!match) return null;
  const setPos = match[1] ? parseInt(match[1], 10) : null;
  const weekday = DAY_CODE_TO_INDEX[match[2]];
  if (weekday === undefined) return null;
  return { setPos, weekday };
};

const parseRrule = (rrule) => {
  const params = {};
  String(rrule || '').split(';').forEach(part => {
    const [key, value] = part.split('=');
    if (key) params[key.toUpperCase()] = value || '';
  });
  return {
    freq: params.FREQ || null,
    interval: Math.max(1, parseInt(params.INTERVAL || '1', 10)),
    byDay: params.BYDAY ? params.BYDAY.split(',').map(parseByDayToken).filter(Boolean) : [],
    byMonthDay: params.BYMONTHDAY ? parseInt(params.BYMONTHDAY, 10) : null,
    byMonth: params.BYMONTH ? parseInt(params.BYMONTH, 10) : null,
    count: params.COUNT ? parseInt(params.COUNT, 10) : null,
    until: parseUntil(params.UNTIL)
  };
};

const ymd = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const nthWeekdayOfMonth = (year, month, weekday, n) => {
  if (n === -1) {
    const last = new Date(year, month + 1, 0);
    const offset = (last.getDay() - weekday + 7) % 7;
    return new Date(year, month, last.getDate() - offset);
  }
  const first = new Date(year, month, 1);
  const offset = (weekday - first.getDay() + 7) % 7;
  const day = 1 + offset + (n - 1) * 7;
  const result = new Date(year, month, day);
  if (result.getMonth() !== month) return null;
  return result;
};

// Expands a series into Date objects within [windowStart, windowEnd]. Anchor
// time-of-day is preserved on every occurrence. Excluded dates (YYYY-MM-DD)
// are dropped. Returns an array of starts; pair each with anchor duration to
// reconstruct the end.
const expandRrule = (rrule, anchorStart, options = {}) => {
  const { windowStart = null, windowEnd = null, excludedDates = [], hardCap = 366 } = options;
  const anchor = anchorStart instanceof Date ? new Date(anchorStart.getTime()) : new Date(anchorStart);
  if (Number.isNaN(anchor.getTime())) return [];

  const parsed = parseRrule(rrule);
  if (!parsed.freq) return [];

  const upperBound = parsed.until || windowEnd ||
    new Date(anchor.getTime() + 365 * 5 * 24 * 60 * 60 * 1000); // hard 5y cap
  const cap = parsed.count ? Math.min(parsed.count, hardCap) : hardCap;
  const excludedSet = new Set(
    (excludedDates || []).map(d =>
      typeof d === 'string'
        ? d.slice(0, 10)
        : ymd(new Date(d))
    )
  );
  const lowerBound = windowStart ? new Date(windowStart) : null;

  const results = [];
  // Used by COUNT semantics: count includes excluded/out-of-window dates so
  // the rule's "after N occurrences" matches the user's mental model.
  let producedCount = 0;

  const tryRecord = (occ) => {
    if (!occ) return true;
    if (occ < anchor) return true;
    if (parsed.until && occ > parsed.until) return false;
    if (occ > upperBound) return false;
    producedCount += 1;
    if (parsed.count && producedCount > parsed.count) return false;
    if (lowerBound && occ < lowerBound) return true;
    if (excludedSet.has(ymd(occ))) return true;
    results.push(new Date(occ.getTime()));
    return true;
  };

  if (parsed.freq === 'DAILY') {
    const d = new Date(anchor.getTime());
    while (results.length < cap && d <= upperBound) {
      if (!tryRecord(new Date(d.getTime()))) break;
      d.setDate(d.getDate() + parsed.interval);
    }
  } else if (parsed.freq === 'WEEKLY') {
    const days = parsed.byDay.length > 0
      ? [...new Set(parsed.byDay.map(b => b.weekday))].sort((a, b) => a - b)
      : [anchor.getDay()];
    const weekStart = new Date(anchor.getTime());
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    weekStart.setHours(0, 0, 0, 0);
    while (results.length < cap && weekStart <= upperBound) {
      let stop = false;
      for (const day of days) {
        const occ = new Date(weekStart.getTime());
        occ.setDate(weekStart.getDate() + day);
        occ.setHours(anchor.getHours(), anchor.getMinutes(), anchor.getSeconds(), 0);
        if (!tryRecord(occ)) { stop = true; break; }
      }
      if (stop) break;
      weekStart.setDate(weekStart.getDate() + 7 * parsed.interval);
    }
  } else if (parsed.freq === 'MONTHLY') {
    const cursor = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    while (results.length < cap && cursor <= upperBound) {
      let occ = null;
      if (parsed.byDay.length > 0 && parsed.byDay[0].setPos !== null) {
        const { weekday, setPos } = parsed.byDay[0];
        occ = nthWeekdayOfMonth(cursor.getFullYear(), cursor.getMonth(), weekday, setPos);
      } else if (parsed.byMonthDay) {
        occ = new Date(cursor.getFullYear(), cursor.getMonth(), parsed.byMonthDay);
        if (occ.getMonth() !== cursor.getMonth()) occ = null;
      } else {
        occ = new Date(cursor.getFullYear(), cursor.getMonth(), anchor.getDate());
        if (occ.getMonth() !== cursor.getMonth()) occ = null;
      }
      if (occ) {
        occ.setHours(anchor.getHours(), anchor.getMinutes(), anchor.getSeconds(), 0);
        if (!tryRecord(occ)) break;
      }
      cursor.setMonth(cursor.getMonth() + parsed.interval);
    }
  } else if (parsed.freq === 'YEARLY') {
    const month = parsed.byMonth ? parsed.byMonth - 1 : anchor.getMonth();
    const cursor = new Date(anchor.getFullYear(), month, 1);
    while (results.length < cap && cursor <= upperBound) {
      let occ = null;
      if (parsed.byDay.length > 0 && parsed.byDay[0].setPos !== null) {
        const { weekday, setPos } = parsed.byDay[0];
        occ = nthWeekdayOfMonth(cursor.getFullYear(), month, weekday, setPos);
      } else if (parsed.byMonthDay) {
        occ = new Date(cursor.getFullYear(), month, parsed.byMonthDay);
        if (occ.getMonth() !== month) occ = null;
      } else {
        occ = new Date(cursor.getFullYear(), month, anchor.getDate());
        if (occ.getMonth() !== month) occ = null;
      }
      if (occ) {
        occ.setHours(anchor.getHours(), anchor.getMinutes(), anchor.getSeconds(), 0);
        if (!tryRecord(occ)) break;
      }
      cursor.setFullYear(cursor.getFullYear() + parsed.interval);
    }
  }

  return results;
};

module.exports = {
  expandRrule,
  parseRrule
};
