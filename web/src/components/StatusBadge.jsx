export default function StatusBadge({ status }) {
  const config = {
    online: { class: 'badge-online', dot: 'bg-emerald-400', label: 'Online' },
    offline: { class: 'badge-offline', dot: 'bg-zinc-500', label: 'Offline' },
    error: { class: 'badge-error', dot: 'bg-red-400', label: 'Error' },
  };

  const c = config[status] || config.offline;

  return (
    <span className={c.class}>
      <span className={`w-1.5 h-1.5 rounded-full ${c.dot} ${status === 'online' ? 'animate-pulse-soft' : ''}`} />
      {c.label}
    </span>
  );
}
