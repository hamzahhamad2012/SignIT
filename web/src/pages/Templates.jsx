import { useEffect, useState } from 'react';
import { api } from '../api/client';
import Modal from '../components/Modal';
import EmptyState from '../components/EmptyState';
import toast from 'react-hot-toast';
import { BookTemplate, Download, Eye, Trash2, Tag, Utensils, Store, Building2, GraduationCap, Heart, Globe } from 'lucide-react';

const categoryConfig = {
  general: { label: 'General', icon: Globe, color: 'text-blue-400' },
  menu: { label: 'Menu / Restaurant', icon: Utensils, color: 'text-amber-400' },
  retail: { label: 'Retail', icon: Store, color: 'text-pink-400' },
  corporate: { label: 'Corporate', icon: Building2, color: 'text-violet-400' },
  hospitality: { label: 'Hospitality', icon: Heart, color: 'text-rose-400' },
  education: { label: 'Education', icon: GraduationCap, color: 'text-emerald-400' },
  healthcare: { label: 'Healthcare', icon: Heart, color: 'text-cyan-400' },
};

export default function Templates() {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterCat, setFilterCat] = useState('');
  const [showPreview, setShowPreview] = useState(null);
  const [seeded, setSeeded] = useState(false);

  const fetchTemplates = () => {
    const params = new URLSearchParams();
    if (filterCat) params.set('category', filterCat);
    api.get(`/templates?${params}`).then(d => {
      setTemplates(d.templates);
      setLoading(false);
      if (d.templates.length === 0 && !seeded) {
        api.post('/templates/seed-builtins', {}).then(() => {
          setSeeded(true);
          fetchTemplates();
        });
      }
    });
  };

  useEffect(() => { fetchTemplates(); }, [filterCat]);

  const handlePreview = async (template) => {
    const data = await api.get(`/templates/${template.id}`);
    setShowPreview(data.template);
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this template?')) return;
    await api.delete(`/templates/${id}`);
    fetchTemplates();
    toast.success('Template deleted');
  };

  const handleUseTemplate = async (template) => {
    try {
      const full = await api.get(`/templates/${template.id}`);
      const asset = await api.post('/assets', {
        name: `Template: ${template.name}`,
        type: 'html',
        url: null,
      });
      toast.success('Template added as HTML asset — customize it in your playlist!');
      setShowPreview(null);
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-zinc-100">Templates</h1>
          <p className="text-sm text-zinc-500 mt-0.5">Pre-designed layouts for menus, promos, welcome screens, and more</p>
        </div>
      </div>

      <div className="flex gap-1.5 flex-wrap">
        <button onClick={() => setFilterCat('')}
          className={`btn text-xs px-3 py-1.5 ${!filterCat
            ? 'bg-accent/15 text-accent border border-accent/30'
            : 'bg-surface-raised text-zinc-400 border border-surface-border hover:text-zinc-200'
          }`}>All</button>
        {Object.entries(categoryConfig).map(([key, cfg]) => (
          <button key={key} onClick={() => setFilterCat(key)}
            className={`btn text-xs px-3 py-1.5 ${filterCat === key
              ? 'bg-accent/15 text-accent border border-accent/30'
              : 'bg-surface-raised text-zinc-400 border border-surface-border hover:text-zinc-200'
            }`}>
            <cfg.icon size={12} /> {cfg.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array(6).fill(0).map((_, i) => <div key={i} className="h-64 bg-surface rounded-xl animate-pulse" />)}
        </div>
      ) : templates.length === 0 ? (
        <EmptyState icon={BookTemplate} title="No templates"
          description="Loading built-in templates..." />
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {templates.map(template => {
            const cat = categoryConfig[template.category] || categoryConfig.general;

            return (
              <div key={template.id} className="card p-0 overflow-hidden group">
                <div className="aspect-[16/10] bg-surface-overlay relative overflow-hidden cursor-pointer"
                  onClick={() => handlePreview(template)}>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <cat.icon size={40} className={`${cat.color} opacity-20`} />
                  </div>
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
                    <Eye size={24} className="text-white" />
                  </div>
                  <div className="absolute top-2 right-2">
                    <span className={`badge ${cat.color.replace('text-', 'bg-').replace('400', '400/15')} ${cat.color}`}>
                      {cat.label}
                    </span>
                  </div>
                  {template.is_builtin ? (
                    <div className="absolute top-2 left-2">
                      <span className="badge bg-accent/15 text-accent">Built-in</span>
                    </div>
                  ) : null}
                </div>
                <div className="p-4">
                  <h3 className="text-sm font-semibold text-zinc-200 mb-1">{template.name}</h3>
                  <div className="flex items-center justify-between mt-2">
                    <span className="text-xs text-zinc-500 capitalize">{template.category}</span>
                    <div className="flex gap-1">
                      <button onClick={() => handlePreview(template)}
                        className="btn-ghost text-xs p-1.5"><Eye size={12} /></button>
                      {!template.is_builtin && (
                        <button onClick={() => handleDelete(template.id)}
                          className="btn-ghost text-xs p-1.5 text-red-400"><Trash2 size={12} /></button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Modal open={!!showPreview} onClose={() => setShowPreview(null)}
        title={showPreview?.name || 'Template Preview'} wide>
        {showPreview && (
          <div>
            <div className="rounded-xl overflow-hidden border border-surface-border bg-white mb-4"
              style={{ minHeight: '300px', maxHeight: '500px', overflow: 'auto' }}>
              <div dangerouslySetInnerHTML={{ __html: showPreview.html_content }} />
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowPreview(null)} className="btn-secondary">Close</button>
              <button onClick={() => handleUseTemplate(showPreview)} className="btn-primary">
                <Download size={14} /> Use Template
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
