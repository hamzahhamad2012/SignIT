import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import Modal from '../components/Modal';
import LivePreview from '../components/LivePreview';
import toast from 'react-hot-toast';
import {
  ArrowLeft, Save, Plus, Trash2, GripVertical, Image, Film,
  Globe, Code, Clock, Monitor, Rocket, Settings2, Play, Folder,
} from 'lucide-react';

const typeIcons = { image: Image, video: Film, url: Globe, html: Code, widget: Code, stream: Globe };
const isRtspUrl = (value) => /^rtsps?:\/\//i.test(String(value || '').trim());
const getEffectiveType = (item) => isRtspUrl(item?.url) ? 'stream' : item?.asset_type || item?.type;

export default function PlaylistEditor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [playlist, setPlaylist] = useState(null);
  const [items, setItems] = useState([]);
  const [assets, setAssets] = useState([]);
  const [assetFolders, setAssetFolders] = useState([]);
  const [assetFolderFilter, setAssetFolderFilter] = useState('all');
  const [devices, setDevices] = useState([]);
  const [groups, setGroups] = useState([]);
  const [showAddAsset, setShowAddAsset] = useState(false);
  const [showDeploy, setShowDeploy] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selectedDevices, setSelectedDevices] = useState([]);
  const [deployGroup, setDeployGroup] = useState('');
  const [dragIdx, setDragIdx] = useState(null);

  useEffect(() => {
    api.get(`/playlists/${id}`).then(d => {
      setPlaylist(d.playlist);
      setItems(d.playlist.items || []);
    }).catch(() => navigate('/playlists'));
    api.get('/assets').then(d => setAssets(d.assets));
    api.get('/assets/folders').then(d => setAssetFolders(d.folders || []));
    api.get('/devices').then(d => setDevices(d.devices));
    api.get('/groups').then(d => setGroups(d.groups));
  }, [id]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const ordered = items.map((item, idx) => ({
        asset_id: item.asset_id,
        zone: item.zone || 'main',
        position: idx,
        duration: item.duration || 10,
        fit: item.fit || 'cover',
        muted: item.muted !== undefined ? item.muted : 1,
        settings: item.settings || {},
      }));
      await api.put(`/playlists/${id}/items`, { items: ordered });
      setHasChanges(false);
      toast.success('Playlist saved');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleUpdatePlaylist = async (updates) => {
    await api.put(`/playlists/${id}`, updates);
    setPlaylist(prev => ({ ...prev, ...updates }));
    toast.success('Settings updated');
  };

  const addAsset = (asset) => {
    const assetType = isRtspUrl(asset.url) ? 'stream' : asset.type;
    const newItem = {
      id: Date.now(),
      asset_id: asset.id,
      asset_name: asset.name,
      asset_type: assetType,
      filename: asset.filename,
      url: asset.url,
      thumbnail: asset.thumbnail,
      zone: 'main',
      position: items.length,
      duration: assetType === 'video' ? (asset.duration || 30) : 10,
      fit: 'cover',
      muted: 1,
      settings: {},
    };
    setItems(prev => [...prev, newItem]);
    setHasChanges(true);
    setShowAddAsset(false);
  };

  const removeItem = (idx) => {
    setItems(prev => prev.filter((_, i) => i !== idx));
    setHasChanges(true);
  };

  const updateItem = (idx, field, value) => {
    setItems(prev => prev.map((item, i) => i === idx ? { ...item, [field]: value } : item));
    setHasChanges(true);
  };

  const handleDragStart = (idx) => setDragIdx(idx);
  const handleDragOver = (e, idx) => {
    e.preventDefault();
    if (dragIdx === null || dragIdx === idx) return;
    setItems(prev => {
      const next = [...prev];
      const [moved] = next.splice(dragIdx, 1);
      next.splice(idx, 0, moved);
      return next;
    });
    setDragIdx(idx);
    setHasChanges(true);
  };
  const handleDragEnd = () => setDragIdx(null);

  const handleDeploy = async () => {
    try {
      await api.post(`/playlists/${id}/deploy`, {
        device_ids: selectedDevices,
        group_id: deployGroup || undefined,
      });
      toast.success('Playlist deployed');
      setShowDeploy(false);
      setSelectedDevices([]);
      setDeployGroup('');
    } catch (err) {
      toast.error(err.message);
    }
  };

  const getThumb = (item) => {
    if (item.thumbnail) return `/uploads/thumbnails/${item.thumbnail}`;
    if (getEffectiveType(item) === 'image' && item.filename) return `/uploads/images/${item.filename}`;
    return null;
  };

  const visibleAssets = assets.filter((asset) => {
    if (assetFolderFilter === 'all') return true;
    if (assetFolderFilter === 'unfiled') return !asset.folder_id;
    return String(asset.folder_id) === String(assetFolderFilter);
  });

  if (!playlist) return <div className="h-64 flex items-center justify-center"><div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" /></div>;

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link to="/playlists" className="p-2 rounded-lg hover:bg-surface-hover text-zinc-400 hover:text-zinc-200 transition-colors">
            <ArrowLeft size={18} />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-zinc-100">{playlist.name}</h1>
            <p className="text-sm text-zinc-500">{items.length} items &middot; {playlist.layout} &middot; {playlist.transition}</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowSettings(true)} className="btn-secondary"><Settings2 size={15} /> Settings</button>
          <button onClick={() => setShowDeploy(true)} className="btn-secondary"><Rocket size={15} /> Deploy</button>
          <button onClick={handleSave} disabled={!hasChanges || saving}
            className={hasChanges ? 'btn-primary' : 'btn-secondary opacity-50'}>
            <Save size={15} /> {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-zinc-200">Playlist Items</h2>
            <button onClick={() => setShowAddAsset(true)} className="btn-primary text-xs">
              <Plus size={14} /> Add Content
            </button>
          </div>

          {items.length === 0 ? (
            <div className="py-12 text-center">
              <p className="text-sm text-zinc-500 mb-3">No content added yet</p>
              <button onClick={() => setShowAddAsset(true)} className="btn-secondary text-xs">
                <Plus size={14} /> Add your first item
              </button>
            </div>
          ) : (
            <div className="space-y-1">
              {items.map((item, idx) => {
                const effectiveType = getEffectiveType(item);
                const Icon = typeIcons[effectiveType] || Image;
                const thumb = getThumb(item);

                return (
                  <div
                    key={item.id || idx}
                    draggable
                    onDragStart={() => handleDragStart(idx)}
                    onDragOver={(e) => handleDragOver(e, idx)}
                    onDragEnd={handleDragEnd}
                    className={`flex items-center gap-3 p-3 rounded-lg bg-surface-overlay hover:bg-surface-hover
                      transition-all cursor-grab active:cursor-grabbing
                      ${dragIdx === idx ? 'opacity-50 scale-[0.98]' : ''}`}
                  >
                    <GripVertical size={16} className="text-zinc-600 shrink-0" />

                    <div className="w-14 h-10 rounded-lg bg-surface overflow-hidden shrink-0">
                      {thumb ? (
                        <img src={thumb} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <Icon size={16} className="text-zinc-500" />
                        </div>
                      )}
                    </div>

                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-zinc-300 truncate">{item.asset_name}</p>
                      <p className="text-xs text-zinc-500 capitalize">{effectiveType}</p>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <div className="flex items-center gap-1">
                        <Clock size={12} className="text-zinc-500" />
                        <input
                          type="number"
                          value={item.duration}
                          onChange={(e) => updateItem(idx, 'duration', parseInt(e.target.value) || 10)}
                          className="w-14 text-xs text-center py-1 px-1"
                          min={1}
                        />
                        <span className="text-xs text-zinc-500">s</span>
                      </div>
                      <select value={item.fit} onChange={(e) => updateItem(idx, 'fit', e.target.value)}
                        className="text-xs py-1 px-2 w-20">
                        <option value="cover">Cover</option>
                        <option value="contain">Contain</option>
                        <option value="fill">Fill</option>
                      </select>
                      <button onClick={() => removeItem(idx)} className="p-1.5 rounded-lg hover:bg-red-500/10 text-zinc-500 hover:text-red-400">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="card">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-zinc-200">Live Preview</h2>
              <Play size={14} className="text-accent" />
            </div>
            <LivePreview
              items={items}
              transition={playlist.transition}
              transitionDuration={playlist.transition_duration}
              bgColor={playlist.bg_color}
            />
          </div>

          {playlist.deployed_to && playlist.deployed_to.length > 0 && (
            <div className="card">
              <h2 className="text-sm font-semibold text-zinc-200 mb-3">Deployed To</h2>
              <div className="space-y-1">
                {playlist.deployed_to.map(d => (
                  <Link key={d.id} to={`/devices/${d.id}`}
                    className="flex items-center gap-2 py-1.5 px-2 rounded-lg hover:bg-surface-hover text-sm text-zinc-400 hover:text-zinc-200">
                    <Monitor size={14} /> {d.name}
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <Modal open={showAddAsset} onClose={() => setShowAddAsset(false)} title="Add Content" wide>
        <div className="flex items-center gap-2 mb-3">
          <Folder size={14} className="text-zinc-500" />
          <select value={assetFolderFilter} onChange={(e) => setAssetFolderFilter(e.target.value)} className="text-xs py-1.5">
            <option value="all">All media</option>
            <option value="unfiled">Unfiled</option>
            {assetFolders.map(folder => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
          </select>
        </div>
        {visibleAssets.length === 0 ? (
          <p className="text-sm text-zinc-500 py-8 text-center">No assets available. Upload content first.</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-[50vh] overflow-y-auto">
            {visibleAssets.map(asset => {
              const effectiveType = getEffectiveType(asset);
              const Icon = typeIcons[effectiveType] || Image;
              const thumb = asset.thumbnail ? `/uploads/thumbnails/${asset.thumbnail}`
                : effectiveType === 'image' && asset.filename ? `/uploads/images/${asset.filename}` : null;
              return (
                <button key={asset.id} onClick={() => addAsset(asset)}
                  className="p-2 rounded-lg bg-surface-overlay hover:bg-surface-hover border border-transparent hover:border-accent/30 transition-all text-left">
                  <div className="aspect-[4/3] rounded-lg bg-surface overflow-hidden mb-2">
                    {thumb ? (
                      <img src={thumb} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center"><Icon size={24} className="text-zinc-500" /></div>
                    )}
                  </div>
                  <p className="text-xs font-medium text-zinc-300 truncate">{asset.name}</p>
                  <p className="text-[10px] text-zinc-500 capitalize">{effectiveType}</p>
                  <p className="text-[10px] text-zinc-600 truncate">{asset.folder_name || 'Unfiled'}</p>
                </button>
              );
            })}
          </div>
        )}
      </Modal>

      <Modal open={showDeploy} onClose={() => setShowDeploy(false)} title="Deploy Playlist">
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-2">Deploy to Group</label>
            <select value={deployGroup} onChange={(e) => setDeployGroup(e.target.value)} className="w-full">
              <option value="">Select group...</option>
              {groups.map(g => <option key={g.id} value={g.id}>{g.name} ({g.device_count} devices)</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-2">Or select individual devices</label>
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {devices.map(d => (
                <label key={d.id} className="flex items-center gap-2 p-2 rounded-lg hover:bg-surface-hover cursor-pointer">
                  <input type="checkbox"
                    checked={selectedDevices.includes(d.id)}
                    onChange={(e) => {
                      setSelectedDevices(prev => e.target.checked ? [...prev, d.id] : prev.filter(x => x !== d.id));
                    }}
                    className="rounded border-surface-border bg-surface-raised text-accent focus:ring-accent"
                  />
                  <Monitor size={14} className="text-zinc-500" />
                  <span className="text-sm text-zinc-300">{d.name}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="flex gap-2 justify-end pt-2">
            <button onClick={() => setShowDeploy(false)} className="btn-secondary">Cancel</button>
            <button onClick={handleDeploy} className="btn-primary"
              disabled={!deployGroup && selectedDevices.length === 0}>
              <Rocket size={14} /> Deploy
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={showSettings} onClose={() => setShowSettings(false)} title="Playlist Settings">
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1.5">Name</label>
            <input type="text" defaultValue={playlist.name}
              onBlur={(e) => e.target.value !== playlist.name && handleUpdatePlaylist({ name: e.target.value })}
              className="w-full" />
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1.5">Description</label>
            <textarea defaultValue={playlist.description || ''}
              onBlur={(e) => handleUpdatePlaylist({ description: e.target.value })}
              className="w-full" rows={2} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1.5">Layout</label>
              <select defaultValue={playlist.layout}
                onChange={(e) => handleUpdatePlaylist({ layout: e.target.value })} className="w-full">
                <option value="fullscreen">Fullscreen</option>
                <option value="split-h">Split Horizontal</option>
                <option value="split-v">Split Vertical</option>
                <option value="grid-4">4-Grid</option>
                <option value="l-bar">L-Bar</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1.5">Transition</label>
              <select defaultValue={playlist.transition}
                onChange={(e) => handleUpdatePlaylist({ transition: e.target.value })} className="w-full">
                <option value="fade">Fade</option>
                <option value="slide-left">Slide Left</option>
                <option value="slide-right">Slide Right</option>
                <option value="slide-up">Slide Up</option>
                <option value="zoom">Zoom</option>
                <option value="none">None</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1.5">Transition Duration (ms)</label>
              <input type="number" defaultValue={playlist.transition_duration}
                onBlur={(e) => handleUpdatePlaylist({ transition_duration: parseInt(e.target.value) })}
                className="w-full" min={0} max={5000} step={100} />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1.5">Background Color</label>
              <input type="color" defaultValue={playlist.bg_color || '#000000'}
                onChange={(e) => handleUpdatePlaylist({ bg_color: e.target.value })}
                className="w-full h-9 rounded-lg cursor-pointer" />
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}
