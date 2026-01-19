import React from 'react';
import Modal from '../Modal';

export default function TargetModal({ isOpen, onClose, result, id, type, onIdChange, onTypeChange, onSearch, onAction, onExempt, onClear }) {
    return (
        <Modal title="MANUAL TARGET" isOpen={isOpen} onClose={onClose}>
            {!result ? (
                <div className="target-form">
                    <select className="t-select" value={type} onChange={onTypeChange} style={{ background: '#000', border: '1px solid var(--text-dim)', color: '#fff', padding: '10px', width: '100%', marginBottom: '10px' }}>
                        <option value="class">CLASS SESSION</option><option value="activity">ACTIVITY / EVENT</option>
                    </select>
                    <input type="number" className="t-input" placeholder="SESSION ID" value={id} onChange={onIdChange} />
                    <button className="btn" style={{ width: '100%', marginTop: '15px', borderColor: 'var(--primary)', color: 'var(--primary)' }} onClick={onSearch}>SEARCH</button>
                </div>
            ) : (
                <div>
                    <div className="t-result" style={{ textAlign: 'center' }}>
                        <div className="t-res-name" style={{ fontSize: '1rem', fontWeight: 'bold', marginBottom: '5px' }}>{result.name || "Unknown"}</div>
                        <div className="t-res-meta" style={{ fontSize: '0.8rem', color: 'var(--text-dim)', marginBottom: '15px' }}>{result.type.toUpperCase()} | ID: {result.id}</div>
                        <div className={`status ${result.status.includes('Present') || result.status.includes('Check') || result.status.includes('Completed') ? 'st-present' : result.status.includes('Exempt') ? 'st-exempt' : 'st-absent'}`}>{result.status}</div>
                    </div>
                    <div style={{ marginTop: '20px', display: 'flex', justifyContent: 'center', gap: '10px', flexWrap: 'wrap' }}>
                        {result.log_id ? (
                            <>
                                {result.can_checkout && <button className="btn btn-scan" onClick={() => onAction('act_scan_out', result.id, null, true)}>SCAN OUT</button>}
                                {result.can_checkout && <button className="btn" onClick={() => onAction('act_manual_out', result.id, null, true)}>MAN OUT</button>}
                                <button className="btn btn-del" onClick={() => onAction(result.type === 'activity' ? 'act_delete' : 'delete', result.log_id, null, result.type === 'activity')}>DELETE</button>
                            </>
                        ) : (
                            <>
                                <button className="btn btn-scan" onClick={() => onAction(result.type === 'activity' ? 'act_scan_in' : 'scan', result.id, null, result.type === 'activity')}>SCAN IN</button>
                                <button className="btn" onClick={() => onAction(result.type === 'activity' ? 'act_manual_in' : 'manual', result.id, null, result.type === 'activity')}>MANUAL IN</button>
                                {result.type === 'class' && <button className="btn btn-exempt" onClick={() => onExempt(result.id, 'TARGET')}>EXEMPT</button>}
                            </>
                        )}
                    </div>
                    <button className="btn" style={{ width: '100%', marginTop: '15px', borderColor: 'var(--text-dim)' }} onClick={onClear}>BACK</button>
                </div>
            )}
        </Modal>
    );
}