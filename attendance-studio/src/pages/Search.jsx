// --- START OF FILE Search.jsx ---

import { useState, useEffect, useRef } from 'react'; // <--- Ensure useEffect is here too
import { getDirectory } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import Modal from '../components/Modal';
import AdminPanel from './AdminPanel';
import A2HSPrompt from '../components/A2HSPrompt';

export default function Search({ dataReady }) {
  const { login, loading } = useAuth();

  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [directory, setDirectory] = useState([]);
  
  // Secret Admin Trigger
  const [secretCount, setSecretCount] = useState(0);
  const [showAdmin, setShowAdmin] = useState(false);
  const blurTimeout = useRef(null);

  // =========================================================================
  // 1. ADMIN BACK BUTTON LOGIC
  // =========================================================================
  useEffect(() => {
      if (showAdmin) {
          window.history.pushState({ level: 'admin' }, '', '#admin');
      }
  }, [showAdmin]);

  useEffect(() => {
      const handlePopState = (e) => {
          if (!showAdmin) return;
          const state = e.state;
          if (state === null) {
              setShowAdmin(false);
          }
      };
      window.addEventListener('popstate', handlePopState);
      return () => window.removeEventListener('popstate', handlePopState);
  }, [showAdmin]);

  const closeAdmin = () => {
      if (window.history.state?.level === 'admin') {
          window.history.back();
      } else {
          setShowAdmin(false);
      }
  };

  // =========================================================================
  // 2. SEARCH LOGIC 
  // =========================================================================
  
  // Fetch from the instant cache
  useEffect(() => { 
      getDirectory().then(setDirectory).catch(() => {}); 
  }, []);

  const handleSearch = (val) => {
    setQuery(val);
    if (val.length < 2) { loadRecents(); return; }
    const cleanVal = val.toUpperCase().replace(/\s+/g, '');
    
    const matches = directory.filter(u => {
        // HIDE COURSES FROM LOGIN SCREEN
        if (u.t === 'c') return false; 
        
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
        <div style={{ position: 'relative', width: '100%' }}>
            <input 
                type="text" className="search-input" placeholder={dataReady ? "LOGIN WITH MATRIC / NAME..." : "DOWNLOADING DIRECTORY..."} 
                style={{ width: '100%', paddingRight: '40px' }}
                value={query} onChange={(e) => handleSearch(e.target.value)}
                onFocus={(e) => { 
                    if(!query && dataReady) loadRecents(); 
                    setTimeout(() => {
                        e.target.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }, 300);
                }} 
                onBlur={handleBlur} disabled={loading || !dataReady} 
            />
            {query && dataReady && (
                <span 
                    onClick={() => { setQuery(''); setResults([]); }} 
                    style={{ position: 'absolute', right: '15px', top: '50%', transform: 'translateY(-50%)', cursor: 'pointer', color: '#888', fontWeight: 'bold', zIndex: 10 }}>
                    ✕
                </span>
            )}
            {!dataReady && (
                <div style={{ position: 'absolute', right: '15px', top: '50%', transform: 'translateY(-50%)', zIndex: 10 }}>
                    <div className="splash-loader" style={{ width: '20px', height: '20px', margin: 0 }}></div>
                </div>
            )}
        </div>
        
        {results.length > 0 && (
          <div className="results-list" style={{ display: 'block', position: 'relative', width: '100%', left: 0, top: 0, zIndex: 20, marginTop: '10px' }}>
            {results[0].isRecent && <div style={{padding:'10px 15px', fontSize:'0.7rem', color:'var(--accent)', borderBottom:'1px solid var(--grid-line)'}}>SAVED ACCOUNTS</div>}
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
      
      <A2HSPrompt />
    </div>
  );
}

// --- END OF FILE Search.jsx ---