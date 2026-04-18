import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Calendar, Clock, Moon } from 'lucide-react';

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const COLORS = [
  'bg-accent/30 border-accent/50 text-accent',
  'bg-emerald-500/25 border-emerald-500/45 text-emerald-300',
  'bg-amber-500/25 border-amber-500/45 text-amber-300',
  'bg-cyan-500/25 border-cyan-500/45 text-cyan-300',
  'bg-rose-500/25 border-rose-500/45 text-rose-300',
  'bg-teal-500/25 border-teal-500/45 text-teal-300',
  'bg-sky-500/25 border-sky-500/45 text-sky-300',
  'bg-lime-500/20 border-lime-500/40 text-lime-300',
];

function getWeekDates(offset = 0) {
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(now.getDate() - now.getDay() + offset * 7);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
}

function formatDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function timeToHour(time, fallback = null) {
  if (!time) return fallback;
  const [h, m] = time.split(':').map(Number);
  return h + m / 60;
}

function scheduleActiveOnDate(schedule, date, dayIdx) {
  const dateStr = formatDateKey(date);
  if (schedule.start_date && dateStr < schedule.start_date) return false;
  if (schedule.end_date && dateStr > schedule.end_date) return false;

  const activeDays = (schedule.days_of_week || '0,1,2,3,4,5,6').split(',').map(Number);
  return activeDays.includes(dayIdx);
}

function assignOverlapColumns(blocks) {
  const grouped = new Map();
  blocks.forEach((block) => {
    const current = grouped.get(block.dayIdx) || [];
    current.push(block);
    grouped.set(block.dayIdx, current);
  });

  const assigned = [];
  grouped.forEach((dayBlocks) => {
    const columns = [];
    const sorted = [...dayBlocks].sort((a, b) => a.startH - b.startH || b.endH - a.endH);

    sorted.forEach((block) => {
      let column = columns.findIndex((endH) => endH <= block.startH);
      if (column === -1) {
        column = columns.length;
        columns.push(block.endH);
      } else {
        columns[column] = block.endH;
      }

      assigned.push({
        ...block,
        column,
        columns: Math.max(columns.length, 1),
      });
    });
  });

  return assigned.map((block) => ({
    ...block,
    columns: Math.max(
      block.columns,
      ...assigned.filter((other) => other.dayIdx === block.dayIdx).map((other) => other.columns),
    ),
  }));
}

export default function ScheduleCalendar({ schedules = [], loading = false, onEdit }) {
  const [weekOffset, setWeekOffset] = useState(0);
  const weekDates = useMemo(() => getWeekDates(weekOffset), [weekOffset]);

  const targetColorMap = useMemo(() => {
    const keys = [];
    schedules.forEach((schedule) => {
      const key = schedule.device_id ? `device:${schedule.device_id}` : `group:${schedule.group_id || 'none'}`;
      if (!keys.includes(key)) keys.push(key);
    });

    return new Map(keys.map((key, index) => [key, COLORS[index % COLORS.length]]));
  }, [schedules]);

  const weekLabel = useMemo(() => {
    const start = weekDates[0];
    const end = weekDates[6];
    const opts = { month: 'short', day: 'numeric' };
    return `${start.toLocaleDateString('en-US', opts)} - ${end.toLocaleDateString('en-US', opts)}, ${end.getFullYear()}`;
  }, [weekDates]);

  const scheduleBlocks = useMemo(() => {
    const rawBlocks = [];

    schedules.forEach((schedule) => {
      const targetKey = schedule.device_id ? `device:${schedule.device_id}` : `group:${schedule.group_id || 'none'}`;
      const color = targetColorMap.get(targetKey) || COLORS[0];
      const startHour = timeToHour(schedule.start_time, 0);
      const endHour = timeToHour(schedule.end_time, 24);
      const hasStart = Boolean(schedule.start_time);
      const hasEnd = Boolean(schedule.end_time);
      const allDayTimed = hasStart && hasEnd && schedule.start_time === schedule.end_time;
      const overnight = hasStart && hasEnd && schedule.start_time > schedule.end_time;

      weekDates.forEach((date, dayIdx) => {
        if (!scheduleActiveOnDate(schedule, date, dayIdx)) return;

        if (!hasStart && !hasEnd) {
          rawBlocks.push({ schedule, dayIdx, startH: 0, endH: 24, color });
          return;
        }

        if (allDayTimed) {
          rawBlocks.push({ schedule, dayIdx, startH: 0, endH: 24, color });
          return;
        }

        if (!overnight) {
          rawBlocks.push({ schedule, dayIdx, startH: startHour, endH: endHour, color });
          return;
        }

        rawBlocks.push({ schedule, dayIdx, startH: startHour, endH: 24, color });

        if (dayIdx < 6) {
          rawBlocks.push({
            schedule,
            dayIdx: dayIdx + 1,
            startH: 0,
            endH: endHour,
            color,
            spillover: true,
          });
        }
      });
    });

    return assignOverlapColumns(rawBlocks);
  }, [schedules, targetColorMap, weekDates]);

  const isToday = (date) => {
    const today = new Date();
    return date.getDate() === today.getDate() &&
      date.getMonth() === today.getMonth() &&
      date.getFullYear() === today.getFullYear();
  };

  const now = new Date();
  const nowHour = now.getHours() + now.getMinutes() / 60;

  if (loading) {
    return <div className="h-96 bg-surface rounded-xl animate-pulse" />;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Calendar size={18} className="text-accent" />
          <h2 className="text-lg font-semibold text-zinc-200">{weekLabel}</h2>
          <span className="badge bg-surface-overlay text-zinc-400">{scheduleBlocks.length} blocks</span>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => setWeekOffset(0)} className="btn-ghost text-xs">Today</button>
          <button onClick={() => setWeekOffset(w => w - 1)} className="p-1.5 rounded-lg hover:bg-surface-hover text-zinc-400">
            <ChevronLeft size={16} />
          </button>
          <button onClick={() => setWeekOffset(w => w + 1)} className="p-1.5 rounded-lg hover:bg-surface-hover text-zinc-400">
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      <div className="card p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <div className="min-w-[900px]">
            <div className="grid grid-cols-[60px_repeat(7,1fr)] border-b border-surface-border">
              <div className="p-2" />
              {weekDates.map((date, i) => (
                <div key={i} className={`p-3 text-center border-l border-surface-border ${isToday(date) ? 'bg-accent/5' : ''}`}>
                  <div className="text-[11px] text-zinc-500 uppercase tracking-wider">{DAY_SHORT[i]}</div>
                  <div className={`text-lg font-semibold mt-0.5 ${isToday(date) ? 'text-accent' : 'text-zinc-300'}`}>
                    {date.getDate()}
                  </div>
                </div>
              ))}
            </div>

            <div className="relative" style={{ height: '760px' }}>
              {HOURS.map(h => (
                <div key={h} className="absolute w-full flex" style={{ top: `${(h / 24) * 100}%`, height: `${(1 / 24) * 100}%` }}>
                  <div className="w-[60px] pr-2 text-right text-[10px] text-zinc-600 -mt-1.5 shrink-0">
                    {h === 0 ? '' : `${h % 12 || 12}${h < 12 ? 'a' : 'p'}`}
                  </div>
                  <div className="flex-1 border-t border-surface-border/50" />
                </div>
              ))}

              <div className="absolute left-[60px] right-0 top-0 bottom-0 grid grid-cols-7">
                {Array(7).fill(0).map((_, i) => (
                  <div key={i} className={`border-l border-surface-border/50 ${isToday(weekDates[i]) ? 'bg-accent/[0.02]' : ''}`} />
                ))}
              </div>

              {weekOffset === 0 && (
                <div className="absolute left-[60px] right-0 z-20 flex items-center pointer-events-none"
                  style={{ top: `${(nowHour / 24) * 100}%` }}>
                  <div className="w-2 h-2 rounded-full bg-red-500 -ml-1" />
                  <div className="flex-1 h-px bg-red-500/60" />
                </div>
              )}

              {scheduleBlocks.map((block, bIdx) => {
                const top = (block.startH / 24) * 100;
                const height = Math.max(((block.endH - block.startH) / 24) * 100, 2.5);
                const dayWidth = '(100% - 60px) / 7';
                const columnWidth = `(${dayWidth} - 6px) / ${block.columns}`;
                const left = `calc(60px + ${block.dayIdx} * (${dayWidth}) + 3px + ${block.column} * (${columnWidth}))`;
                const width = `calc(${columnWidth} - 2px)`;
                const isTvOff = block.schedule.system_action === 'display_off';

                return (
                  <button
                    type="button"
                    key={`${block.schedule.id}-${bIdx}`}
                    onClick={() => onEdit?.(block.schedule)}
                    className={`absolute z-10 rounded-md border px-1.5 py-1 overflow-hidden text-left
                      hover:brightness-125 transition-all ${isTvOff ? 'bg-zinc-950/90 border-zinc-500/70 text-amber-200' : block.color}
                      ${!block.schedule.is_active ? 'opacity-50 border-dashed' : ''}`}
                    style={{ top: `${top}%`, height: `${height}%`, left, width, minHeight: '22px' }}
                    title={`${block.schedule.name}\n${block.schedule.playlist_name}\n${block.schedule.start_time || '00:00'} - ${block.schedule.end_time || '24:00'}`}
                  >
                    <div className="flex items-center gap-1 text-[10px] font-semibold truncate leading-tight">
                      {isTvOff && <Moon size={9} />}
                      <span className="truncate">{block.schedule.name}</span>
                    </div>
                    {height > 4 && (
                      <div className="text-[9px] opacity-75 truncate">
                        {isTvOff ? 'TV Off' : block.schedule.playlist_name}
                      </div>
                    )}
                    {height > 6 && (
                      <div className="text-[9px] opacity-60 flex items-center gap-0.5 mt-0.5">
                        <Clock size={7} />
                        {block.schedule.start_time || '00:00'} - {block.schedule.end_time || '24:00'}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {schedules.slice(0, 12).map((schedule) => {
          const targetKey = schedule.device_id ? `device:${schedule.device_id}` : `group:${schedule.group_id || 'none'}`;
          const isTvOff = schedule.system_action === 'display_off';
          return (
            <button
              key={schedule.id}
              onClick={() => onEdit?.(schedule)}
              className={`badge border ${isTvOff ? 'bg-zinc-950/90 border-zinc-500/70 text-amber-200' : targetColorMap.get(targetKey)} ${!schedule.is_active ? 'opacity-50' : ''}`}
            >
              {isTvOff ? 'TV Off' : schedule.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}
