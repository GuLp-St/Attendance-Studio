import { useState, useEffect } from 'react';
import { api } from '../services/api';

export default function OrgSearchView({ onPreview }) {
    const [query, setQuery] = useState('');
    const [directory, setDirectory] = useState([]);
    const [results, setResults] = useState([]);

    useEffect(() => {
        api.get('/directory?type=organizer').then(setDirectory).catch(() => {});
    }, []);

    const handleSearch = (val) => {
        setQuery(val);
        if (val.length < 2) { setResults([]); return; }
        const cleanVal = val.toUpperCase().replace(/\s+/g, '');
        const matches = directory.map(u => {
            const nameClean = (u.n || "").toUpperCase().replace(/\s+/g, '');
            const idClean = u.m.toUpperCase();
            const activities = (u.a || "").split(' | ');
            if (nameClean.includes(cleanVal) || idClean.includes(cleanVal)) {
                return { ...u, matchType: 'organizer' };
            }
            const matchedEvent = activities.find(act => act.toUpperCase().replace(/\s+/g, '').includes(cleanVal));
            if (matchedEvent) return { ...u, matchType: 'event', matchedEventName: matchedEvent };
            return null;
        }).filter(item => item !== null).slice(0, 10);
        setResults(matches);
    };

    const handleClear = () => {
        setQuery('');
        setResults([]);
    };

    const handleSelect = (u) => {
        setQuery('');
        setResults([]);
        // Show preview instead of directly following
        onPreview(u.m, u.n);
    };

    return (
        <div style={{ marginTop: '10px', width: '100%', maxWidth: '400px', margin: '0 auto', marginBottom: '20px' }}>
            <div style={{ position: 'relative', width: '100%' }}>
                <input 
                    type="text" 
                    className="t-input" 
                    placeholder="ACTIVITY/HOST NAME" 
                    style={{ width: '100%', textAlign: 'center', padding: '12px', paddingRight: '40px', paddingLeft: '40px', background: 'rgba(255,255,255,0.05)', color: '#fff' }}
                    value={query}
                    onChange={(e) => handleSearch(e.target.value)}
                />
                {query && (
                    <span 
                        onClick={handleClear} 
                        style={{ position: 'absolute', right: '15px', top: '50%', transform: 'translateY(-50%)', cursor: 'pointer', color: '#888', fontWeight: 'bold', zIndex: 20 }}
                    >
                        ✕
                    </span>
                )}
                {/* Overlapping dropdown - absolute so it doesn't push content */}
                {results.length > 0 && (
                    <div className="results-list" style={{ 
                        position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 100,
                        maxHeight: '300px', overflowY: 'auto',
                        border: '1px solid var(--grid-line)', borderRadius: '4px',
                        background: 'var(--bg, #0a0a0a)', marginTop: '2px'
                    }}>
                        {results.map(u => (
                            <div key={u.m} className="result-item" onClick={() => handleSelect(u)}>
                                <div style={{ display: 'flex', flexDirection: 'column' }}>
                                    <span style={{ color: 'var(--accent)', fontWeight: 'bold' }}>{u.n}</span>
                                    {u.matchType === 'event' ? (
                                        <span style={{ color: '#fff', fontSize: '0.75rem', fontStyle: 'italic' }}>Event: {u.matchedEventName}</span>
                                    ) : (
                                        <span style={{ color: '#666', fontSize: '0.75rem' }}>ID: {u.m}</span>
                                    )}
                                </div>
                            </div>
                        ))}
                        {query.length > 1 && results.length === 0 && (
                            <div style={{ padding: '15px', textAlign: 'center', color: '#666' }}>NO RESULTS</div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
