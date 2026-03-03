// --- START OF FILE AdminPanel.txt ---

import { useState, useEffect, useMemo } from 'react';
import { api } from '../services/api';
import { useToast } from '../contexts/ToastContext';
import { useConfirm } from '../contexts/ConfirmContext';
import Modal from '../components/Modal';

export default function AdminPanel() {
  const { showToast } = useToast();
  const { confirm } = useConfirm();

  // =========================================================================
  // 1. STATE MANAGEMENT
  // =========================================================================

  const [key, setKey] = useState('');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loading, setLoading] = useState(false);

  const [data, setData] = useState(null); 
  const [consoleOutput, setConsoleOutput] = useState("Ready...");

  const [expandedIps, setExpandedIps] = useState({});
  const [tagModalData, setTagModalData] = useState(null); 

  const [formCreds, setFormCreds] = useState({ user: '', pass: '' });
  const [formSync, setFormSync] = useState({
    limit: 5000,
    classStart: 0,
    studentBatch: 50,
    actLimit: 5000,
    actStart: 0,
    actMonths: 6
  });

  // =========================================================================
  // 2. HISTORY MANAGEMENT (TAG MODAL)
  // =========================================================================

  const openTagModal = (id, name) => {
    window.history.pushState({ level: 'admin_tag' }, '', '#tag');
    setTagModalData({ id, name });
  };

  const closeTagModal = () => {
    window.history.back();
  };

  useEffect(() => {
    const handlePopState = (e) => {
      const state = e.state;
      if (tagModalData && (!state || state.level !== 'admin_tag')) {
        setTagModalData(null);
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [tagModalData]);

  // =========================================================================
  // 3. API ACTIONS
  // =========================================================================

  const loadData = async () => {
    setLoading(true);
    try {
      const res = await api.post('/admin_dashboard', { key, type: 'get_data' });
      if (res.error) throw new Error(res.error);

      setData(res);
      setIsAuthenticated(true);

      if (res.config) {
        setFormCreds({ user: res.config.user, pass: res.config.pass });
        setFormSync({
          limit: res.config.scan_limit,
          classStart: res.config.start_id,
          studentBatch: res.config.student_sync_batch,
          actLimit: res.config.act_scan_limit,
          actStart: res.config.act_start_id,
          actMonths: res.config.act_months
        });
      }
    } catch (e) {
      showToast(e.message || "Invalid Key", "error");
      setIsAuthenticated(false);
    } finally {
      setLoading(false);
    }
  };

  const saveCredentials = async () => {
    try {
      const res = await api.post('/admin_dashboard', {
        key, type: 'save_settings',
        user: formCreds.user,
        pass: formCreds.pass
      });
      showToast(res.status, "success");
    } catch (e) { showToast(e.message, "error"); }
  };

  const saveSyncConfig = async () => {
    try {
      const payload = {
        key, type: 'save_settings',
        scan_limit: formSync.limit,
        last_scanned: formSync.classStart,
        student_sync_batch: formSync.studentBatch,
        act_scan_limit: formSync.actLimit,
        act_start_id: formSync.actStart,
        act_months: formSync.actMonths
      };
      const res = await api.post('/admin_dashboard', payload);
      showToast(res.status, "success");
    } catch (e) { showToast(e.message, "error"); }
  };

  const triggerSync = async (type) => {
    if (!await confirm(`Start ${type.toUpperCase()} Sync?`)) return;
    setConsoleOutput("Initializing Sync...");
    try {
      let endpoint = '';
      if (type === 'class') endpoint = '/admin_sync_class';
      else if (type === 'student') endpoint = '/admin_sync_student';
      else if (type === 'activity') endpoint = '/admin_sync_activity';

      const response = await fetch(`/api${endpoint}?key=${key}`);
      const text = await response.text();
      setConsoleOutput(text);
      loadData();
    } catch (e) { setConsoleOutput("Error: " + e.message); }
  };

  const handleJobAction = async (action, jobId = null) => {
    const msg = action === 'delete_all_jobs' ? "DELETE ALL PENDING JOBS?" : "Delete this job?";
    if (!await confirm(msg)) return;
    try {
      await api.post('/admin_dashboard', { key, type: action, job_id: jobId });
      loadData();
      showToast("Job Updated", "success");
    } catch (e) { showToast(e.message, "error"); }
  };

  const handleDeviceDelete = async (id) => {
    if (!await confirm("Delete ALL logs & Unban this device?")) return;
    try {
      await api.post('/admin_dashboard', { key, type: 'delete_device_logs', target_id: id });
      loadData();
      showToast("Device Cleared", "success");
    } catch (e) { showToast(e.message, "error"); }
  };

  const handleIpAction = async (ip, action) => {
    if (action === 'ban' && !await confirm(`BAN IP: ${ip}?`)) return;
    try {
      await api.post('/admin_dashboard', { key, type: 'ban_ip', ip, action });
      loadData();
      showToast(`IP ${action}ned`, "success");
    } catch (e) { showToast(e.message, "error"); }
  };

  const saveIpTag = async () => {
    if (!tagModalData) return;
    try {
      await api.post('/admin_dashboard', {
        key, type: 'set_ip_name',
        ip: tagModalData.id,
        name: tagModalData.name
      });
      closeTagModal();
      loadData();
      showToast("Tag Saved", "success");
    } catch (e) { showToast(e.message, "error"); }
  };

  // =========================================================================
  // 4. DATA PROCESSING (Group by Device ID)
  // =========================================================================

  const networkGroups = useMemo(() => {
    if (!data) return [];
    
    const groups = {};
    
    data.logs.forEach(l => {
      const key = l.device_id && l.device_id !== 'unknown' ? l.device_id : l.ip;
      
      if (!groups[key]) {
          groups[key] = { 
              id: key, logs: [], banned: false, name: '', 
              recentIdentity: 'Unknown User', lastActive: '', lastIdentityTime: '' 
          };
      }
      groups[key].logs.push(l);

      if (l.timestamp > groups[key].lastActive) {
          groups[key].lastActive = l.timestamp;
      }

      if (l.matric && l.matric !== 'undefined' && l.matric !== 'null') {
          if (l.timestamp > groups[key].lastIdentityTime) {
              groups[key].recentIdentity = `User: ${l.matric}`;
              groups[key].lastIdentityTime = l.timestamp;
          }
      }
      else if (l.action === 'TARGET_SEARCH' && groups[key].recentIdentity === 'Unknown User') {
          if (l.timestamp > groups[key].lastIdentityTime) {
              groups[key].recentIdentity = `Searched: ${l.details}`;
          }
      }
    });

    data.banned_ips.forEach(ip => {
        if (!groups[ip]) {
            groups[ip] = { id: ip, logs: [], banned: true, name: '', recentIdentity: 'Banned (No Logs)', lastActive: '9999' };
        }
        groups[ip].banned = true;
    });

    Object.keys(data.ip_meta || {}).forEach(key => {
      if (groups[key]) groups[key].name = data.ip_meta[key];
    });

    return Object.values(groups).sort((a, b) => {
        return (b.lastActive || "").localeCompare(a.lastActive || "");
    });

  }, [data]);

  // =========================================================================
  // 5. RENDER
  // =========================================================================

  if (!isAuthenticated) {
    return (
      <div style={{ textAlign: 'center', padding: '50px 0' }}>
        <input
          type="password" className="t-input" placeholder="ENTER KEY"
          style={{ borderColor: '#f00', color: '#f00', marginBottom: '10px' }}
          value={key} onChange={(e) => setKey(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && loadData()}
        />
        <button
          className="btn"
          style={{ borderColor: '#f00', color: '#f00', width: '100%' }}
          onClick={loadData} disabled={loading}
        >
          {loading ? "VERIFYING..." : "UNLOCK"}
        </button>
      </div>
    );
  }

  return (
    <div className="admin-grid">

      {/* --- CREDENTIALS --- */}
      <div className="admin-section">
        <div className="admin-title">ADMIN ACCESS</div>
        <div className="ctrl-row">
          <input type="text" className="t-input" style={{ flex: 1 }} placeholder="Username" value={formCreds.user} onChange={e => setFormCreds({ ...formCreds, user: e.target.value })} />
          <input type="text" className="t-input" style={{ flex: 1 }} placeholder="Password" value={formCreds.pass} onChange={e => setFormCreds({ ...formCreds, pass: e.target.value })} />
        </div>
        <button className="btn" style={{ width: '100%' }} onClick={saveCredentials}>UPDATE CREDENTIALS</button>
      </div>

      {/* --- SYNC MANAGER --- */}
      <div className="admin-section">
        <div className="admin-title">SYNC MANAGER</div>

        <div className="admin-config-grid">
          <div><label>CLASS LIMIT</label><input type="number" className="t-input" value={formSync.limit} onChange={e => setFormSync({ ...formSync, limit: e.target.value })} /></div>
          <div><label>ACT LIMIT</label><input type="number" className="t-input" value={formSync.actLimit} onChange={e => setFormSync({ ...formSync, actLimit: e.target.value })} /></div>
          <div><label>STUDENT BATCH</label><input type="number" className="t-input" value={formSync.studentBatch} onChange={e => setFormSync({ ...formSync, studentBatch: e.target.value })} /></div>
        </div>

        {/* CLASS SYNC */}
        <div style={{ borderTop: '1px solid #333', paddingTop: '15px', marginTop: '10px' }}>
          <div style={{ fontSize: '0.7rem', color: 'var(--primary)', fontWeight: 'bold', marginBottom: '8px' }}>CLASS SYNC (DISCOVERY)</div>
          <div className="ctrl-row">
            <input type="number" className="t-input" style={{ flex: 1 }} placeholder="Start ID" value={formSync.classStart} onChange={e => setFormSync({ ...formSync, classStart: e.target.value })} />
            <button className="btn" onClick={() => triggerSync('class')}>RUN</button>
          </div>
        </div>

        {/* STUDENT SYNC */}
        <div style={{ borderTop: '1px solid #333', paddingTop: '15px', marginTop: '10px' }}>
          <div style={{ fontSize: '0.7rem', color: '#0f0', fontWeight: 'bold', marginBottom: '8px' }}>STUDENT SYNC (FILL DB)</div>
          <div className="ctrl-row">
            <div style={{ flex: 1, color: '#888', fontSize: '0.75rem', padding: '10px 0' }}>Syncs missing students into discovered classes.</div>
            <button className="btn" style={{ borderColor: '#0f0', color: '#0f0' }} onClick={() => triggerSync('student')}>RUN</button>
          </div>
        </div>

        {/* ACTIVITY SYNC */}
        <div style={{ borderTop: '1px solid #333', paddingTop: '15px', marginTop: '10px' }}>
          <div style={{ fontSize: '0.7rem', color: 'var(--accent)', fontWeight: 'bold', marginBottom: '8px' }}>ACTIVITY SYNC</div>
          <div className="ctrl-row">
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flex: '0 0 auto' }}>
              <label>MTH:</label>
              <input type="number" className="t-input" style={{ width: '50px' }} value={formSync.actMonths} onChange={e => setFormSync({ ...formSync, actMonths: e.target.value })} />
            </div>
            <input type="number" className="t-input" style={{ flex: 1 }} placeholder="Start ID" value={formSync.actStart} onChange={e => setFormSync({ ...formSync, actStart: e.target.value })} />
            <button className="btn" style={{ '--accent': '1' }} onClick={() => triggerSync('activity')}>RUN</button>
          </div>
        </div>

        <button className="btn" style={{ width: '100%' }} onClick={saveSyncConfig}>SAVE SYNC SETTINGS</button>

        <textarea readOnly style={{ width: '100%', height: '100px', background: '#000', color: '#0f0', fontFamily: 'monospace', border: '1px solid #333', padding: '5px', fontSize: '0.7rem', marginTop: '10px' }} value={consoleOutput} />

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

      {/* --- JOB MANAGER --- */}
      <div className="admin-section">
        <div className="admin-title">PENDING JOBS <span style={{ color: '#fff' }}>{data.jobs?.length || 0}</span></div>
        <div style={{ maxHeight: '150px', overflowY: 'auto', marginBottom: '10px' }}>
          {data.jobs?.length === 0 && <div style={{ textAlign: 'center', color: '#555', padding: '10px' }}>NO JOBS</div>}
          {data.jobs?.map(j => (
            <div key={j.id} className="job-item">
              <div className="job-meta">
                <div style={{ color: '#fff', fontWeight: 'bold' }}>{j.matric}</div>
                <div style={{ marginTop: '2px' }}>
                  <span style={{ color: j.job_type === 'activity' ? 'var(--accent)' : 'var(--primary)', fontWeight: 'bold', fontSize: '0.65rem', border: '1px solid', padding: '1px 4px', borderRadius: '3px' }}>
                    {(j.job_type || 'CLASS').toUpperCase()}
                  </span>
                  <span style={{ color: '#888', marginLeft: '5px' }}>{j.gid}</span>
                </div>
              </div>
              <button className="btn" style={{ color: '#f00', padding: '2px 8px', minWidth: 'auto' }} onClick={() => handleJobAction('delete_single_job', j.id)}>X</button>
            </div>
          ))}
        </div>
        <button className="btn" style={{ color: '#f00', width: '100%' }} onClick={() => handleJobAction('delete_all_jobs')}>DELETE ALL JOBS</button>
      </div>

      {/* --- NETWORK ACTIVITY --- */}
      <div className="admin-section">
        <div className="admin-title">
          <span>NETWORK ACTIVITY</span>
          <button onClick={loadData} style={{ background: 'none', border: 'none', color: 'var(--primary)', cursor: 'pointer', fontSize: '0.7rem' }}>REFRESH</button>
        </div>
        <div style={{ maxHeight: '350px', overflowY: 'auto', border: '1px solid #333' }}>
          {networkGroups.map(group => {
            const isExpanded = expandedIps[group.id];
            const color = group.banned ? '#f00' : '#0f0';

            return (
              <div key={group.id} className="ip-group">
                <div className="ip-header" onClick={() => setExpandedIps(prev => ({ ...prev, [group.id]: !prev[group.id] }))}>
                  <div>
                    <span style={{ color, marginRight: '5px', fontSize: '1.2rem' }}>●</span>
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <span className="ip-addr-text">{group.id}</span>
                      <div style={{ fontSize: '0.7rem', color: '#888' }}>
                        {group.name ? <span style={{ color: 'var(--primary)', marginRight: '5px' }}>({group.name})</span> : null}
                        {group.recentIdentity}
                      </div>
                    </div>
                  </div>

                  <div className="ip-actions" onClick={e => e.stopPropagation()}>
                    <button className="btn" style={{ color: '#888', padding: '4px 8px', minWidth: 'auto' }} onClick={() => openTagModal(group.id, group.name || '')}>TAG</button>
                    <button className="btn" style={{ color: '#f00', padding: '4px 8px', minWidth: 'auto' }} onClick={() => handleDeviceDelete(group.id)}>DEL</button>
                    <button className="btn" style={{ color: color, padding: '4px 8px', minWidth: 'auto' }} onClick={() => handleIpAction(group.id, group.banned ? 'unban' : 'ban')}>{group.banned ? 'UNBAN' : 'BAN'}</button>
                  </div>
                </div>

                {isExpanded && (
                  <div className="ip-logs" style={{ display: 'block' }}>
                    {group.logs.length === 0 && <div style={{ padding: '5px', color: '#555', fontSize: '0.7rem' }}>No recent logs</div>}
                    {group.logs.map(l => (
                      <div key={l.id} className="log-row">
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span>{l.timestamp.substring(11, 19)}</span>
                          <span style={{ color: '#fff' }}>{l.matric || '-'}</span>
                        </div>
                        <div style={{ color: '#ccc' }}>{l.action} {l.details || ''}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* --- TAG MODAL --- */}
      <Modal title="TAG DEVICE / IP" isOpen={!!tagModalData} onClose={closeTagModal} maxWidth="300px">
        <div style={{ textAlign: 'center' }}>
          <div style={{ marginBottom: '15px', color: '#888', fontFamily: 'monospace', fontSize: '0.8rem', wordBreak: 'break-all' }}>
            {tagModalData?.id}
          </div>
          <input
            type="text" className="t-input"
            placeholder="Nickname"
            style={{ width: '100%', marginBottom: '15px' }}
            value={tagModalData?.name || ''}
            onChange={(e) => setTagModalData({ ...tagModalData, name: e.target.value })}
          />
          <button className="btn" style={{ width: '100%' }} onClick={saveIpTag}>SAVE TAG</button>
        </div>
      </Modal>

    </div>
  );
}