const DEFAULT_TIMEZONE_OFFSET_MINUTES = 8 * 60;

const parseDays = (days = '') =>
  String(days)
    .split(',')
    .map(day => parseInt(day.trim(), 10))
    .filter(day => !Number.isNaN(day));

const getLocalDateParts = (dateInput, timezoneOffsetMinutes = DEFAULT_TIMEZONE_OFFSET_MINUTES) => {
  const date = dateInput instanceof Date ? dateInput : new Date(dateInput);
  const shifted = new Date(date.getTime() + timezoneOffsetMinutes * 60 * 1000);

  return {
    day: shifted.getUTCDay(),
    minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes()
  };
};

const rangesOverlap = (startA, endA, startB, endB) => startA < endB && endA > startB;

const scheduleConflictsWithRange = (schedule, startTime, endTime, timezoneOffsetMinutes = DEFAULT_TIMEZONE_OFFSET_MINUTES) => {
  if (!schedule?.IsActive && schedule?.IsActive !== undefined) return false;

  const requestStart = getLocalDateParts(startTime, timezoneOffsetMinutes);
  const requestEnd = getLocalDateParts(endTime, timezoneOffsetMinutes);
  const scheduleStart = getLocalDateParts(schedule.Start_Time, timezoneOffsetMinutes);
  const scheduleEnd = getLocalDateParts(schedule.End_Time, timezoneOffsetMinutes);
  const scheduleDays = parseDays(schedule.Days);

  if (!scheduleDays.includes(requestStart.day)) return false;

  return rangesOverlap(
    requestStart.minutes,
    requestEnd.minutes,
    scheduleStart.minutes,
    scheduleEnd.minutes
  );
};

const findScheduleConflict = (schedules = [], startTime, endTime, timezoneOffsetMinutes = DEFAULT_TIMEZONE_OFFSET_MINUTES) =>
  schedules.find(schedule => scheduleConflictsWithRange(schedule, startTime, endTime, timezoneOffsetMinutes));

const formatScheduleTime = (dateInput, timezoneOffsetMinutes = DEFAULT_TIMEZONE_OFFSET_MINUTES) => {
  const { minutes } = getLocalDateParts(dateInput, timezoneOffsetMinutes);
  const hour24 = Math.floor(minutes / 60);
  const minute = minutes % 60;
  const period = hour24 >= 12 ? 'PM' : 'AM';
  const hour12 = hour24 % 12 || 12;

  return `${hour12}:${String(minute).padStart(2, '0')} ${period}`;
};

module.exports = {
  DEFAULT_TIMEZONE_OFFSET_MINUTES,
  findScheduleConflict,
  formatScheduleTime,
  getLocalDateParts,
  parseDays,
  rangesOverlap,
  scheduleConflictsWithRange
};
