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

export default function SchedulerView({ user, notifications, onDismissNotif, onClearAllNotifs, onCancelJob, onCancelAutoReg, goToTools, actionLoading, onAutoscan, onGlobalRefresh }) {
    const { showToast } = useToast();
    const { confirm } = useConfirm();
    const [tab, setTab] = useState('auto-jobs');
    const [arLoading, setArLoading] = useState(null);
    const [actionLoadingGlobal, setActionLoadingGlobal] = useState(false);
    const [localConfig, setLocalConfig] = useState({});

    // Notification Unread Logic
    const [lastReadNotif, setLastReadNotif] = useState(() => {
        return parseInt(localStorage.getItem('atd_last_read_notif') || '0');
    });

    const unreadCount = notifications ? notifications.filter(n => new Date(n.timestamp).getTime() > lastReadNotif).length : 0;

    useEffect(() => {
        if (tab === 'history' && notifications?.length > 0) {
            const latest = Math.max(...notifications.map(n => new Date(n.timestamp).getTime()));
            if (latest > lastReadNotif) {
                setLastReadNotif(latest);
                localStorage.setItem('atd_last_read_notif', String(latest));
            }
        }
    }, [notifications, tab, lastReadNotif]);

    const handleTabClick = (tabId) => {
        setTab(tabId);
        if (tabId === 'history') {
            const now = Date.now();
            setLastReadNotif(now);
            localStorage.setItem('atd_last_read_notif', String(now));
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

    // --- TELEGRAM STATE ---
    const [tgStatus, setTgStatus] = useState(null); // null = loading
    const [tgPhone, setTgPhone] = useState('');
    const [tgLoading, setTgLoading] = useState(false);
    const [tgFeatures, setTgFeatures] = useState({ notify_autojobs: true, notify_morning_schedule: true, notify_class_awareness: true });

    useEffect(() => {
        if (tab === 'telegram') loadTgStatus();
    }, [tab]);

    const loadTgStatus = async () => {
        setTgStatus(null);
        try {
            const res = await api.get(`/telegram/status?matric=${user.matric}`);
            setTgStatus(res);
            if (res.phone) setTgPhone(res.phone);
            else if (res.hp_tetap) setTgPhone(res.hp_tetap);
            if (res.features && Object.keys(res.features).length > 0) setTgFeatures(res.features);
        } catch(e) {
            setTgStatus({ enabled: false, chat_id: null, features: {} });
        }
    };

    const saveTgFeatures = async (newFeats) => {
        if (!tgStatus?.enabled) return;
        try {
            await api.post('/telegram/setup', { matric: user.matric, phone: tgPhone, features: newFeats });
        } catch(e) {}
    };

    const enableTelegram = async () => {
        setTgLoading(true);
        try {
            const res = await api.post('/telegram/setup', { matric: user.matric, phone: tgPhone, features: tgFeatures });
            if (res.error) { showToast(res.error, 'error'); return; }
            if (res.deep_link) {
                showToast('Telegram enabled! Click the button to link your account.', 'success');
            } else {
                showToast('Telegram enabled! No bot configured yet — ask your admin.', 'info');
            }
            await loadTgStatus();
        } catch(e) { showToast(e.message, 'error'); }
        setTgLoading(false);
    };

    const disableTelegram = async () => {
        if (!await confirm('Disconnect Telegram? You will stop receiving notifications.')) return;
        setTgLoading(true);
        try {
            await api.post('/telegram/disable', { matric: user.matric });
            showToast('Telegram disconnected.', 'success');
            await loadTgStatus();
        } catch(e) { showToast(e.message, 'error'); }
        setTgLoading(false);
    };

    const toggleTgFeature = async (key) => {
        const newFeats = { ...tgFeatures, [key]: !tgFeatures[key] };
        setTgFeatures(newFeats);
        await saveTgFeatures(newFeats);
    };

    const TelegramTab = () => {
        if (tgStatus === null) return <div style={{ textAlign: 'center', padding: '40px', color: '#888' }}>Loading...</div>;

        const isEnabled = tgStatus.enabled;
        const isLinked = isEnabled && !!tgStatus.chat_id;
        const deepLink = tgStatus.bot_username ? `https://t.me/${tgStatus.bot_username}?start=${user.matric}` : null;

        const FeatureToggle = ({ label, icon, desc, featureKey }) => (
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px', border: '1px solid var(--grid-line)', borderRadius: '6px', marginBottom: '8px', opacity: tgLoading ? 0.6 : 1 }}>
                <div style={{ fontSize: '1.2rem' }}>{icon}</div>
                <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '0.8rem', fontWeight: 'bold', color: '#fff' }}>{label}</div>
                    <div style={{ fontSize: '0.65rem', color: '#888', marginTop: '2px' }}>{desc}</div>
                </div>
                <div
                    onClick={() => !tgLoading && toggleTgFeature(featureKey)}
                    style={{ 
                        width: '36px', height: '20px', borderRadius: '10px', cursor: 'pointer',
                        background: tgFeatures[featureKey] ? 'var(--primary)' : 'var(--grid-line)',
                        position: 'relative', transition: 'background 0.2s', flexShrink: 0
                    }}
                >
                    <div style={{
                        position: 'absolute', top: '3px',
                        left: tgFeatures[featureKey] ? '19px' : '3px',
                        width: '14px', height: '14px', borderRadius: '50%',
                        background: '#fff', transition: 'left 0.2s'
                    }} />
                </div>
            </div>
        );

        return (
            <div>
                {/* HEADER */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px', padding: '15px', background: 'rgba(0,243,255,0.05)', borderRadius: '8px', border: '1px solid rgba(0,243,255,0.2)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#0088cc' }}>
                        <svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                            <path d="M12 0C5.372 0 0 5.373 0 12C0 18.627 5.372 24 12 24C18.628 24 24 18.627 24 12C24 5.373 18.628 0 12 0ZM17.653 8.355C17.382 11.233 16.208 18.158 15.602 20.902C15.346 22.064 14.887 22.456 14.444 22.495C13.468 22.581 12.727 21.848 11.782 21.229C10.303 20.262 9.467 19.658 8.032 18.718C6.375 17.632 7.449 17.034 8.396 16.059C8.643 15.804 12.924 11.914 13.007 11.564C13.017 11.52 13.025 11.355 12.934 11.264C12.842 11.173 12.698 11.205 12.584 11.231C12.422 11.269 9.839 12.978 4.814 16.366C4.078 16.87 3.411 17.114 2.813 17.098C2.152 17.081 0.88 16.726 0.055 16.45C-0.957 16.111-1.054 15.93 0.145 15.453C4.846 13.407 7.98 12.062 13.545 9.742C16.19 8.636 16.74 8.441 17.098 8.435C17.177 8.434 17.354 8.452 17.47 8.539C17.567 8.613 17.595 8.712 17.608 8.783C17.621 8.855 17.653 8.355 17.653 8.355Z"/>
                        </svg>
                    </div>
                    <div>
                        <div style={{ fontSize: '0.9rem', fontWeight: 'bold', color: 'var(--primary)' }}>TELEGRAM NOTIFICATIONS</div>
                        <div style={{ fontSize: '0.65rem', color: '#888', marginTop: '2px' }}>Receive alerts directly in your Telegram chat</div>
                    </div>
                    <div style={{ marginLeft: 'auto', fontSize: '0.65rem', padding: '3px 8px', borderRadius: '12px', fontWeight: 'bold', background: isLinked ? 'rgba(0,255,0,0.1)' : isEnabled ? 'rgba(255,200,0,0.1)' : 'rgba(255,0,0,0.1)', color: isLinked ? '#0f0' : isEnabled ? '#ffd700' : '#f00' }}>
                        {isLinked ? '✓ LINKED' : isEnabled ? '⏳ PENDING' : 'DISABLED'}
                    </div>
                </div>

                {!isEnabled ? (
                    // --- DISABLED STATE ---
                    <div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--primary)', fontWeight: 'bold', marginBottom: '10px' }}>CONFIGURE</div>
                        <div style={{ marginBottom: '20px' }}>
                            <div style={{ fontSize: '0.7rem', color: '#888', marginBottom: '6px' }}>PHONE NUMBER</div>
                            <input
                                value={tgPhone}
                                onChange={e => setTgPhone(e.target.value)}
                                placeholder="e.g. 012-3456789"
                                style={{ width: '100%', background: 'transparent', border: '1px solid var(--grid-line)', borderRadius: '4px', padding: '10px', color: '#fff', fontSize: '0.85rem', boxSizing: 'border-box' }}
                            />
                            <div style={{ fontSize: '0.6rem', color: '#555', marginTop: '4px' }}>Pre-filled from your biodata if available</div>
                        </div>
                        <button
                            className="btn"
                            disabled={tgLoading}
                            onClick={enableTelegram}
                            style={{ width: '100%', padding: '12px', borderColor: 'var(--primary)', color: 'var(--primary)', fontWeight: 'bold', fontSize: '0.85rem' }}
                        >
                            {tgLoading ? 'ENABLING...' : 'ENABLE TELEGRAM NOTIFICATIONS'}
                        </button>
                    </div>
                ) : (
                    // --- ENABLED STATE ---
                    <div>
                        {/* Link status */}
                        {!isLinked ? (
                            <div style={{ marginBottom: '20px', padding: '15px', background: 'rgba(255,200,0,0.05)', border: '1px solid rgba(255,200,0,0.3)', borderRadius: '6px' }}>
                                <div style={{ fontSize: '0.8rem', color: '#ffd700', fontWeight: 'bold', marginBottom: '8px' }}>⏳ WAITING FOR TELEGRAM LINK</div>
                                <div style={{ fontSize: '0.7rem', color: '#888', marginBottom: '12px' }}>Click the button below to open Telegram and link your account. Come back and refresh once done.</div>
                                {deepLink && (
                                    <a href={deepLink} target="_blank" rel="noreferrer" style={{ display: 'block', textDecoration: 'none' }}>
                                        <button className="btn" style={{ width: '100%', padding: '10px', borderColor: '#0088cc', color: '#0088cc', fontWeight: 'bold', fontSize: '0.8rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                                            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                                                <path d="M12 0C5.372 0 0 5.373 0 12C0 18.627 5.372 24 12 24C18.628 24 24 18.627 24 12C24 5.373 18.628 0 12 0ZM17.653 8.355C17.382 11.233 16.208 18.158 15.602 20.902C15.346 22.064 14.887 22.456 14.444 22.495C13.468 22.581 12.727 21.848 11.782 21.229C10.303 20.262 9.467 19.658 8.032 18.718C6.375 17.632 7.449 17.034 8.396 16.059C8.643 15.804 12.924 11.914 13.007 11.564C13.017 11.52 13.025 11.355 12.934 11.264C12.842 11.173 12.698 11.205 12.584 11.231C12.422 11.269 9.839 12.978 4.814 16.366C4.078 16.87 3.411 17.114 2.813 17.098C2.152 17.081 0.88 16.726 0.055 16.45C-0.957 16.111-1.054 15.93 0.145 15.453C4.846 13.407 7.98 12.062 13.545 9.742C16.19 8.636 16.74 8.441 17.098 8.435C17.177 8.434 17.354 8.452 17.47 8.539C17.567 8.613 17.595 8.712 17.608 8.783C17.621 8.855 17.653 8.355 17.653 8.355Z"/>
                                            </svg>
                                            OPEN TELEGRAM TO LINK ACCOUNT
                                        </button>
                                    </a>
                                )}
                                <button className="btn" onClick={loadTgStatus} style={{ width: '100%', marginTop: '8px', padding: '8px', borderColor: 'var(--grid-line)', color: '#888', fontSize: '0.7rem' }}>
                                    ↻ REFRESH STATUS
                                </button>
                            </div>
                        ) : (
                            <div style={{ marginBottom: '20px', padding: '10px', background: 'rgba(0,255,0,0.05)', border: '1px solid rgba(0,255,0,0.2)', borderRadius: '6px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                                <span style={{ fontSize: '1.2rem' }}>✅</span>
                                <div>
                                    <div style={{ fontSize: '0.75rem', color: '#0f0', fontWeight: 'bold' }}>ACCOUNT LINKED</div>
                                    <div style={{ fontSize: '0.6rem', color: '#888' }}>{tgStatus.phone || 'No phone saved'}</div>
                                </div>
                            </div>
                        )}

                        {/* FEATURE TOGGLES */}
                        <div style={{ fontSize: '0.75rem', color: 'var(--primary)', fontWeight: 'bold', marginBottom: '10px' }}>NOTIFICATION FEATURES</div>
                        <FeatureToggle
                            label="AutoJob Notifications"
                            icon="🔔"
                            desc="Get notified when AutoScan or Auto-Register job runs"
                            featureKey="notify_autojobs"
                        />
                        <FeatureToggle
                            label="Morning Schedule"
                            icon="🌅"
                            desc="Daily class schedule at midnight with AutoScan prompt"
                            featureKey="notify_morning_schedule"
                        />
                        <FeatureToggle
                            label="Class Awareness"
                            icon="🔭"
                            desc="Alert ~30 min before class starts, with AutoScan option"
                            featureKey="notify_class_awareness"
                        />

                        {/* DISCONNECT */}
                        <div style={{ marginTop: '24px' }}>
                            <button
                                className="btn"
                                disabled={tgLoading}
                                onClick={disableTelegram}
                                style={{ width: '100%', padding: '10px', borderColor: '#f00', color: '#f00', fontSize: '0.75rem', fontWeight: 'bold', opacity: tgLoading ? 0.5 : 1 }}
                            >
                                {tgLoading ? '...' : 'DISCONNECT TELEGRAM'}
                            </button>
                        </div>
                    </div>
                )}
            </div>
        );
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
        { id: 'telegram',    label: 'TELEGRAM' },
    ];

    // Button states
    const canStartAllCourses = allCourses.some(c => !c.autoscan_active);
    const canStopAllCourses = allCourses.some(c => c.autoscan_active);
    const canStartAllActivities = allOrgs.some(o => !o.autoscan_active);
    const canStopAllActivities = allOrgs.some(o => o.autoscan_active);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflowY: 'auto', paddingBottom: '20px' }}>
            <div style={{ display: 'flex', borderBottom: '1px solid var(--grid-line)', marginBottom: '15px', flexShrink: 0 }}>
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
                            <button className="btn" style={{ color: '#888', border: 'none', background: 'transparent', fontSize: '0.65rem', padding: '2px 8px', letterSpacing: '1px', boxShadow: 'none' }} onClick={onClearAllNotifs}>CLEAR ALL</button>
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
            {/* ===== TELEGRAM TAB ===== */}
            {tab === 'telegram' && (
                <div style={{ marginTop: 0 }}>
                    <TelegramTab />
                </div>
            )}
        </div>
    );
}
