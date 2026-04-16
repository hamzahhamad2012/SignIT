import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { useSocket } from '../hooks/useSocket';
import { useAuth } from '../context/AuthContext';
import StatusBadge from '../components/StatusBadge';
import EmptyState from '../components/EmptyState';
import AddDisplayWizard from '../components/AddDisplayWizard';
import {
  Monitor, Search, Filter, Thermometer, Cpu,
  MemoryStick, Clock, Wifi, RefreshCw, Plus, MapPin, RotateCw,
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

export default function Devices() {
  const { user } = useAuth();
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [wizardOpen, setWizardOpen] = useState(false);
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
    return () => { unsub1(); unsub2(); };
  }, [on]);

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-zinc-100">Displays</h1>
          <p className="text-sm text-zinc-500 mt-0.5">{devices.length} registered display{devices.length !== 1 && 's'}</p>
        </div>
        <div className="flex gap-2">
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
          {devices.map((device) => (
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
                  <span>{device.orientation || 'landscape'}</span>
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
          ))}
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
