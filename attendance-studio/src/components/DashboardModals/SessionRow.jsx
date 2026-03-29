import React from 'react';

export default function SessionRow({ s, isOrg, onAction, onExempt, parentId, fallbackName }) {
    const dateStr = new Date(s.date).toLocaleDateString('en-GB', {day:'numeric', month:'short', year: 'numeric'});
    const timeStr = s.end ? `${s.start} - ${s.end}` : s.start;
    const locationStr = s.location || "Unknown Loc";
    
    // Header Logic: Activity = Name, Class = Date
    const headerText = isOrg ? (s.name || "Activity") : dateStr;

    // Time Check Logic for Classes
    const isScanActive = () => {
        if (isOrg) return true;
        if (!s.date || !s.start || !s.end) return true;
        try {
            const now = new Date();
            const sessionBase = new Date(s.date);
            const startDt = new Date(sessionBase);
            const [t1, m1] = s.start.split(' ');
            let [h1, min1] = t1.split(':');
            if (h1 === '12') h1 = '00';
            if (m1 === 'PM') h1 = parseInt(h1) + 12;
            startDt.setHours(parseInt(h1), parseInt(min1), 0, 0);
            const endDt = new Date(sessionBase);
            const [t2, m2] = s.end.split(' ');
            let [h2, min2] = t2.split(':');
            if (h2 === '12') h2 = '00';
            if (m2 === 'PM') h2 = parseInt(h2) + 12;
            endDt.setHours(parseInt(h2), parseInt(min2), 0, 0);
            return now >= startDt && now <= endDt;
        } catch (e) { return true; }
    };

    const canScan = isScanActive();
    const nameStyle = isOrg ? { color: 'var(--accent)', fontSize: '0.95rem' } : { color: '#fff', fontSize: '0.95rem' };

    return (
        <div className="session-row" style={{ padding: 'clamp(4px, 0.8vh, 12px)', flex: '1 1 auto', minHeight: 0 }}>
            <div className="session-left" style={{ flex: 1, minWidth: 0 }}>
                <div className="session-text" style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    <span className="s-date" style={{ ...nameStyle, fontSize: 'clamp(0.7rem, 1.5vh, 0.95rem)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{headerText}</span>
                    <span className="s-time" style={{ fontSize: 'clamp(0.55rem, 1.1vh, 0.7rem)', color: 'var(--text-dim)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'flex', flexDirection: 'column', gap: '2px', marginTop: '4px' }}>
                        {isOrg ? (
                            <><span style={{ color: '#ccc' }}>{locationStr}</span><span>{dateStr} • {timeStr}</span></>
                        ) : (
                            <><span style={{ color: '#ccc' }}>{locationStr}</span><span>{timeStr}</span></>
                        )}
                    </span>
                </div>
                <div className="btn-row" style={{ marginTop: 'clamp(4px, 1vh, 8px)', display: 'flex', gap: '4px' }}>
                    {s.log_id ? (
                        <>
                            {isOrg && s.can_checkout && (<><button className="btn btn-scan" onClick={() => onAction('act_scan_out', s.id, parentId, true)} style={{ padding: 'clamp(3px, 0.8vh, 6px) clamp(6px, 1.5vh, 12px)', fontSize: 'clamp(0.55rem, 1.1vh, 0.75rem)' }}>SCAN OUT</button><button className="btn" onClick={() => onAction('act_manual_out', s.id, parentId, true)} style={{ padding: 'clamp(3px, 0.8vh, 6px) clamp(6px, 1.5vh, 12px)', fontSize: 'clamp(0.55rem, 1.1vh, 0.75rem)' }}>MAN OUT</button></>)}
                            <button className="btn btn-del" onClick={() => onAction(isOrg ? 'act_delete' : 'delete', s.log_id, parentId, isOrg)} style={{ padding: 'clamp(3px, 0.8vh, 6px) clamp(6px, 1.5vh, 12px)', fontSize: 'clamp(0.55rem, 1.1vh, 0.75rem)' }}>DELETE</button>
                        </>
                    ) : (
                        <>
                            {canScan && <button className="btn btn-scan" onClick={() => onAction(isOrg ? 'act_scan_in' : 'scan', s.id, parentId, isOrg)} style={{ padding: 'clamp(3px, 0.8vh, 6px) clamp(6px, 1.5vh, 12px)', fontSize: 'clamp(0.55rem, 1.1vh, 0.75rem)' }}>SCAN IN</button>}
                            <button className="btn" onClick={() => onAction(isOrg ? 'act_manual_in' : 'manual', s.id, parentId, isOrg)} style={{ padding: 'clamp(3px, 0.8vh, 6px) clamp(6px, 1.5vh, 12px)', fontSize: 'clamp(0.55rem, 1.1vh, 0.75rem)' }}>MANUAL IN</button>
                            {!isOrg && <button className="btn btn-exempt" onClick={() => onExempt(s.id, parentId)} style={{ padding: 'clamp(3px, 0.8vh, 6px) clamp(6px, 1.5vh, 12px)', fontSize: 'clamp(0.55rem, 1.1vh, 0.75rem)' }}>EXEMPT</button>}
                        </>
                    )}
                </div>
            </div>
            <div className="session-right">
                <div className={`status ${s.status?.includes('Present') || s.status?.includes('Checked') || s.status?.includes('Completed') ? 'st-present' : s.status?.includes('Exempt') ? 'st-exempt' : 'st-absent'}`} 
                     style={{ ...(s.status?.includes('Checked') && !s.status?.includes('Completed') ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : {}), padding: 'clamp(3px, 0.8vh, 6px) clamp(6px, 1.5vh, 10px)', fontSize: 'clamp(0.6rem, 1.2vh, 0.8rem)' }}>
                    {s.status || 'Absent'}
                </div>
            </div>
        </div>
    );
}