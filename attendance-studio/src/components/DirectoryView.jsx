import React, { useState, useEffect, useMemo } from 'react';
import { api } from '../services/api';

const ReadableJson = ({ data }) => {
    if (!data) return null;
    if (typeof data !== 'object') return <span>{String(data)}</span>;
    return (
        <div style={{ fontSize: '0.8rem', fontFamily: 'monospace' }}>
            {Object.entries(data).map(([k, v]) => (
                <div key={k} style={{ marginBottom: '4px' }}>
                    <span style={{ color: '#888' }}>{k}: </span>
                    <span style={{ color: '#fff' }}>{typeof v === 'object' ? JSON.stringify(v) : String(v)}</span>
                </div>
            ))}
        </div>
    );
};

export default function DirectoryView({ user }) {
    const [fullCache, setFullCache] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [includeUnverified, setIncludeUnverified] = useState(false);
    const [page, setPage] = useState(1);
    const [limit, setLimit] = useState(20);
    const [sortBy, setSortBy] = useState('name');
    const [order, setOrder] = useState('asc');
    const [selectedFaculty, setSelectedFaculty] = useState("");
    const [selectedProgs, setSelectedProgs] = useState([]);
    const [detailsLoading, setDetailsLoading] = useState(false);
    const [detailsData, setDetailsData] = useState({});
    const [expandedRow, setExpandedRow] = useState(null);
    const [intakeYear, setIntakeYear] = useState("");
    const [testPwd, setTestPwd] = useState('');
    const [testErr, setTestErr] = useState('');
    const [testing, setTesting] = useState(false);

    useEffect(() => {
        loadDirectory();
    }, []);

    const loadDirectory = async () => {
        setLoading(true);
        try {
            // High-performance one-time dump for offline-first responsiveness
            const res = await api.get('/directory_dump');
            setFullCache(res || []);
        } catch (e) {
            console.error("Failed to load directory dump", e);
        }
        setLoading(false);
    };

    // --- CLIENT-SIDE LOGIC (NO MORE BACKEND KEUKEN) ---
    const { filteredData, hierarchy, intakeList } = useMemo(() => {
        const facs = {};
        const intakes = new Set();

        const filtered = fullCache.filter(u => {
            if (u.i) intakes.add(u.i);
            if (u.f) {
                if (!facs[u.f]) facs[u.f] = {};
                if (u.p) facs[u.f][u.p] = (facs[u.f][u.p] || 0) + 1;
            }

            if (!includeUnverified && u.pw === 'Unknown') return false;
            
            if (selectedFaculty && u.f !== selectedFaculty) return false;
            if (selectedProgs.length > 0 && !selectedProgs.includes(u.p)) return false;
            if (intakeYear && u.i !== intakeYear) return false;

            if (searchQuery) {
                const s = searchQuery.toUpperCase().replace(/\s+/g, '');
                const name = (u.n || '').toUpperCase().replace(/\s+/g, '');
                const matric = (u.m || '').toUpperCase();
                const prog = (u.p || '').toUpperCase().replace(/\s+/g, '');
                return name.includes(s) || matric.includes(s) || prog.includes(s);
            }
            return true;
        });

        return { 
            filteredData: filtered, 
            hierarchy: facs, 
            intakeList: Array.from(intakes).sort().reverse() 
        };
    }, [fullCache, searchQuery, includeUnverified, selectedFaculty, selectedProgs, intakeYear]);

    const sortedData = useMemo(() => {
        const sorted = [...filteredData];
        sorted.sort((a, b) => {
            let va = a[sortBy === 'name' ? 'n' : sortBy === 'matric' ? 'm' : 'c'] || '';
            let vb = b[sortBy === 'name' ? 'n' : sortBy === 'matric' ? 'm' : 'c'] || '';
            
            if (typeof va === 'string') va = va.toLowerCase();
            if (typeof vb === 'string') vb = vb.toLowerCase();

            if (va < vb) return order === 'asc' ? -1 : 1;
            if (va > vb) return order === 'asc' ? 1 : -1;
            return 0;
        });
        return sorted;
    }, [filteredData, sortBy, order]);

    const totalPages = Math.ceil(sortedData.length / limit);
    const displayData = sortedData.slice((page - 1) * limit, page * limit);

    const toggleProg = (p) => {
        setPage(1);
        if (selectedProgs.includes(p)) setSelectedProgs(selectedProgs.filter(x => x !== p));
        else setSelectedProgs([...selectedProgs, p]);
    };

    const handleExpand = async (item) => {
        if (expandedRow === item.m) {
            setExpandedRow(null);
            return;
        }
        setExpandedRow(item.m);
        setTestPwd('');
        setTestErr('');
        
        if (item.pw === 'Unknown') return; 
        if (detailsData[item.m]) return;
        
        setDetailsLoading(true);
        try {
            const res = await api.get(`/student_details_proxy?matric=${item.m}&password=${item.pw}`);
            setDetailsData(prev => ({ ...prev, [item.m]: res }));
        } catch (e) {
            console.error("Failed to load details");
        }
        setDetailsLoading(false);
    };

    const submitOfflinePwd = async (item) => {
        setTesting(true);
        setTestErr('');
        try {
            const validRes = await api.post('/tools/validate', { matric: item.m, password: testPwd, auto: false, initiator: user.matric });
            if (validRes.valid) {
                setTestErr('Verified! Loading data...');
                const detRes = await api.get(`/student_details_proxy?matric=${item.m}&password=${testPwd}`);
                setDetailsData(prev => ({ ...prev, [item.m]: detRes }));
                item.pw = testPwd; 
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
        const m = item.m;
        if (item.pw === 'Unknown' && !detailsData[m]) {
            return (
                <div style={{ padding: '15px', background: 'rgba(0,0,0,0.3)', borderTop: '1px solid var(--grid-line)', textAlign: 'center' }}>
                    <div style={{ color: 'var(--primary)', marginBottom: '10px', fontSize: '0.85rem' }}>UNVERIFIED ACCOUNT</div>
                    <div style={{ color: '#888', fontSize: '0.75rem', marginBottom: '10px' }}>Provide password to verify and load live data.</div>
                    <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
                        <input type="text" className="t-input" placeholder="Password" value={testPwd} onChange={e=>setTestPwd(e.target.value)} style={{ padding: '5px 10px', textAlign: 'center' }} />
                        <button className="btn" onClick={() => submitOfflinePwd(item)} disabled={testing || !testPwd}>{testing ? '...' : 'VERIFY'}</button>
                    </div>
                    {testErr && <div style={{ color: testErr.includes('Verified') ? '#0f0' : '#f00', fontSize: '0.75rem', marginTop: '10px' }}>{testErr}</div>}
                </div>
            );
        }
        const d = detailsData[m];
        if (!d && detailsLoading) return <div style={{padding: '15px', textAlign: 'center', color: '#888'}}>Loading...</div>;
        if (!d) return null;
        return (
            <div style={{ padding: '15px', background: 'rgba(0,0,0,0.3)', borderTop: '1px solid var(--grid-line)' }}>
                {Object.entries(d).map(([key, val]) => (
                    <details style={{ marginBottom: '10px' }} key={key}>
                        <summary style={{ cursor: 'pointer', color: 'var(--primary)', fontWeight: 'bold' }}>{key.toUpperCase()}</summary>
                        <div style={{ padding: '10px', background: 'rgba(0,0,0,0.5)', borderRadius: '4px', marginTop: '5px' }}><ReadableJson data={val} /></div>
                    </details>
                ))}
            </div>
        );
    };

    return (
        <div style={{ width: '100%', maxWidth: '800px', margin: '0 auto', display: 'flex', flexDirection: 'column' }}>
            <div style={{ marginBottom: '15px' }}>
                <input
                    type="text" className="t-input" placeholder="Search full directory..." value={searchQuery}
                    onChange={e => { setSearchQuery(e.target.value); setPage(1); }}
                    style={{ width: '100%', textAlign: 'center', padding: '10px', marginBottom: '10px' }}
                />
                
                <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', justifyContent: 'center', marginBottom: '10px', alignItems: 'center' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '0.8rem', cursor: 'pointer', border: '1px solid #444', padding: '5px 10px', borderRadius: '4px', background: '#1a1a1a', color: includeUnverified ? 'var(--primary)' : '#888' }}>
                        <input type="checkbox" checked={includeUnverified} onChange={e => { setIncludeUnverified(e.target.checked); setPage(1); }} />
                        Include Unverified
                    </label>

                    <select className="t-input" value={limit} onChange={e => { setLimit(Number(e.target.value)); setPage(1); }} style={{ ...selectStyle, width: '100px' }}>
                        {[10, 20, 50, 100].map(v => <option key={v} value={v}>{v} rows</option>)}
                    </select>

                    <select className="t-input" value={sortBy} onChange={e => { setSortBy(e.target.value); setPage(1); }} style={selectStyle}>
                        <option value="name">Name</option>
                        <option value="matric">Matric</option>
                        <option value="cgpa">CGPA</option>
                    </select>

                    <button className="btn" style={{ padding: '5px 15px', height: '32px' }} onClick={() => setOrder(order === 'asc' ? 'desc' : 'asc')}>{order.toUpperCase()} ↕</button>
                    
                    {intakeList.length > 0 && (
                        <select className="t-input" value={intakeYear} onChange={e => { setIntakeYear(e.target.value); setPage(1); }} style={{ ...selectStyle, width: '130px' }}>
                            <option value="">Any Intake</option>
                            {intakeList.map(y => <option key={y} value={y}>{y}</option>)}
                        </select>
                    )}
                </div>

                {Object.keys(hierarchy).length > 0 && (
                    <div style={{ padding: '10px', background: 'rgba(255,255,255,0.02)', borderRadius: '4px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <select className="t-input" style={{ ...selectStyle, width: '100%', maxWidth: '400px', margin: '0 auto' }} value={selectedFaculty} onChange={(e) => { setSelectedFaculty(e.target.value); setSelectedProgs([]); setPage(1); }}>
                            <option value="">ALL FACULTIES</option>
                            {Object.keys(hierarchy).sort().map(fac => <option key={fac} value={fac}>{fac.toUpperCase()}</option>)}
                        </select>
                        {selectedFaculty && hierarchy[selectedFaculty] && (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', justifyContent: 'center' }}>
                                {Object.keys(hierarchy[selectedFaculty]).sort().map(p => (
                                    <button key={p} className="btn" style={{ padding: '4px 8px', fontSize: '0.65rem', borderColor: selectedProgs.includes(p) ? 'var(--primary)' : 'var(--grid-line)', color: selectedProgs.includes(p) ? 'var(--primary)' : '#888' }} onClick={() => toggleProg(p)}>{p} ({hierarchy[selectedFaculty][p]})</button>
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </div>

            <div style={{ flex: 1, minHeight: '50vh', background: 'rgba(0,0,0,0.5)', border: '1px solid var(--grid-line)', borderRadius: '4px', overflow: 'hidden' }}>
                <div style={{ display: 'flex', padding: '10px', background: 'rgba(255,255,255,0.05)', color: 'var(--primary)', fontWeight: 'bold', fontSize: '0.75rem', borderBottom: '1px solid var(--grid-line)' }}>
                    <div style={{ width: '50px' }}>PIC</div>
                    <div style={{ flex: 1 }}>NAME / MATRIC</div>
                    <div style={{ flex: 1 }}>PROGRAM / FACULTY</div>
                    <div style={{ width: '90px', textAlign: 'center' }}>INTAKE</div>
                    <div style={{ width: '85px', textAlign: 'right' }}>CGPA (TOP%)</div>
                </div>

                {loading ? <div style={{ padding: '30px', textAlign: 'center', color: '#888' }}>Caching Full Directory...</div> : displayData.length === 0 ? <div style={{ padding: '30px', textAlign: 'center', color: '#888' }}>NO RESULTS</div> : (
                    <div style={{ maxHeight: '60vh', overflowY: 'auto' }}>
                        {displayData.map(u => {
                            const pct = u.pct || 100;
                            let clr = pct <= 1 ? '#ffd700' : pct <= 10 ? '#00f3ff' : pct <= 25 ? '#a2ff00' : pct <= 50 ? '#00ff00' : '#888';
                            return (
                                <div key={u.m} style={{ borderBottom: '1px solid var(--grid-line)' }}>
                                    <div style={{ display: 'flex', padding: '10px', alignItems: 'center', cursor: 'pointer' }} onClick={() => handleExpand(u)}>
                                        <div style={{ width: '50px' }}><img src={`https://studentphotos.unimas.my/${u.m}.jpg`} style={{ width: '35px', height: '35px', borderRadius: '50%', objectFit: 'cover' }} onError={e=>e.target.style.display='none'} alt=""/></div>
                                        <div style={{ flex: 1, overflow: 'hidden' }}>
                                            <div style={{ fontSize: '0.85rem', color: u.pw === 'Unknown' ? '#aaa' : '#fff', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>{u.n}</div>
                                            <div style={{ fontSize: '0.7rem', color: '#888' }}>{u.m} {u.pw === 'Unknown' ? '(?)' : ''}</div>
                                        </div>
                                        <div style={{ flex: 1, fontSize: '0.7rem', color: '#aaa', overflow: 'hidden' }}>
                                            <div style={{ color: 'var(--primary)', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>{u.p}</div>
                                            <div style={{ whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>{u.f}</div>
                                        </div>
                                        <div style={{ width: '90px', textAlign: 'center', fontSize: '0.75rem', color: '#888' }}>{u.i}</div>
                                        <div style={{ width: '85px', textAlign: 'right' }}>
                                            {u.pw !== 'Unknown' && (
                                                <><div style={{ fontWeight: 'bold', color: clr, fontSize: '0.9rem' }}>{(u.c || 0).toFixed(2)}</div>
                                                <div style={{ fontSize: '0.65rem', color: clr }}>TOP {pct}%</div></>
                                            )}
                                        </div>
                                    </div>
                                    {expandedRow === u.m && renderDetails(u)}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', margin: '15px 0', gap: '15px' }}>
                <button className="btn" disabled={page <= 1} onClick={() => setPage(page - 1)}>PREV</button>
                <div style={{ color: 'var(--primary)', fontWeight: 'bold', fontSize: '0.85rem' }}>PAGE {page} OF {totalPages || 1} ({filteredData.length} entries)</div>
                <button className="btn" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>NEXT</button>
            </div>
        </div>
    );
}
