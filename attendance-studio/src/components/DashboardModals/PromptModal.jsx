import React, { useState } from 'react';
import Modal from '../Modal';

export default function PromptModal({ isOpen, onClose, onSubmit }) {
    const [val, setVal] = useState('');
    return (
        <Modal title="EXEMPTION REASON" isOpen={isOpen} onClose={onClose} maxWidth="350px">
            <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)', marginBottom: '10px' }}>ENTER REASON (e.g. MC, EVENT)</div>
                <input type="text" className="t-input" value={val} onChange={e => setVal(e.target.value)} style={{ width: '100%', marginBottom: '20px', textAlign: 'center' }} placeholder="Reason..." />
                <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
                    <button className="btn btn-exempt" style={{ minWidth: '80px' }} onClick={() => { onSubmit(val); setVal(''); }}>CONFIRM</button>
                    <button className="btn" style={{ minWidth: '80px' }} onClick={onClose}>CANCEL</button>
                </div>
            </div>
        </Modal>
    );
}