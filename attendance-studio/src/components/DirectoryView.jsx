import React, { useState, useEffect, useMemo } from 'react';
import { api } from '../services/api';

const ReadableJson = ({ data }) => {
    if (data === null || data === undefined) return <span style={{ color: '#888' }}>null</span>;
    if (typeof data !== 'object') return <span style={{ color: '#fff' }}>{String(data)}</span>;
    
    if (Array.isArray(data)) {
        if (data.length === 0) return <span style={{ color: '#888' }}>[ Empty ]</span>;
        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {data.map((item, i) => (
                    <div key={i} style={{ background: 'rgba(255,255,255,0.03)', padding: '8px', borderLeft: '2px solid var(--primary)', borderRadius: '0 4px 4px 0' }}>
                        <ReadableJson data={item} />
                    </div>
                ))}
            </div>
        );
    }
    
    return (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(120px, max-content) 1fr', gap: '4px 10px', fontSize: '0.75rem' }}>
            {Object.entries(data).map(([k, v]) => (
                <React.Fragment key={k}>
                    <div style={{ color: '#aaa', textTransform: 'capitalize', alignSelf: 'start', marginTop: '2px', wordBreak: 'break-word', fontWeight: 'bold' }}>{k.replace(/([A-Z])/g, ' $1').trim()}</div>
                    <div style={{ wordBreak: 'break-word' }}><ReadableJson data={v} /></div>
                </React.Fragment>
            ))}
        </div>
    );
};

export default function DirectoryView({ user }) {
    const [data, setData] = useState([]);
    const [total, setTotal] = useState(0);
    const [programmes, setProgrammes] = useState({});
    
    // Offline Data
    const [useOffline, setUseOffline] = useState(false);
    const [offlineData, setOfflineData] = useState([]);
    const [loadingOffline, setLoadingOffline] = useState(false);
    
    // Controls
    const [page, setPage] = useState(1);
    const [limit, setLimit] = useState(10);
    const [sortBy, setSortBy] = useState('name');
    const [order, setOrder] = useState('asc');
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedProgs, setSelectedProgs] = useState([]);
    
    const [loading, setLoading] = useState(true);
    const [expandedRow, setExpandedRow] = useState(null);
    const [detailsData, setDetailsData] = useState({});
    const [detailsLoading, setDetailsLoading] = useState(false);
    
    // Inline password validation for unverified
    const [testPwd, setTestPwd] = useState('');
    const [testing, setTesting] = useState(false);
    const [testErr, setTestErr] = useState('');

    useEffect(() => {
        if (!useOffline) {
            fetchDirectory();
        }
    }, [page, limit, sortBy, order, searchQuery, selectedProgs, useOffline]);

    useEffect(() => {
        if (useOffline && offlineData.length === 0) {
            fetchOffline();
        }
    }, [useOffline]);

    const fetchDirectory = async () => {
        setLoading(true);
        try {
            const res = await api.post(`/directory_v2?page=${page}&limit=${limit}&sort_by=${sortBy}&order=${order}&q=${searchQuery}&matric=${user.matric}`, {
                programmes: selectedProgs
            });
            setData(res.results || []);
            setTotal(res.total || 0);
            setProgrammes(res.programmes || {});
        } catch (e) {
            console.error("Failed to load directory");
        }
        setLoading(false);
    };

    const fetchOffline = async () => {
        setLoadingOffline(true);
        try {
            const res = await api.get(`/directory?type=student`);
            // Offline schema is {m, n, t} instead of {matric, name, ...}
            setOfflineData((res || []).map(x => ({ matric: x.m, name: x.n, isOffline: true })));
        } catch (e) {
            console.error("Failed offline load");
        }
        setLoadingOffline(false);
    };

    const toggleProg = (p) => {
        setPage(1);
        if (selectedProgs.includes(p)) setSelectedProgs(selectedProgs.filter(x => x !== p));
        else setSelectedProgs([...selectedProgs, p]);
    };

    // Derived Data for offline map
    const displayData = useMemo(() => {
        if (!useOffline) return data;
        const sq = searchQuery.toUpperCase();
        const filtered = offlineData.filter(x => x.name.toUpperCase().includes(sq) || String(x.matric).includes(sq));
        return filtered.slice((page - 1) * limit, page * limit);
    }, [useOffline, offlineData, data, searchQuery, page, limit]);

    const totalPages = Math.ceil((useOffline ? offlineData.filter(x => x.name.toUpperCase().includes(searchQuery.toUpperCase()) || String(x.matric).includes(searchQuery.toUpperCase())).length : total) / limit) || 1;

    const handleExpand = async (item) => {
        if (expandedRow === item.matric) {
            setExpandedRow(null);
            return;
        }
        setExpandedRow(item.matric);
        setTestPwd('');
        setTestErr('');
        
        if (item.isOffline) return; // Wait for password input if offline
        if (detailsData[item.matric]) return;
        
        setDetailsLoading(true);
        try {
            const res = await api.get(`/student_details_proxy?matric=${item.matric}&password=${item.password}`);
            setDetailsData(prev => ({ ...prev, [item.matric]: res }));
        } catch (e) {
            console.error("Failed to load details");
        }
        setDetailsLoading(false);
    };

    const submitOfflinePwd = async (item) => {
        setTesting(true);
        setTestErr('');
        try {
            const validRes = await api.post('/tools/validate', { matric: item.matric, password: testPwd, auto: false, initiator: user.matric });
            if (validRes.valid) {
                // If valid, treat it as real
                setTestErr('Verified! Loading data (this might take a few moments)...');
                const detRes = await api.get(`/student_details_proxy?matric=${item.matric}&password=${testPwd}`);
                setDetailsData(prev => ({ ...prev, [item.matric]: detRes }));
                item.isOffline = false; // Upgrade local state
                item.password = testPwd;
            } else {
                setTestErr('Invalid Password.');
            }
        } catch (e) {
            setTestErr('Validation Error.');
        }
        setTesting(false);
    };

    const selectStyle = { width: '140px', padding: '0 10px', background: '#222', color: '#fff', border: '1px solid #444', height: '32px', boxSizing: 'border-box', borderRadius: '4px', outline: 'none', cursor: 'pointer' };

    const renderDetails = (item) => {
        const matric = item.matric;
        
        if (item.isOffline && !detailsData[matric]) {
            return (
                <div style={{ padding: '15px', background: 'rgba(0,0,0,0.3)', borderTop: '1px solid var(--grid-line)', textAlign: 'center' }}>
                    <div style={{ color: 'var(--primary)', marginBottom: '10px', fontSize: '0.85rem' }}>UNVERIFIED ACCOUNT</div>
                    <div style={{ color: '#888', fontSize: '0.75rem', marginBottom: '10px' }}>To view this user's data, provide their Unimas identity password. This will verify them and spawn their profile globally automatically!</div>
                    <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
                        <input 
                            type="text" className="t-input" placeholder="Password" 
                            value={testPwd} onChange={e=>setTestPwd(e.target.value)} 
                            style={{ padding: '5px 10px', textAlign: 'center' }}
                        />
                        <button className="btn" onClick={() => submitOfflinePwd(item)} disabled={testing || !testPwd}>
                            {testing ? 'TESTING...' : 'VERIFY & LOAD'}
                        </button>
                    </div>
                    {testErr && <div style={{ color: testErr.includes('Verified') ? '#0f0' : '#f00', fontSize: '0.75rem', marginTop: '10px' }}>{testErr}</div>}
                </div>
            );
        }

        const d = detailsData[matric];
        if (!d && detailsLoading) return <div style={{padding: '15px', textAlign: 'center', color: '#888'}}>Loading background data...</div>;
        if (!d) return null;
        
        return (
            <div style={{ padding: '15px', background: 'rgba(0,0,0,0.3)', borderTop: '1px solid var(--grid-line)' }}>
                {Object.entries(d).map(([key, val]) => (
                    <details style={{ marginBottom: '10px' }} key={key}>
                        <summary style={{ cursor: 'pointer', color: 'var(--primary)', fontWeight: 'bold', textTransform: 'uppercase' }}>{key.replace('_', ' ')}</summary>
                        <div style={{ padding: '10px', background: 'rgba(0,0,0,0.5)', borderRadius: '4px', marginTop: '5px', overflowX: 'auto' }}>
                            <ReadableJson data={val} />
                        </div>
                    </details>
                ))}
            </div>
        );
    };

    return (
        <div style={{ width: '100%', maxWidth: '800px', margin: '0 auto', display: 'flex', flexDirection: 'column' }}>
            {/* SEARCH & FILTERS */}
            <div style={{ marginBottom: '15px' }}>
                <input
                    type="text"
                    className="t-input"
                    placeholder={useOffline ? "SEARCH UNVERIFIED DIRECTORY (ALL STUDENTS)..." : "SEARCH VERIFIED DIRECTORY..."}
                    value={searchQuery}
                    onChange={e => { setSearchQuery(e.target.value); setPage(1); }}
                    style={{ width: '100%', textAlign: 'center', padding: '10px', marginBottom: '10px' }}
                />
                
                <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', justifyContent: 'center', marginBottom: '10px', alignItems: 'center' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '0.8rem', color: useOffline ? 'var(--primary)' : '#888', cursor: 'pointer', border: '1px solid #444', padding: '5px 10px', borderRadius: '4px', background: '#1a1a1a', height: '32px', boxSizing: 'border-box' }}>
                        <input type="checkbox" checked={useOffline} onChange={e => { setUseOffline(e.target.checked); setPage(1); }} />
                        Include Unverified System Accs
                    </label>

                    {!useOffline && (
                        <>
                            <select className="t-input" value={limit} onChange={e => { setLimit(Number(e.target.value)); setPage(1); }} style={{ ...selectStyle, width: '100px' }}>
                                <option value={10}>10 rows</option>
                                <option value={20}>20 rows</option>
                                <option value={50}>50 rows</option>
                            </select>

                            <select className="t-input" value={sortBy} onChange={e => { setSortBy(e.target.value); setPage(1); }} style={selectStyle}>
                                <option value="name">Sort by Name</option>
                                <option value="matric">Sort by Matric</option>
                                <option value="cgpa">Sort by CGPA</option>
                            </select>

                            <button className="btn" style={{ padding: '5px 15px', height: '32px' }} onClick={() => setOrder(order === 'asc' ? 'desc' : 'asc')}>
                                {order.toUpperCase()} ↕
                            </button>
                        </>
                    )}
                </div>

                {!useOffline && Object.keys(programmes).length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', justifyContent: 'center', padding: '10px', background: 'rgba(255,255,255,0.02)', borderRadius: '4px' }}>
                        {Object.entries(programmes).map(([p, c]) => (
                            <button 
                                key={p} 
                                className="btn" 
                                style={{ 
                                    padding: '4px 8px', fontSize: '0.65rem', 
                                    borderColor: selectedProgs.includes(p) ? 'var(--primary)' : 'var(--grid-line)',
                                    color: selectedProgs.includes(p) ? 'var(--primary)' : '#888'
                                }}
                                onClick={() => toggleProg(p)}
                            >
                                {p} ({c})
                            </button>
                        ))}
                    </div>
                )}
            </div>

            {/* DATA TABLE */}
            <div style={{ flex: 1, minHeight: '50vh', background: 'rgba(0,0,0,0.5)', border: '1px solid var(--grid-line)', borderRadius: '4px', overflow: 'hidden' }}>
                <div style={{ display: 'flex', padding: '10px', background: 'rgba(255,255,255,0.05)', color: 'var(--primary)', fontWeight: 'bold', fontSize: '0.75rem', borderBottom: '1px solid var(--grid-line)' }}>
                    {!useOffline && sortBy === 'cgpa' && <div style={{ width: '80px', flexShrink: 0 }}>RANK</div>}
                    <div style={{ width: '50px', flexShrink: 0 }}>PIC</div>
                    <div style={{ flex: 1, minWidth: '150px' }}>NAME / MATRIC</div>
                    {!useOffline && (
                        <>
                            <div style={{ flex: 1, minWidth: '120px' }}>PROGRAMME</div>
                            <div style={{ width: '60px', textAlign: 'right' }}>CGPA</div>
                        </>
                    )}
                </div>

                {(loading && !useOffline) || (loadingOffline && useOffline) ? <div style={{ padding: '30px', textAlign: 'center', color: '#888' }}>Loading Directory Data...</div> : displayData.length === 0 ? <div style={{ padding: '30px', textAlign: 'center', color: '#888' }}>NO RESULTS</div> : (
                    <div style={{ maxHeight: '60vh', overflowY: 'auto' }}>
                        {displayData.map(u => (
                            <div key={`${u.matric}_${u.is_appended_owner ? 'owner' : 'list'}`} style={{ borderBottom: '1px solid var(--grid-line)' }}>
                                <div 
                                    style={{ 
                                        display: 'flex', padding: '10px', alignItems: 'center', cursor: 'pointer',
                                        background: u.is_appended_owner ? 'rgba(0, 243, 255, 0.1)' : 'transparent',
                                        opacity: u.isOffline ? 0.6 : 1
                                    }}
                                    onClick={() => handleExpand(u)}
                                >
                                    {!useOffline && sortBy === 'cgpa' && (
                                        <div style={{ width: '80px', flexShrink: 0, fontSize: '0.7rem' }}>
                                            <div style={{ color: 'var(--accent)', fontWeight: 'bold' }}>#{u.rank || '-'}</div>
                                            <div style={{ color: '#888' }}>Top {u.top_pct || '0'}%</div>
                                        </div>
                                    )}
                                    <div style={{ width: '50px', flexShrink: 0 }}>
                                        <img src={`https://studentphotos.unimas.my/${u.matric}.jpg`} style={{ width: '35px', height: '35px', borderRadius: '50%', objectFit: 'cover' }} onError={e=>e.target.style.display='none'} alt=""/>
                                    </div>
                                    <div style={{ flex: 1, minWidth: '150px', overflow: 'hidden' }}>
                                        <div style={{ fontSize: '0.85rem', color: u.isOffline ? '#aaa' : '#fff', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>{u.name}</div>
                                        <div style={{ fontSize: '0.7rem', color: '#888' }}>{u.matric} {u.isOffline ? '(Unverified)' : ''} {u.is_appended_owner ? '(YOU)' : ''}</div>
                                    </div>
                                    {!useOffline && (
                                        <>
                                            <div style={{ flex: 1, minWidth: '120px', fontSize: '0.7rem', color: '#aaa', paddingRight: '10px' }}>
                                                {u.programme || 'Unknown Program'}
                                            </div>
                                            <div style={{ width: '60px', textAlign: 'right', fontWeight: 'bold', color: u.cgpa >= 3.5 ? '#0f0' : '#fff' }}>
                                                {(u.cgpa || 0).toFixed(2)}
                                            </div>
                                        </>
                                    )}
                                </div>
                                {expandedRow === u.matric && renderDetails(u)}
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* PAGINATION */}
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', margin: '15px 0', gap: '15px' }}>
                <button className="btn" disabled={page <= 1 || loading || loadingOffline} onClick={() => setPage(page - 1)} style={{ padding: '8px 20px' }}>PREV</button>
                <div style={{ color: 'var(--primary)', fontWeight: 'bold', fontSize: '0.85rem' }}>
                    PAGE {page} OF {totalPages}
                </div>
                <button className="btn" disabled={page >= totalPages || loading || loadingOffline} onClick={() => setPage(page + 1)} style={{ padding: '8px 20px' }}>NEXT</button>
            </div>
        </div>
    );
}
