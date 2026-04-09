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

export const getStats = (sessions) => {
    // 1. Loading State (Start at 0% for animation)
    if (!sessions) return { text: 'CALC...', class: 'stat-loading', percent: 0, barColor: '#333', present: 0, total: 0 };
    
    // 2. No Data State
    if (sessions.length === 0) return { text: 'COMING SOON', class: 'stat-coming-soon', percent: 0, barColor: 'transparent', present: 0, total: 0 };

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

    return { text: `${percent}%`, class: colorClass, percent, barColor, present, total: sessions.length };
};

// ============================================================================
// COMPONENTS
// ============================================================================

export const DashboardHeader = memo(function DashboardHeader({ user, onLogout, onRestartTutorial, notifCount }) {
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
                    <h2 className="glitch-text" style={{ fontSize: 'clamp(0.85rem, 3.5vw, 1.2rem)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'normal', wordBreak: 'break-word' }}>{user.name}</h2>
                    <div style={{ fontSize: '0.8rem', color: 'var(--primary)', marginTop: '2px', fontWeight: 'bold' }}>{user.matric}</div>
                    
                    {/* Lazy Loaded Profile Data */}
                    {user.profile && (
                        <div style={{ fontSize: '0.65rem', color: '#aaa', marginTop: '2px' }}>
                            {user.profile.namaProgramBi || '-'} • {user.profile.kodSesiSem || '-'}
                        </div>
                    )}
                </div>
            </div>
            
            <div className="header-actions" style={{ alignItems: 'center', flexShrink: 0, display: 'flex', gap: '6px' }}>
                <button 
                    id="tutorial-btn"
                    className="back-btn" 
                    title="Restart Tutorial"
                    onClick={onRestartTutorial}
                    style={{ padding: '4px 8px', borderColor: 'transparent', background: 'transparent', boxShadow: 'none', display:'flex', alignItems:'center' }}
                >
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-dim)' }}>
                        <circle cx="12" cy="12" r="10"/>
                        <line x1="12" y1="8" x2="12" y2="12"/>
                        <line x1="12" y1="16" x2="12.01" y2="16"/>
                    </svg>
                </button>
                <button className="back-btn" onClick={onLogout}>LOGOUT</button>
            </div>
        </div>
    );
});


const AnimatedPercent = ({ value }) => {
    const [display, setDisplay] = useState(0);
    const currRef = useRef(0);

    useEffect(() => {
        const timer = setInterval(() => {
            if (currRef.current === value) {
                clearInterval(timer);
                return;
            }
            const diff = value - currRef.current;
            const dir = Math.sign(diff);
            const step = Math.max(1, Math.floor(Math.abs(diff) / 10));
            
            currRef.current += dir * step;
            if ((dir > 0 && currRef.current > value) || (dir < 0 && currRef.current < value)) {
                currRef.current = value;
            }
            setDisplay(currRef.current);
        }, 30);
        return () => clearInterval(timer);
    }, [value]);

    return <span>{display}%</span>;
};

export const ExpandedProgress = ({ stat, animKey, isFirstExpand, statContent, c, actionLoading, onCancelAutoscan, onAutoscan, isLoadingSessions, sessionsForExpanded, onAction, onExempt }) => {
    const [barWidth, setBarWidth] = useState(isFirstExpand ? 0 : stat.percent);
    useEffect(() => {
        if (isFirstExpand) {
            setBarWidth(0);
            const t = setTimeout(() => setBarWidth(stat.percent), 50);
            return () => clearTimeout(t);
        } else {
            setBarWidth(stat.percent);
        }
    }, [isFirstExpand, stat.percent]);

    return (
        <div style={{ padding: 'clamp(5px, 1vh, 12px)', borderTop: '1px dashed var(--grid-line)', background: 'rgba(0,0,0,0.2)', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            
            {/* Top Config Row: Progress + Autoscan */}
            <div style={{ display: 'flex', gap: '15px', alignItems: 'center', marginBottom: 'clamp(4px, 1vh, 10px)', paddingBottom: 'clamp(4px, 1vh, 10px)', borderBottom: '1px solid var(--grid-line)', flexShrink: 0 }}>
                
                {/* Progress */}
                <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'clamp(0.6rem, 1.2vh, 0.75rem)', marginBottom: '4px' }}>
                        <span style={{ color: '#ccc' }}>PROGRESS</span>
                        <span style={{ color: stat.barColor, fontWeight: 'bold' }}>
                            {statContent} <span style={{fontSize:'0.6rem', color:'#888', marginLeft:'3px'}}>{stat.present}/{stat.total}</span>
                        </span>
                    </div>
                    <div style={{ height: '4px', width: '100%', background: 'rgba(255,255,255,0.05)', borderRadius: '2px', overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${barWidth}%`, background: stat.barColor, transition: 'width 1s ease' }}></div>
                    </div>
                </div>

                {/* Autoscan Button */}
                <div style={{ width: '110px', flexShrink: 0 }}>
                    {c?.autoscan_active ? (
                        <button className="btn" disabled={actionLoading === `autoscan_${c.gid}`} onClick={() => onCancelAutoscan(c.gid, false)}
                            style={{ width: '100%', borderColor: '#f00', color: '#f00', fontWeight: 'bold', padding: '4px 6px', fontSize: '0.65rem', opacity: actionLoading === `autoscan_${c.gid}` ? 0.5 : 1 }}>
                            {actionLoading === `autoscan_${c.gid}` ? '...' : 'STOP SCAN'}
                        </button>
                    ) : (
                        <button className="btn" disabled={actionLoading === `autoscan_${c.gid}`} onClick={() => onAutoscan(c?.gid, false)}
                            style={{ width: '100%', borderColor: 'var(--primary)', color: 'var(--primary)', fontWeight: 'bold', padding: '4px 6px', fontSize: '0.65rem', opacity: actionLoading === `autoscan_${c.gid}` ? 0.5 : 1 }}>
                            {actionLoading === `autoscan_${c.gid}` ? '...' : 'AUTOSCAN'}
                        </button>
                    )}
                </div>
            </div>

            {/* Session List */}
            {isLoadingSessions ? (
                <><Skeleton type="session-row" /><Skeleton type="session-row" /></>
            ) : sessionsForExpanded?.length > 0 ? (
                <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
                    {sessionsForExpanded.map(s => <SessionRow key={s.id} s={s} parentId={c?.gid} fallbackName={c?.code} onAction={onAction} onExempt={onExempt} />)}
                </div>
            ) : (
                <div style={{ textAlign: 'center', padding: '20px', fontSize: '0.8rem', color: '#555' }}>NO SESSIONS</div>
            )}
        </div>
    );
};

export const TimetableList = memo(function TimetableList({ timetable, courses, loading, expandedGid, onExpand, sessionsForExpanded, isLoadingSessions, pollStatus, onRetryFetches, onAction, onExempt, onAutoscan, onCancelAutoscan, actionLoading, isVisible }) {
    const initialMountTime = useRef(Date.now());
    const containerRef = useRef(null);

    const [liveTime, setLiveTime] = useState(new Date());
    useEffect(() => {
        const t = setInterval(() => setLiveTime(new Date()), 1000);
        return () => clearInterval(t);
    }, []);

    const [markerY, setMarkerY] = useState(null); // null = hidden until first measurement
    const [measureTick, setMeasureTick] = useState(0);

    const days = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"];
    let activeTime = liveTime;
    let nowMinutes = activeTime.getHours() * 60 + activeTime.getMinutes();
    let currentDayStr = days[activeTime.getDay() === 0 ? 6 : activeTime.getDay() - 1];
    const currentWeekMin = days.indexOf(currentDayStr) * 24 * 60 + nowMinutes;

    // Use useLayoutEffect so the calculation runs synchronously right after the DOM paints
    // This avoids the 1-second delay from waiting for the next liveTime tick
    React.useLayoutEffect(() => {
        if (!containerRef.current) return;
        const nodes = Array.from(containerRef.current.querySelectorAll('.time-node'));
        if (nodes.length === 0) return;

        const cRect = containerRef.current.getBoundingClientRect();
        const cScroll = containerRef.current.scrollTop;

        const points = nodes.map(n => {
            const r = n.getBoundingClientRect();
            return {
                time: parseInt(n.getAttribute('data-time')),
                y: r.top - cRect.top + cScroll
            };
        }).sort((a, b) => a.time - b.time);

        if (currentWeekMin < points[0].time) {
            setMarkerY(points[0].y);
        } else if (currentWeekMin >= points[points.length-1].time) {
            setMarkerY(points[points.length-1].y);
        } else {
            for (let i = 0; i < points.length - 1; i++) {
                if (currentWeekMin >= points[i].time && currentWeekMin < points[i+1].time) {
                    const elapsed = currentWeekMin - points[i].time;
                    const duration = points[i+1].time - points[i].time;
                    if (duration === 0) continue;
                    const progress = elapsed / duration;
                    const yDiff = points[i+1].y - points[i].y;
                    setMarkerY(points[i].y + yDiff * progress);
                    break;
                }
            }
        }
    }, [currentWeekMin, timetable?.length, expandedGid, isVisible, measureTick]);

    // ResizeObserver: bump measureTick when container lays out so the above effect re-runs
    React.useLayoutEffect(() => {
        if (!containerRef.current) return;
        const ro = new ResizeObserver(() => setMeasureTick(t => t + 1));
        ro.observe(containerRef.current);
        return () => ro.disconnect();
    }, [timetable?.length]);

    const pollingCourses = courses?.filter(c => pollStatus?.[c.gid] === 'polling') || [];
    
    if (loading || (!timetable?.length && pollingCourses.length > 0)) {
        if (!courses || courses.length === 0) {
            return (
                <div className="timetable-grid">
                    {[1,2,3,4].map(i => <Skeleton key={i} type="course-card" />)}
                </div>
            );
        }
        
        const pending = pollingCourses.length > 0 ? pollingCourses : courses;
        return (
            <div className="timetable-grid" style={{ padding: '0 10px 40px 10px', marginTop: '20px' }}>
                <div style={{ textAlign: 'center', color: 'var(--primary)', marginBottom: '15px', fontSize: '0.8rem', letterSpacing: '1px', fontWeight: 'bold' }}>FETCHING SCHEDULES...</div>
                {pending.map((c, i) => (
                    <div key={i} style={{ marginBottom: '15px' }}>
                        <div style={{ fontSize: '0.75rem', fontWeight: 'bold', color: '#fff', marginBottom: '5px' }}>{c.code || c.name}</div>
                        <Skeleton type="session-row" />
                    </div>
                ))}
            </div>
        );
    }

    if (!timetable || timetable.length === 0) {
        if (!courses || courses.length === 0) {
            return <div style={{ textAlign: 'center', padding: '100px 20px', color: '#555', fontSize: '0.8rem', letterSpacing: '2px' }}>NO CLASSES REGISTERED</div>;
        } else {
            return (
                <div style={{ textAlign: 'center', padding: '100px 20px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '15px' }}>
                    <div style={{ color: '#555', fontSize: '0.85rem', letterSpacing: '1px', fontWeight: 'bold' }}>
                        COULD NOT LOAD SCHEDULES
                    </div>
                    <button className="btn" onClick={onRetryFetches} style={{ borderColor: 'var(--primary)', color: 'var(--primary)', padding: '8px 20px', fontWeight: 'bold', cursor: 'pointer' }}>
                        RETRY FETCH
                    </button>
                </div>
            );
        }
    }

    const getCourse = (gid) => courses?.find(c => c.gid === gid);

    const parseMinutes = (tStr) => {
        if (!tStr) return 0;
        const match = tStr.match(/(\d+):(\d+) (AM|PM)/i);
        if (!match) return 0;
        let h = parseInt(match[1]), m = parseInt(match[2]);
        if (match[3].toUpperCase() === 'PM' && h < 12) h += 12;
        if (match[3].toUpperCase() === 'AM' && h === 12) h = 0;
        return h * 60 + m;
    };

    const liveTimeString = activeTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    let foundUpcoming = false;

    return (
        <div style={{ display: 'flex', flexDirection: 'column', flex: '1 1 auto', minHeight: 0 }}>
            <div style={{ display: 'flex', flexDirection: 'row', flex: 1, minHeight: 0, position: 'relative' }}>
                <div className="timetable-grid" style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 'clamp(4px, 1vh, 10px)', marginTop: '5px', padding: '0 10px 40px 45px', overflowY: 'auto', position: 'relative' }} ref={containerRef}>
                
                    {/* Global Timeline Overlay — only show after first real measurement */}
                    {markerY !== null && (
                    <div style={{ 
                        position: 'absolute', left: 0, right: '10px', top: `${markerY}px`, height: '1px', 
                        background: 'linear-gradient(90deg, transparent 0%, var(--primary) 15%, var(--primary) 100%)', 
                        zIndex: 0, pointerEvents: 'none',
                        boxShadow: '0 0 5px rgba(0, 243, 255, 0.4)', transition: 'top 0.5s linear', opacity: 0.8
                    }}>
                        <div style={{ 
                            position: 'absolute', bottom: '2px', left: 0, width: '40px', textAlign: 'right',
                            fontSize: '0.55rem', fontWeight: 'bold', color: 'var(--primary)',
                            lineHeight: 1, textShadow: '0 0 4px #000', letterSpacing: '1px'
                        }}>
                            {currentDayStr.substring(0,3)}
                        </div>
                        <div style={{ 
                            position: 'absolute', top: '3px', left: 0, width: '40px', textAlign: 'right',
                            fontSize: '0.45rem', fontWeight: 'bold', color: 'rgba(255,255,255,0.7)',
                            lineHeight: 1, textShadow: '0 0 4px #000', letterSpacing: '0px'
                        }}>
                            {liveTimeString}
                        </div>
                    </div>
                    )}
                    {days.map(day => {
                const slots = timetable.filter(t => t.day === day).sort((a,b) => parseMinutes(a.start) - parseMinutes(b.start));
                const isToday = day === currentDayStr;
                
                if (slots.length === 0) return null;

                return (
                    <div key={day} style={{ display: 'contents' }}>
                        <div className="day-header time-node" data-time={days.indexOf(day) * 24 * 60} style={{
                            color: isToday ? '#fff' : 'var(--primary)', 
                            fontSize: 'clamp(0.65rem, 1.5vh, 0.8rem)', 
                            fontWeight: 'bold',
                            borderBottom: '1px solid rgba(0, 243, 255, 0.1)',
                            paddingBottom: '2px',
                            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                            flexShrink: 0
                        }}>
                            <span>{day}</span>
                            {isToday && <span style={{color: 'var(--accent)', fontSize: '0.6rem', letterSpacing: '1px'}}>TODAY</span>}
                        </div>
                        {slots.map((t, i) => {
                            const c = getCourse(t.gid);
                            const stat = getStats(c?.sessions);
                            const slotId = t.id || `${t.gid}_${day}_${t.start}`;
                            
                            let isOngoing = false, isUpcoming = false;
                            const sMin = parseMinutes(t.start);
                            const eMin = parseMinutes(t.end);

                            if (isToday) {
                                if (nowMinutes >= sMin && nowMinutes <= eMin) isOngoing = true;
                                else if (nowMinutes < sMin && !foundUpcoming) { isUpcoming = true; foundUpcoming = true; }
                            }
                            
                            const nodeTime = days.indexOf(day) * 24 * 60 + sMin;
                            let statContent = stat.text;
                            if (statContent && statContent.includes('%')) statContent = <><AnimatedPercent value={stat.percent} /></>;

                            const renderTime = (timeStr) => {
                                const short = timeStr.replace(/ (AM|PM)/, '');
                                const ampm = timeStr.includes('AM') ? 'AM' : 'PM';
                                return <>{short}<span style={{ fontSize: '0.65em', opacity: 0.7, marginLeft: '2px' }}>{ampm}</span></>;
                            };

                            return (
                                <React.Fragment key={i}>
                                    <div className="time-slot time-node" data-time={nodeTime} style={{ 
                                        cursor: 'pointer', border: '1px solid var(--grid-line)', overflow: 'hidden', position: 'relative',
                                        background: isOngoing ? 'rgba(0, 243, 255, 0.08)' : isUpcoming ? 'rgba(68, 170, 255, 0.05)' : 'rgba(255, 255, 255, 0.02)',
                                        borderLeft: isOngoing ? '3px solid var(--primary)' : isUpcoming ? '3px solid #44aaff' : '2px solid var(--grid-line)',
                                        padding: '0', borderRadius: '4px',
                                        display: 'flex', flexDirection: 'column', flex: '1 1 auto', justifyContent: 'center'
                                    }}>
                                        {/* Physical Anchor mapped to bottom of relative slot container */}
                                        <div className="time-node" data-time={days.indexOf(day) * 24 * 60 + eMin} style={{ position: 'absolute', bottom: 0, opacity: 0, pointerEvents: 'none' }} />

                                        {isOngoing && (
                                            <div style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, background: 'rgba(0, 243, 255, 0.05)', pointerEvents: 'none' }} />
                                        )}
                                        {isUpcoming && (
                                            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '100%', background: 'linear-gradient(180deg, rgba(68, 170, 255, 0.1) 0%, transparent 100%)', zIndex: 0 }} />
                                        )}
                                        <div 
                                            style={{ padding: '8px 10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', flexShrink: 0, position: 'relative', zIndex: 1 }}
                                            onClick={() => onExpand(t.gid)}
                                        >
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1, minWidth: 0 }}>
                                                <div style={{ fontSize: '0.65rem', fontWeight: 'bold', color: 'var(--accent)', flexShrink: 0, whiteSpace: 'nowrap', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                                                    <div>
                                                        <span style={{ opacity: 0.8 }}>{renderTime(t.start)}</span>
                                                        <span className="desktop-meta" style={{ margin: '0 4px', color: 'rgba(255,255,255,0.3)' }}>-</span>
                                                        <span className="desktop-meta" style={{ opacity: 0.8 }}>{renderTime(t.end)}</span>
                                                    </div>
                                                </div>
                                                <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                        <span style={{ fontSize: 'clamp(0.7rem, 1.5vh, 0.8rem)', fontWeight: 'bold', color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.code}</span>
                                                        <span className="desktop-meta" style={{ fontSize: '0.65rem', color: 'var(--text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c?.name}</span>
                                                    </div>
                                                    <div className="desktop-meta" style={{ fontSize: '0.6rem', color: '#888', textTransform: 'uppercase', marginTop: '2px' }}>
                                                        {t.group} • {t.loc}
                                                    </div>
                                                </div>
                                            </div>
                                            <div className={`stat-badge ${stat.class}`} style={{ margin: 0, fontSize: '0.75rem', fontWeight: 'bold', padding: '2px 6px', flexShrink: 0 }}>
                                                {statContent}
                                            </div>
                                        </div>
                                    </div>
                                </React.Fragment>
                            );
                        })}
                    </div>
                );
            })}
                </div>
            </div>
        </div>
    );
});

export const ActivityList = memo(function ActivityList({ following, organizerDetails, onSelect }) {
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '10px' }}>
            {following?.length === 0 && <div style={{textAlign:'center', color:'#555', padding:'20px'}}>NO ACTIVITIES FOLLOWED</div>}

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
                                    margin: 0,
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
                    <div key={oid} style={{ 
                        display: 'flex', 
                        justifyContent: 'space-between', 
                        alignItems: 'center', 
                        padding: '12px 15px', 
                        border: '1px solid var(--grid-line)', 
                        borderRadius: '4px', 
                        background: 'rgba(255, 255, 255, 0.02)', 
                        borderLeft: '3px solid var(--accent)',
                        cursor: 'pointer' 
                    }} onClick={() => { if(details) onSelect(details); }}>
                        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, paddingRight: '10px' }}>
                            <div style={{ color: '#fff', fontSize: '0.9rem', fontWeight: 'bold', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {details?.name || `Source ${oid}`}
                            </div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: '4px' }}>
                                {meta}
                            </div>
                        </div>
                        {badge && (
                            <div style={{ flexShrink: 0 }}>
                                {badge}
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
});