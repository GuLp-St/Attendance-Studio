import React, { memo, useState, useEffect, useRef } from 'react';
import Skeleton from './Skeleton';
import { ScanLine } from 'lucide-react';
import SessionRow from './DashboardModals/SessionRow';

// ============================================================================
// HELPERS
// ============================================================================

const parseTime = t => {
    if(!t) return 0;
    const [time, mod] = t.split(' '); let [h, m] = time.split(':');
    if (mod === 'PM' && h !== '12') h = parseInt(h) + 12;
    if (mod === 'AM' && h === '12') h = 0;
    return parseInt(h) * 60 + parseInt(m);
};

const getStats = (sessions) => {
    // 1. Loading State (Start at 0% for animation)
    if (!sessions) return { text: 'CALC...', class: 'stat-loading', percent: 0, barColor: '#333' };
    
    // 2. No Data State
    if (sessions.length === 0) return { text: 'COMING SOON', class: 'stat-coming-soon', percent: 0, barColor: 'transparent' };

    // 3. Calculation
    // Count Present, Exempt, and Completed as "Good"
    const present = sessions.filter(s => 
        s.status.includes('Present') || 
        s.status.includes('Exempt') || 
        s.status.includes('Completed')
    ).length;
    
    const percent = Math.round((present / sessions.length) * 100);
    
    // 4. Color Logic
    let colorClass = 'stat-danger';
    let barColor = '#f00'; // Default Red

    if (percent >= 80) { 
        colorClass = 'stat-good'; 
        barColor = '#0f0'; 
    } else if (percent >= 70) { 
        colorClass = 'stat-warn'; 
        barColor = 'var(--accent)'; 
    }

    return { text: `${percent}%`, class: colorClass, percent, barColor };
};

// ============================================================================
// COMPONENTS
// ============================================================================

export const DashboardHeader = memo(function DashboardHeader({ user, onLogout, notifCount }) {
    return (
        <div className="nav-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '15px', minWidth: 0 }}>
                {/* Profile Picture */}
                <div style={{ width: '50px', height: '50px', borderRadius: '50%', overflow: 'hidden', border: '2px solid var(--primary)', background: '#111', flexShrink: 0 }}>
                    <img 
                        src={`https://studentphotos.unimas.my/${user.matric}.jpg`} 
                        alt="Profile" 
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        onError={(e) => { e.target.style.display = 'none'; }}
                    />
                </div>
                
                {/* User Info */}
                <div style={{ minWidth: 0 }}>
                    <h2 className="glitch-text" style={{ fontSize: '1.2rem', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.name}</h2>
                    <div style={{ fontSize: '0.8rem', color: 'var(--primary)', marginTop: '2px', fontWeight: 'bold' }}>{user.matric}</div>
                    
                    {/* Lazy Loaded Profile Data */}
                    {user.profile && (
                        <div style={{ fontSize: '0.65rem', color: '#aaa', marginTop: '2px' }}>
                            {user.profile.namaProgramBi || '-'} • {user.profile.kodSesiSem || '-'}
                        </div>
                    )}
                </div>
            </div>
            
            <div className="header-actions" style={{ alignItems: 'center', flexShrink: 0 }}>
                <button className="back-btn" onClick={onLogout}>LOGOUT</button>
            </div>
        </div>
    );
});


const AnimatedPercent = ({ value, animKey }) => {
    const [display, setDisplay] = useState(0);
    const hasAnimated = useRef(false);
    useEffect(() => {
        // Reset and re-animate each time animKey changes (i.e., when accordion opens)
        hasAnimated.current = false;
        setDisplay(0);
        const dur = 800;
        const incr = Math.max(1, value / (dur / 16));
        let start = 0;
        const timer = setInterval(() => {
            start += incr;
            if (start >= value) { setDisplay(value); clearInterval(timer); }
            else setDisplay(Math.floor(start));
        }, 16);
        return () => clearInterval(timer);
    }, [animKey, value]);
    return <span>{display}%</span>;
};

const ExpandedProgress = ({ stat, animKey, statContent, c, actionLoading, onCancelAutoscan, onAutoscan, isLoadingSessions, sessionsForExpanded, onAction, onExempt }) => {
    const [barWidth, setBarWidth] = useState(0);
    useEffect(() => {
        setBarWidth(0);
        const t = setTimeout(() => setBarWidth(stat.percent), 50);
        return () => clearTimeout(t);
    }, [animKey, stat.percent]);

    return (
        <div style={{ padding: '15px', borderTop: '1px dashed var(--grid-line)', background: 'rgba(0,0,0,0.2)' }}>
            
            {/* Beautiful Expanded Progress Bar */}
            <div style={{ marginBottom: '15px', paddingBottom: '15px', borderBottom: '1px solid var(--grid-line)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', marginBottom: '8px' }}>
                    <span style={{ color: '#ccc' }}>ATTENDANCE PROGRESS</span>
                    <span style={{ color: stat.barColor, fontWeight: 'bold' }}>{statContent} <span style={{fontSize:'0.65rem', color:'#888', marginLeft:'5px'}}>{stat.present}/{stat.total}</span></span>
                </div>
                <div style={{ height: '6px', width: '100%', background: 'rgba(255,255,255,0.05)', borderRadius: '3px', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${barWidth}%`, background: stat.barColor, transition: 'width 1s ease' }}></div>
                </div>
            </div>
            
            {/* Autoscan Controls */}
            <div style={{ marginBottom: '15px', borderBottom: '1px solid var(--grid-line)', paddingBottom: '15px' }}>
                {c?.autoscan_active ? (
                    <div style={{ textAlign: 'center' }}>
                        <button 
                            className="btn" 
                            disabled={actionLoading === `autoscan_${c.gid}`}
                            style={{ width: '100%', borderColor: '#f00', color: '#f00', fontWeight: 'bold', opacity: actionLoading === `autoscan_${c.gid}` ? 0.5 : 1 }} 
                            onClick={() => onCancelAutoscan(c.gid, false)}
                        >
                            {actionLoading === `autoscan_${c.gid}` ? '[ PROCESSING... ]' : '[ DEACTIVATE AUTOSCAN ]'}
                        </button>
                        <div style={{ color: '#f00', fontSize: '0.7rem', margin: '5px 0' }}>SCANNER ACTIVE</div>
                    </div>
                ) : (
                    <div style={{ textAlign: 'center' }}>
                        <button 
                            className="btn" 
                            disabled={actionLoading === `autoscan_${c.gid}`}
                            style={{ width: '100%', borderColor: 'var(--primary)', color: 'var(--primary)', fontWeight: 'bold', opacity: actionLoading === `autoscan_${c.gid}` ? 0.5 : 1 }} 
                            onClick={() => onAutoscan(c?.gid, false)}
                        >
                            {actionLoading === `autoscan_${c.gid}` ? '[ PROCESSING... ]' : '[ ACTIVATE AUTOSCAN ]'}
                        </button>
                        <div style={{ color: 'var(--text-dim)', fontSize: '0.7rem', margin: '5px 0' }}>SYSTEM WILL AUTOSCAN</div>
                    </div>
                )}
            </div>

            {/* Session List */}
            {isLoadingSessions ? (
                <><Skeleton type="session-row" /><Skeleton type="session-row" /></>
            ) : sessionsForExpanded?.length > 0 ? (
                sessionsForExpanded.map(s => <SessionRow key={s.id} s={s} parentId={c?.gid} fallbackName={c?.code} onAction={onAction} onExempt={onExempt} />)
            ) : (
                <div style={{ textAlign: 'center', padding: '20px', fontSize: '0.8rem', color: '#555' }}>NO SESSIONS</div>
            )}
        </div>
    );
};

export const TimetableList = memo(function TimetableList({ 
    timetable, courses, loading,
    expandedGid, onExpand, 
    sessionsForExpanded, isLoadingSessions,
    onAction, onExempt, onAutoscan, onCancelAutoscan, actionLoading 
}) {
    // Track expand times so AnimatedPercent re-animates each time a card is opened
    const expandTimestamps = useRef({});

    if (loading) {
        return (
            <div className="timetable-grid">
                {[1,2,3,4].map(i => <Skeleton key={i} type="course-card" />)}
            </div>
        );
    }

    const days = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"];
    
    if (!timetable || timetable.length === 0) return <div style={{textAlign:'center', color:'#555', padding: '20px'}}>NO CLASSES REGISTERED</div>;

    const getCourse = (gid) => courses?.find(c => c.gid === gid);

    // Live Pointer Logic
    const nowTime = new Date();
    const todayIdx = nowTime.getDay() === 0 ? 6 : nowTime.getDay() - 1; // 0=Mon...6=Sun
    const currentDay = days[todayIdx];
    const nowMinutes = nowTime.getHours() * 60 + nowTime.getMinutes();

    const parseMinutes = (tStr) => {
        if (!tStr) return 0;
        const match = tStr.match(/(\d+):(\d+) (AM|PM)/i);
        if (!match) return 0;
        let h = parseInt(match[1]), m = parseInt(match[2]);
        if (match[3].toUpperCase() === 'PM' && h < 12) h += 12;
        if (match[3].toUpperCase() === 'AM' && h === 12) h = 0;
        return h * 60 + m;
    };

    let foundUpcoming = false;

    const handleExpand = (gid) => {
        if (gid && gid !== expandedGid) {
            // Record the timestamp when this gid is freshly expanded
            expandTimestamps.current[gid] = Date.now();
        }
        onExpand(gid);
    };

    return (
        <div className="timetable-grid" style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
            {days.map(day => {
                const slots = timetable.filter(t => t.day === day).sort((a,b) => parseTime(a.start) - parseTime(b.start));
                if (slots.length === 0) return null;
                
                const isToday = day === currentDay;

                return (
                    <div key={day}>
                        <div className="day-header" style={{color:'var(--primary)', fontSize:'0.85rem', marginBottom:'10px', fontWeight: 'bold'}}>{day} {isToday && <span style={{color:'#fff', fontSize:'0.7rem', marginLeft:'8px'}}>(TODAY)</span>}</div>
                        {slots.map((t, i) => {
                            const c = getCourse(t.gid);
                            const stat = getStats(c?.sessions);
                            const isExpanded = expandedGid === t.gid;
                            // animKey is the timestamp of last expansion so AnimatedPercent re-triggers each open
                            const animKey = expandTimestamps.current[t.gid] || 0;
                            
                            // Live Pointer highlighting
                            let isOngoing = false;
                            let isUpcoming = false;
                            
                            if (isToday) {
                                const sMin = parseMinutes(t.start);
                                const eMin = parseMinutes(t.end);
                                if (nowMinutes >= sMin && nowMinutes <= eMin) {
                                    isOngoing = true;
                                } else if (nowMinutes < sMin && !foundUpcoming) {
                                    isUpcoming = true;
                                    foundUpcoming = true;
                                }
                            }
                            
                            // Replace string percentages with animated ones
                            let statContent = stat.text;
                            if (statContent && statContent.includes('%')) {
                                statContent = <><AnimatedPercent value={stat.percent} animKey={animKey} /></>;
                            }

                            return (
                                <div key={i} className="time-slot course-card" style={{ 
                                    cursor: 'pointer', marginBottom: '8px', border: '1px solid var(--grid-line)', overflow: 'hidden',
                                    borderLeft: isOngoing ? '4px solid #ff4444' : isUpcoming ? '4px solid #44aaff' : '1px solid var(--grid-line)'
                                }}>
                                    
                                    {/* Main Row Content */}
                                    <div 
                                        style={{ padding: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                                        onClick={() => handleExpand(isExpanded ? null : t.gid)}
                                    >
                                        <div>
                                            <div className="time-time" style={{ fontSize: '0.85rem', fontWeight: 'bold' }}>{t.start} - {t.end}</div>
                                            <div className="time-course" style={{ color: '#fff', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                <span>{t.code}</span>
                                                <span style={{ fontSize: '0.75rem', color: '#ccc', fontWeight: 'normal' }}>{c?.name}</span>
                                            </div>
                                            <div className="time-loc" style={{ color: 'var(--text-dim)', fontSize: '0.75rem' }}>({t.group}) | {t.loc}</div>
                                        </div>
                                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '5px' }}>
                                            <div className={`stat-badge ${stat.class}`}>
                                                {statContent}
                                            </div>
                                        </div>
                                    </div>

                                    {/* Accordion Expansion */}
                                    {isExpanded && (
                                        <ExpandedProgress stat={stat} animKey={animKey} statContent={statContent} c={c} actionLoading={actionLoading} onCancelAutoscan={onCancelAutoscan} onAutoscan={onAutoscan} isLoadingSessions={isLoadingSessions} sessionsForExpanded={sessionsForExpanded} onAction={onAction} onExempt={onExempt} />
                                    )}
                                </div>
                            );
                        })}
                    </div>
                );
            })}
        </div>
    );
});

export const ActivityList = memo(function ActivityList({ following, organizerDetails, onSelect }) {
    return (
        <div className="course-grid">
            {following?.length === 0 && <div style={{gridColumn:'1/-1', textAlign:'center', color:'#555', padding:'20px'}}>NO ACTIVITIES FOLLOWED</div>}

            {following?.map(oid => {
                const details = organizerDetails?.[oid];
                let meta = "LOADING...", badge = null;
                
                // Activity Logic
                if (details) {
                    if (details.activities && details.activities.length > 0) {
                        const latest = details.activities[0];
                        meta = latest.name;
                        
                        if (latest.status) {
                            let color = '#f00'; 
                            if (latest.status.includes('Present') || latest.status.includes('Completed')) color = '#0f0'; 
                            else if (latest.status.includes('Checked')) color = 'var(--accent)';
                            
                            badge = (
                                <div className="stat-badge" style={{
                                    fontSize:'0.7rem', 
                                    color: color, 
                                    borderColor: color, 
                                    border:'1px solid', 
                                    padding:'2px 4px', 
                                    borderRadius:'3px'
                                }}>
                                    {latest.status}
                                </div>
                            );
                        }
                    } else { meta = "NO RECENT EVENTS"; }
                } else {
                    // Mini Skeleton for Activity Card Text
                    meta = (
                        <div className="sk-line" style={{width:'80px', height:'10px', background:'rgba(255,255,255,0.1)', marginTop:'5px'}}>
                            <div className="sk-shimmer"></div>
                        </div>
                    );
                }

                return (
                    <div key={oid} className="course-card" style={{ borderColor: 'var(--accent)' }} onClick={() => { if(details) onSelect(details); }}>
                        <div>
                            <div className="cc-code" style={{ color: 'var(--accent)' }}>
                                {details?.name || `Source ${oid}`}
                            </div>
                            <div className="cc-group" style={{ fontSize: '0.65rem', marginTop: '5px' }}>{meta}</div>
                        </div>
                        <div style={{ marginTop: '10px', display: 'flex', justifyContent: 'space-between' }}>
                            {badge}
                            <div className="progress-line" style={{ background: 'var(--accent)', opacity: 0.5 }}></div>
                        </div>
                    </div>
                );
            })}
        </div>
    );
});