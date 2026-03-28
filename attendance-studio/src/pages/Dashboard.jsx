import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { useConfirm } from '../contexts/ConfirmContext';
import { api } from '../services/api';
import Modal from '../components/Modal';

// UI Components
import { 
    DashboardHeader, 
    TimetableList, 
    ActivityList 
} from '../components/DashboardViews';

import ActivityView from '../components/ActivityView';
import OrgSearchView from '../components/OrgSearchView';
import ToolsView from '../components/ToolsView';
import DirectoryView from '../components/DirectoryView';
import Skeleton from '../components/Skeleton';

import SchedulerView from '../components/SchedulerView';

// Modal Components
import PromptModal from '../components/DashboardModals/PromptModal';

export default function Dashboard() {
  const { user, setUser, logout } = useAuth();
  const { showToast } = useToast();
  const { confirm } = useConfirm();
  
  // =========================================================================
  // STATE MANAGEMENT
  // =========================================================================

  // UI State
  const [activeTab, setActiveTab] = useState('modules');
  const [loadingDetail, setLoadingDetail] = useState(false); 
  const [notifications, setNotifications] = useState([]);
  
  // Modal Data State
  const [selectedCourse, setSelectedCourse] = useState(null);
  const [selectedOrg, setSelectedOrg] = useState(null);
  const [orgPreview, setOrgPreview] = useState(null); // Preview for unfollowed orgs from search
  const [courseSessions, setCourseSessions] = useState(null);
  
  // Modal Visibility State
  const [showOrgSearch, setShowOrgSearch] = useState(false);
  const [showAutoscanMode, setShowAutoscanMode] = useState(false);
  const [modalTriggerMode, setModalTriggerMode] = useState('crowd');
  const [modalAutoMode, setModalAutoMode] = useState('onetime');
  
  // Action State
  const [actionLoading, setActionLoading] = useState(null);
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
              setOrgPreview(null);
              setShowOrgSearch(false);
          }
          // ToolsView deep navigation - handled internally by ToolsView, just ignore here
          else if (hash === '#dashboard/tools') {
              // ToolsView's own popstate listener handles this back-nav
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

  // E. Lazy Load Profile
  useEffect(() => {
      if (user?.courses && user?.timetable && !user?.profile) {
          api.get(`/profile?matric=${user.matric}`).then(data => {
              if (!data.error) setUser(prev => prev ? { ...prev, profile: data } : null);
          }).catch(() => {});
      }
  }, [user]);

  // =========================================================================
  // 3. CORE ACTIONS
  // =========================================================================
  
  const handleAction = async (type, sid, gid, isOrg = false, remark = "") => {
    try {
        // Confirm before deleting attendance
        if (type === 'delete') {
            if (!await confirm(`Remove this attendance record?`)) return;
        }
        setLoadingDetail(true); // Trigger Skeleton
        
        // Map 'sid' to 'lid' because backend expects 'lid' for deletions
        const payload = { type, sid, gid, matric: user.matric, lid: sid, remark };
        
        const res = await api.post('/action', payload);
        
        showToast(
            res.msg || "Success", 
            res.msg?.includes('Fail') || res.msg?.includes('Error') ? 'error' : 'success'
        );
        
        // Refresh Data Context
        if (isOrg && selectedOrg) {
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

  const loadManager = async () => {
      setActiveTab('scheduler');
      try { 
          const notifs = await api.get(`/notifications?matric=${user.matric}`); 
          if (Array.isArray(notifs)) setNotifications(notifs); 
      } catch (e) {}
  };

  const openCourseModal = (c) => {
      openLevel3(setSelectedCourse, c); 
      setCourseSessions(c.sessions || null);
      if(!c.sessions) setLoadingDetail(true);
  };

  const openOrgModal = (details) => {
       openLevel3(setSelectedOrg, details);
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
      setActionLoading(`follow_${oid}`);
      try {
          await api.post('/action', { type: 'follow_org', sid: oid, matric: user.matric });
          closeCurrentLevel(); 
          setOrgPreview(null);
          if (!user.following.includes(oid)) {
               setUser(prev => prev ? { ...prev, following: [...prev.following, oid] } : null);
          }
          showToast("Followed", "success");
      } catch (e) { showToast(e.message, 'error'); }
      finally { setActionLoading(null); }
  };

  // Show a preview (like ActivityView) when user picks from search - before actually following
  const previewOrg = async (oid, orgName) => {
      openLevel3(setOrgPreview, { id: oid, name: orgName, activities: [], isPreview: true });
      try {
          const data = await api.get(`/organizer_details?oid=${oid}&matric=${user.matric}`);
          if (!data.error) {
              setOrgPreview(prev => prev ? { ...prev, ...data, isPreview: true } : prev);
          }
      } catch(e) {}
  };

  const unfollowOrg = async (oid) => {
      if (!await confirm("Unfollow?")) return;
      setActionLoading(`unfollow_${oid}`);
      try {
          await api.post('/action', { type: 'unfollow_org', sid: oid, matric: user.matric });
          closeCurrentLevel();
          setSelectedOrg(null);
          setUser(prev => prev ? { ...prev, following: prev.following.filter(id => id !== oid) } : null);
          showToast("Unfollowed", "success");
      } catch (e) { showToast(e.message, 'error'); }
      finally { setActionLoading(null); }
  };
  
  const initAutoscan = (id, isOrg) => { 
      setPendingAutoscan({ id, isOrg }); 
      openLevel4(setShowAutoscanMode, true); 
  };

  const confirmAutoscan = async (mode) => {
      closeCurrentLevel(); // Close Mode Selector
      const { id, isOrg } = pendingAutoscan;
      setActionLoading(`autoscan_${id}`);
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
      finally { setActionLoading(null); }
  };

  const cancelAutoscan = async (id, isOrg) => {
      if (!await confirm("Stop Autoscan?")) return;
      setActionLoading(`cancel_autoscan_${id}`);
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
      finally { setActionLoading(null); }
  };

  const openExemptPrompt = (sid, gid) => { 
      openLevel4(setPromptConfig, { sid, gid }); 
  };

  const handleExemptSubmit = (reason) => {
      if (!promptConfig) return;
      handleAction('exempt', promptConfig.sid, promptConfig.gid, false, reason);
      closeCurrentLevel();
  };

  const handleUpdateAutoReg = (gid, isActive) => {
      setUser(prev => {
          if (!prev) return null;
          let newAr = prev.auto_register || [];
          if (isActive) {
              if (!newAr.includes(String(gid))) newAr = [...newAr, String(gid)];
          } else {
              newAr = newAr.filter(id => String(id) !== String(gid));
          }
          return { ...prev, auto_register: newAr };
      });
  };

  // =========================================================================
  // 5. RENDER
  // =========================================================================
  return (
    <div style={{ display: 'block' }}>
      
      <DashboardHeader 
          user={user} 
          onLogout={logout} 
          onOpenManager={loadManager} 
          notifCount={notifications.length}
      />

      <div style={{ display: 'flex', gap: '6px', marginTop: '20px', marginBottom: '15px', flexWrap: 'wrap' }}>
        <button 
            className="btn" 
            style={activeTab === 'modules' ? { flex: 1, minWidth: '80px', borderColor: 'var(--primary)', color: 'var(--primary)', background: 'rgba(0,243,255,0.1)' } : { flex: 1, minWidth: '80px' }} 
            onClick={() => setActiveTab('modules')}
        >
            CLASSES
        </button>
        <button 
            className="btn" 
            style={activeTab === 'org' ? { flex: 1, minWidth: '80px', borderColor: 'var(--accent)', color: 'var(--accent)', background: 'rgba(255,158,0,0.1)' } : { flex: 1, minWidth: '80px' }} 
            onClick={() => setActiveTab('org')}
        >
            ACTIVITIES
        </button>
        <button 
            className="btn" 
            style={activeTab === 'scheduler' ? { flex: 1, minWidth: '80px', borderColor: '#f0f', color: '#f0f', background: 'rgba(255,0,255,0.1)' } : { flex: 1, minWidth: '80px' }} 
            onClick={() => setActiveTab('scheduler')}
        >
            SCHEDULER
        </button>
        <button 
            className="btn" 
            style={activeTab === 'tools' ? { flex: 1, minWidth: '80px', borderColor: '#0f0', color: '#0f0', background: 'rgba(0,255,0,0.1)' } : { flex: 1, minWidth: '80px' }} 
            onClick={() => setActiveTab('tools')}
        >
            COURSE HUB
        </button>
        <button 
            className="btn" 
            style={activeTab === 'directory' ? { flex: 1, minWidth: '80px', borderColor: '#ff6', color: '#ff6', background: 'rgba(255,255,0,0.05)' } : { flex: 1, minWidth: '80px' }} 
            onClick={() => setActiveTab('directory')}
        >
            DIRECTORY
        </button>
      </div>

      {/* MAIN LISTS - WITH STATE RETENTION VIA DISPLAY NONE */}
      
      {/* 1. CLASSES TAB */}
      <div style={{ display: activeTab === 'modules' ? 'block' : 'none' }}>
          <TimetableList 
              timetable={user.timetable} 
              courses={user.courses} 
              loading={!user.courses}
              expandedGid={selectedCourse?.gid || null}
              onExpand={openCourseByGid}
              sessionsForExpanded={courseSessions}
              isLoadingSessions={loadingDetail && selectedCourse}
              onAction={handleAction}
              onExempt={openExemptPrompt}
              onAutoscan={initAutoscan}
              onCancelAutoscan={cancelAutoscan}
              actionLoading={actionLoading}
          />
      </div>

      {/* 2. ACTIVITIES TAB */}
      <div style={{ display: activeTab === 'org' ? 'block' : 'none' }}>
          {selectedOrg ? (
              <ActivityView 
                  org={selectedOrg} 
                  onClose={closeCurrentLevel}
                  isLoading={loadingDetail} 
                  onAction={handleAction} 
                  onAutoscan={initAutoscan} 
                  onCancelAutoscan={cancelAutoscan} 
                  onUnfollow={unfollowOrg} 
                  actionLoading={actionLoading}
              />
          ) : orgPreview ? (
              /* Preview of an unfollowed org - show ActivityView with a FOLLOW button */
              <div style={{ maxWidth: '450px', margin: '0 auto', display: 'flex', flexDirection: 'column' }}>
                  <div style={{ textAlign: 'center', marginBottom: '20px', width: '100%' }}>
                      <button className="btn" style={{ borderColor: 'var(--accent)', color: 'var(--accent)', padding: '8px 25px', fontWeight: 'bold' }} onClick={closeCurrentLevel}>
                          {'◄ GO BACK'}
                      </button>
                  </div>
                  <div style={{ fontSize: '1rem', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '15px', textAlign: 'center' }}>{orgPreview?.name || 'ACTIVITY'}</div>
                  <button 
                      className="btn" 
                      disabled={actionLoading === `follow_${orgPreview.id}`}
                      style={{ width: '100%', marginBottom: '15px', borderColor: '#0f0', color: '#0f0', padding: '12px', fontWeight: 'bold', opacity: actionLoading === `follow_${orgPreview.id}` ? 0.5 : 1 }} 
                      onClick={() => followOrg(orgPreview.id)}
                  >
                      {actionLoading === `follow_${orgPreview.id}` ? 'PROCESSING...' : '＋ FOLLOW THIS SOURCE'}
                  </button>
                  {/* Show events preview */}
                  <div style={{ fontSize: '0.75rem', color: '#888', marginBottom: '10px' }}>RECENT EVENTS</div>
                  {orgPreview.isPreview && !orgPreview.activities?.length ? (
                      <><Skeleton type="session-row" /><Skeleton type="session-row" /></>
                  ) : orgPreview.activities?.length > 0 ? (
                      orgPreview.activities.map(act => (
                          <div key={act.id} style={{ padding: '10px 12px', marginBottom: '8px', border: '1px solid var(--grid-line)', borderRadius: '4px' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                  <span style={{ color: '#fff', fontSize: '0.85rem', fontWeight: 'bold' }}>{act.name}</span>
                                  <span style={{ color: 'var(--text-dim)', fontSize: '0.75rem' }}>{act.date}</span>
                              </div>
                          </div>
                      ))
                  ) : (
                      <div style={{ textAlign: 'center', padding: '20px', color: '#555' }}>NO EVENTS</div>
                  )}
              </div>
          ) : (
              <>
                  <OrgSearchView onPreview={previewOrg} />
                  <ActivityList 
                      following={user.following} 
                      organizerDetails={user.organizerDetails} 
                      onSelect={openOrgModal} 
                  />
              </>
          )}
      </div>

      {/* 3. TOOLS TAB */}
      <div style={{ display: activeTab === 'tools' ? 'block' : 'none' }}>
          <ToolsView 
              user={user} 
              isVisible={activeTab === 'tools'} 
              onUpdateAutoReg={handleUpdateAutoReg}
              onDeepNavChange={(isDeep) => {
                  // When ToolsView goes deep, ensure hash is set so back button works
                  // (ToolsView handles the pushState itself)
              }}
          />
      </div>

      {/* 4. DIRECTORY TAB */}
      <div style={{ display: activeTab === 'directory' ? 'block' : 'none' }}>
          <DirectoryView user={user} />
      </div>

      {/* ================= REMAINING OVERLAY MODALS ================= */}

      {/* SCHEDULER TAB CONTENT */}
      {activeTab === 'scheduler' && (
          <SchedulerView 
              user={user} 
              notifications={notifications} 
              onDismissNotif={dismissNotification} 
              onCancelJob={cancelAutoscan}
              onCancelAutoReg={(gid) => handleUpdateAutoReg(gid, false)}
              goToTools={() => setActiveTab('tools')}
          />
      )}

      {/* AUTOSCAN MODE SELECTOR */}
      <Modal title="SELECT MODE" isOpen={showAutoscanMode} onClose={closeCurrentLevel} maxWidth="400px">
          <div style={{textAlign:'center', padding: '10px 0'}}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '20px' }}>
                  <div style={{ display: 'flex', gap: '4px' }}>
                      <button className="btn" style={{flex:1, padding:'10px', borderColor: modalTriggerMode==='crowd'?'var(--primary)':'var(--grid-line)', color: modalTriggerMode==='crowd'?'var(--primary)':'#888'}} onClick={() => setModalTriggerMode('crowd')}>CROWD</button>
                      <button className="btn" style={{flex:1, padding:'10px', borderColor: modalTriggerMode==='time'?'var(--primary)':'var(--grid-line)', color: modalTriggerMode==='time'?'var(--primary)':'#888'}} onClick={() => setModalTriggerMode('time')}>L. MINUTE</button>
                  </div>
                  <div style={{ display: 'flex', gap: '4px' }}>
                      <button className="btn" style={{flex:1, padding:'10px', borderColor: modalAutoMode==='onetime'?'var(--primary)':'var(--grid-line)', color: modalAutoMode==='onetime'?'var(--primary)':'#888'}} onClick={() => setModalAutoMode('onetime')}>ONE TIME</button>
                      <button className="btn" style={{flex:1, padding:'10px', borderColor: modalAutoMode==='permanent'?'var(--primary)':'var(--grid-line)', color: modalAutoMode==='permanent'?'var(--primary)':'#888'}} onClick={() => setModalAutoMode('permanent')}>PERMANENT</button>
                  </div>
              </div>
              <button 
                  className="btn" 
                  disabled={!!actionLoading}
                  style={{width:'100%', borderColor:'#0f0', color:'#0f0', padding:'10px', fontWeight:'bold', opacity: actionLoading ? 0.5 : 1}} 
                  onClick={() => confirmAutoscan(`${modalTriggerMode}_${modalAutoMode}`)}
              >
                 {actionLoading ? 'PROCESSING...' : 'ACTIVATE AUTOSCAN'}
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