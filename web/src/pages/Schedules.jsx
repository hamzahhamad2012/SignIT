import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import Modal from '../components/Modal';
import EmptyState from '../components/EmptyState';
import ScheduleCalendar from './ScheduleCalendar';
import toast from 'react-hot-toast';
import { Calendar, Plus, Trash2, Edit3, Power, Clock, Search, Filter, Moon, X } from 'lucide-react';

const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DEFAULT_DAYS = '0,1,2,3,4,5,6';
const BLANK_FORM = {
  name: '',
  playlist_id: '',
  group_id: '',
  device_id: '',
  priority: 0,
  start_date: '',
  end_date: '',
  start_time: '08:00',
  end_time: '17:00',
  days_of_week: DEFAULT_DAYS,
  is_active: true,
  all_day: false,
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

function getScheduleTimeLabel(schedule) {
  if (!schedule.start_time && !schedule.end_time) return 'All day';
  return `${schedule.start_time || '00:00'} - ${schedule.end_time || '24:00'}`;
}

function isTvOffPlaylist(playlist) {
  return playlist?.system_action === 'display_off' || playlist?.name === 'TV_OFF';
}

function toForm(schedule) {
  if (!schedule) return { ...BLANK_FORM };

  const allDay = !schedule.start_time && !schedule.end_time;
  return {
    name: schedule.name || '',
    playlist_id: schedule.playlist_id ? String(schedule.playlist_id) : '',
    group_id: schedule.group_id ? String(schedule.group_id) : '',
    device_id: schedule.device_id || '',
    priority: schedule.priority ?? 0,
    start_date: schedule.start_date || '',
    end_date: schedule.end_date || '',
    start_time: schedule.start_time || BLANK_FORM.start_time,
    end_time: schedule.end_time || BLANK_FORM.end_time,
    days_of_week: normalizeDays(schedule.days_of_week || DEFAULT_DAYS),
    is_active: Boolean(schedule.is_active),
    all_day: allDay,
  };
}

export default function Schedules() {
  const [schedules, setSchedules] = useState([]);
  const [playlists, setPlaylists] = useState([]);
  const [groups, setGroups] = useState([]);
  const [devices, setDevices] = useState([]);
  const [timezone, setTimezone] = useState('server timezone');
  const [loading, setLoading] = useState(true);
  const [modalMode, setModalMode] = useState(null);
  const [editingScheduleId, setEditingScheduleId] = useState(null);
  const [form, setForm] = useState({ ...BLANK_FORM });
  const [filters, setFilters] = useState({
    search: '',
    target: 'all',
    playlist: 'all',
    type: 'all',
    status: 'active',
  });

  const tvOffPlaylist = useMemo(() => playlists.find(isTvOffPlaylist), [playlists]);

  const fetchAll = () => {
    setLoading(true);
    Promise.all([
      api.get('/schedules'),
      api.get('/playlists'),
      api.get('/groups'),
      api.get('/devices'),
      api.get('/health').catch(() => null),
    ]).then(([s, p, g, d, h]) => {
      setSchedules(s.schedules);
      setPlaylists(p.playlists);
      setGroups(g.groups);
      setDevices(d.devices);
      setTimezone(h?.scheduler?.timezone || 'server timezone');
      setLoading(false);
    }).catch((err) => {
      toast.error(err.message);
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

  const openTvOff = () => {
    if (!tvOffPlaylist) {
      toast.error('TV_OFF system playlist has not been created yet. Restart the server once to seed it.');
      return;
    }

    setEditingScheduleId(null);
    setForm({
      ...BLANK_FORM,
      name: 'TV Off',
      playlist_id: String(tvOffPlaylist.id),
      start_time: '22:00',
      end_time: '06:00',
      priority: 100,
      all_day: false,
    });
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
    if (!form.all_day && (!form.start_time || !form.end_time)) {
      return toast.error('Set both start and end time, or mark the schedule as all day');
    }

    const payload = {
      name: form.name,
      playlist_id: Number.parseInt(form.playlist_id, 10),
      group_id: form.group_id ? Number.parseInt(form.group_id, 10) : null,
      device_id: form.device_id || null,
      priority: Number.parseInt(form.priority, 10) || 0,
      start_date: form.start_date || null,
      end_date: form.end_date || null,
      start_time: form.all_day ? null : form.start_time,
      end_time: form.all_day ? null : form.end_time,
      days_of_week: normalizeDays(form.days_of_week),
      is_active: form.is_active,
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

    if (idx >= 0) days.splice(idx, 1);
    else days.push(dayString);

    setForm((current) => ({
      ...current,
      days_of_week: normalizeDays(days.join(',')),
    }));
  };

  const filteredSchedules = useMemo(() => {
    const search = filters.search.trim().toLowerCase();

    return schedules.filter((schedule) => {
      if (filters.status === 'active' && !schedule.is_active) return false;
      if (filters.status === 'paused' && schedule.is_active) return false;

      if (filters.type === 'system' && !schedule.system_action) return false;
      if (filters.type === 'content' && schedule.system_action) return false;
      if (filters.type === 'tv-off' && schedule.system_action !== 'display_off') return false;

      if (filters.playlist !== 'all' && String(schedule.playlist_id) !== filters.playlist) return false;

      if (filters.target !== 'all') {
        const [kind, value] = filters.target.split(':');
        if (kind === 'group' && String(schedule.group_id || '') !== value) return false;
        if (kind === 'device' && String(schedule.device_id || '') !== value) return false;
      }

      if (search) {
        const haystack = [
          schedule.name,
          schedule.playlist_name,
          schedule.group_name,
          schedule.device_name,
        ].filter(Boolean).join(' ').toLowerCase();
        if (!haystack.includes(search)) return false;
      }

      return true;
    });
  }, [filters, schedules]);

  const activeFilterCount = [
    filters.search,
    filters.target !== 'all',
    filters.playlist !== 'all',
    filters.type !== 'all',
    filters.status !== 'active',
  ].filter(Boolean).length;

  const resetFilters = () => setFilters({
    search: '',
    target: 'all',
    playlist: 'all',
    type: 'all',
    status: 'active',
  });

  return (
    <div className="space-y-5">
      <div className="flex flex-col xl:flex-row xl:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-zinc-100">Schedules</h1>
          <p className="text-sm text-zinc-500 mt-0.5">
            Calendar-first scheduling for playlist windows, quiet hours, and per-display overrides.
          </p>
          <p className="text-xs text-zinc-600 mt-1">Times are evaluated in {timezone}.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={openTvOff} className="btn-secondary">
            <Moon size={15} /> TV Off Schedule
          </button>
          <button onClick={openCreate} className="btn-primary">
            <Plus size={15} /> New Schedule
          </button>
        </div>
      </div>

      <div className="card space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-zinc-200">
            <Filter size={15} className="text-accent" />
            Smart filters
            {activeFilterCount > 0 && <span className="badge bg-accent/15 text-accent">{activeFilterCount} active</span>}
          </div>
          {activeFilterCount > 0 && (
            <button onClick={resetFilters} className="btn-ghost text-xs">
              <X size={13} /> Clear
            </button>
          )}
        </div>

        <div className="grid md:grid-cols-2 xl:grid-cols-5 gap-2">
          <label className="relative xl:col-span-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600" />
            <input
              type="search"
              value={filters.search}
              onChange={(e) => setFilters((current) => ({ ...current, search: e.target.value }))}
              placeholder="Search schedules..."
              className="w-full pl-9"
            />
          </label>
          <select
            value={filters.target}
            onChange={(e) => setFilters((current) => ({ ...current, target: e.target.value }))}
            className="w-full"
          >
            <option value="all">All targets</option>
            {groups.length > 0 && <option disabled>Groups</option>}
            {groups.map((group) => <option key={group.id} value={`group:${group.id}`}>{group.name}</option>)}
            {devices.length > 0 && <option disabled>Devices</option>}
            {devices.map((device) => <option key={device.id} value={`device:${device.id}`}>{device.name}</option>)}
          </select>
          <select
            value={filters.playlist}
            onChange={(e) => setFilters((current) => ({ ...current, playlist: e.target.value }))}
            className="w-full"
          >
            <option value="all">All playlists</option>
            {playlists.map((playlist) => (
              <option key={playlist.id} value={playlist.id}>
                {isTvOffPlaylist(playlist) ? 'TV Off' : playlist.name}
              </option>
            ))}
          </select>
          <select
            value={filters.type}
            onChange={(e) => setFilters((current) => ({ ...current, type: e.target.value }))}
            className="w-full"
          >
            <option value="all">All types</option>
            <option value="content">Content schedules</option>
            <option value="system">System schedules</option>
            <option value="tv-off">TV off only</option>
          </select>
          <select
            value={filters.status}
            onChange={(e) => setFilters((current) => ({ ...current, status: e.target.value }))}
            className="w-full"
          >
            <option value="active">Active only</option>
            <option value="all">Active and paused</option>
            <option value="paused">Paused only</option>
          </select>
        </div>
      </div>

      {loading ? (
        <div className="h-96 bg-surface rounded-xl animate-pulse" />
      ) : filteredSchedules.length === 0 ? (
        <EmptyState
          icon={Calendar}
          title="No matching schedules"
          description="Create a schedule or adjust filters to see calendar blocks."
          action={<button onClick={openCreate} className="btn-primary"><Plus size={14} /> Create Schedule</button>}
        />
      ) : (
        <ScheduleCalendar
          schedules={filteredSchedules}
          loading={loading}
          onEdit={openEdit}
        />
      )}

      {!loading && filteredSchedules.length > 0 && (
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-2">
          {filteredSchedules.slice(0, 6).map((schedule) => (
            <div key={schedule.id} className={`card py-3 ${!schedule.is_active ? 'opacity-60' : ''}`}>
              <div className="flex items-start gap-2">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${schedule.system_action === 'display_off' ? 'bg-zinc-900 text-amber-300' : 'bg-accent/15 text-accent'}`}>
                  {schedule.system_action === 'display_off' ? <Moon size={15} /> : <Clock size={15} />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-zinc-200 truncate">{schedule.name}</p>
                    <span className={`badge ${schedule.is_active ? 'bg-emerald-500/15 text-emerald-400' : 'bg-zinc-500/15 text-zinc-400'}`}>
                      {schedule.is_active ? 'Active' : 'Paused'}
                    </span>
                  </div>
                  <p className="text-xs text-zinc-500 truncate">
                    {schedule.system_action === 'display_off' ? 'TV Off' : schedule.playlist_name} · {schedule.group_name || schedule.device_name}
                  </p>
                  <p className="text-xs text-zinc-600 mt-1">{getScheduleTimeLabel(schedule)}</p>
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => openEdit(schedule)} className="btn-ghost text-xs p-2">
                    <Edit3 size={13} />
                  </button>
                  <button onClick={() => toggleActive(schedule)} className="btn-ghost text-xs p-2">
                    <Power size={13} className={schedule.is_active ? 'text-emerald-400' : 'text-zinc-500'} />
                  </button>
                  <button onClick={() => handleDelete(schedule.id)} className="btn-ghost text-xs p-2 text-red-400 hover:text-red-300">
                    <Trash2 size={13} />
                  </button>
                </div>
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
              {playlists.map((playlist) => (
                <option key={playlist.id} value={playlist.id}>
                  {isTvOffPlaylist(playlist) ? 'TV Off - turn display off' : playlist.name}
                </option>
              ))}
            </select>
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
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
          <label className="flex items-center gap-2 text-sm text-zinc-300">
            <input
              type="checkbox"
              checked={form.all_day}
              onChange={(e) => setForm((current) => ({ ...current, all_day: e.target.checked }))}
            />
            All day schedule
          </label>
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1.5">Start Time</label>
              <input
                type="time"
                value={form.start_time}
                disabled={form.all_day}
                onChange={(e) => setForm((current) => ({ ...current, start_time: e.target.value }))}
                className="w-full disabled:opacity-50"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1.5">End Time</label>
              <input
                type="time"
                value={form.end_time}
                disabled={form.all_day}
                onChange={(e) => setForm((current) => ({ ...current, end_time: e.target.value }))}
                className="w-full disabled:opacity-50"
              />
            </div>
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
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
            <div className="flex flex-wrap gap-1.5">
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
            <label className="block text-xs font-medium text-zinc-400 mb-1.5">Priority</label>
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
