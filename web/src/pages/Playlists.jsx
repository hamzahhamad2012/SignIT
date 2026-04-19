import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import Modal from '../components/Modal';
import EmptyState from '../components/EmptyState';
import toast from 'react-hot-toast';
import { ListVideo, Plus, Trash2, Search, Video } from 'lucide-react';

const layoutLabels = {
  fullscreen: 'Fullscreen',
  'split-h': 'Split Horizontal',
  'split-v': 'Split Vertical',
  'grid-4': '4-Grid',
  'l-bar': 'L-Bar',
  custom: 'Custom',
};

export default function Playlists() {
  const [playlists, setPlaylists] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [playlistType, setPlaylistType] = useState('media');
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({
    name: '',
    description: '',
    playlist_type: 'media',
    layout: 'fullscreen',
    transition: 'fade',
    layout_config: {},
  });
  const navigate = useNavigate();

  const fetchPlaylists = () => {
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    params.set('playlist_type', playlistType);
    api.get(`/playlists?${params}`).then(d => { setPlaylists(d.playlists); setLoading(false); });
  };

  useEffect(() => { fetchPlaylists(); }, [search, playlistType]);

  const handleCreate = async () => {
    if (!form.name) return toast.error('Name is required');
    try {
      const data = await api.post('/playlists', form);
      toast.success(form.playlist_type === 'stream' ? 'Camera Wall created' : 'Playlist created');
      setShowCreate(false);
      setForm({ name: '', description: '', playlist_type: playlistType, layout: 'fullscreen', transition: 'fade', layout_config: {} });
      navigate(`/playlists/${data.playlist.id}`);
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleDelete = async (id, e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm('Delete this playlist?')) return;
    await api.delete(`/playlists/${id}`);
    fetchPlaylists();
    toast.success('Playlist deleted');
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-zinc-100">{playlistType === 'stream' ? 'Camera Walls' : 'Media Playlists'}</h1>
          <p className="text-sm text-zinc-500 mt-0.5">
            {playlists.length} {playlistType === 'stream' ? 'camera wall' : 'playlist'}{playlists.length !== 1 && 's'}
          </p>
        </div>
        <button
          onClick={() => {
            setForm(f => ({
              ...f,
              playlist_type: playlistType,
              layout: playlistType === 'stream' ? 'custom' : 'fullscreen',
              transition: playlistType === 'stream' ? 'none' : 'fade',
              layout_config: playlistType === 'stream' ? { columns: 2, rows: 2, gap: 8, show_labels: true } : {},
            }));
            setShowCreate(true);
          }}
          className="btn-primary"
        >
          <Plus size={15} /> {playlistType === 'stream' ? 'New Camera Wall' : 'New Playlist'}
        </button>
      </div>

      <div className="flex flex-col lg:flex-row gap-3">
        <div className="grid grid-cols-2 gap-2 lg:w-[440px]">
          {[
            { value: 'media', label: 'Media Playlists', icon: ListVideo, helper: 'Images, videos, URLs, widgets' },
            { value: 'stream', label: 'Camera Walls', icon: Video, helper: 'RTSP/RTSPS live grids' },
          ].map(({ value, label, icon: Icon, helper }) => (
            <button
              key={value}
              onClick={() => setPlaylistType(value)}
              className={`rounded-xl border p-3 text-left transition-all ${playlistType === value
                ? 'border-accent/50 bg-accent/10 text-zinc-100'
                : 'border-surface-border bg-surface hover:bg-surface-hover text-zinc-400'
              }`}
            >
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Icon size={16} /> {label}
              </div>
              <p className="text-[11px] text-zinc-500 mt-1">{helper}</p>
            </button>
          ))}
        </div>
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
          <input type="search" placeholder={`Search ${playlistType === 'stream' ? 'camera walls' : 'playlists'}...`} value={search}
            onChange={(e) => setSearch(e.target.value)} className="w-full pl-9" />
        </div>
      </div>

      {loading ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {Array(6).fill(0).map((_, i) => <div key={i} className="h-36 bg-surface rounded-xl animate-pulse" />)}
        </div>
      ) : playlists.length === 0 ? (
        <EmptyState
          icon={playlistType === 'stream' ? Video : ListVideo}
          title={playlistType === 'stream' ? 'No camera walls' : 'No playlists'}
          description={playlistType === 'stream'
            ? 'Create a camera wall to arrange RTSP/RTSPS camera streams across a live display.'
            : 'Create playlists to organize your content for media displays.'}
          action={<button onClick={() => {
            setForm(f => ({
              ...f,
              playlist_type: playlistType,
              layout: playlistType === 'stream' ? 'custom' : 'fullscreen',
              transition: playlistType === 'stream' ? 'none' : 'fade',
              layout_config: playlistType === 'stream' ? { columns: 2, rows: 2, gap: 8, show_labels: true } : {},
            }));
            setShowCreate(true);
          }} className="btn-primary"><Plus size={14} /> {playlistType === 'stream' ? 'Create Camera Wall' : 'Create Playlist'}</button>}
        />
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {playlists.map((playlist) => (
            <Link key={playlist.id} to={`/playlists/${playlist.id}`}
              className="card hover:border-accent/30 transition-all duration-200 group">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2.5">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center transition-colors ${playlist.playlist_type === 'stream' ? 'bg-cyan-500/10 group-hover:bg-cyan-500/20' : 'bg-violet-500/10 group-hover:bg-violet-500/20'}`}>
                    {playlist.playlist_type === 'stream'
                      ? <Video size={18} className="text-cyan-400" />
                      : <ListVideo size={18} className="text-violet-400" />}
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-zinc-200 group-hover:text-zinc-100">{playlist.name}</h3>
                    <p className="text-xs text-zinc-500">{playlist.item_count} item{playlist.item_count !== 1 && 's'}</p>
                  </div>
                </div>
                {!playlist.is_system && (
                  <button onClick={(e) => handleDelete(playlist.id, e)}
                    className="p-1.5 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-red-500/10 text-zinc-500 hover:text-red-400 transition-all">
                    <Trash2 size={14} />
                  </button>
                )}
              </div>

              {playlist.description && (
                <p className="text-xs text-zinc-500 mb-3 line-clamp-2">{playlist.description}</p>
              )}

              <div className="flex items-center gap-3 text-xs text-zinc-500">
                <span className="badge bg-surface-overlay">{playlist.is_system ? 'System' : playlist.playlist_type === 'stream' ? 'Camera Wall' : (layoutLabels[playlist.layout] || playlist.layout)}</span>
                <span className="capitalize">{playlist.transition}</span>
              </div>
            </Link>
          ))}
        </div>
      )}

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title={form.playlist_type === 'stream' ? 'Create Camera Wall' : 'Create Playlist'}>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            {[
              { value: 'media', label: 'Media Playlist', helper: 'Standard signage content' },
              { value: 'stream', label: 'Camera Wall', helper: 'Live camera grid' },
            ].map(option => (
              <button
                key={option.value}
                type="button"
                onClick={() => setForm(f => ({
                  ...f,
                  playlist_type: option.value,
                  layout: option.value === 'stream' ? 'custom' : 'fullscreen',
                  transition: option.value === 'stream' ? 'none' : 'fade',
                  layout_config: option.value === 'stream' ? { columns: 2, rows: 2, gap: 8, show_labels: true } : {},
                }))}
                className={`rounded-xl border p-3 text-left ${form.playlist_type === option.value ? 'border-accent/50 bg-accent/10' : 'border-surface-border bg-surface-overlay'}`}
              >
                <p className="text-sm font-semibold text-zinc-200">{option.label}</p>
                <p className="text-[11px] text-zinc-500 mt-1">{option.helper}</p>
              </button>
            ))}
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1.5">Name</label>
            <input type="text" value={form.name} onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder={form.playlist_type === 'stream' ? 'Lobby Camera Wall' : 'My Playlist'} className="w-full" autoFocus />
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1.5">Description</label>
            <textarea value={form.description} onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder="Optional description" className="w-full" rows={2} />
          </div>
          {form.playlist_type === 'media' ? (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1.5">Layout</label>
              <select value={form.layout} onChange={(e) => setForm(f => ({ ...f, layout: e.target.value }))} className="w-full">
                {Object.entries(layoutLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1.5">Transition</label>
              <select value={form.transition} onChange={(e) => setForm(f => ({ ...f, transition: e.target.value }))} className="w-full">
                <option value="fade">Fade</option>
                <option value="slide-left">Slide Left</option>
                <option value="slide-right">Slide Right</option>
                <option value="slide-up">Slide Up</option>
                <option value="zoom">Zoom</option>
                <option value="none">None</option>
              </select>
            </div>
          </div>
          ) : (
            <div className="grid grid-cols-3 gap-3 rounded-xl border border-surface-border bg-surface-overlay p-3">
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1.5">Columns</label>
                <input
                  type="number"
                  min={1}
                  max={6}
                  value={form.layout_config?.columns || 2}
                  onChange={(e) => setForm(f => ({ ...f, layout_config: { ...(f.layout_config || {}), columns: parseInt(e.target.value) || 2 } }))}
                  className="w-full"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1.5">Rows</label>
                <input
                  type="number"
                  min={1}
                  max={6}
                  value={form.layout_config?.rows || 2}
                  onChange={(e) => setForm(f => ({ ...f, layout_config: { ...(f.layout_config || {}), rows: parseInt(e.target.value) || 2 } }))}
                  className="w-full"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1.5">Gap</label>
                <input
                  type="number"
                  min={0}
                  max={40}
                  value={form.layout_config?.gap ?? 8}
                  onChange={(e) => setForm(f => ({ ...f, layout_config: { ...(f.layout_config || {}), gap: parseInt(e.target.value) || 0 } }))}
                  className="w-full"
                />
              </div>
            </div>
          )}
          <div className="flex gap-2 justify-end pt-2">
            <button onClick={() => setShowCreate(false)} className="btn-secondary">Cancel</button>
            <button onClick={handleCreate} className="btn-primary">Create</button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
