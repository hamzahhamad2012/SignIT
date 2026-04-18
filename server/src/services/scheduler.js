import db from '../db/index.js';
import { decoratePlaylist } from './systemPlaylists.js';

const DEFAULT_DAYS = ['0', '1', '2', '3', '4', '5', '6'];
const WEEKDAY_INDEX = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};
const formatterCache = new Map();

const SCHEDULER_TIMEZONE =
  process.env.SIGNIT_TIMEZONE || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

function getFormatter(timeZone) {
  if (!formatterCache.has(timeZone)) {
    formatterCache.set(
      timeZone,
      new Intl.DateTimeFormat('en-US', {
        timeZone,
        weekday: 'short',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
      }),
    );
  }

  return formatterCache.get(timeZone);
}

function shiftDate(dateString, days) {
  const date = new Date(`${dateString}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function getScheduleDays(schedule) {
  if (!schedule?.days_of_week) return DEFAULT_DAYS;

  const days = [...new Set(
    schedule.days_of_week
      .split(',')
      .map((day) => day.trim())
      .filter(Boolean),
  )];

  return days.length ? days : DEFAULT_DAYS;
}

function isDateInRange(schedule, dateString) {
  if (schedule.start_date && dateString < schedule.start_date) return false;
  if (schedule.end_date && dateString > schedule.end_date) return false;
  return true;
}

function includesDay(schedule, dayIndex) {
  return getScheduleDays(schedule).includes(String(dayIndex));
}

export function getSchedulerTimezone() {
  return SCHEDULER_TIMEZONE;
}

export function getSchedulerNowParts(now = new Date(), timeZone = getSchedulerTimezone()) {
  const rawParts = getFormatter(timeZone).formatToParts(now);
  const parts = {};

  for (const part of rawParts) {
    if (part.type !== 'literal') {
      parts[part.type] = part.value;
    }
  }

  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
    dayOfWeek: WEEKDAY_INDEX[parts.weekday.toLowerCase()],
    timeZone,
  };
}

export function isScheduleActiveAt(schedule, now = new Date(), timeZone = getSchedulerTimezone()) {
  const current = getSchedulerNowParts(now, timeZone);
  const currentDate = current.date;
  const currentTime = current.time;
  const currentDay = current.dayOfWeek;
  const hasStart = Boolean(schedule.start_time);
  const hasEnd = Boolean(schedule.end_time);

  if (!hasStart && !hasEnd) {
    return includesDay(schedule, currentDay) && isDateInRange(schedule, currentDate);
  }

  if (hasStart && !hasEnd) {
    return (
      includesDay(schedule, currentDay) &&
      isDateInRange(schedule, currentDate) &&
      currentTime >= schedule.start_time
    );
  }

  if (!hasStart && hasEnd) {
    return (
      includesDay(schedule, currentDay) &&
      isDateInRange(schedule, currentDate) &&
      currentTime < schedule.end_time
    );
  }

  if (schedule.start_time === schedule.end_time) {
    return includesDay(schedule, currentDay) && isDateInRange(schedule, currentDate);
  }

  const isOvernight = schedule.start_time > schedule.end_time;

  if (!isOvernight) {
    return (
      includesDay(schedule, currentDay) &&
      isDateInRange(schedule, currentDate) &&
      currentTime >= schedule.start_time &&
      currentTime < schedule.end_time
    );
  }

  const previousDate = shiftDate(currentDate, -1);
  const previousDay = (currentDay + 6) % 7;
  const isLateSameDay =
    includesDay(schedule, currentDay) &&
    isDateInRange(schedule, currentDate) &&
    currentTime >= schedule.start_time;
  const isOvernightCarry =
    includesDay(schedule, previousDay) &&
    isDateInRange(schedule, previousDate) &&
    currentTime < schedule.end_time;

  return isLateSameDay || isOvernightCarry;
}

export function getActiveScheduleForDevice(deviceId, now = new Date()) {
  const device = db.prepare('SELECT * FROM devices WHERE id = ?').get(deviceId);
  if (!device) return null;

  const schedules = db.prepare(`
    SELECT s.*, p.name as playlist_name,
           CASE
             WHEN s.device_id = ? THEN 2
             WHEN s.group_id = ? THEN 1
             ELSE 0
           END as target_scope
    FROM schedules s
    JOIN playlists p ON p.id = s.playlist_id
    WHERE s.is_active = 1
      AND (
        s.device_id = ?
        OR (? IS NOT NULL AND s.group_id = ?)
      )
    ORDER BY s.priority DESC, target_scope DESC, s.id DESC
  `).all(deviceId, device.group_id, deviceId, device.group_id, device.group_id);

  for (const schedule of schedules) {
    if (isScheduleActiveAt(schedule, now, getSchedulerTimezone())) {
      return schedule;
    }
  }

  return null;
}

export function getActivePlaylistForDevice(deviceId, now = new Date()) {
  const device = db.prepare('SELECT * FROM devices WHERE id = ?').get(deviceId);
  if (!device) return null;

  const activeSchedule = getActiveScheduleForDevice(deviceId, now);
  if (activeSchedule) return activeSchedule.playlist_id;

  if (device.assigned_playlist_id) return device.assigned_playlist_id;

  if (device.group_id) {
    const group = db.prepare('SELECT default_playlist_id FROM groups WHERE id = ?').get(device.group_id);
    if (group?.default_playlist_id) return group.default_playlist_id;
  }

  return null;
}

export function getDevicesImpactedBySchedule(schedule) {
  if (!schedule) return [];

  const impacted = new Set();

  if (schedule.device_id) {
    impacted.add(schedule.device_id);
  }

  if (schedule.group_id) {
    const devices = db.prepare('SELECT id FROM devices WHERE group_id = ?').all(schedule.group_id);
    devices.forEach((device) => impacted.add(device.id));
  }

  return [...impacted];
}

export function getDevicesImpactedBySchedules(schedules = []) {
  return [...new Set(schedules.flatMap((schedule) => getDevicesImpactedBySchedule(schedule)))];
}

export function getPlaylistContent(playlistId) {
  const playlist = db.prepare('SELECT * FROM playlists WHERE id = ?').get(playlistId);
  if (!playlist) return null;
  decoratePlaylist(playlist);

  if (playlist.system_action) {
    return {
      ...playlist,
      items: [],
    };
  }

  const items = db.prepare(`
    SELECT pi.*, a.name as asset_name, a.type as asset_type, a.folder_id, a.filename,
           a.mime_type, a.url, a.width, a.height, a.duration as asset_duration
    FROM playlist_items pi
    JOIN assets a ON a.id = pi.asset_id
    WHERE pi.playlist_id = ?
    ORDER BY pi.zone, pi.position
  `).all(playlistId);

  return {
    ...playlist,
    items: items.map((item) => ({
      ...item,
      settings: JSON.parse(item.settings || '{}'),
    })),
  };
}
