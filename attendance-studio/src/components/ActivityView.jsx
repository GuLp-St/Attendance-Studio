import React from 'react';
import Skeleton from './Skeleton';
import SessionRow from './DashboardModals/SessionRow';

export default function ActivityView({ org, onClose, onAction, onAutoscan, onCancelAutoscan, onUnfollow, isLoading }) {
    return (
        <div style={{ marginTop: '10px', width: '100%', maxWidth: '450px', margin: '0 auto', display: 'flex', flexDirection: 'column' }}>
            <div style={{ textAlign: 'center', marginBottom: '20px', width: '100%' }}>
                <button 
                    className="btn" 
                    style={{ borderColor: 'var(--accent)', color: 'var(--accent)', padding: '8px 25px', fontWeight: 'bold' }} 
                    onClick={onClose}
                >
                    {'◄ GO BACK'}
                </button>
            </div>
            <div style={{ fontSize: '1rem', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '15px', textAlign: 'center' }}>{org?.name || 'ACTIVITY'}</div>
            <button className="btn" style={{ width: '100%', marginBottom: '10px', borderColor: '#f00', color: '#f00' }} onClick={() => onUnfollow(org.id)}>UNFOLLOW</button>
            <div style={{ marginBottom: '20px', paddingBottom: '10px' }}>
                {org?.autoscan_active ? (
                    <div style={{ textAlign: 'center' }}><button className="btn" style={{ width: '100%', borderColor: '#f00', color: '#f00', fontWeight: 'bold' }} onClick={() => onCancelAutoscan(org.id, true)}>[ DEACTIVATE AUTOSCAN ]</button><div style={{ color: '#f00', fontSize: '0.7rem', marginTop: '5px' }}>SCANNER ACTIVE (NEXT EVENT)</div></div>
                ) : (
                    <div style={{ textAlign: 'center' }}><button className="btn" style={{ width: '100%', borderColor: 'var(--accent)', color: 'var(--accent)', fontWeight: 'bold' }} onClick={() => onAutoscan(org?.id, true)}>[ ACTIVATE AUTOSCAN ]</button></div>
                )}
            </div>
            {(isLoading) ? <><Skeleton type="session-row" /><Skeleton type="session-row" /></> 
            : org?.activities?.length > 0 ? org.activities.map(act => <SessionRow key={act.id} s={act} isOrg={true} parentId={org.id} onAction={onAction} />) 
            : <div style={{ textAlign: 'center', padding: '20px' }}>NO EVENTS</div>}
        </div>
    );
}
