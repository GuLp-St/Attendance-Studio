import React, { useState } from 'react';
import { api } from '../services/api';
import { useToast } from '../contexts/ToastContext';
import { useConfirm } from '../contexts/ConfirmContext';

export default function SchedulerView({ user, notifications, onDismissNotif, onCancelJob, onCancelAutoReg, goToTools, actionLoading, onAutoscan, onGlobalRefresh }) {
    const { showToast } = useToast();
    const { confirm } = useConfirm();
    const [tab, setTab] = useState('active-jobs');
    const [arLoading, setArLoading] = useState(null);
    const [actionLoadingGlobal, setActionLoadingGlobal] = useState(false);
    const [localConfig, setLocalConfig] = useState({});

    // Global mode selection state
    const [globalTrigger, setGlobalTrigger] = useState('crowd');
    const [globalAuto, setGlobalAuto] = useState('onetime');

    const PillSelect = ({ value, options, onChange }) => (
        <div style={{ display: 'flex', gap: '4px', flex: 1 }}>
            {options.map(o => (
                <button 
                    key={o.value}
                    className="btn"
                    style={{
                        flex: 1, padding: '4px', fontSize: '0.6rem',
                        borderColor: value === o.value ? 'var(--primary)' : 'var(--grid-line)',
                        color: value === o.value ? 'var(--primary)' : '#888',
                        background: value === o.value ? 'rgba(0, 243, 255, 0.1)' : 'transparent'
                    }}
                    onClick={() => onChange(o.value)}
                >
                    {o.label}
                </button>
            ))}
        </div>
    );

    const fmtDate = (iso) => {
        const d = new Date(iso);
        return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}`;
    };

    const allCourses = user.courses || [];
    const allOrgs = user.following?.map(id => user.organizerDetails?.[id]).filter(Boolean) || [];
    
    // Active Jobs
    const activeClassJobs = allCourses.filter(c => c.autoscan_active);
    const activeOrgJobs = allOrgs.filter(o => o.autoscan_active);
    const activeAutoRegJobs = (user.auto_register || []);

    const stopAutoRegister = async (gid, code) => {
        if (!await confirm(`Stop Auto Register for ${code}?`)) return;
        setArLoading(gid);
        try {
            await api.post('/action', { type: 'stop_auto_register', gid: String(gid), matric: user.matric });
            showToast("Auto Register stopped", "success");
            if (onCancelAutoReg) onCancelAutoReg(gid);
        } catch (e) { showToast(e.message, "error"); }
        setArLoading(null);
    };

    // --- GLOBAL COURSES ---
    const activateGlobalCourses = async () => {
        const modePayload = `${globalTrigger}_${globalAuto}`;
        if (!await confirm(`Activate ${globalTrigger.toUpperCase()} (${globalAuto.toUpperCase()}) for ALL courses?`)) return;
        setActionLoadingGlobal(true);
        try {
            const inactive = allCourses.filter(c => !c.autoscan_active);
            const requests = inactive.map(c => 
                api.post('/action', { type: 'autoscan', gid: c.gid, matric: user.matric, mode: modePayload, job_type: 'class' }).catch(() => null)
            );
            const results = await Promise.all(requests);
            const count = results.filter(r => r !== null).length;
            showToast(`Activated for ${count} courses.`, "success");
            if (onGlobalRefresh) onGlobalRefresh(true);
        } catch (e) { showToast("Error activating global scanner", "error"); }
        setActionLoadingGlobal(false);
    };

    const deactivateGlobalCourses = async () => {
        if (!await confirm(`Stop Autoscan for ALL courses?`)) return;
        setActionLoadingGlobal(true);
        try {
            const active = allCourses.filter(c => c.autoscan_active);
            const requests = active.map(c => 
                api.post('/action', { type: 'cancel_autoscan', gid: c.gid, matric: user.matric }).catch(() => null)
            );
            const results = await Promise.all(requests);
            const count = results.filter(r => r !== null).length;
            showToast(`Deactivated for ${count} courses.`, "success");
            if (onGlobalRefresh) onGlobalRefresh(false);
        } catch (e) { showToast("Error deactivating global scanner", "error"); }
        setActionLoadingGlobal(false);
    };

    // --- GLOBAL ACTIVITIES ---
    const activateGlobalActivities = async () => {
        const modePayload = `${globalTrigger}_${globalAuto}`;
        if (!await confirm(`Activate ${globalTrigger.toUpperCase()} (${globalAuto.toUpperCase()}) for ALL activities?`)) return;
        setActionLoadingGlobal(true);
        try {
            const inactive = allOrgs.filter(o => !o.autoscan_active);
            const requests = inactive.map(o => 
                api.post('/action', { type: 'autoscan', gid: o.id, matric: user.matric, mode: modePayload, job_type: 'activity' }).catch(() => null)
            );
            const results = await Promise.all(requests);
            const count = results.filter(r => r !== null).length;
            showToast(`Activated for ${count} activities.`, "success");
            if (onGlobalRefresh) onGlobalRefresh(true);
        } catch (e) { showToast("Error activating global scanner", "error"); }
        setActionLoadingGlobal(false);
    };

    const deactivateGlobalActivities = async () => {
        if (!await confirm(`Stop Autoscan for ALL activities?`)) return;
        setActionLoadingGlobal(true);
        try {
            const active = allOrgs.filter(o => o.autoscan_active);
            const requests = active.map(o => 
                api.post('/action', { type: 'cancel_autoscan', gid: o.id, matric: user.matric }).catch(() => null)
            );
            const results = await Promise.all(requests);
            const count = results.filter(r => r !== null).length;
            showToast(`Deactivated for ${count} activities.`, "success");
            if (onGlobalRefresh) onGlobalRefresh(false);
        } catch (e) { showToast("Error deactivating global scanner", "error"); }
        setActionLoadingGlobal(false);
    };

    const activateSingleAutoscan = async (gid, mode, isOrg) => {
        if (actionLoadingGlobal || actionLoading) return;
        if (onAutoscan) onAutoscan(gid, isOrg, mode);
    };

    const TABS = [
        { id: 'active-jobs', label: 'ACTIVE JOBS' },
        { id: 'auto-jobs',   label: 'AUTO JOBS'   },
        { id: 'history',     label: 'HISTORY'     },
    ];

    return (
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflowY: 'auto', paddingBottom: '20px' }}>
            <div style={{ display: 'flex', borderBottom: '1px solid var(--grid-line)', marginBottom: '15px', flexShrink: 0 }}>
                {TABS.map(t => (
                    <div key={t.id}
                        onClick={() => setTab(t.id)}
                        style={{
                            flex: 1, textAlign: 'center', padding: '10px 4px',
                            cursor: 'pointer', fontSize: 'clamp(0.6rem, 1.5vw, 0.75rem)', letterSpacing: '1px', whiteSpace: 'nowrap',
                            color: tab === t.id ? 'var(--primary)' : 'var(--text-dim)',
                            borderBottom: tab === t.id ? '2px solid var(--primary)' : 'none',
                            fontWeight: tab === t.id ? 'bold' : 'normal'
                        }}
                    >
                        {t.label}
                    </div>
                ))}
            </div>

            {/* ===== ACTIVE JOBS TAB ===== */}
            {tab === 'active-jobs' && (
                <div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--primary)', marginBottom: '10px', fontWeight: 'bold' }}>ACTIVE JOBS</div>
                    {activeClassJobs.length === 0 && activeOrgJobs.length === 0 && activeAutoRegJobs.length === 0 && (
                        <div style={{ textAlign: 'center', color: '#555', fontSize: '0.75rem', padding: '20px', border: '1px dashed #333' }}>NO ACTIVE JOBS</div>
                    )}
                    {activeClassJobs.map(c => (
                        <div key={c.gid} style={{ padding: '12px', border: '1px solid var(--grid-line)', borderRadius: '4px', marginBottom: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div>
                                <div style={{ fontWeight: 'bold', fontSize: '0.9rem', color: 'var(--primary)' }}>{c.code} {c.group}</div>
                                <div style={{ fontSize: '0.7rem', color: 'var(--primary)', marginTop: '4px' }}>Class Autoscan Active</div>
                            </div>
                            <button className="btn" disabled={actionLoading === `cancel_autoscan_${c.gid}`} style={{ borderColor: '#f00', color: '#f00', fontSize: '0.7rem', padding: '6px 12px', opacity: actionLoading === `cancel_autoscan_${c.gid}` ? 0.5 : 1 }} onClick={() => onCancelJob(c.gid, false)}>
                                {actionLoading === `cancel_autoscan_${c.gid}` ? '...' : 'STOP'}
                            </button>
                        </div>
                    ))}
                    {activeOrgJobs.map(o => (
                        <div key={o.id} style={{ padding: '12px', border: '1px solid var(--grid-line)', borderRadius: '4px', marginBottom: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div>
                                <div style={{ fontWeight: 'bold', fontSize: '0.9rem', color: 'var(--accent)' }}>{o.name}</div>
                                <div style={{ fontSize: '0.7rem', color: 'var(--accent)', marginTop: '4px' }}>Activity Autoscan Active</div>
                            </div>
                            <button className="btn" disabled={actionLoading === `cancel_autoscan_${o.id}`} style={{ borderColor: '#f00', color: '#f00', fontSize: '0.7rem', padding: '6px 12px', opacity: actionLoading === `cancel_autoscan_${o.id}` ? 0.5 : 1 }} onClick={() => onCancelJob(o.id, true)}>
                                {actionLoading === `cancel_autoscan_${o.id}` ? '...' : 'STOP'}
                            </button>
                        </div>
                    ))}
                    {activeAutoRegJobs.map(gid => {
                        const course = allCourses.find(c => String(c.gid) === String(gid));
                        return (
                            <div key={gid} className="job-manager-row" style={{ padding: '12px', marginBottom: '8px', border: '1px solid #0f0', borderRadius: '4px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background:'rgba(0,255,0,0.03)' }}>
                                <div>
                                    <div style={{ fontWeight: 'bold', fontSize: '0.9rem', color: '#0f0' }}>{course ? `${course.code} ${course.group}` : `GID: ${gid}`}</div>
                                    <div style={{ fontSize: '0.7rem', color: '#0f0', marginTop: '4px' }}>Auto Register Active</div>
                                </div>
                                <button className="btn" disabled={arLoading === gid} style={{ borderColor: '#f00', color: '#f00', fontSize: '0.7rem', padding: '6px 12px', opacity: arLoading === gid ? 0.5 : 1 }} onClick={() => stopAutoRegister(gid, course?.code || gid)}>
                                    {arLoading === gid ? '...' : 'STOP'}
                                </button>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* ===== AUTO JOBS TAB ===== */}
            {tab === 'auto-jobs' && (
                <div>
                    {/* AUTO REGISTER COURSEHUB REDIRECT */}
                    <div style={{ marginBottom: '20px' }}>
                        <button className="btn" style={{ width: '100%', borderColor: '#0f0', color: '#0f0', padding: '12px', fontSize: '0.8rem', fontWeight: 'bold' }} onClick={goToTools}>
                            + FIND COURSE TO AUTOREGISTER (COURSEHUB)
                        </button>
                    </div>

                    {/* GLOBAL CONFIGURATION */}
                    <div style={{ padding: '15px', border: '1px solid var(--grid-line)', borderRadius: '6px', marginBottom: '20px' }}>
                        <div style={{ fontSize: '0.85rem', fontWeight: 'bold', color: 'var(--primary)', marginBottom: '10px' }}>GLOBAL CONFIGURATION</div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '15px' }}>
                            <PillSelect 
                                value={globalTrigger} 
                                onChange={setGlobalTrigger}
                                options={[{value:'crowd', label:'CROWD'}, {value:'time', label:'L. MINUTE'}]}
                            />
                            <PillSelect 
                                value={globalAuto} 
                                onChange={setGlobalAuto}
                                options={[{value:'onetime', label:'ONE TIME'}, {value:'permanent', label:'PERMANENT'}]}
                            />
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                            <button 
                                className="btn" disabled={actionLoadingGlobal}
                                style={{ borderColor: '#0f0', color: '#0f0', padding: '8px 4px', fontSize: '0.65rem', fontWeight: 'bold', opacity: actionLoadingGlobal ? 0.5 : 1 }}
                                onClick={activateGlobalCourses}
                            >
                                START ALL COURSES
                            </button>
                            <button 
                                className="btn" disabled={actionLoadingGlobal}
                                style={{ borderColor: '#0f0', color: '#0f0', padding: '8px 4px', fontSize: '0.65rem', fontWeight: 'bold', opacity: actionLoadingGlobal ? 0.5 : 1 }}
                                onClick={activateGlobalActivities}
                            >
                                START ALL ACTIVITIES
                            </button>
                            <button 
                                className="btn" disabled={actionLoadingGlobal}
                                style={{ borderColor: '#f00', color: '#f00', padding: '8px 4px', fontSize: '0.65rem', fontWeight: 'bold', opacity: actionLoadingGlobal ? 0.5 : 1 }}
                                onClick={deactivateGlobalCourses}
                            >
                                STOP ALL COURSES
                            </button>
                            <button 
                                className="btn" disabled={actionLoadingGlobal}
                                style={{ borderColor: '#f00', color: '#f00', padding: '8px 4px', fontSize: '0.65rem', fontWeight: 'bold', opacity: actionLoadingGlobal ? 0.5 : 1 }}
                                onClick={deactivateGlobalActivities}
                            >
                                STOP ALL ACTIVITIES
                            </button>
                        </div>
                    </div>

                    {/* REGISTERED COURSES LIST */}
                    <div style={{ fontSize: '0.75rem', color: 'var(--primary)', marginBottom: '10px', fontWeight: 'bold' }}>REGISTERED COURSES</div>
                    {allCourses.length === 0 && <div style={{ color: '#555', fontSize: '0.8rem', textAlign: 'center', padding: '20px' }}>No courses registered.</div>}
                    
                    {allCourses.map(c => (
                        <div key={c.gid} style={{ padding: '10px', border: '1px solid var(--grid-line)', borderRadius: '4px', marginBottom: '8px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: c.autoscan_active ? '0' : '8px' }}>
                                <div style={{ fontWeight: 'bold', fontSize: '0.85rem' }}>{c.code} {c.group}</div>
                                {c.autoscan_active ? (
                                    <button 
                                        className="btn" 
                                        disabled={actionLoading === `cancel_autoscan_${c.gid}`}
                                        style={{ borderColor: '#f00', color: '#f00', padding: '4px 10px', fontSize: '0.65rem', opacity: actionLoading === `cancel_autoscan_${c.gid}` ? 0.5 : 1 }} 
                                        onClick={() => onCancelJob(c.gid, false)}
                                    >
                                        STOP
                                    </button>
                                ) : (
                                    <span style={{ fontSize: '0.65rem', color: '#888' }}>INACTIVE</span>
                                )}
                            </div>
                            
                            {!c.autoscan_active && (
                                <div style={{ display: 'flex', gap: '8px', alignItems: 'stretch' }}>
                                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                        <div style={{ display: 'flex', gap: '4px', height: '100%' }}>
                                            <PillSelect 
                                                value={localConfig[c.gid]?.trigger || 'crowd'} 
                                                onChange={(v) => setLocalConfig({...localConfig, [c.gid]: {...(localConfig[c.gid]||{}), trigger: v}})}
                                                options={[{value:'crowd', label:'CROWD'}, {value:'time', label:'L. MINUTE'}]}
                                            />
                                            <PillSelect 
                                                value={localConfig[c.gid]?.auto || 'onetime'} 
                                                onChange={(v) => setLocalConfig({...localConfig, [c.gid]: {...(localConfig[c.gid]||{}), auto: v}})}
                                                options={[{value:'onetime', label:'ONE TIME'}, {value:'permanent', label:'PERMANENT'}]}
                                            />
                                        </div>
                                    </div>
                                    <button 
                                        className="btn" 
                                        disabled={actionLoading === `autoscan_${c.gid}`}
                                        style={{ borderColor: 'var(--accent)', color: 'var(--accent)', padding: '0 12px', fontSize: '0.65rem', display: 'flex', alignItems: 'center', opacity: actionLoading === `autoscan_${c.gid}` ? 0.5 : 1 }} 
                                        onClick={() => activateSingleAutoscan(c.gid, `${localConfig[c.gid]?.trigger || 'crowd'}_${localConfig[c.gid]?.auto || 'onetime'}`, false)}
                                    >
                                        START
                                    </button>
                                </div>
                            )}
                        </div>
                    ))}

                    {/* FOLLOWED ACTIVITIES LIST */}
                    <div style={{ fontSize: '0.75rem', color: 'var(--accent)', marginTop: '20px', marginBottom: '10px', fontWeight: 'bold' }}>FOLLOWED ACTIVITIES</div>
                    {allOrgs.length === 0 && <div style={{ color: '#555', fontSize: '0.8rem', textAlign: 'center', padding: '20px' }}>No followed activities.</div>}
                    
                    {allOrgs.map(o => (
                        <div key={o.id} style={{ padding: '10px', border: '1px solid var(--grid-line)', borderRadius: '4px', marginBottom: '8px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: o.autoscan_active ? '0' : '8px' }}>
                                <div style={{ fontWeight: 'bold', fontSize: '0.85rem' }}>{o.name}</div>
                                {o.autoscan_active ? (
                                    <button 
                                        className="btn" 
                                        disabled={actionLoading === `cancel_autoscan_${o.id}`}
                                        style={{ borderColor: '#f00', color: '#f00', padding: '4px 10px', fontSize: '0.65rem', opacity: actionLoading === `cancel_autoscan_${o.id}` ? 0.5 : 1 }} 
                                        onClick={() => onCancelJob(o.id, true)}
                                    >
                                        STOP
                                    </button>
                                ) : (
                                    <span style={{ fontSize: '0.65rem', color: '#888' }}>INACTIVE</span>
                                )}
                            </div>
                            
                            {!o.autoscan_active && (
                                <div style={{ display: 'flex', gap: '8px', alignItems: 'stretch' }}>
                                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                        <div style={{ display: 'flex', gap: '4px', height: '100%' }}>
                                            <PillSelect 
                                                value={localConfig[o.id]?.trigger || 'crowd'} 
                                                onChange={(v) => setLocalConfig({...localConfig, [o.id]: {...(localConfig[o.id]||{}), trigger: v}})}
                                                options={[{value:'crowd', label:'CROWD'}, {value:'time', label:'L. MINUTE'}]}
                                            />
                                            <PillSelect 
                                                value={localConfig[o.id]?.auto || 'onetime'} 
                                                onChange={(v) => setLocalConfig({...localConfig, [o.id]: {...(localConfig[o.id]||{}), auto: v}})}
                                                options={[{value:'onetime', label:'ONE TIME'}, {value:'permanent', label:'PERMANENT'}]}
                                            />
                                        </div>
                                    </div>
                                    <button 
                                        className="btn" 
                                        disabled={actionLoading === `autoscan_${o.id}`}
                                        style={{ borderColor: 'var(--accent)', color: 'var(--accent)', padding: '0 12px', fontSize: '0.65rem', display: 'flex', alignItems: 'center', opacity: actionLoading === `autoscan_${o.id}` ? 0.5 : 1 }} 
                                        onClick={() => activateSingleAutoscan(o.id, `${localConfig[o.id]?.trigger || 'crowd'}_${localConfig[o.id]?.auto || 'onetime'}`, true)}
                                    >
                                        START
                                    </button>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}

            {/* ===== HISTORY TAB ===== */}
            {tab === 'history' && (
                <div style={{ marginTop: 0 }}>
                    <div style={{ fontSize: '0.75rem', color: 'var(--primary)', marginBottom: '10px', fontWeight: 'bold' }}>NOTIFICATION LOGS</div>
                    {notifications.length === 0 
                        ? <div style={{ textAlign: 'center', color: '#555', fontSize: '0.8rem', padding: '20px' }}>NO LOGS</div> 
                        : notifications.map(n => (
                            <div key={n.id} className={`notif-card ${n.status === 'SUCCESS' ? 'notif-success' : 'notif-fail'}`} onClick={() => onDismissNotif(n.id)} style={{ marginBottom: '10px', cursor: 'pointer' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}>
                                    <span style={{ fontWeight: 'bold', color: '#fff' }}>{n.title}</span>
                                    <span style={{ color: n.status === 'SUCCESS' ? '#0f0' : '#f00', fontSize: '0.8rem', fontWeight: 'bold' }}>{n.status}</span>
                                </div>
                                <div style={{ fontSize: '0.8rem', color: '#ccc', marginBottom: '8px' }}>{n.details}</div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
                                    <div style={{ fontSize: '0.7rem', color: 'var(--primary)' }}>{n.type?.toUpperCase()} • {n.mode?.toUpperCase() || 'AUTO'} MODE</div>
                                    <div style={{ fontSize: '0.7rem', color: '#888' }}>{fmtDate(n.timestamp)}</div>
                                </div>
                            </div>
                        ))
                    }
                </div>
            )}
        </div>
    );
}
