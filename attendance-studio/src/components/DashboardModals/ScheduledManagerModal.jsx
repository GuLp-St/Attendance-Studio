import React, { useState } from 'react';
import Modal from '../Modal';
import { api } from '../../services/api';
import { useToast } from '../../contexts/ToastContext';
import { useConfirm } from '../../contexts/ConfirmContext';

export default function ScheduledManagerModal({ isOpen, onClose, user, notifications, onDismissNotif, onCancelJob, onCancelAutoReg }) {
    const { showToast } = useToast();
    const { confirm } = useConfirm();
    const [tab, setTab] = useState('jobs');
    const [arLoading, setArLoading] = useState(null); // gid being toggled for auto-register

    const fmtDate = (iso) => {
        const d = new Date(iso);
        return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}`;
    };

    // Existing autoscan active jobs
    const activeClassJobs = user.courses.filter(c => c.autoscan_active);
    const activeOrgJobs = user.following.map(id => user.organizerDetails?.[id]).filter(o => o?.autoscan_active);

    // Auto-register active jobs (stored in user.auto_register — gid[] set by backend)
    const activeAutoRegJobs = (user.auto_register || []);

    // All registered courses for auto-register toggling
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

    return (
        <Modal title="SCHEDULED MANAGER" isOpen={isOpen} onClose={onClose}>
            {/* Tab switcher */}
            <div style={{ display: 'flex', borderBottom: '1px solid var(--grid-line)', marginBottom: '15px' }}>
                {['jobs', 'logs'].map(t => (
                    <div key={t}
                        onClick={() => setTab(t)}
                        style={{
                            flex: 1, textAlign: 'center', padding: '8px',
                            cursor: 'pointer', fontSize: '0.7rem', letterSpacing: '1px',
                            color: tab === t ? 'var(--primary)' : 'var(--text-dim)',
                            borderBottom: tab === t ? '2px solid var(--primary)' : 'none',
                            fontWeight: tab === t ? 'bold' : 'normal'
                        }}
                    >
                        {t.toUpperCase()}
                    </div>
                ))}
            </div>

            {/* ===== JOBS TAB: existing autoscan + auto register ===== */}
            {tab === 'jobs' && (
                <div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--primary)', marginBottom: '10px', fontWeight: 'bold' }}>ACTIVE JOBS</div>
                    {activeClassJobs.length === 0 && activeOrgJobs.length === 0 && activeAutoRegJobs.length === 0 && (
                        <div style={{ textAlign: 'center', color: '#555', fontSize: '0.7rem', padding: '15px', border: '1px dashed #333' }}>NO ACTIVE JOBS</div>
                    )}
                    {activeClassJobs.map(c => (
                        <div key={c.gid} className="job-manager-row">
                            <div><div className="job-info-title">{c.code} {c.group}</div><div className="job-info-sub">Class Autoscan Active</div></div>
                            <button className="btn" style={{ borderColor: '#f00', color: '#f00', fontSize: '0.65rem' }} onClick={() => onCancelJob(c.gid, false)}>STOP</button>
                        </div>
                    ))}
                    {activeOrgJobs.map(o => (
                        <div key={o.id} className="job-manager-row" style={{borderColor:'var(--accent)', background:'rgba(255, 158, 0, 0.05)'}}>
                            <div><div className="job-info-title" style={{color:'var(--accent)'}}>{o.name}</div><div className="job-info-sub">Activity Autoscan Active</div></div>
                            <button className="btn" style={{ borderColor: '#f00', color: '#f00', fontSize: '0.65rem' }} onClick={() => onCancelJob(o.id, true)}>STOP</button>
                        </div>
                    ))}
                    {activeAutoRegJobs.map(gid => {
                        const course = allCourses.find(c => String(c.gid) === String(gid));
                        return (
                            <div key={gid} className="job-manager-row" style={{borderColor:'#0f0', background:'rgba(0,255,0,0.03)'}}>
                                <div>
                                    <div className="job-info-title" style={{color:'#0f0'}}>{course ? `${course.code} ${course.group}` : `GID: ${gid}`}</div>
                                    <div className="job-info-sub">Auto Register Active</div>
                                </div>
                                <button className="btn" disabled={arLoading === gid} style={{borderColor:'#f00', color:'#f00', fontSize:'0.65rem', opacity: arLoading === gid ? 0.5 : 1}} onClick={() => stopAutoRegister(gid, course?.code || gid)}>
                                    {arLoading === gid ? '...' : 'STOP'}
                                </button>
                            </div>
                        );
                    })}
                </div>
            )}


            {/* ===== LOGS TAB ===== */}
            {tab === 'logs' && (
                <div className="notif-container" style={{ marginTop: 0, borderTop: 'none', paddingTop: 0 }}>
                    <div style={{ fontSize: '0.75rem', color: 'var(--primary)', marginBottom: '10px', fontWeight: 'bold' }}>NOTIFICATION LOGS</div>
                    {notifications.length === 0 
                        ? <div style={{ textAlign: 'center', color: '#555', fontSize: '0.7rem' }}>NO LOGS</div> 
                        : notifications.map(n => (
                            <div key={n.id} className={`notif-card ${n.status === 'SUCCESS' ? 'notif-success' : 'notif-fail'}`} onClick={() => onDismissNotif(n.id)}>
                                <div className="notif-header"><span>{n.title}</span><span style={{ color: n.status === 'SUCCESS' ? '#0f0' : '#f00' }}>{n.status}</span></div>
                                <div className="notif-detail">{n.details}</div>
                                <div className="notif-meta">{n.type?.toUpperCase()} • {n.mode?.toUpperCase() || 'AUTO'} MODE</div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
                                    <div className="notif-time">{fmtDate(n.timestamp)}</div>
                                    <div className="dismiss-hint">Click to dismiss</div>
                                </div>
                            </div>
                        ))
                    }
                </div>
            )}
        </Modal>
    );
}
