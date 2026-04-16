import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import Modal from '../components/Modal';
import {
  Users as UsersIcon, RefreshCw, Save, ShieldCheck, Clock3, Ban, Monitor, Activity, Filter,
} from 'lucide-react';

const statusStyles = {
  pending: 'bg-amber-500/10 text-amber-400 border border-amber-500/20',
  active: 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20',
  disabled: 'bg-red-500/10 text-red-400 border border-red-500/20',
};

const categoryLabels = {
  auth: 'Login & Auth',
  users: 'Users',
  assets: 'Assets',
  playlists: 'Playlists',
  schedules: 'Schedules',
  devices: 'Devices',
  groups: 'Groups',
  widgets: 'Widgets',
  templates: 'Templates',
  walls: 'Display Walls',
  setup: 'Setup',
  system: 'System',
};

function titleize(value = '') {
  return String(value || '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatCategory(category) {
  return categoryLabels[category] || titleize(category);
}

function formatDetailValue(value) {
  if (Array.isArray(value)) {
    if (value.length === 0) return 'none';
    const visible = value.slice(0, 3).join(', ');
    return value.length > 3 ? `${visible} +${value.length - 3} more` : visible;
  }

  if (value && typeof value === 'object') {
    return JSON.stringify(value);
  }

  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  return String(value);
}

function activityDetails(details = {}) {
  const hidden = new Set(['user_agent']);
  return Object.entries(details)
    .filter(([key, value]) => !hidden.has(key) && value !== null && value !== undefined && value !== '')
    .slice(0, 5);
}

export default function Users() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState([]);
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState(null);
  const [activityUser, setActivityUser] = useState(null);
  const [activityData, setActivityData] = useState({ activities: [], categories: [], actions: [], total: 0, retention_days: 90 });
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityCategory, setActivityCategory] = useState('');
  const [activityAction, setActivityAction] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const [usersData, devicesData] = await Promise.all([
        api.get('/users'),
        api.get('/devices'),
      ]);
      setUsers(usersData.users);
      setDevices(devicesData.devices);
    } catch (err) {
      toast.error(err.message || 'Could not load users');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (!activityUser?.id) return undefined;

    let cancelled = false;

    async function loadActivity() {
      setActivityLoading(true);
      try {
        const params = new URLSearchParams({ limit: '100' });
        if (activityCategory) params.set('category', activityCategory);
        if (activityAction) params.set('action', activityAction);

        const data = await api.get(`/users/${activityUser.id}/activity?${params.toString()}`);
        if (!cancelled) setActivityData(data);
      } catch (err) {
        if (!cancelled) toast.error(err.message || 'Could not load activity');
      } finally {
        if (!cancelled) setActivityLoading(false);
      }
    }

    loadActivity();
    return () => { cancelled = true; };
  }, [activityUser?.id, activityCategory, activityAction]);

  const updateUserDraft = (userId, field, value) => {
    setUsers((current) => current.map((entry) => (
      entry.id === userId ? { ...entry, [field]: value } : entry
    )));
  };

  const toggleDevice = (userId, deviceId) => {
    setUsers((current) => current.map((entry) => {
      if (entry.id !== userId) return entry;
      const deviceIds = new Set(entry.device_ids || []);
      if (deviceIds.has(deviceId)) deviceIds.delete(deviceId);
      else deviceIds.add(deviceId);
      return { ...entry, device_ids: [...deviceIds] };
    }));
  };

  const saveUser = async (entry, overrides = {}) => {
    setSavingId(entry.id);
    try {
      const payload = {
        name: entry.name,
        email: entry.email,
        role: entry.role,
        status: entry.status,
        device_ids: entry.device_ids || [],
        ...overrides,
      };

      const result = await api.put(`/users/${entry.id}`, payload);
      setUsers((current) => current.map((candidate) => (
        candidate.id === entry.id ? result.user : candidate
      )));
      toast.success(overrides.status === 'active' && entry.status === 'pending'
        ? 'User approved'
        : 'User updated');
    } catch (err) {
      toast.error(err.message || 'Could not update user');
      load();
    } finally {
      setSavingId(null);
    }
  };

  const openActivity = (entry) => {
    setActivityUser(entry);
    setActivityData({ activities: [], categories: [], actions: [], total: 0, retention_days: 90 });
    setActivityCategory('');
    setActivityAction('');
  };

  const closeActivity = () => {
    setActivityUser(null);
    setActivityCategory('');
    setActivityAction('');
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <div>
          <div className="h-8 w-36 bg-surface rounded-lg animate-pulse" />
          <div className="h-4 w-72 bg-surface rounded-lg mt-2 animate-pulse" />
        </div>
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="h-64 bg-surface rounded-xl animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  const pendingCount = users.filter((entry) => entry.status === 'pending').length;

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-zinc-100">Users</h1>
          <p className="text-sm text-zinc-500 mt-0.5">
            Approve new accounts and assign which displays each viewer can access.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {pendingCount > 0 && (
            <span className="badge bg-amber-500/15 text-amber-400">
              <Clock3 size={12} /> {pendingCount} pending
            </span>
          )}
          <button onClick={load} className="btn-secondary">
            <RefreshCw size={15} /> Refresh
          </button>
        </div>
      </div>

      {users.length === 0 ? (
        <div className="card text-center py-12">
          <UsersIcon size={28} className="mx-auto text-zinc-600 mb-3" />
          <h2 className="text-sm font-semibold text-zinc-200">No users yet</h2>
          <p className="text-sm text-zinc-500 mt-1">New access requests will appear here.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {users.map((entry) => {
            const isCurrentUser = currentUser?.id === entry.id;
            const canApprove = entry.status === 'pending';

            return (
              <div key={entry.id} className="card space-y-4">
                <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <h2 className="text-lg font-semibold text-zinc-100">{entry.name}</h2>
                      {isCurrentUser && <span className="badge bg-accent/15 text-accent">You</span>}
                      <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium ${statusStyles[entry.status] || statusStyles.pending}`}>
                        {entry.status === 'active' ? <ShieldCheck size={12} /> : entry.status === 'disabled' ? <Ban size={12} /> : <Clock3 size={12} />}
                        {entry.status}
                      </span>
                    </div>
                    <p className="text-sm text-zinc-500 mt-1">{entry.email}</p>
                    <p className="text-xs text-zinc-600 mt-1">
                      Requested {new Date(entry.created_at).toLocaleString()}
                      {entry.approved_at ? ` • Approved ${new Date(entry.approved_at).toLocaleString()}` : ''}
                      {entry.approved_by_name ? ` by ${entry.approved_by_name}` : ''}
                    </p>
                  </div>

                  <div className="flex gap-2">
                    {canApprove && (
                      <button
                        onClick={() => saveUser(entry, { status: 'active' })}
                        disabled={savingId === entry.id}
                        className="btn-primary"
                      >
                        <ShieldCheck size={15} /> Approve
                      </button>
                    )}
                    <button onClick={() => openActivity(entry)} className="btn-secondary">
                      <Activity size={15} /> Activity
                    </button>
                    <button
                      onClick={() => saveUser(entry)}
                      disabled={savingId === entry.id}
                      className="btn-secondary"
                    >
                      <Save size={15} /> {savingId === entry.id ? 'Saving...' : 'Save'}
                    </button>
                  </div>
                </div>

                <div className="grid lg:grid-cols-3 gap-4">
                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs font-medium text-zinc-400 mb-1.5">Name</label>
                      <input
                        type="text"
                        value={entry.name}
                        onChange={(e) => updateUserDraft(entry.id, 'name', e.target.value)}
                        className="w-full"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-zinc-400 mb-1.5">Email</label>
                      <input
                        type="email"
                        value={entry.email}
                        onChange={(e) => updateUserDraft(entry.id, 'email', e.target.value)}
                        className="w-full"
                      />
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs font-medium text-zinc-400 mb-1.5">Role</label>
                      <select
                        value={entry.role}
                        onChange={(e) => updateUserDraft(entry.id, 'role', e.target.value)}
                        className="w-full"
                      >
                        <option value="viewer">Viewer</option>
                        <option value="editor">Editor</option>
                        <option value="admin">Admin</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-zinc-400 mb-1.5">Status</label>
                      <select
                        value={entry.status}
                        onChange={(e) => updateUserDraft(entry.id, 'status', e.target.value)}
                        className="w-full"
                        disabled={isCurrentUser}
                      >
                        <option value="pending">Pending</option>
                        <option value="active">Active</option>
                        <option value="disabled">Disabled</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <Monitor size={14} className="text-accent" />
                      <h3 className="text-sm font-semibold text-zinc-200">Display Access</h3>
                    </div>
                    <p className="text-xs text-zinc-500 mb-3">
                      Viewer accounts only see the displays checked here.
                    </p>

                    <div className="max-h-48 overflow-y-auto space-y-1.5 rounded-lg border border-surface-border bg-surface-overlay p-2">
                      {devices.length === 0 ? (
                        <p className="text-xs text-zinc-600 p-2">No displays registered yet.</p>
                      ) : (
                        devices.map((device) => (
                          <label key={device.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-surface-hover text-sm text-zinc-300">
                            <input
                              type="checkbox"
                              checked={(entry.device_ids || []).includes(device.id)}
                              onChange={() => toggleDevice(entry.id, device.id)}
                            />
                            <span className="flex-1 truncate">{device.name}</span>
                            <span className="text-[11px] text-zinc-500 font-mono">{device.id}</span>
                          </label>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
      <Modal
        open={!!activityUser}
        onClose={closeActivity}
        title={activityUser ? `${activityUser.name} Activity` : 'User Activity'}
        wide
      >
        <div className="space-y-5">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            <div>
              <p className="text-sm text-zinc-400">
                Login history and key dashboard changes for {activityUser?.email}.
              </p>
              <p className="text-xs text-zinc-600 mt-1">
                Activity is automatically kept for {activityData.retention_days || 90} days.
              </p>
            </div>
            <span className="badge bg-surface-overlay text-zinc-400">
              {activityData.total || 0} matching events
            </span>
          </div>

          <div className="grid md:grid-cols-2 gap-3 rounded-xl border border-surface-border bg-surface-overlay p-3">
            <div>
              <label className="flex items-center gap-1.5 text-xs font-medium text-zinc-400 mb-1.5">
                <Filter size={13} /> Category
              </label>
              <select
                value={activityCategory}
                onChange={(e) => {
                  setActivityCategory(e.target.value);
                  setActivityAction('');
                }}
                className="w-full"
              >
                <option value="">All activity</option>
                {(activityData.categories || []).map((category) => (
                  <option key={category.category || 'system'} value={category.category || 'system'}>
                    {formatCategory(category.category || 'system')} ({category.count})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1.5">Action</label>
              <select
                value={activityAction}
                onChange={(e) => setActivityAction(e.target.value)}
                className="w-full"
              >
                <option value="">All actions</option>
                {(activityData.actions || [])
                  .filter((action) => !activityCategory || action.category === activityCategory)
                  .map((action) => (
                    <option key={`${action.category}-${action.action}`} value={action.action}>
                      {titleize(action.action)} ({action.count})
                    </option>
                  ))}
              </select>
            </div>
          </div>

          {activityLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="h-20 rounded-xl bg-surface-overlay animate-pulse" />
              ))}
            </div>
          ) : activityData.activities?.length ? (
            <div className="space-y-2">
              {activityData.activities.map((event) => {
                const details = activityDetails(event.details);
                return (
                  <div key={event.id} className="rounded-xl border border-surface-border bg-surface-overlay p-3">
                    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-semibold text-zinc-100">{titleize(event.action)}</span>
                          <span className="badge bg-accent/10 text-accent">{formatCategory(event.category)}</span>
                        </div>
                        <p className="text-xs text-zinc-500 mt-1">
                          {new Date(event.created_at).toLocaleString()}
                          {event.device_name ? ` • ${event.device_name}` : ''}
                        </p>
                      </div>
                    </div>

                    {details.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-3">
                        {details.map(([key, value]) => (
                          <span key={key} className="text-[11px] rounded-md bg-black/20 border border-surface-border px-2 py-1 text-zinc-400">
                            <span className="text-zinc-500">{titleize(key)}:</span> {formatDetailValue(value)}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-center py-10 rounded-xl border border-surface-border bg-surface-overlay">
              <Activity size={24} className="mx-auto text-zinc-600 mb-2" />
              <h3 className="text-sm font-semibold text-zinc-200">No activity found</h3>
              <p className="text-sm text-zinc-500 mt-1">Try clearing the filters or wait for this user to make changes.</p>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
