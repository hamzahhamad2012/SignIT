import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import Modal from '../components/Modal';
import EmptyState from '../components/EmptyState';
import ScheduleCalendar from './ScheduleCalendar';
import StatusBadge from '../components/StatusBadge';
import toast from 'react-hot-toast';
import {
  Calendar, Clock, Edit3, FolderOpen, Monitor, Moon, Plus, Power,
  Rocket, Save, Trash2,
} from 'lucide-react';

const DEFAULT_DAYS = '0,1,2,3,4,5,6';
const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const blankGroupForm = { name: '', description: '', color: '#3b82f6', default_playlist_id: '' };
const blankScheduleForm = {
  id: null,
  name: '',
  playlist_id: '',
  start_time: '08:00',
  end_time: '17:00',
  days_of_week: DEFAULT_DAYS,
  priority: 10,
  is_active: true,
};

function isTvOffPlaylist(playlist) {
  return playlist?.system_action === 'display_off' || playlist?.name === 'TV_OFF';
}

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

function getDayLabel(daysOfWeek) {
  const days = normalizeDays(daysOfWeek || DEFAULT_DAYS).split(',').filter(Boolean);
  if (days.length === 7) return 'Every day';
  if (days.join(',') === '1,2,3,4,5') return 'Weekdays';
  if (days.join(',') === '0,6') return 'Weekends';
  return days.map((day) => dayLabels[Number(day)]).join(', ');
}

export default function Groups() {
  const [groups, setGroups] = useState([]);
  const [playlists, setPlaylists] = useState([]);
  const [schedules, setSchedules] = useState([]);
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [selectedGroupId, setSelectedGroupId] = useState(null);
  const [showSchedule, setShowSchedule] = useState(false);
  const [form, setForm] = useState(blankGroupForm);
  const [scheduleForm, setScheduleForm] = useState(blankScheduleForm);

  const fetchGroups = () => {
    setLoading(true);
    Promise.all([
      api.get('/groups'),
      api.get('/playlists'),
      api.get('/schedules'),
      api.get('/devices'),
    ]).then(([g, p, s, d]) => {
      setGroups(g.groups);
      setPlaylists(p.playlists);
      setSchedules(s.schedules);
      setDevices(d.devices);
      setSelectedGroupId((current) => current || g.groups[0]?.id || null);
      setLoading(false);
    }).catch((err) => {
      toast.error(err.message);
      setLoading(false);
    });
  };

  useEffect(() => { fetchGroups(); }, []);

  const selectedGroup = useMemo(
    () => groups.find((group) => String(group.id) === String(selectedGroupId)) || groups[0],
    [groups, selectedGroupId],
  );

  const groupDevices = useMemo(() => (
    selectedGroup ? devices.filter((device) => String(device.group_id || '') === String(selectedGroup.id)) : []
  ), [devices, selectedGroup]);

  const groupSchedules = useMemo(() => (
    selectedGroup ? schedules.filter((schedule) => String(schedule.group_id || '') === String(selectedGroup.id)) : []
  ), [schedules, selectedGroup]);

  const tvOffPlaylist = useMemo(() => playlists.find(isTvOffPlaylist), [playlists]);
  const activeSchedules = groupSchedules.filter((schedule) => schedule.is_active);
  const groupDefaultPlaylist = playlists.find((playlist) => String(playlist.id) === String(selectedGroup?.default_playlist_id || ''));

  const handleCreate = async () => {
    if (!form.name) return toast.error('Name required');
    try {
      const result = await api.post('/groups', {
        ...form,
        default_playlist_id: form.default_playlist_id ? parseInt(form.default_playlist_id, 10) : null,
      });
      toast.success('Group created');
      setShowCreate(false);
      setForm(blankGroupForm);
      setSelectedGroupId(result.group.id);
      fetchGroups();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleUpdate = async (id, updates) => {
    await api.put(`/groups/${id}`, updates);
    setEditingId(null);
    fetchGroups();
    toast.success('Group updated');
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this group? Devices will be unassigned.')) return;
    await api.delete(`/groups/${id}`);
    setSelectedGroupId(null);
    fetchGroups();
    toast.success('Group deleted');
  };

  const handleDefaultPlaylistChange = async (playlistId) => {
    if (!selectedGroup) return;
    await api.put(`/groups/${selectedGroup.id}`, {
      default_playlist_id: playlistId ? parseInt(playlistId, 10) : null,
    });
    toast.success('Group default playlist updated');
    fetchGroups();
  };

  const openScheduleCreate = (playlist = null) => {
    const isTvOff = playlist && isTvOffPlaylist(playlist);
    setScheduleForm({
      ...blankScheduleForm,
      name: isTvOff ? `TV Off - ${selectedGroup.name}` : '',
      playlist_id: playlist ? String(playlist.id) : '',
      start_time: isTvOff ? '22:00' : '08:00',
      end_time: isTvOff ? '06:00' : '17:00',
      priority: isTvOff ? 100 : 10,
    });
    setShowSchedule(true);
  };

  const openScheduleEdit = (schedule) => {
    setScheduleForm({
      id: schedule.id,
      name: schedule.name || '',
      playlist_id: schedule.playlist_id ? String(schedule.playlist_id) : '',
      start_time: schedule.start_time || '08:00',
      end_time: schedule.end_time || '17:00',
      days_of_week: normalizeDays(schedule.days_of_week || DEFAULT_DAYS),
      priority: schedule.priority ?? 10,
      is_active: Boolean(schedule.is_active),
    });
    setShowSchedule(true);
  };

  const closeSchedule = () => {
    setShowSchedule(false);
    setScheduleForm(blankScheduleForm);
  };

  const toggleScheduleDay = (day) => {
    const days = scheduleForm.days_of_week.split(',').filter(Boolean);
    const dayString = String(day);
    const idx = days.indexOf(dayString);

    if (idx >= 0) days.splice(idx, 1);
    else days.push(dayString);

    setScheduleForm((current) => ({ ...current, days_of_week: normalizeDays(days.join(',')) }));
  };

  const handleSaveSchedule = async () => {
    if (!selectedGroup) return;
    if (!scheduleForm.name || !scheduleForm.playlist_id) return toast.error('Name and playlist required');
    if (!scheduleForm.start_time || !scheduleForm.end_time) return toast.error('Start and end time are required');
    if (!normalizeDays(scheduleForm.days_of_week)) return toast.error('Select at least one active day');

    const payload = {
      name: scheduleForm.name,
      playlist_id: Number.parseInt(scheduleForm.playlist_id, 10),
      group_id: selectedGroup.id,
      device_id: null,
      priority: Number.parseInt(scheduleForm.priority, 10) || 0,
      start_time: scheduleForm.start_time,
      end_time: scheduleForm.end_time,
      days_of_week: normalizeDays(scheduleForm.days_of_week),
      is_active: scheduleForm.is_active,
    };

    try {
      if (scheduleForm.id) {
        await api.put(`/schedules/${scheduleForm.id}`, payload);
        toast.success('Group schedule updated');
      } else {
        await api.post('/schedules', payload);
        toast.success('Group schedule created');
      }
      closeSchedule();
      fetchGroups();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const toggleScheduleActive = async (schedule) => {
    await api.put(`/schedules/${schedule.id}`, { is_active: !schedule.is_active });
    toast.success(schedule.is_active ? 'Schedule paused' : 'Schedule activated');
    fetchGroups();
  };

  const handleDeleteSchedule = async (schedule) => {
    if (!confirm(`Delete "${schedule.name}"?`)) return;
    await api.delete(`/schedules/${schedule.id}`);
    toast.success('Schedule deleted');
    fetchGroups();
  };

  const handleDeployNow = async () => {
    if (!selectedGroup || !selectedGroup.default_playlist_id) {
      return toast.error('Set a group default playlist first');
    }

    await api.put(`/groups/${selectedGroup.id}`, {
      default_playlist_id: selectedGroup.default_playlist_id,
    });
    toast.success(`Deploy signal sent to ${groupDevices.length} display${groupDevices.length === 1 ? '' : 's'}`);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-zinc-100">Groups</h1>
          <p className="text-sm text-zinc-500 mt-0.5">Control group playlists, players, and schedule windows from one place.</p>
        </div>
        <button onClick={() => setShowCreate(true)} className="btn-primary">
          <Plus size={15} /> New Group
        </button>
      </div>

      {loading ? (
        <div className="grid lg:grid-cols-[320px_1fr] gap-4">
          <div className="h-96 bg-surface rounded-xl animate-pulse" />
          <div className="h-96 bg-surface rounded-xl animate-pulse" />
        </div>
      ) : groups.length === 0 ? (
        <EmptyState icon={FolderOpen} title="No groups" description="Create groups to organize displays and schedule playlists like piSignage."
          action={<button onClick={() => setShowCreate(true)} className="btn-primary"><Plus size={14} /> Create Group</button>} />
      ) : (
        <div className="grid xl:grid-cols-[340px_1fr] gap-4">
          <aside className="space-y-2">
            {groups.map((group) => {
              const selected = String(group.id) === String(selectedGroup?.id);
              return (
                <button
                  key={group.id}
                  onClick={() => setSelectedGroupId(group.id)}
                  className={`card w-full text-left transition-all ${selected ? 'border-accent/40 bg-accent/5' : 'hover:border-surface-hover'}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ backgroundColor: `${group.color}20` }}>
                        <FolderOpen size={18} style={{ color: group.color }} />
                      </div>
                      <div className="min-w-0">
                        <h3 className="text-sm font-semibold text-zinc-200 truncate">{group.name}</h3>
                        <p className="text-xs text-zinc-500">{group.device_count} display{group.device_count !== 1 && 's'}</p>
                      </div>
                    </div>
                    <span className="badge bg-surface-overlay text-zinc-400">{group.playlist_name || 'No default'}</span>
                  </div>
                </button>
              );
            })}
          </aside>

          {selectedGroup && (
            <section className="space-y-4">
              <div className="card overflow-hidden">
                <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
                  <div className="flex items-start gap-3">
                    <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{ backgroundColor: `${selectedGroup.color}20` }}>
                      <FolderOpen size={22} style={{ color: selectedGroup.color }} />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h2 className="text-xl font-bold text-zinc-100">{selectedGroup.name}</h2>
                        <button
                          onClick={() => {
                            setEditingId(selectedGroup.id);
                            setForm({
                              name: selectedGroup.name,
                              description: selectedGroup.description || '',
                              color: selectedGroup.color,
                              default_playlist_id: selectedGroup.default_playlist_id || '',
                            });
                          }}
                          className="p-1.5 rounded-lg hover:bg-surface-hover text-zinc-500 hover:text-zinc-300"
                        >
                          <Edit3 size={14} />
                        </button>
                        <button onClick={() => handleDelete(selectedGroup.id)}
                          className="p-1.5 rounded-lg hover:bg-red-500/10 text-zinc-500 hover:text-red-400">
                          <Trash2 size={14} />
                        </button>
                      </div>
                      <p className="text-sm text-zinc-500 mt-0.5">
                        {selectedGroup.description || 'Group-level playlist assignment and scheduling.'}
                      </p>
                    </div>
                  </div>

                  <div className="grid sm:grid-cols-3 gap-2 min-w-full lg:min-w-[520px]">
                    <div className="rounded-xl bg-surface-overlay p-3">
                      <p className="text-xs text-zinc-500">Players</p>
                      <p className="text-lg font-semibold text-zinc-100">{groupDevices.length}</p>
                    </div>
                    <div className="rounded-xl bg-surface-overlay p-3">
                      <p className="text-xs text-zinc-500">Active schedules</p>
                      <p className="text-lg font-semibold text-zinc-100">{activeSchedules.length}</p>
                    </div>
                    <div className="rounded-xl bg-surface-overlay p-3">
                      <p className="text-xs text-zinc-500">Default playlist</p>
                      <p className="text-sm font-semibold text-zinc-100 truncate">{groupDefaultPlaylist?.name || 'None'}</p>
                    </div>
                  </div>
                </div>

                <div className="mt-5 grid lg:grid-cols-[1fr_auto] gap-3 items-end border-t border-surface-border pt-4">
                  <div>
                    <label className="block text-xs font-medium text-zinc-400 mb-1.5">Default playlist for this group</label>
                    <select
                      value={selectedGroup.default_playlist_id || ''}
                      onChange={(e) => handleDefaultPlaylistChange(e.target.value)}
                      className="w-full"
                    >
                      <option value="">None</option>
                      {playlists.filter((playlist) => !isTvOffPlaylist(playlist)).map((playlist) => (
                        <option key={playlist.id} value={playlist.id}>{playlist.name}</option>
                      ))}
                    </select>
                    <p className="text-xs text-zinc-600 mt-1">This is the fallback content when no schedule is active.</p>
                  </div>
                  <button onClick={handleDeployNow} className="btn-primary">
                    <Rocket size={15} /> Deploy Now
                  </button>
                </div>
              </div>

              <div className="grid lg:grid-cols-[1.1fr_.9fr] gap-4">
                <div className="card">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <h2 className="text-sm font-semibold text-zinc-200">Group Playlist Schedule</h2>
                      <p className="text-xs text-zinc-500 mt-0.5">Schedule content or TV_OFF for every player in this group.</p>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => openScheduleCreate(tvOffPlaylist)} className="btn-secondary text-xs" disabled={!tvOffPlaylist}>
                        <Moon size={13} /> TV Off
                      </button>
                      <button onClick={() => openScheduleCreate()} className="btn-primary text-xs">
                        <Plus size={13} /> Schedule Playlist
                      </button>
                    </div>
                  </div>

                  {groupSchedules.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-surface-border p-8 text-center">
                      <Calendar size={28} className="mx-auto text-zinc-600 mb-2" />
                      <p className="text-sm text-zinc-400">No group schedules yet</p>
                      <p className="text-xs text-zinc-600 mt-1">Create schedule blocks here instead of hunting through the global scheduler.</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {groupSchedules.map((schedule) => {
                        const isTvOff = schedule.system_action === 'display_off';
                        return (
                          <div key={schedule.id} className={`rounded-xl border border-surface-border bg-surface-overlay p-3 ${!schedule.is_active ? 'opacity-60' : ''}`}>
                            <div className="grid md:grid-cols-[36px_1fr_auto] gap-3 items-center">
                              <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${isTvOff ? 'bg-zinc-950 text-amber-300' : 'bg-accent/15 text-accent'}`}>
                                {isTvOff ? <Moon size={16} /> : <Calendar size={16} />}
                              </div>
                              <div className="min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <p className="text-sm font-semibold text-zinc-200 truncate">{schedule.name}</p>
                                  <span className="badge bg-surface text-zinc-400">priority {schedule.priority}</span>
                                  <span className={`badge ${schedule.is_active ? 'bg-emerald-500/15 text-emerald-400' : 'bg-zinc-500/15 text-zinc-400'}`}>
                                    {schedule.is_active ? 'Active' : 'Paused'}
                                  </span>
                                </div>
                                <p className="text-xs text-zinc-500 mt-0.5">
                                  {isTvOff ? 'TV Off' : schedule.playlist_name} · {getDayLabel(schedule.days_of_week)} · {getScheduleTimeLabel(schedule)}
                                </p>
                              </div>
                              <div className="flex items-center gap-1 justify-end">
                                <button onClick={() => openScheduleEdit(schedule)} className="btn-ghost text-xs p-2">
                                  <Edit3 size={13} />
                                </button>
                                <button onClick={() => toggleScheduleActive(schedule)} className="btn-ghost text-xs p-2">
                                  <Power size={13} className={schedule.is_active ? 'text-emerald-400' : 'text-zinc-500'} />
                                </button>
                                <button onClick={() => handleDeleteSchedule(schedule)} className="btn-ghost text-xs p-2 text-red-400 hover:text-red-300">
                                  <Trash2 size={13} />
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="card">
                  <h2 className="text-sm font-semibold text-zinc-200 mb-3">Players in {selectedGroup.name}</h2>
                  {groupDevices.length === 0 ? (
                    <p className="text-sm text-zinc-500">No players are assigned to this group yet.</p>
                  ) : (
                    <div className="space-y-2">
                      {groupDevices.map((device) => (
                        <Link key={device.id} to={`/devices/${device.id}`} className="block rounded-xl bg-surface-overlay hover:bg-surface-hover p-3 transition-colors">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <Monitor size={14} className="text-zinc-500" />
                                <p className="text-sm font-semibold text-zinc-200 truncate">{device.name}</p>
                              </div>
                              <p className="text-xs text-zinc-500 mt-1">
                                Current: <span className="text-zinc-300">{device.current_playlist_name || 'Waiting for poll'}</span>
                              </p>
                              <p className="text-xs text-zinc-600">
                                Assigned: {device.assigned_playlist_name || 'Uses group default/schedule'}
                              </p>
                            </div>
                            <StatusBadge status={device.status} />
                          </div>
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {groupSchedules.length > 0 && (
                <ScheduleCalendar schedules={groupSchedules} loading={false} onEdit={openScheduleEdit} />
              )}
            </section>
          )}
        </div>
      )}

      <Modal open={showCreate || !!editingId} onClose={() => { setShowCreate(false); setEditingId(null); }}
        title={editingId ? 'Edit Group' : 'Create Group'}>
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1.5">Name</label>
            <input type="text" value={form.name} onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="Lobby Displays" className="w-full" autoFocus />
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1.5">Description</label>
            <textarea value={form.description} onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder="Optional description" className="w-full" rows={2} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1.5">Color</label>
              <input type="color" value={form.color} onChange={(e) => setForm(f => ({ ...f, color: e.target.value }))}
                className="w-full h-9 rounded-lg cursor-pointer" />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1.5">Default Playlist</label>
              <select value={form.default_playlist_id} onChange={(e) => setForm(f => ({ ...f, default_playlist_id: e.target.value }))} className="w-full">
                <option value="">None</option>
                {playlists.filter((playlist) => !isTvOffPlaylist(playlist)).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          </div>
          <div className="flex gap-2 justify-end pt-2">
            <button onClick={() => { setShowCreate(false); setEditingId(null); }} className="btn-secondary">Cancel</button>
            <button onClick={() => editingId
              ? handleUpdate(editingId, { ...form, default_playlist_id: form.default_playlist_id ? parseInt(form.default_playlist_id, 10) : null })
              : handleCreate()
            } className="btn-primary">
              {editingId ? 'Update' : 'Create'}
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={showSchedule} onClose={closeSchedule} title={scheduleForm.id ? 'Edit Group Schedule' : 'Schedule Playlist For Group'}>
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1.5">Name</label>
            <input
              value={scheduleForm.name}
              onChange={(e) => setScheduleForm((current) => ({ ...current, name: e.target.value }))}
              placeholder="Morning menu, TV off overnight..."
              className="w-full"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1.5">Playlist</label>
            <select
              value={scheduleForm.playlist_id}
              onChange={(e) => setScheduleForm((current) => ({ ...current, playlist_id: e.target.value }))}
              className="w-full"
            >
              <option value="">Select playlist...</option>
              {playlists.map((playlist) => (
                <option key={playlist.id} value={playlist.id}>
                  {isTvOffPlaylist(playlist) ? 'TV Off - turn displays off' : playlist.name}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1.5">Start</label>
              <input
                type="time"
                value={scheduleForm.start_time}
                onChange={(e) => setScheduleForm((current) => ({ ...current, start_time: e.target.value }))}
                className="w-full"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1.5">End</label>
              <input
                type="time"
                value={scheduleForm.end_time}
                onChange={(e) => setScheduleForm((current) => ({ ...current, end_time: e.target.value }))}
                className="w-full"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1.5">Active Days</label>
            <div className="flex flex-wrap gap-1.5">
              {dayLabels.map((label, index) => {
                const active = scheduleForm.days_of_week.split(',').includes(String(index));
                return (
                  <button
                    key={label}
                    type="button"
                    onClick={() => toggleScheduleDay(index)}
                    className={`w-10 h-8 rounded-md text-xs font-medium transition-all ${active ? 'bg-accent/20 text-accent' : 'bg-surface-overlay text-zinc-500 hover:text-zinc-300'}`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1.5">Priority</label>
              <input
                type="number"
                value={scheduleForm.priority}
                onChange={(e) => setScheduleForm((current) => ({ ...current, priority: e.target.value }))}
                className="w-full"
              />
            </div>
            <label className="flex items-center gap-2 pt-6 text-sm text-zinc-300">
              <input
                type="checkbox"
                checked={scheduleForm.is_active}
                onChange={(e) => setScheduleForm((current) => ({ ...current, is_active: e.target.checked }))}
              />
              Active
            </label>
          </div>
          <div className="flex gap-2 justify-end pt-2">
            <button onClick={closeSchedule} className="btn-secondary">Cancel</button>
            <button onClick={handleSaveSchedule} className="btn-primary">
              <Save size={14} /> Save Schedule
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
