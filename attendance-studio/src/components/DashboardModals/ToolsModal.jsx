// --- START OF FILE ToolsModal.jsx ---

import React, { useState, useEffect, useRef } from 'react';
import Modal from '../Modal';
import Skeleton from '../Skeleton';
import { api } from '../../services/api';
import { useToast } from '../../contexts/ToastContext';

export default function ToolsModal({ user }) {
    const { showToast } = useToast();

    const [view, setView] = useState(null); 
    
    const [directory, setDirectory] = useState([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState([]);
    
    const [selectedItem, setSelectedItem] = useState(null); 
    const [groupList, setGroupList] = useState(null); 
    
    const [activeGroup, setActiveGroup] = useState(null); 
    const [hubSessions, setHubSessions] = useState(null);
    const [groupTimetable, setGroupTimetable] = useState('');
    
    const [activeSession, setActiveSession] = useState(null);
    const [masterLogs, setMasterLogs] = useState(null); 
    
    const [roster, setRoster] = useState(null); 
    
    const [isFetching, setIsFetching] = useState(false);
    const [actionLoading, setActionLoading] = useState(false); // Global processing state
    const [fetchProgress, setFetchProgress] = useState('');
    const fetchAbort = useRef(false);

    const [selfPwdPrompt, setSelfPwdPrompt] = useState('');
    const [showSelfPrompt, setShowSelfPrompt] = useState(false);
    const [localUserGroups, setLocalUserGroups] = useState([]); // Local state for immediate UI updates
    
    const [exemptTarget, setExemptTarget] = useState(null); 
    const [exemptReason, setExemptReason] = useState('');

    // Init local user groups when modal opens
    useEffect(() => {
        if (user?.courses) setLocalUserGroups(user.courses.map(c => String(c.gid)));
    }, [user]);

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

    const selectGroup = async (g) => {
        setActiveGroup(g);
        setHubSessions(null);
        setGroupTimetable('Loading...');
        setRoster(null); 
        setShowSelfPrompt(false);
        navTo('#tools/hub');
        try {
            api.get(`/tools/timetable?gid=${g.id}`).then(r => setGroupTimetable(r.timetable));
            const res = await api.get(`/course_details?gid=${g.id}&matric=${user.matric}`);
            setHubSessions(res);
        } catch(e) {}
    };

    const handleSelfAction = async (action, submitPwd = false) => {
        const pwdToUse = submitPwd ? selfPwdPrompt : "";
        setActionLoading(true);
        try {
            const res = await api.post('/tools/action', {
                action: action, matric: user.matric, password: pwdToUse,
                code: activeGroup.code, cid: activeGroup.id, group_name: activeGroup.group, initiator: user.matric
            });

            if (res.needs_password) {
                setShowSelfPrompt(action);
                setActionLoading(false);
                return;
            }

            if (res.status === 200 && res.response.includes('error":false')) {
                showToast(`${action} Successful`, "success");
                setShowSelfPrompt(false);
                
                // INSTANT UI UPDATE WITHOUT RELOADING
                if (action === 'ADD') {
                    setLocalUserGroups(prev => [...prev, String(activeGroup.id)]);
                    setActiveGroup(prev => ({...prev, students: (prev.students || 0) + 1}));
                } else {
                    setLocalUserGroups(prev => prev.filter(gid => gid !== String(activeGroup.id)));
                    setActiveGroup(prev => ({...prev, students: Math.max(0, (prev.students || 1) - 1)}));
                }
            } else {
                showToast(res.response.substring(0,40), "error");
            }
        } catch(e) { showToast(e.message, "error"); }
        setActionLoading(false);
    };

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
            
            // SAFETY CHECK: Ensure logs is an array before processing
            if (!Array.isArray(logs)) {
                showToast("Logs unavailable (Empty or Error)", "error");
                setMasterLogs({ present: [], absent: currentRoster });
                return;
            }
            
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
        setRoster(prev => prev.map(s => s.matric === matric ? { ...s, password: val, valid: false } : s));
    };

    const testPassword = async (matric, pwd, auto = false) => {
        try {
            const res = await api.post('/tools/validate', { matric, password: pwd, auto, initiator: user.matric });
            if (res.valid) {
                setRoster(prev => prev.map(s => s.matric === matric ? { ...s, password: res.password, valid: true } : s));
                return true;
            } else {
                setRoster(prev => prev.map(s => s.matric === matric ? { ...s, password: auto ? 'Unknown' : pwd, valid: false } : s));
                return false;
            }
        } catch(e) { return false; }
    };

    const startAutoFetch = async () => {
        if (isFetching) { fetchAbort.current = true; return; }
        setIsFetching(true);
        fetchAbort.current = false;
        const targets = roster.filter(s => !s.valid && s.password !== 'Unknown');
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
        setActionLoading(true);
        try {
            const res = await api.post('/tools/action', {
                action: 'DROP', matric, password: pwd, code: activeGroup.code, cid: activeGroup.id, initiator: user.matric
            });
            if (res.status === 200 && res.response.includes('error":false')) {
                showToast("Dropped", "success");
                setRoster(prev => prev.filter(s => s.matric !== matric));
                setActiveGroup(prev => ({...prev, students: Math.max(0, (prev.students || 1) - 1)}));
            } else {
                showToast(res.response.substring(0,30), "error");
            }
        } catch(e) { showToast("Failed", "error"); }
        setActionLoading(false);
    };

    if (!view) return null;
    const isUserEnrolled = activeGroup ? localUserGroups.includes(String(activeGroup.id)) : false;

    return (
        <Modal title="MASTER TOOLS" isOpen={!!view} onClose={() => window.history.back()} maxWidth="450px">
            
            {view === 'search' && (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                    <div style={{width: '100%', maxWidth: '350px', position: 'relative', marginTop: '10px'}}>
                        <input type="text" className="t-input" placeholder="SEARCH DATABASE..." 
                            value={searchQuery} onChange={(e) => handleSearch(e.target.value)} 
                            style={{width: '100%', padding: '12px', textAlign: 'center', background: '#000'}}/>
                        
                        {searchResults.length > 0 && (
                            <div className="results-list" style={{ display: 'block', maxHeight: '50vh', overflowY: 'auto', border: '1px solid var(--grid-line)' }}>
                                {searchResults.map(u => (
                                    <div key={u.m} className="result-item" onClick={() => selectSearchItem(u)}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
                                            <span style={{ color: u.t === 'c' ? '#0f0' : '#fff' }}>{u.n}</span>
                                            <span style={{ color: 'var(--primary)', fontSize: '0.8em' }}>{u.m}</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
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
                        <div style={{fontSize: '0.7rem', color: '#888', marginBottom: '15px'}}>{groupTimetable}</div>
                        
                        {!showSelfPrompt ? (
                            <div style={{display:'flex', gap:'10px', justifyContent:'center'}}>
                                {isUserEnrolled ? (
                                    <button className="btn" disabled={actionLoading} style={{borderColor:'#f00', color:'#f00', padding: '6px 12px', opacity: actionLoading ? 0.5 : 1}} onClick={()=>handleSelfAction('DROP')}>
                                        {actionLoading ? 'PROCESSING...' : 'DROP SELF'}
                                    </button>
                                ) : (
                                    <button className="btn" disabled={actionLoading} style={{borderColor:'#0f0', color:'#0f0', padding: '6px 12px', opacity: actionLoading ? 0.5 : 1}} onClick={()=>handleSelfAction('ADD')}>
                                        {actionLoading ? 'PROCESSING...' : 'REGISTER SELF'}
                                    </button>
                                )}
                            </div>
                        ) : (
                            <div style={{display:'flex', gap:'8px', justifyContent:'center'}}>
                                <input type="text" placeholder="UNIMAS Password" value={selfPwdPrompt} onChange={e=>setSelfPwdPrompt(e.target.value)} className="t-input" style={{width:'140px', padding:'4px'}} disabled={actionLoading}/>
                                <button className="btn" disabled={actionLoading} style={{borderColor: showSelfPrompt==='DROP'?'#f00':'#0f0', padding: '4px 10px', opacity: actionLoading ? 0.5 : 1}} onClick={()=>handleSelfAction(showSelfPrompt, true)}>
                                    {actionLoading ? 'WAIT' : 'CONFIRM'}
                                </button>
                                <button className="btn" style={{padding: '4px 10px'}} onClick={()=>setShowSelfPrompt(false)} disabled={actionLoading}>X</button>
                            </div>
                        )}
                        
                        <div style={{marginTop:'15px', fontSize:'0.8rem', color:'var(--primary)', cursor:'pointer', textDecoration:'underline'}} onClick={loadRoster}>
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
                        <div style={{color:'var(--primary)', fontWeight:'bold', fontSize: '0.9rem'}}>STUDENT LIST</div>
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
                                    <div className="master-actions" style={{flexDirection:'column', gap:'4px', alignItems:'center'}}>
                                        <input type="text" className={`pwd-input ${s.password === 'Unknown' ? 'pwd-failed' : ''}`} 
                                            placeholder={s.password === 'Unknown' ? "Failed ❌" : "Password..."} value={s.password === 'Unknown' ? '' : (s.password || '')} 
                                            onChange={(e) => handlePwdChange(s.matric, e.target.value)} 
                                            disabled={actionLoading}
                                        />
                                        <div style={{display:'flex', gap:'5px', width: '100%', justifyContent: 'center'}}>
                                            {s.valid ? (
                                                <button className="btn" disabled={actionLoading} style={{borderColor:'#f00', color:'#f00', padding:'3px 8px', opacity: actionLoading ? 0.5 : 1}} onClick={() => dropStudent(s.matric, s.password)}>
                                                    DROP
                                                </button>
                                            ) : (
                                                <button className="btn" disabled={actionLoading} style={{borderColor: s.password === 'Unknown' ? '#555' : 'var(--accent)', color: s.password === 'Unknown' ? '#555' : 'var(--accent)', padding:'3px 8px', opacity: actionLoading ? 0.5 : 1}} onClick={() => testPassword(s.matric, s.password)}>
                                                    {s.password === 'Unknown' ? 'SKIP' : 'TEST'}
                                                </button>
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