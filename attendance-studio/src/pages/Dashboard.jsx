import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { useConfirm } from '../contexts/ConfirmContext';
import { api } from '../services/api';
import Modal from '../components/Modal';
import OrgSearchModal from '../components/DashboardModals/OrgSearchModal';

// UI Components
import { 
    DashboardHeader, 
    TimetableView, 
    ClassList, 
    ActivityList 
} from '../components/DashboardViews';

// Modal Components
import ClassModal from '../components/DashboardModals/ClassModal';
import ActivityModal from '../components/DashboardModals/ActivityModal';
import ProfileModal from '../components/DashboardModals/ProfileModal';
import TargetModal from '../components/DashboardModals/TargetModal';
import PromptModal from '../components/DashboardModals/PromptModal';
import AutoscanManagerModal from '../components/DashboardModals/AutoscanManagerModal';

export default function Dashboard() {
  const { user, setUser, logout } = useAuth();
  const { showToast } = useToast();
  const { confirm } = useConfirm();
  
  // =========================================================================
  // STATE MANAGEMENT
  // =========================================================================

  // UI State
  const [activeTab, setActiveTab] = useState('modules');
  const [showTimetable, setShowTimetable] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false); 
  const [notifications, setNotifications] = useState([]);
  
  // Modal Data State
  const [selectedCourse, setSelectedCourse] = useState(null);
  const [selectedOrg, setSelectedOrg] = useState(null);
  const [courseSessions, setCourseSessions] = useState(null);
  const [profileData, setProfileData] = useState(null);
  const [targetResult, setTargetResult] = useState(null);
  
  // Modal Visibility State
  const [showOrgSearch, setShowOrgSearch] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [showTarget, setShowTarget] = useState(false);
  const [showAutoscanMode, setShowAutoscanMode] = useState(false);
  const [showAutoscanManager, setShowAutoscanManager] = useState(false);
  
  // Action State
  const [targetId, setTargetId] = useState('');
  const [targetType, setTargetType] = useState('class');
  const [pendingAutoscan, setPendingAutoscan] = useState(null);
  const [promptConfig, setPromptConfig] = useState(null); // { sid, gid }

  // =========================================================================
  // 1. HISTORY & NAVIGATION LOGIC (HASH BASED)
  // =========================================================================
  
  // Helper: Open a Modal (Level 3)
  const openLevel3 = (setter, value = true) => {
      setter(value);
      window.location.hash = 'dashboard/modal';
  };

  // Helper: Open an Overlay (Level 4)
  const openLevel4 = (setter, value = true) => {
      setter(value);
      window.location.hash = 'dashboard/modal/overlay';
  };

  // Helper: Close Current Level (Back)
  const closeCurrentLevel = () => {
      window.history.back(); 
  };

  // Use a ref for logout to avoid dependency cycles in useEffect
  const logoutRef = useRef(logout);
  useEffect(() => { logoutRef.current = logout; }, [logout]);

  useEffect(() => {
      // 1. Set initial state
      window.location.hash = 'dashboard';

      // 2. The "Router" Logic
      const handleHashChange = () => {
          const hash = window.location.hash;

          // LEVEL 4: Overlay Active
          if (hash === '#dashboard/modal/overlay') {
              // Ensure L3 stays open, L4 opens
              // (No action needed, setters are called by UI)
          }
          // LEVEL 3: Modal Active (Close Overlays)
          else if (hash === '#dashboard/modal') {
              setShowAutoscanMode(false);
              setPromptConfig(null);
          }
          // LEVEL 2: Dashboard (Close Modals)
          else if (hash === '#dashboard') {
              // Close L4
              setShowAutoscanMode(false);
              setPromptConfig(null);
              
              // Close L3
              setSelectedCourse(null);
              setSelectedOrg(null);
              setShowProfile(false);
              setShowTarget(false);
              setShowOrgSearch(false);
              setShowAutoscanManager(false);
          }
          // LEVEL 1: Exit (Hash is empty or different)
          else {
              // If we are not in a "safe" hash (like #confirm used by ConfirmContext), logout.
              if (hash !== '#confirm') {
                  logoutRef.current();
              }
          }
      };

      window.addEventListener('popstate', handleHashChange);
      // Also listen to hashchange for extra robustness
      window.addEventListener('hashchange', handleHashChange);
      
      return () => {
          window.removeEventListener('popstate', handleHashChange);
          window.removeEventListener('hashchange', handleHashChange);
      };
  }, []);

  // =========================================================================
  // 2. DATA LOADING
  // =========================================================================
  
  useEffect(() => {
    if (!user) return;

    // A. Fetch Class Sessions
    user.courses.forEach(async (c) => {
      if (!c.sessions) {
        try {
          const sessions = await api.get(`/course_details?gid=${c.gid}&matric=${user.matric}`);
          
          // Guard clause: Check if user is still logged in
          setUser(prev => {
             if (!prev) return null; 
             return { 
                ...prev, 
                courses: prev.courses.map(pc => pc.gid === c.gid ? { ...pc, sessions } : pc) 
             };
          });
        } catch(e) {}
      }
    });

    // B. Fetch Organizers
    if (user.following?.length > 0) {
        user.following.forEach(async (oid) => {
            if (user.organizerDetails?.[oid]) return;
            try {
                const data = await api.get(`/organizer_details?oid=${oid}&matric=${user.matric}`);
                if (!data.error) {
                    setUser(prev => {
                        if (!prev) return null; 
                        return { 
                            ...prev, 
                            organizerDetails: { ...prev.organizerDetails, [oid]: data } 
                        };
                    });
                }
            } catch (e) {}
        });
    }

    // C. Fetch Notifications
    const fetchNotifs = async () => {
        try {
            const data = await api.get(`/notifications?matric=${user.matric}`);
            if (Array.isArray(data)) setNotifications(data);
        } catch (e) {}
    };
    fetchNotifs();

  }, [user.following, user.matric, setUser]);

  // D. Live Update Modal (When data arrives while modal is open)
  useEffect(() => {
      if (selectedCourse) {
          const updatedCourse = user.courses.find(c => c.gid === selectedCourse.gid);
          if (updatedCourse && updatedCourse.sessions) {
              setCourseSessions(updatedCourse.sessions);
              setLoadingDetail(false); // Stop skeleton
          }
      }
  }, [user.courses, selectedCourse]);

  // =========================================================================
  // 3. CORE ACTIONS
  // =========================================================================
  
  const handleAction = async (type, sid, gid, isOrg = false, remark = "") => {
    try {
        setLoadingDetail(true); // Trigger Skeleton
        
        // Map 'sid' to 'lid' because backend expects 'lid' for deletions
        const payload = { type, sid, gid, matric: user.matric, lid: sid, remark };
        
        const res = await api.post('/action', payload);
        
        showToast(
            res.msg || "Success", 
            res.msg?.includes('Fail') || res.msg?.includes('Error') ? 'error' : 'success'
        );
        
        // Refresh Data Context
        if (targetResult) {
            await fetchTarget();
        } else if (isOrg && selectedOrg) {
            const newData = await api.get(`/organizer_details?oid=${gid}&matric=${user.matric}`);
            setUser(prev => {
                if (!prev) return null;
                return { ...prev, organizerDetails: { ...prev.organizerDetails, [gid]: newData } };
            });
            setSelectedOrg(newData);
        } else if (selectedCourse) {
            const newData = await api.get(`/course_details?gid=${gid}&matric=${user.matric}`);
            setCourseSessions(newData);
            setUser(prev => {
                if (!prev) return null;
                return { ...prev, courses: prev.courses.map(c => c.gid === gid ? { ...c, sessions: newData } : c) };
            });
        }
    } catch (e) { 
        showToast(e.message, 'error'); 
    } finally {
        setLoadingDetail(false);
    }
  };

  const dismissNotification = async (nid) => {
      try {
          setNotifications(prev => prev.filter(n => n.id !== nid));
          await api.delete(`/notifications?id=${nid}&matric=${user.matric}`);
      } catch (e) { 
          console.error("Failed to dismiss", e); 
      }
  };

  // =========================================================================
  // 4. UI HANDLERS
  // =========================================================================

  const loadProfile = async () => {
      openLevel3(setShowProfile, true);
      
      // Fetch notifications to ensure badge is up to date
      try {
          const notifData = await api.get(`/notifications?matric=${user.matric}`);
          if (Array.isArray(notifData)) setNotifications(notifData);
      } catch(e) {}

      if (!profileData) {
          try {
              const data = await api.get(`/profile?matric=${user.matric}`);
              if (!data.error) setProfileData(data);
          } catch(e) { showToast("Failed to load profile", "error"); }
      }
  };

  const loadManager = async () => {
      openLevel3(setShowAutoscanManager, true);
      try { 
          const notifs = await api.get(`/notifications?matric=${user.matric}`); 
          if (Array.isArray(notifs)) setNotifications(notifs); 
      } catch (e) {}
  };

  const fetchTarget = async () => {
      if (!targetId) return;
      try {
          const res = await api.get(`/target_details?matric=${user.matric}&sid=${targetId}&type=${targetType}`);
          if (res.error) showToast(res.error, "error"); 
          else setTargetResult(res);
      } catch (e) { showToast(e.message, "error"); }
  };

  const openCourseModal = (c) => {
      openLevel3(setSelectedCourse, c); 
      setCourseSessions(c.sessions || null);
      if(!c.sessions) setLoadingDetail(true);
  };

  const openOrgModal = (details) => {
       openLevel3(setSelectedOrg, details);
  };

  const openTargetSearch = () => {
      setTargetResult(null);
      openLevel3(setShowTarget, true);
  };

  const openOrgSearch = () => {
      openLevel3(setShowOrgSearch, true);
  };

  const openCourseByGid = (gid) => {
      const course = user.courses.find(c => c.gid === gid);
      if (course) openCourseModal(course);
      else showToast("Course details not found", "error");
  };

  const followOrg = async (oid) => {
      try {
          await api.post('/action', { type: 'follow_org', sid: oid, matric: user.matric });
          closeCurrentLevel(); 
          if (!user.following.includes(oid)) {
               setUser(prev => prev ? { ...prev, following: [...prev.following, oid] } : null);
          }
          showToast("Followed", "success");
      } catch (e) { showToast(e.message, 'error'); }
  };

  const unfollowOrg = async (oid) => {
      if (!await confirm("Unfollow?")) return;
      try {
          await api.post('/action', { type: 'unfollow_org', sid: oid, matric: user.matric });
          closeCurrentLevel();
          setSelectedOrg(null);
          setUser(prev => prev ? { ...prev, following: prev.following.filter(id => id !== oid) } : null);
          showToast("Unfollowed", "success");
      } catch (e) { showToast(e.message, 'error'); }
  };
  
  const initAutoscan = (id, isOrg) => { 
      setPendingAutoscan({ id, isOrg }); 
      openLevel4(setShowAutoscanMode, true); 
  };

  const confirmAutoscan = async (mode) => {
      closeCurrentLevel(); // Close Mode Selector
      const { id, isOrg } = pendingAutoscan;
      try {
          await api.post('/action', { type: 'autoscan', gid: id, matric: user.matric, mode, job_type: isOrg ? 'activity' : 'class' });
          showToast(`Activated (${mode})`, "success");
          
          if (isOrg) {
              const u = { ...user.organizerDetails[id], autoscan_active: true };
              setUser(prev => prev ? { ...prev, organizerDetails: { ...prev.organizerDetails, [id]: u } } : null);
              if (selectedOrg?.id === id) setSelectedOrg(u);
          } else {
              setUser(prev => prev ? { ...prev, courses: prev.courses.map(c => c.gid === id ? { ...c, autoscan_active: true } : c) } : null);
              if (selectedCourse?.gid === id) setSelectedCourse(prev => ({ ...prev, autoscan_active: true }));
          }
      } catch (e) { showToast(e.message, 'error'); }
  };

  const cancelAutoscan = async (id, isOrg) => {
      if (!await confirm("Stop Autoscan?")) return;
      try {
          await api.post('/action', { type: 'cancel_autoscan', gid: id, matric: user.matric });
          showToast("Stopped", "success");
          
          if (isOrg) {
              const u = { ...user.organizerDetails[id], autoscan_active: false };
              setUser(prev => prev ? { ...prev, organizerDetails: { ...prev.organizerDetails, [id]: u } } : null);
              if (selectedOrg?.id === id) setSelectedOrg(u);
          } else {
              setUser(prev => prev ? { ...prev, courses: prev.courses.map(c => c.gid === id ? { ...c, autoscan_active: false } : c) } : null);
              if (selectedCourse?.gid === id) setSelectedCourse(prev => ({ ...prev, autoscan_active: false }));
          }
      } catch (e) { showToast(e.message, 'error'); }
  };

  const openExemptPrompt = (sid, gid) => { 
      openLevel4(setPromptConfig, { sid, gid }); 
  };

  const handleExemptSubmit = (reason) => {
      if (!promptConfig) return;
      handleAction('exempt', promptConfig.sid, promptConfig.gid, false, reason);
      closeCurrentLevel();
  };

  // =========================================================================
  // 5. RENDER
  // =========================================================================
  return (
    <div style={{ display: 'block' }}>
      
      <DashboardHeader 
          user={user} 
          onLoadProfile={loadProfile} 
          onLogout={logout} 
          onTarget={openTargetSearch} 
          onOpenManager={loadManager} 
          notifCount={notifications.length}
      />

      <button 
          className="btn" 
          style={{ width: '100%', marginBottom: '15px', borderColor: showTimetable ? 'var(--text-dim)' : 'var(--primary)', color: showTimetable ? 'var(--text-dim)' : 'var(--primary)' }} 
          onClick={() => setShowTimetable(!showTimetable)}
      >
        {showTimetable ? 'HIDE TIMETABLE' : 'SHOW TIMETABLE'}
      </button>

      {showTimetable && (
          <TimetableView timetable={user.timetable} onClassClick={openCourseByGid} />
      )}

      <div style={{ display: 'flex', gap: '10px', marginTop: '20px', marginBottom: '15px' }}>
        <button 
            className="btn" 
            style={activeTab === 'modules' ? { flex: 1, borderColor: 'var(--primary)', color: 'var(--primary)', background: 'rgba(0,243,255,0.1)' } : { flex: 1 }} 
            onClick={() => setActiveTab('modules')}
        >
            CLASSES
        </button>
        <button 
            className="btn" 
            style={activeTab === 'org' ? { flex: 1, borderColor: 'var(--accent)', color: 'var(--accent)', background: 'rgba(255,158,0,0.1)' } : { flex: 1 }} 
            onClick={() => setActiveTab('org')}
        >
            ACTIVITIES
        </button>
      </div>

      {/* MAIN LISTS */}
      {activeTab === 'modules' ? (
          <ClassList 
              courses={user.courses} 
              onSelect={openCourseModal} 
              loading={!user.courses.length && user.courses !== undefined}
          />
      ) : (
          <ActivityList 
              following={user.following} 
              organizerDetails={user.organizerDetails} 
              onSelect={openOrgModal} 
              onAdd={openOrgSearch} 
          />
      )}

      {/* ================= MODALS ================= */}

      {/* 1. CLASS DETAILS */}
      {!!selectedCourse && (
        <ClassModal 
            isOpen={!!selectedCourse} 
            onClose={closeCurrentLevel} 
            course={selectedCourse} 
            sessions={courseSessions} 
            isLoading={loadingDetail} 
            onAction={handleAction} 
            onExempt={openExemptPrompt} 
            onAutoscan={initAutoscan} 
            onCancelAutoscan={cancelAutoscan} 
        />
      )}

      {/* 2. ACTIVITY DETAILS */}
      {!!selectedOrg && (
        <ActivityModal 
            isOpen={!!selectedOrg} 
            onClose={closeCurrentLevel} 
            org={selectedOrg} 
            isLoading={loadingDetail} 
            onAction={handleAction} 
            onAutoscan={initAutoscan} 
            onCancelAutoscan={cancelAutoscan} 
            onUnfollow={unfollowOrg} 
        />
      )}

      {/* 3. PROFILE */}
      <ProfileModal 
          isOpen={showProfile} 
          onClose={closeCurrentLevel} 
          user={user} 
          profileData={profileData} 
      />
      
      {/* 4. NEW: Autoscan Manager with Notifications */}
      <AutoscanManagerModal 
          isOpen={showAutoscanManager} 
          onClose={closeCurrentLevel} 
          user={user} 
          notifications={notifications} 
          onDismissNotif={dismissNotification} 
          onCancelJob={cancelAutoscan} 
      />

      {/* 5. MANUAL TARGET */}
      <TargetModal 
          isOpen={showTarget} 
          onClose={closeCurrentLevel} 
          result={targetResult} 
          id={targetId} 
          type={targetType} 
          onIdChange={e => setTargetId(e.target.value)} 
          onTypeChange={e => setTargetType(e.target.value)} 
          onSearch={fetchTarget} 
          onAction={handleAction} 
          onExempt={openExemptPrompt} 
          onClear={() => setTargetResult(null)} 
      />
      
      {/* 6. ADD ACTIVITY SOURCE */}
      <OrgSearchModal 
          isOpen={showOrgSearch} 
          onClose={closeCurrentLevel} 
          onFollow={followOrg} 
      />
      
      {/* 7. AUTOSCAN MODE SELECTOR */}
      <Modal title="SELECT MODE" isOpen={showAutoscanMode} onClose={closeCurrentLevel} maxWidth="400px">
          <div style={{textAlign:'center'}}>
              <div style={{marginBottom:'20px', fontSize:'0.8rem', color:'#ccc'}}>Choose trigger mode.</div>
              <button 
                  className="btn" 
                  onClick={() => confirmAutoscan('crowd')} 
                  style={{width:'100%', marginBottom:'10px', borderColor:'var(--accent)', color:'var(--accent)', padding:'15px'}}
              >
                  <div style={{fontWeight:'bold'}}>CROWD MODE</div>
                  <div style={{fontSize:'0.65rem', opacity:0.7}}>Scans when {'>'} 5 people present</div>
              </button>
              <button 
                  className="btn" 
                  onClick={() => confirmAutoscan('time')} 
                  style={{width:'100%', borderColor:'var(--primary)', color:'var(--primary)', padding:'15px'}}
              >
                  <div style={{fontWeight:'bold'}}>LAST MINUTE MODE</div>
                  <div style={{fontSize:'0.65rem', opacity:0.7}}>Scans in last 20 mins</div>
              </button>
          </div>
      </Modal>

      {/* 8. EXEMPT REASON PROMPT */}
      <PromptModal 
          isOpen={!!promptConfig} 
          onClose={closeCurrentLevel} 
          onSubmit={handleExemptSubmit} 
      />

    </div>
  );
}