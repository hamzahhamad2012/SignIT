import { createContext, useContext, useState, useEffect } from 'react';
import { api } from '../api/client';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('signit_token');
    if (!token) { setLoading(false); return; }

    api.get('/auth/me')
      .then(data => setUser(data.user))
      .catch(() => localStorage.removeItem('signit_token'))
      .finally(() => setLoading(false));
  }, []);

  const login = async (email, password) => {
    const data = await api.post('/auth/login', { email, password });
    localStorage.setItem('signit_token', data.token);
    setUser(data.user);
    return data.user;
  };

  const logout = () => {
    localStorage.removeItem('signit_token');
    setUser(null);
  };

  const updateProfile = async (updates) => {
    const data = await api.put('/auth/me', updates);
    setUser(data.user);
    return data.user;
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, updateProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
