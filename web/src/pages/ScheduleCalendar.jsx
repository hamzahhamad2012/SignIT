import { useEffect, useState, useMemo } from 'react';
import { api } from '../api/client';
import { ChevronLeft, ChevronRight, Calendar, Clock } from 'lucide-react';

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const COLORS = [
  'bg-accent/30 border-accent/50 text-accent',
  'bg-emerald-500/30 border-emerald-500/50 text-emerald-300',
  'bg-amber-500/30 border-amber-500/50 text-amber-300',
  'bg-pink-500/30 border-pink-500/50 text-pink-300',
  'bg-cyan-500/30 border-cyan-500/50 text-cyan-300',
  'bg-violet-500/30 border-violet-500/50 text-violet-300',
  'bg-rose-500/30 border-rose-500/50 text-rose-300',
  'bg-teal-500/30 border-teal-500/50 text-teal-300',
];

function getWeekDates(offset = 0) {
  const now = new Date();
  const start = new Date(now);
  start.setDate(now.getDate() - now.getDay() + offset * 7);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
}

function timeToHour(time) {
  if (!time) return null;
  const [h, m] = time.split(':').map(Number);
  return h + m / 60;
}

function shiftDate(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export default function ScheduleCalendar() {
  const [schedules, setSchedules] = useState([]);
  const [weekOffset, setWeekOffset] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/schedules').then(d => { setSchedules(d.schedules); setLoading(false); });
  }, []);

  const weekDates = useMemo(() => getWeekDates(weekOffset), [weekOffset]);

  const weekLabel = useMemo(() => {
    const start = weekDates[0];
    const end = weekDates[6];
    const opts = { month: 'short', day: 'numeric' };
    return `${start.toLocaleDateString('en-US', opts)} — ${end.toLocaleDateString('en-US', opts)}, ${end.getFullYear()}`;
  }, [weekDates]);

  const scheduleBlocks = useMemo(() => {
    const blocks = [];
    schedules.forEach((schedule, scheduleIndex) => {
      if (!schedule.is_active) return;
      const activeDays = schedule.days_of_week.split(',').map(Number);
      const color = COLORS[scheduleIndex % COLORS.length];
      const startHour = timeToHour(schedule.start_time) ?? 0;
      const endHour = timeToHour(schedule.end_time) ?? 24;
      const hasStart = Boolean(schedule.start_time);
      const hasEnd = Boolean(schedule.end_time);
      const allDayTimed = hasStart && hasEnd && schedule.start_time === schedule.end_time;
      const overnight = hasStart && hasEnd && schedule.start_time > schedule.end_time;

      weekDates.forEach((date, dayIdx) => {
        if (!activeDays.includes(dayIdx)) return;

        const dateStr = date.toISOString().split('T')[0];
        if (schedule.start_date && dateStr < schedule.start_date) return;
        if (schedule.end_date && dateStr > schedule.end_date) return;

        if (!hasStart && !hasEnd) {
          blocks.push({ schedule, dayIdx, startH: 0, endH: 24, color });
          return;
        }

        if (allDayTimed) {
          blocks.push({ schedule, dayIdx, startH: 0, endH: 24, color });
          return;
        }

        if (hasStart && !hasEnd) {
          blocks.push({ schedule, dayIdx, startH: startHour, endH: 24, color });
          return;
        }

        if (!hasStart && hasEnd) {
          blocks.push({ schedule, dayIdx, startH: 0, endH: endHour, color });
          return;
        }

        if (!overnight) {
          blocks.push({ schedule, dayIdx, startH: startHour, endH: endHour, color });
          return;
        }

        blocks.push({ schedule, dayIdx, startH: startHour, endH: 24, color });

        const nextDay = shiftDate(date, 1).toISOString().split('T')[0];
        if (dayIdx < 6 && (!schedule.end_date || dateStr <= schedule.end_date) && (!schedule.start_date || dateStr >= schedule.start_date)) {
          blocks.push({
            schedule,
            dayIdx: dayIdx + 1,
            startH: 0,
            endH: endHour,
            color,
            spilloverFrom: nextDay,
          });
        }
      });
    });
    return blocks;
  }, [schedules, weekDates]);

  const isToday = (date) => {
    const today = new Date();
    return date.getDate() === today.getDate() &&
      date.getMonth() === today.getMonth() &&
      date.getFullYear() === today.getFullYear();
  };

  const nowHour = new Date().getHours() + new Date().getMinutes() / 60;

  if (loading) {
    return <div className="h-96 bg-surface rounded-xl animate-pulse" />;
  }

  return (
    <div className="space-y-4">
      {/* Week nav */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Calendar size={18} className="text-accent" />
          <h2 className="text-lg font-semibold text-zinc-200">{weekLabel}</h2>
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

      {/* Calendar grid */}
      <div className="card p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <div className="min-w-[800px]">
            {/* Day headers */}
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

            {/* Time rows */}
            <div className="relative" style={{ height: '720px' }}>
              {/* Hour lines */}
              {HOURS.map(h => (
                <div key={h} className="absolute w-full flex" style={{ top: `${(h / 24) * 100}%`, height: `${(1 / 24) * 100}%` }}>
                  <div className="w-[60px] pr-2 text-right text-[10px] text-zinc-600 -mt-1.5 shrink-0">
                    {h === 0 ? '' : `${h % 12 || 12}${h < 12 ? 'a' : 'p'}`}
                  </div>
                  <div className="flex-1 border-t border-surface-border/50" />
                </div>
              ))}

              {/* Day columns */}
              <div className="absolute left-[60px] right-0 top-0 bottom-0 grid grid-cols-7">
                {Array(7).fill(0).map((_, i) => (
                  <div key={i} className={`border-l border-surface-border/50 ${isToday(weekDates[i]) ? 'bg-accent/[0.02]' : ''}`} />
                ))}
              </div>

              {/* Now line */}
              {weekOffset === 0 && (
                <div className="absolute left-[60px] right-0 z-20 flex items-center pointer-events-none"
                  style={{ top: `${(nowHour / 24) * 100}%` }}>
                  <div className="w-2 h-2 rounded-full bg-red-500 -ml-1" />
                  <div className="flex-1 h-px bg-red-500/60" />
                </div>
              )}

              {/* Schedule blocks */}
              {scheduleBlocks.map((block, bIdx) => {
                const top = (block.startH / 24) * 100;
                const height = ((block.endH - block.startH) / 24) * 100;
                const left = `calc(60px + ${(block.dayIdx / 7)} * (100% - 60px) + 2px)`;
                const width = `calc((100% - 60px) / 7 - 4px)`;

                return (
                  <div key={bIdx}
                    className={`absolute z-10 rounded-md border px-1.5 py-1 overflow-hidden cursor-pointer
                      hover:brightness-125 transition-all ${block.color}`}
                    style={{ top: `${top}%`, height: `${height}%`, left, width, minHeight: '20px' }}
                    title={`${block.schedule.name}\n${block.schedule.playlist_name}\n${block.schedule.start_time || '00:00'} - ${block.schedule.end_time || '24:00'}`}
                  >
                    <div className="text-[10px] font-semibold truncate leading-tight">
                      {block.schedule.name}
                    </div>
                    {height > 4 && (
                      <div className="text-[9px] opacity-70 truncate">
                        {block.schedule.playlist_name}
                      </div>
                    )}
                    {height > 6 && (
                      <div className="text-[9px] opacity-50 flex items-center gap-0.5 mt-0.5">
                        <Clock size={7} />
                        {block.schedule.start_time || '00:00'} - {block.schedule.end_time || '24:00'}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Legend */}
      {schedules.filter(s => s.is_active).length > 0 && (
        <div className="flex flex-wrap gap-2">
          {schedules.filter(s => s.is_active).map((s, i) => (
            <span key={s.id} className={`badge border ${COLORS[i % COLORS.length]}`}>
              {s.name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
