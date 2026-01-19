import React from 'react';

export default function Modal({ title, isOpen, onClose, children, maxWidth = "500px" }) {
  if (!isOpen) return null;

  const handleOverlayClick = (e) => {
    // Only close if we clicked the backdrop (modal-overlay) specifically
    if (e.target.classList.contains('modal')) {
      e.stopPropagation(); // Prevent bubbling
      onClose();
    }
  };

  return (
    <div className="modal active" onClick={handleOverlayClick}>
      <div className="modal-box" style={{ maxWidth }}>
        <div className="modal-header">
          <div style={{ color: 'var(--primary)', fontWeight: 'bold' }}>{title}</div>
          <div 
            style={{ cursor: 'pointer', padding: '5px' }} 
            onClick={(e) => { e.stopPropagation(); onClose(); }}
          >
            ✕
          </div>
        </div>
        <div className="modal-body">
          {children}
        </div>
      </div>
    </div>
  );
}