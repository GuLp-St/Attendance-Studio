// --- START OF FILE AdminPanel.jsx ---

import { useState, useEffect, useMemo } from 'react';
import { api, getDirectory } from '../services/api';
import { useToast } from '../contexts/ToastContext';
import { useConfirm } from '../contexts/ConfirmContext';
import Modal from '../components/Modal';

export default function AdminPanel() {
  const { showToast } = useToast();
  const { confirm } = useConfirm();

  const [key, setKey] = useState('');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null); 
  const [consoleOutput, setConsoleOutput] = useState("Ready...");
  const [jobLogs, setJobLogs] = useState("Awaiting manual trigger...");
  const [expandedIps, setExpandedIps] = useState({});
  const [tagModalData, setTagModalData] = useState(null); 
  
  // Auto System State
  const [autoAccounts, setAutoAccounts] = useState([]);
  const [autoIndex, setAutoIndex] = useState(0);

  const [directory, setDirectory] = useState([]);
  useEffect(() => { getDirectory().then(setDirectory).catch(()=>{}) }, []);

  const [formSync, setFormSync] = useState({ 
      limit: 5000, classStart: 0, studentBatch: 50, actLimit: 5000, actStart: 0, actMonths: 6, forceStudentSync: false 
  });
  const [priorityCourses, setPriorityCourses] = useState([]);
  const [courseSearch, setCourseSearch] = useState('');

  const openTagModal = (id, name) => { window.history.pushState({ level: 'admin_tag' }, '', '#tag'); setTagModalData({ id, name }); };
  const closeTagModal = () => window.history.back();

  useEffect(() => {
    const handlePopState = (e) => { if (tagModalData && (!e.state || e.state.level !== 'admin_tag')) setTagModalData(null); };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [tagModalData]);

  const loadData = async () => {
    setLoading(true);
    try {
      const res = await api.post('/admin_dashboard', { key, type: 'get_data' });
      if (res.error) throw new Error(res.error);

      setData(res);
      setIsAuthenticated(true);

      if (res.auto_accounts) {
          const validAccs = res.auto_accounts.sort((a,b) => parseInt(b.matric) - parseInt(a.matric));
          setAutoAccounts(validAccs);
          if (res.config?.system_matric) {
              const idx = validAccs.findIndex(a => a.matric === res.config.system_matric);
              if (idx !== -1) setAutoIndex(idx);
          }
      }

      if (res.config) {
        setFormSync({
          limit: res.config.scan_limit || 5000, classStart: res.config.start_id || 100000,
          studentBatch: res.config.student_sync_batch || 50, actLimit: res.config.act_scan_limit || 5000,
          actStart: res.config.act_start_id || 107000, actMonths: res.config.act_months || 6,
          forceStudentSync: res.config.force_student_sync || false
        });
        setPriorityCourses(res.config.priority_courses || []);
      }
    } catch (e) { showToast(e.message || "Invalid Key", "error"); setIsAuthenticated(false); } finally { setLoading(false); }
  };

  const saveSettings = async () => {
    try {
      await api.post('/admin_dashboard', {
        key, type: 'save_settings', scan_limit: formSync.limit, last_scanned: formSync.classStart,
        student_sync_batch: formSync.studentBatch, act_scan_limit: formSync.actLimit,
        act_start_id: formSync.actStart, act_months: formSync.actMonths, 
        system_matric: autoAccounts[autoIndex]?.matric || "", 
        system_pwd: autoAccounts[autoIndex]?.password || "", 
        priority_courses: priorityCourses, force_student_sync: formSync.forceStudentSync
      });
      showToast("Saved", "success");
    } catch (e) { showToast(e.message, "error"); }
  };

  const triggerSync = async (type) => {
    if (!await confirm(`Start ${type.toUpperCase()} Sync?`)) return;
    setConsoleOutput("Initializing Sync...");
    try {
      let endpoint = type === 'class' ? '/admin_sync_class' : type === 'student' ? '/admin_sync_student' : '/admin_sync_activity';
      const text = await (await fetch(`/api${endpoint}?key=${key}`)).text();
      setConsoleOutput(text); loadData();
    } catch (e) { setConsoleOutput("Error: " + e.message); }
  };

  const handleJobAction = async (action, jobId = null) => { if (!await confirm("Delete?")) return; try { await api.post('/admin_dashboard', { key, type: action, job_id: jobId }); loadData(); showToast("Updated", "success"); } catch (e) {} };
  
  const triggerAutoJobs = async (jobType) => {
      setJobLogs(`Starting ${jobType.toUpperCase()} trigger...`);
      try {
          const res = await api.post('/admin_dashboard', { key, type: 'trigger_jobs', job_category: jobType });
          if (res.error) setJobLogs(`Error: ${res.error}`);
          else {
              setJobLogs(res.log || "Completed.");
              loadData();
          }
      } catch (e) { setJobLogs(`Exception: ${e.message}`); }
  };

  const handleDeviceDelete = async (id) => { if (!await confirm("Delete logs & Unban?")) return; try { await api.post('/admin_dashboard', { key, type: 'delete_device_logs', target_id: id }); loadData(); showToast("Cleared", "success"); } catch (e) {} };
  const handleIpAction = async (ip, action) => { if (!await confirm(`BAN IP: ${ip}?`)) return; try { await api.post('/admin_dashboard', { key, type: 'ban_ip', ip, action }); loadData(); showToast(`IP ${action}ned`, "success"); } catch (e) {} };
  const saveIpTag = async () => { if (!tagModalData) return; try { await api.post('/admin_dashboard', { key, type: 'set_ip_name', ip: tagModalData.id, name: tagModalData.name }); closeTagModal(); loadData(); showToast("Saved", "success"); } catch (e) {} };

  const networkGroups = useMemo(() => {
    if (!data) return [];
    const groups = {};
    data.logs.forEach(l => {
      const id = l.device_id && l.device_id !== 'unknown' ? l.device_id : l.ip;
      if (!groups[id]) groups[id] = { id, logs: [], banned: false, name: '', recentIdentity: 'Unknown User', lastActive: '', lastIdentityTime: '' };
      groups[id].logs.push(l);
      if (l.timestamp > groups[id].lastActive) groups[id].lastActive = l.timestamp;
      if (l.matric && l.matric !== 'undefined' && l.matric !== 'null') {
          if (l.timestamp > groups[id].lastIdentityTime) { groups[id].recentIdentity = `User: ${l.matric}`; groups[id].lastIdentityTime = l.timestamp; }
      } else if (l.action === 'TARGET_SEARCH' && groups[id].recentIdentity === 'Unknown User') {
          if (l.timestamp > groups[id].lastIdentityTime) { groups[id].recentIdentity = `Searched: ${l.details}`; }
      }
    });
    data.banned_ips.forEach(ip => { if (!groups[ip]) groups[ip] = { id: ip, logs: [], banned: true, name: '', recentIdentity: 'Banned', lastActive: '9999' }; groups[ip].banned = true; });
    Object.keys(data.ip_meta || {}).forEach(k => { if (groups[k]) groups[k].name = data.ip_meta[k]; });
    return Object.values(groups).sort((a, b) => (b.lastActive || "").localeCompare(a.lastActive || ""));
  }, [data]);

  const courseMatches = courseSearch.length >= 2 ? directory.filter(u => (u.t === 'c') && ((u.m || "").toUpperCase().includes(courseSearch.toUpperCase()) || (u.n || "").toUpperCase().includes(courseSearch.toUpperCase().replace(/\s+/g, '')))).slice(0,5) : [];

  if (!isAuthenticated) return (
      <div style={{ textAlign: 'center', padding: '50px 0' }}><input type="password" className="t-input" placeholder="ENTER KEY" style={{ borderColor: '#f00', color: '#f00', marginBottom: '10px' }} value={key} onChange={(e) => setKey(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && loadData()} /><button className="btn" style={{ borderColor: '#f00', color: '#f00', width: '100%' }} onClick={loadData} disabled={loading}>{loading ? "VERIFYING..." : "UNLOCK"}</button></div>
  );

  return (
    <div className="admin-grid">

      <div className="admin-section">
        <div className="admin-title">SYSTEM ACCOUNT</div>
        <div className="ctrl-row" style={{marginBottom: 0}}>
            <div style={{ flex: 1, background: 'rgba(0,0,0,0.4)', padding: '10px', borderRadius: '4px', border: '1px solid var(--primary)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                    <span style={{ color: 'var(--primary)', fontWeight: 'bold', marginRight: '10px' }}>AUTO:</span>
                    <span style={{ color: '#fff' }}>{autoAccounts[autoIndex]?.matric || "NO VALID ACCOUNTS"}</span>
                </div>
            </div>
            <div style={{ display: 'flex', gap: '5px'}}>
                <button className="btn" style={{height: '38px'}} onClick={() => setAutoIndex(0)}>DEFAULT</button>
                <button className="btn" style={{height: '38px'}} onClick={() => setAutoIndex((autoIndex + 1) % autoAccounts.length)}>SWITCH</button>
            </div>
        </div>
      </div>

      <div className="admin-section">
        <div className="admin-title">SYNC MANAGER</div>
        <div className="admin-config-grid">
          <div><label>CLASS LIMIT</label><input type="number" className="t-input" value={formSync.limit} onChange={e => setFormSync({ ...formSync, limit: e.target.value })} /></div>
          <div><label>ACT LIMIT</label><input type="number" className="t-input" value={formSync.actLimit} onChange={e => setFormSync({ ...formSync, actLimit: e.target.value })} /></div>
          <div><label>STUDENT BATCH</label><input type="number" className="t-input" value={formSync.studentBatch} onChange={e => setFormSync({ ...formSync, studentBatch: e.target.value })} /></div>
        </div>

        <div style={{ borderTop: '1px solid #333', paddingTop: '15px', marginTop: '10px' }}>
          <div style={{ fontSize: '0.7rem', color: 'var(--primary)', fontWeight: 'bold', marginBottom: '8px' }}>CLASS SYNC (DISCOVERY)</div>
          <div className="ctrl-row"><input type="number" className="t-input" style={{ flex: 1 }} placeholder="Start ID" value={formSync.classStart} onChange={e => setFormSync({ ...formSync, classStart: e.target.value })} /><button className="btn" onClick={() => triggerSync('class')}>RUN</button></div>
        </div>

        <div style={{ borderTop: '1px solid #333', paddingTop: '15px', marginTop: '10px' }}>
          <div style={{ fontSize: '0.7rem', color: '#0f0', fontWeight: 'bold', marginBottom: '8px' }}>STUDENT SYNC (FILL DB)</div>
          <div style={{ background: 'rgba(0,0,0,0.3)', padding: '10px', borderRadius: '4px', marginBottom: '10px' }}>
              <div style={{ fontSize: '0.65rem', color: '#aaa', marginBottom: '5px' }}>PRIORITY COURSES</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', marginBottom: '10px' }}>
                  {priorityCourses.length === 0 && <span style={{ color: '#555', fontSize: '0.7rem' }}>None Set</span>}
                  {priorityCourses.map(c => (<div key={c} style={{ background: 'rgba(0,255,0,0.1)', border: '1px solid #0f0', color: '#0f0', padding: '2px 6px', borderRadius: '4px', fontSize: '0.7rem', display: 'flex', alignItems: 'center', gap: '5px' }}>{c} <span style={{ cursor: 'pointer', color: '#f00' }} onClick={() => setPriorityCourses(prev => prev.filter(x => x !== c))}>✕</span></div>))}
              </div>
              <div style={{ position: 'relative' }}>
                  <input type="text" className="t-input" placeholder="Add Priority Course Code..." value={courseSearch} onChange={e => setCourseSearch(e.target.value)} style={{ padding: '6px', fontSize: '0.8rem' }} />
                  {courseMatches.length > 0 && (
                      <div className="results-list" style={{ display: 'block', zIndex: 10, border: '1px solid #0f0' }}>
                          {courseMatches.map(u => (<div key={u.m} className="result-item" onClick={() => { if(!priorityCourses.includes(u.m)) setPriorityCourses(prev => [...prev, u.m]); setCourseSearch(''); }}><span style={{ color: '#0f0' }}>{u.n}</span> <span style={{ color: '#fff' }}>{u.m}</span></div>))}
                      </div>
                  )}
              </div>
          </div>
          <div className="ctrl-row">
            <label style={{ display: 'flex', alignItems: 'center', gap: '5px', color: '#f00', cursor: 'pointer', fontSize: '0.75rem' }}>
                <input type="checkbox" checked={formSync.forceStudentSync} onChange={e => setFormSync({...formSync, forceStudentSync: e.target.checked})} />
                FORCE HEAL
            </label>
            <div style={{ flex: 1 }}></div>
            <button className="btn" style={{ borderColor: '#0f0', color: '#0f0' }} onClick={() => triggerSync('student')}>RUN</button>
          </div>
        </div>

        <div style={{ borderTop: '1px solid #333', paddingTop: '15px', marginTop: '10px' }}>
          <div style={{ fontSize: '0.7rem', color: 'var(--accent)', fontWeight: 'bold', marginBottom: '8px' }}>ACTIVITY SYNC</div>
          <div className="ctrl-row"><div style={{ display: 'flex', alignItems: 'center', gap: '5px', flex: '0 0 auto' }}><label>MTH:</label><input type="number" className="t-input" style={{ width: '50px' }} value={formSync.actMonths} onChange={e => setFormSync({ ...formSync, actMonths: e.target.value })} /></div><input type="number" className="t-input" style={{ flex: 1 }} placeholder="Start ID" value={formSync.actStart} onChange={e => setFormSync({ ...formSync, actStart: e.target.value })} /><button className="btn" style={{ '--accent': '1' }} onClick={() => triggerSync('activity')}>RUN</button></div>
        </div>

        <button className="btn" style={{ width: '100%', marginTop: '15px' }} onClick={saveSettings}>SAVE ALL SETTINGS</button>
        <textarea readOnly style={{ width: '100%', height: '100px', background: '#000', color: '#0f0', fontFamily: 'monospace', border: '1px solid #333', padding: '5px', fontSize: '0.7rem', marginTop: '10px', boxSizing: 'border-box' }} value={consoleOutput} />

        {/* --- SYNC HISTORY VISUALIZER RESTORED --- */}
        <div style={{ borderTop: '1px solid #333', marginTop: '15px', paddingTop: '10px' }}>
          <div className="admin-title" style={{ border: 'none', padding: 0, marginBottom: '5px' }}>SYNC HISTORY</div>
          <div style={{ maxHeight: '120px', overflowY: 'auto', background: 'rgba(0,0,0,0.3)' }}>
            {data.sync_history?.map(h => (
              <div key={h.id} style={{ padding: '6px 0', borderBottom: '1px solid #333', fontSize: '0.7rem', display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#888', width: '80px' }}>{h.timestamp.substring(11, 19)}</span>
                <span style={{ color: h.type === 'CLASS' ? 'var(--primary)' : h.type === 'STUDENT' ? '#0f0' : 'var(--accent)', fontWeight: 'bold' }}>{h.type}</span>
                <span style={{ color: h.status === 'SUCCESS' ? '#0f0' : '#f00' }}>{h.status} ({h.items_found})</span>
              </div>
            ))}
          </div>
        </div>

      </div>

      <div className="admin-section">
        <div className="admin-title">
            <span>ACTIVE AUTO-JOBS</span>
            <button onClick={() => handleJobAction('delete_all_jobs')} style={{ background: 'none', border: 'none', color: '#f00', cursor: 'pointer', fontSize: '0.7rem' }}>PURGE ALL</button>
        </div>
        
        <div style={{ display: 'flex', gap: '10px', marginBottom: '10px' }}>
            <button className="btn" style={{ flex: 1, borderColor: 'var(--accent)', color: 'var(--accent)' }} onClick={() => triggerAutoJobs('autoscan')}>TRIGGER AUTOSCAN</button>
            <button className="btn" style={{ flex: 1, borderColor: '#f0f', color: '#f0f' }} onClick={() => triggerAutoJobs('autoregister')}>TRIGGER AUTO REG</button>
        </div>
        <textarea readOnly style={{ width: '100%', height: '80px', background: '#000', color: '#0f0', fontFamily: 'monospace', border: '1px solid #333', padding: '5px', fontSize: '0.7rem', marginBottom: '15px', boxSizing: 'border-box' }} value={jobLogs} />
        
        <div style={{ maxHeight: '200px', overflowY: 'auto', background: 'rgba(0,0,0,0.3)', border: '1px solid #333' }}>
            {data.jobs?.length === 0 && <div style={{ padding: '10px', color: '#555', textAlign: 'center', fontSize: '0.8rem' }}>No Active Auto-Jobs</div>}
            {data.jobs?.map(job => {
                const isReg = job.type === 'register';
                const title = isReg ? `AUTO-REGISTER (${job.code || job.group_id || 'Course'})` : `AUTOSCAN (${job.target || job.code || 'Activity/Class'})`;
                const userDesc = job.matric || job.id.split('_')[0];
                return (
                    <div key={job.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px', borderBottom: '1px solid #333', alignItems: 'center' }}>
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                            <span style={{ color: isReg ? '#f0f' : 'var(--accent)', fontWeight: 'bold', fontSize: '0.8rem' }}>{title}</span>
                            <span style={{ fontSize: '0.7rem', color: '#fff' }}>User: {userDesc}</span>
                        </div>
                        <button className="btn" style={{ color: '#f00', padding: '4px 10px', height: '28px', minWidth: 'auto', borderColor: '#f00' }} onClick={() => handleJobAction('delete_single_job', job.id)}>DEL</button>
                    </div>
                );
            })}
        </div>
      </div>

      <div className="admin-section">
        <div className="admin-title"><span>NETWORK ACTIVITY</span><button onClick={loadData} style={{ background: 'none', border: 'none', color: 'var(--primary)', cursor: 'pointer', fontSize: '0.7rem' }}>REFRESH</button></div>
        <div style={{ maxHeight: '350px', overflowY: 'auto', border: '1px solid #333' }}>
          {networkGroups.map(group => {
            const isExpanded = expandedIps[group.id];
            const color = group.banned ? '#f00' : '#0f0';
            return (
              <div key={group.id} className="ip-group">
                <div className="ip-header" onClick={() => setExpandedIps(prev => ({ ...prev, [group.id]: !prev[group.id] }))}>
                  <div><span style={{ color, marginRight: '5px', fontSize: '1.2rem' }}>●</span><div style={{ display: 'flex', flexDirection: 'column' }}><span className="ip-addr-text">{group.id}</span><div style={{ fontSize: '0.7rem', color: '#888' }}>{group.name ? <span style={{ color: 'var(--primary)', marginRight: '5px' }}>({group.name})</span> : null}{group.recentIdentity}</div></div></div>
                  <div className="ip-actions" onClick={e => e.stopPropagation()}><button className="btn" style={{ color: '#888', padding: '4px 8px', minWidth: 'auto' }} onClick={() => openTagModal(group.id, group.name || '')}>TAG</button><button className="btn" style={{ color: '#f00', padding: '4px 8px', minWidth: 'auto' }} onClick={() => handleDeviceDelete(group.id)}>DEL</button><button className="btn" style={{ color: color, padding: '4px 8px', minWidth: 'auto' }} onClick={() => handleIpAction(group.id, group.banned ? 'unban' : 'ban')}>{group.banned ? 'UNBAN' : 'BAN'}</button></div>
                </div>
                {isExpanded && (<div className="ip-logs" style={{ display: 'block' }}>{group.logs.length === 0 && <div style={{ padding: '5px', color: '#555', fontSize: '0.7rem' }}>No recent logs</div>}{group.logs.map(l => (<div key={l.id} className="log-row"><div style={{ display: 'flex', justifyContent: 'space-between' }}><span>{l.timestamp.substring(11, 19)}</span><span style={{ color: '#fff' }}>{l.matric || '-'}</span></div><div style={{ color: '#ccc' }}>{l.action} {l.details || ''}</div></div>))}</div>)}
              </div>
            );
          })}
        </div>
      </div>

      <Modal title="TAG DEVICE / IP" isOpen={!!tagModalData} onClose={closeTagModal} maxWidth="300px">
        <div style={{ textAlign: 'center' }}><div style={{ marginBottom: '15px', color: '#888', fontFamily: 'monospace', fontSize: '0.8rem', wordBreak: 'break-all' }}>{tagModalData?.id}</div><input type="text" className="t-input" placeholder="Nickname" style={{ width: '100%', marginBottom: '15px' }} value={tagModalData?.name || ''} onChange={(e) => setTagModalData({ ...tagModalData, name: e.target.value })} /><button className="btn" style={{ width: '100%' }} onClick={saveIpTag}>SAVE TAG</button></div>
      </Modal>

    </div>
  );
}

// --- END OF FILE AdminPanel.jsx ---