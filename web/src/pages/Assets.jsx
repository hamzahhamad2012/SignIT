import { useEffect, useState, useRef } from 'react';
import { api } from '../api/client';
import Modal from '../components/Modal';
import EmptyState from '../components/EmptyState';
import toast from 'react-hot-toast';
import {
  Image, Film, Globe, Code, Search, Upload, Trash2,
  Eye, Edit3, Save, X, FileUp, Link as LinkIcon, FileText,
  Folder, FolderOpen, FolderPlus, MoveRight,
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
  const [folders, setFolders] = useState([]);
  const [unfiled, setUnfiled] = useState({ asset_count: 0, total_size: 0 });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState('');
  const [selectedFolder, setSelectedFolder] = useState('all');
  const [showUpload, setShowUpload] = useState(false);
  const [showUrl, setShowUrl] = useState(false);
  const [showFolder, setShowFolder] = useState(false);
  const [movingAsset, setMovingAsset] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState('');
  const [preview, setPreview] = useState(null);
  const [folderName, setFolderName] = useState('');
  const [urlForm, setUrlForm] = useState({ name: '', type: 'url', url: '' });
  const fileRef = useRef(null);

  const fetchFolders = () => {
    api.get('/assets/folders').then(d => {
      setFolders(d.folders || []);
      setUnfiled(d.unfiled || { asset_count: 0, total_size: 0 });
    });
  };

  const fetchAssets = () => {
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (filterType) params.set('type', filterType);
    if (selectedFolder !== 'all') params.set('folder_id', selectedFolder);
    api.get(`/assets?${params}`).then(d => { setAssets(d.assets); setLoading(false); });
  };

  useEffect(() => { fetchFolders(); }, []);
  useEffect(() => { fetchAssets(); }, [search, filterType, selectedFolder]);

  const selectedFolderLabel = selectedFolder === 'all'
    ? 'All media'
    : selectedFolder === 'unfiled'
      ? 'Unfiled'
      : folders.find(f => String(f.id) === String(selectedFolder))?.name || 'Folder';

  const totalAssets = folders.reduce((sum, folder) => sum + Number(folder.asset_count || 0), 0)
    + Number(unfiled.asset_count || 0);

  const handleUpload = async (files) => {
    setUploading(true);
    try {
      for (const file of files) {
        await api.upload('/assets', file, {
          name: file.name,
          folder_id: selectedFolder !== 'all' && selectedFolder !== 'unfiled' ? selectedFolder : '',
        });
      }
      toast.success(`${files.length} file${files.length > 1 ? 's' : ''} uploaded`);
      fetchAssets();
      fetchFolders();
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
      await api.post('/assets', {
        ...urlForm,
        folder_id: selectedFolder !== 'all' && selectedFolder !== 'unfiled' ? selectedFolder : null,
      });
      toast.success('URL added');
      setShowUrl(false);
      setUrlForm({ name: '', type: 'url', url: '' });
      fetchAssets();
      fetchFolders();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleCreateFolder = async () => {
    const name = folderName.trim();
    if (!name) return toast.error('Folder name is required');
    try {
      const colors = ['#6366f1', '#f59e0b', '#10b981', '#ec4899', '#06b6d4'];
      const color = colors[folders.length % colors.length];
      const data = await api.post('/assets/folders', { name, color });
      setShowFolder(false);
      setFolderName('');
      setSelectedFolder(String(data.folder.id));
      fetchFolders();
      toast.success('Folder created');
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleRenameFolder = async (folder) => {
    const name = prompt('Rename folder', folder.name);
    if (!name || name.trim() === folder.name) return;
    try {
      await api.put(`/assets/folders/${folder.id}`, { name: name.trim() });
      fetchFolders();
      toast.success('Folder renamed');
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleDeleteFolder = async (folder) => {
    if (!confirm(`Delete "${folder.name}"? Assets inside will move to Unfiled.`)) return;
    try {
      await api.delete(`/assets/folders/${folder.id}`);
      if (String(selectedFolder) === String(folder.id)) setSelectedFolder('all');
      fetchFolders();
      fetchAssets();
      toast.success('Folder deleted');
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
    fetchFolders();
    toast.success('Asset deleted');
  };

  const handleMoveAsset = async (asset, folderId) => {
    await api.put(`/assets/${asset.id}`, { folder_id: folderId || null });
    setMovingAsset(null);
    fetchAssets();
    fetchFolders();
    toast.success(folderId ? 'Asset moved' : 'Asset moved to Unfiled');
  };

  const getAssetUrl = (asset) => {
    if (asset.url) return asset.url;
    if (asset.filename) {
      const subdir = asset.type === 'video' ? 'videos' : ['html', 'widget'].includes(asset.type) ? 'html' : 'images';
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
          <p className="text-sm text-zinc-500 mt-0.5">
            {selectedFolder === 'all' ? totalAssets : assets.length} file{(selectedFolder === 'all' ? totalAssets : assets.length) !== 1 && 's'}
            {' '}in {selectedFolderLabel}
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowFolder(true)} className="btn-secondary">
            <FolderPlus size={15} /> New Folder
          </button>
          <button onClick={() => setShowUrl(true)} className="btn-secondary">
            <LinkIcon size={15} /> Add URL
          </button>
          <button onClick={() => setShowUpload(true)} className="btn-primary">
            <Upload size={15} /> Upload
          </button>
        </div>
      </div>

      <div className="grid lg:grid-cols-[260px_1fr] gap-4">
        <aside className="card p-3 h-fit">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Folders</p>
            <button onClick={() => setShowFolder(true)} className="p-1 rounded-md hover:bg-surface-hover text-zinc-500 hover:text-accent">
              <FolderPlus size={14} />
            </button>
          </div>
          <div className="space-y-1">
            <button onClick={() => setSelectedFolder('all')}
              className={`w-full flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${selectedFolder === 'all' ? 'bg-accent/15 text-accent' : 'text-zinc-400 hover:bg-surface-hover hover:text-zinc-200'}`}>
              <span className="flex items-center gap-2"><FolderOpen size={15} /> All media</span>
              <span className="text-xs opacity-60">{totalAssets}</span>
            </button>
            <button onClick={() => setSelectedFolder('unfiled')}
              className={`w-full flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${selectedFolder === 'unfiled' ? 'bg-accent/15 text-accent' : 'text-zinc-400 hover:bg-surface-hover hover:text-zinc-200'}`}>
              <span className="flex items-center gap-2"><Folder size={15} /> Unfiled</span>
              <span className="text-xs opacity-60">{unfiled.asset_count || 0}</span>
            </button>
            {folders.map(folder => (
              <div key={folder.id} className={`group rounded-lg ${String(selectedFolder) === String(folder.id) ? 'bg-accent/15' : 'hover:bg-surface-hover'}`}>
                <button onClick={() => setSelectedFolder(String(folder.id))}
                  className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-sm transition-colors ${String(selectedFolder) === String(folder.id) ? 'text-accent' : 'text-zinc-400 hover:text-zinc-200'}`}>
                  <span className="flex items-center gap-2 min-w-0">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: folder.color || '#6366f1' }} />
                    <span className="truncate">{folder.name}</span>
                  </span>
                  <span className="text-xs opacity-60">{folder.asset_count}</span>
                </button>
                <div className="hidden group-hover:flex gap-1 px-3 pb-2">
                  <button onClick={() => handleRenameFolder(folder)} className="text-[11px] text-zinc-500 hover:text-accent">Rename</button>
                  <button onClick={() => handleDeleteFolder(folder)} className="text-[11px] text-zinc-500 hover:text-red-400">Delete</button>
                </div>
              </div>
            ))}
          </div>
        </aside>

        <section className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
              <input type="search" placeholder={`Search ${selectedFolderLabel.toLowerCase()}...`} value={search}
                onChange={(e) => setSearch(e.target.value)} className="w-full pl-9" />
            </div>
            <div className="flex gap-1.5 flex-wrap">
              {['', 'image', 'video', 'url', 'html', 'widget'].map((t) => (
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
            <EmptyState icon={Image} title="No assets here yet" description="Upload files, add URLs, or move existing media into this folder."
              action={<button onClick={() => setShowUpload(true)} className="btn-primary"><Upload size={14} /> Upload Files</button>} />
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3">
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
                      <p className="text-[11px] text-zinc-600 mt-1 truncate">
                        {asset.folder_name ? `Folder: ${asset.folder_name}` : 'Unfiled'}
                      </p>
                      <div className="flex gap-1 mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => { setEditingId(asset.id); setEditName(asset.name); }}
                          className="btn-ghost text-xs p-1"><Edit3 size={12} /></button>
                        <button onClick={() => setMovingAsset(asset)}
                          className="btn-ghost text-xs p-1"><MoveRight size={12} /></button>
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
        </section>
      </div>

      <Modal open={showFolder} onClose={() => setShowFolder(false)} title="New Asset Folder">
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1.5">Folder name</label>
            <input value={folderName} onChange={(e) => setFolderName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreateFolder()}
              placeholder="Lunch menus, Lobby promos, Holiday media..." className="w-full" autoFocus />
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setShowFolder(false)} className="btn-secondary">Cancel</button>
            <button onClick={handleCreateFolder} className="btn-primary"><FolderPlus size={14} /> Create</button>
          </div>
        </div>
      </Modal>

      <Modal open={!!movingAsset} onClose={() => setMovingAsset(null)} title={`Move ${movingAsset?.name || 'asset'}`}>
        {movingAsset && (
          <div className="space-y-2">
            <button onClick={() => handleMoveAsset(movingAsset, null)}
              className="w-full flex items-center justify-between rounded-lg px-3 py-2 bg-surface-overlay hover:bg-surface-hover text-sm text-zinc-300">
              <span className="flex items-center gap-2"><Folder size={15} /> Unfiled</span>
            </button>
            {folders.map(folder => (
              <button key={folder.id} onClick={() => handleMoveAsset(movingAsset, folder.id)}
                className="w-full flex items-center justify-between rounded-lg px-3 py-2 bg-surface-overlay hover:bg-surface-hover text-sm text-zinc-300">
                <span className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ background: folder.color || '#6366f1' }} />
                  {folder.name}
                </span>
                <span className="text-xs text-zinc-600">{folder.asset_count}</span>
              </button>
            ))}
          </div>
        )}
      </Modal>

      <Modal open={showUpload} onClose={() => setShowUpload(false)} title="Upload Assets">
        <p className="text-xs text-zinc-500 mb-3">Target: <span className="text-zinc-300">{selectedFolderLabel}</span></p>
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
          <p className="text-xs text-zinc-500">Target: <span className="text-zinc-300">{selectedFolderLabel}</span></p>
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
            ) : ['html', 'widget'].includes(preview.type) ? (
              <iframe src={getAssetUrl(preview)} title={preview.name} className="w-full h-[60vh] rounded-lg border border-surface-border bg-black" />
            ) : (
              <Code size={48} className="text-zinc-500" />
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
