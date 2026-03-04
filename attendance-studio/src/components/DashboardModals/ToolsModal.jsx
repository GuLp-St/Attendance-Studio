// --- START OF FILE ToolsModal.jsx ---

import React, { useState, useEffect, useRef } from 'react';
import Modal from '../Modal';
import Skeleton from '../Skeleton';
import { api } from '../../services/api';
import { useToast } from '../../contexts/ToastContext';

export default function ToolsModal({ user }) {
    const { showToast } = useToast();

    // State Navigation
    const [view, setView] = useState(null); 
    
    // Data State
    const [directory, setDirectory] = useState([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState([]);
    
    const [selectedItem, setSelectedItem] = useState(null); 
    const [groupList, setGroupList] = useState(null); 
    
    const [activeGroup, setActiveGroup] = useState(null); 
    const [hubSessions, setHubSessions] = useState(null);
    
    const [activeSession, setActiveSession] = useState(null);
    const [masterLogs, setMasterLogs] = useState(null); 
    
    const [roster, setRoster] = useState(null); 
    
    // Auto-Fetch State
    const [isFetching, setIsFetching] = useState(false);
    const [fetchProgress, setFetchProgress] = useState('');
    const fetchAbort = useRef(false);

    // Prompts
    const [selfPwdPrompt, setSelfPwdPrompt] = useState('');
    const [showSelfPrompt, setShowSelfPrompt] = useState(false);
    const [exemptTarget, setExemptTarget] = useState(null); 
    const [exemptReason, setExemptReason] = useState('');

    // ===================================================================
    // 1. HASH ROUTING
    // ===================================================================
    useEffect(() => {
        const handleHash = () => {
            const h = window.location.hash;
            if (h === '#tools') setView('search');
            else if (h === '#tools/groups') setView('groups');
            else if (h === '#tools/hub') setView('hub');
            else if (h === '#tools/session') setView('session');
            else if (h === '#tools/roster') setView('roster');
            else setView(null);
        };
        window.addEventListener('popstate', handleHash);
        window.addEventListener('hashchange', handleHash);
        return () => {
            window.removeEventListener('popstate', handleHash);
            window.removeEventListener('hashchange', handleHash);
        };
    }, []);

    const navTo = (hashLevel) => { window.location.hash = hashLevel; };

    // ===================================================================
    // 2. VIEW: SEARCH
    // ===================================================================
    useEffect(() => {
        if (view === 'search' && directory.length === 0) {
            api.get('/directory?type=student').then(setDirectory).catch(()=>{});
        }
    }, [view]);

    const handleSearch = (val) => {
        setSearchQuery(val);
        if (val.length < 2) { setSearchResults([]); return; }
        const clean = val.toUpperCase().replace(/\s+/g, '');
        const matches = directory.filter(u => {
            const n = (u.n || "").toUpperCase().replace(/\s+/g, '');
            return n.includes(clean) || u.m.toUpperCase().includes(clean);
        }).slice(0, 15);
        setSearchResults(matches);
    };

    const selectSearchItem = async (item) => {
        setSelectedItem(item);
        setGroupList(null);
        navTo('#tools/groups');
        try {
            const res = await api.get(`/tools/details?q=${item.m}&t=${item.t}`);
            setGroupList(res);
        } catch(e) { showToast("Failed to fetch groups", "error"); }
    };

    // ===================================================================
    // 3. VIEW: GROUPS & HUB
    // ===================================================================
    const selectGroup = async (g) => {
        setActiveGroup(g);
        setHubSessions(null);
        setRoster(null); 
        setShowSelfPrompt(false);
        navTo('#tools/hub');
        try {
            const res = await api.get(`/course_details?gid=${g.id}&matric=${user.matric}`);
            setHubSessions(res);
        } catch(e) {}
    };

    const handleSelfAction = async (action) => {
        if (!selfPwdPrompt) { showToast("Enter your password", "error"); return; }
        try {
            const res = await api.post('/tools/action', {
                action: action, matric: user.matric, password: selfPwdPrompt,
                code: activeGroup.code, cid: activeGroup.id, initiator: user.matric
            });
            if (res.status === 200 && res.response.includes('error":false')) {
                showToast(`${action} Successful`, "success");
                setShowSelfPrompt(false);
                setTimeout(() => window.location.reload(), 1500);
            } else {
                showToast(res.response.substring(0,40), "error");
            }
        } catch(e) { showToast(e.message, "error"); }
    };

    // ===================================================================
    // 4. VIEW: SESSION MASTER
    // ===================================================================
    const [sessionTab, setSessionTab] = useState('present');

    const loadSession = async (session) => {
        setActiveSession(session);
        setMasterLogs(null);
        setExemptTarget(null);
        navTo('#tools/session');
        refreshSessionData(session.id);
    };

    const refreshSessionData = async (sid) => {
        try {
            let currentRoster = roster;
            if (!currentRoster) {
                currentRoster = await api.get(`/tools/roster?gid=${activeGroup.id}`);
                setRoster(currentRoster);
            }
            const logs = await api.get(`/tools/session_master?sid=${sid}`);
            
            const present = [];
            const absent = [];
            
            currentRoster.forEach(student => {
                const log = logs.find(l => l.matricNo === student.matric);
                if (log && (log.status === 'P' || log.status === 'M' || log.status === 'L')) {
                    present.push({ ...student, log_id: log.id, status: log.status });
                } else {
                    absent.push(student);
                }
            });
            setMasterLogs({ present, absent });
        } catch(e) { showToast("Failed to load session data", "error"); }
    };

    const handleAttendanceAction = async (type, targetMatric, targetLogId, reason = '') => {
        try {
            setExemptTarget(null); 
            await api.post('/action', { 
                type, matric: targetMatric, sid: activeSession.id, lid: targetLogId, gid: activeGroup.id, remark: reason 
            });
            showToast("Success", "success");
            refreshSessionData(activeSession.id);
        } catch(e) { showToast(e.message, "error"); }
    };

    // ===================================================================
    // 5. VIEW: ROSTER & GOD MODE
    // ===================================================================
    const loadRoster = async () => {
        navTo('#tools/roster');
        if (!roster) {
            try {
                const res = await api.get(`/tools/roster?gid=${activeGroup.id}`);
                setRoster(res);
            } catch(e) {}
        }
    };

    const handlePwdChange = (matric, val) => {
        setRoster(prev => prev.map(s => s.matric === matric ? { ...s, password: val, failed: false } : s));
    };

    const testPassword = async (matric, pwd, auto = false) => {
        try {
            const res = await api.post('/tools/validate', { matric, password: pwd, auto, initiator: user.matric });
            if (res.valid) {
                setRoster(prev => prev.map(s => s.matric === matric ? { ...s, password: res.password, failed: false } : s));
                return true;
            } else {
                setRoster(prev => prev.map(s => s.matric === matric ? { ...s, failed: true } : s));
                return false;
            }
        } catch(e) { return false; }
    };

    const startAutoFetch = async () => {
        if (isFetching) { fetchAbort.current = true; return; }
        setIsFetching(true);
        fetchAbort.current = false;
        const targets = roster.filter(s => !s.password || s.failed);
        let count = 0;
        for (let s of targets) {
            if (fetchAbort.current) break;
            count++;
            setFetchProgress(`${count} / ${targets.length}`);
            await testPassword(s.matric, '', true);
        }
        setIsFetching(false);
        setFetchProgress('');
    };

    useEffect(() => {
        if (view !== 'roster' && isFetching) {
            fetchAbort.current = true;
            setIsFetching(false);
        }
    }, [view, isFetching]);

    const dropStudent = async (matric, pwd) => {
        try {
            const res = await api.post('/tools/action', {
                action: 'DROP', matric, password: pwd, code: activeGroup.code, cid: activeGroup.id, initiator: user.matric
            });
            if (res.status === 200 && res.response.includes('error":false')) {
                showToast("Dropped", "success");
                setRoster(prev => prev.filter(s => s.matric !== matric));
                setActiveGroup(prev => ({...prev, students: (prev.students || 1) - 1}));
            } else {
                showToast(res.response.substring(0,30), "error");
            }
        } catch(e) { showToast("Failed", "error"); }
    };

    if (!view) return null;
    const isUserEnrolled = activeGroup ? (user?.courses?.some(c => String(c.gid) === String(activeGroup.id)) || false) : false;

    // Notice the locked maxWidth="450px" to make it sleek
    return (
        <Modal title="MASTER TOOLS" isOpen={!!view} onClose={() => window.history.back()} maxWidth="450px">
            
            {view === 'search' && (
                <div style={{ display: 'flex', flexDirection: 'column', height: '60vh' }}>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)', marginBottom: '5px' }}>DATABASE EXPLORER</div>
                    <input type="text" className="t-input" placeholder="Search Course or Student..." 
                        value={searchQuery} onChange={(e) => handleSearch(e.target.value)} style={{ width: '100%', marginBottom: '15px', borderColor: 'var(--primary)', textAlign: 'left', padding: '10px' }} />
                    <div style={{ flex: 1, overflowY: 'auto', border: '1px solid var(--grid-line)', borderRadius: '4px', background: 'rgba(0,0,0,0.5)' }}>
                        {searchResults.length === 0 ? (
                            <div style={{ textAlign: 'center', color: '#555', padding: '30px 10px', fontSize: '0.8rem' }}>{searchQuery.length < 2 ? "Type to search..." : "NO MATCHES FOUND"}</div>
                        ) : (
                            searchResults.map(u => (
                                <div key={u.m} onClick={() => selectSearchItem(u)} style={{ padding: '10px 12px', borderBottom: '1px solid #222', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                                        <span style={{ color: u.t === 'c' ? '#0f0' : 'var(--primary)', fontWeight: 'bold', fontSize: '0.85rem' }}>{u.n}</span>
                                        <span style={{ color: '#888', fontSize: '0.65rem', marginTop: '2px' }}>{u.t === 'c' ? 'COURSE' : 'STUDENT'} ID: {u.m}</span>
                                    </div>
                                    <span style={{ color: '#555', fontWeight: 'bold' }}>{'>'}</span>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            )}

            {view === 'groups' && (
                <div>
                    <div style={{color:'var(--primary)', marginBottom:'15px', textAlign:'center', fontSize: '0.9rem'}}>{selectedItem?.n}</div>
                    {!groupList ? <><Skeleton/><Skeleton/></> : groupList.length === 0 ? <div style={{textAlign:'center'}}>NO GROUPS</div> : 
                        groupList.map(g => (
                            <div key={g.id} className="course-card" style={{padding: '10px 12px', marginBottom:'8px', display:'block', minHeight: 'auto'}} onClick={() => selectGroup(g)}>
                                <div style={{display:'flex', justifyContent:'space-between'}}>
                                    <span className="cc-code" style={{color:'#fff', marginBottom:0}}>{g.code} {g.group}</span>
                                    <span style={{color:'var(--accent)', fontSize:'0.75rem'}}>ID: {g.id}</span>
                                </div>
                                <div className="cc-group" style={{ display: 'flex', justifyContent: 'space-between', marginTop: '3px' }}>
                                    <span style={{fontSize: '0.7rem'}}>{g.name}</span>
                                    <span style={{ color: '#0f0', fontWeight: 'bold', fontSize: '0.7rem' }}>{g.students || 0} Registered</span>
                                </div>
                            </div>
                        ))
                    }
                </div>
            )}

            {view === 'hub' && activeGroup && (
                <div>
                    <div className="tools-hub-header">
                        <div className="hub-title">{activeGroup.code} {activeGroup.group}</div>
                        <div className="hub-meta">{activeGroup.name} | ID: {activeGroup.id}</div>
                        
                        {!showSelfPrompt ? (
                            <div style={{display:'flex', gap:'10px', justifyContent:'center'}}>
                                {isUserEnrolled ? (
                                    <button className="btn" style={{borderColor:'#f00', color:'#f00', padding: '6px 12px'}} onClick={()=>setShowSelfPrompt('DROP')}>DROP SELF</button>
                                ) : (
                                    <button className="btn" style={{borderColor:'#0f0', color:'#0f0', padding: '6px 12px'}} onClick={()=>setShowSelfPrompt('REGISTER')}>REGISTER SELF</button>
                                )}
                            </div>
                        ) : (
                            <div style={{display:'flex', gap:'8px', justifyContent:'center'}}>
                                <input type="password" placeholder="UNIMAS Password" value={selfPwdPrompt} onChange={e=>setSelfPwdPrompt(e.target.value)} className="t-input" style={{width:'140px', padding:'4px'}}/>
                                <button className="btn" style={{borderColor: showSelfPrompt==='DROP'?'#f00':'#0f0', padding: '4px 10px'}} onClick={()=>handleSelfAction(showSelfPrompt)}>CONFIRM</button>
                                <button className="btn" style={{padding: '4px 10px'}} onClick={()=>setShowSelfPrompt(false)}>X</button>
                            </div>
                        )}
                        
                        <div style={{marginTop:'12px', fontSize:'0.8rem', color:'var(--primary)', cursor:'pointer', textDecoration:'underline'}} onClick={loadRoster}>
                            View Enrolled Students - {activeGroup.students || 0} Students
                        </div>
                    </div>

                    <div style={{fontSize:'0.75rem', color:'#888', marginBottom:'8px'}}>SESSION LOGS</div>
                    {!hubSessions ? <><Skeleton type="session-row"/><Skeleton type="session-row"/></> : hubSessions.length === 0 ? <div style={{textAlign:'center', fontSize: '0.8rem'}}>NO SESSIONS</div> :
                        hubSessions.map(s => (
                            <div key={s.id} className="course-card" style={{padding: '10px 12px', marginBottom:'8px', display:'block', borderColor:'var(--grid-line)', minHeight: 'auto'}} onClick={() => loadSession(s)}>
                                <div style={{display:'flex', justifyContent:'space-between'}}>
                                    <span style={{color:'#fff', fontWeight:'bold', fontSize:'0.85rem'}}>{s.date}</span>
                                    <span style={{color:'var(--text-dim)', fontSize:'0.75rem'}}>{s.start} - {s.end}</span>
                                </div>
                                <div style={{fontSize:'0.7rem', color:'#aaa', marginTop:'4px', display: 'flex', justifyContent: 'space-between'}}>
                                    <span>{s.location}</span>
                                    <span style={{color: 'var(--primary)'}}>Manage Attendance {'>'}</span>
                                </div>
                            </div>
                        ))
                    }
                </div>
            )}

            {view === 'session' && activeSession && (
                <div>
                    <div style={{textAlign:'center', marginBottom:'10px', color:'var(--primary)', fontSize: '0.85rem'}}>{activeSession.date} ({activeSession.start})</div>
                    <div className="tools-tabs">
                        <div className={`tools-tab ${sessionTab === 'present' ? 'active' : ''}`} onClick={()=>setSessionTab('present')}>PRESENT ({masterLogs?.present?.length || 0})</div>
                        <div className={`tools-tab ${sessionTab === 'absent' ? 'active' : ''}`} onClick={()=>setSessionTab('absent')}>ABSENT ({masterLogs?.absent?.length || 0})</div>
                    </div>
                    
                    {exemptTarget && (
                        <div style={{ background: 'rgba(0,0,0,0.9)', padding: '12px', border: '1px solid var(--accent)', borderRadius: '4px', marginBottom: '10px', textAlign: 'center' }}>
                            <div style={{ color: 'var(--accent)', fontSize: '0.75rem', marginBottom: '8px' }}>Exempt Reason for {exemptTarget.matric}:</div>
                            <input type="text" className="t-input" value={exemptReason} onChange={e => setExemptReason(e.target.value)} placeholder="Reason (Optional)..." style={{ width: '100%', marginBottom: '10px', padding: '6px' }}/>
                            <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
                                <button className="btn" style={{ borderColor: 'var(--accent)', color: 'var(--accent)', padding: '5px 10px' }} onClick={() => handleAttendanceAction('exempt', exemptTarget.matric, null, exemptReason)}>CONFIRM</button>
                                <button className="btn" style={{ padding: '5px 10px' }} onClick={() => setExemptTarget(null)}>CANCEL</button>
                            </div>
                        </div>
                    )}

                    {!masterLogs ? <><Skeleton type="session-row"/><Skeleton type="session-row"/></> : (
                        <div style={{maxHeight:'60vh', overflowY:'auto'}}>
                            {(sessionTab === 'present' ? masterLogs.present : masterLogs.absent).map(s => (
                                <div key={s.matric} className="master-row">
                                    <img src={`https://studentphotos.unimas.my/${s.matric}.jpg`} className="master-pic" onError={e=>e.target.style.display='none'} alt="Pic"/>
                                    <div className="master-info">
                                        <span className="master-name">{s.name}</span>
                                        <span className="master-matric">{s.matric} {s.status ? `(${s.status})` : ''}</span>
                                    </div>
                                    <div className="master-actions">
                                        {sessionTab === 'present' ? (
                                            <button className="btn" style={{borderColor:'#f00', color:'#f00', padding:'4px 8px'}} onClick={() => handleAttendanceAction('delete', s.matric, s.log_id)}>DEL</button>
                                        ) : (
                                            <>
                                                <button className="btn" style={{borderColor:'var(--primary)', color:'var(--primary)', padding:'4px 8px'}} onClick={() => handleAttendanceAction('scan', s.matric, null)}>SCAN</button>
                                                <button className="btn" style={{padding:'4px 8px'}} onClick={() => handleAttendanceAction('manual', s.matric, null)}>MAN</button>
                                                <button className="btn" style={{borderColor:'var(--accent)', color:'var(--accent)', padding:'4px 8px'}} onClick={() => { setExemptTarget(s); setExemptReason(''); }}>EXM</button>
                                            </>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {view === 'roster' && (
                <div>
                    <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'12px', borderBottom:'1px solid var(--grid-line)', paddingBottom:'8px'}}>
                        <div style={{color:'var(--primary)', fontWeight:'bold', fontSize: '0.9rem'}}>DROP LIST</div>
                        <button className="btn" style={{borderColor:'#0f0', color:'#0f0', minWidth:'100px', padding: '5px 10px'}} onClick={startAutoFetch}>
                            {isFetching ? `STOP (${fetchProgress})` : 'AUTO FETCH PWD'}
                        </button>
                    </div>

                    {!roster ? <><Skeleton type="session-row"/><Skeleton type="session-row"/></> : roster.length === 0 ? <div style={{textAlign:'center', fontSize: '0.8rem'}}>EMPTY CLASS</div> : (
                        <div style={{maxHeight:'60vh', overflowY:'auto'}}>
                            {roster.map(s => (
                                <div key={s.matric} className="master-row">
                                    <img src={`https://studentphotos.unimas.my/${s.matric}.jpg`} className="master-pic" onError={e=>e.target.style.display='none'} alt="Pic"/>
                                    <div className="master-info">
                                        <span className="master-name">{s.name}</span>
                                        <span className="master-matric">{s.matric}</span>
                                    </div>
                                    <div className="master-actions" style={{flexDirection:'column', gap:'4px', alignItems:'flex-end'}}>
                                        <input type="text" className={`pwd-input ${s.failed ? 'pwd-failed' : ''}`} 
                                            placeholder={s.failed ? "Failed ❌" : "Password..."} value={s.password || ''} 
                                            onChange={(e) => handlePwdChange(s.matric, e.target.value)} 
                                        />
                                        <div style={{display:'flex', gap:'5px'}}>
                                            {s.password && !s.failed ? (
                                                <button className="btn" style={{borderColor:'#f00', color:'#f00', padding:'3px 8px'}} onClick={() => dropStudent(s.matric, s.password)}>DROP</button>
                                            ) : (
                                                <button className="btn" style={{borderColor:'var(--accent)', color:'var(--accent)', padding:'3px 8px'}} onClick={() => testPassword(s.matric, s.password)}>TEST</button>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
            
        </Modal>
    );
}

// --- END OF FILE ToolsModal.jsx ---