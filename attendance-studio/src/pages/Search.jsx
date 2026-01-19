import { useState, useEffect, useRef } from 'react';
import { api } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import Modal from '../components/Modal';
import AdminPanel from './AdminPanel';

export default function Search() {
  const { login, loading } = useAuth();

  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [directory, setDirectory] = useState([]);
  
  // Secret Admin Trigger
  const [secretCount, setSecretCount] = useState(0);
  const [showAdmin, setShowAdmin] = useState(false);
  const blurTimeout = useRef(null);

  // =========================================================================
  // 1. ADMIN BACK BUTTON LOGIC (FIXED)
  // =========================================================================
  
  useEffect(() => {
      if (showAdmin) {
          // Push Admin state
          window.history.pushState({ level: 'admin' }, '', '#admin');
      }
  }, [showAdmin]);

  useEffect(() => {
      const handlePopState = (e) => {
          if (!showAdmin) return;
          
          const state = e.state;

          // CRITICAL FIX:
          // Only close Admin if we have returned to the ROOT state (null).
          // If state is 'confirm' or 'admin_tag', we assume a child modal closed
          // and we landed back on 'admin' (or similar), so we keep Admin OPEN.
          if (state === null) {
              setShowAdmin(false);
          }
      };

      window.addEventListener('popstate', handlePopState);
      return () => window.removeEventListener('popstate', handlePopState);
  }, [showAdmin]);

  // Manual Close via X button
  const closeAdmin = () => {
      if (window.history.state?.level === 'admin') {
          window.history.back();
      } else {
          setShowAdmin(false);
      }
  };

  // =========================================================================
  // 2. SEARCH LOGIC (Unchanged)
  // =========================================================================
  
  useEffect(() => { api.get('/directory?type=student').then(setDirectory).catch(() => {}); }, []);

  const handleSearch = (val) => {
    setQuery(val);
    if (val.length < 2) { loadRecents(); return; }
    const cleanVal = val.toUpperCase().replace(/\s+/g, '');
    const matches = directory.filter(u => {
        const n = (u.n || "").toUpperCase().replace(/\s+/g, '');
        return n.includes(cleanVal) || u.m.includes(cleanVal);
    }).slice(0, 10);
    setResults(matches);
  };

  const loadRecents = () => {
    const recents = JSON.parse(localStorage.getItem('atd_recents') || '[]');
    setResults(recents.map(r => ({ ...r, isRecent: true })));
  };

  const handleBlur = () => {
    setSecretCount(prev => prev + 1);
    if (blurTimeout.current) clearTimeout(blurTimeout.current);
    blurTimeout.current = setTimeout(() => setSecretCount(0), 2000);
    if (secretCount >= 4) {
      setSecretCount(0);
      setShowAdmin(true);
    }
  };

  return (
    <div className="search-container">
      <div className="search-box">
        <input 
            type="text" className="search-input" placeholder="SEARCH DATABASE..." 
            value={query} onChange={(e) => handleSearch(e.target.value)}
            onFocus={() => { if(!query) loadRecents(); }} onBlur={handleBlur} disabled={loading} 
        />
        
        {results.length > 0 && (
          <div className="results-list" style={{ display: 'block' }}>
            {results[0].isRecent && <div style={{padding:'10px 15px', fontSize:'0.7rem', color:'var(--accent)', borderBottom:'1px solid var(--grid-line)'}}>RECENT SEARCHES</div>}
            {results.map(u => (
              <div key={u.m} className="result-item" onClick={() => login(u.m, u.n)}>
                <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
                    <span style={{ color: '#fff' }}>{u.n}</span>
                    <span style={{ color: 'var(--primary)', fontSize: '0.8em' }}>{u.m}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ADMIN MODAL */}
      <Modal title="ADMIN CONSOLE" isOpen={showAdmin} onClose={closeAdmin} maxWidth="900px">
        <AdminPanel />
      </Modal>
    </div>
  );
}