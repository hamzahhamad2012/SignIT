import { useState, useEffect } from 'react';
import { api } from '../api/client';
import {
  Download, Terminal, Check, Copy, Disc, HardDrive,
  Keyboard, ChevronDown, ChevronUp, Tv, Wifi, Zap,
} from 'lucide-react';
import toast from 'react-hot-toast';

export default function Downloads() {
  const [copied, setCopied] = useState('');
  const [images, setImages] = useState([]);
  const [showAlt, setShowAlt] = useState(false);
  const serverOrigin = window.location.origin.replace(':5173', ':4000');

  useEffect(() => {
    api.get('/setup/image').then(d => setImages(d.images || [])).catch(() => {});
  }, []);

  const cp = (text, id) => {
    navigator.clipboard.writeText(text);
    setCopied(id); toast.success('Copied!');
    setTimeout(() => setCopied(''), 3000);
  };

  const fmtSize = (b) => b > 1e9 ? `${(b/1e9).toFixed(1)} GB` : b > 1e6 ? `${(b/1e6).toFixed(0)} MB` : `${(b/1e3).toFixed(0)} KB`;

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold text-zinc-100">Setup & Downloads</h1>
        <p className="text-sm text-zinc-500 mt-0.5">Get a Raspberry Pi display up and running</p>
      </div>

      {/* ════════ STEP 1: Get the Image ════════ */}
      <div className="card border-accent/30 bg-gradient-to-br from-surface to-[#1a1625]">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs font-bold text-accent uppercase tracking-wider">Step 1</span>
        </div>
        <h2 className="text-xl font-bold text-zinc-100 mb-2">Get the SignIT OS Image</h2>
        <p className="text-sm text-zinc-400 mb-5">
          This is a custom Raspberry Pi OS with SignIT pre-installed.
          Flash it, boot it, and the Pi shows the setup screen on your TV. That's it.
        </p>

        {images.length > 0 ? (
          <div className="space-y-2 mb-4">
            {images.map(img => (
              <a key={img.filename}
                href={`${serverOrigin}/api/setup/image/${img.filename}`}
                className="flex items-center justify-between p-4 bg-surface-overlay rounded-xl border border-surface-border hover:border-accent/40 transition-all group">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-xl bg-accent/10 flex items-center justify-center">
                    <Disc size={22} className="text-accent" />
                  </div>
                  <div>
                    <p className="text-base font-semibold text-zinc-100 group-hover:text-white">{img.filename}</p>
                    <p className="text-xs text-zinc-500">{fmtSize(img.size)} · Built {new Date(img.modified).toLocaleDateString()}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 text-accent">
                  <span className="text-sm font-medium hidden sm:inline">Download</span>
                  <Download size={18} />
                </div>
              </a>
            ))}
          </div>
        ) : (
          <div className="bg-surface-overlay rounded-xl p-5 border border-surface-border mb-4">
            <div className="flex items-start gap-3">
              <HardDrive size={18} className="text-amber-400 mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-semibold text-zinc-200 mb-1">No image built yet</p>
                <p className="text-xs text-zinc-400 mb-3">
                  You need to build the image once. It takes ~15 minutes and requires Docker.
                  After that, the image appears here for download.
                </p>
                <p className="text-xs text-zinc-500 mb-2">On your server machine, run:</p>
                <div className="relative">
                  <code className="block bg-[#0a0a0a] rounded-lg p-3 pr-10 text-sm text-cyan-300 font-mono">
                    cd tools && ./build-image.sh
                  </code>
                  <button onClick={() => cp('cd tools && ./build-image.sh', 'build')}
                    className="absolute right-2 top-2 p-1.5 rounded-md hover:bg-surface-hover text-zinc-500 hover:text-zinc-300">
                    {copied === 'build' ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
                  </button>
                </div>
                <p className="text-[11px] text-zinc-600 mt-2">
                  Requires Docker. Output goes to <code className="text-zinc-500">dist/</code> and will show up here automatically.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ════════ STEP 2: Flash It ════════ */}
      <div className="card">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs font-bold text-emerald-400 uppercase tracking-wider">Step 2</span>
        </div>
        <h2 className="text-lg font-bold text-zinc-100 mb-2">Flash the Image to an SD Card</h2>
        <div className="space-y-3 text-sm text-zinc-400">
          <div className="bg-rose-500/5 border border-rose-500/20 rounded-lg p-3">
            <p className="text-xs text-zinc-300 font-semibold mb-1">Why Customisation is greyed out</p>
            <p className="text-xs text-zinc-500 leading-relaxed">
              Raspberry Pi Imager <strong className="text-zinc-400">does not run the WiFi / SSH wizard</strong> when you pick <strong className="text-zinc-400">Use custom</strong> with <code className="text-zinc-400">signit.img.gz</code>.
              That is how Imager treats third-party images — not something SignIT can change. Use WiFi file or Ethernet below.
            </p>
          </div>
          <p>
            Use <a href="https://www.raspberrypi.com/software/" target="_blank" rel="noreferrer" className="text-accent hover:underline">Raspberry Pi Imager</a> or{' '}
            <a href="https://www.balena.io/etcher/" target="_blank" rel="noreferrer" className="text-accent hover:underline">balenaEtcher</a>.
          </p>
          <ol className="list-decimal list-inside space-y-2 text-zinc-400">
            <li>Imager → <strong className="text-zinc-200">Use custom</strong> → your <code className="text-zinc-300">signit.img.gz</code></li>
            <li>Choose the SD card → <strong className="text-zinc-200">Write</strong></li>
            <li>
              <strong className="text-zinc-200">WiFi (first boot needs internet):</strong> after writing, open the <code className="text-zinc-300">bootfs</code> drive on your Mac/PC.
              Save a file named <code className="text-zinc-300">signit-wifi.txt</code> there with:
            </li>
          </ol>
          <div className="bg-[#0a0a0a] rounded-lg p-3 font-mono text-xs text-cyan-300/90">
            SSID=YourNetworkName<br />
            PASSWORD=YourWiFiPassword
          </div>
          <p className="text-xs text-zinc-500">
            Or copy <code className="text-zinc-400">signit-wifi.txt.example</code> from the same boot drive (already on the image) and rename to <code className="text-zinc-400">signit-wifi.txt</code> after editing.
            Read <code className="text-zinc-400">SIGNIT_WIFI_README.txt</code> on <code className="text-zinc-400">bootfs</code> for details.
          </p>
          <a
            href={`${serverOrigin}/api/setup/signit-wifi-template.txt`}
            download
            className="inline-flex items-center gap-2 text-sm font-medium text-accent hover:underline"
          >
            <Download size={16} /> Download WiFi template
          </a>
          <div className="bg-amber-500/5 border border-amber-500/15 rounded-lg p-3 flex items-start gap-3">
            <Wifi size={15} className="text-amber-400 mt-0.5 shrink-0" />
            <p className="text-xs text-zinc-400">
              <strong className="text-zinc-200">Easiest:</strong> use <strong className="text-zinc-200">Ethernet</strong> for the first boot if you can — no WiFi file needed.
              First boot runs <code className="text-zinc-400">apt</code> and must reach the internet.
            </p>
          </div>
        </div>
      </div>

      {/* ════════ STEP 3: Boot ════════ */}
      <div className="card">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs font-bold text-cyan-400 uppercase tracking-wider">Step 3</span>
        </div>
        <h2 className="text-lg font-bold text-zinc-100 mb-2">Insert SD Card, Connect TV, Power On</h2>
        <div className="text-sm text-zinc-400 space-y-3">
          <p>
            Put the SD card in the Pi. Connect HDMI to your TV. Plug in a USB keyboard. Plug in power.
          </p>
          <div className="bg-surface-overlay rounded-xl p-4 border border-surface-border space-y-2">
            <p className="text-xs text-zinc-300 font-semibold">What happens automatically:</p>
            <ol className="list-decimal list-inside space-y-1 text-xs text-zinc-500">
              <li>Pi boots into Raspberry Pi OS</li>
              <li>Connects to WiFi (configured in Step 2)</li>
              <li>Installs SignIT player & dependencies (~3–5 min on first boot)</li>
              <li>Reboots into the <strong className="text-zinc-300">SignIT setup wizard on your TV screen</strong></li>
            </ol>
          </div>
        </div>
      </div>

      {/* ════════ STEP 4: Setup on TV ════════ */}
      <div className="card">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs font-bold text-violet-400 uppercase tracking-wider">Step 4</span>
        </div>
        <h2 className="text-lg font-bold text-zinc-100 mb-2">Enter Your Server URL on the TV</h2>
        <div className="text-sm text-zinc-400 space-y-3">
          <p>The TV shows the SignIT setup wizard. Use the USB keyboard:</p>
          <ol className="list-decimal list-inside space-y-2">
            <li>If WiFi isn't connected, press <kbd className="px-1.5 py-0.5 rounded bg-surface-overlay border border-surface-border text-zinc-300 font-mono text-xs">F6</kbd> to configure it</li>
            <li>
              Enter your server URL: <code className="text-zinc-200 font-mono">{serverOrigin.replace(':5173', ':4000')}</code>
              <button onClick={() => cp(serverOrigin.replace(':5173', ':4000'), 'srv')} className="ml-2 text-zinc-600 hover:text-zinc-300 inline-flex">
                {copied === 'srv' ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
              </button>
            </li>
            <li>The Pi registers itself and shows its <strong className="text-zinc-200">Player ID</strong> on screen</li>
            <li>The display automatically appears in your dashboard under <strong className="text-zinc-200">Devices</strong></li>
          </ol>
          <p className="text-xs text-zinc-500">
            Once registered, assign a playlist to the device from the dashboard and content starts playing.
            You can unplug the keyboard — the Pi auto-starts SignIT on every boot.
          </p>
        </div>

        {/* Keyboard shortcuts */}
        <div className="mt-4 p-4 bg-accent/5 border border-accent/15 rounded-xl">
          <h4 className="text-xs font-bold text-zinc-300 uppercase tracking-wider mb-3 flex items-center gap-2">
            <Keyboard size={13} className="text-accent" /> TV Keyboard Shortcuts
          </h4>
          <div className="grid sm:grid-cols-2 gap-x-8 gap-y-2">
            {[['F6','WiFi settings'], ['F2','Server settings'], ['F5','Refresh'], ['Esc','Close overlay']].map(([k,d]) => (
              <div key={k} className="flex items-center gap-3 text-xs">
                <kbd className="inline-block px-2 py-0.5 rounded bg-surface-overlay border border-surface-border text-zinc-300 font-mono text-[11px] min-w-[36px] text-center">{k}</kbd>
                <span className="text-zinc-400">{d}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ════════ Alternative method ════════ */}
      <div className="card">
        <button onClick={() => setShowAlt(!showAlt)} className="w-full flex items-center justify-between text-left">
          <div className="flex items-center gap-3">
            <Terminal size={18} className="text-zinc-500" />
            <div>
              <h2 className="text-sm font-semibold text-zinc-300">Alternative: SSH Install (no image needed)</h2>
              <p className="text-xs text-zinc-600">Already have Pi OS running? One command.</p>
            </div>
          </div>
          {showAlt ? <ChevronUp size={16} className="text-zinc-500" /> : <ChevronDown size={16} className="text-zinc-500" />}
        </button>
        {showAlt && (
          <div className="mt-4 pt-4 border-t border-surface-border">
            <div className="relative">
              <code className="block bg-[#0a0a0a] rounded-lg p-3 pr-10 text-sm text-cyan-300 font-mono break-all select-all">
                sudo bash &lt;(curl -sSL {serverOrigin.replace(':5173',':4000')}/api/setup/install.sh)
              </code>
              <button onClick={() => cp(`sudo bash <(curl -sSL ${serverOrigin.replace(':5173',':4000')}/api/setup/install.sh)`, 'ssh')}
                className="absolute right-2 top-2 p-1.5 rounded-md hover:bg-surface-hover text-zinc-500 hover:text-zinc-300">
                {copied === 'ssh' ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Hardware */}
      <div className="card">
        <h2 className="text-sm font-semibold text-zinc-200 mb-3">Hardware Requirements</h2>
        <div className="grid sm:grid-cols-3 gap-4">
          {[
            { h: 'Raspberry Pi', items: ['Pi 4 or Pi 5 (recommended)', 'Pi 3B+ (supported)'] },
            { h: 'Storage', items: ['16GB+ microSD (Class 10)', 'SanDisk or Samsung recommended'] },
            { h: 'Setup', items: ['HDMI cable + TV', 'USB keyboard (setup only)', 'WiFi or Ethernet'] },
          ].map(({ h, items }) => (
            <div key={h}>
              <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">{h}</h3>
              <ul className="space-y-1.5">
                {items.map((t, i) => <li key={i} className="text-xs text-zinc-500 flex items-start gap-2"><Check size={12} className="text-emerald-400 mt-0.5 shrink-0" />{t}</li>)}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
