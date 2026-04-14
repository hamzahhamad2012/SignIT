import { useEffect, useState, useRef } from 'react';
import { api } from '../api/client';
import Modal from '../components/Modal';
import EmptyState from '../components/EmptyState';
import toast from 'react-hot-toast';
import {
  Image, Film, Globe, Code, Search, Upload, Trash2,
  Eye, Edit3, Save, X, FileUp, Link as LinkIcon, FileText,
} from 'lucide-react';

const typeIcons = {
  image: Image, video: Film, url: Globe, html: Code, widget: Code, stream: Globe, pdf: FileText,
};
const typeColors = {
  image: 'text-amber-400', video: 'text-blue-400', url: 'text-emerald-400',
  html: 'text-pink-400', widget: 'text-violet-400', stream: 'text-cyan-400',
};

function formatBytes(bytes) {
  if (!bytes) return '—';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

export default function Assets() {
  const [assets, setAssets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState('');
  const [showUpload, setShowUpload] = useState(false);
  const [showUrl, setShowUrl] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState('');
  const [preview, setPreview] = useState(null);
  const [urlForm, setUrlForm] = useState({ name: '', type: 'url', url: '' });
  const fileRef = useRef(null);

  const fetchAssets = () => {
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (filterType) params.set('type', filterType);
    api.get(`/assets?${params}`).then(d => { setAssets(d.assets); setLoading(false); });
  };

  useEffect(() => { fetchAssets(); }, [search, filterType]);

  const handleUpload = async (files) => {
    setUploading(true);
    try {
      for (const file of files) {
        await api.upload('/assets', file, { name: file.name });
      }
      toast.success(`${files.length} file${files.length > 1 ? 's' : ''} uploaded`);
      fetchAssets();
      setShowUpload(false);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setUploading(false);
    }
  };

  const handleUrlAdd = async () => {
    if (!urlForm.url) return toast.error('URL is required');
    try {
      await api.post('/assets', urlForm);
      toast.success('URL added');
      setShowUrl(false);
      setUrlForm({ name: '', type: 'url', url: '' });
      fetchAssets();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleRename = async (id) => {
    await api.put(`/assets/${id}`, { name: editName });
    setEditingId(null);
    fetchAssets();
    toast.success('Asset renamed');
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this asset?')) return;
    await api.delete(`/assets/${id}`);
    fetchAssets();
    toast.success('Asset deleted');
  };

  const getAssetUrl = (asset) => {
    if (asset.url) return asset.url;
    if (asset.filename) {
      const subdir = asset.type === 'video' ? 'videos' : asset.type === 'html' ? 'html' : 'images';
      return `/uploads/${subdir}/${asset.filename}`;
    }
    return null;
  };

  const getThumbnailUrl = (asset) => {
    if (asset.thumbnail) return `/uploads/thumbnails/${asset.thumbnail}`;
    if (asset.type === 'image' && asset.filename) return `/uploads/images/${asset.filename}`;
    return null;
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-zinc-100">Assets</h1>
          <p className="text-sm text-zinc-500 mt-0.5">{assets.length} file{assets.length !== 1 && 's'} in library</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowUrl(true)} className="btn-secondary">
            <LinkIcon size={15} /> Add URL
          </button>
          <button onClick={() => setShowUpload(true)} className="btn-primary">
            <Upload size={15} /> Upload
          </button>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
          <input type="search" placeholder="Search assets..." value={search}
            onChange={(e) => setSearch(e.target.value)} className="w-full pl-9" />
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {['', 'image', 'video', 'url', 'html'].map((t) => (
            <button key={t} onClick={() => setFilterType(t)}
              className={`btn text-xs px-3 py-1.5 capitalize ${filterType === t
                ? 'bg-accent/15 text-accent border border-accent/30'
                : 'bg-surface-raised text-zinc-400 border border-surface-border hover:text-zinc-200'
              }`}>
              {t || 'All'}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
          {Array(10).fill(0).map((_, i) => <div key={i} className="aspect-[4/3] bg-surface rounded-xl animate-pulse" />)}
        </div>
      ) : assets.length === 0 ? (
        <EmptyState icon={Image} title="No assets yet" description="Upload images, videos, PDFs, or add URLs to build your content library."
          action={<button onClick={() => setShowUpload(true)} className="btn-primary"><Upload size={14} /> Upload Files</button>} />
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
          {assets.map((asset) => {
            const Icon = typeIcons[asset.type] || Image;
            const color = typeColors[asset.type] || 'text-zinc-400';
            const thumb = getThumbnailUrl(asset);

            return (
              <div key={asset.id} className="card p-0 overflow-hidden group">
                <div className="aspect-[4/3] bg-surface-overlay relative overflow-hidden cursor-pointer"
                  onClick={() => setPreview(asset)}>
                  {thumb ? (
                    <img src={thumb} alt={asset.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <Icon size={32} className={color} />
                    </div>
                  )}
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
                    <Eye size={24} className="text-white" />
                  </div>
                  <span className={`absolute top-2 right-2 badge ${color.replace('text-', 'bg-').replace('400', '400/15')} ${color}`}>
                    {asset.type}
                  </span>
                </div>
                <div className="p-3">
                  {editingId === asset.id ? (
                    <div className="flex gap-1">
                      <input type="text" value={editName} onChange={(e) => setEditName(e.target.value)}
                        className="flex-1 text-xs py-1 px-2" autoFocus onKeyDown={(e) => e.key === 'Enter' && handleRename(asset.id)} />
                      <button onClick={() => handleRename(asset.id)} className="p-1 text-accent"><Save size={12} /></button>
                      <button onClick={() => setEditingId(null)} className="p-1 text-zinc-500"><X size={12} /></button>
                    </div>
                  ) : (
                    <p className="text-sm font-medium text-zinc-300 truncate">{asset.name}</p>
                  )}
                  <p className="text-xs text-zinc-500 mt-0.5">{formatBytes(asset.size)}</p>
                  <div className="flex gap-1 mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => { setEditingId(asset.id); setEditName(asset.name); }}
                      className="btn-ghost text-xs p-1"><Edit3 size={12} /></button>
                    <button onClick={() => handleDelete(asset.id)} className="btn-ghost text-xs p-1 text-red-400 hover:text-red-300">
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Modal open={showUpload} onClose={() => setShowUpload(false)} title="Upload Assets">
        <div
          className="border-2 border-dashed border-surface-border rounded-xl p-10 text-center hover:border-accent/40 transition-colors cursor-pointer"
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('border-accent/60'); }}
          onDragLeave={(e) => { e.currentTarget.classList.remove('border-accent/60'); }}
          onDrop={(e) => { e.preventDefault(); e.currentTarget.classList.remove('border-accent/60'); handleUpload(Array.from(e.dataTransfer.files)); }}
        >
          <FileUp size={32} className="mx-auto text-zinc-500 mb-3" />
          <p className="text-sm text-zinc-300 mb-1">Drop files here or click to browse</p>
          <p className="text-xs text-zinc-500">Images, videos, PDFs, and HTML — all formats supported, up to 2GB</p>
          <input ref={fileRef} type="file" multiple accept="image/*,video/*,.html,.pdf,application/pdf" className="hidden"
            onChange={(e) => handleUpload(Array.from(e.target.files))} />
        </div>
        {uploading && (
          <div className="flex items-center gap-2 mt-4">
            <div className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin" />
            <span className="text-sm text-zinc-400">Uploading...</span>
          </div>
        )}
      </Modal>

      <Modal open={showUrl} onClose={() => setShowUrl(false)} title="Add URL Asset">
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1.5">Name</label>
            <input type="text" value={urlForm.name} onChange={(e) => setUrlForm(f => ({ ...f, name: e.target.value }))}
              placeholder="My website" className="w-full" />
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1.5">Type</label>
            <select value={urlForm.type} onChange={(e) => setUrlForm(f => ({ ...f, type: e.target.value }))} className="w-full">
              <option value="url">Web Page</option>
              <option value="stream">Live Stream</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1.5">URL</label>
            <input type="url" value={urlForm.url} onChange={(e) => setUrlForm(f => ({ ...f, url: e.target.value }))}
              placeholder="https://..." className="w-full" />
          </div>
          <div className="flex gap-2 justify-end pt-2">
            <button onClick={() => setShowUrl(false)} className="btn-secondary">Cancel</button>
            <button onClick={handleUrlAdd} className="btn-primary">Add</button>
          </div>
        </div>
      </Modal>

      <Modal open={!!preview} onClose={() => setPreview(null)} title={preview?.name || ''} wide>
        {preview && (
          <div className="flex items-center justify-center min-h-[300px]">
            {preview.type === 'image' ? (
              <img src={getAssetUrl(preview)} alt={preview.name} className="max-w-full max-h-[60vh] rounded-lg" />
            ) : preview.type === 'video' ? (
              <video src={getAssetUrl(preview)} controls className="max-w-full max-h-[60vh] rounded-lg" />
            ) : preview.type === 'url' || preview.type === 'stream' ? (
              <div className="text-center">
                <Globe size={48} className="mx-auto text-zinc-500 mb-3" />
                <a href={preview.url} target="_blank" rel="noopener noreferrer"
                  className="text-accent hover:text-accent-hover text-sm">{preview.url}</a>
              </div>
            ) : (
              <Code size={48} className="text-zinc-500" />
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
