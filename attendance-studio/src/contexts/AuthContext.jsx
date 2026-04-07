import { createContext, useContext, useState, useEffect } from 'react';
import { api } from '../services/api';
import { useToast } from './ToastContext';

const AuthContext = createContext();

export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(false);
  const { showToast } = useToast();

  useEffect(() => {
    // Auto-login if we have a persisted user
    const savedUser = localStorage.getItem('atd_user');
    if (savedUser) {
      try {
        setUser(JSON.parse(savedUser));
      } catch (e) {
        localStorage.removeItem('atd_user');
      }
    }
  }, []);

  const login = async (matric, name) => {
    setLoading(true);
    try {
      const data = await api.get(`/dashboard?matric=${matric}`);
      if (data.error) throw new Error(data.error);

      // FIX: Do NOT push history here. Keep the stack clean.
      const userPayload = { matric, name, ...data };
      setUser(userPayload);
      localStorage.setItem('atd_user', JSON.stringify(userPayload));

      const recents = JSON.parse(localStorage.getItem('atd_recents') || '[]');
      const newRecents = [{ m: matric, n: name }, ...recents.filter(r => r.m !== matric)].slice(0, 5);
      localStorage.setItem('atd_recents', JSON.stringify(newRecents));
      
      return true;
    } catch (e) {
      console.error(e);
      showToast(e.message || "Connection Failed", "error");
      return false;
    } finally {
      setLoading(false);
    }
  };

  const logout = () => {
    setUser(null);
    localStorage.removeItem('atd_user');
    // No history manipulation needed. React renders Search, URL stays as is (or whatever browser has).
  };

  return (
    <AuthContext.Provider value={{ user, setUser, login, logout, loading }}>
      {children}
    </AuthContext.Provider>
  );
};