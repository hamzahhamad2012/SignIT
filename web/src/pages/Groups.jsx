import { useEffect, useState } from 'react';
import { api } from '../api/client';
import Modal from '../components/Modal';
import EmptyState from '../components/EmptyState';
import toast from 'react-hot-toast';
import { FolderOpen, Plus, Trash2, Edit3, Monitor, Save, X } from 'lucide-react';

export default function Groups() {
  const [groups, setGroups] = useState([]);
  const [playlists, setPlaylists] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({ name: '', description: '', color: '#3b82f6', default_playlist_id: '' });

  const fetchGroups = () => {
    Promise.all([api.get('/groups'), api.get('/playlists')])
      .then(([g, p]) => { setGroups(g.groups); setPlaylists(p.playlists); setLoading(false); });
  };

  useEffect(() => { fetchGroups(); }, []);

  const handleCreate = async () => {
    if (!form.name) return toast.error('Name required');
    try {
      await api.post('/groups', {
        ...form,
        default_playlist_id: form.default_playlist_id ? parseInt(form.default_playlist_id) : null,
      });
      toast.success('Group created');
      setShowCreate(false);
      setForm({ name: '', description: '', color: '#3b82f6', default_playlist_id: '' });
      fetchGroups();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleUpdate = async (id, updates) => {
    await api.put(`/groups/${id}`, updates);
    setEditingId(null);
    fetchGroups();
    toast.success('Group updated');
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this group? Devices will be unassigned.')) return;
    await api.delete(`/groups/${id}`);
    fetchGroups();
    toast.success('Group deleted');
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-zinc-100">Groups</h1>
          <p className="text-sm text-zinc-500 mt-0.5">Organize displays into logical groups</p>
        </div>
        <button onClick={() => setShowCreate(true)} className="btn-primary">
          <Plus size={15} /> New Group
        </button>
      </div>

      {loading ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {Array(3).fill(0).map((_, i) => <div key={i} className="h-36 bg-surface rounded-xl animate-pulse" />)}
        </div>
      ) : groups.length === 0 ? (
        <EmptyState icon={FolderOpen} title="No groups" description="Create groups to organize your displays and apply bulk settings."
          action={<button onClick={() => setShowCreate(true)} className="btn-primary"><Plus size={14} /> Create Group</button>} />
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {groups.map((group) => (
            <div key={group.id} className="card">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2.5">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: `${group.color}20` }}>
                    <FolderOpen size={18} style={{ color: group.color }} />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-zinc-200">{group.name}</h3>
                    <p className="text-xs text-zinc-500">{group.device_count} device{group.device_count !== 1 && 's'}</p>
                  </div>
                </div>
                <div className="flex gap-1">
                  <button onClick={() => { setEditingId(group.id); setForm({ name: group.name, description: group.description || '', color: group.color, default_playlist_id: group.default_playlist_id || '' }); }}
                    className="p-1.5 rounded-lg hover:bg-surface-hover text-zinc-500 hover:text-zinc-300">
                    <Edit3 size={13} />
                  </button>
                  <button onClick={() => handleDelete(group.id)}
                    className="p-1.5 rounded-lg hover:bg-red-500/10 text-zinc-500 hover:text-red-400">
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>

              {group.description && (
                <p className="text-xs text-zinc-500 mb-3">{group.description}</p>
              )}

              <div className="flex items-center gap-2 text-xs text-zinc-500">
                <Monitor size={12} />
                <span>Default playlist: <span className="text-zinc-300">{group.playlist_name || 'None'}</span></span>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={showCreate || !!editingId} onClose={() => { setShowCreate(false); setEditingId(null); }}
        title={editingId ? 'Edit Group' : 'Create Group'}>
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1.5">Name</label>
            <input type="text" value={form.name} onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="Lobby Displays" className="w-full" autoFocus />
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1.5">Description</label>
            <textarea value={form.description} onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder="Optional description" className="w-full" rows={2} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1.5">Color</label>
              <input type="color" value={form.color} onChange={(e) => setForm(f => ({ ...f, color: e.target.value }))}
                className="w-full h-9 rounded-lg cursor-pointer" />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1.5">Default Playlist</label>
              <select value={form.default_playlist_id} onChange={(e) => setForm(f => ({ ...f, default_playlist_id: e.target.value }))} className="w-full">
                <option value="">None</option>
                {playlists.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          </div>
          <div className="flex gap-2 justify-end pt-2">
            <button onClick={() => { setShowCreate(false); setEditingId(null); }} className="btn-secondary">Cancel</button>
            <button onClick={() => editingId
              ? handleUpdate(editingId, { ...form, default_playlist_id: form.default_playlist_id ? parseInt(form.default_playlist_id) : null })
              : handleCreate()
            } className="btn-primary">
              {editingId ? 'Update' : 'Create'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
