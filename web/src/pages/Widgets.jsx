import { useEffect, useState } from 'react';
import { api } from '../api/client';
import Modal from '../components/Modal';
import EmptyState from '../components/EmptyState';
import toast from 'react-hot-toast';
import { Puzzle, Plus, Trash2, Edit3, Clock, Cloud, Type, Rss, QrCode, Hash, Code, Eye } from 'lucide-react';

const widgetTypes = [
  { type: 'clock', label: 'Clock', icon: Clock, color: 'text-blue-400', desc: 'Digital clock with date' },
  { type: 'weather', label: 'Weather', icon: Cloud, color: 'text-amber-400', desc: 'Weather display widget' },
  { type: 'ticker', label: 'News Ticker', icon: Type, color: 'text-emerald-400', desc: 'Scrolling text ticker' },
  { type: 'rss', label: 'RSS Feed', icon: Rss, color: 'text-orange-400', desc: 'RSS feed display' },
  { type: 'qr', label: 'QR Code', icon: QrCode, color: 'text-violet-400', desc: 'Dynamic QR code' },
  { type: 'counter', label: 'Counter', icon: Hash, color: 'text-pink-400', desc: 'Animated counter' },
  { type: 'custom_html', label: 'Custom HTML', icon: Code, color: 'text-cyan-400', desc: 'Custom HTML widget' },
];

const defaultConfigs = {
  clock: { hour12: true, showDate: true, timezone: '' },
  weather: { location: 'New York', unit: 'F', icon: '☀️', temp: '72' },
  ticker: { messages: ['Welcome to our store!', 'Special offers today!'], speed: 20 },
  rss: { url: '', maxItems: 5 },
  qr: { url: 'https://example.com', label: 'Scan me' },
  counter: { label: 'Visitors', value: 1234, prefix: '', suffix: '' },
  custom_html: { html: '<div style="color:white;padding:20px;">Custom content</div>' },
};

export default function Widgets() {
  const [widgets, setWidgets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [showPreview, setShowPreview] = useState(null);
  const [previewHtml, setPreviewHtml] = useState('');
  const [selectedType, setSelectedType] = useState(null);
  const [form, setForm] = useState({ name: '', type: '', config: {}, style: {} });

  const fetchWidgets = () => {
    api.get('/widgets').then(d => { setWidgets(d.widgets); setLoading(false); });
  };

  useEffect(() => { fetchWidgets(); }, []);

  const handleCreate = async () => {
    if (!form.name || !form.type) return toast.error('Name and type required');
    try {
      await api.post('/widgets', form);
      toast.success('Widget created');
      setShowCreate(false);
      setSelectedType(null);
      setForm({ name: '', type: '', config: {}, style: {} });
      fetchWidgets();
    } catch (err) { toast.error(err.message); }
  };

  const handlePreview = async (widget) => {
    try {
      const data = await api.get(`/widgets/${widget.id}/preview`);
      setPreviewHtml(data.html);
      setShowPreview(widget);
    } catch (err) { toast.error(err.message); }
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this widget?')) return;
    await api.delete(`/widgets/${id}`);
    fetchWidgets();
    toast.success('Widget deleted');
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-zinc-100">Widgets</h1>
          <p className="text-sm text-zinc-500 mt-0.5">Overlay widgets for clocks, tickers, weather, QR codes, and more</p>
        </div>
        <button onClick={() => setShowCreate(true)} className="btn-primary">
          <Plus size={15} /> New Widget
        </button>
      </div>

      {loading ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {Array(3).fill(0).map((_, i) => <div key={i} className="h-36 bg-surface rounded-xl animate-pulse" />)}
        </div>
      ) : widgets.length === 0 ? (
        <EmptyState icon={Puzzle} title="No widgets yet"
          description="Create overlay widgets like clocks, news tickers, and QR codes to enhance your displays."
          action={<button onClick={() => setShowCreate(true)} className="btn-primary"><Plus size={14} /> Create Widget</button>} />
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {widgets.map(widget => {
            const wt = widgetTypes.find(t => t.type === widget.type);
            const Icon = wt?.icon || Puzzle;
            const color = wt?.color || 'text-zinc-400';

            return (
              <div key={widget.id} className="card group">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2.5">
                    <div className={`w-10 h-10 rounded-xl ${color.replace('text-', 'bg-').replace('400', '400/10')} flex items-center justify-center`}>
                      <Icon size={18} className={color} />
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-zinc-200">{widget.name}</h3>
                      <p className="text-xs text-zinc-500 capitalize">{widget.type.replace('_', ' ')}</p>
                    </div>
                  </div>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => handlePreview(widget)} className="p-1.5 rounded-lg hover:bg-surface-hover text-zinc-500 hover:text-accent">
                      <Eye size={13} />
                    </button>
                    <button onClick={() => handleDelete(widget.id)} className="p-1.5 rounded-lg hover:bg-red-500/10 text-zinc-500 hover:text-red-400">
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
                <div className="text-xs text-zinc-500">
                  {widget.type === 'ticker' && widget.config.messages && (
                    <span>{widget.config.messages.length} messages</span>
                  )}
                  {widget.type === 'clock' && <span>{widget.config.hour12 ? '12-hour' : '24-hour'} format</span>}
                  {widget.type === 'weather' && <span>{widget.config.location}</span>}
                  {widget.type === 'qr' && <span className="truncate block">{widget.config.url}</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create Modal */}
      <Modal open={showCreate} onClose={() => { setShowCreate(false); setSelectedType(null); }} title="Create Widget" wide>
        {!selectedType ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {widgetTypes.map(wt => (
              <button key={wt.type} onClick={() => {
                setSelectedType(wt.type);
                setForm({ name: '', type: wt.type, config: defaultConfigs[wt.type] || {}, style: {} });
              }}
                className="p-4 rounded-xl bg-surface-overlay hover:bg-surface-hover border border-surface-border
                  hover:border-accent/30 transition-all text-left group">
                <div className={`w-10 h-10 rounded-xl ${wt.color.replace('text-', 'bg-').replace('400', '400/10')} flex items-center justify-center mb-3`}>
                  <wt.icon size={20} className={wt.color} />
                </div>
                <h3 className="text-sm font-semibold text-zinc-200 mb-0.5">{wt.label}</h3>
                <p className="text-xs text-zinc-500">{wt.desc}</p>
              </button>
            ))}
          </div>
        ) : (
          <div className="space-y-3">
            <button onClick={() => setSelectedType(null)} className="text-xs text-accent hover:text-accent-hover">
              ← Back to widget types
            </button>
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1.5">Widget Name</label>
              <input type="text" value={form.name} onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder={`My ${widgetTypes.find(t => t.type === selectedType)?.label}`} className="w-full" autoFocus />
            </div>

            {selectedType === 'clock' && (
              <div className="grid grid-cols-2 gap-3">
                <label className="flex items-center gap-2 p-3 rounded-lg bg-surface-overlay cursor-pointer">
                  <input type="checkbox" checked={form.config.hour12}
                    onChange={(e) => setForm(f => ({ ...f, config: { ...f.config, hour12: e.target.checked } }))} />
                  <span className="text-sm text-zinc-300">12-hour format</span>
                </label>
                <label className="flex items-center gap-2 p-3 rounded-lg bg-surface-overlay cursor-pointer">
                  <input type="checkbox" checked={form.config.showDate}
                    onChange={(e) => setForm(f => ({ ...f, config: { ...f.config, showDate: e.target.checked } }))} />
                  <span className="text-sm text-zinc-300">Show date</span>
                </label>
              </div>
            )}

            {selectedType === 'ticker' && (
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1.5">Messages (one per line)</label>
                <textarea value={(form.config.messages || []).join('\n')}
                  onChange={(e) => setForm(f => ({
                    ...f, config: { ...f.config, messages: e.target.value.split('\n').filter(Boolean) }
                  }))}
                  className="w-full" rows={4} placeholder="Breaking: Special offer today!&#10;Welcome to our store" />
                <div className="mt-2">
                  <label className="block text-xs font-medium text-zinc-400 mb-1.5">Speed (seconds per cycle)</label>
                  <input type="number" value={form.config.speed || 20}
                    onChange={(e) => setForm(f => ({ ...f, config: { ...f.config, speed: parseInt(e.target.value) } }))}
                    className="w-full" min={5} max={120} />
                </div>
              </div>
            )}

            {selectedType === 'weather' && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1.5">Location</label>
                  <input type="text" value={form.config.location || ''}
                    onChange={(e) => setForm(f => ({ ...f, config: { ...f.config, location: e.target.value } }))}
                    className="w-full" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1.5">Unit</label>
                  <select value={form.config.unit || 'F'}
                    onChange={(e) => setForm(f => ({ ...f, config: { ...f.config, unit: e.target.value } }))}
                    className="w-full">
                    <option value="F">Fahrenheit</option>
                    <option value="C">Celsius</option>
                  </select>
                </div>
              </div>
            )}

            {selectedType === 'qr' && (
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1.5">URL</label>
                  <input type="url" value={form.config.url || ''}
                    onChange={(e) => setForm(f => ({ ...f, config: { ...f.config, url: e.target.value } }))}
                    className="w-full" placeholder="https://..." />
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1.5">Label (optional)</label>
                  <input type="text" value={form.config.label || ''}
                    onChange={(e) => setForm(f => ({ ...f, config: { ...f.config, label: e.target.value } }))}
                    className="w-full" placeholder="Scan for menu" />
                </div>
              </div>
            )}

            {selectedType === 'custom_html' && (
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1.5">HTML Content</label>
                <textarea value={form.config.html || ''}
                  onChange={(e) => setForm(f => ({ ...f, config: { ...f.config, html: e.target.value } }))}
                  className="w-full font-mono text-xs" rows={8} />
              </div>
            )}

            <div className="flex gap-2 justify-end pt-2">
              <button onClick={() => { setShowCreate(false); setSelectedType(null); }} className="btn-secondary">Cancel</button>
              <button onClick={handleCreate} className="btn-primary">Create Widget</button>
            </div>
          </div>
        )}
      </Modal>

      {/* Preview Modal */}
      <Modal open={!!showPreview} onClose={() => setShowPreview(null)} title={showPreview?.name || 'Preview'}>
        <div className="rounded-xl overflow-hidden border border-surface-border bg-black min-h-[200px]"
          dangerouslySetInnerHTML={{ __html: previewHtml }} />
      </Modal>
    </div>
  );
}
