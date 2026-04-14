import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import Modal from '../components/Modal';
import EmptyState from '../components/EmptyState';
import toast from 'react-hot-toast';
import { LayoutGrid, Plus, Trash2, Monitor, Rows3 } from 'lucide-react';

export default function DisplayWalls() {
  const [walls, setWalls] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', cols: 1, rows: 3 });
  const navigate = useNavigate();

  const fetchWalls = () => {
    api.get('/walls').then(d => { setWalls(d.walls); setLoading(false); });
  };

  useEffect(() => { fetchWalls(); }, []);

  const handleCreate = async () => {
    if (!form.name) return toast.error('Name required');
    try {
      const data = await api.post('/walls', form);
      toast.success('Wall created');
      setShowCreate(false);
      setForm({ name: '', description: '', cols: 1, rows: 3 });
      navigate(`/walls/${data.wall.id}`);
    } catch (err) { toast.error(err.message); }
  };

  const handleDelete = async (id, e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm('Delete this display wall?')) return;
    await api.delete(`/walls/${id}`);
    fetchWalls();
    toast.success('Wall deleted');
  };

  const presets = [
    { label: '3 Vertical (Menu)', cols: 1, rows: 3, icon: '▮▮▮' },
    { label: '2 Horizontal', cols: 2, rows: 1, icon: '▬▬' },
    { label: '2x2 Grid', cols: 2, rows: 2, icon: '▦' },
    { label: '3 Horizontal', cols: 3, rows: 1, icon: '▬▬▬' },
    { label: '1 + 2 Stack', cols: 1, rows: 2, icon: '▮▮' },
    { label: '3x3 Video Wall', cols: 3, rows: 3, icon: '▣' },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-zinc-100">Display Walls</h1>
          <p className="text-sm text-zinc-500 mt-0.5">Design multi-screen installations visually</p>
        </div>
        <button onClick={() => setShowCreate(true)} className="btn-primary">
          <Plus size={15} /> New Wall
        </button>
      </div>

      {loading ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {Array(3).fill(0).map((_, i) => <div key={i} className="h-48 bg-surface rounded-xl animate-pulse" />)}
        </div>
      ) : walls.length === 0 ? (
        <EmptyState icon={LayoutGrid} title="No display walls"
          description="Create a wall to visually arrange multiple screens — perfect for menu boards, video walls, and multi-display setups."
          action={<button onClick={() => setShowCreate(true)} className="btn-primary"><Plus size={14} /> Create Wall</button>} />
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {walls.map(wall => (
            <Link key={wall.id} to={`/walls/${wall.id}`}
              className="card hover:border-accent/30 transition-all duration-200 group">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2.5">
                  <div className="w-10 h-10 rounded-xl bg-cyan-500/10 flex items-center justify-center">
                    <LayoutGrid size={18} className="text-cyan-400" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-zinc-200">{wall.name}</h3>
                    <p className="text-xs text-zinc-500">{wall.screen_count} screen{wall.screen_count !== 1 && 's'}</p>
                  </div>
                </div>
                <button onClick={(e) => handleDelete(wall.id, e)}
                  className="p-1.5 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-red-500/10 text-zinc-500 hover:text-red-400 transition-all">
                  <Trash2 size={14} />
                </button>
              </div>

              <div className="flex items-center justify-center py-4">
                <div className="grid gap-1" style={{
                  gridTemplateColumns: `repeat(${wall.cols}, ${wall.cols > 2 ? '28px' : '48px'})`,
                  gridTemplateRows: `repeat(${wall.rows}, ${wall.rows > 2 ? '18px' : '30px'})`,
                }}>
                  {Array(wall.cols * wall.rows).fill(0).map((_, i) => (
                    <div key={i} className="rounded bg-surface-overlay border border-surface-border" />
                  ))}
                </div>
              </div>

              <div className="text-xs text-zinc-500 text-center">
                {wall.cols} x {wall.rows} layout
                {wall.description && <span className="ml-2">&middot; {wall.description}</span>}
              </div>
            </Link>
          ))}
        </div>
      )}

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="Create Display Wall">
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1.5">Name</label>
            <input type="text" value={form.name} onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="Lobby Menu Wall" className="w-full" autoFocus />
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1.5">Description</label>
            <input type="text" value={form.description} onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder="3 vertical screens in the lobby" className="w-full" />
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-2">Quick Presets</label>
            <div className="grid grid-cols-3 gap-2">
              {presets.map(p => (
                <button key={p.label} type="button"
                  onClick={() => setForm(f => ({ ...f, cols: p.cols, rows: p.rows }))}
                  className={`p-3 rounded-lg border text-center transition-all ${
                    form.cols === p.cols && form.rows === p.rows
                      ? 'border-accent bg-accent/10 text-accent'
                      : 'border-surface-border bg-surface-overlay text-zinc-400 hover:text-zinc-200 hover:border-zinc-600'
                  }`}>
                  <div className="text-2xl mb-1">{p.icon}</div>
                  <div className="text-[10px]">{p.label}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1.5">Columns</label>
              <input type="number" value={form.cols} onChange={(e) => setForm(f => ({ ...f, cols: parseInt(e.target.value) || 1 }))}
                className="w-full" min={1} max={10} />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1.5">Rows</label>
              <input type="number" value={form.rows} onChange={(e) => setForm(f => ({ ...f, rows: parseInt(e.target.value) || 1 }))}
                className="w-full" min={1} max={10} />
            </div>
          </div>

          <div className="flex items-center justify-center py-4 bg-surface-overlay rounded-xl">
            <div className="grid gap-1.5" style={{
              gridTemplateColumns: `repeat(${form.cols}, 50px)`,
              gridTemplateRows: `repeat(${form.rows}, 32px)`,
            }}>
              {Array(form.cols * form.rows).fill(0).map((_, i) => (
                <div key={i} className="rounded-md bg-accent/20 border border-accent/30 flex items-center justify-center">
                  <Monitor size={10} className="text-accent/60" />
                </div>
              ))}
            </div>
          </div>

          <div className="flex gap-2 justify-end pt-2">
            <button onClick={() => setShowCreate(false)} className="btn-secondary">Cancel</button>
            <button onClick={handleCreate} className="btn-primary">Create Wall</button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
