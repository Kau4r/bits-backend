const prisma = require('../../lib/prisma');
const { readXlsxWorkbook } = require('../../utils/xlsxReader');
const {
  DEFAULT_TIMEZONE_OFFSET_MINUTES,
  getLocalDateParts,
  rangesOverlap
} = require('../../utils/scheduleConflict');

const SHEET_CONFIGS = {
  'Offered Course': {
    groupCourse: 0,
    description: 1,
    units: 2,
    courseStatus: 4,
    requestStatus: 5,
    population: 6,
    teacher: 7,
    schedule: 8,
    department: 9
  },
  'Requested Course': {
    group: 0,
    courseCode: 1,
    description: 2,
    units: 3,
    courseStatus: 6,
    requestStatus: 7,
    population: 8,
    teacher: 9,
    schedule: 12,
    department: 13
  },
  'Requested Course by Other Dept.': {
    group: 0,
    courseCode: 1,
    description: 2,
    units: 3,
    courseStatus: 6,
    requestStatus: 7,
    population: 8,
    teacher: 9,
    schedule: 12,
    department: 13
  }
};

const DEFAULT_SHEETS = ['Offered Course'];

const cleanText = (value) =>
  String(value ?? '')
    .replace(/_x000D_/g, ' ')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const parseBooleanOption = (value, defaultValue) => {
  if (value === undefined || value === null || value === '') return defaultValue;
  if (typeof value === 'boolean') return value;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
};

const parseSheetNames = (value) => {
  if (!value) return DEFAULT_SHEETS;
  if (Array.isArray(value)) return value.filter(Boolean);

  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.filter(Boolean);
  } catch {
    // Fall through to comma-separated parsing.
  }

  return String(value).split(',').map(sheet => sheet.trim()).filter(Boolean);
};

const parseDayCode = (value) => {
  const code = cleanText(value).replace(/[^A-Za-z]/g, '').toUpperCase();
  const days = [];
  let index = 0;

  while (index < code.length) {
    const rest = code.slice(index);

    if (rest.startsWith('SUN')) {
      days.push(0);
      index += 3;
    } else if (rest.startsWith('SAT')) {
      days.push(6);
      index += 3;
    } else if (rest.startsWith('TH')) {
      days.push(4);
      index += 2;
    } else if (rest.startsWith('M')) {
      days.push(1);
      index += 1;
    } else if (rest.startsWith('T')) {
      days.push(2);
      index += 1;
    } else if (rest.startsWith('W')) {
      days.push(3);
      index += 1;
    } else if (rest.startsWith('F')) {
      days.push(5);
      index += 1;
    } else {
      return [];
    }
  }

  return [...new Set(days)];
};

const parseTimeToMinutes = (value) => {
  const match = cleanText(value).match(/^(\d{1,2}):(\d{2})\s*([AP]M)$/i);
  if (!match) return null;

  let hour = parseInt(match[1], 10);
  const minute = parseInt(match[2], 10);
  const period = match[3].toUpperCase();

  if (hour < 1 || hour > 12 || minute < 0 || minute > 59) return null;
  if (period === 'PM' && hour !== 12) hour += 12;
  if (period === 'AM' && hour === 12) hour = 0;

  return hour * 60 + minute;
};

const formatMinutes = (minutes) => {
  const hour24 = Math.floor(minutes / 60);
  const minute = minutes % 60;
  const period = hour24 >= 12 ? 'PM' : 'AM';
  const hour12 = hour24 % 12 || 12;
  return `${hour12}:${String(minute).padStart(2, '0')} ${period}`;
};

const timeMinutesToDate = (anchorDate, minutes, timezoneOffsetMinutes) => {
  const match = cleanText(anchorDate).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw new Error('anchorDate must be YYYY-MM-DD');

  const [, year, month, day] = match;
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  const utcMs = Date.UTC(
    parseInt(year, 10),
    parseInt(month, 10) - 1,
    parseInt(day, 10),
    hour,
    minute
  ) - timezoneOffsetMinutes * 60 * 1000;

  return new Date(utcMs);
};

const normalizeRoomKey = (value) => cleanText(value).toUpperCase().replace(/[^A-Z0-9]/g, '');

const getRoomVariants = (value) => {
  const key = normalizeRoomKey(value);
  if (!key) return [];

  const variants = new Set([key]);
  const withoutTrailingP = key.endsWith('P') ? key.slice(0, -1) : key;
  variants.add(withoutTrailingP);

  const lbMatch = withoutTrailingP.match(/LB(\d+)/);
  if (lbMatch) variants.add(`LB${lbMatch[1]}`);

  return [...variants].filter(Boolean);
};

const buildRoomMatcher = (rooms) => {
  const roomMap = new Map();

  for (const room of rooms) {
    for (const variant of getRoomVariants(room.Name)) {
      if (!roomMap.has(variant)) roomMap.set(variant, new Map());
      roomMap.get(variant).set(room.Room_ID, room);
    }
  }

  return (rawRoomCode) => {
    const candidates = new Map();
    for (const variant of getRoomVariants(rawRoomCode)) {
      const matches = roomMap.get(variant);
      if (matches) {
        for (const [roomId, room] of matches.entries()) candidates.set(roomId, room);
      }
      if (candidates.size === 1) break;
    }

    const rooms = [...candidates.values()];
    if (rooms.length === 1) return { room: rooms[0], status: 'matched' };
    if (rooms.length > 1) return { room: null, status: 'ambiguous', matches: rooms.map(room => room.Name) };
    return { room: null, status: 'unknown', matches: [] };
  };
};

const parseScheduleString = (value) => {
  const rawSchedule = cleanText(value);

  if (!rawSchedule) {
    return { ok: false, error: 'Schedule is blank', rawSchedule };
  }

  const timeMatch = rawSchedule.match(/\b([A-Za-z]+)\s*-?\s*(\d{1,2}:\d{2}\s*[AP]M)\s*-\s*(\d{1,2}:\d{2}\s*[AP]M)\s+([A-Za-z][A-Za-z0-9]*\d[A-Za-z0-9]*)\b/i);

  if (!timeMatch) {
    return { ok: false, error: 'Day, time range, or room code not found', rawSchedule };
  }

  const days = parseDayCode(timeMatch[1]);
  const startMinutes = parseTimeToMinutes(timeMatch[2]);
  const endMinutes = parseTimeToMinutes(timeMatch[3]);
  const roomCode = timeMatch[4].replace(/\s+/g, '').toUpperCase();

  if (days.length === 0 || startMinutes === null || endMinutes === null || endMinutes <= startMinutes) {
    return { ok: false, error: 'Invalid day or time range', rawSchedule, roomCode };
  }

  return {
    ok: true,
    rawSchedule,
    roomCode,
    dayCode: timeMatch[1],
    days,
    daysValue: days.join(','),
    startMinutes,
    endMinutes,
    startTime: formatMinutes(startMinutes),
    endTime: formatMinutes(endMinutes)
  };
};

const getCourseInfo = (row, config) => {
  if (config.groupCourse !== undefined) {
    const groupCourse = cleanText(row[config.groupCourse]);
    const match = groupCourse.match(/^(\S+)\s+(.+)$/);
    return {
      group: match ? match[1] : '',
      courseCode: match ? match[2] : groupCourse
    };
  }

  return {
    group: cleanText(row[config.group]),
    courseCode: cleanText(row[config.courseCode])
  };
};

const buildTitle = ({ group, courseCode, description, teacher }) => {
  const base = [courseCode, group ? `G${group}` : ''].filter(Boolean).join(' ');
  const withDescription = [base, description].filter(Boolean).join(' - ');
  return teacher ? `${withDescription} (${teacher})` : withDescription || 'Imported Class Schedule';
};

const getScheduleMinutes = (schedule, timezoneOffsetMinutes) => {
  const start = getLocalDateParts(schedule.Start_Time, timezoneOffsetMinutes).minutes;
  const end = getLocalDateParts(schedule.End_Time, timezoneOffsetMinutes).minutes;
  return { start, end };
};

const daysIntersect = (daysA, daysB) => daysA.some(day => daysB.includes(day));

const normalizeTitleKey = (value) => cleanText(value).toUpperCase();

const sameScheduleKey = (a, b) =>
  a.roomId === b.roomId &&
  a.daysValue === b.daysValue &&
  a.startMinutes === b.startMinutes &&
  a.endMinutes === b.endMinutes &&
  normalizeTitleKey(a.title) === normalizeTitleKey(b.title);

const conflictsWithSchedule = (candidate, schedule, timezoneOffsetMinutes) => {
  if (candidate.roomId !== schedule.Room_ID) return false;
  const scheduleDays = String(schedule.Days || '').split(',').map(day => parseInt(day.trim(), 10)).filter(day => !Number.isNaN(day));
  if (!daysIntersect(candidate.days, scheduleDays)) return false;

  const scheduleTime = getScheduleMinutes(schedule, timezoneOffsetMinutes);
  return rangesOverlap(candidate.startMinutes, candidate.endMinutes, scheduleTime.start, scheduleTime.end);
};

const buildSummary = (rows) => ({
  totalRows: rows.length,
  valid: rows.filter(row => row.status === 'valid').length,
  imported: rows.filter(row => row.status === 'imported').length,
  skipped: rows.filter(row => row.status === 'skipped').length,
  invalid: rows.filter(row => row.status === 'invalid').length,
  unknownRoom: rows.filter(row => row.status === 'unknown_room').length,
  ambiguousRoom: rows.filter(row => row.status === 'ambiguous_room').length,
  conflicts: rows.filter(row => row.status === 'conflict').length,
  duplicates: rows.filter(row => row.status === 'duplicate').length
});

const analyzeScheduleImport = async (buffer, rawOptions = {}) => {
  const options = {
    sheetNames: parseSheetNames(rawOptions.sheets || rawOptions.sheetNames),
    skipDissolved: parseBooleanOption(rawOptions.skipDissolved, true),
    approvedOnly: parseBooleanOption(rawOptions.approvedOnly, true),
    anchorDate: cleanText(rawOptions.anchorDate) || new Date().toISOString().slice(0, 10),
    timezoneOffsetMinutes: parseInt(rawOptions.timezoneOffsetMinutes, 10) || DEFAULT_TIMEZONE_OFFSET_MINUTES
  };

  const workbook = readXlsxWorkbook(buffer);
  const rooms = await prisma.Room.findMany({ orderBy: { Room_ID: 'asc' } });
  const activeSchedules = await prisma.Schedule.findMany({
    where: { IsActive: true },
    include: { Room: true }
  });
  const matchRoom = buildRoomMatcher(rooms);
  const rows = [];
  const uploadKeys = new Set();

  for (const sheetName of options.sheetNames) {
    const config = SHEET_CONFIGS[sheetName];
    const sheet = workbook.sheets.find(candidate => candidate.name === sheetName);

    if (!config || !sheet) continue;

    sheet.rows.forEach((row, index) => {
      const rowNumber = index + 1;
      const { group, courseCode } = getCourseInfo(row, config);
      const description = cleanText(row[config.description]);
      const courseStatus = cleanText(row[config.courseStatus]);
      const requestStatus = cleanText(row[config.requestStatus]);
      const teacher = cleanText(row[config.teacher]);
      const population = cleanText(row[config.population]);
      const department = cleanText(row[config.department]);
      const rawSchedule = cleanText(row[config.schedule]);
      const common = {
        sheetName,
        rowNumber,
        group,
        courseCode,
        description,
        courseStatus,
        requestStatus,
        population,
        teacher,
        department,
        rawSchedule,
        title: buildTitle({ group, courseCode, description, teacher })
      };

      if (!courseCode && !description && !rawSchedule) return;

      if (options.approvedOnly && requestStatus && requestStatus.toUpperCase() !== 'APPROVED') {
        rows.push({ ...common, status: 'skipped', reason: `Request status is ${requestStatus}` });
        return;
      }

      if (options.skipDissolved && courseStatus.toUpperCase() === 'DISSOLVED') {
        rows.push({ ...common, status: 'skipped', reason: 'Course is dissolved' });
        return;
      }

      const parsedSchedule = parseScheduleString(rawSchedule);
      if (!parsedSchedule.ok) {
        rows.push({ ...common, status: 'invalid', reason: parsedSchedule.error, roomCode: parsedSchedule.roomCode || '' });
        return;
      }

      const roomMatch = matchRoom(parsedSchedule.roomCode);
      if (!roomMatch.room) {
        rows.push({
          ...common,
          ...parsedSchedule,
          status: roomMatch.status === 'ambiguous' ? 'ambiguous_room' : 'unknown_room',
          reason: roomMatch.status === 'ambiguous'
            ? `Room code matched multiple rooms: ${roomMatch.matches.join(', ')}`
            : `No room matched ${parsedSchedule.roomCode}`,
          matches: roomMatch.matches
        });
        return;
      }

      const candidate = {
        ...common,
        ...parsedSchedule,
        roomId: roomMatch.room.Room_ID,
        roomName: roomMatch.room.Name,
        title: buildTitle({ group, courseCode, description, teacher })
      };

      const duplicateKey = `${candidate.roomId}|${candidate.daysValue}|${candidate.startMinutes}|${candidate.endMinutes}|${normalizeTitleKey(candidate.title)}`;
      if (uploadKeys.has(duplicateKey)) {
        rows.push({ ...candidate, status: 'duplicate', reason: 'Duplicate row in uploaded file' });
        return;
      }

      const duplicateExisting = activeSchedules.find(schedule => sameScheduleKey(candidate, {
        roomId: schedule.Room_ID,
        daysValue: schedule.Days,
        startMinutes: getScheduleMinutes(schedule, options.timezoneOffsetMinutes).start,
        endMinutes: getScheduleMinutes(schedule, options.timezoneOffsetMinutes).end,
        title: schedule.Title
      }));

      if (duplicateExisting) {
        rows.push({ ...candidate, status: 'duplicate', reason: 'Matching schedule already exists' });
        return;
      }

      const conflictingSchedule = activeSchedules.find(schedule =>
        conflictsWithSchedule(candidate, schedule, options.timezoneOffsetMinutes)
      );

      if (conflictingSchedule) {
        rows.push({
          ...candidate,
          status: 'conflict',
          reason: `Conflicts with ${conflictingSchedule.Title} in ${conflictingSchedule.Room?.Name || candidate.roomName}`
        });
        return;
      }

      uploadKeys.add(duplicateKey);
      rows.push({ ...candidate, status: 'valid', reason: 'Ready to import' });
    });
  }

  return {
    options,
    sheets: workbook.sheets.map(sheet => sheet.name),
    rows,
    summary: buildSummary(rows)
  };
};

const importScheduleRows = async (buffer, rawOptions, userId) => {
  const preview = await analyzeScheduleImport(buffer, rawOptions);
  const validRows = preview.rows.filter(row => row.status === 'valid');

  const created = await prisma.$transaction(validRows.map(row =>
    prisma.Schedule.create({
      data: {
        Room_ID: row.roomId,
        Schedule_Type: 'CLASS',
        Title: row.title,
        Start_Time: timeMinutesToDate(preview.options.anchorDate, row.startMinutes, preview.options.timezoneOffsetMinutes),
        End_Time: timeMinutesToDate(preview.options.anchorDate, row.endMinutes, preview.options.timezoneOffsetMinutes),
        Days: row.daysValue,
        IsActive: true,
        IsRecurring: true,
        Created_By: userId
      }
    })
  ));

  const importedIdsByIndex = new Map();
  validRows.forEach((row, index) => importedIdsByIndex.set(`${row.sheetName}:${row.rowNumber}`, created[index]?.Schedule_ID));

  const rows = preview.rows.map(row => {
    if (row.status !== 'valid') return row;
    return {
      ...row,
      status: 'imported',
      scheduleId: importedIdsByIndex.get(`${row.sheetName}:${row.rowNumber}`),
      reason: 'Imported'
    };
  });

  return {
    ...preview,
    rows,
    summary: buildSummary(rows)
  };
};

module.exports = {
  analyzeScheduleImport,
  importScheduleRows,
  parseScheduleString
};
