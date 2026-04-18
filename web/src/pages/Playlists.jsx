import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import Modal from '../components/Modal';
import EmptyState from '../components/EmptyState';
import toast from 'react-hot-toast';
import { ListVideo, Plus, Trash2, Search, Edit3, Monitor, Copy } from 'lucide-react';

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
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', layout: 'fullscreen', transition: 'fade' });
  const navigate = useNavigate();

  const fetchPlaylists = () => {
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    api.get(`/playlists?${params}`).then(d => { setPlaylists(d.playlists); setLoading(false); });
  };

  useEffect(() => { fetchPlaylists(); }, [search]);

  const handleCreate = async () => {
    if (!form.name) return toast.error('Name is required');
    try {
      const data = await api.post('/playlists', form);
      toast.success('Playlist created');
      setShowCreate(false);
      setForm({ name: '', description: '', layout: 'fullscreen', transition: 'fade' });
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
          <h1 className="text-2xl font-bold text-zinc-100">Playlists</h1>
          <p className="text-sm text-zinc-500 mt-0.5">{playlists.length} playlist{playlists.length !== 1 && 's'}</p>
        </div>
        <button onClick={() => setShowCreate(true)} className="btn-primary">
          <Plus size={15} /> New Playlist
        </button>
      </div>

      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
        <input type="search" placeholder="Search playlists..." value={search}
          onChange={(e) => setSearch(e.target.value)} className="w-full pl-9" />
      </div>

      {loading ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {Array(6).fill(0).map((_, i) => <div key={i} className="h-36 bg-surface rounded-xl animate-pulse" />)}
        </div>
      ) : playlists.length === 0 ? (
        <EmptyState icon={ListVideo} title="No playlists" description="Create playlists to organize your content for displays."
          action={<button onClick={() => setShowCreate(true)} className="btn-primary"><Plus size={14} /> Create Playlist</button>} />
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {playlists.map((playlist) => (
            <Link key={playlist.id} to={`/playlists/${playlist.id}`}
              className="card hover:border-accent/30 transition-all duration-200 group">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2.5">
                  <div className="w-10 h-10 rounded-xl bg-violet-500/10 flex items-center justify-center group-hover:bg-violet-500/20 transition-colors">
                    <ListVideo size={18} className="text-violet-400" />
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
                <span className="badge bg-surface-overlay">{playlist.is_system ? 'System' : (layoutLabels[playlist.layout] || playlist.layout)}</span>
                <span className="capitalize">{playlist.transition}</span>
              </div>
            </Link>
          ))}
        </div>
      )}

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="Create Playlist">
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1.5">Name</label>
            <input type="text" value={form.name} onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="My Playlist" className="w-full" autoFocus />
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1.5">Description</label>
            <textarea value={form.description} onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder="Optional description" className="w-full" rows={2} />
          </div>
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
          <div className="flex gap-2 justify-end pt-2">
            <button onClick={() => setShowCreate(false)} className="btn-secondary">Cancel</button>
            <button onClick={handleCreate} className="btn-primary">Create</button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
