import React, { useState, useEffect, useMemo } from 'react';
import { api } from '../services/api';

const ReadableJson = ({ data }) => {
    let parsedData = data;
    if (typeof data === 'string' && (data.trim().startsWith('{') || data.trim().startsWith('['))) {
        try { parsedData = JSON.parse(data); } catch(e) {}
    }
    
    if (parsedData === null || parsedData === undefined) return <span style={{ color: '#888' }}>null</span>;
    if (typeof parsedData !== 'object') return <span style={{ color: '#fff' }}>{String(parsedData)}</span>;
    
    if (Array.isArray(parsedData)) {
        if (parsedData.length === 0) return <span style={{ color: '#888' }}>[ Empty ]</span>;
        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {parsedData.map((item, i) => (
                    <div key={i} style={{ background: 'rgba(255,255,255,0.03)', padding: '8px', borderLeft: '2px solid var(--primary)', borderRadius: '0 4px 4px 0' }}>
                        <ReadableJson data={item} />
                    </div>
                ))}
            </div>
        );
    }
    
    return (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(120px, max-content) 1fr', gap: '4px 10px', fontSize: '0.75rem' }}>
            {Object.entries(parsedData).map(([k, v]) => (
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
    const [hierarchy, setHierarchy] = useState({});
    
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
    const [selectedFaculty, setSelectedFaculty] = useState('');
    const [selectedProgs, setSelectedProgs] = useState([]);
    
    const [loading, setLoading] = useState(true);
    const [expandedRow, setExpandedRow] = useState(null);
    const [detailsData, setDetailsData] = useState({});
    const [detailsLoading, setDetailsLoading] = useState(false);
    
    // Inline password validation for unverified
    const [testPwd, setTestPwd] = useState('');
    const [testing, setTesting] = useState(false);
    const [testErr, setTestErr] = useState('');

    const [includeUnverified, setIncludeUnverified] = useState(false);
    const [intakeYear, setIntakeYear] = useState('');
    const [intakeList, setIntakeList] = useState([]);
    const [totalPages, setTotalPages] = useState(1);

    useEffect(() => {
        fetchDirectory();
    }, [page, limit, sortBy, order, searchQuery, selectedProgs, selectedFaculty, includeUnverified, intakeYear]);

    const fetchDirectory = async () => {
        setLoading(true);
        try {
            const res = await api.post(`/directory_v2?page=${page}&q=${searchQuery}&matric=${user.matric}`, {
                programme: selectedProgs.length > 0 ? selectedProgs[0] : null,
                faculty: selectedFaculty,
                include_unverified: includeUnverified,
                row_limit: limit,
                sort_by: sortBy,
                sort_order: order,
                intake_year: intakeYear
            });
            setData(res.data || res.results || []);
            setTotal(res.total || 0);
            setTotalPages(res.total_pages || 1);
            setIntakeList(res.intakes || []);
            
            const h = res.hierarchy || {};
            setHierarchy(h);
        } catch (e) {
            console.error("Failed to load directory");
        }
        setLoading(false);
    };

    const toggleProg = (p) => {
        setPage(1);
        if (selectedProgs.includes(p)) setSelectedProgs(selectedProgs.filter(x => x !== p));
        else setSelectedProgs([...selectedProgs, p]);
    };

    const displayData = data;

    const handleExpand = async (item) => {
        if (expandedRow === item.matric) {
            setExpandedRow(null);
            return;
        }
        setExpandedRow(item.matric);
        setTestPwd('');
        setTestErr('');
        
        if (item.password === 'Unknown') return; // Wait for password input if offline
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
        
        if (item.password === 'Unknown' && !detailsData[matric]) {
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
                    placeholder={includeUnverified ? "SEARCH DIRECTORY INCLUDING UNVERIFIED..." : "SEARCH VERIFIED DIRECTORY..."}
                    value={searchQuery}
                    onChange={e => { setSearchQuery(e.target.value); setPage(1); }}
                    style={{ width: '100%', textAlign: 'center', padding: '10px', marginBottom: '10px' }}
                />
                
                <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', justifyContent: 'center', marginBottom: '10px', alignItems: 'center' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '0.8rem', color: includeUnverified ? 'var(--primary)' : '#888', cursor: 'pointer', border: '1px solid #444', padding: '5px 10px', borderRadius: '4px', background: '#1a1a1a', height: '32px', boxSizing: 'border-box' }}>
                        <input type="checkbox" checked={includeUnverified} onChange={e => { setIncludeUnverified(e.target.checked); setPage(1); }} />
                        Include Unverified System Accs
                    </label>

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
                    
                    {intakeList.length > 0 && (
                        <select className="t-input" value={intakeYear} onChange={e => { setIntakeYear(e.target.value); setPage(1); }} style={{ ...selectStyle, width: '130px' }}>
                            <option value="">Any Intake</option>
                            {intakeList.map(y => <option key={y} value={y}>{y}</option>)}
                        </select>
                    )}
                </div>

                {Object.keys(hierarchy).length > 0 && (
                    <div style={{ padding: '10px', background: 'rgba(255,255,255,0.02)', borderRadius: '4px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <select 
                            className="t-input" 
                            style={{ ...selectStyle, width: '100%', maxWidth: '400px', margin: '0 auto', textAlign: 'center', fontWeight: 'bold' }} 
                            value={selectedFaculty} 
                            onChange={(e) => { setSelectedFaculty(e.target.value); setSelectedProgs([]); setPage(1); }}
                        >
                            <option value="">ALL FACULTIES</option>
                            {Object.keys(hierarchy).map(fac => <option key={fac} value={fac}>{fac.toUpperCase()}</option>)}
                        </select>
                        
                        {selectedFaculty && hierarchy[selectedFaculty] && (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', justifyContent: 'center' }}>
                                {Object.entries(hierarchy[selectedFaculty]).map(([p, c]) => (
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
                )}
            </div>

            {/* DATA TABLE */}
            <div style={{ flex: 1, minHeight: '50vh', background: 'rgba(0,0,0,0.5)', border: '1px solid var(--grid-line)', borderRadius: '4px', overflow: 'hidden' }}>
                <div style={{ display: 'flex', padding: '10px', background: 'rgba(255,255,255,0.05)', color: 'var(--primary)', fontWeight: 'bold', fontSize: '0.75rem', borderBottom: '1px solid var(--grid-line)' }}>
                    <div style={{ width: '50px', flexShrink: 0 }}>PIC</div>
                    <div style={{ flex: 1, minWidth: '130px' }}>NAME / MATRIC</div>
                    <div style={{ flex: 1, minWidth: '130px' }}>PROGRAM / FACULTY</div>
                    <div style={{ width: '90px', textAlign: 'center' }}>INTAKE</div>
                    <div style={{ width: '85px', textAlign: 'right' }}>CGPA (PCT)</div>
                </div>

                {loading ? <div style={{ padding: '30px', textAlign: 'center', color: '#888' }}>Loading Directory Data...</div> : displayData.length === 0 ? <div style={{ padding: '30px', textAlign: 'center', color: '#888' }}>NO RESULTS</div> : (
                    <div style={{ maxHeight: '60vh', overflowY: 'auto' }}>
                        {displayData.map(u => {
                            const pct = u.top_pct || 100;
                            let cgpaColor = '#888';
                            if (pct <= 1) cgpaColor = '#ffd700';
                            else if (pct <= 10) cgpaColor = '#00f3ff';
                            else if (pct <= 25) cgpaColor = '#a2ff00';
                            else if (pct <= 50) cgpaColor = '#00ff00';
                            else if (pct <= 75) cgpaColor = '#ffff00';
                            
                            return (
                                <div key={`${u.matric}_${u.is_appended_owner ? 'owner' : 'list'}`} style={{ borderBottom: '1px solid var(--grid-line)' }}>
                                    <div 
                                        style={{ 
                                            display: 'flex', padding: '10px', alignItems: 'center', cursor: 'pointer',
                                            background: u.is_appended_owner ? 'rgba(0, 243, 255, 0.1)' : 'transparent',
                                            opacity: u.isOffline ? 0.6 : 1
                                        }}
                                        onClick={() => handleExpand(u)}
                                    >
                                        <div style={{ width: '50px', flexShrink: 0 }}>
                                            <img src={`https://studentphotos.unimas.my/${u.matric}.jpg`} style={{ width: '35px', height: '35px', borderRadius: '50%', objectFit: 'cover' }} onError={e=>e.target.style.display='none'} alt=""/>
                                        </div>
                                        <div style={{ flex: 1, minWidth: '130px', overflow: 'hidden', paddingRight: '10px' }}>
                                            <div style={{ fontSize: '0.85rem', color: u.password === 'Unknown' ? '#aaa' : '#fff', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>{u.name}</div>
                                            <div style={{ fontSize: '0.7rem', color: '#888' }}>
                                                {u.matric} {u.password === 'Unknown' ? '(Unverified)' : ''} {u.is_appended_owner ? '(YOU)' : ''}
                                            </div>
                                        </div>
                                        <div style={{ flex: 1, minWidth: '130px', fontSize: '0.7rem', color: '#aaa', paddingRight: '10px', overflow: 'hidden' }}>
                                            <div style={{ color: 'var(--primary)', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>{u.programme || 'Unknown Program'}</div>
                                            <div style={{ whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>{u.faculty || 'Unknown Faculty'}</div>
                                        </div>
                                        <div style={{ width: '90px', textAlign: 'center', fontSize: '0.75rem', color: '#888', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                            {u.intake_year || 'Unknown'}
                                        </div>
                                        <div style={{ width: '85px', textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', justifyContent: 'center' }}>
                                            {u.password !== 'Unknown' && (
                                                <>
                                                    <div style={{ fontWeight: 'bold', color: cgpaColor, fontSize: '0.9rem' }}>
                                                        {(u.cgpa || 0).toFixed(2)}
                                                    </div>
                                                    <div style={{ fontSize: '0.65rem', padding: '2px 4px', background: 'rgba(0,0,0,0.4)', borderRadius: '3px', color: cgpaColor, border: `1px solid ${cgpaColor}40` }}>
                                                        TOP {pct}%
                                                    </div>
                                                </>
                                            )}
                                        </div>
                                    </div>
                                    {expandedRow === u.matric && renderDetails(u)}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* PAGINATION */}
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', margin: '15px 0', gap: '15px' }}>
                <button className="btn" disabled={page <= 1 || loading} onClick={() => setPage(page - 1)} style={{ padding: '8px 20px' }}>PREV</button>
                <div style={{ color: 'var(--primary)', fontWeight: 'bold', fontSize: '0.85rem' }}>
                    PAGE {page} OF {totalPages}
                </div>
                <button className="btn" disabled={page >= totalPages || loading} onClick={() => setPage(page + 1)} style={{ padding: '8px 20px' }}>NEXT</button>
            </div>
        </div>
    );
}
