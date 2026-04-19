import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { useSocket } from '../hooks/useSocket';
import { useAuth } from '../context/AuthContext';
import StatusBadge from '../components/StatusBadge';
import EmptyState from '../components/EmptyState';
import AddDisplayWizard from '../components/AddDisplayWizard';
import toast from 'react-hot-toast';
import {
  Monitor, Search, Filter, Thermometer, Cpu,
  MemoryStick, Clock, Wifi, RefreshCw, Plus, MapPin, RotateCw, Download, Loader2,
} from 'lucide-react';

function timeAgo(dateStr) {
  if (!dateStr) return 'Never';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function activePlayerUpdateStatus(status) {
  return status && !['success', 'current'].includes(status);
}

function clampProgress(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(100, parsed));
}

function formatEta(seconds) {
  const parsed = Number.parseInt(seconds, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  if (parsed < 60) return `${parsed}s left`;
  const mins = Math.ceil(parsed / 60);
  return `${mins}m left`;
}

function getUpdateLabel(status) {
  const labels = {
    queued: 'Queued',
    sent: 'Sent',
    checking: 'Checking',
    downloading: 'Downloading',
    installing: 'Installing',
    failed: 'Failed',
  };
  return labels[status] || status;
}

function getPlaylistState(device) {
  const source = device.playlist_source
    || (device.current_playlist_name ? 'current'
      : device.assigned_playlist_name ? 'assigned'
        : device.group_default_playlist_name ? 'group_default'
          : 'none');
  const name = device.playback_playlist_name
    || device.current_playlist_name
    || device.assigned_playlist_name
    || device.group_default_playlist_name
    || 'No playlist';

  if (source === 'current') {
    return {
      name,
      label: device.status === 'online' ? 'Now playing' : 'Last reported',
      className: 'text-emerald-300',
    };
  }

  if (source === 'assigned') {
    return { name, label: 'Assigned direct', className: 'text-sky-300' };
  }

  if (source === 'group_default') {
    return { name, label: 'Group default', className: 'text-violet-300' };
  }

  return { name, label: 'No playlist', className: 'text-zinc-400' };
}

export default function Devices() {
  const { user } = useAuth();
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [wizardOpen, setWizardOpen] = useState(false);
  const [updatePending, setUpdatePending] = useState(false);
  const { on } = useSocket();
  const canManage = ['admin', 'editor'].includes(user?.role);

  const fetchDevices = () => {
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (filterStatus) params.set('status', filterStatus);
    api.get(`/devices?${params}`).then(d => { setDevices(d.devices); setLoading(false); });
  };

  useEffect(() => { fetchDevices(); }, [search, filterStatus]);

  useEffect(() => {
    const unsub1 = on('device:status', fetchDevices);
    const unsub2 = on('device:heartbeat', fetchDevices);
    const unsub3 = on('device:playlist', fetchDevices);
    const unsub4 = on('device:player_status', fetchDevices);
    return () => { unsub1(); unsub2(); unsub3(); unsub4(); };
  }, [on]);

  const outdatedCount = devices.filter((device) => device.needs_player_update).length;

  const updateOutdatedPlayers = async () => {
    setUpdatePending(true);
    try {
      const result = await api.post('/devices/update-player', { only_outdated: true });
      if (result.sent.length > 0 || result.queued.length > 0) {
        const parts = [];
        if (result.sent.length > 0) parts.push(`${result.sent.length} sent now`);
        if (result.queued.length > 0) parts.push(`${result.queued.length} queued`);
        toast.success(`Player updates: ${parts.join(', ')}`);
      } else {
        toast('No outdated displays needed an update');
      }
      fetchDevices();
    } catch (err) {
      toast.error(err.message || 'Could not send player updates');
    } finally {
      setUpdatePending(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-zinc-100">Displays</h1>
          <p className="text-sm text-zinc-500 mt-0.5">{devices.length} registered display{devices.length !== 1 && 's'}</p>
        </div>
        <div className="flex gap-2">
          {canManage && outdatedCount > 0 && (
            <button onClick={updateOutdatedPlayers} disabled={updatePending} className="btn-secondary">
              {updatePending ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
              Update {outdatedCount}
            </button>
          )}
          <button onClick={fetchDevices} className="btn-secondary">
            <RefreshCw size={15} /> Refresh
          </button>
          {canManage && (
            <button onClick={() => setWizardOpen(true)} className="btn-primary">
              <Plus size={15} /> Add Display
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
          <input
            type="search"
            placeholder="Search displays..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9"
          />
        </div>
        <div className="flex gap-1.5">
          {['', 'online', 'offline', 'error'].map((s) => (
            <button
              key={s}
              onClick={() => setFilterStatus(s)}
              className={`btn text-xs px-3 py-1.5 capitalize ${filterStatus === s
                ? 'bg-accent/15 text-accent border border-accent/30'
                : 'bg-surface-raised text-zinc-400 border border-surface-border hover:text-zinc-200'
              }`}
            >
              {s || 'All'}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {Array(6).fill(0).map((_, i) => <div key={i} className="h-44 bg-surface rounded-xl animate-pulse" />)}
        </div>
      ) : devices.length === 0 ? (
        <EmptyState
          icon={Monitor}
          title="No displays found"
          description="Displays will appear here once they connect to the server. Run the player setup on your Raspberry Pi to get started."
        />
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {devices.map((device) => {
            const playlistState = getPlaylistState(device);

            return (
              <Link
                key={device.id}
                to={`/devices/${device.id}`}
                className="card hover:border-accent/30 transition-all duration-200 group"
              >
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2.5">
                  <div className="w-10 h-10 rounded-xl bg-surface-overlay flex items-center justify-center group-hover:bg-accent/10 transition-colors">
                    <Monitor size={18} className="text-zinc-400 group-hover:text-accent transition-colors" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-zinc-200 group-hover:text-zinc-100">{device.name}</h3>
                    <p className="text-xs text-zinc-500 font-mono">{device.id}</p>
                  </div>
                </div>
                <StatusBadge status={device.status} />
              </div>

              {device.needs_player_update && (
                <div className="mb-3 rounded-lg border border-amber-500/20 bg-amber-500/10 px-2.5 py-1.5 text-xs text-amber-300">
                  Player update available: {device.player_version || 'unknown'} {'->'} {device.latest_player_version || 'latest'}
                </div>
              )}
              {activePlayerUpdateStatus(device.player_update_status) && (
                <div className="mb-3 rounded-lg border border-sky-500/20 bg-sky-500/10 px-2.5 py-2 text-xs text-sky-300">
                  <div className="flex items-center justify-between gap-2">
                    <span>
                      Player update {getUpdateLabel(device.player_update_status)}
                      {device.player_update_target_version ? ` to ${device.player_update_target_version}` : ''}
                    </span>
                    <span className="font-mono">{clampProgress(device.player_update_progress)}%</span>
                  </div>
                  <div className="mt-1.5 h-1.5 rounded-full bg-sky-950/70 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-sky-400 transition-all"
                      style={{ width: `${clampProgress(device.player_update_progress)}%` }}
                    />
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-sky-200/80">
                    <span className="truncate">{device.player_update_message || 'Update in progress'}</span>
                    {formatEta(device.player_update_eta_seconds) && <span>{formatEta(device.player_update_eta_seconds)}</span>}
                  </div>
                </div>
              )}

              <div className="mb-3 rounded-lg bg-surface-overlay px-3 py-2">
                <p className={`text-[11px] uppercase tracking-wide font-semibold ${playlistState.className}`}>
                  {playlistState.label}
                </p>
                <p className="text-sm font-semibold text-zinc-100 truncate mt-0.5">
                  {playlistState.name}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-2 mt-auto">
                {device.cpu_temp != null && (
                  <div className="flex items-center gap-1.5 text-xs text-zinc-500">
                    <Thermometer size={12} />
                    <span>{device.cpu_temp.toFixed(1)}°C</span>
                  </div>
                )}
                {device.cpu_usage != null && (
                  <div className="flex items-center gap-1.5 text-xs text-zinc-500">
                    <Cpu size={12} />
                    <span>{device.cpu_usage.toFixed(0)}% CPU</span>
                  </div>
                )}
                {device.memory_usage != null && (
                  <div className="flex items-center gap-1.5 text-xs text-zinc-500">
                    <MemoryStick size={12} />
                    <span>{device.memory_usage.toFixed(0)}% RAM</span>
                  </div>
                )}
                <div className="flex items-center gap-1.5 text-xs text-zinc-500">
                  <Clock size={12} />
                  <span>{timeAgo(device.last_seen)}</span>
                </div>
                <div className="flex items-center gap-1.5 text-xs text-zinc-500 capitalize">
                  <RotateCw size={12} />
                  <span>{device.display_rotation_label || device.orientation || 'landscape'}</span>
                </div>
              </div>

              {(device.group_name || device.location_name) && (
                <div className="mt-3 pt-3 border-t border-surface-border flex items-center gap-2 flex-wrap">
                  {device.group_name && (
                    <>
                      <span className="text-xs text-zinc-500">Group:</span>
                      <span className="text-xs text-zinc-300">{device.group_name}</span>
                    </>
                  )}
                  {device.location_name && (
                    <span className="flex items-center gap-1 text-xs text-zinc-500 ml-auto">
                      <MapPin size={10} /> {device.location_name}
                    </span>
                  )}
                </div>
              )}
              </Link>
            );
          })}
        </div>
      )}

      {canManage && (
        <AddDisplayWizard
          open={wizardOpen}
          onClose={() => setWizardOpen(false)}
          onComplete={fetchDevices}
        />
      )}
    </div>
  );
}
