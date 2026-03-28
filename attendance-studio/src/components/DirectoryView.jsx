import React, { useState, useEffect, useMemo, useRef } from 'react';
import { api } from '../services/api';

// ============================================================
//  READABLE JSON — Collapsible, nested, human-friendly
// ============================================================
const JsonValue = ({ val, depth = 0 }) => {
    const [open, setOpen] = useState(depth < 2);
    if (val === null || val === undefined) return <span style={{ color: '#666' }}>—</span>;
    if (typeof val === 'boolean') return <span style={{ color: '#ffd700' }}>{String(val)}</span>;
    if (typeof val === 'number') return <span style={{ color: '#00f3ff' }}>{val}</span>;
    if (typeof val === 'string') {
        // Detect URL
        if (val.startsWith('http')) return <a href={val} target="_blank" rel="noreferrer" style={{ color: '#84f' }}>{val.length > 50 ? val.slice(0, 50) + '…' : val}</a>;
        return <span style={{ color: '#fff' }}>{val}</span>;
    }
    if (Array.isArray(val)) {
        if (val.length === 0) return <span style={{ color: '#666' }}>[]</span>;
        const isScalar = val.every(x => typeof x !== 'object' || x === null);
        if (isScalar) return <span style={{ color: '#ccc' }}>[{val.join(', ')}]</span>;
        return (
            <div>
                <span style={{ color: '#888', cursor: 'pointer', userSelect: 'none' }} onClick={() => setOpen(o => !o)}>
                    {open ? '▾' : '▸'} <span style={{ color: '#f0f', fontSize: '0.7rem' }}>{val.length} items</span>
                </span>
                {open && (
                    <div style={{ paddingLeft: '12px', borderLeft: '1px solid #333', marginTop: '4px' }}>
                        {val.map((item, i) => (
                            <div key={i} style={{ marginBottom: '6px' }}>
                                <span style={{ color: '#666', fontSize: '0.65rem' }}>#{i + 1} </span>
                                <JsonValue val={item} depth={depth + 1} />
                            </div>
                        ))}
                    </div>
                )}
            </div>
        );
    }
    if (typeof val === 'object') {
        const entries = Object.entries(val);
        if (entries.length === 0) return <span style={{ color: '#666' }}>{'{}'}</span>;
        return (
            <div>
                <span style={{ color: '#888', cursor: 'pointer', userSelect: 'none' }} onClick={() => setOpen(o => !o)}>
                    {open ? '▾' : '▸'} <span style={{ color: '#888', fontSize: '0.7rem' }}>{entries.length} fields</span>
                </span>
                {open && (
                    <div style={{ paddingLeft: '12px', borderLeft: '1px solid #333', marginTop: '4px' }}>
                        {entries.map(([k, v]) => (
                            <div key={k} style={{ marginBottom: '5px', display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'flex-start' }}>
                                <span style={{ color: '#888', fontSize: '0.72rem', minWidth: '90px', flex: '0 0 auto' }}>
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
        <div
            onClick={() => onSort(field)}
            style={{
                cursor: 'pointer', userSelect: 'none', display: 'flex', alignItems: 'center',
                gap: '4px', color: isActive ? 'var(--primary)' : '#aaa',
                fontWeight: isActive ? 'bold' : 'normal', transition: 'color 0.15s',
                ...style
            }}
        >
            {label} 
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '2px' }}>
                {icon}
            </div>
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
    const [biodataCache, setBiodataCache] = useState({}); // For "Basic Biodata" view
    const [detailsData, setDetailsData] = useState({});
    const [expandedRow, setExpandedRow] = useState(null);
    const [intakeYear, setIntakeYear] = useState('');
    const [testPwd, setTestPwd] = useState('');
    const [testErr, setTestErr] = useState('');
    const [testing, setTesting] = useState(false);
    const [pageInput, setPageInput] = useState('');
    const pageInputRef = useRef(null);

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
            if (!cur) {
                // New field: replace with ASC
                return [{ field, dir: 'asc' }];
            } else if (cur.dir === 'asc') {
                // Cycle to DESC
                return [{ field, dir: 'desc' }];
            } else {
                // Remove (back to no sort)
                return [];
            }
        });
    };

    // Client-side filter + hierarchy
    const { filteredData, hierarchy, intakeList } = useMemo(() => {
        const facs = {};
        const intakes = new Set();
        const filtered = fullCache.filter(u => {
            if (u.i) intakes.add(u.i);
            if (u.f) {
                if (!facs[u.f]) facs[u.f] = {};
                if (u.p) facs[u.f][u.p] = (facs[u.f][u.p] || 0) + 1;
            }
            if (!includeUnverified && (u.pw === 'Unknown' || !u.pw)) return false;
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
        return { filteredData: filtered, hierarchy: facs, intakeList: Array.from(intakes).sort().reverse() };
    }, [fullCache, searchQuery, includeUnverified, selectedFaculty, selectedProgs, intakeYear]);

    const sortedData = useMemo(() => {
        if (sortConfig.length === 0) return filteredData;
        const sorted = [...filteredData];
        sorted.sort((a, b) => {
            for (const { field, dir } of sortConfig) {
                const key = field === 'name' ? 'n' : field === 'matric' ? 'm' : field === 'cgpa' ? 'c' : 'i';
                const va = String(a[key] || '');
                const vb = String(b[key] || '');
                
                // Use numeric-aware localeCompare
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
            // Using /profile API as "basic biodata" proxy
            const res = await api.get(`/profile?matric=${item.m}`);
            if (!res.error) {
                setBiodataCache(prev => ({ ...prev, [item.m]: res }));
            } else {
                setTestErr("Failed to load biodata.");
            }
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

    // ---- Sub-components ----

    const renderDetails = (item) => {
        const m = item.m;
        if (item.pw === 'Unknown' && !detailsData[m]) {
            const bio = biodataCache[m];
            return (
                <div style={{ padding: '15px', background: 'rgba(0,0,0,0.3)', borderTop: '1px solid var(--grid-line)', textAlign: 'center' }}>
                    <div style={{ color: 'var(--primary)', marginBottom: '8px', fontSize: '0.8rem', letterSpacing: '1px' }}>UNVERIFIED ACCOUNT</div>
                    
                    {bio ? (
                        <div style={{ background: 'rgba(0,243,255,0.05)', padding: '12px', borderRadius: '4px', marginBottom: '15px', textAlign: 'left', border: '1px solid rgba(0,243,255,0.1)' }}>
                            <div style={{ fontSize: '0.75rem', fontWeight: 'bold', color: 'var(--primary)', marginBottom: '8px' }}>BASIC BIODATA</div>
                            <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr', gap: '5px', fontSize: '0.72rem' }}>
                                <span style={{ color: '#888' }}>NAME:</span> <span style={{ color: '#fff' }}>{bio.name || bio.nama || '-'}</span>
                                <span style={{ color: '#888' }}>PROGRAM:</span> <span style={{ color: '#fff' }}>{bio.namaProgramBi || bio.program || '-'}</span>
                                <span style={{ color: '#888' }}>FACULTY:</span> <span style={{ color: '#fff' }}>{bio.kodFakulti || bio.fakulti || '-'}</span>
                                <span style={{ color: '#888' }}>INTAKE:</span> <span style={{ color: '#fff' }}>{bio.kodSesiSem || '-'}</span>
                            </div>
                        </div>
                    ) : (
                        <div style={{ color: '#888', fontSize: '0.72rem', marginBottom: '12px' }}>Provide password to verify and load live data, or view basic info.</div>
                    )}

                    <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', flexWrap: 'wrap' }}>
                        <input type="text" className="t-input" placeholder="Password" value={testPwd} onChange={e => setTestPwd(e.target.value)}
                            style={{ padding: '5px 10px', textAlign: 'center', flex: '1', minWidth: '120px', maxWidth: '200px' }} />
                        <button className="btn" onClick={() => submitOfflinePwd(item)} disabled={testing || !testPwd}>{testing ? '...' : 'VERIFY'}</button>
                        {!bio && (
                            <button className="btn" style={{ borderColor: 'var(--accent)', color: 'var(--accent)' }} onClick={() => handleShowBiodata(item)} disabled={detailsLoading}>
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
            <div style={{ padding: '12px', background: 'rgba(0,0,0,0.3)', borderTop: '1px solid var(--grid-line)' }}>
                {Object.entries(d).map(([key, val]) => (
                    <details style={{ marginBottom: '10px' }} key={key}>
                        <summary style={{ cursor: 'pointer', color: 'var(--primary)', fontWeight: 'bold', fontSize: '0.8rem', letterSpacing: '0.5px', listStyle: 'none', display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span style={{ fontSize: '0.65rem' }}>▶</span>
                            {key.toUpperCase().replace(/_/g, ' ')}
                        </summary>
                        <div style={{ padding: '10px', background: 'rgba(0,0,0,0.5)', borderRadius: '4px', marginTop: '6px', overflowX: 'auto' }}>
                            <ReadableJson data={val} />
                        </div>
                    </details>
                ))}
            </div>
        );
    };

    // Shared select style
    const sel = { padding: '0 8px', background: '#1a1a1a', color: '#fff', border: '1px solid #444', height: '34px', borderRadius: '4px', outline: 'none', cursor: 'pointer', fontSize: '0.8rem' };

    return (
        <div style={{ width: '100%', maxWidth: '860px', margin: '0 auto', display: 'flex', flexDirection: 'column' }}>

            {/* ---- SEARCH ---- */}
            <input type="text" className="t-input" placeholder="Search by Name, Matric or Program..." value={searchQuery}
                onChange={e => { setSearchQuery(e.target.value); setPage(1); }}
                style={{ width: '100%', textAlign: 'center', padding: '10px', marginBottom: '10px', boxSizing: 'border-box' }} />

            {/* ---- FILTER CONTROLS (mobile-first) ---- */}
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'center', marginBottom: '10px', alignItems: 'center' }}>

                {/* Include Unverified toggle */}
                <label style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '0.78rem', cursor: 'pointer', border: '1px solid #444', padding: '5px 10px', borderRadius: '4px', background: '#1a1a1a', color: includeUnverified ? 'var(--primary)' : '#888', whiteSpace: 'nowrap' }}>
                    <input type="checkbox" checked={includeUnverified} onChange={e => { setIncludeUnverified(e.target.checked); setPage(1); }} />
                    Incl. Unverified
                </label>

                {/* Faculty */}
                {Object.keys(hierarchy).length > 0 && (
                    <select value={selectedFaculty} onChange={e => { setSelectedFaculty(e.target.value); setSelectedProgs([]); setPage(1); }} style={{ ...sel, maxWidth: '180px', flex: '1' }}>
                        <option value="">All Faculties</option>
                        {Object.keys(hierarchy).sort().map(f => <option key={f} value={f}>{f}</option>)}
                    </select>
                )}

                {/* Intake */}
                {intakeList.length > 0 && (
                    <select value={intakeYear} onChange={e => { setIntakeYear(e.target.value); setPage(1); }} style={{ ...sel, width: '120px' }}>
                        <option value="">Any Intake</option>
                        {intakeList.map(y => <option key={y} value={y}>{y}</option>)}
                    </select>
                )}

                {/* Rows per page */}
                <select value={limit} onChange={e => { setLimit(Number(e.target.value)); setPage(1); }} style={{ ...sel, width: '90px' }}>
                    {[10, 20, 50, 100].map(v => <option key={v} value={v}>{v} rows</option>)}
                </select>
            </div>

            {/* ---- PROGRAM CHIPS (only when faculty selected) ---- */}
            {selectedFaculty && hierarchy[selectedFaculty] && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', justifyContent: 'center', marginBottom: '10px', padding: '8px', background: 'rgba(255,255,255,0.02)', borderRadius: '4px' }}>
                    {Object.keys(hierarchy[selectedFaculty]).sort().map(p => (
                        <button key={p} className="btn"
                            style={{ padding: '3px 8px', fontSize: '0.65rem', borderColor: selectedProgs.includes(p) ? 'var(--primary)' : 'var(--grid-line)', color: selectedProgs.includes(p) ? 'var(--primary)' : '#666' }}
                            onClick={() => toggleProg(p)}>
                            {p} ({hierarchy[selectedFaculty][p]})
                        </button>
                    ))}
                </div>
            )}

            {/* ---- TABLE ---- */}
            <div style={{ flex: 1, background: 'rgba(0,0,0,0.5)', border: '1px solid var(--grid-line)', borderRadius: '4px', overflow: 'hidden' }}>

                {/* Header row with sortable columns */}
                <div style={{ display: 'flex', padding: '8px 10px', background: 'rgba(255,255,255,0.05)', fontSize: '0.72rem', borderBottom: '1px solid var(--grid-line)', gap: '4px' }}>
                    <div style={{ width: '38px', flexShrink: 0 }} /> {/* avatar */}
                    <div style={{ flex: 1, minWidth: 0, display: 'flex', gap: '10px' }}>
                        <SortHeader label="NAME" field="name" sortConfig={sortConfig} onSort={handleSort} style={{ minWidth: '60px' }} />
                        <SortHeader label="MATRIC" field="matric" sortConfig={sortConfig} onSort={handleSort} style={{ minWidth: '60px' }} />
                    </div>
                    <div className="dir-col-prog" style={{ flex: 1, minWidth: 0 }}>
                        <SortHeader label="PROGRAM" field={null} sortConfig={sortConfig} onSort={() => {}} style={{ color: '#aaa', cursor: 'default' }} />
                    </div>
                    <SortHeader label="INTAKE" field="intake" sortConfig={sortConfig} onSort={handleSort} style={{ width: '72px', flexShrink: 0, justifyContent: 'center' }} />
                    <SortHeader label="CGPA" field="cgpa" sortConfig={sortConfig} onSort={handleSort} style={{ width: '68px', flexShrink: 0, justifyContent: 'flex-end' }} />
                </div>

                {/* Rows */}
                {loading ? (
                    <div style={{ padding: '30px', textAlign: 'center', color: '#888' }}>Caching Full Directory…</div>
                ) : displayData.length === 0 ? (
                    <div style={{ padding: '30px', textAlign: 'center', color: '#888' }}>NO RESULTS</div>
                ) : (
                    <div style={{ maxHeight: '60vh', overflowY: 'auto' }}>
                        {displayData.map(u => {
                            const pct = u.pct || 100;
                            const clr = pct <= 1 ? '#ffd700' : pct <= 10 ? '#00f3ff' : pct <= 25 ? '#a2ff00' : pct <= 50 ? '#00ff00' : '#888';
                            const isUnverified = u.pw === 'Unknown';
                            return (
                                <div key={u.m} style={{ borderBottom: '1px solid var(--grid-line)' }}>
                                    <div style={{ display: 'flex', padding: '8px 10px', alignItems: 'center', cursor: 'pointer', gap: '4px', transition: 'background 0.1s' }}
                                        onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'}
                                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                                        onClick={() => handleExpand(u)}>

                                        {/* Avatar */}
                                        <div style={{ width: '38px', flexShrink: 0 }}>
                                            <img src={`https://studentphotos.unimas.my/${u.m}.jpg`}
                                                style={{ width: '32px', height: '32px', borderRadius: '50%', objectFit: 'cover', display: 'block' }}
                                                onError={e => e.target.style.display = 'none'} alt="" />
                                        </div>

                                        {/* Name + Matric */}
                                        <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
                                            <div style={{ fontSize: '0.85rem', color: isUnverified ? '#777' : '#fff', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>
                                                {u.n}
                                                {isUnverified && <span style={{ color: '#555', fontSize: '0.65rem', marginLeft: '5px' }}>UNVERIFIED</span>}
                                            </div>
                                            <div style={{ fontSize: '0.68rem', color: '#666' }}>{u.m}</div>
                                        </div>

                                        {/* Program + Faculty */}
                                        <div className="dir-col-prog" style={{ flex: 1, minWidth: 0, overflow: 'hidden', fontSize: '0.7rem' }}>
                                            <div style={{ color: 'var(--primary)', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>{u.p}</div>
                                            <div style={{ color: '#555', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>{u.f}</div>
                                        </div>

                                        {/* Intake */}
                                        <div style={{ width: '72px', flexShrink: 0, textAlign: 'center', fontSize: '0.7rem', color: '#777' }}>{u.i}</div>

                                        {/* CGPA */}
                                        <div style={{ width: '68px', flexShrink: 0, textAlign: 'right' }}>
                                            {!isUnverified && (
                                                <>
                                                    <div style={{ fontWeight: 'bold', color: clr, fontSize: '0.88rem' }}>{(u.c || 0).toFixed(2)}</div>
                                                    <div style={{ fontSize: '0.6rem', color: clr }}>TOP {pct}%</div>
                                                </>
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

            {/* ---- E-READER PAGINATION ---- */}
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', margin: '14px 0', gap: '10px', flexWrap: 'wrap' }}>
                {/* PREV */}
                <button className="btn" disabled={safePage <= 1} onClick={() => goToPage(safePage - 1)}
                    style={{ padding: '4px 12px', minWidth: 'auto', opacity: safePage <= 1 ? 0.35 : 1 }}>‹</button>

                {/* Page jump */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', color: '#888' }}>
                    <span>Page</span>
                    <input
                        ref={pageInputRef}
                        type="number" min={1} max={totalPages}
                        value={pageInput !== '' ? pageInput : safePage}
                        onChange={e => setPageInput(e.target.value)}
                        onKeyDown={handlePageKeyDown}
                        onBlur={handlePageBlur}
                        onFocus={() => setPageInput(String(safePage))}
                        style={{ width: '52px', background: '#1a1a1a', border: '1px solid #444', borderRadius: '4px', color: 'var(--primary)', textAlign: 'center', padding: '3px 4px', fontWeight: 'bold', fontSize: '0.85rem', outline: 'none', MozAppearance: 'textfield' }}
                    />
                    <span>of <strong style={{ color: 'var(--primary)' }}>{totalPages}</strong></span>
                </div>

                {/* NEXT */}
                <button className="btn" disabled={safePage >= totalPages} onClick={() => goToPage(safePage + 1)}
                    style={{ padding: '4px 12px', minWidth: 'auto', opacity: safePage >= totalPages ? 0.35 : 1 }}>›</button>

                <span style={{ color: '#555', fontSize: '0.72rem' }}>({filteredData.length} entries)</span>
            </div>
        </div>
    );
}
