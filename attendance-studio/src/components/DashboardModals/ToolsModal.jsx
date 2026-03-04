// --- START OF FILE ToolsModal.jsx ---

import React, { useState, useEffect, useRef } from 'react';
import Modal from '../Modal';
import Skeleton from '../Skeleton';
import { api } from '../../services/api';
import { useToast } from '../../contexts/ToastContext';

export default function ToolsModal({ user }) {
    const { showToast } = useToast();

    // State Navigation
    const [view, setView] = useState(null); // null | 'search' | 'groups' | 'hub' | 'session' | 'roster'
    
    // Data State
    const [directory, setDirectory] = useState([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState([]);
    
    const [selectedItem, setSelectedItem] = useState(null); // The searched Course or Student
    const [groupList, setGroupList] = useState(null); // List of groups fetched
    
    const [activeGroup, setActiveGroup] = useState(null); 
    const [hubSessions, setHubSessions] = useState(null);
    
    const [activeSession, setActiveSession] = useState(null);
    const [masterLogs, setMasterLogs] = useState(null); // { present: [], absent: [] }
    
    const [roster, setRoster] = useState(null); 
    
    // Auto-Fetch State
    const [isFetching, setIsFetching] = useState(false);
    const [fetchProgress, setFetchProgress] = useState('');
    const fetchAbort = useRef(false);

    const [selfPwdPrompt, setSelfPwdPrompt] = useState('');
    const [showSelfPrompt, setShowSelfPrompt] = useState(false);

    // ===================================================================
    // 1. HASH ROUTING (The Back Button Magic)
    // ===================================================================
    useEffect(() => {
        const handleHash = () => {
            const h = window.location.hash;
            if (h === '#tools') setView('search');
            else if (h === '#tools/groups') setView('groups');
            else if (h === '#tools/hub') setView('hub');
            else if (h === '#tools/session') setView('session');
            else if (h === '#tools/roster') setView('roster');
            else setView(null); // Close modal if back to #dashboard
        };
        window.addEventListener('popstate', handleHash);
        window.addEventListener('hashchange', handleHash);
        return () => {
            window.removeEventListener('popstate', handleHash);
            window.removeEventListener('hashchange', handleHash);
        };
    }, []);

    // Helper to push state
    const navTo = (hashLevel) => { window.location.hash = hashLevel; };

    // ===================================================================
    // 2. VIEW: SEARCH
    // ===================================================================
    useEffect(() => {
        if (view === 'search' && directory.length === 0) {
            // Fetch unified directory (Students + Courses)
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
        setRoster(null); // Reset roster to force fresh load
        navTo('#tools/hub');
        try {
            // Reuse course_details API to get sessions
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
        navTo('#tools/session');
        refreshSessionData(session.id);
    };

    const refreshSessionData = async (sid) => {
        try {
            // 1. Get Roster (If not already cached)
            let currentRoster = roster;
            if (!currentRoster) {
                currentRoster = await api.get(`/tools/roster?gid=${activeGroup.id}`);
                setRoster(currentRoster);
            }
            // 2. Get Logs
            const logs = await api.get(`/tools/session_master?sid=${sid}`);
            
            // 3. Map them together
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

    const handleAttendanceAction = async (type, targetMatric, targetLogId) => {
        try {
            // Set temporary skeleton UI state if needed, or just await
            await api.post('/action', { 
                type, matric: targetMatric, sid: activeSession.id, lid: targetLogId, gid: activeGroup.id 
            });
            showToast("Success", "success");
            refreshSessionData(activeSession.id); // Refresh live UI
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
            await testPassword(s.matric, '', true); // auto=true fetches IC
        }
        
        setIsFetching(false);
        setFetchProgress('');
    };

    // Auto-abort fetch if user presses back button to leave roster
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
                // Remove from roster UI instantly
                setRoster(prev => prev.filter(s => s.matric !== matric));
            } else {
                showToast(res.response.substring(0,30), "error");
            }
        } catch(e) { showToast("Failed", "error"); }
    };

    // ===================================================================
    // RENDERERS
    // ===================================================================
    if (!view) return null;

    return (
        <Modal title="MASTER TOOLS" isOpen={!!view} onClose={() => window.history.back()} maxWidth={view === 'search' ? '400px' : '550px'}>
            
            {/* VIEW 1: SEARCH */}
            {view === 'search' && (
                <div>
                    <input type="text" className="t-input" placeholder="Course Code, Name, or Matric..." 
                        value={searchQuery} onChange={(e) => handleSearch(e.target.value)} style={{width:'100%', marginBottom:'10px'}} />
                    <div className="results-list" style={{ position: 'static', display: 'block', maxHeight: '400px', border:'none', boxShadow:'none'}}>
                        {searchResults.map(u => (
                            <div key={u.m} className="result-item" onClick={() => selectSearchItem(u)}>
                                <div style={{display:'flex', flexDirection:'column'}}>
                                    <span style={{color: u.t === 'c' ? '#0f0' : 'var(--primary)', fontWeight:'bold'}}>{u.n}</span>
                                    <span style={{color: '#888', fontSize:'0.75rem'}}>{u.t === 'c' ? 'COURSE' : 'STUDENT'} ID: {u.m}</span>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* VIEW 2: GROUP LIST */}
            {view === 'groups' && (
                <div>
                    <div style={{color:'var(--primary)', marginBottom:'15px', textAlign:'center'}}>{selectedItem?.n}</div>
                    {!groupList ? <><Skeleton/><Skeleton/></> : groupList.length === 0 ? <div style={{textAlign:'center'}}>NO GROUPS</div> : 
                        groupList.map(g => (
                            <div key={g.id} className="course-card" style={{marginBottom:'10px', display:'block'}} onClick={() => selectGroup(g)}>
                                <div style={{display:'flex', justifyContent:'space-between'}}>
                                    <span className="cc-code" style={{color:'#fff'}}>{g.code} {g.group}</span>
                                    <span style={{color:'var(--accent)', fontSize:'0.8rem'}}>ID: {g.id}</span>
                                </div>
                                <div className="cc-group">{g.name}</div>
                            </div>
                        ))
                    }
                </div>
            )}

            {/* VIEW 3: HUB */}
            {view === 'hub' && activeGroup && (
                <div>
                    <div className="tools-hub-header">
                        <div className="hub-title">{activeGroup.code} {activeGroup.group}</div>
                        <div className="hub-meta">{activeGroup.name} | ID: {activeGroup.id}</div>
                        
                        {/* Self Register/Drop */}
                        {!showSelfPrompt ? (
                            <div style={{display:'flex', gap:'10px', justifyContent:'center'}}>
                                <button className="btn" style={{borderColor:'#0f0', color:'#0f0'}} onClick={()=>setShowSelfPrompt('REGISTER')}>REGISTER SELF</button>
                                <button className="btn" style={{borderColor:'#f00', color:'#f00'}} onClick={()=>setShowSelfPrompt('DROP')}>DROP SELF</button>
                            </div>
                        ) : (
                            <div style={{display:'flex', gap:'10px', justifyContent:'center'}}>
                                <input type="password" placeholder="UNIMAS Password" value={selfPwdPrompt} onChange={e=>setSelfPwdPrompt(e.target.value)} className="t-input" style={{width:'150px', padding:'5px'}}/>
                                <button className="btn" style={{borderColor: showSelfPrompt==='DROP'?'#f00':'#0f0'}} onClick={()=>handleSelfAction(showSelfPrompt)}>CONFIRM</button>
                                <button className="btn" onClick={()=>setShowSelfPrompt(false)}>X</button>
                            </div>
                        )}
                        
                        <div style={{marginTop:'15px', fontSize:'0.85rem', color:'var(--primary)', cursor:'pointer', textDecoration:'underline'}} onClick={loadRoster}>
                            View Enrolled Students (Roster)
                        </div>
                    </div>

                    <div style={{fontSize:'0.8rem', color:'#888', marginBottom:'10px'}}>SESSION LOGS</div>
                    {!hubSessions ? <><Skeleton type="session-row"/><Skeleton type="session-row"/></> : hubSessions.length === 0 ? <div style={{textAlign:'center'}}>NO SESSIONS</div> :
                        hubSessions.map(s => (
                            <div key={s.id} className="course-card" style={{marginBottom:'10px', display:'block', borderColor:'var(--grid-line)'}} onClick={() => loadSession(s)}>
                                <div style={{display:'flex', justifyContent:'space-between'}}>
                                    <span style={{color:'#fff', fontWeight:'bold', fontSize:'0.9rem'}}>{s.date}</span>
                                    <span style={{color:'var(--text-dim)', fontSize:'0.8rem'}}>{s.start} - {s.end}</span>
                                </div>
                                <div style={{fontSize:'0.75rem', color:'#aaa', marginTop:'3px'}}>{s.location}</div>
                            </div>
                        ))
                    }
                </div>
            )}

            {/* VIEW 4a: SESSION MASTER */}
            {view === 'session' && activeSession && (
                <div>
                    <div style={{textAlign:'center', marginBottom:'15px', color:'var(--primary)'}}>{activeSession.date} ({activeSession.start})</div>
                    <div className="tools-tabs">
                        <div className={`tools-tab ${sessionTab === 'present' ? 'active' : ''}`} onClick={()=>setSessionTab('present')}>PRESENT ({masterLogs?.present?.length || 0})</div>
                        <div className={`tools-tab ${sessionTab === 'absent' ? 'active' : ''}`} onClick={()=>setSessionTab('absent')}>ABSENT ({masterLogs?.absent?.length || 0})</div>
                    </div>
                    
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
                                                <button className="btn" style={{borderColor:'var(--accent)', color:'var(--accent)', padding:'4px 8px'}} onClick={() => handleAttendanceAction('exempt', s.matric, null)}>EXM</button>
                                            </>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* VIEW 4b: ROSTER & GOD MODE */}
            {view === 'roster' && (
                <div>
                    <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'15px', borderBottom:'1px solid var(--grid-line)', paddingBottom:'10px'}}>
                        <div style={{color:'var(--primary)', fontWeight:'bold'}}>ROSTER & DROP</div>
                        <button className="btn" style={{borderColor:'#0f0', color:'#0f0', minWidth:'100px'}} onClick={startAutoFetch}>
                            {isFetching ? `STOP (${fetchProgress})` : 'AUTO FETCH PWD'}
                        </button>
                    </div>

                    {!roster ? <><Skeleton type="session-row"/><Skeleton type="session-row"/></> : roster.length === 0 ? <div style={{textAlign:'center'}}>EMPTY CLASS</div> : (
                        <div style={{maxHeight:'60vh', overflowY:'auto'}}>
                            {roster.map(s => (
                                <div key={s.matric} className="master-row">
                                    <img src={`https://studentphotos.unimas.my/${s.matric}.jpg`} className="master-pic" onError={e=>e.target.style.display='none'} alt="Pic"/>
                                    <div className="master-info">
                                        <span className="master-name">{s.name}</span>
                                        <span className="master-matric">{s.matric}</span>
                                    </div>
                                    <div className="master-actions" style={{flexDirection:'column', gap:'5px', alignItems:'flex-end'}}>
                                        <input type="text" className={`pwd-input ${s.failed ? 'pwd-failed' : ''}`} 
                                            placeholder="Password..." value={s.password || ''} 
                                            onChange={(e) => handlePwdChange(s.matric, e.target.value)} 
                                        />
                                        <div style={{display:'flex', gap:'5px'}}>
                                            {s.password && !s.failed ? (
                                                <button className="btn" style={{borderColor:'#f00', color:'#f00', padding:'4px 8px'}} onClick={() => dropStudent(s.matric, s.password)}>DROP</button>
                                            ) : (
                                                <button className="btn" style={{borderColor:'var(--accent)', color:'var(--accent)', padding:'4px 8px'}} onClick={() => testPassword(s.matric, s.password)}>TEST</button>
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