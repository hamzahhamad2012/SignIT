import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { useSocket } from '../hooks/useSocket';
import StatusBadge from '../components/StatusBadge';
import {
  Monitor, Image, ListVideo, Calendar, HardDrive,
  Activity, Clock, Thermometer, Cpu, ArrowUpRight,
} from 'lucide-react';

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

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

export default function Dashboard() {
  const [data, setData] = useState(null);
  const { on } = useSocket();

  useEffect(() => {
    api.get('/analytics/dashboard').then(setData);
  }, []);

  useEffect(() => {
    return on('device:status', () => {
      api.get('/analytics/dashboard').then(setData);
    });
  }, [on]);

  if (!data) return <DashboardSkeleton />;

  const { deviceStats, contentStats, storageUsed, recentDevices } = data;

  const stats = [
    { label: 'Total Displays', value: deviceStats.total, icon: Monitor, color: 'text-accent', bg: 'bg-accent/10' },
    { label: 'Online Now', value: deviceStats.online, icon: Activity, color: 'text-emerald-400', bg: 'bg-emerald-400/10' },
    { label: 'Assets', value: contentStats.assets, icon: Image, color: 'text-amber-400', bg: 'bg-amber-400/10' },
    { label: 'Playlists', value: contentStats.playlists, icon: ListVideo, color: 'text-violet-400', bg: 'bg-violet-400/10' },
    { label: 'Schedules', value: contentStats.schedules, icon: Calendar, color: 'text-cyan-400', bg: 'bg-cyan-400/10' },
    { label: 'Storage', value: formatBytes(storageUsed), icon: HardDrive, color: 'text-pink-400', bg: 'bg-pink-400/10' },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-zinc-100">Dashboard</h1>
        <p className="text-sm text-zinc-500 mt-1">Overview of your digital signage network</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {stats.map((s) => (
          <div key={s.label} className="stat-card group">
            <div className={`w-9 h-9 rounded-xl ${s.bg} flex items-center justify-center`}>
              <s.icon size={18} className={s.color} />
            </div>
            <span className="text-2xl font-bold text-zinc-100 mt-2">{s.value}</span>
            <span className="text-xs text-zinc-500">{s.label}</span>
          </div>
        ))}
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-zinc-200">Displays</h2>
            <Link to="/devices" className="text-xs text-accent hover:text-accent-hover flex items-center gap-1">
              View all <ArrowUpRight size={12} />
            </Link>
          </div>

          {recentDevices.length === 0 ? (
            <p className="text-sm text-zinc-500 py-8 text-center">No devices registered yet</p>
          ) : (
            <div className="space-y-1">
              {recentDevices.map((device) => (
                <Link
                  key={device.id}
                  to={`/devices/${device.id}`}
                  className="flex items-center justify-between py-2.5 px-3 rounded-lg hover:bg-surface-hover transition-colors group"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-surface-overlay flex items-center justify-center">
                      <Monitor size={14} className="text-zinc-400" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-zinc-200 group-hover:text-zinc-100">{device.name}</p>
                      <div className="flex items-center gap-3 mt-0.5">
                        <span className="text-xs text-zinc-500 flex items-center gap-1">
                          <Clock size={10} /> {timeAgo(device.last_seen)}
                        </span>
                        {device.cpu_temp && (
                          <span className="text-xs text-zinc-500 flex items-center gap-1">
                            <Thermometer size={10} /> {device.cpu_temp.toFixed(1)}°C
                          </span>
                        )}
                        {device.memory_usage && (
                          <span className="text-xs text-zinc-500 flex items-center gap-1">
                            <Cpu size={10} /> {device.memory_usage.toFixed(0)}%
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <StatusBadge status={device.status} />
                </Link>
              ))}
            </div>
          )}
        </div>

        <div className="card">
          <h2 className="text-sm font-semibold text-zinc-200 mb-4">Quick Actions</h2>
          <div className="space-y-2">
            <Link to="/assets" className="flex items-center gap-3 p-3 rounded-lg bg-surface-overlay hover:bg-surface-hover transition-colors">
              <Image size={18} className="text-amber-400" />
              <span className="text-sm text-zinc-300">Upload Content</span>
            </Link>
            <Link to="/playlists" className="flex items-center gap-3 p-3 rounded-lg bg-surface-overlay hover:bg-surface-hover transition-colors">
              <ListVideo size={18} className="text-violet-400" />
              <span className="text-sm text-zinc-300">Create Playlist</span>
            </Link>
            <Link to="/schedules" className="flex items-center gap-3 p-3 rounded-lg bg-surface-overlay hover:bg-surface-hover transition-colors">
              <Calendar size={18} className="text-cyan-400" />
              <span className="text-sm text-zinc-300">Add Schedule</span>
            </Link>
            <Link to="/devices" className="flex items-center gap-3 p-3 rounded-lg bg-surface-overlay hover:bg-surface-hover transition-colors">
              <Monitor size={18} className="text-accent" />
              <span className="text-sm text-zinc-300">Manage Displays</span>
            </Link>
          </div>

          <div className="mt-6 pt-4 border-t border-surface-border">
            <h3 className="text-xs font-medium text-zinc-500 mb-3 uppercase tracking-wider">Network Health</h3>
            <div className="space-y-3">
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-zinc-400">Online</span>
                  <span className="text-emerald-400">
                    {deviceStats.total > 0 ? Math.round((deviceStats.online / deviceStats.total) * 100) : 0}%
                  </span>
                </div>
                <div className="h-1.5 bg-surface-overlay rounded-full overflow-hidden">
                  <div
                    className="h-full bg-emerald-500 rounded-full transition-all duration-700"
                    style={{ width: `${deviceStats.total > 0 ? (deviceStats.online / deviceStats.total) * 100 : 0}%` }}
                  />
                </div>
              </div>
              {deviceStats.error > 0 && (
                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-zinc-400">Errors</span>
                    <span className="text-red-400">{deviceStats.error}</span>
                  </div>
                  <div className="h-1.5 bg-surface-overlay rounded-full overflow-hidden">
                    <div
                      className="h-full bg-red-500 rounded-full"
                      style={{ width: `${(deviceStats.error / deviceStats.total) * 100}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div><div className="h-7 w-40 bg-surface rounded-lg" /><div className="h-4 w-64 bg-surface rounded-lg mt-2" /></div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {Array(6).fill(0).map((_, i) => <div key={i} className="h-28 bg-surface rounded-xl" />)}
      </div>
      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 h-80 bg-surface rounded-xl" />
        <div className="h-80 bg-surface rounded-xl" />
      </div>
    </div>
  );
}
