import React, { memo } from 'react';
import Skeleton from './Skeleton';
import { ScanLine } from 'lucide-react';

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

export const DashboardHeader = memo(function DashboardHeader({ user, onLoadProfile, onLogout, onTarget, onOpenManager, notifCount }) {
    return (
        <div className="nav-header">
            <div onClick={onLoadProfile} style={{cursor: 'pointer', position: 'relative', display: 'inline-block'}}>
                <h2 className="glitch-text">{user.name}</h2>
                <div style={{ fontSize: '0.8rem', color: 'var(--primary)', marginTop: '2px' }}>ID: {user.matric}</div>
            </div>
            
            <div className="header-actions" style={{ alignItems: 'center' }}>
                {/* Autoscan Manager Button with ScanLine Icon */}
                <button className="icon-btn" onClick={onOpenManager} style={{ marginRight: '5px' }}>
                    <ScanLine size={20} />
                    {notifCount > 0 && <div className="notif-badge">{notifCount}</div>}
                </button>

                <button className="target-btn" onClick={onTarget}>TARGET</button>
                <button className="back-btn" onClick={onLogout}>LOGOUT</button>
            </div>
        </div>
    );
});

export const TimetableView = memo(function TimetableView({ timetable, onClassClick }) {
    const days = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"];
    
    if (timetable.length === 0) return <div style={{textAlign:'center', color:'#555'}}>NO DATA</div>;

    return (
        <div className="timetable-grid">
            {days.map(day => {
                const slots = timetable.filter(t => t.day === day).sort((a,b) => parseTime(a.start) - parseTime(b.start));
                if (slots.length === 0) return null;
                return (
                    <div key={day}>
                        <div className="day-header" style={{color:'var(--text-dim)', fontSize:'0.8rem', marginTop:'10px'}}>{day}</div>
                        {slots.map((t, i) => (
                            <div key={i} className="time-slot" onClick={() => onClassClick(t.gid)}>
                                <div className="time-time">{t.start} - {t.end}</div>
                                <div className="time-course">{t.code}</div>
                                <div className="time-name" style={{color:'#aaa', fontSize:'0.75rem'}}>{t.name}</div>
                                <div className="time-loc">({t.group}) | {t.loc}</div>
                            </div>
                        ))}
                    </div>
                );
            })}
        </div>
    );
});

export const ClassList = memo(function ClassList({ courses, onSelect, loading }) {
    // Show Full Skeleton only if the course list itself hasn't loaded at all
    if (loading) {
        return (
            <div className="course-grid">
                {[1,2,3,4].map(i => <Skeleton key={i} type="course-card" />)}
            </div>
        );
    }

    return (
        <div className="course-grid">
            {courses.map(c => {
                const stat = getStats(c.sessions);
                
                return (
                    <div key={c.gid} className="course-card" onClick={() => onSelect(c)}>
                        <div>
                            <div className="cc-code">{c.code}</div>
                            <div className="cc-group">{c.group}</div>
                        </div>
                        
                        {/* Stats Badge */}
                        <div className={`stat-badge ${stat.class}`}>
                            {stat.text}
                        </div>

                        {/* Progress Bar with Slow Grow Animation */}
                        <div className="progress-line">
                            <div 
                                className="progress-fill" 
                                style={{ 
                                    width: `${stat.percent}%`, 
                                    background: stat.barColor,
                                    // CSS transition handles the 0 -> X% animation smoothly
                                    transition: 'width 1s cubic-bezier(0.4, 0, 0.2, 1), background-color 0.5s ease'
                                }}
                            ></div>
                        </div>
                    </div>
                );
            })}
        </div>
    );
});

export const ActivityList = memo(function ActivityList({ following, organizerDetails, onSelect, onAdd }) {
    return (
        <div className="course-grid">
            <button className="btn" style={{ gridColumn: '1 / -1', borderStyle: 'dashed', padding: '15px', color: '#888' }} onClick={onAdd}>
                + ADD ACTIVITY SOURCE
            </button>
            
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