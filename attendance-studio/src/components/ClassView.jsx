import React from 'react';
import { ExpandedProgress, getStats } from './DashboardViews';

export default function ClassView({ course, timetableEntry, sessions, onClose, onAction, onExempt, onAutoscan, onCancelAutoscan, isLoading, actionLoading }) {
    if (!course) return null;
    return (
        <div style={{ width: '100%', display: 'flex', flexDirection: 'column', flex: '1 0 auto' }}>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '20px', paddingTop: '15px' }}>
                <button 
                    className="btn" 
                    style={{ borderColor: 'var(--accent)', color: 'var(--accent)', padding: '8px 25px', fontWeight: 'bold' }} 
                    onClick={onClose}
                >
                    {'◄ GO BACK'}
                </button>
            </div>
            
            {/* Body */}
            <div style={{ flex: '1 0 auto', display: 'flex', flexDirection: 'column', padding: '0 15px 15px 15px' }}>
                <div style={{ textAlign: 'center', fontWeight: 'bold', fontSize: 'clamp(0.85rem, 2vh, 1.1rem)', color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: '4px' }}>
                    {course.code}
                </div>
                <div style={{ fontSize: 'clamp(0.7rem, 1.5vh, 0.9rem)', color: 'var(--text-dim)', textAlign: 'center', marginBottom: '6px' }}>
                    {course.name}
                </div>
                {timetableEntry && (
                    <div style={{ fontSize: 'clamp(0.6rem, 1.2vh, 0.75rem)', color: '#888', textAlign: 'center', textTransform: 'uppercase', marginBottom: '15px', letterSpacing: '1px' }}>
                        <span style={{ color: 'var(--accent)' }}>{timetableEntry.group}</span> • {timetableEntry.loc}
                    </div>
                )}
                
                <ExpandedProgress 
                    stat={getStats(sessions)} 
                    isFirstExpand={true} 
                    statContent={getStats(sessions).text} 
                    c={course} 
                    actionLoading={actionLoading} 
                    onCancelAutoscan={onCancelAutoscan} 
                    onAutoscan={onAutoscan} 
                    isLoadingSessions={isLoading} 
                    sessionsForExpanded={sessions} 
                    onAction={onAction} 
                    onExempt={onExempt} 
                />
            </div>
        </div>
    );
}
