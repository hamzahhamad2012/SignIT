import { useEffect, useState, useRef } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import StatusBadge from '../components/StatusBadge';
import Modal from '../components/Modal';
import toast from 'react-hot-toast';
import {
  ArrowLeft, Save, Monitor, Play, RotateCw, Maximize,
  Settings2, Eye, Trash2, Check, GripVertical, Columns3,
} from 'lucide-react';

export default function WallEditor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [wall, setWall] = useState(null);
  const [screens, setScreens] = useState([]);
  const [devices, setDevices] = useState([]);
  const [playlists, setPlaylists] = useState([]);
  const [selectedIdx, setSelectedIdx] = useState(null);
  const [hasChanges, setHasChanges] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const canvasRef = useRef(null);

  useEffect(() => {
    api.get(`/walls/${id}`).then(d => {
      setWall(d.wall);
      if (d.wall.screens && d.wall.screens.length > 0) {
        setScreens(d.wall.screens);
      } else {
        initScreens(d.wall.cols, d.wall.rows);
      }
    }).catch(() => navigate('/walls'));
    api.get('/devices').then(d => setDevices(d.devices));
    api.get('/playlists').then(d => setPlaylists(d.playlists));
  }, [id]);

  const initScreens = (cols, rows) => {
    const s = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        s.push({
          id: `new-${r}-${c}`,
          col: c, row: r,
          col_span: 1, row_span: 1,
          orientation: 'portrait',
          device_id: null, device_name: null, device_status: null, device_screenshot: null,
          playlist_id: null, playlist_name: null,
          label: `Screen ${r * cols + c + 1}`,
          settings: {},
        });
      }
    }
    setScreens(s);
    setHasChanges(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload = screens.map(s => ({
        device_id: s.device_id,
        playlist_id: s.playlist_id,
        col: s.col, row: s.row,
        col_span: s.col_span, row_span: s.row_span,
        orientation: s.orientation,
        label: s.label,
        settings: s.settings || {},
      }));
      await api.put(`/walls/${id}/screens`, { screens: payload });
      setHasChanges(false);
      toast.success('Wall saved');
    } catch (err) { toast.error(err.message); }
    finally { setSaving(false); }
  };

  const updateScreen = (idx, field, value) => {
    setScreens(prev => prev.map((s, i) => {
      if (i !== idx) return s;
      const updated = { ...s, [field]: value };
      if (field === 'device_id') {
        const device = devices.find(d => d.id === value);
        updated.device_name = device?.name || null;
        updated.device_status = device?.status || null;
        updated.device_screenshot = device?.screenshot || null;
      }
      if (field === 'playlist_id') {
        const pl = playlists.find(p => p.id === parseInt(value));
        updated.playlist_name = pl?.name || null;
      }
      return updated;
    }));
    setHasChanges(true);
  };

  const handleUpdateWall = async (updates) => {
    await api.put(`/walls/${id}`, updates);
    setWall(prev => ({ ...prev, ...updates }));
    if (updates.cols !== undefined || updates.rows !== undefined) {
      initScreens(updates.cols || wall.cols, updates.rows || wall.rows);
    }
    toast.success('Wall updated');
  };

  const selected = selectedIdx !== null ? screens[selectedIdx] : null;
  const usedDeviceIds = screens.map(s => s.device_id).filter(Boolean);

  if (!wall) return <div className="h-64 flex items-center justify-center"><div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" /></div>;

  const screenAspect = 9 / 16;
  const maxCanvasW = 700;
  const gap = Math.max(2, wall.bezel_mm || 5);
  const cellW = Math.min(180, (maxCanvasW - gap * (wall.cols - 1)) / wall.cols);
  const cellH = cellW * screenAspect;
  const canvasW = cellW * wall.cols + gap * (wall.cols - 1);
  const canvasH = cellH * wall.rows + gap * (wall.rows - 1);

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link to="/walls" className="p-2 rounded-lg hover:bg-surface-hover text-zinc-400 hover:text-zinc-200 transition-colors">
            <ArrowLeft size={18} />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-zinc-100">{wall.name}</h1>
            <p className="text-sm text-zinc-500">{wall.cols}x{wall.rows} &middot; {screens.length} screens</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowSettings(true)} className="btn-secondary"><Settings2 size={15} /> Settings</button>
          <button onClick={() => setShowPreview(true)} className="btn-secondary"><Eye size={15} /> Preview</button>
          <button onClick={handleSave} disabled={!hasChanges || saving}
            className={hasChanges ? 'btn-primary' : 'btn-secondary opacity-50'}>
            <Save size={15} /> {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>

      <div className="grid lg:grid-cols-[1fr_320px] gap-4">
        {/* Canvas */}
        <div className="card flex flex-col items-center">
          <div className="text-xs text-zinc-500 mb-4 flex items-center gap-2">
            <Columns3 size={14} /> Click a screen to configure it
          </div>

          <div ref={canvasRef}
            className="relative rounded-xl p-6"
            style={{ background: wall.bg_color || '#1a1a1a' }}>
            <div className="grid" style={{
              gridTemplateColumns: `repeat(${wall.cols}, ${cellW}px)`,
              gridTemplateRows: `repeat(${wall.rows}, ${cellH}px)`,
              gap: `${gap}px`,
            }}>
              {screens.map((screen, idx) => {
                const isSelected = selectedIdx === idx;
                const hasDevice = !!screen.device_id;
                const isOnline = screen.device_status === 'online';

                return (
                  <div
                    key={screen.id || idx}
                    onClick={() => setSelectedIdx(isSelected ? null : idx)}
                    className={`relative rounded-lg border-2 transition-all duration-200 cursor-pointer overflow-hidden
                      flex flex-col items-center justify-center
                      ${isSelected
                        ? 'border-accent shadow-lg shadow-accent/20 scale-[1.02] z-10'
                        : hasDevice
                          ? 'border-zinc-700 hover:border-zinc-500'
                          : 'border-dashed border-zinc-700/50 hover:border-zinc-500'
                      }`}
                    style={{
                      gridColumn: `span ${screen.col_span}`,
                      gridRow: `span ${screen.row_span}`,
                      background: hasDevice ? '#111' : '#0a0a0a',
                    }}
                  >
                    {screen.device_screenshot ? (
                      <img src={screen.device_screenshot} alt="" className="absolute inset-0 w-full h-full object-cover opacity-40" />
                    ) : null}

                    <div className="relative z-10 flex flex-col items-center gap-1 p-2">
                      <Monitor size={cellW > 100 ? 20 : 14} className={hasDevice ? 'text-zinc-300' : 'text-zinc-600'} />
                      <span className="text-[10px] font-medium text-zinc-300 truncate max-w-full px-1">
                        {screen.label || `Screen ${idx + 1}`}
                      </span>
                      {hasDevice && (
                        <span className="text-[9px] text-zinc-500 truncate max-w-full">
                          {screen.device_name}
                        </span>
                      )}
                      {hasDevice && (
                        <span className={`w-1.5 h-1.5 rounded-full ${isOnline ? 'bg-emerald-400 animate-pulse-soft' : 'bg-zinc-600'}`} />
                      )}
                    </div>

                    {screen.playlist_name && (
                      <div className="absolute bottom-0 inset-x-0 bg-black/60 backdrop-blur-sm px-2 py-1">
                        <span className="text-[9px] text-accent truncate block">{screen.playlist_name}</span>
                      </div>
                    )}

                    {isSelected && (
                      <div className="absolute top-1 right-1">
                        <div className="w-4 h-4 rounded-full bg-accent flex items-center justify-center">
                          <Check size={10} className="text-white" />
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex items-center gap-4 mt-4 text-[11px] text-zinc-500">
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400" /> Online
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-zinc-600" /> Offline
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full border border-dashed border-zinc-600" /> Unassigned
            </span>
          </div>
        </div>

        {/* Right Panel */}
        <div className="space-y-4">
          {selected ? (
            <>
              <div className="card">
                <h2 className="text-sm font-semibold text-zinc-200 mb-3">
                  Screen {selectedIdx + 1} — {selected.label || 'Untitled'}
                </h2>
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-zinc-400 mb-1">Label</label>
                    <input type="text" value={selected.label || ''} className="w-full"
                      onChange={(e) => updateScreen(selectedIdx, 'label', e.target.value)} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-zinc-400 mb-1">Assign Device</label>
                    <select value={selected.device_id || ''} className="w-full"
                      onChange={(e) => updateScreen(selectedIdx, 'device_id', e.target.value || null)}>
                      <option value="">No device</option>
                      {devices.map(d => (
                        <option key={d.id} value={d.id} disabled={usedDeviceIds.includes(d.id) && d.id !== selected.device_id}>
                          {d.name} ({d.status}) {usedDeviceIds.includes(d.id) && d.id !== selected.device_id ? '(in use)' : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-zinc-400 mb-1">Playlist</label>
                    <select value={selected.playlist_id || ''} className="w-full"
                      onChange={(e) => updateScreen(selectedIdx, 'playlist_id', e.target.value ? parseInt(e.target.value) : null)}>
                      <option value="">None</option>
                      {playlists.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-zinc-400 mb-1">Orientation</label>
                    <div className="grid grid-cols-2 gap-2">
                      {['portrait', 'landscape'].map(o => (
                        <button key={o} type="button"
                          onClick={() => updateScreen(selectedIdx, 'orientation', o)}
                          className={`p-2 rounded-lg border text-xs capitalize transition-all ${
                            selected.orientation === o
                              ? 'border-accent bg-accent/10 text-accent'
                              : 'border-surface-border bg-surface-overlay text-zinc-400'
                          }`}>
                          <div className="flex justify-center mb-1">
                            <div className={`rounded border border-current ${o === 'portrait' ? 'w-3 h-5' : 'w-5 h-3'}`} />
                          </div>
                          {o}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {selected.device_id && selected.device_screenshot && (
                <div className="card">
                  <h3 className="text-xs font-semibold text-zinc-400 mb-2">Live Screenshot</h3>
                  <img src={selected.device_screenshot} alt="Screenshot"
                    className="w-full rounded-lg border border-surface-border" />
                </div>
              )}

              {selected.device_id && (
                <div className="card">
                  <h3 className="text-xs font-semibold text-zinc-400 mb-2">Device Status</h3>
                  <div className="flex items-center gap-2">
                    <StatusBadge status={selected.device_status || 'offline'} />
                    <span className="text-xs text-zinc-500">{selected.device_name}</span>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="card flex flex-col items-center justify-center py-12 text-center">
              <Monitor size={32} className="text-zinc-600 mb-3" />
              <p className="text-sm text-zinc-400">Select a screen</p>
              <p className="text-xs text-zinc-600 mt-1">Click any screen in the wall to configure it</p>
            </div>
          )}

          <div className="card">
            <h3 className="text-xs font-semibold text-zinc-400 mb-2">All Screens</h3>
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {screens.map((s, idx) => (
                <button key={idx} onClick={() => setSelectedIdx(idx)}
                  className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left transition-colors
                    ${selectedIdx === idx ? 'bg-accent/10 text-accent' : 'hover:bg-surface-hover text-zinc-400'}`}>
                  <Monitor size={12} />
                  <span className="text-xs flex-1 truncate">{s.label || `Screen ${idx + 1}`}</span>
                  {s.device_id && <span className={`w-1.5 h-1.5 rounded-full ${s.device_status === 'online' ? 'bg-emerald-400' : 'bg-zinc-600'}`} />}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Full Preview Modal */}
      <Modal open={showPreview} onClose={() => setShowPreview(false)} title="Wall Preview" wide>
        <div className="flex items-center justify-center py-4">
          <div className="grid rounded-xl overflow-hidden" style={{
            gridTemplateColumns: `repeat(${wall.cols}, 1fr)`,
            gap: `${Math.max(1, (wall.bezel_mm || 5) / 2)}px`,
            background: wall.bg_color || '#1a1a1a',
            padding: '8px',
            maxWidth: '100%',
          }}>
            {screens.map((screen, idx) => (
              <div key={idx}
                className="bg-black rounded overflow-hidden relative"
                style={{ aspectRatio: '9/16', minWidth: '100px' }}>
                {screen.device_screenshot ? (
                  <img src={screen.device_screenshot} alt="" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center text-zinc-600">
                    <Monitor size={20} className="mb-1" />
                    <span className="text-[10px]">{screen.label || `Screen ${idx + 1}`}</span>
                  </div>
                )}
                <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/80 to-transparent p-2">
                  <span className="text-[10px] text-white font-medium">{screen.label}</span>
                  {screen.playlist_name && (
                    <span className="text-[9px] text-accent block">{screen.playlist_name}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </Modal>

      {/* Settings Modal */}
      <Modal open={showSettings} onClose={() => setShowSettings(false)} title="Wall Settings">
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1.5">Name</label>
            <input type="text" defaultValue={wall.name}
              onBlur={(e) => e.target.value !== wall.name && handleUpdateWall({ name: e.target.value })}
              className="w-full" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1.5">Columns</label>
              <input type="number" defaultValue={wall.cols} className="w-full" min={1} max={10}
                onBlur={(e) => {
                  const v = parseInt(e.target.value);
                  if (v !== wall.cols) handleUpdateWall({ cols: v });
                }} />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1.5">Rows</label>
              <input type="number" defaultValue={wall.rows} className="w-full" min={1} max={10}
                onBlur={(e) => {
                  const v = parseInt(e.target.value);
                  if (v !== wall.rows) handleUpdateWall({ rows: v });
                }} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1.5">Bezel Gap (mm)</label>
              <input type="number" defaultValue={wall.bezel_mm} className="w-full" min={0} max={50} step={0.5}
                onBlur={(e) => handleUpdateWall({ bezel_mm: parseFloat(e.target.value) })} />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1.5">Background</label>
              <input type="color" defaultValue={wall.bg_color || '#1a1a1a'}
                onChange={(e) => handleUpdateWall({ bg_color: e.target.value })}
                className="w-full h-9 rounded-lg cursor-pointer" />
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}
