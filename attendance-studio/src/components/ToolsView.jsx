import React, { useState, useEffect, useRef, useCallback } from 'react';
import Skeleton from './Skeleton';
import { api, getDirectory } from '../services/api';
import { useToast } from '../contexts/ToastContext';
import { useConfirm } from '../contexts/ConfirmContext';

export default function ToolsView({ user, isVisible, onDeepNavChange, onUpdateAutoReg }) {
    const { showToast } = useToast();
    const { confirm } = useConfirm();

    const [view, setView] = useState('search'); 
    const viewRef = useRef('search');
    
    const [directory, setDirectory] = useState([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState([]);
    
    const [selectedItem, setSelectedItem] = useState(null); 
    const [groupList, setGroupList] = useState(null); 
    const [activeGroup, setActiveGroup] = useState(null); 
    const [hubSessions, setHubSessions] = useState(null);
    const [hubTimetable, setHubTimetable] = useState(null);
    const [activeSession, setActiveSession] = useState(null);
    const [masterLogs, setMasterLogs] = useState(null); 
    const [roster, setRoster] = useState(null); 
    
    const [isFetching, setIsFetching] = useState(false);
    const [actionLoading, setActionLoading] = useState(false);
    const [attendanceLoadingId, setAttendanceLoadingId] = useState(null);
    const [fetchProgress, setFetchProgress] = useState('');
    const fetchAbort = useRef(false);

    const [selfPwdPrompt, setSelfPwdPrompt] = useState('');
    const [showSelfPrompt, setShowSelfPrompt] = useState(false);
    const [selfPwdTested, setSelfPwdTested] = useState(false);
    const [localUserGroups, setLocalUserGroups] = useState([]); 
    const [localAutoReg, setLocalAutoReg] = useState([]); 
    const [exemptTarget, setExemptTarget] = useState(null); 
    const [exemptReason, setExemptReason] = useState('');
    const [sessionTab, setSessionTab] = useState('present');

    useEffect(() => { 
        if (user?.courses) setLocalUserGroups(user.courses.map(c => String(c.gid))); 
        if (user?.auto_register) setLocalAutoReg(user.auto_register.map(gi => String(gi)));
    }, [user]);

    useEffect(() => { getDirectory().then(setDirectory).catch(()=>{}); }, []);

    // ---- HASH-BASED BROWSER BACK SUPPORT ----
    // When we navigate deep (groups/hub/session/roster), push a tools-specific hash.
    // The Dashboard's own hash listener only reacts to #dashboard — we add #dashboard/tools
    // as an intermediate level that only ToolsView consumes.

    const setViewWithNavigation = useCallback((newView, groupListArg) => {
        viewRef.current = newView;
        setView(newView);
        if (newView !== 'search') {
            // Push into browser history so the back button works
            window.history.pushState({ toolsView: newView }, '', '#dashboard/tools');
        } else {
            // Going back to search — restore the dashboard hash without pushing
            window.history.replaceState({}, '', '#dashboard');
        }
        onDeepNavChange?.(newView !== 'search');
    }, [onDeepNavChange]);

    const handleBack = useCallback(() => {
        const cur = viewRef.current;
        let next = 'search';
        if (cur === 'roster' || cur === 'session') next = 'hub';
        else if (cur === 'hub') next = groupList ? 'groups' : 'search';
        else if (cur === 'groups') next = 'search';
        
        viewRef.current = next;
        setView(next);
        onDeepNavChange?.(next !== 'search');
    }, [groupList, onDeepNavChange]);

    useEffect(() => {
        if (!isVisible) return;

        const onPopState = (e) => {
            const hash = window.location.hash;
            // If the hash went back from #dashboard/tools to #dashboard
            // and we're deep in tools, intercept and go back one level
            if (hash === '#dashboard' && viewRef.current !== 'search') {
                handleBack();
                // Re-push #dashboard/tools if we're still not at root
                if (viewRef.current !== 'search') {
                    window.history.pushState({ toolsView: viewRef.current }, '', '#dashboard/tools');
                }
            }
            // If hash is empty or something else while in tools deep, also handle
        };

        window.addEventListener('popstate', onPopState);
        return () => window.removeEventListener('popstate', onPopState);
    }, [isVisible, handleBack]);

    // When ToolsView is hidden (tab switch), cleanup hash
    useEffect(() => {
        if (!isVisible && viewRef.current !== 'search') {
            // Don't mess with hash when switching tabs
        }
    }, [isVisible]);

    const handleSearch = (val) => {
        setSearchQuery(val);
        if (val.length < 2) { setSearchResults([]); return; }
        const clean = val.toUpperCase().replace(/\s+/g, '');
        const matches = directory.filter(u => {
            const n = (u.n || "").toUpperCase().replace(/\s+/g, '');
            const m = (u.m || "").toUpperCase();
            return n.includes(clean) || m.includes(clean);
        }).slice(0, 15);
        setSearchResults(matches);
    };

    const selectSearchItem = async (item) => {
        setSearchQuery('');
        setSearchResults([]);
        setSelectedItem(item);
        setGroupList(null);
        setViewWithNavigation('groups');
        try { 
            const res = await api.get(`/tools/details?q=${item.m}&t=${item.t}`); 
            setGroupList(res); 
        } catch(e) { 
            showToast("Failed to fetch groups", "error"); 
        }
    };

    const selectGroup = async (g) => {
        setActiveGroup({ ...g, students: g.students !== undefined ? g.students : '...' });
        setHubSessions(null);
        setHubTimetable(null);
        setRoster(null); 
        setShowSelfPrompt(false);
        setViewWithNavigation('hub');

        if (g.students === undefined && g.code) {
            try {
                const detailsRes = await api.get(`/tools/details?q=${g.code.split(' ')[0]}&t=c`);
                const fullGroup = detailsRes?.find(gr => gr.id === g.id);
                if (fullGroup) setActiveGroup(fullGroup);
                else setActiveGroup(prev => ({...prev, students: '?'}));
            } catch(e) { setActiveGroup(prev => ({...prev, students: '?'})); }
        }

        try {
            const [sessRes, ttRes] = await Promise.all([
                api.get(`/course_details?gid=${g.id}&matric=${user.matric}`),
                api.get(`/tools/timetable?gid=${g.id}`)
            ]);
            setHubSessions(sessRes);
            setHubTimetable(ttRes?.timetable || 'No Timetable');
        } catch(e) {
            setHubSessions([]);
            setHubTimetable('No Timetable');
        }
    };

    const handleSelfTest = async () => {
        if (!selfPwdPrompt) return;
        setActionLoading(true);
        try {
            const res = await api.post('/tools/validate', { matric: user.matric, password: selfPwdPrompt, auto: false, initiator: user.matric });
            if (res.valid) { showToast("Password Valid!", "success"); setSelfPwdTested(true); } 
            else { showToast("Invalid Password", "error"); }
        } catch (e) { showToast("Test Failed", "error"); }
        setActionLoading(false);
    };

    const handleSelfAction = async (action, submitPwd = false) => {
        if (action === 'DROP' && !submitPwd) {
            if (!await confirm(`Are you sure you want to drop yourself from ${activeGroup?.code}?`)) return;
        }
        const pwdToUse = submitPwd ? selfPwdPrompt : "";
        setActionLoading(true);
        try {
            const res = await api.post('/tools/action', {
                action: action, matric: user.matric, password: pwdToUse,
                code: activeGroup.code, cid: activeGroup.id, group_name: activeGroup.group, initiator: user.matric
            });

            if (res.needs_password) {
                setShowSelfPrompt(action);
                setSelfPwdPrompt('');
                setSelfPwdTested(false);
                setActionLoading(false);
                return;
            }

            if (res.success) {
                showToast(`${action} Successful`, "success");
                setShowSelfPrompt(false);
                setRoster(null); 
                getDirectory(true).then(setDirectory);
                
                if (action === 'ADD') {
                    setLocalUserGroups(prev => [...prev, String(activeGroup.id)]);
                    setActiveGroup(prev => ({...prev, students: (prev.students || 0) + 1}));
                } else {
                    setLocalUserGroups(prev => prev.filter(gid => gid !== String(activeGroup.id)));
                    setActiveGroup(prev => ({...prev, students: Math.max(0, (prev.students || 1) - 1)}));
                }
            } else {
                try {
                    const errorJson = JSON.parse(res.response);
                    showToast(errorJson.message || "Action Failed", "error");
                } catch { showToast("Action Failed", "error"); }
            }
        } catch(e) { showToast("Network Error", "error"); }
        setActionLoading(false);
    };

    const loadSession = async (session) => {
        setActiveSession(session);
        setMasterLogs(null);
        setExemptTarget(null);
        setSessionTab('present');
        setViewWithNavigation('session');
        refreshSessionData(session.id);
    };

    const refreshSessionData = async (sid) => {
        try {
            let currentRoster = roster;
            if (!currentRoster) {
                currentRoster = await api.get(`/tools/roster?gid=${activeGroup.id}`);
                if (!Array.isArray(currentRoster)) currentRoster = [];
                setRoster(currentRoster);
            }
            
            const logs = await api.get(`/tools/session_master?sid=${sid}`);
            if (!Array.isArray(logs)) {
                showToast("Logs unavailable", "error");
                setMasterLogs({ present: [], absent: currentRoster || [] });
                return;
            }
            
            const present = []; const absent = [];
            (currentRoster || []).forEach(student => {
                const log = logs.find(l => l.matricNo === student.matric);
                if (log && (log.status === 'P' || log.status === 'M' || log.status === 'L')) present.push({ ...student, log_id: log.id, status: log.status });
                else absent.push(student);
            });
            setMasterLogs({ present, absent });
        } catch(e) { setMasterLogs({ present: [], absent: [] }); }
    };

    const handleAttendanceAction = async (type, targetMatric, targetLogId, reason = '') => {
        if (type === 'delete') {
            if (!await confirm(`Remove attendance for ${targetMatric}?`)) return;
        }
        setAttendanceLoadingId(targetMatric);
        try {
            setExemptTarget(null); 
            await api.post('/action', { type, matric: targetMatric, sid: activeSession.id, lid: targetLogId, gid: activeGroup.id, remark: reason });
            showToast("Success", "success");
            await refreshSessionData(activeSession.id);
        } catch(e) { showToast(e.message, "error"); }
        setAttendanceLoadingId(null);
    };

    const loadRoster = async () => {
        setViewWithNavigation('roster');
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
        setActionLoading(true);
        try {
            const res = await api.post('/tools/validate', { matric, password: pwd, auto, initiator: user.matric });
            if (res.valid) {
                setRoster(prev => prev.map(s => s.matric === matric ? { ...s, password: res.password, valid: true } : s));
                if (!auto) showToast("Valid! Saved to DB.", "success");
                setActionLoading(false);
                return true;
            } else {
                setRoster(prev => prev.map(s => s.matric === matric ? { ...s, password: auto ? 'Unknown' : pwd, valid: false } : s));
                if (!auto) showToast("Invalid Password", "error");
                setActionLoading(false);
                return false;
            }
        } catch(e) { setActionLoading(false); return false; }
    };

    const startAutoFetch = async () => {
        if (isFetching) { fetchAbort.current = true; return; }
        setIsFetching(true); fetchAbort.current = false;
        const targets = roster.filter(s => !s.valid && s.password !== 'Unknown');
        let count = 0;
        for (let s of targets) {
            if (fetchAbort.current) break;
            count++; setFetchProgress(`${count} / ${targets.length}`);
            await testPassword(s.matric, '', true);
        }
        setIsFetching(false); setFetchProgress('');
    };

    useEffect(() => {
        if (view !== 'roster' && isFetching) { fetchAbort.current = true; setIsFetching(false); }
    }, [view, isFetching]);

    const dropStudent = async (matric, pwd) => {
        if (!await confirm(`Drop ${matric} from ${activeGroup?.code}?`)) return;
        setActionLoading(true);
        try {
            const res = await api.post('/tools/action', {
                action: 'DROP', matric, password: pwd, code: activeGroup.code, cid: activeGroup.id, initiator: user.matric
            });
            if (res.success) {
                showToast("Dropped", "success");
                setRoster(prev => prev.filter(s => s.matric !== matric));
                setActiveGroup(prev => ({...prev, students: Math.max(0, (prev.students || 1) - 1)}));
                if (matric === user.matric) {
                    setLocalUserGroups(prev => prev.filter(gid => gid !== String(activeGroup.id)));
                }
                getDirectory(true).then(setDirectory); 
            } else {
                try {
                    const err = JSON.parse(res.response);
                    showToast(err.message || "Drop Failed", "error");
                } catch { showToast("Drop Failed", "error"); }
            }
        } catch(e) { showToast("Error", "error"); }
        setActionLoading(false);
    };

    const isUserEnrolled = activeGroup ? localUserGroups.includes(String(activeGroup.id)) : false;
    const isAutoRegActive = activeGroup ? localAutoReg.includes(String(activeGroup.id)) : false;

    const toggleAutoRegister = async () => {
        setActionLoading(true);
        try {
            if (isAutoRegActive) {
                const res = await api.post('/action', { type: 'stop_auto_register', matric: user.matric, gid: activeGroup.id });
                showToast(res.msg || "Auto Register Deactivated", "success");
                setLocalAutoReg(prev => prev.filter(gid => gid !== String(activeGroup.id)));
                if (onUpdateAutoReg) onUpdateAutoReg(activeGroup.id, false);
            } else {
                const res = await api.post('/action', { type: 'start_auto_register', matric: user.matric, gid: activeGroup.id });
                showToast(res.msg || "Auto Register Activated", "success");
                setLocalAutoReg(prev => [...prev, String(activeGroup.id)]);
                if (onUpdateAutoReg) onUpdateAutoReg(activeGroup.id, true);
            }
        } catch(e) { showToast("Error connecting", "error"); }
        setActionLoading(false);
    };

    return (
        <div style={{ marginTop: '10px', width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            
            {view !== 'search' && (
                <div style={{ textAlign: 'center', marginBottom: '20px', width: '100%' }}>
                    <button 
                        className="btn" 
                        style={{ borderColor: 'var(--accent)', color: 'var(--accent)', padding: '8px 25px', fontWeight: 'bold' }} 
                        onClick={handleBack}
                    >
                        {'◄ GO BACK'}
                    </button>
                </div>
            )}

            {view === 'search' && (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', paddingBottom: '10px', width: '100%' }}>
                    <div style={{width: '100%', maxWidth: '400px'}}>
                        {/* Search input with OVERLAY dropdown */}
                        <div style={{ position: 'relative', width: '100%' }}>
                            <input type="text" className="t-input" placeholder="Course or Student" 
                                value={searchQuery} onChange={(e) => handleSearch(e.target.value)} 
                                style={{width: '100%', padding: '12px', paddingRight: '40px', paddingLeft: '40px', textAlign: 'center', background: 'rgba(255,255,255,0.05)', color: '#fff'}}/>
                            {searchQuery && (
                                <span 
                                    onClick={() => { setSearchQuery(''); setSearchResults([]); }} 
                                    style={{ position: 'absolute', right: '15px', top: '50%', transform: 'translateY(-50%)', cursor: 'pointer', color: '#888', fontWeight: 'bold', zIndex: 20 }}>
                                    ✕
                                </span>
                            )}
                            {/* Absolute overlay dropdown - does not push content */}
                            {searchResults.length > 0 && (
                                <div style={{ 
                                    position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 200,
                                    background: '#0a0a0a', border: '1px solid var(--primary)',
                                    maxHeight: '50vh', overflowY: 'auto', borderRadius: '0 0 4px 4px',
                                    boxShadow: '0 10px 30px rgba(0,0,0,0.9)'
                                }}>
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
                        
                        {/* Registered courses list */}
                        {user?.courses?.length > 0 && (
                            <div style={{ marginTop: '30px' }}>
                                <div style={{ color: 'var(--primary)', marginBottom: '15px', textAlign: 'center', fontSize: '0.8rem', fontWeight: 'bold' }}>
                                    YOUR REGISTERED COURSES
                                </div>
                                {user.courses.map(g => (
                                    <div key={g.gid} className="course-card" style={{padding: '12px', marginBottom:'10px', display:'block', minHeight: 'auto', borderColor: 'var(--grid-line)'}} 
                                        onClick={() => selectGroup({ id: g.gid, code: g.code, group: g.group, name: g.name })}>
                                        <div style={{display:'flex', justifyContent:'space-between', alignItems: 'center'}}>
                                            <span className="cc-code" style={{color:'#fff', marginBottom:0, fontSize: '0.9rem'}}>{g.code} {g.group}</span>
                                            <span style={{color:'var(--accent)', fontSize:'0.7rem'}}>ID: {g.gid}</span>
                                        </div>
                                        <div className="cc-group" style={{ display: 'flex', justifyContent: 'space-between', marginTop: '5px' }}>
                                            <span style={{fontSize: '0.75rem', color: '#aaa'}}>{g.name}</span>
                                            <span style={{color: 'var(--primary)'}}>Manage {'>'}</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                        
                        {searchResults.length === 0 && !searchQuery && (!user?.courses || user.courses.length === 0) && (
                            <div style={{ marginTop: '30px', textAlign: 'center', color: '#555', fontSize: '0.8rem' }}>
                                Use the search bar to find and register for courses.
                            </div>
                        )}
                    </div>
                </div>
            )}

            {view === 'groups' && (
                <div style={{ width: '100%', maxWidth: '400px' }}>
                    <div style={{color:'var(--primary)', marginBottom:'15px', textAlign:'center', fontSize: '0.9rem'}}>{selectedItem?.n}</div>
                    {!groupList ? <><Skeleton/><Skeleton/></> : groupList.length === 0 ? <div style={{textAlign:'center', color: '#888'}}>NO GROUPS</div> : 
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
                <div style={{ width: '100%', maxWidth: '400px' }}>
                    <div className="tools-hub-header">
                        <div className="hub-title" style={{ fontSize: '1.2rem', marginBottom: '5px'}}>{activeGroup.code} {activeGroup.group}</div>
                        <div className="hub-meta" style={{ marginBottom: '5px'}}>{activeGroup.name} | ID: {activeGroup.id}</div>
                        
                        {/* Timetable text line */}
                        <div style={{ fontSize: '0.72rem', color: 'var(--primary)', marginBottom: '15px', padding: '5px 8px', background: 'rgba(0,243,255,0.05)', borderRadius: '4px' }}>
                            {hubTimetable === null ? <span style={{ color: '#555' }}>Loading...</span> : <span>📅 {hubTimetable}</span>}
                        </div>
                        
                        {!showSelfPrompt ? (
                            <div style={{display:'flex', gap:'10px', justifyContent:'center'}}>
                                {isUserEnrolled ? (
                                    <button className="btn" disabled={actionLoading} style={{borderColor:'#f00', color:'#f00', padding: '8px 16px', opacity: actionLoading ? 0.5 : 1}} onClick={()=>handleSelfAction('DROP')}>
                                        {actionLoading ? 'PROCESSING...' : 'DROP SELF'}
                                    </button>
                                ) : (
                                    <>
                                        <button className="btn" disabled={actionLoading} style={{borderColor:'#0f0', color:'#0f0', padding: '8px 16px', opacity: actionLoading ? 0.5 : 1}} onClick={()=>handleSelfAction('ADD')}>
                                            {actionLoading ? 'PROCESSING...' : 'REGISTER SELF'}
                                        </button>
                                        <button className="btn" disabled={actionLoading} style={{borderColor: isAutoRegActive ? '#f00' : 'var(--primary)', color: isAutoRegActive ? '#f00' : 'var(--primary)', padding: '8px 16px', opacity: actionLoading ? 0.5 : 1}} onClick={toggleAutoRegister}>
                                            {isAutoRegActive ? 'DEACTIVATE' : 'AUTO REG'}
                                        </button>
                                    </>
                                )}
                            </div>
                        ) : (
                            <div style={{display:'flex', gap:'8px', justifyContent:'center', alignItems: 'center'}}>
                                <input type="text" placeholder="UNIMAS Password" value={selfPwdPrompt} onChange={e=>{setSelfPwdPrompt(e.target.value); setSelfPwdTested(false);}} className="t-input" style={{width:'140px', padding:'6px'}} disabled={actionLoading}/>
                                
                                {!selfPwdTested ? (
                                    <button className="btn" disabled={actionLoading || !selfPwdPrompt} style={{borderColor: 'var(--accent)', color: 'var(--accent)', padding: '6px 12px', opacity: actionLoading ? 0.5 : 1}} onClick={handleSelfTest}>
                                        {actionLoading ? 'WAIT' : 'TEST'}
                                    </button>
                                ) : (
                                    <button className="btn" disabled={actionLoading} style={{borderColor: showSelfPrompt==='DROP'?'#f00':'#0f0', padding: '6px 12px', opacity: actionLoading ? 0.5 : 1}} onClick={()=>handleSelfAction(showSelfPrompt, true)}>
                                        {actionLoading ? '...' : showSelfPrompt}
                                    </button>
                                )}
                                
                                <button className="btn" style={{padding: '6px 12px'}} onClick={()=>{setShowSelfPrompt(false); setSelfPwdTested(false);}} disabled={actionLoading}>X</button>
                            </div>
                        )}
                        
                        <div style={{marginTop:'20px', fontSize:'0.8rem', color:'var(--primary)', cursor:'pointer', textDecoration:'underline'}} onClick={loadRoster}>
                            View Enrolled Students - {activeGroup.students || 0} Students
                        </div>
                    </div>

                    <div style={{fontSize:'0.75rem', color:'#888', marginBottom:'10px', marginTop: '20px'}}>SESSION LOGS</div>
                    {!hubSessions ? <><Skeleton type="session-row"/><Skeleton type="session-row"/></> : hubSessions.length === 0 ? <div style={{textAlign:'center', fontSize: '0.8rem', color: '#555', padding: '20px'}}>NO SESSIONS YET</div> :
                        hubSessions.map(s => (
                            <div key={s.id} className="course-card" style={{padding: '12px', marginBottom:'10px', display:'block', borderColor:'var(--grid-line)', minHeight: 'auto'}} onClick={() => loadSession(s)}>
                                <div style={{display:'flex', justifyContent:'space-between'}}>
                                    <span style={{color:'#fff', fontWeight:'bold', fontSize:'0.9rem'}}>{s.date}</span>
                                    <span style={{color:'var(--text-dim)', fontSize:'0.8rem'}}>{s.start} - {s.end}</span>
                                </div>
                                <div style={{fontSize:'0.75rem', color:'#aaa', marginTop:'8px', display: 'flex', justifyContent: 'space-between'}}>
                                    <span>{s.location}</span>
                                    <span style={{color: 'var(--primary)'}}>Manage Attendance {'>'}</span>
                                </div>
                            </div>
                        ))
                    }
                </div>
            )}

            {view === 'session' && activeSession && (() => {
                const nowTime = new Date();
                const todayLocal = nowTime.getFullYear() + '-' + String(nowTime.getMonth() + 1).padStart(2, '0') + '-' + String(nowTime.getDate()).padStart(2, '0');
                const nowMinutes = nowTime.getHours() * 60 + nowTime.getMinutes();
                const parseMins = (tStr) => {
                    if (!tStr) return 0;
                    const match = tStr.match(/(\d+):(\d+) (AM|PM)/i);
                    if (!match) return 0;
                    let h = parseInt(match[1]), m = parseInt(match[2]);
                    if (match[3].toUpperCase() === 'PM' && h < 12) h += 12;
                    if (match[3].toUpperCase() === 'AM' && h === 12) h = 0;
                    return h * 60 + m;
                };
                const sMin = parseMins(activeSession.start);
                const eMin = parseMins(activeSession.end);
                const isSessionNow = activeSession.date === todayLocal && nowMinutes >= sMin && nowMinutes <= eMin;

                return (
                <div style={{ width: '100%', maxWidth: '400px' }}>
                    <div style={{textAlign:'center', marginBottom:'15px', color:'var(--primary)', fontSize: '0.9rem', fontWeight: 'bold'}}>{activeSession.date} ({activeSession.start})</div>
                    <div className="tools-tabs" style={{ marginBottom: '15px' }}>
                        <div className={`tools-tab ${sessionTab === 'present' ? 'active' : ''}`} onClick={()=>setSessionTab('present')}>PRESENT ({masterLogs?.present?.length || 0})</div>
                        <div className={`tools-tab ${sessionTab === 'absent' ? 'active' : ''}`} onClick={()=>setSessionTab('absent')}>ABSENT ({masterLogs?.absent?.length || 0})</div>
                    </div>
                    
                    {exemptTarget && (
                        <div style={{ background: 'rgba(0,0,0,0.9)', padding: '15px', border: '1px solid var(--accent)', borderRadius: '4px', marginBottom: '15px', textAlign: 'center' }}>
                            <div style={{ color: 'var(--accent)', fontSize: '0.8rem', marginBottom: '10px' }}>Exempt Reason for {exemptTarget.matric}:</div>
                            <input type="text" className="t-input" value={exemptReason} onChange={e => setExemptReason(e.target.value)} placeholder="Reason (Optional)..." style={{ width: '100%', marginBottom: '15px', padding: '8px' }}/>
                            <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
                                <button className="btn" style={{ borderColor: 'var(--accent)', color: 'var(--accent)', padding: '6px 15px' }} onClick={() => handleAttendanceAction('exempt', exemptTarget.matric, null, exemptReason)}>CONFIRM</button>
                                <button className="btn" style={{ padding: '6px 15px' }} onClick={() => setExemptTarget(null)}>CANCEL</button>
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
                                            <button className="btn" disabled={attendanceLoadingId === s.matric} style={{borderColor:'#f00', color:'#f00', padding:'4px 10px', opacity: attendanceLoadingId === s.matric ? 0.5 : 1}} onClick={() => handleAttendanceAction('delete', s.matric, s.log_id)}>
                                                {attendanceLoadingId === s.matric ? 'WAIT' : 'DEL'}
                                            </button>
                                        ) : (
                                            <>
                                                {isSessionNow && (
                                                    <button className="btn" disabled={attendanceLoadingId === s.matric} style={{borderColor:'var(--primary)', color:'var(--primary)', padding:'4px 8px', opacity: attendanceLoadingId === s.matric ? 0.5 : 1}} onClick={() => handleAttendanceAction('scan', s.matric, null)}>
                                                        {attendanceLoadingId === s.matric ? '...' : 'SCAN'}
                                                    </button>
                                                )}
                                                <button className="btn" disabled={attendanceLoadingId === s.matric} style={{padding:'4px 8px', opacity: attendanceLoadingId === s.matric ? 0.5 : 1}} onClick={() => handleAttendanceAction('manual', s.matric, null)}>
                                                    {attendanceLoadingId === s.matric ? '...' : 'MAN'}
                                                </button>
                                                <button className="btn" disabled={attendanceLoadingId === s.matric} style={{borderColor:'var(--accent)', color:'var(--accent)', padding:'4px 8px', opacity: attendanceLoadingId === s.matric ? 0.5 : 1}} onClick={() => { setExemptTarget(s); setExemptReason(''); }}>
                                                    {attendanceLoadingId === s.matric ? '...' : 'EXM'}
                                                </button>
                                            </>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
                );
            })()}

            {view === 'roster' && (
                <div style={{ width: '100%', maxWidth: '400px' }}>
                    <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'15px', borderBottom:'1px solid var(--grid-line)', paddingBottom:'10px'}}>
                        <div style={{color:'var(--primary)', fontWeight:'bold', fontSize: '0.9rem'}}>STUDENT LIST</div>
                        <button className="btn" style={{borderColor:'#0f0', color:'#0f0', minWidth:'110px', padding: '6px 12px'}} onClick={startAutoFetch}>
                            {isFetching ? `STOP (${fetchProgress})` : 'AUTO FETCH PWD'}
                        </button>
                    </div>

                    {!roster ? <><Skeleton type="session-row"/><Skeleton type="session-row"/></> : roster.length === 0 ? <div style={{textAlign:'center', fontSize: '0.8rem', color: '#888', padding: '20px'}}>EMPTY CLASS</div> : (
                        <div style={{maxHeight:'60vh', overflowY:'auto'}}>
                            {roster.map(s => (
                                <div key={s.matric} className="master-row">
                                    <img src={`https://studentphotos.unimas.my/${s.matric}.jpg`} className="master-pic" onError={e=>e.target.style.display='none'} alt="Pic"/>
                                    <div className="master-info">
                                        <span className="master-name">{s.name}</span>
                                        <span className="master-matric">{s.matric}</span>
                                    </div>
                                    <div className="master-actions" style={{flexDirection:'column', gap:'5px', alignItems:'center'}}>
                                        <input type="text" className={`pwd-input ${s.password === 'Unknown' ? 'pwd-failed' : ''}`} 
                                            placeholder={s.password === 'Unknown' ? "Failed ❌" : "Password..."} value={s.password === 'Unknown' ? '' : (s.password || '')} 
                                            onChange={(e) => handlePwdChange(s.matric, e.target.value)} 
                                            disabled={actionLoading}
                                        />
                                        <div style={{display:'flex', gap:'5px', width: '100%', justifyContent: 'center'}}>
                                            {s.valid ? (
                                                <button className="btn" disabled={actionLoading} style={{borderColor:'#f00', color:'#f00', padding:'4px 10px', opacity: actionLoading ? 0.5 : 1}} onClick={() => dropStudent(s.matric, s.password)}>
                                                    {actionLoading ? '...' : 'DROP'}
                                                </button>
                                            ) : (
                                                <button className="btn" disabled={actionLoading} style={{borderColor: s.password === 'Unknown' ? '#555' : 'var(--accent)', color: s.password === 'Unknown' ? '#555' : 'var(--accent)', padding:'4px 10px', opacity: actionLoading ? 0.5 : 1}} onClick={() => testPassword(s.matric, s.password)}>
                                                    {s.password === 'Unknown' ? 'SKIP' : (actionLoading ? 'WAIT' : 'TEST')}
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
        </div>
    );
}
