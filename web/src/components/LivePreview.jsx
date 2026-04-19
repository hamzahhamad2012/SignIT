import { useState, useEffect, useRef } from 'react';
import { Play, Pause, SkipForward, Maximize, Minimize, X } from 'lucide-react';

const isRtspUrl = (value) => /^rtsps?:\/\//i.test(String(value || '').trim());
const getEffectiveType = (item) => isRtspUrl(item?.url) ? 'stream' : item?.asset_type;

export default function LivePreview({ items, transition = 'fade', transitionDuration = 800, bgColor = '#000', playlistType = 'media', layoutConfig = {} }) {
  const [currentIdx, setCurrentIdx] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const timerRef = useRef(null);
  const containerRef = useRef(null);

  useEffect(() => {
    if (!playing || items.length <= 1) return;
    const item = items[currentIdx];
    const duration = (item?.duration || 10) * 1000;
    timerRef.current = setTimeout(() => {
      setCurrentIdx(prev => (prev + 1) % items.length);
    }, duration);
    return () => clearTimeout(timerRef.current);
  }, [currentIdx, playing, items]);

  const skip = () => {
    clearTimeout(timerRef.current);
    setCurrentIdx(prev => (prev + 1) % items.length);
  };

  const toggleFullscreen = () => {
    if (!fullscreen) {
      containerRef.current?.requestFullscreen?.();
    } else {
      document.exitFullscreen?.();
    }
    setFullscreen(!fullscreen);
  };

  useEffect(() => {
    const handler = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  const getAssetUrl = (item) => {
    if (item.url) return item.url;
    if (item.filename) {
      const subdir = item.asset_type === 'video'
        ? 'videos'
        : ['html', 'widget'].includes(item.asset_type) ? 'html' : 'images';
      return `/uploads/${subdir}/${item.filename}`;
    }
    return null;
  };

  const transitionStyle = {
    transition: `opacity ${transitionDuration}ms ease-in-out, transform ${transitionDuration}ms ease-in-out`,
  };

  if (items.length === 0) {
    return (
      <div className="aspect-video rounded-xl bg-black flex items-center justify-center text-zinc-600 text-sm">
        No content to preview
      </div>
    );
  }

  if (playlistType === 'stream') {
    const columns = Math.max(1, Math.min(6, parseInt(layoutConfig.columns, 10) || 2));
    const rows = Math.max(1, Math.min(6, parseInt(layoutConfig.rows, 10) || Math.ceil(items.length / columns) || 1));
    const gap = Math.max(0, Math.min(40, parseInt(layoutConfig.gap, 10) || 0));

    return (
      <div ref={containerRef} className="relative group rounded-xl overflow-hidden" style={{ background: bgColor }}>
        <div
          className="aspect-video grid"
          style={{
            gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
            gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
            gap,
            padding: gap,
          }}
        >
          {items.map((item, idx) => {
            const colSpan = Math.max(1, Math.min(columns, parseInt(item.settings?.col_span, 10) || 1));
            const rowSpan = Math.max(1, Math.min(rows, parseInt(item.settings?.row_span, 10) || 1));
            return (
              <div
                key={item.id || idx}
                className="relative overflow-hidden rounded-lg border border-cyan-400/10 bg-slate-950 flex items-center justify-center"
                style={{ gridColumn: `span ${colSpan}`, gridRow: `span ${rowSpan}` }}
              >
                <div className="absolute inset-0 opacity-30 bg-[radial-gradient(circle_at_center,rgba(34,211,238,.25),transparent_55%)]" />
                <div className="relative flex flex-col items-center gap-2 text-center px-4">
                  <div className="w-3 h-3 rounded-full bg-emerald-400 shadow-[0_0_24px_rgba(52,211,153,0.8)]" />
                  <p className="text-xs font-semibold text-zinc-100 truncate max-w-[160px]">{item.asset_name || `Camera ${idx + 1}`}</p>
                  <p className="text-[10px] text-zinc-500">Native Pi stream window</p>
                </div>
                {layoutConfig.show_labels !== false && (
                  <div className="absolute left-2 bottom-2 right-2 truncate rounded-md bg-black/55 px-2 py-1 text-[10px] text-cyan-100">
                    {item.asset_name || `Camera ${idx + 1}`}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative group rounded-xl overflow-hidden" style={{ background: bgColor }}>
      <div className="aspect-video relative overflow-hidden">
        {items.map((item, idx) => {
          const isActive = idx === currentIdx;
          const url = getAssetUrl(item);
          const effectiveType = getEffectiveType(item);

          return (
            <div
              key={item.id || idx}
              className="absolute inset-0"
              style={{
                ...transitionStyle,
                opacity: isActive ? 1 : 0,
                transform: !isActive && transition === 'zoom' ? 'scale(1.1)' : 'scale(1)',
                zIndex: isActive ? 1 : 0,
                pointerEvents: isActive ? 'auto' : 'none',
              }}
            >
              {effectiveType === 'image' && url && (
                <img src={url} alt={item.asset_name}
                  className="w-full h-full" style={{ objectFit: item.fit || 'cover' }} />
              )}
              {effectiveType === 'video' && url && (
                <video src={url} muted={item.muted} autoPlay={isActive} loop
                  className="w-full h-full" style={{ objectFit: item.fit || 'cover' }} />
              )}
              {effectiveType === 'stream' && isRtspUrl(item.url) && (
                <div className="w-full h-full flex flex-col items-center justify-center gap-2 bg-slate-950 text-center px-5">
                  <div className="w-3 h-3 rounded-full bg-emerald-400 shadow-[0_0_24px_rgba(52,211,153,0.8)]" />
                  <p className="text-sm font-semibold text-zinc-100">RTSP Camera Stream</p>
                  <p className="text-xs text-zinc-500 max-w-sm">This preview plays on the Raspberry Pi via the native stream player.</p>
                </div>
              )}
              {(effectiveType === 'url' || effectiveType === 'stream') && item.url && !isRtspUrl(item.url) && (
                <iframe src={item.url} className="w-full h-full border-none" title={item.asset_name} />
              )}
              {['html', 'widget'].includes(effectiveType) && url && (
                <iframe src={url} className="w-full h-full border-none" title={item.asset_name} />
              )}
              {!url && (
                <div className="w-full h-full flex items-center justify-center text-zinc-600">
                  {item.asset_name || 'No content'}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Controls overlay */}
      <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent p-4
        opacity-0 group-hover:opacity-100 transition-opacity duration-300">
        {/* Progress bar */}
        <div className="flex gap-1 mb-3">
          {items.map((_, idx) => (
            <div key={idx} className="flex-1 h-0.5 rounded-full overflow-hidden bg-white/20 cursor-pointer"
              onClick={() => setCurrentIdx(idx)}>
              <div className={`h-full rounded-full transition-all duration-300 ${idx === currentIdx ? 'bg-accent w-full' : idx < currentIdx ? 'bg-white/50 w-full' : 'w-0'}`} />
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button onClick={() => setPlaying(!playing)} className="p-1.5 rounded-lg hover:bg-white/10 text-white transition-colors">
              {playing ? <Pause size={16} /> : <Play size={16} />}
            </button>
            <button onClick={skip} className="p-1.5 rounded-lg hover:bg-white/10 text-white transition-colors">
              <SkipForward size={16} />
            </button>
            <span className="text-xs text-white/70 ml-2">
              {currentIdx + 1} / {items.length}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-white/50">
              {items[currentIdx]?.asset_name}
            </span>
            <button onClick={toggleFullscreen} className="p-1.5 rounded-lg hover:bg-white/10 text-white transition-colors">
              {fullscreen ? <Minimize size={16} /> : <Maximize size={16} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
