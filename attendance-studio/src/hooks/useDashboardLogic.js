import { useState, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { useConfirm } from '../contexts/ConfirmContext';
import { api } from '../services/api';

export function useDashboardLogic() {
    const { user, setUser, logout } = useAuth();
    const { showToast } = useToast();
    const { confirm } = useConfirm();

    const [loadingDetail, setLoadingDetail] = useState(false);
    const [notifications, setNotifications] = useState([]);
    const [profileData, setProfileData] = useState(null);

    // --- FETCHING ---
    const fetchNotifications = useCallback(async () => {
        if (!user) return;
        try {
            const data = await api.get(`/notifications?matric=${user.matric}`);
            if (Array.isArray(data)) setNotifications(data);
        } catch (e) {}
    }, [user]);

    const fetchProfile = async () => {
        // Always fetch notifications to ensure badge is up to date
        fetchNotifications();
        if (!profileData) {
            try {
                const data = await api.get(`/profile?matric=${user.matric}`);
                if (!data.error) setProfileData(data);
            } catch (e) { showToast("Failed to load profile", "error"); }
        }
    };

    const fetchCourseSessions = async (gid) => {
        try {
            const data = await api.get(`/course_details?gid=${gid}&matric=${user.matric}`);
            // Update global user state so standard view reflects changes
            setUser(prev => ({
                ...prev,
                courses: prev.courses.map(c => c.gid === gid ? { ...c, sessions: data } : c)
            }));
            return data;
        } catch (e) { return null; }
    };

    const fetchOrganizerDetails = async (oid) => {
        try {
            const data = await api.get(`/organizer_details?oid=${oid}&matric=${user.matric}`);
            if (!data.error) {
                setUser(prev => ({
                    ...prev,
                    organizerDetails: { ...prev.organizerDetails, [oid]: data }
                }));
                return data;
            }
        } catch (e) {}
        return null;
    };

    // --- ACTIONS ---
    const handleAction = async (payload, onSuccess) => {
        setLoadingDetail(true);
        try {
            const res = await api.post('/action', { ...payload, matric: user.matric });
            showToast(res.msg || "Success", res.msg?.includes('Fail') || res.msg?.includes('Error') ? 'error' : 'success');
            if (onSuccess) await onSuccess();
        } catch (e) {
            showToast(e.message, 'error');
        } finally {
            setLoadingDetail(false);
        }
    };

    const handleAutoscan = async (action, id, mode, isOrg) => {
        try {
            if (action === 'start') {
                await api.post('/action', { type: 'autoscan', gid: id, matric: user.matric, mode, job_type: isOrg ? 'activity' : 'class' });
                showToast(`Activated (${mode})`, "success");
            } else {
                if (!await confirm("Stop Autoscan?")) return;
                await api.post('/action', { type: 'cancel_autoscan', gid: id, matric: user.matric });
                showToast("Deactivated", "success");
            }

            // Optimistic UI Update
            if (isOrg) {
                const updatedOrg = { ...user.organizerDetails[id], autoscan_active: (action === 'start') };
                setUser(prev => ({ ...prev, organizerDetails: { ...prev.organizerDetails, [id]: updatedOrg } }));
            } else {
                setUser(prev => ({
                    ...prev,
                    courses: prev.courses.map(c => c.gid === id ? { ...c, autoscan_active: (action === 'start') } : c)
                }));
            }
        } catch (e) { showToast(e.message, 'error'); }
    };

    const dismissNotification = async (nid) => {
        setNotifications(prev => prev.filter(n => n.id !== nid));
        try { await api.delete(`/notifications?id=${nid}&matric=${user.matric}`); } catch (e) {}
    };

    const followOrg = async (oid) => {
        try {
            await api.post('/action', { type: 'follow_org', sid: oid, matric: user.matric });
            if (!user.following.includes(oid)) setUser(prev => ({ ...prev, following: [...prev.following, oid] }));
            showToast("Followed", "success");
            return true;
        } catch (e) { showToast(e.message, 'error'); return false; }
    };

    const unfollowOrg = async (oid) => {
        if (!await confirm("Unfollow?")) return false;
        try {
            await api.post('/action', { type: 'unfollow_org', sid: oid, matric: user.matric });
            setUser(prev => ({ ...prev, following: prev.following.filter(id => id !== oid) }));
            showToast("Unfollowed", "success");
            return true;
        } catch (e) { showToast(e.message, 'error'); return false; }
    };

    return {
        user, setUser, logout, confirm,
        loadingDetail, setLoadingDetail,
        notifications, profileData,
        fetchNotifications, fetchProfile, fetchCourseSessions, fetchOrganizerDetails,
        handleAction, handleAutoscan, dismissNotification, followOrg, unfollowOrg
    };
}