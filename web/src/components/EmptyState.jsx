export default function EmptyState({ icon: Icon, title, description, action }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center animate-fade-in">
      {Icon && (
        <div className="w-14 h-14 rounded-2xl bg-surface-overlay flex items-center justify-center mb-4">
          <Icon size={24} className="text-zinc-500" />
        </div>
      )}
      <h3 className="text-base font-medium text-zinc-300 mb-1">{title}</h3>
      {description && <p className="text-sm text-zinc-500 mb-5 max-w-sm">{description}</p>}
      {action}
    </div>
  );
}
