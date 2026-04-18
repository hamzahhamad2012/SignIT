import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api } from '../api/client';
import { useSocket } from '../hooks/useSocket';
import { useAuth } from '../context/AuthContext';
import StatusBadge from '../components/StatusBadge';
import Modal from '../components/Modal';
import toast from 'react-hot-toast';
import {
  Monitor, ArrowLeft, Thermometer, Cpu, MemoryStick, HardDrive,
  Clock, Wifi, RotateCw, Camera, Trash2, Edit3, Save, Power, MapPin, Send, Loader2, Download,
} from 'lucide-react';

const displayRotations = [
  { value: 'landscape', label: 'Landscape', helper: '0°' },
  { value: 'landscape-flipped', label: 'Flipped', helper: '180°' },
  { value: 'portrait-right', label: 'Portrait Right', helper: '90°' },
  { value: 'portrait-left', label: 'Portrait Left', helper: '270°' },
];

export default function DeviceDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [device, setDevice] = useState(null);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [playlists, setPlaylists] = useState([]);
  const [groups, setGroups] = useState([]);
  const [showDelete, setShowDelete] = useState(false);
  const [editingLocation, setEditingLocation] = useState(false);
  const [locationForm, setLocationForm] = useState({});
  const [pendingCmd, setPendingCmd] = useState(null);
  const cmdTimeout = useRef(null);
  const { on } = useSocket();
  const canManage = ['admin', 'editor'].includes(user?.role);

  useEffect(() => {
    api.get(`/devices/${id}`).then(d => {
      setDevice(d.device);
      setEditName(d.device.name);
      setLocationForm({
        location_name: d.device.location_name || '',
        location_address: d.device.location_address || '',
        location_city: d.device.location_city || '',
        location_state: d.device.location_state || '',
        location_zip: d.device.location_zip || '',
        location_country: d.device.location_country || '',
        location_notes: d.device.location_notes || '',
      });
    }).catch(() => navigate('/devices'));
    if (canManage) {
      api.get('/playlists').then(d => setPlaylists(d.playlists));
      api.get('/groups').then(d => setGroups(d.groups));
    }
  }, [id, canManage, navigate]);

  useEffect(() => {
    const unsubs = [];

    unsubs.push(on('device:heartbeat', (data) => {
      if (String(data.deviceId) === String(id)) {
        setDevice(prev => prev ? { ...prev, ...data, status: 'online' } : prev);
      }
    }));

    unsubs.push(on('device:screenshot', (data) => {
      if (String(data.deviceId) === String(id)) {
        setDevice(prev => prev ? { ...prev, screenshot: data.screenshot } : prev);
        setPendingCmd(prev => prev === 'screenshot' ? null : prev);
        toast.success('Screenshot received');
      }
    }));

    unsubs.push(on('device:status', (data) => {
      if (String(data.deviceId) === String(id)) {
        setDevice(prev => prev ? { ...prev, status: data.status } : prev);
      }
    }));

    unsubs.push(on('device:player_status', (data) => {
      if (String(data.deviceId) === String(id)) {
        setDevice(prev => prev ? { ...prev, ...data } : prev);
        if (data.update_status === 'success') {
          setPendingCmd(null);
          toast.success('Player update installed. Restarting display player...');
        } else if (data.update_status === 'failed') {
          setPendingCmd(null);
          toast.error(data.update_error || 'Player update failed');
        } else if (data.update_status === 'current') {
          setPendingCmd(null);
          toast.success('Player is already up to date');
        }
      }
    }));

    return () => unsubs.forEach(fn => fn());
  }, [id, on]);

  const pollForScreenshot = useCallback((previousScreenshot) => {
    let attempts = 0;
    const maxAttempts = 15;
    const interval = setInterval(() => {
      attempts++;
      api.get(`/devices/${id}`).then(d => {
        if (d.device.screenshot !== previousScreenshot) {
          clearInterval(interval);
          setDevice(prev => prev ? { ...prev, screenshot: d.device.screenshot } : prev);
          setPendingCmd(null);
          toast.success('Screenshot received');
        } else if (attempts >= maxAttempts) {
          clearInterval(interval);
          setPendingCmd(null);
        }
      }).catch(() => {});
    }, 1000);
    return interval;
  }, [id]);

  const sendCommand = useCallback((command, params = undefined) => {
    setPendingCmd(command);
    if (cmdTimeout.current) clearTimeout(cmdTimeout.current);
    cmdTimeout.current = setTimeout(() => setPendingCmd(null), command === 'update_player' ? 90000 : 15000);

    api.post(`/devices/${id}/command`, { command, params }).then((result) => {
      if (command === 'screenshot') {
        // Poll for the updated screenshot since socket delivery is unreliable for large payloads
        pollForScreenshot(device?.screenshot || null);
      } else if (command === 'update_player') {
        toast.success(result.queued ? 'Player update queued until this Pi reconnects' : 'Player update command sent');
        if (result.queued) setPendingCmd(null);
      } else {
        setTimeout(() => setPendingCmd(prev => prev === command ? null : prev), 3000);
      }
    }).catch(() => {
      toast.error(`Failed to send "${command}"`);
      setPendingCmd(null);
    });
  }, [id, device?.screenshot, pollForScreenshot]);

  const handleSave = async () => {
    await api.put(`/devices/${id}`, { name: editName });
    setDevice(prev => ({ ...prev, name: editName }));
    setEditing(false);
    toast.success('Device updated');
  };

  const handleAssignPlaylist = async (playlistId) => {
    await api.put(`/devices/${id}`, { assigned_playlist_id: playlistId || null });
    const updated = await api.get(`/devices/${id}`);
    setDevice(updated.device);
    toast.success('Playlist assigned');
  };

  const handleAssignGroup = async (groupId) => {
    await api.put(`/devices/${id}`, { group_id: groupId || null });
    const updated = await api.get(`/devices/${id}`);
    setDevice(updated.device);
    toast.success('Group updated');
  };

  const handleOrientationChange = async (displayRotation) => {
    await api.put(`/devices/${id}`, { display_rotation: displayRotation });
    const updated = await api.get(`/devices/${id}`);
    setDevice(updated.device);
    toast.success(`Rotation set to ${displayRotation}. Online players will rotate shortly.`);
  };

  const handleSaveLocation = async () => {
    await api.put(`/devices/${id}`, locationForm);
    const updated = await api.get(`/devices/${id}`);
    setDevice(updated.device);
    setEditingLocation(false);
    toast.success('Location updated');
  };

  const handleDelete = async () => {
    await api.delete(`/devices/${id}`);
    toast.success('Device removed');
    navigate('/devices');
  };

  if (!device) return <div className="h-64 flex items-center justify-center"><div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" /></div>;

  const metrics = [
    { label: 'CPU Temp', value: device.cpu_temp != null ? `${Number(device.cpu_temp).toFixed(1)}°C` : '—', icon: Thermometer, color: 'text-orange-400' },
    { label: 'CPU Usage', value: device.cpu_usage != null ? `${Number(device.cpu_usage).toFixed(0)}%` : '—', icon: Cpu, color: 'text-blue-400' },
    { label: 'Memory', value: device.memory_usage != null ? `${Number(device.memory_usage).toFixed(0)}%` : '—', icon: MemoryStick, color: 'text-violet-400' },
    { label: 'Disk', value: device.disk_usage != null ? `${Number(device.disk_usage).toFixed(0)}%` : '—', icon: HardDrive, color: 'text-pink-400' },
  ];
  const currentDisplayRotation = device.display_rotation || (device.orientation === 'portrait' ? 'portrait-right' : 'landscape');

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Link to="/devices" className="p-2 rounded-lg hover:bg-surface-hover text-zinc-400 hover:text-zinc-200 transition-colors">
          <ArrowLeft size={18} />
        </Link>
        <div className="flex-1 flex items-center gap-3">
          {editing ? (
            <div className="flex items-center gap-2">
              <input type="text" value={editName} onChange={(e) => setEditName(e.target.value)} className="text-lg font-bold" autoFocus />
              <button onClick={handleSave} className="btn-primary text-xs"><Save size={14} /> Save</button>
              <button onClick={() => setEditing(false)} className="btn-ghost text-xs">Cancel</button>
            </div>
          ) : (
            <>
              <h1 className="text-2xl font-bold text-zinc-100">{device.name}</h1>
              {canManage && (
                <button onClick={() => setEditing(true)} className="p-1.5 rounded-lg hover:bg-surface-hover text-zinc-500">
                  <Edit3 size={14} />
                </button>
              )}
            </>
          )}
          <StatusBadge status={device.status} />
        </div>
      </div>

      <div className="grid sm:grid-cols-4 gap-3">
        {metrics.map((m) => (
          <div key={m.label} className="stat-card flex-row items-center gap-3">
            <div className={`w-10 h-10 rounded-xl ${m.color.replace('text-', 'bg-').replace('400', '400/10')} flex items-center justify-center`}>
              <m.icon size={18} className={m.color} />
            </div>
            <div>
              <p className="text-lg font-bold text-zinc-100">{m.value}</p>
              <p className="text-xs text-zinc-500">{m.label}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          <div className="card">
            <h2 className="text-sm font-semibold text-zinc-200 mb-4">Device Information</h2>
            <div className="grid sm:grid-cols-2 gap-3">
              {[
                ['Device ID', device.id],
                ['MAC Address', device.mac_address || '—'],
                ['IP Address', device.ip_address || '—'],
                ['Resolution', device.resolution],
                ['Orientation', device.display_rotation_label || device.orientation],
                ['OS', device.os_info || '—'],
                ['Player Version', device.player_version || '—'],
                ['Latest Player', device.latest_player_version || '—'],
                ['Registered', new Date(device.registered_at).toLocaleDateString()],
                ['Last Seen', device.last_seen ? new Date(device.last_seen).toLocaleString() : 'Never'],
              ].map(([label, value]) => (
                <div key={label} className="flex flex-col gap-0.5">
                  <span className="text-xs text-zinc-500">{label}</span>
                  <span className="text-sm text-zinc-300 font-mono">{value}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-zinc-200">Screenshot</h2>
              {canManage && (
                <button
                  onClick={() => sendCommand('screenshot')}
                  disabled={pendingCmd === 'screenshot'}
                  className="text-xs text-accent hover:underline flex items-center gap-1 disabled:opacity-50"
                >
                  {pendingCmd === 'screenshot' ? (
                    <><Loader2 size={12} className="animate-spin" /> Capturing...</>
                  ) : (
                    <><Camera size={12} /> Capture</>
                  )}
                </button>
              )}
            </div>
            <div className="relative">
              {canManage && pendingCmd === 'screenshot' && (
                <div className="absolute inset-0 z-10 rounded-lg bg-black/60 flex items-center justify-center">
                  <div className="flex flex-col items-center gap-2">
                    <Loader2 size={24} className="animate-spin text-accent" />
                    <span className="text-xs text-zinc-300">Taking screenshot...</span>
                  </div>
                </div>
              )}
              {device.screenshot ? (
                <img src={device.screenshot} alt="Device screenshot" className="w-full rounded-lg border border-surface-border" />
              ) : (
                <div className="aspect-video rounded-lg bg-surface-overlay flex items-center justify-center">
                  <p className="text-sm text-zinc-500">No screenshot available</p>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="card">
            <h2 className="text-sm font-semibold text-zinc-200 mb-3">Assigned Playlist</h2>
            {canManage ? (
              <>
                <select
                  value={device.assigned_playlist_id || ''}
                  onChange={(e) => handleAssignPlaylist(e.target.value ? parseInt(e.target.value) : null)}
                  className="w-full"
                >
                  <option value="">None (use schedule)</option>
                  {playlists.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                {device.assigned_playlist_id && (
                  <button
                    onClick={() => sendCommand('refresh')}
                    className="btn-primary w-full mt-2 text-xs"
                  >
                    <Send size={13} /> Push Now
                  </button>
                )}
              </>
            ) : (
              <p className="text-sm text-zinc-300">{device.playlist_name || 'None (uses schedule or group default)'}</p>
            )}
          </div>

          <div className="card">
            <h2 className="text-sm font-semibold text-zinc-200 mb-3">Group</h2>
            {canManage ? (
              <select
                value={device.group_id || ''}
                onChange={(e) => handleAssignGroup(e.target.value ? parseInt(e.target.value) : null)}
                className="w-full"
              >
                <option value="">No group</option>
                {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            ) : (
              <p className="text-sm text-zinc-300">{device.group_name || 'No group'}</p>
            )}
          </div>

          <div className="card">
            <h2 className="text-sm font-semibold text-zinc-200 mb-3">Display Orientation</h2>
            {canManage ? (
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  {displayRotations.map(option => (
                    <button
                      key={option.value}
                      onClick={() => handleOrientationChange(option.value)}
                      className={`btn text-xs ${currentDisplayRotation === option.value
                        ? 'bg-accent/15 text-accent border border-accent/30'
                        : 'bg-surface-raised hover:bg-surface-hover text-zinc-400 border border-surface-border'
                      }`}
                    >
                      <RotateCw size={13} /> {option.label}
                      <span className="text-[10px] opacity-60">{option.helper}</span>
                    </button>
                  ))}
                </div>
                <p className="text-xs text-zinc-600">
                  Use the exact rotation that matches how the TV was mounted. The Pi applies this with xrandr and falls back to CSS rotation if needed.
                </p>
              </div>
            ) : (
              <p className="text-sm text-zinc-300 capitalize">{device.display_rotation_label || device.orientation}</p>
            )}
          </div>

          <div className="card">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-zinc-200 flex items-center gap-1.5">
                <MapPin size={14} className="text-emerald-400" /> Location
              </h2>
              {canManage && !editingLocation && (
                <button onClick={() => setEditingLocation(true)} className="text-xs text-accent hover:underline">
                  {device.location_name ? 'Edit' : 'Add'}
                </button>
              )}
            </div>
            {canManage && editingLocation ? (
              <div className="space-y-2">
                <input type="text" placeholder="Location name" value={locationForm.location_name}
                  onChange={(e) => setLocationForm(f => ({ ...f, location_name: e.target.value }))} className="w-full text-xs" />
                <input type="text" placeholder="Street address" value={locationForm.location_address}
                  onChange={(e) => setLocationForm(f => ({ ...f, location_address: e.target.value }))} className="w-full text-xs" />
                <div className="grid grid-cols-2 gap-2">
                  <input type="text" placeholder="City" value={locationForm.location_city}
                    onChange={(e) => setLocationForm(f => ({ ...f, location_city: e.target.value }))} className="text-xs" />
                  <input type="text" placeholder="State" value={locationForm.location_state}
                    onChange={(e) => setLocationForm(f => ({ ...f, location_state: e.target.value }))} className="text-xs" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <input type="text" placeholder="ZIP" value={locationForm.location_zip}
                    onChange={(e) => setLocationForm(f => ({ ...f, location_zip: e.target.value }))} className="text-xs" />
                  <input type="text" placeholder="Country" value={locationForm.location_country}
                    onChange={(e) => setLocationForm(f => ({ ...f, location_country: e.target.value }))} className="text-xs" />
                </div>
                <textarea placeholder="Notes" value={locationForm.location_notes} rows={2}
                  onChange={(e) => setLocationForm(f => ({ ...f, location_notes: e.target.value }))} className="w-full text-xs" />
                <div className="flex gap-2">
                  <button onClick={handleSaveLocation} className="btn-primary text-xs flex-1"><Save size={12} /> Save</button>
                  <button onClick={() => setEditingLocation(false)} className="btn-ghost text-xs">Cancel</button>
                </div>
              </div>
            ) : device.location_name ? (
              <div className="space-y-1 text-xs">
                <p className="text-zinc-200 font-medium">{device.location_name}</p>
                {device.location_address && <p className="text-zinc-400">{device.location_address}</p>}
                {(device.location_city || device.location_state) && (
                  <p className="text-zinc-400">
                    {[device.location_city, device.location_state, device.location_zip].filter(Boolean).join(', ')}
                  </p>
                )}
                {device.location_country && <p className="text-zinc-500">{device.location_country}</p>}
                {device.location_notes && <p className="text-zinc-600 mt-1 italic">{device.location_notes}</p>}
              </div>
            ) : (
              <p className="text-xs text-zinc-600">No location set</p>
            )}
          </div>

          {canManage && (
            <>
              <div className="card">
                <h2 className="text-sm font-semibold text-zinc-200 mb-3">Player Software</h2>
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-zinc-500">Installed</span>
                    <span className="text-zinc-300 font-mono">{device.player_version || 'unknown'}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-zinc-500">Latest</span>
                    <span className="text-zinc-300 font-mono">{device.latest_player_version || 'unknown'}</span>
                  </div>
                  {device.needs_player_update ? (
                    <p className="text-xs text-amber-400">Update available for this Pi.</p>
                  ) : (
                    <p className="text-xs text-emerald-400">Player is current.</p>
                  )}
                  {device.player_update_status && !['success', 'current'].includes(device.player_update_status) && (
                    <p className="text-xs text-sky-400">
                      Update {device.player_update_status}
                      {device.player_update_target_version ? ` to ${device.player_update_target_version}` : ''}
                    </p>
                  )}
                  <button
                    onClick={() => sendCommand('update_player')}
                    disabled={!!pendingCmd}
                    className="btn-primary w-full text-xs disabled:opacity-50"
                  >
                    {pendingCmd === 'update_player' ? (
                      <Loader2 size={13} className="animate-spin" />
                    ) : (
                      <Download size={13} />
                    )}
                    {pendingCmd === 'update_player' ? 'Updating...' : 'Update Player'}
                  </button>
                  {device.status !== 'online' && (
                    <p className="text-[11px] text-zinc-600">Offline updates are queued and sent when the Pi reconnects.</p>
                  )}
                </div>
              </div>

              <div className="card">
                <h2 className="text-sm font-semibold text-zinc-200 mb-3">Remote Commands</h2>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { cmd: 'reboot', label: 'Reboot', Icon: Power },
                    { cmd: 'restart_player', label: 'Restart', Icon: RotateCw },
                    { cmd: 'screenshot', label: 'Screenshot', Icon: Camera },
                    { cmd: 'refresh', label: 'Refresh', Icon: RotateCw },
                    { cmd: 'display_power', label: 'TV On', Icon: Monitor, params: { state: 'on' } },
                    { cmd: 'display_power', label: 'TV Off', Icon: Power, params: { state: 'off' } },
                  ].map(({ cmd, label, Icon, params }) => (
                    <button
                      key={label}
                      onClick={() => sendCommand(cmd, params)}
                      disabled={!!pendingCmd}
                      className="btn-secondary text-xs disabled:opacity-50"
                    >
                      {pendingCmd === cmd ? (
                        <Loader2 size={13} className="animate-spin" />
                      ) : (
                        <Icon size={13} />
                      )}
                      {pendingCmd === cmd ? 'Sending...' : label}
                    </button>
                  ))}
                </div>
              </div>

              <button onClick={() => setShowDelete(true)} className="btn-danger w-full text-xs">
                <Trash2 size={14} /> Remove Device
              </button>
            </>
          )}
        </div>
      </div>

      <Modal open={canManage && showDelete} onClose={() => setShowDelete(false)} title="Remove Device">
        <p className="text-sm text-zinc-400 mb-4">
          Are you sure you want to remove <strong className="text-zinc-200">{device.name}</strong>? This action cannot be undone.
        </p>
        <div className="flex gap-2 justify-end">
          <button onClick={() => setShowDelete(false)} className="btn-secondary">Cancel</button>
          <button onClick={handleDelete} className="btn-danger">Remove</button>
        </div>
      </Modal>
    </div>
  );
}
