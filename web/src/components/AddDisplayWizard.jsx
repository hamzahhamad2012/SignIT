import { useState, useEffect } from 'react';
import { api } from '../api/client';
import toast from 'react-hot-toast';
import {
  Monitor, MapPin, FolderOpen, ListVideo, Copy, Check,
  Terminal, QrCode, ArrowRight, ArrowLeft, Wifi, Clock,
} from 'lucide-react';

const STEPS = ['name', 'location', 'assign', 'setup'];

export default function AddDisplayWizard({ open, onClose, onComplete }) {
  const [step, setStep] = useState(0);
  const [groups, setGroups] = useState([]);
  const [playlists, setPlaylists] = useState([]);
  const [copied, setCopied] = useState(false);
  const [creating, setCreating] = useState(false);
  const [pairingToken, setPairingToken] = useState(null);

  const [form, setForm] = useState({
    name: '',
    group_id: '',
    playlist_id: '',
    location_name: '',
    location_address: '',
    location_city: '',
    location_state: '',
    location_zip: '',
    location_country: '',
    expires_hours: 72,
  });

  useEffect(() => {
    if (open) {
      api.get('/groups').then(d => setGroups(d.groups));
      api.get('/playlists').then(d => setPlaylists(d.playlists));
      setStep(0);
      setPairingToken(null);
      setCopied(false);
      setForm({
        name: '', group_id: '', playlist_id: '',
        location_name: '', location_address: '', location_city: '',
        location_state: '', location_zip: '', location_country: '',
        expires_hours: 72,
      });
    }
  }, [open]);

  const update = (field, value) => setForm(f => ({ ...f, [field]: value }));

  const handleGenerate = async () => {
    if (!form.name) return toast.error('Display name is required');
    setCreating(true);
    try {
      const data = await api.post('/setup/pairing-token', {
        ...form,
        group_id: form.group_id ? parseInt(form.group_id) : null,
        playlist_id: form.playlist_id ? parseInt(form.playlist_id) : null,
      });
      setPairingToken(data.token);
      setStep(3);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setCreating(false);
    }
  };

  const copyCommand = (text) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    toast.success('Copied to clipboard');
    setTimeout(() => setCopied(false), 3000);
  };

  const handleDone = () => {
    onComplete?.();
    onClose();
  };

  if (!open) return null;

  const serverOrigin = window.location.origin.replace(':5173', ':4000');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in"
      onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="bg-surface rounded-2xl border border-surface-border shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col animate-slide-up">

        {/* Header */}
        <div className="px-6 py-4 border-b border-surface-border flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-zinc-100">Add New Display</h2>
            <p className="text-xs text-zinc-500 mt-0.5">
              Step {step + 1} of {STEPS.length} — {
                ['Name Your Display', 'Set Location', 'Assign Content', 'Connect Your Pi'][step]
              }
            </p>
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 text-xl leading-none">&times;</button>
        </div>

        {/* Progress bar */}
        <div className="px-6 pt-4">
          <div className="flex gap-1.5">
            {STEPS.map((_, i) => (
              <div key={i} className={`flex-1 h-1 rounded-full transition-all duration-300 ${
                i <= step ? 'bg-accent' : 'bg-surface-overlay'
              }`} />
            ))}
          </div>
        </div>

        {/* Step content */}
        <div className="px-6 py-5 flex-1 overflow-y-auto">

          {/* Step 1: Name */}
          {step === 0 && (
            <div className="space-y-4 animate-fade-in">
              <div className="w-12 h-12 rounded-2xl bg-accent/10 flex items-center justify-center mb-2">
                <Monitor size={22} className="text-accent" />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1.5">Display Name *</label>
                <input type="text" value={form.name} onChange={(e) => update('name', e.target.value)}
                  placeholder="e.g. Lobby Screen 1, Drive-Thru Menu" className="w-full text-base" autoFocus />
                <p className="text-[11px] text-zinc-600 mt-1">Give it a name your team will recognize</p>
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1.5">Pairing Code Expires In</label>
                <select value={form.expires_hours} onChange={(e) => update('expires_hours', parseInt(e.target.value))} className="w-full">
                  <option value={1}>1 hour</option>
                  <option value={24}>24 hours</option>
                  <option value={72}>3 days (default)</option>
                  <option value={168}>1 week</option>
                  <option value={720}>30 days</option>
                </select>
              </div>
            </div>
          )}

          {/* Step 2: Location */}
          {step === 1 && (
            <div className="space-y-4 animate-fade-in">
              <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 flex items-center justify-center mb-2">
                <MapPin size={22} className="text-emerald-400" />
              </div>
              <p className="text-sm text-zinc-400 mb-3">Where is this display physically located? <span className="text-zinc-600">(optional)</span></p>
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1.5">Location / Store Name</label>
                <input type="text" value={form.location_name} onChange={(e) => update('location_name', e.target.value)}
                  placeholder="e.g. Downtown Café, Building A Lobby" className="w-full" />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1.5">Street Address</label>
                <input type="text" value={form.location_address} onChange={(e) => update('location_address', e.target.value)}
                  placeholder="123 Main Street" className="w-full" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1.5">City</label>
                  <input type="text" value={form.location_city} onChange={(e) => update('location_city', e.target.value)}
                    placeholder="New York" className="w-full" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1.5">State / Province</label>
                  <input type="text" value={form.location_state} onChange={(e) => update('location_state', e.target.value)}
                    placeholder="NY" className="w-full" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1.5">ZIP / Postal Code</label>
                  <input type="text" value={form.location_zip} onChange={(e) => update('location_zip', e.target.value)}
                    placeholder="10001" className="w-full" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1.5">Country</label>
                  <input type="text" value={form.location_country} onChange={(e) => update('location_country', e.target.value)}
                    placeholder="US" className="w-full" />
                </div>
              </div>
            </div>
          )}

          {/* Step 3: Assign */}
          {step === 2 && (
            <div className="space-y-4 animate-fade-in">
              <div className="w-12 h-12 rounded-2xl bg-violet-500/10 flex items-center justify-center mb-2">
                <ListVideo size={22} className="text-violet-400" />
              </div>
              <p className="text-sm text-zinc-400 mb-3">Pre-assign a group and playlist so it starts showing content immediately.</p>
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1.5">Group</label>
                <select value={form.group_id} onChange={(e) => update('group_id', e.target.value)} className="w-full">
                  <option value="">No group</option>
                  {groups.map(g => <option key={g.id} value={g.id}>{g.name} ({g.device_count} devices)</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1.5">Default Playlist</label>
                <select value={form.playlist_id} onChange={(e) => update('playlist_id', e.target.value)} className="w-full">
                  <option value="">No playlist (use schedule)</option>
                  {playlists.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
            </div>
          )}

          {/* Step 4: Setup Instructions */}
          {step === 3 && pairingToken && (
            <div className="space-y-5 animate-fade-in">
              <div className="text-center">
                <div className="w-12 h-12 rounded-2xl bg-cyan-500/10 flex items-center justify-center mx-auto mb-3">
                  <Terminal size={22} className="text-cyan-400" />
                </div>
                <h3 className="text-base font-semibold text-zinc-200">Your Pairing Code</h3>
                <p className="text-xs text-zinc-500 mt-1">Use this code to connect your Raspberry Pi</p>
              </div>

              {/* Big pairing code display */}
              <div className="bg-surface-overlay rounded-2xl p-6 text-center border border-surface-border">
                <div className="font-mono text-5xl font-bold tracking-[0.3em] text-accent select-all">
                  {pairingToken.code}
                </div>
                <div className="flex items-center justify-center gap-2 mt-3 text-xs text-zinc-500">
                  <Clock size={12} />
                  <span>Expires {new Date(pairingToken.expires_at).toLocaleString()}</span>
                </div>
              </div>

              {/* Setup methods */}
              <div className="space-y-3">
                <h4 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Setup Options</h4>

                {/* Option 1: One-liner */}
                <div className="bg-surface-overlay rounded-xl p-4 border border-surface-border">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-6 h-6 rounded-full bg-cyan-500/15 text-cyan-400 flex items-center justify-center text-xs font-bold">1</div>
                    <span className="text-sm font-medium text-zinc-200">One-Command Setup</span>
                    <span className="badge bg-emerald-500/15 text-emerald-400 ml-auto">Recommended</span>
                  </div>
                  <p className="text-xs text-zinc-500 mb-2">Run this on your Pi (requires internet). WiFi can be configured during setup.</p>
                  <div className="relative">
                    <code className="block bg-[#0a0a0a] rounded-lg p-3 pr-10 text-xs text-cyan-300 font-mono break-all select-all">
                      sudo bash &lt;(curl -sSL {serverOrigin}/api/setup/install/{pairingToken.code}.sh)
                    </code>
                    <button
                      onClick={() => copyCommand(`sudo bash <(curl -sSL ${serverOrigin}/api/setup/install/${pairingToken.code}.sh)`)}
                      className="absolute right-2 top-2 p-1.5 rounded-md hover:bg-surface-hover text-zinc-500 hover:text-zinc-300 transition-colors"
                    >
                      {copied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
                    </button>
                  </div>
                </div>

                {/* Option 2: Manual */}
                <div className="bg-surface-overlay rounded-xl p-4 border border-surface-border">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-6 h-6 rounded-full bg-amber-500/15 text-amber-400 flex items-center justify-center text-xs font-bold">2</div>
                    <span className="text-sm font-medium text-zinc-200">Manual Setup</span>
                  </div>
                  <p className="text-xs text-zinc-500 mb-2">If you've already installed the player, just run:</p>
                  <div className="relative">
                    <code className="block bg-[#0a0a0a] rounded-lg p-3 pr-10 text-xs text-amber-300 font-mono break-all select-all">
                      sudo bash &lt;(curl -sSL {serverOrigin}/api/setup/install.sh)
                    </code>
                    <button
                      onClick={() => copyCommand(`sudo bash <(curl -sSL ${serverOrigin}/api/setup/install.sh)`)}
                      className="absolute right-2 top-2 p-1.5 rounded-md hover:bg-surface-hover text-zinc-500 hover:text-zinc-300 transition-colors"
                    >
                      <Copy size={14} />
                    </button>
                  </div>
                  <p className="text-xs text-zinc-600 mt-2">Then enter code <strong className="text-zinc-300">{pairingToken.code}</strong> when prompted.</p>
                </div>

                {/* Option 3: SD Card */}
                <div className="bg-surface-overlay rounded-xl p-4 border border-surface-border">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-6 h-6 rounded-full bg-violet-500/15 text-violet-400 flex items-center justify-center text-xs font-bold">3</div>
                    <span className="text-sm font-medium text-zinc-200">Pre-configured SD Card</span>
                  </div>
                  <ol className="text-xs text-zinc-500 space-y-1 list-decimal list-inside">
                    <li>Flash the SignIT image (full Pi OS desktop base) to an SD card</li>
                    <li>Enable SSH and configure WiFi in Raspberry Pi Imager</li>
                    <li>Boot the Pi and SSH in</li>
                    <li>Run the one-command setup above</li>
                  </ol>
                </div>
              </div>

              <div className="bg-accent/5 border border-accent/20 rounded-xl p-4">
                <div className="flex items-start gap-3">
                  <Wifi size={16} className="text-accent mt-0.5 shrink-0" />
                  <div className="text-xs text-zinc-400">
                    <strong className="text-zinc-200">Wi-Fi Note:</strong> The setup script will ask to configure Wi-Fi if the Pi isn't connected.
                    You can also pre-configure WiFi using the Raspberry Pi Imager before flashing.
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-surface-border flex items-center justify-between">
          <div>
            {step > 0 && step < 3 && (
              <button onClick={() => setStep(s => s - 1)} className="btn-ghost text-sm">
                <ArrowLeft size={14} /> Back
              </button>
            )}
          </div>
          <div className="flex gap-2">
            {step < 2 && (
              <button onClick={() => setStep(s => s + 1)} className="btn-primary"
                disabled={step === 0 && !form.name}>
                Next <ArrowRight size={14} />
              </button>
            )}
            {step === 2 && (
              <button onClick={handleGenerate} className="btn-primary" disabled={creating}>
                {creating ? 'Generating...' : 'Generate Pairing Code'} <ArrowRight size={14} />
              </button>
            )}
            {step === 3 && (
              <button onClick={handleDone} className="btn-primary">
                Done <Check size={14} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
