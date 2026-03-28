import React, { useState } from 'react';
import { api } from '../services/api';
import { useToast } from '../contexts/ToastContext';
import { useConfirm } from '../contexts/ConfirmContext';

export default function SchedulerView({ user, notifications, onDismissNotif, onCancelJob, onCancelAutoReg, goToTools, actionLoading, onAutoscan, onGlobalRefresh }) {
    const { showToast } = useToast();
    const { confirm } = useConfirm();
    const [tab, setTab] = useState('jobs');
    const [arLoading, setArLoading] = useState(null);
    const [actionLoadingGlobal, setActionLoadingGlobal] = useState(false);
    const [localConfig, setLocalConfig] = useState({});

    const PillSelect = ({ value, options, onChange }) => (
        <div style={{ display: 'flex', gap: '4px', flex: 1 }}>
            {options.map(o => (
                <button 
                    key={o.value}
                    className="btn"
                    style={{
                        flex: 1, padding: '6px', fontSize: '0.65rem',
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

    // Active Jobs
    const activeClassJobs = user.courses?.filter(c => c.autoscan_active) || [];
    const activeOrgJobs = user.following?.map(id => user.organizerDetails?.[id]).filter(o => o?.autoscan_active) || [];
    const activeAutoRegJobs = (user.auto_register || []);
    const allCourses = user.courses || [];

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

    const activateGlobalAutoscan = async () => {
        const modePayload = `${globalTrigger}_${globalAuto}`;
        if (!await confirm(`Activate ${globalTrigger.toUpperCase()} (${globalAuto.toUpperCase()}) for ALL courses?`)) return;
        setActionLoadingGlobal(true);
        try {
            // We loop through courses that are not already active
            const inactive = allCourses.filter(c => !c.autoscan_active);
            const requests = inactive.map(c => 
                api.post('/action', { type: 'autoscan', gid: c.gid, matric: user.matric, mode: modePayload, job_type: 'class' }).catch(() => null)
            );
            const results = await Promise.all(requests);
            const count = results.filter(r => r !== null).length;
            showToast(`Activated for ${count} courses.`, "success");
            if (onGlobalRefresh) onGlobalRefresh(true);
        } catch (e) {
            showToast("Error activating global scanner", "error");
        }
        setActionLoadingGlobal(false);
    };

    const deactivateGlobalAutoscan = async () => {
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
        } catch (e) {
            showToast("Error deactivating global scanner", "error");
        }
        setActionLoadingGlobal(false);
    };

    const activateSingleAutoscan = async (gid, mode, isOrg) => {
        // Find if another is loading globally
        if (actionLoadingGlobal || actionLoading) return;
        if (onAutoscan) onAutoscan(gid, isOrg, mode);
    };

    // Global mode selection state
    const [globalTrigger, setGlobalTrigger] = useState('crowd');
    const [globalAuto, setGlobalAuto] = useState('onetime');

    return (
        <div style={{ paddingBottom: '20px' }}>
            <div style={{ display: 'flex', borderBottom: '1px solid var(--grid-line)', marginBottom: '15px' }}>
                {['jobs', 'config', 'logs'].map(t => (
                    <div key={t}
                        onClick={() => setTab(t)}
                        style={{
                            flex: 1, textAlign: 'center', padding: '10px 8px',
                            cursor: 'pointer', fontSize: '0.75rem', letterSpacing: '1px',
                            color: tab === t ? 'var(--primary)' : 'var(--text-dim)',
                            borderBottom: tab === t ? '2px solid var(--primary)' : 'none',
                            fontWeight: tab === t ? 'bold' : 'normal'
                        }}
                    >
                        {t.toUpperCase()}
                    </div>
                ))}
            </div>

            {/* ===== JOBS TAB ===== */}
            {tab === 'jobs' && (
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

                    <div style={{ marginTop: '20px', textAlign: 'center' }}>
                        <button className="btn" style={{ borderColor: '#0f0', color: '#0f0', padding: '10px 20px', fontSize: '0.8rem', fontWeight: 'bold' }} onClick={goToTools}>
                            + NEW AUTO REGISTER JOB (COURSE HUB)
                        </button>
                    </div>
                </div>
            )}

            {/* ===== CONFIG TAB ===== */}
            {tab === 'config' && (
                <div>
                    <div style={{ padding: '15px', border: '1px solid var(--grid-line)', borderRadius: '6px', marginBottom: '20px' }}>
                        <div style={{ fontSize: '0.85rem', fontWeight: 'bold', color: 'var(--primary)', marginBottom: '10px' }}>GLOBAL AUTOSCAN</div>
                        <div style={{ fontSize: '0.75rem', color: '#aaa', marginBottom: '15px' }}>Activate autoscan for all registered courses at once.</div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '15px' }}>
                            <PillSelect 
                                value={globalTrigger} 
                                onChange={setGlobalTrigger}
                                options={[{value:'crowd', label:'CROWD'}, {value:'time', label:'LAST MINUTE'}]}
                            />
                            <PillSelect 
                                value={globalAuto} 
                                onChange={setGlobalAuto}
                                options={[{value:'onetime', label:'ONE TIME'}, {value:'permanent', label:'PERMANENT'}]}
                            />
                        </div>
                        <div style={{ display: 'flex', gap: '10px' }}>
                            <button 
                                className="btn" 
                                disabled={actionLoadingGlobal}
                                style={{ flex: 1, borderColor: '#0f0', color: '#0f0', padding: '12px', fontWeight: 'bold', opacity: actionLoadingGlobal ? 0.5 : 1 }}
                                onClick={activateGlobalAutoscan}
                            >
                                {actionLoadingGlobal ? 'PROCESSING...' : 'ENABLE FOR ALL'}
                            </button>
                            <button 
                                className="btn" 
                                disabled={actionLoadingGlobal}
                                style={{ flex: 1, borderColor: '#f00', color: '#f00', padding: '12px', fontWeight: 'bold', opacity: actionLoadingGlobal ? 0.5 : 1 }}
                                onClick={deactivateGlobalAutoscan}
                            >
                                {actionLoadingGlobal ? 'PROCESSING...' : 'DISABLE FOR ALL'}
                            </button>
                        </div>
                    </div>

                    <div style={{ fontSize: '0.75rem', color: 'var(--primary)', marginBottom: '10px', fontWeight: 'bold' }}>INDIVIDUAL CONFIGURATION</div>
                    {allCourses.length === 0 && <div style={{ color: '#555', fontSize: '0.8rem', textAlign: 'center', padding: '20px' }}>No courses registered.</div>}
                    
                    {allCourses.map(c => (
                        <div key={c.gid} style={{ padding: '12px', border: '1px solid var(--grid-line)', borderRadius: '4px', marginBottom: '10px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
                                <div style={{ fontWeight: 'bold' }}>{c.code} {c.group}</div>
                                <div style={{ fontSize: '0.7rem', color: c.autoscan_active ? '#0f0' : '#888' }}>
                                    {c.autoscan_active ? 'ACTIVE' : 'INACTIVE'}
                                </div>
                            </div>
                            
                            {!c.autoscan_active && (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
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
                                    <button 
                                        className="btn" 
                                        disabled={actionLoading === `autoscan_${c.gid}`}
                                        style={{ width: '100%', borderColor: 'var(--accent)', color: 'var(--accent)', padding: '8px', marginTop: '4px', opacity: actionLoading === `autoscan_${c.gid}` ? 0.5 : 1 }} 
                                        onClick={() => activateSingleAutoscan(c.gid, `${localConfig[c.gid]?.trigger || 'crowd'}_${localConfig[c.gid]?.auto || 'onetime'}`, false)}
                                    >
                                        {actionLoading === `autoscan_${c.gid}` ? '[ PROCESSING... ]' : 'ACTIVATE AUTOSCAN'}
                                    </button>
                                </div>
                            )}
                            {c.autoscan_active && (
                                <button 
                                    className="btn" 
                                    disabled={actionLoading === `cancel_autoscan_${c.gid}`}
                                    style={{ width: '100%', borderColor: '#f00', color: '#f00', padding: '8px', opacity: actionLoading === `cancel_autoscan_${c.gid}` ? 0.5 : 1 }} 
                                    onClick={() => onCancelJob(c.gid, false)}
                                >
                                    {actionLoading === `cancel_autoscan_${c.gid}` ? '[ PROCESSING... ]' : 'DEACTIVATE AUTOSCAN'}
                                </button>
                            )}
                        </div>
                    ))}
                </div>
            )}

            {/* ===== LOGS TAB ===== */}
            {tab === 'logs' && (
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
