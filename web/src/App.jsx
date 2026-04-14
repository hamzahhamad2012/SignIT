import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import DashboardLayout from './layouts/DashboardLayout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Devices from './pages/Devices';
import DeviceDetail from './pages/DeviceDetail';
import Assets from './pages/Assets';
import Playlists from './pages/Playlists';
import PlaylistEditor from './pages/PlaylistEditor';
import Schedules from './pages/Schedules';
import Groups from './pages/Groups';
import DisplayWalls from './pages/DisplayWalls';
import WallEditor from './pages/WallEditor';
import Widgets from './pages/Widgets';
import Templates from './pages/Templates';
import Settings from './pages/Settings';
import Downloads from './pages/Downloads';

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <LoadingScreen />;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function LoadingScreen() {
  return (
    <div className="h-screen flex items-center justify-center bg-[#09090b]">
      <div className="flex flex-col items-center gap-4">
        <div className="w-10 h-10 border-2 border-accent border-t-transparent rounded-full animate-spin" />
        <span className="text-zinc-500 text-sm">Loading SignIT...</span>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={
        <ProtectedRoute>
          <DashboardLayout />
        </ProtectedRoute>
      }>
        <Route index element={<Dashboard />} />
        <Route path="devices" element={<Devices />} />
        <Route path="devices/:id" element={<DeviceDetail />} />
        <Route path="assets" element={<Assets />} />
        <Route path="playlists" element={<Playlists />} />
        <Route path="playlists/:id" element={<PlaylistEditor />} />
        <Route path="schedules" element={<Schedules />} />
        <Route path="groups" element={<Groups />} />
        <Route path="walls" element={<DisplayWalls />} />
        <Route path="walls/:id" element={<WallEditor />} />
        <Route path="widgets" element={<Widgets />} />
        <Route path="templates" element={<Templates />} />
        <Route path="settings" element={<Settings />} />
        <Route path="downloads" element={<Downloads />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
