import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import {
  Users as UsersIcon, RefreshCw, Save, ShieldCheck, Clock3, Ban, Monitor,
} from 'lucide-react';

const statusStyles = {
  pending: 'bg-amber-500/10 text-amber-400 border border-amber-500/20',
  active: 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20',
  disabled: 'bg-red-500/10 text-red-400 border border-red-500/20',
};

export default function Users() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState([]);
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState(null);

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
    </div>
  );
}
