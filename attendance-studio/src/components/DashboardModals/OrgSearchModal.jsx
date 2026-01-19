import { useState, useEffect } from 'react';
import { api } from '../../services/api';
import Modal from '../Modal';

export default function OrgSearchModal({ isOpen, onClose, onFollow }) {
    const [query, setQuery] = useState('');
    const [directory, setDirectory] = useState([]);
    const [results, setResults] = useState([]);

    // Load Organizer Directory on mount
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
            const activities = (u.a || "").split(' | '); // Split activity string into array
            
            // Check if Name or ID matches
            if (nameClean.includes(cleanVal) || idClean.includes(cleanVal)) {
                return { ...u, matchType: 'organizer' };
            }

            // Check if any Event matches
            const matchedEvent = activities.find(act => 
                act.toUpperCase().replace(/\s+/g, '').includes(cleanVal)
            );

            if (matchedEvent) {
                return { ...u, matchType: 'event', matchedEventName: matchedEvent };
            }

            return null;
        }).filter(item => item !== null).slice(0, 10);
        
        setResults(matches);
    };

    return (
        <Modal title="FIND ACTIVITY SOURCE" isOpen={isOpen} onClose={onClose} maxWidth="400px">
            <input 
                type="text" 
                className="t-input" 
                placeholder="Type Organizer or Event Name..." 
                style={{ width: '100%', textAlign: 'left', marginBottom: '10px' }}
                value={query}
                onChange={(e) => handleSearch(e.target.value)}
            />
            
            <div className="results-list" style={{ position: 'static', display: 'block', maxHeight: '300px', border: 'none', boxShadow:'none', overflowY:'auto' }}>
                {results.map(u => (
                    <div key={u.m} className="result-item" onClick={() => onFollow(u.m)}>
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                            <span style={{ color: 'var(--accent)', fontWeight: 'bold' }}>{u.n}</span>
                            
                            {/* Logic: Show Event Name if it was the match, otherwise show ID */}
                            {u.matchType === 'event' ? (
                                <span style={{ color: '#fff', fontSize: '0.75rem', fontStyle: 'italic' }}>
                                    Event: {u.matchedEventName}
                                </span>
                            ) : (
                                <span style={{ color: '#666', fontSize: '0.75rem' }}>
                                    ID: {u.m}
                                </span>
                            )}
                        </div>
                    </div>
                ))}
                {query.length > 1 && results.length === 0 && (
                    <div style={{ padding: '15px', textAlign: 'center', color: '#666' }}>NO RESULTS</div>
                )}
            </div>
        </Modal>
    );
}