import React from 'react';
import Modal from '../Modal';
import Skeleton from '../Skeleton';
import SessionRow from './SessionRow';

export default function ClassModal({ course, sessions, isOpen, onClose, onAction, onExempt, onAutoscan, onCancelAutoscan, isLoading }) {
    const title = course ? `${course.code} - ${course.name}` : '';
    return (
        <Modal title={title} isOpen={isOpen} onClose={onClose}>
            <div style={{ marginBottom: '15px', borderBottom: '1px solid var(--grid-line)', paddingBottom: '15px' }}>
                {course?.autoscan_active ? (
                    <div style={{ textAlign: 'center' }}><button className="btn" style={{ width: '100%', borderColor: '#f00', color: '#f00', fontWeight: 'bold' }} onClick={() => onCancelAutoscan(course.gid, false)}>[ DEACTIVATE AUTOSCAN ]</button><div style={{ color: '#f00', fontSize: '0.7rem', marginTop: '5px' }}>SCANNER ACTIVE</div></div>
                ) : (
                    <div style={{ textAlign: 'center' }}><button className="btn" style={{ width: '100%', borderColor: 'var(--primary)', color: 'var(--primary)', fontWeight: 'bold' }} onClick={() => onAutoscan(course?.gid, false)}>[ ACTIVATE AUTOSCAN ]</button><div style={{ color: 'var(--text-dim)', fontSize: '0.7rem', marginTop: '5px' }}>SYSTEM WILL AUTOSCAN NEXT SESSION</div></div>
                )}
            </div>
            {(isLoading || sessions === null) ? <><Skeleton type="session-row" /><Skeleton type="session-row" /></> 
            : sessions.length > 0 ? sessions.map(s => <SessionRow key={s.id} s={s} parentId={course?.gid} fallbackName={course?.code} onAction={onAction} onExempt={onExempt} />) 
            : <div style={{ textAlign: 'center', padding: '20px' }}>NO SESSIONS</div>}
        </Modal>
    );
}