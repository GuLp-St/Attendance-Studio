import React, { useState, useEffect, useMemo, useRef } from 'react';
import { api } from '../services/api';

// ============================================================
//  READABLE JSON — Collapsible, nested, human-friendly
// ============================================================
const JsonValue = ({ val, depth = 0 }) => {
    const [open, setOpen] = useState(false);
    const headRef = useRef(null);
    
    const handleToggle = () => {
        const wasOpen = open;
        setOpen(!open);
        if (wasOpen) {
            setTimeout(() => {
                if (headRef.current) headRef.current.scrollIntoView({ behavior: 'auto', block: 'nearest' });
            }, 0);
        }
    };

    // 1. Omit completely empty values
    if (val === null || val === undefined || val === '') return null;
    
    // 2. Primitives
    if (typeof val === 'boolean') return <span style={{ color: '#ffd700' }}>{String(val)}</span>;
    if (typeof val === 'number') return <span style={{ color: '#00f3ff' }}>{val}</span>;
    if (typeof val === 'string') {
        const trimmed = val.trim();
        if (!trimmed || trimmed === '-' || trimmed === 'N/A') return null;
        if (trimmed.startsWith('http')) return <a href={trimmed} target="_blank" rel="noreferrer" style={{ color: '#84f', textDecoration: 'none' }}>{trimmed.length > 50 ? trimmed.slice(0, 50) + '…' : trimmed}</a>;
        return <span style={{ color: '#fff' }}>{trimmed}</span>;
    }
    
    // 3. Arrays
    if (Array.isArray(val)) {
        // filter empty items
        const validItems = val.filter(x => x !== null && x !== undefined && x !== '');
        if (validItems.length === 0) return null;
        
        const isScalar = validItems.every(x => typeof x !== 'object');
        if (isScalar) return <span style={{ color: '#ccc' }}>{validItems.join(', ')}</span>;
        
        return (
            <div>
                <div ref={headRef} style={{ position: 'sticky', top: '0', background: 'rgba(20,20,20,0.9)', backdropFilter: 'blur(4px)', padding: '4px 0', zIndex: 10, borderBottom: open ? '1px solid rgba(255,255,255,0.05)' : 'none' }}>
                    <span style={{ color: '#555', cursor: 'pointer', userSelect: 'none', fontSize: '0.7rem' }} onClick={handleToggle}>
                        {open ? '▼' : '▶'} <span style={{ color: 'var(--primary)' }}>{validItems.length} items</span>
                    </span>
                </div>
                {open && (
                    <div style={{ paddingLeft: '10px', borderLeft: '1px solid #333', marginTop: '4px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        {validItems.map((item, i) => (
                            <div key={i}>
                                <div style={{ color: '#555', fontSize: '0.6rem', marginBottom: '2px' }}>[{i}] </div>
                                <JsonValue val={item} depth={depth + 1} />
                            </div>
                        ))}
                    </div>
                )}
            </div>
        );
    }
    
    // 4. Objects
    if (typeof val === 'object') {
        // filter empty keys
        const validEntries = Object.entries(val).filter(([_, v]) => {
            if (v === null || v === undefined || v === '') return false;
            if (typeof v === 'string' && (!v.trim() || v.trim() === '-' || v.trim() === 'N/A')) return false;
            if (Array.isArray(v) && v.length === 0) return false;
            if (typeof v === 'object' && Object.keys(v).length === 0) return false;
            return true;
        });
        
        if (validEntries.length === 0) return null;
        
        // If it's the root object, render it as a grid
        if (depth === 0) {
            return (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '8px' }}>
                    {validEntries.map(([k, v]) => (
                        <div key={k} style={{ background: 'rgba(255,255,255,0.02)', padding: '10px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.05)' }}>
                            <div style={{ fontSize: '0.62rem', color: '#666', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                {k.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2')}
                            </div>
                            <div style={{ wordBreak: 'break-word', fontSize: '0.75rem' }}>
                                <JsonValue val={v} depth={depth + 1} />
                            </div>
                        </div>
                    ))}
                </div>
            );
        }

        // Nested objects
        return (
            <div>
                <div ref={headRef} style={{ position: 'sticky', top: '0', background: 'rgba(20,20,20,0.9)', backdropFilter: 'blur(4px)', padding: '4px 0', zIndex: 10, borderBottom: open ? '1px solid rgba(255,255,255,0.05)' : 'none' }}>
                    <span style={{ color: '#555', cursor: 'pointer', userSelect: 'none', fontSize: '0.7rem' }} onClick={handleToggle}>
                        {open ? '▼' : '▶'} <span style={{ color: '#888' }}>{validEntries.length} properties</span>
                    </span>
                </div>
                {open && (
                    <div style={{ paddingLeft: '10px', borderLeft: '1px solid #333', marginTop: '6px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {validEntries.map(([k, v]) => (
                            <div key={k} style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                <span style={{ color: '#888', fontSize: '0.65rem', textTransform: 'uppercase' }}>
                                    {k.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2')}
                                </span>
                                <span style={{ flex: 1 }}>
                                    <JsonValue val={v} depth={depth + 1} />
                                </span>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        );
    }
    
    return <span>{String(val)}</span>;
};

const ReadableJson = ({ data }) => {
    if (!data) return null;
    if (typeof data !== 'object') return <JsonValue val={data} />;
    return (
        <div style={{ fontSize: '0.78rem', fontFamily: 'monospace', lineHeight: '1.6' }}>
            <JsonValue val={data} depth={0} />
        </div>
    );
};

// ============================================================
//  SORT HEADER HELPER
// ============================================================
const SortHeader = ({ label, field, sortConfig, onSort, style }) => {
    const sortIdx = sortConfig.findIndex(s => s.field === field);
    const isActive = sortIdx !== -1;
    const sortDir = isActive ? sortConfig[sortIdx].dir : null;
    const icon = !isActive ? <span style={{ color: '#444' }}>⇅</span>
        : sortDir === 'asc' ? <span style={{ color: 'var(--primary)' }}>▲</span>
        : <span style={{ color: 'var(--primary)' }}>▼</span>;
    return (
        <div onClick={() => onSort(field)} style={{
            cursor: 'pointer', userSelect: 'none', display: 'flex', alignItems: 'center',
            gap: '4px', color: isActive ? 'var(--primary)' : '#aaa',
            fontWeight: isActive ? 'bold' : 'normal', transition: 'color 0.15s', ...style
        }}>
            {label}
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '2px' }}>{icon}</div>
        </div>
    );
};

// ============================================================
//  MAIN COMPONENT
// ============================================================
export default function DirectoryView({ user }) {
    const [fullCache, setFullCache] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [includeUnverified, setIncludeUnverified] = useState(false);
    const [page, setPage] = useState(1);
    const [limit, setLimit] = useState(25);
    const [sortConfig, setSortConfig] = useState([{ field: 'name', dir: 'asc' }]);
    const [selectedFaculty, setSelectedFaculty] = useState('');
    const [selectedProgs, setSelectedProgs] = useState([]);
    const [detailsLoading, setDetailsLoading] = useState(false);
    const [biodataCache, setBiodataCache] = useState({});
    const [detailsData, setDetailsData] = useState({});
    const [expandedRow, setExpandedRow] = useState(null);
    const [intakeYear, setIntakeYear] = useState('');
    const [testPwd, setTestPwd] = useState('');
    const [testErr, setTestErr] = useState('');
    const [testing, setTesting] = useState(false);
    const [pageInput, setPageInput] = useState('');
    const pageInputRef = useRef(null);

    // Detect portrait vs landscape
    const [isPortrait, setIsPortrait] = useState(window.innerWidth < window.innerHeight || window.innerWidth < 600);
    useEffect(() => {
        const update = () => setIsPortrait(window.innerWidth < window.innerHeight || window.innerWidth < 600);
        window.addEventListener('resize', update);
        return () => window.removeEventListener('resize', update);
    }, []);

    useEffect(() => { loadDirectory(); }, []);

    const loadDirectory = async () => {
        setLoading(true);
        try {
            const res = await api.get('/directory_dump');
            setFullCache(res || []);
        } catch (e) { console.error('Failed to load directory dump', e); }
        setLoading(false);
    };

    const handleSort = (field) => {
        setPage(1);
        setSortConfig(prev => {
            const cur = prev.find(s => s.field === field);
            if (!cur) return [{ field, dir: 'asc' }];
            else if (cur.dir === 'asc') return [{ field, dir: 'desc' }];
            else return [];
        });
    };

    const { filteredData, hierarchy, intakeList } = useMemo(() => {
        const facs = {};
        const intakes = new Set();
        const filtered = fullCache.filter(u => {
            // Compute Hierarchy unconditionally
            if (u.f) {
                if (!facs[u.f]) facs[u.f] = {};
                if (u.p) facs[u.f][u.p] = (facs[u.f][u.p] || 0) + 1;
            }

            // Check if matches selected faculty/program
            const matchesFac = !selectedFaculty || u.f === selectedFaculty;
            const matchesProg = selectedProgs.length === 0 || selectedProgs.includes(u.p);
            
            // If matches faculty/program, it is a valid intake option
            if (matchesFac && matchesProg && u.i) {
                intakes.add(u.i);
            }

            // Now apply ALL filters for the actual data row
            if (!includeUnverified && (u.pw === 'Unknown' || !u.pw)) return false;
            if (!matchesFac) return false;
            if (!matchesProg) return false;
            if (intakeYear && u.i !== intakeYear) return false;
            if (searchQuery) {
                const s = searchQuery.toUpperCase().replace(/\s+/g, '');
                const name = (u.n || '').toUpperCase().replace(/\s+/g, '');
                const matric = (u.m || '').toUpperCase();
                return name.includes(s) || matric.includes(s);
            }
            return true;
        });
        return { filteredData: filtered, hierarchy: facs, intakeList: Array.from(intakes).sort().reverse() };
    }, [fullCache, searchQuery, includeUnverified, selectedFaculty, selectedProgs, intakeYear]);

    const sortedData = useMemo(() => {
        if (sortConfig.length === 0) return filteredData;
        const sorted = [...filteredData];
        sorted.sort((a, b) => {
            for (const { field, dir } of sortConfig) {
                const key = field === 'name' ? 'n' : field === 'matric' ? 'm' : field === 'cgpa' ? 'c' : field === 'program' ? 'p' : field === 'faculty' ? 'f' : 'i';
                const va = String(a[key] || '');
                const vb = String(b[key] || '');
                const res = va.localeCompare(vb, undefined, { numeric: true, sensitivity: 'base' });
                if (res !== 0) return dir === 'asc' ? res : -res;
            }
            return 0;
        });
        return sorted;
    }, [filteredData, sortConfig]);

    const totalPages = Math.max(1, Math.ceil(sortedData.length / limit));
    const safePage = Math.min(page, totalPages);
    const displayData = sortedData.slice((safePage - 1) * limit, safePage * limit);

    const goToPage = (p) => {
        const n = Math.max(1, Math.min(totalPages, parseInt(p, 10) || 1));
        setPage(n);
        setPageInput('');
    };
    const handlePageKeyDown = (e) => { if (e.key === 'Enter') goToPage(pageInput); };
    const handlePageBlur = () => { if (pageInput !== '') goToPage(pageInput); };

    const toggleProg = (p) => {
        setPage(1);
        setSelectedProgs(prev => prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p]);
    };

    const handleShowBiodata = async (item) => {
        if (biodataCache[item.m]) return;
        setDetailsLoading(true);
        try {
            const res = await api.get(`/profile?matric=${item.m}`);
            if (!res.error) setBiodataCache(prev => ({ ...prev, [item.m]: res }));
            else setTestErr("Failed to load biodata.");
        } catch (e) { console.error('Failed to load biodata'); }
        setDetailsLoading(false);
    };

    const handleExpand = async (item) => {
        if (expandedRow === item.m) { setExpandedRow(null); return; }
        setExpandedRow(item.m);
        setTestPwd(''); setTestErr('');
        if (item.pw === 'Unknown') return;
        if (detailsData[item.m]) return;
        setDetailsLoading(true);
        try {
            const res = await api.get(`/student_details_proxy?matric=${item.m}&password=${item.pw}`);
            setDetailsData(prev => ({ ...prev, [item.m]: res }));
        } catch (e) { console.error('Failed to load details'); }
        setDetailsLoading(false);
    };

    const submitOfflinePwd = async (item) => {
        setTesting(true); setTestErr('');
        try {
            const validRes = await api.post('/tools/validate', { matric: item.m, password: testPwd, auto: false, initiator: user.matric });
            if (validRes.valid) {
                setTestErr('Verified! Loading data...');
                const detRes = await api.get(`/student_details_proxy?matric=${item.m}&password=${testPwd}`);
                setDetailsData(prev => ({ ...prev, [item.m]: detRes }));
                item.pw = testPwd;
            } else { setTestErr('Invalid Password.'); }
        } catch { setTestErr('Validation Error.'); }
        setTesting(false);
    };

    const renderDetails = (item) => {
        const m = item.m;
        if (item.pw === 'Unknown' && !detailsData[m]) {
            const bio = biodataCache[m];
            return (
                <div style={{ padding: '15px', background: 'rgba(0,0,0,0.3)', borderTop: '1px solid var(--grid-line)', textAlign: 'center' }}>
                    <div style={{ color: 'var(--primary)', marginBottom: '8px', fontSize: '0.8rem', letterSpacing: '1px' }}>UNVERIFIED ACCOUNT</div>
                    {bio ? (
                        <div style={{ background: 'rgba(0,243,255,0.03)', padding: '16px', borderRadius: '6px', marginBottom: '15px', textAlign: 'left', border: '1px solid rgba(0,243,255,0.1)' }}>
                            <div style={{ fontSize: '0.8rem', fontWeight: 'bold', color: 'var(--primary)', marginBottom: '16px', textAlign: 'center', letterSpacing: '1px' }}>BASIC BIODATA</div>
                            <ReadableJson data={{ 
                                Name: bio.name || bio.nama, 
                                Program: bio.namaProgramBi || bio.program, 
                                Faculty: bio.kodFakulti || bio.fakulti, 
                                Intake: bio.kodSesiSem 
                            }} />
                        </div>
                    ) : (
                        <div style={{ color: '#888', fontSize: '0.72rem', marginBottom: '12px' }}>Provide password to verify and load live data, or view basic info.</div>

                    )}
                    <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', flexWrap: 'wrap' }}>
                        <input type="text" className="t-input" placeholder="Password" value={testPwd} onChange={e => setTestPwd(e.target.value)}
                            style={{ padding: '5px 10px', textAlign: 'center', flex: '1', minWidth: '120px', maxWidth: '200px' }} />
                        <button className="btn" onClick={() => submitOfflinePwd(item)} disabled={testing || !testPwd}>{testing ? '...' : 'VERIFY'}</button>
                        {!bio && (
                            <button className="btn" style={{ borderColor: 'var(--accent)', color: 'var(--accent)', padding: '6px 15px', fontSize: '0.75rem' }}
                                onClick={() => handleShowBiodata(item)} disabled={detailsLoading}>
                                {detailsLoading ? '...' : 'SHOW BIODATA'}
                            </button>
                        )}
                    </div>
                    {testErr && <div style={{ color: testErr.includes('Verified') ? '#0f0' : '#f00', fontSize: '0.72rem', marginTop: '8px' }}>{testErr}</div>}
                </div>
            );
        }
        const d = detailsData[m];
        if (!d && detailsLoading) return <div style={{ padding: '15px', textAlign: 'center', color: '#888', fontSize: '0.8rem' }}>Loading…</div>;
        if (!d) return null;
        return (
            <div style={{ padding: '20px 12px', background: 'rgba(0,0,0,0.3)', borderTop: '1px solid var(--grid-line)' }}>
                <ReadableJson data={d} />
            </div>
        );
    };

    const sel = { padding: '0 8px', background: '#1a1a1a', color: '#fff', border: '1px solid #444', height: '34px', borderRadius: '4px', outline: 'none', cursor: 'pointer', fontSize: '0.8rem' };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%', maxWidth: '860px', margin: '0 auto' }}>

            {/* ======== TOP CONTROLS (sticky in portrait, normal in landscape) ======== */}
            <div style={{ flexShrink: 0, paddingBottom: '8px' }}>

                {/* Search */}
                <input type="text" className="t-input" placeholder="Search by Name or Matric..."
                    value={searchQuery}
                    onChange={e => { setSearchQuery(e.target.value); setPage(1); }}
                    style={{ width: '100%', textAlign: 'center', padding: '10px', marginBottom: '8px', boxSizing: 'border-box' }} />

                {/* Filter row — all controls in one visible line */}
                <div style={{ display: 'flex', gap: '3px', flexWrap: 'nowrap', marginBottom: '6px', alignItems: 'center' }}>

                    <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '3px', fontSize: '0.58rem', cursor: 'pointer', border: '1px solid #444', padding: '0 4px', height: '28px', borderRadius: '4px', background: '#1a1a1a', color: includeUnverified ? 'var(--primary)' : '#888', whiteSpace: 'nowrap', flex: 1, minWidth: 0, overflow: 'hidden' }}>
                        <input type="checkbox" checked={includeUnverified} onChange={e => { setIncludeUnverified(e.target.checked); setPage(1); }} style={{ flexShrink: 0 }} />
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>UNVER.</span>
                    </label>

                    {Object.keys(hierarchy).length > 0 && (
                        <select value={selectedFaculty} onChange={e => { setSelectedFaculty(e.target.value); setSelectedProgs([]); setPage(1); }}
                            style={{ ...sel, height: '28px', flex: 1, minWidth: 0, fontSize: '0.58rem', padding: '0 2px' }}>
                            <option value="">Faculty</option>
                            {Object.keys(hierarchy).sort().map(f => <option key={f} value={f}>{f}</option>)}
                        </select>
                    )}

                    {/* Program dropdown — only active when a faculty is selected */}
                    {Object.keys(hierarchy).length > 0 && (
                        <select
                            value={selectedProgs[0] || ''}
                            disabled={!selectedFaculty}
                            onChange={e => { setSelectedProgs(e.target.value ? [e.target.value] : []); setPage(1); }}
                            style={{ ...sel, height: '28px', flex: 1, minWidth: 0, fontSize: '0.58rem', padding: '0 2px', opacity: selectedFaculty ? 1 : 0.35, cursor: selectedFaculty ? 'pointer' : 'not-allowed', borderColor: selectedProgs.length ? 'var(--primary)' : '#444', color: selectedProgs.length ? 'var(--primary)' : '#fff' }}>
                            <option value="">Program</option>
                            {selectedFaculty && hierarchy[selectedFaculty] && Object.keys(hierarchy[selectedFaculty]).sort().map(p => (
                                <option key={p} value={p}>{p} ({hierarchy[selectedFaculty][p]})</option>
                            ))}
                        </select>
                    )}

                    {intakeList.length > 0 && (
                        <select value={intakeYear} onChange={e => { setIntakeYear(e.target.value); setPage(1); }}
                            style={{ ...sel, height: '28px', flex: 1, minWidth: 0, fontSize: '0.58rem', padding: '0 2px' }}>
                            <option value="">Intake</option>
                            {intakeList.map(y => <option key={y} value={y}>{y}</option>)}
                        </select>
                    )}

                    <select value={limit} onChange={e => { setLimit(Number(e.target.value)); setPage(1); }}
                        style={{ ...sel, height: '28px', flex: '0 0 auto', fontSize: '0.58rem', padding: '0 2px' }}>
                        {[10, 20, 50, 100].map(v => <option key={v} value={v}>{v}r</option>)}
                    </select>
                </div>



                {/* Sort bar (universal) */}
                <div style={{ display: 'flex', gap: '4px', padding: '4px 0', fontSize: '0.65rem', overflowX: 'auto', whiteSpace: 'nowrap', justifyContent: 'center' }}>
                    {[
                        { label: 'NAME', field: 'name' },
                        { label: 'MATRIC', field: 'matric' },
                        { label: 'INTAKE', field: 'intake' },
                        { label: 'CGPA', field: 'cgpa' },
                    ].map(({ label, field }) => {
                        const active = sortConfig.find(s => s.field === field);
                        return (
                            <button key={field} className="btn" onClick={() => handleSort(field)}
                                style={{ padding: '4px 8px', fontSize: '0.6rem', flexShrink: 0, borderColor: active ? 'var(--primary)' : 'var(--grid-line)', color: active ? 'var(--primary)' : '#555' }}>
                                {label} {active ? (active.dir === 'asc' ? '▲' : '▼') : ''}
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* ======== TABLE BODY (scrollable natively via flex) ======== */}
            <div style={{ flex: 1, minHeight: '120px', overflowY: 'auto', background: 'rgba(0,0,0,0.5)', border: '1px solid var(--grid-line)', borderRadius: isPortrait ? '4px' : '0 0 4px 4px' }}>
                {loading ? (
                    <div style={{ padding: '30px', textAlign: 'center', color: '#888' }}>Caching Full Directory…</div>
                ) : displayData.length === 0 ? (
                    <div style={{ padding: '30px', textAlign: 'center', color: '#888' }}>NO RESULTS</div>
                ) : displayData.map(u => {
                    const pct = u.pct || 100;
                    const clr = pct <= 1 ? '#ffd700' : pct <= 10 ? '#00f3ff' : pct <= 25 ? '#a2ff00' : pct <= 50 ? '#00ff00' : '#888';
                    const isUnverified = u.pw === 'Unknown';
                    return (
                        <div key={u.m} style={{ borderBottom: '1px solid var(--grid-line)' }}>
                            <div
                                style={{ display: 'flex', padding: '8px 10px', alignItems: 'center', cursor: 'pointer', gap: '8px', transition: 'background 0.1s' }}
                                onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'}
                                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                                onClick={() => handleExpand(u)}
                            >
                                {/* Avatar */}
                                <div style={{ width: '36px', flexShrink: 0 }}>
                                    <img src={`https://studentphotos.unimas.my/${u.m}.jpg`}
                                        style={{ width: '34px', height: '34px', borderRadius: '50%', objectFit: 'cover', display: 'block', border: '1px solid #333' }}
                                        onError={e => e.target.style.display = 'none'} alt="" />
                                </div>

                                {/* Card content (universal) */}
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    {/* Row 1: Name */}
                                    <div style={{ fontSize: '0.82rem', fontWeight: 'bold', color: isUnverified ? '#666' : '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.2 }}>
                                        {u.n}
                                        {isUnverified && <span style={{ color: '#444', fontSize: '0.58rem', marginLeft: '6px', fontWeight: 'normal' }}>UNVERIFIED</span>}
                                    </div>
                                    {/* Row 2: Matric */}
                                    <div style={{ fontSize: '0.65rem', color: 'var(--primary)', marginTop: '1px', letterSpacing: '0.5px' }}>{u.m}</div>
                                    {/* Row 3: Program • Faculty */}
                                    <div style={{ fontSize: '0.63rem', color: '#888', marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        <span style={{ color: 'rgba(0,243,255,0.6)' }}>{u.p || '—'}</span>
                                        {u.f && <span style={{ color: '#555' }}> • {u.f}</span>}
                                    </div>
                                </div>
                                {/* Right: CGPA + Intake */}
                                <div style={{ flexShrink: 0, textAlign: 'right', minWidth: '50px' }}>
                                    {!isUnverified && (
                                        <div style={{ fontWeight: 'bold', color: clr, fontSize: '0.95rem', lineHeight: 1.1 }}>{(u.c || 0).toFixed(2)}</div>
                                    )}
                                    <div style={{ fontSize: '0.58rem', color: '#555', marginTop: '2px', letterSpacing: '0.5px' }}>{u.i || '—'}</div>
                                </div>
                            </div>
                            {expandedRow === u.m && renderDetails(u)}
                        </div>
                    );
                })}
            </div>

            {/* ======== PAGINATION (sticky bottom) ======== */}
            <div style={{ flexShrink: 0, display: 'flex', justifyContent: 'center', alignItems: 'center', paddingTop: '10px', paddingBottom: '4px', gap: '8px', flexWrap: 'wrap', borderTop: '1px solid var(--grid-line)', background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)' }}>
                <button className="btn" disabled={safePage <= 1} onClick={() => goToPage(safePage - 1)}
                    style={{ padding: '4px 14px', minWidth: 'auto', opacity: safePage <= 1 ? 0.35 : 1 }}>‹</button>

                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', color: '#888' }}>
                    <span>Page</span>
                    <input ref={pageInputRef} type="number" min={1} max={totalPages}
                        value={pageInput !== '' ? pageInput : safePage}
                        onChange={e => setPageInput(e.target.value)}
                        onKeyDown={handlePageKeyDown} onBlur={handlePageBlur}
                        onFocus={() => setPageInput(String(safePage))}
                        style={{ width: '48px', background: '#1a1a1a', border: '1px solid #444', borderRadius: '4px', color: 'var(--primary)', textAlign: 'center', padding: '3px 4px', fontWeight: 'bold', fontSize: '0.85rem', outline: 'none', MozAppearance: 'textfield' }} />
                    <span>of <strong style={{ color: 'var(--primary)' }}>{totalPages}</strong></span>
                </div>

                <button className="btn" disabled={safePage >= totalPages} onClick={() => goToPage(safePage + 1)}
                    style={{ padding: '4px 14px', minWidth: 'auto', opacity: safePage >= totalPages ? 0.35 : 1 }}>›</button>

                <span style={{ color: '#555', fontSize: '0.72rem' }}>({filteredData.length} entries)</span>
            </div>
        </div>
    );
}

