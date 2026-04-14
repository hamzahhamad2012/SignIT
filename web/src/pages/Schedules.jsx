import { useEffect, useState } from 'react';
import { api } from '../api/client';
import Modal from '../components/Modal';
import EmptyState from '../components/EmptyState';
import ScheduleCalendar from './ScheduleCalendar';
import toast from 'react-hot-toast';
import { Calendar, Plus, Trash2, Edit3, Power, Clock, CalendarDays, List } from 'lucide-react';

const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const BLANK_FORM = {
  name: '',
  playlist_id: '',
  group_id: '',
  device_id: '',
  priority: 0,
  start_date: '',
  end_date: '',
  start_time: '',
  end_time: '',
  days_of_week: '0,1,2,3,4,5,6',
  is_active: true,
};

function normalizeDays(daysOfWeek) {
  const days = (daysOfWeek || '')
    .split(',')
    .map((day) => day.trim())
    .filter(Boolean);

  return [...new Set(days)]
    .sort((left, right) => Number(left) - Number(right))
    .join(',');
}

function toForm(schedule) {
  if (!schedule) return { ...BLANK_FORM };

  return {
    name: schedule.name || '',
    playlist_id: schedule.playlist_id ? String(schedule.playlist_id) : '',
    group_id: schedule.group_id ? String(schedule.group_id) : '',
    device_id: schedule.device_id || '',
    priority: schedule.priority ?? 0,
    start_date: schedule.start_date || '',
    end_date: schedule.end_date || '',
    start_time: schedule.start_time || '',
    end_time: schedule.end_time || '',
    days_of_week: normalizeDays(schedule.days_of_week || BLANK_FORM.days_of_week),
    is_active: Boolean(schedule.is_active),
  };
}

function isOvernight(schedule) {
  return Boolean(schedule.start_time && schedule.end_time && schedule.start_time > schedule.end_time);
}

export default function Schedules() {
  const [schedules, setSchedules] = useState([]);
  const [playlists, setPlaylists] = useState([]);
  const [groups, setGroups] = useState([]);
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalMode, setModalMode] = useState(null);
  const [editingScheduleId, setEditingScheduleId] = useState(null);
  const [view, setView] = useState('list');
  const [form, setForm] = useState({ ...BLANK_FORM });

  const fetchAll = () => {
    Promise.all([
      api.get('/schedules'),
      api.get('/playlists'),
      api.get('/groups'),
      api.get('/devices'),
    ]).then(([s, p, g, d]) => {
      setSchedules(s.schedules);
      setPlaylists(p.playlists);
      setGroups(g.groups);
      setDevices(d.devices);
      setLoading(false);
    });
  };

  useEffect(() => {
    fetchAll();
  }, []);

  const closeModal = () => {
    setModalMode(null);
    setEditingScheduleId(null);
    setForm({ ...BLANK_FORM });
  };

  const openCreate = () => {
    setEditingScheduleId(null);
    setForm({ ...BLANK_FORM });
    setModalMode('create');
  };

  const openEdit = (schedule) => {
    setEditingScheduleId(schedule.id);
    setForm(toForm(schedule));
    setModalMode('edit');
  };

  const handleSave = async () => {
    if (!form.name || !form.playlist_id) return toast.error('Name and playlist required');
    if (!form.group_id && !form.device_id) return toast.error('Select a group or device');
    if (!normalizeDays(form.days_of_week)) return toast.error('Select at least one active day');

    const payload = {
      ...form,
      playlist_id: Number.parseInt(form.playlist_id, 10),
      group_id: form.group_id ? Number.parseInt(form.group_id, 10) : null,
      device_id: form.device_id || null,
      priority: Number.parseInt(form.priority, 10) || 0,
      days_of_week: normalizeDays(form.days_of_week),
    };

    try {
      if (editingScheduleId) {
        await api.put(`/schedules/${editingScheduleId}`, payload);
        toast.success('Schedule updated');
      } else {
        await api.post('/schedules', payload);
        toast.success('Schedule created');
      }

      closeModal();
      fetchAll();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const toggleActive = async (schedule) => {
    await api.put(`/schedules/${schedule.id}`, { is_active: !schedule.is_active });
    fetchAll();
    toast.success(schedule.is_active ? 'Schedule paused' : 'Schedule activated');
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this schedule?')) return;
    await api.delete(`/schedules/${id}`);
    fetchAll();
    toast.success('Schedule deleted');
  };

  const toggleDay = (day) => {
    const days = form.days_of_week.split(',').filter(Boolean);
    const dayString = String(day);
    const idx = days.indexOf(dayString);

    if (idx >= 0) {
      days.splice(idx, 1);
    } else {
      days.push(dayString);
    }

    setForm((current) => ({
      ...current,
      days_of_week: normalizeDays(days.join(',')),
    }));
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-zinc-100">Schedules</h1>
          <p className="text-sm text-zinc-500 mt-0.5">Automate content delivery to displays</p>
        </div>
        <div className="flex gap-2">
          <div className="flex rounded-lg border border-surface-border overflow-hidden">
            <button
              onClick={() => setView('list')}
              className={`px-3 py-1.5 text-xs flex items-center gap-1.5 transition-colors ${view === 'list' ? 'bg-accent/15 text-accent' : 'text-zinc-400 hover:text-zinc-200'}`}
            >
              <List size={14} /> List
            </button>
            <button
              onClick={() => setView('calendar')}
              className={`px-3 py-1.5 text-xs flex items-center gap-1.5 transition-colors ${view === 'calendar' ? 'bg-accent/15 text-accent' : 'text-zinc-400 hover:text-zinc-200'}`}
            >
              <CalendarDays size={14} /> Calendar
            </button>
          </div>
          <button onClick={openCreate} className="btn-primary">
            <Plus size={15} /> New Schedule
          </button>
        </div>
      </div>

      {view === 'calendar' ? (
        <ScheduleCalendar />
      ) : loading ? (
        <div className="space-y-2">
          {Array(4).fill(0).map((_, i) => <div key={i} className="h-20 bg-surface rounded-xl animate-pulse" />)}
        </div>
      ) : schedules.length === 0 ? (
        <EmptyState
          icon={Calendar}
          title="No schedules"
          description="Create schedules to automatically deploy playlists at specific times."
          action={<button onClick={openCreate} className="btn-primary"><Plus size={14} /> Create Schedule</button>}
        />
      ) : (
        <div className="space-y-2">
          {schedules.map((schedule) => (
            <div
              key={schedule.id}
              className={`card flex flex-col sm:flex-row sm:items-center gap-3 ${!schedule.is_active ? 'opacity-50' : ''}`}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <h3 className="text-sm font-semibold text-zinc-200">{schedule.name}</h3>
                  <span className={`badge ${schedule.is_active ? 'bg-emerald-500/15 text-emerald-400' : 'bg-zinc-500/15 text-zinc-400'}`}>
                    {schedule.is_active ? 'Active' : 'Paused'}
                  </span>
                  <span className="badge bg-accent/15 text-accent">Priority {schedule.priority}</span>
                  {isOvernight(schedule) && (
                    <span className="badge bg-amber-500/15 text-amber-300">Overnight</span>
                  )}
                </div>
                <div className="flex items-center gap-3 text-xs text-zinc-500 flex-wrap">
                  <span>Playlist: <span className="text-zinc-300">{schedule.playlist_name}</span></span>
                  {schedule.group_name && <span>Group: <span className="text-zinc-300">{schedule.group_name}</span></span>}
                  {schedule.device_name && <span>Device: <span className="text-zinc-300">{schedule.device_name}</span></span>}
                  {(schedule.start_time || schedule.end_time) && (
                    <span className="flex items-center gap-1">
                      <Clock size={10} />
                      {schedule.start_time || '00:00'} - {schedule.end_time || '24:00'}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3 text-xs text-zinc-600 mt-1.5 flex-wrap">
                  {(schedule.start_date || schedule.end_date) && (
                    <span>
                      {schedule.start_date || 'Any date'} to {schedule.end_date || 'ongoing'}
                    </span>
                  )}
                </div>
                <div className="flex gap-1 mt-2">
                  {dayLabels.map((label, i) => {
                    const active = schedule.days_of_week.split(',').includes(i.toString());
                    return (
                      <span
                        key={i}
                        className={`w-7 h-5 rounded text-[10px] font-medium flex items-center justify-center ${active ? 'bg-accent/15 text-accent' : 'bg-surface-overlay text-zinc-600'}`}
                      >
                        {label}
                      </span>
                    );
                  })}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button onClick={() => openEdit(schedule)} className="btn-ghost text-xs p-2">
                  <Edit3 size={14} />
                </button>
                <button onClick={() => toggleActive(schedule)} className="btn-ghost text-xs p-2">
                  <Power size={14} className={schedule.is_active ? 'text-emerald-400' : 'text-zinc-500'} />
                </button>
                <button onClick={() => handleDelete(schedule.id)} className="btn-ghost text-xs p-2 text-red-400 hover:text-red-300">
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal
        open={Boolean(modalMode)}
        onClose={closeModal}
        title={editingScheduleId ? 'Edit Schedule' : 'Create Schedule'}
      >
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1.5">Name</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm((current) => ({ ...current, name: e.target.value }))}
              placeholder="Morning content"
              className="w-full"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1.5">Playlist</label>
            <select
              value={form.playlist_id}
              onChange={(e) => setForm((current) => ({ ...current, playlist_id: e.target.value }))}
              className="w-full"
            >
              <option value="">Select playlist...</option>
              {playlists.map((playlist) => <option key={playlist.id} value={playlist.id}>{playlist.name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1.5">Target Group</label>
              <select
                value={form.group_id}
                onChange={(e) => setForm((current) => ({ ...current, group_id: e.target.value, device_id: '' }))}
                className="w-full"
              >
                <option value="">None</option>
                {groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1.5">Or Target Device</label>
              <select
                value={form.device_id}
                onChange={(e) => setForm((current) => ({ ...current, device_id: e.target.value, group_id: '' }))}
                className="w-full"
              >
                <option value="">None</option>
                {devices.map((device) => <option key={device.id} value={device.id}>{device.name}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1.5">Start Time</label>
              <input
                type="time"
                value={form.start_time}
                onChange={(e) => setForm((current) => ({ ...current, start_time: e.target.value }))}
                className="w-full"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1.5">End Time</label>
              <input
                type="time"
                value={form.end_time}
                onChange={(e) => setForm((current) => ({ ...current, end_time: e.target.value }))}
                className="w-full"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1.5">Start Date</label>
              <input
                type="date"
                value={form.start_date}
                onChange={(e) => setForm((current) => ({ ...current, start_date: e.target.value }))}
                className="w-full"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1.5">End Date</label>
              <input
                type="date"
                value={form.end_date}
                onChange={(e) => setForm((current) => ({ ...current, end_date: e.target.value }))}
                className="w-full"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1.5">Active Days</label>
            <div className="flex gap-1.5">
              {dayLabels.map((label, i) => {
                const active = form.days_of_week.split(',').includes(i.toString());
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => toggleDay(i)}
                    className={`w-10 h-8 rounded-lg text-xs font-medium transition-all ${active ? 'bg-accent text-white' : 'bg-surface-overlay text-zinc-500 hover:text-zinc-300'}`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1.5">Priority (higher = takes precedence)</label>
            <input
              type="number"
              value={form.priority}
              onChange={(e) => setForm((current) => ({ ...current, priority: e.target.value }))}
              className="w-full"
              min={0}
              max={100}
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-zinc-300">
            <input
              type="checkbox"
              checked={form.is_active}
              onChange={(e) => setForm((current) => ({ ...current, is_active: e.target.checked }))}
            />
            Schedule is active
          </label>
          <div className="flex gap-2 justify-end pt-2">
            <button onClick={closeModal} className="btn-secondary">Cancel</button>
            <button onClick={handleSave} className="btn-primary">{editingScheduleId ? 'Save Changes' : 'Create'}</button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
