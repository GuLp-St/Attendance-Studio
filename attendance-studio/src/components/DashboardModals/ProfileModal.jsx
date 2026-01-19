import React from 'react';
import Modal from '../Modal';
import Skeleton from '../Skeleton';

export default function ProfileModal({ isOpen, onClose, user, profileData }) {
    return (
        <Modal title="STUDENT PROFILE" isOpen={isOpen} onClose={onClose}>
            {!profileData ? <Skeleton type="profile" /> : (
                <>
                    <div className="profile-header">
                        <div className="profile-img-container"><div className="profile-glow"></div><img src={`https://studentphotos.unimas.my/${user.matric}.jpg`} className="profile-img" onError={(e) => e.target.style.display='none'} alt="Profile" /></div>
                        <div className="profile-name">{user.name}</div><div className="profile-meta">{user.matric}</div>
                    </div>
                    <div className="profile-grid">
                        <div className="p-item p-full"><span className="p-label">FACULTY</span><div className="p-value">{profileData.namaFakultiBi || '-'}</div></div>
                        <div className="p-item p-full"><span className="p-label">PROGRAM</span><div className="p-value">{profileData.namaProgramBi || '-'}</div></div>
                        <div className="p-item"><span className="p-label">IC NO</span><div className="p-value">{profileData.noKadPengenalan || '-'}</div></div>
                        <div className="p-item"><span className="p-label">EMAIL</span><div className="p-value" style={{ fontSize: '0.8rem', wordBreak: 'break-all' }}>{profileData.email || '-'}</div></div>
                        <div className="p-item"><span className="p-label">STATUS</span><div className="p-value" style={{ color: '#0f0' }}>{profileData.statusPelajarBi || '-'}</div></div>
                        <div className="p-item"><span className="p-label">SESSION</span><div className="p-value">{profileData.kodSesiSem || '-'}</div></div>
                    </div>
                </>
            )}
        </Modal>
    );
}