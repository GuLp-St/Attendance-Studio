import React, { useState, useEffect } from 'react';
import { api } from '../services/api';
import { useToast } from '../contexts/ToastContext';
import { useConfirm } from '../contexts/ConfirmContext';

const SwipeableNotification = ({ n, formatMode, fmtDate, onDismiss }) => {
    const [isExpanded, setIsExpanded] = useState(false);
    const [startX, setStartX] = useState(null);
    const [offsetX, setOffsetX] = useState(0);

    const handleTouchStart = (e) => setStartX(e.touches[0].clientX);
    const handleTouchMove = (e) => {
        if (startX !== null) {
            const diff = e.touches[0].clientX - startX;
            if (diff > 0) setOffsetX(diff);
        }
    };
    const handleTouchEnd = () => {
        if (offsetX > 100) {
            onDismiss(n.id);
        } else {
            setOffsetX(0);
        }
        setStartX(null);
    };

    return (
        <div 
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            onClick={() => setIsExpanded(!isExpanded)}
            className={`notif-card ${n.status === 'SUCCESS' ? 'notif-success' : 'notif-fail'}`} 
            style={{ 
                marginBottom: '10px', 
                cursor: 'pointer',
                transform: `translateX(${offsetX}px)`,
                opacity: Math.max(0, 1 - (offsetX / 200)),
                transition: startX !== null ? 'none' : 'transform 0.3s ease, opacity 0.3s ease',
                position: 'relative'
            }}
        >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ fontWeight: 'bold', color: '#fff', flex: 1, paddingRight: '10px' }}>{n.title}</div>
                <div style={{ textAlign: 'right' }}>
                    <div style={{ color: n.status === 'SUCCESS' ? '#0f0' : '#f00', fontSize: '0.8rem', fontWeight: 'bold' }}>{n.status}</div>
                    <div style={{ fontSize: '0.65rem', color: 'var(--primary)', fontWeight: 'bold', marginTop: '2px' }}>{n.mode ? formatMode(n.mode) : 'AUTO'}</div>
                </div>
            </div>
            
            {isExpanded && (
                <div style={{ marginTop: '10px', paddingTop: '10px', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
                    <div style={{ fontSize: '0.8rem', color: '#ccc', marginBottom: '8px', whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: '1.4' }}>{n.details}</div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
                        <div style={{ fontSize: '0.7rem', color: '#888' }}>{n.type?.toUpperCase()}</div>
                        <div style={{ fontSize: '0.7rem', color: '#888' }}>{fmtDate(n.timestamp)}</div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default function SchedulerView({ user, notifications, onDismissNotif, onClearAllNotifs, clearLoading, onCancelJob, onCancelAutoReg, goToTools, actionLoading, onAutoscan, onGlobalRefresh, unreadCount, onMarkHistoryRead }) {
    const { showToast } = useToast();
    const { confirm } = useConfirm();
    const [tab, setTab] = useState('auto-jobs');
    const [arLoading, setArLoading] = useState(null);
    const [actionLoadingGlobal, setActionLoadingGlobal] = useState(false);
    const [localConfig, setLocalConfig] = useState({});

    // Settings State
    const [userSettings, setUserSettings] = useState({
        notif_enabled: false, notif_push_enabled: false, notif_autojobs: false,
        notif_daily: false, notif_class_awareness: false, notif_awareness_time: 30
    });
    const [settingsLoading, setSettingsLoading] = useState(false);
    const [vapidKey, setVapidKey] = useState(null);

    const subscribeToPush = async (vapidPublic) => {
        if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null;
        try {
            const reg = await navigator.serviceWorker.register('/sw.js');
            await navigator.serviceWorker.ready;
            const sub = await reg.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: vapidPublic
            });
            return sub.toJSON();
        } catch (e) { console.error("Push Error", e); return null; }
    };

    useEffect(() => {
        if (tab === 'settings' && !vapidKey && !settingsLoading) {
            setSettingsLoading(true);
            api.get(`/settings?matric=${user.matric}`).then(res => {
                if (res.settings) {
                    setUserSettings(prev => ({ ...prev, ...res.settings }));
                }
                if (res.vapidPublic) setVapidKey(res.vapidPublic);
            }).catch(e => console.error(e))
              .finally(() => setSettingsLoading(false));
        }
    }, [tab, user.matric, vapidKey, settingsLoading]);

    const handleSettingChange = async (key, val) => {
        const newSettings = { ...userSettings, [key]: val };
        setUserSettings(newSettings);
        
        // Immediate visual update, background save
        try {
            await api.post('/settings', { matric: user.matric, ...newSettings });
            if (key === 'notif_push_enabled' && val && vapidKey) {
                const sub = await subscribeToPush(vapidKey);
                if (sub) {
                    await api.post('/subscribe', { matric: user.matric, subscription: sub });
                    showToast("Push Enabled!", "success");
                } else {
                    showToast("Push permission denied/failed.", "error");
                    const noPush = { ...newSettings, notif_push_enabled: false };
                    setUserSettings(noPush);
                    await api.post('/settings', { matric: user.matric, ...noPush });
                }
            } else if (key === 'notif_push_enabled' && !val) {
                showToast("Push Disabled", "info");
            }
        } catch (e) { 
            showToast("Save failed", "error"); 
            setUserSettings(userSettings); // Revert on failure
        }
    };

    useEffect(() => {
        if (tab === 'history' && notifications?.length > 0) {
            if (unreadCount > 0) {
                const latest = Math.max(...notifications.map(n => new Date(n.timestamp).getTime()));
                onMarkHistoryRead(latest);
            }
        }
    }, [notifications, tab, unreadCount, onMarkHistoryRead]);

    const handleTabClick = (tabId) => {
        setTab(tabId);
        if (tabId === 'history') {
            if (onMarkHistoryRead) onMarkHistoryRead(Date.now());
        }
    };

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

    const formatMode = (m) => {
        if (!m) return "";
        // crowd_onetime -> CROWD • ONE TIME
        // time_permanent -> L. MINUTE • PERMANENT
        return m.toUpperCase()
          .replace('TIME_', 'L. MINUTE • ')
          .replace('CROWD_', 'CROWD • ')
          .replace('_ONETIME', ' • ONE TIME')
          .replace('_PERMANENT', ' • PERMANENT')
          .replace(' •  • ', ' • ');
    };



    // --- GLOBAL COURSES ---
    const activateGlobalCourses = async () => {
        const modePayload = `${globalTrigger}_${globalAuto}`;
        if (!await confirm(`Activate ${globalTrigger.toUpperCase()} (${globalAuto.toUpperCase()}) for ALL courses?`)) return;
        setActionLoadingGlobal(true);
        if (onGlobalRefresh) onGlobalRefresh(true, true, modePayload);
        showToast(`Starting all courses...`, "info");

        const inactive = allCourses.filter(c => !c.autoscan_active);
        const requests = inactive.map(c => 
            api.post('/action', { type: 'autoscan', gid: c.gid, matric: user.matric, mode: modePayload, job_type: 'class' }).catch(() => null)
        );
        Promise.all(requests).finally(() => {
            setActionLoadingGlobal(false);
            if (onGlobalRefresh) onGlobalRefresh(true, true, modePayload);
            showToast("Courses triggered", "success");
        });
    };

    const deactivateGlobalCourses = async () => {
        if (!await confirm(`Stop Autoscan for ALL courses?`)) return;
        setActionLoadingGlobal(true);
        if (onGlobalRefresh) onGlobalRefresh(true, false);
        showToast(`Stopping all courses...`, "info");

        const active = allCourses.filter(c => c.autoscan_active);
        const requests = active.map(c => 
            api.post('/action', { type: 'cancel_autoscan', gid: c.gid, matric: user.matric }).catch(() => null)
        );
        Promise.all(requests).finally(() => {
            setActionLoadingGlobal(false);
            if (onGlobalRefresh) onGlobalRefresh(true, false);
            showToast("Courses stopped", "success");
        });
    };

    // --- GLOBAL ACTIVITIES ---
    const activateGlobalActivities = async () => {
        const modePayload = `${globalTrigger}_${globalAuto}`;
        if (!await confirm(`Activate ${globalTrigger.toUpperCase()} (${globalAuto.toUpperCase()}) for ALL activities?`)) return;
        setActionLoadingGlobal(true);
        if (onGlobalRefresh) onGlobalRefresh(false, true, modePayload);
        showToast(`Starting all activities...`, "info");

        const inactive = allOrgs.filter(o => !o.autoscan_active);
        const requests = inactive.map(o => 
            api.post('/action', { type: 'autoscan', gid: o.id, matric: user.matric, mode: modePayload, job_type: 'activity' }).catch(() => null)
        );
        Promise.all(requests).finally(() => {
            setActionLoadingGlobal(false);
            if (onGlobalRefresh) onGlobalRefresh(false, true, modePayload);
            showToast("Activities triggered", "success");
        });
    };

    const deactivateGlobalActivities = async () => {
        if (!await confirm(`Stop Autoscan for ALL activities?`)) return;
        setActionLoadingGlobal(true);
        if (onGlobalRefresh) onGlobalRefresh(false, false);
        showToast(`Stopping all activities...`, "info");

        const active = allOrgs.filter(o => o.autoscan_active);
        const requests = active.map(o => 
            api.post('/action', { type: 'cancel_autoscan', gid: o.id, matric: user.matric }).catch(() => null)
        );
        Promise.all(requests).finally(() => {
            setActionLoadingGlobal(false);
            if (onGlobalRefresh) onGlobalRefresh(false, false);
            showToast("Activities stopped", "success");
        });
    };

    const activateSingleAutoscan = async (gid, mode, isOrg) => {
        if (actionLoadingGlobal || actionLoading) return;
        if (onAutoscan) onAutoscan(gid, isOrg, mode);
    };

    const TABS = [
        { id: 'auto-jobs',   label: 'AUTO JOBS'   },
        { id: 'history',     label: 'NOTIFICATIONS' },
        { id: 'settings',    label: 'SETTINGS' }
    ];

    // Button states
    const canStartAllCourses = allCourses.some(c => !c.autoscan_active);
    const canStopAllCourses = allCourses.some(c => c.autoscan_active);
    const canStartAllActivities = allOrgs.some(o => !o.autoscan_active);
    const canStopAllActivities = allOrgs.some(o => o.autoscan_active);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflowY: 'auto', paddingBottom: '20px', position: 'relative' }}>
            <div style={{ display: 'flex', borderBottom: '1px solid var(--grid-line)', marginBottom: '15px', flexShrink: 0, position: 'sticky', top: 0, zIndex: 10, background: '#050505', paddingTop: '10px' }}>
                {TABS.map(t => (
                    <div key={t.id}
                        onClick={() => handleTabClick(t.id)}
                        style={{
                            flex: 1, textAlign: 'center', padding: '10px 4px',
                            cursor: 'pointer', fontSize: 'clamp(0.6rem, 1.5vw, 0.75rem)', letterSpacing: '1px', whiteSpace: 'nowrap',
                            color: tab === t.id ? 'var(--primary)' : 'var(--text-dim)',
                            borderBottom: tab === t.id ? '2px solid var(--primary)' : 'none',
                            fontWeight: tab === t.id ? 'bold' : 'normal',
                            position: 'relative'
                        }}
                    >
                        {t.label}
                        {t.id === 'history' && unreadCount > 0 && tab !== 'history' && (
                            <span style={{
                                position: 'absolute', top: '5px', right: '5px',
                                background: '#f00', color: '#fff', fontSize: '0.6rem',
                                borderRadius: '50%', width: '14px', height: '14px',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                fontWeight: 'bold'
                            }}>
                                {unreadCount}
                            </span>
                        )}
                    </div>
                ))}
            </div>

            {/* ===== AUTO JOBS TAB ===== */}
            {tab === 'auto-jobs' && (
                <div>
                    {/* ACTIVE AUTO REGISTER JOBS */}
                    {activeAutoRegJobs.map(job => {
                        const gid = typeof job === 'object' ? job.gid : job;
                        const courseCode = typeof job === 'object' ? job.code : 'GID';
                        const courseName = typeof job === 'object' ? (job.name || job.group) : String(gid);

                        return (
                            <div key={gid} style={{ padding: '12px', marginBottom: '8px', borderRadius: '4px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: '1px solid var(--grid-line)' }}>
                                <div>
                                    <div style={{ fontWeight: 'bold', fontSize: '0.9rem', color: '#0f0' }}>{`${courseCode} ${courseName}`}</div>
                                    <div style={{ fontSize: '0.7rem', color: '#0f0', marginTop: '4px' }}>AUTO REGISTERING</div>
                                </div>
                                <button className="btn" disabled={arLoading === gid} style={{ borderColor: '#f00', color: '#f00', fontSize: '0.7rem', padding: '6px 12px', opacity: arLoading === gid ? 0.5 : 1 }} onClick={() => stopAutoRegister(gid, courseCode)}>
                                    {arLoading === gid ? '...' : 'STOP'}
                                </button>
                            </div>
                        );
                    })}

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
                                className="btn" disabled={actionLoadingGlobal || !canStartAllCourses}
                                style={{ borderColor: '#0f0', color: '#0f0', padding: '8px 4px', fontSize: '0.65rem', fontWeight: 'bold', opacity: (actionLoadingGlobal || !canStartAllCourses) ? 0.3 : 1 }}
                                onClick={activateGlobalCourses}
                            >
                                START ALL COURSES
                            </button>
                            <button 
                                className="btn" disabled={actionLoadingGlobal || !canStartAllActivities}
                                style={{ borderColor: '#0f0', color: '#0f0', padding: '8px 4px', fontSize: '0.65rem', fontWeight: 'bold', opacity: (actionLoadingGlobal || !canStartAllActivities) ? 0.3 : 1 }}
                                onClick={activateGlobalActivities}
                            >
                                START ALL ACTIVITIES
                            </button>
                            <button 
                                className="btn" disabled={actionLoadingGlobal || !canStopAllCourses}
                                style={{ borderColor: '#f00', color: '#f00', padding: '8px 4px', fontSize: '0.65rem', fontWeight: 'bold', opacity: (actionLoadingGlobal || !canStopAllCourses) ? 0.3 : 1 }}
                                onClick={deactivateGlobalCourses}
                            >
                                STOP ALL COURSES
                            </button>
                            <button 
                                className="btn" disabled={actionLoadingGlobal || !canStopAllActivities}
                                style={{ borderColor: '#f00', color: '#f00', padding: '8px 4px', fontSize: '0.65rem', fontWeight: 'bold', opacity: (actionLoadingGlobal || !canStopAllActivities) ? 0.3 : 1 }}
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
                                <div>
                                    <div style={{ fontWeight: 'bold', fontSize: '0.85rem' }}>{c.code} {c.name || c.group}</div>
                                    {c.autoscan_active && (
                                        <div style={{ fontSize: '0.6rem', color: 'var(--primary)', marginTop: '2px', fontWeight: 'bold' }}>
                                            {formatMode(c.autoscan_mode)}
                                        </div>
                                    )}
                                </div>
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
                                <div>
                                    <div style={{ fontWeight: 'bold', fontSize: '0.85rem' }}>{o.name}</div>
                                    {o.autoscan_active && (
                                        <div style={{ fontSize: '0.6rem', color: 'var(--accent)', marginTop: '2px', fontWeight: 'bold' }}>
                                            {formatMode(o.autoscan_mode)}
                                        </div>
                                    )}
                                </div>
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

            {/* ===== NOTIFICATIONS TAB ===== */}
            {tab === 'history' && (
                <div style={{ marginTop: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                        <div style={{ fontSize: '0.75rem', color: 'var(--primary)', fontWeight: 'bold' }}>NOTIFICATIONS</div>
                        {notifications.length > 0 && (
                            <button className="btn" disabled={clearLoading} style={{ color: '#888', border: 'none', background: 'transparent', fontSize: '0.65rem', padding: '2px 8px', letterSpacing: '1px', boxShadow: 'none' }} onClick={onClearAllNotifs}>
                                {clearLoading ? 'CLEARING...' : 'CLEAR ALL'}
                            </button>
                        )}
                    </div>
                    {notifications.length === 0 
                        ? <div style={{ textAlign: 'center', color: '#555', fontSize: '0.8rem', padding: '20px' }}>NO NOTIFICATIONS</div> 
                        : notifications.map(n => (
                            <SwipeableNotification 
                                key={n.id} 
                                n={n} 
                                formatMode={formatMode} 
                                fmtDate={fmtDate} 
                                onDismiss={onDismissNotif} 
                            />
                        ))
                    }
                </div>
            )}

            {/* ===== SETTINGS TAB ===== */}
            {tab === 'settings' && (
                <div style={{ padding: '15px', border: '1px solid var(--grid-line)', borderRadius: '6px' }}>
                    <div style={{ fontSize: '0.85rem', fontWeight: 'bold', color: 'var(--primary)', marginBottom: '15px' }}>NOTIFICATION SETTINGS</div>
                    {settingsLoading && !vapidKey ? <div style={{ color: '#888', fontSize: '0.8rem' }}>Loading settings...</div> : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                            <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: '#ccc', fontSize: '0.85rem' }}>
                                <span>Enable Notifications Globally</span>
                                <label className="switch">
                                    <input type="checkbox" checked={userSettings.notif_enabled} onChange={e => handleSettingChange('notif_enabled', e.target.checked)} />
                                    <span className="slider"></span>
                                </label>
                            </label>
                            
                            <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: userSettings.notif_enabled ? '#ccc' : '#555', fontSize: '0.85rem' }}>
                                <span>Enable Push Notification</span>
                                <label className="switch">
                                    <input type="checkbox" disabled={!userSettings.notif_enabled} checked={userSettings.notif_push_enabled} onChange={e => handleSettingChange('notif_push_enabled', e.target.checked)} />
                                    <span className="slider"></span>
                                </label>
                            </label>

                            <hr style={{ borderTop: '1px solid var(--grid-line)', margin: '5px 0' }}/>

                            <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: userSettings.notif_enabled ? '#ccc' : '#555', fontSize: '0.85rem' }}>
                                <span>Autojob Results</span>
                                <label className="switch">
                                    <input type="checkbox" disabled={!userSettings.notif_enabled} checked={userSettings.notif_autojobs} onChange={e => handleSettingChange('notif_autojobs', e.target.checked)} />
                                    <span className="slider"></span>
                                </label>
                            </label>

                            <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: userSettings.notif_enabled ? '#ccc' : '#555', fontSize: '0.85rem' }}>
                                <span>Daily Schedule Reminder</span>
                                <label className="switch">
                                    <input type="checkbox" disabled={!userSettings.notif_enabled} checked={userSettings.notif_daily} onChange={e => handleSettingChange('notif_daily', e.target.checked)} />
                                    <span className="slider"></span>
                                </label>
                            </label>

                            <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: userSettings.notif_enabled ? '#ccc' : '#555', fontSize: '0.85rem' }}>
                                <span>Class Reminder</span>
                                <label className="switch">
                                    <input type="checkbox" disabled={!userSettings.notif_enabled} checked={userSettings.notif_class_awareness} onChange={e => handleSettingChange('notif_class_awareness', e.target.checked)} />
                                    <span className="slider"></span>
                                </label>
                            </label>

                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', opacity: (!userSettings.notif_enabled || !userSettings.notif_class_awareness) ? 0.5 : 1 }}>
                                <span style={{ color: '#ccc', fontSize: '0.85rem' }}>Minutes before class to remind</span>
                                <select 
                                    disabled={!userSettings.notif_enabled || !userSettings.notif_class_awareness}
                                    value={userSettings.notif_awareness_time} 
                                    onChange={e => handleSettingChange('notif_awareness_time', Number(e.target.value))}
                                    className="t-input" style={{ width: '80px', padding: '4px', textAlign: 'center', backgroundColor: '#111', color: '#00f3ff', border: '1px solid #00f3ff', borderRadius: '4px' }}
                                >
                                    <option value={15}>15</option>
                                    <option value={30}>30</option>
                                    <option value={60}>60</option>
                                    <option value={120}>120</option>
                                </select>
                            </div>

                            </div>

                    )}
                </div>
            )}

        </div>
    );
}
