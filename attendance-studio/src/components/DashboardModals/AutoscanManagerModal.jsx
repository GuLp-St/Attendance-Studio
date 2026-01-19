import React from 'react';
import Modal from '../Modal';

export default function AutoscanManagerModal({ isOpen, onClose, user, notifications, onDismissNotif, onCancelJob }) {
    const fmtDate = (iso) => {
        const d = new Date(iso);
        return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}`;
    };

    const activeClassJobs = user.courses.filter(c => c.autoscan_active);
    const activeOrgJobs = user.following.map(id => user.organizerDetails?.[id]).filter(o => o?.autoscan_active);

    return (
        <Modal title="AUTOSCAN MANAGER" isOpen={isOpen} onClose={onClose}>
            <div style={{ marginBottom: '20px' }}>
                <div style={{ fontSize: '0.8rem', color: 'var(--primary)', marginBottom: '10px', fontWeight: 'bold', letterSpacing: '1px' }}>ACTIVE JOBS</div>
                {activeClassJobs.length === 0 && activeOrgJobs.length === 0 && <div style={{ textAlign: 'center', color: '#555', fontSize: '0.7rem', padding: '10px', border: '1px dashed #333' }}>NO ACTIVE AUTOSCANS</div>}
                {activeClassJobs.map(c => (
                    <div key={c.gid} className="job-manager-row">
                        <div><div className="job-info-title">{c.code}</div><div className="job-info-sub">Class Autoscan Active</div></div>
                        <button className="btn" style={{ borderColor: '#f00', color: '#f00', fontSize: '0.65rem' }} onClick={() => onCancelJob(c.gid, false)}>STOP</button>
                    </div>
                ))}
                {activeOrgJobs.map(o => (
                    <div key={o.id} className="job-manager-row" style={{borderColor:'var(--accent)', background:'rgba(255, 158, 0, 0.05)'}}>
                        <div><div className="job-info-title" style={{color:'var(--accent)'}}>{o.name}</div><div className="job-info-sub">Activity Autoscan Active</div></div>
                        <button className="btn" style={{ borderColor: '#f00', color: '#f00', fontSize: '0.65rem' }} onClick={() => onCancelJob(o.id, true)}>STOP</button>
                    </div>
                ))}
            </div>
            <div className="notif-container">
                <div style={{ fontSize: '0.8rem', color: 'var(--primary)', marginBottom: '10px', fontWeight: 'bold', letterSpacing: '1px' }}>LOGS</div>
                {notifications.length === 0 ? <div style={{ textAlign: 'center', color: '#555', fontSize: '0.7rem' }}>NO LOGS</div> : 
                    notifications.map(n => (
                        <div key={n.id} className={`notif-card ${n.status === 'SUCCESS' ? 'notif-success' : 'notif-fail'}`} onClick={() => onDismissNotif(n.id)}>
                            <div className="notif-header"><span>{n.title}</span><span style={{ color: n.status === 'SUCCESS' ? '#0f0' : '#f00' }}>{n.status}</span></div>
                            <div className="notif-detail">{n.details}</div>
                            <div className="notif-meta">{n.type.toUpperCase()} • {n.mode.toUpperCase()} MODE</div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}><div className="notif-time">{fmtDate(n.timestamp)}</div><div className="dismiss-hint">Click to dismiss</div></div>
                        </div>
                    ))
                }
            </div>
        </Modal>
    );
}