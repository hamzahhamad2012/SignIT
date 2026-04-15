import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import toast from 'react-hot-toast';
import { Settings as SettingsIcon, User, Lock, Server, Info } from 'lucide-react';

export default function Settings() {
  const { user, updateProfile } = useAuth();
  const [name, setName] = useState(user?.name || '');
  const [email, setEmail] = useState(user?.email || '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSaveProfile = async () => {
    setSaving(true);
    try {
      const updates = {};
      if (name !== user.name) updates.name = name;
      if (email !== user.email) updates.email = email;
      if (newPassword) {
        updates.currentPassword = currentPassword;
        updates.newPassword = newPassword;
      }
      if (Object.keys(updates).length === 0) {
        toast('No changes to save');
        setSaving(false);
        return;
      }
      await updateProfile(updates);
      setCurrentPassword('');
      setNewPassword('');
      toast.success('Profile updated');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold text-zinc-100">Settings</h1>
        <p className="text-sm text-zinc-500 mt-0.5">Manage your account and server settings</p>
      </div>

      <div className="card">
        <div className="flex items-center gap-2 mb-4">
          <User size={16} className="text-accent" />
          <h2 className="text-sm font-semibold text-zinc-200">Profile</h2>
        </div>
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1.5">Name</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} className="w-full" />
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1.5">Email</label>
            <input
              type="text"
              inputMode="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full"
            />
          </div>
        </div>
      </div>

      <div className="card">
        <div className="flex items-center gap-2 mb-4">
          <Lock size={16} className="text-accent" />
          <h2 className="text-sm font-semibold text-zinc-200">Change Password</h2>
        </div>
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1.5">Current Password</label>
            <input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder="Enter current password" className="w-full" />
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1.5">New Password</label>
            <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Enter new password" className="w-full" />
          </div>
        </div>
      </div>

      <button onClick={handleSaveProfile} disabled={saving} className="btn-primary">
        {saving ? 'Saving...' : 'Save Changes'}
      </button>

      <div className="card">
        <div className="flex items-center gap-2 mb-4">
          <Server size={16} className="text-accent" />
          <h2 className="text-sm font-semibold text-zinc-200">Server Information</h2>
        </div>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <span className="text-xs text-zinc-500">Platform</span>
            <p className="text-zinc-300">SignIT v1.0.0</p>
          </div>
          <div>
            <span className="text-xs text-zinc-500">Role</span>
            <p className="text-zinc-300 capitalize">{user?.role}</p>
          </div>
          <div>
            <span className="text-xs text-zinc-500">Status</span>
            <p className="text-zinc-300 capitalize">{user?.status}</p>
          </div>
        </div>
      </div>

      <div className="card bg-gradient-to-r from-accent/5 to-violet-500/5 border-accent/20">
        <div className="flex items-center gap-2 mb-2">
          <Info size={16} className="text-accent" />
          <h2 className="text-sm font-semibold text-zinc-200">Raspberry Pi Setup</h2>
        </div>
        <p className="text-xs text-zinc-400 mb-3">
          To connect a new display, run this command on your Raspberry Pi:
        </p>
        <code className="block bg-surface p-3 rounded-lg text-xs text-accent font-mono break-all">
          curl -sSL http://YOUR_SERVER_IP:4000/api/player/setup.sh | bash
        </code>
        <p className="text-[11px] text-zinc-500 mt-2">
          Replace YOUR_SERVER_IP with this server's IP address on your network.
        </p>
      </div>
    </div>
  );
}
