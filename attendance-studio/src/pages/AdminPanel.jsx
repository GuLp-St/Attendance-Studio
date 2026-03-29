// --- START OF FILE AdminPanel.jsx ---

import { useState, useEffect, useMemo, useRef } from 'react';
import { api, getDirectory } from '../services/api';
import { useToast } from '../contexts/ToastContext';
import { useConfirm } from '../contexts/ConfirmContext';
import Modal from '../components/Modal';
import { ErrorBoundary } from '../components/ErrorBoundary';

const ADMIN_KEY_STORAGE = 'admin_key_cache';

export default function AdminPanel() {
  const { showToast } = useToast();
  const { confirm } = useConfirm();

  const [key, setKey] = useState(() => sessionStorage.getItem(ADMIN_KEY_STORAGE) || '');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);
  const [expandedIps, setExpandedIps] = useState({});
  const [tagModalData, setTagModalData] = useState(null);

  // System Log Tab
  const [logTab, setLogTab] = useState('class');
  const [expandedLogs, setExpandedLogs] = useState({});

  // Auto System State
  const [autoAccounts, setAutoAccounts] = useState([]);
  const [autoIndex, setAutoIndex] = useState(0);

  // Manual System State
  const [manualMode, setManualMode] = useState(false);
  const [manualMatric, setManualMatric] = useState('');
  const [manualPwd, setManualPwd] = useState('');
  const [manualTestStatus, setManualTestStatus] = useState('none'); // none|testing|valid|invalid

  const [directory, setDirectory] = useState([]);
  useEffect(() => { getDirectory().then(setDirectory).catch(() => {}) }, []);

  // Sync Manager State
  const [formSync, setFormSync] = useState({ classStart: 0, actStart: 0, actMonths: 6 });
  const [priorityCourses, setPriorityCourses] = useState([]);
  const [courseSearch, setCourseSearch] = useState('');

  // Priority Student IDs
  const [priorityStudentIds, setPriorityStudentIds] = useState([]);
  const [studentIdSearch, setStudentIdSearch] = useState('');

  // Dirty state tracking for floating save button
  const [dirty, setDirty] = useState({});
  const markDirty = (key) => setDirty(prev => ({ ...prev, [key]: true }));

  // Per-job running state (client-side lock)
  const [jobRunning, setJobRunning] = useState({
    class: false, student: false, activity: false, verify: false, autojobs: false
  });

  // Per-job log output displayed in textareas
  const [jobLogs, setJobLogs] = useState({
    class: 'Ready...', student: 'Ready...', activity: 'Ready...', verify: 'Ready...', autojobs: 'Awaiting trigger...'
  });
  const logTextRefs = useRef({});

  // Modal
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
      sessionStorage.setItem(ADMIN_KEY_STORAGE, key);

      if (res.auto_accounts) {
        const validAccs = res.auto_accounts.sort((a, b) => parseInt(b.matric) - parseInt(a.matric));
        setAutoAccounts(validAccs);
        if (res.config?.system_matric) {
          const idx = validAccs.findIndex(a => a.matric === res.config.system_matric);
          if (idx !== -1) { setAutoIndex(idx); setManualMode(false); }
          else {
            setManualMode(true);
            setManualMatric(res.config.system_matric);
            setManualPwd(res.config.system_pwd || '');
            setManualTestStatus('valid');
          }
        }
      }

      if (res.config) {
        setFormSync({
          classStart: res.config.start_id || 100000,
          actStart: res.config.act_start_id || 107000,
          actMonths: res.config.act_months || 6,
        });
        setPriorityCourses(res.config.priority_courses || []);
        setPriorityStudentIds(res.config.priority_student_ids || []);
      }
    } catch (e) {
      showToast(e.message || 'Invalid Key', 'error');
      setIsAuthenticated(false);
    } finally { setLoading(false); }
  };

  // Unified save that collects all dirty fields
  const saveAllSettings = async () => {
    try {
      const payload = { key, type: 'save_settings' };
      let hasSomething = false;

      if (dirty.sync_class) { payload.last_scanned = formSync.classStart; hasSomething = true; }
      if (dirty.sync_activity) { payload.act_start_id = formSync.actStart; payload.act_months = formSync.actMonths; hasSomething = true; }
      if (dirty.priority_courses) { payload.priority_courses = priorityCourses; hasSomething = true; }
      if (dirty.priority_students) { payload.priority_student_ids = priorityStudentIds; hasSomething = true; }
      if (dirty.system_account || dirty.manual_mode) {
        payload.system_matric = manualMode ? manualMatric : (autoAccounts[autoIndex]?.matric || '');
        payload.system_pwd = manualMode ? manualPwd : (autoAccounts[autoIndex]?.password || '');
        hasSomething = true;
      }

      if (!hasSomething) return;
      await api.post('/admin_dashboard', payload);
      showToast('Settings saved!', 'success');
      setDirty({});
    } catch (e) { showToast(e.message, 'error'); }
  };

  const pendingCount = Object.values(dirty).filter(Boolean).length;

  const triggerSync = async (type) => {
    if (jobRunning[type]) return;
    if (!await confirm(`Start ${type.toUpperCase()} Sync?`)) return;
    const endpoint = type === 'class' ? '/admin_sync_class' : type === 'student' ? '/admin_sync_student' : '/admin_sync_activity';
    setJobRunning(prev => ({ ...prev, [type]: true }));
    setJobLogs(prev => ({ ...prev, [type]: 'Running...' }));
    try {
      const res = await fetch(`/api${endpoint}?key=${key}`);
      const text = await res.text();
      setJobLogs(prev => ({ ...prev, [type]: text }));
      setTimeout(() => { const el = logTextRefs.current[type]; if (el) el.scrollTop = el.scrollHeight; }, 50);
    } catch (e) {
      setJobLogs(prev => ({ ...prev, [type]: `Error: ${e.message}` }));
    } finally {
      setJobRunning(prev => ({ ...prev, [type]: false }));
      loadData();
    }
  };

  const triggerVerify = async () => {
    if (jobRunning.verify) return;
    if (!await confirm('Start Directory Verification?')) return;
    setJobRunning(prev => ({ ...prev, verify: true }));
    setJobLogs(prev => ({ ...prev, verify: 'Running...' }));
    try {
      const res = await fetch(`/api/admin_verify_directory?key=${key}`);
      const text = await res.text();
      setJobLogs(prev => ({ ...prev, verify: text }));
      setTimeout(() => { const el = logTextRefs.current['verify']; if (el) el.scrollTop = el.scrollHeight; }, 50);
    } catch (e) {
      setJobLogs(prev => ({ ...prev, verify: `Error: ${e.message}` }));
    } finally {
      setJobRunning(prev => ({ ...prev, verify: false }));
      loadData();
    }
  };

  const triggerAutoJobs = async () => {
    if (jobRunning.autojobs) return;
    setJobRunning(prev => ({ ...prev, autojobs: true }));
    setJobLogs(prev => ({ ...prev, autojobs: 'Running all cron jobs...' }));
    try {
      const res = await fetch(`/api/cron`);
      const text = await res.text();
      setJobLogs(prev => ({ ...prev, autojobs: text }));
      setTimeout(() => { const el = logTextRefs.current['autojobs']; if (el) el.scrollTop = el.scrollHeight; }, 50);
    } catch (e) {
      setJobLogs(prev => ({ ...prev, autojobs: `Exception: ${e.message}` }));
    } finally {
      setJobRunning(prev => ({ ...prev, autojobs: false }));
      loadData(); // refresh active jobs list
    }
  };

  const handleTestManualSys = async () => {
    if (!manualMatric || !manualPwd) return;
    setManualTestStatus('testing');
    try {
      const res = await (await fetch(`/api/admin_test_system_account?key=${key}&matric=${manualMatric}&password=${encodeURIComponent(manualPwd)}`)).json();
      if (res.valid) {
        setManualTestStatus('valid');
        markDirty('system_account');
        showToast('Credential & Timetable Valid!', 'success');
      } else {
        setManualTestStatus('invalid');
        showToast(res.error || 'Invalid Credentials', 'error');
      }
    } catch { setManualTestStatus('invalid'); showToast('Server Error during test', 'error'); }
  };

  const handleJobAction = async (action, jobId = null) => {
    if (!await confirm('Delete?')) return;
    try { await api.post('/admin_dashboard', { key, type: action, job_id: jobId }); loadData(); showToast('Updated', 'success'); } catch (e) {}
  };

  const handleDeviceDelete = async (id) => {
    if (!await confirm('Delete logs & Unban?')) return;
    try { await api.post('/admin_dashboard', { key, type: 'delete_device_logs', target_id: id }); loadData(); showToast('Cleared', 'success'); } catch (e) {}
  };

  const formatMode = (m) => {
    if (!m) return "";
    return m.toUpperCase()
      .replace('TIME_', 'L. MINUTE • ')
      .replace('CROWD_', 'CROWD • ')
      .replace('_ONETIME', ' • ONE TIME')
      .replace('_PERMANENT', ' • PERMANENT')
      .replace(' •  • ', ' • ');
  };

  const handleIpAction = async (ip, action) => {
    if (!await confirm(`${action.toUpperCase()} IP: ${ip}?`)) return;
    try { await api.post('/admin_dashboard', { key, type: 'ban_ip', ip, action }); loadData(); showToast(`IP ${action}ned`, 'success'); } catch (e) {}
  };

  const saveIpTag = async () => {
    if (!tagModalData) return;
    try { await api.post('/admin_dashboard', { key, type: 'set_ip_name', ip: tagModalData.id, name: tagModalData.name }); closeTagModal(); loadData(); showToast('Saved', 'success'); } catch (e) {}
  };

  const networkGroups = useMemo(() => {
    if (!data) return [];
    const groups = {};
    (data.logs || []).filter(l => !l.log_type || l.log_type === 'USER_ACTION').forEach(l => {
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
    (data.banned_ips || []).forEach(ip => {
      if (!groups[ip]) groups[ip] = { id: ip, logs: [], banned: true, name: '', recentIdentity: 'Banned', lastActive: '9999' };
      groups[ip].banned = true;
    });
    Object.keys(data.ip_meta || {}).forEach(k => { if (groups[k]) groups[k].name = data.ip_meta[k]; });
    return Object.values(groups).sort((a, b) => (b.lastActive || '').localeCompare(a.lastActive || ''));
  }, [data]);

  const courseMatches = courseSearch.length >= 2
    ? directory.filter(u => {
        if (u.t !== 'c') return false;
        const q = courseSearch.toUpperCase().replace(/\s+/g, '');
        return (u.m || '').toUpperCase().replace(/\s+/g, '').includes(q) ||
               (u.n || '').toUpperCase().replace(/\s+/g, '').includes(q);
      }).slice(0, 5)
    : [];

  const studentMatches = studentIdSearch.length >= 2
    ? directory.filter(u => {
        if (u.t !== 's') return false;
        const q = studentIdSearch.toUpperCase().replace(/\s+/g, '');
        return (u.m || '').toUpperCase().includes(q) ||
               (u.n || '').toUpperCase().replace(/\s+/g, '').includes(q);
      }).slice(0, 5)
    : [];

  if (!isAuthenticated) return (
    <div style={{ textAlign: 'center', padding: '50px 0' }}>
      <input type="password" className="t-input" placeholder="ENTER KEY"
        style={{ borderColor: '#f00', color: '#f00', marginBottom: '10px' }}
        value={key} onChange={e => setKey(e.target.value)} onKeyDown={e => e.key === 'Enter' && loadData()} />
      <button className="btn" style={{ borderColor: '#f00', color: '#f00', width: '100%' }} onClick={loadData} disabled={loading}>
        {loading ? 'VERIFYING...' : 'UNLOCK'}
      </button>
    </div>
  );

  const systemLogs = data?.system_logs || {};
  const LOG_TABS = [
    { key: 'class', label: 'CLASS', color: 'var(--primary)' },
    { key: 'student', label: 'STUDENT', color: '#0f0' },
    { key: 'activity', label: 'ACTIVITY', color: 'var(--accent)' },
    { key: 'verify', label: 'VERIFY', color: '#0ff' },
    { key: 'autojobs', label: 'AUTO JOBS', color: '#f0f' },
  ];

  const formatTs = (ts) => ts ? String(ts).substring(0, 19).replace('T', ' ') : '';

  const RunBtn = ({ type, color, label, onClick }) => {
    const running = jobRunning[type];
    return (
      <button className="btn admin-run-btn" disabled={running}
        style={{ borderColor: running ? '#555' : color, color: running ? '#555' : color, cursor: running ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: '5px' }}
        onClick={onClick}>
        {running ? <><span className="job-spinner" />RUNNING...</> : label}
      </button>
    );
  };

  return (
    <ErrorBoundary>
      <div className="admin-grid" style={{ paddingBottom: pendingCount > 0 ? '90px' : '0' }}>

        {/* ================================================================ */}
        {/* GLOBAL SYSTEM LOGS - TOP SECTION */}
        {/* ================================================================ */}
        <div className="admin-section">
          <div className="admin-title">GLOBAL SYSTEM LOGS</div>
          <div className="log-tab-bar">
            {LOG_TABS.map(t => (
              <div key={t.key} className={`log-tab ${logTab === t.key ? 'active' : ''}`}
                style={logTab === t.key ? { color: t.color, borderBottomColor: t.color } : {}}
                onClick={() => setLogTab(t.key)}>
                {t.label}
                {jobRunning[t.key] && <span className="log-tab-dot" />}
              </div>
            ))}
          </div>

          <div style={{ maxHeight: '220px', overflowY: 'auto' }}>
            {(systemLogs[logTab] || []).length === 0 &&
              <div style={{ padding: '15px', color: '#555', textAlign: 'center', fontSize: '0.8rem' }}>No logs for this category.</div>}
            {(systemLogs[logTab] || []).map((h, i) => {
              const isExpanded = expandedLogs[`${logTab}-${i}`];
              const tabColor = LOG_TABS.find(t => t.key === logTab)?.color || 'var(--primary)';
              return (
                <div key={i} className="sys-log-entry" onClick={() => setExpandedLogs(prev => ({ ...prev, [`${logTab}-${i}`]: !prev[`${logTab}-${i}`] }))}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <span style={{ color: '#888', fontSize: '0.65rem', flex: '0 0 auto' }}>{formatTs(h.timestamp)}</span>
                    <span style={{ color: h.status === 'SUCCESS' ? '#0f0' : '#f00', fontSize: '0.7rem', fontWeight: 'bold', flex: '0 0 auto' }}>{h.status}</span>
                    <span style={{ color: '#ccc', fontSize: '0.7rem', flex: 1 }}>{h.action || h.category || h.log_type}</span>
                    <span style={{ color: tabColor, fontSize: '0.7rem', flex: '0 0 auto' }}>
                      {h.items_found != null ? `${h.items_found} items` : h.items_processed != null ? `${h.items_processed} processed` : ''}
                    </span>
                    <span style={{ color: '#555', fontSize: '0.65rem' }}>{isExpanded ? '▲' : '▼'}</span>
                  </div>
                  {isExpanded && h.log_text && (
                    <pre className="sys-log-detail" style={{ color: tabColor }}>{h.log_text}</pre>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* ================================================================ */}
        {/* SYSTEM ACCOUNT */}
        {/* ================================================================ */}
        <div className="admin-section">
          <div className="admin-title">SYSTEM ACCOUNT</div>

          <label style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '0.8rem', color: '#ccc', cursor: 'pointer', marginBottom: '10px' }}>
            <input type="checkbox" checked={manualMode} onChange={e => { setManualMode(e.target.checked); markDirty('manual_mode'); }} />
            Enable Manual Input
          </label>

          {!manualMode ? (
            <div className="ctrl-row" style={{ marginBottom: 0 }}>
              <div style={{ flex: 1, background: 'rgba(0,0,0,0.4)', padding: '10px', borderRadius: '4px', border: '1px solid var(--primary)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <span style={{ color: 'var(--primary)', fontWeight: 'bold', marginRight: '10px' }}>AUTO:</span>
                  <span style={{ color: '#fff' }}>{autoAccounts[autoIndex]?.matric || 'NO VALID ACCOUNTS'}</span>
                </div>
              </div>
              <div style={{ display: 'flex', gap: '5px' }}>
                <button className="btn" style={{ height: '38px' }} onClick={() => { setAutoIndex(0); markDirty('system_account'); }}>DEFAULT</button>
                <button className="btn" style={{ height: '38px' }} onClick={() => { setAutoIndex((autoIndex + 1) % autoAccounts.length); markDirty('system_account'); }}>SWITCH</button>
              </div>
            </div>
          ) : (
            <div className="ctrl-row" style={{ marginBottom: 0 }}>
              <input type="text" className="t-input" placeholder="Matric" value={manualMatric}
                onChange={e => { setManualMatric(e.target.value); setManualTestStatus('none'); }}
                style={{ flex: 1 }} />
              <input type="text" className="t-input" placeholder="Password" value={manualPwd}
                onChange={e => { setManualPwd(e.target.value); setManualTestStatus('none'); }}
                style={{ flex: 1 }} />
              {manualTestStatus === 'valid' ? (
                <button className="btn" style={{ height: '38px', borderColor: '#0f0', color: '#0f0' }}>✓ VALID</button>
              ) : (
                <button className="btn" style={{ height: '38px', borderColor: manualTestStatus === 'invalid' ? '#f00' : 'var(--primary)' }}
                  onClick={handleTestManualSys}
                  disabled={manualTestStatus === 'testing' || !manualMatric || !manualPwd}>
                  {manualTestStatus === 'testing' ? 'TESTING...' : 'VALIDATE'}
                </button>
              )}
            </div>
          )}

          {/* Priority Student IDs */}
          <div style={{ marginTop: '15px', background: 'rgba(0,0,0,0.3)', padding: '10px', borderRadius: '4px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <span style={{ fontSize: '0.65rem', color: '#aaa', fontWeight: 'bold' }}>PRIORITY STUDENT IDs (VERIFY FIRST)</span>
              <RunBtn type="verify" color="var(--primary)" label="RUN VERIFY" onClick={triggerVerify} />
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', marginBottom: '8px' }}>
              {priorityStudentIds.length === 0 && <span style={{ color: '#555', fontSize: '0.7rem' }}>None — LRV queue used</span>}
              {priorityStudentIds.map(id => (
                <div key={id} style={{ background: 'rgba(0,255,255,0.08)', border: '1px solid var(--primary)', color: 'var(--primary)', padding: '2px 6px', borderRadius: '4px', fontSize: '0.7rem', display: 'flex', alignItems: 'center', gap: '5px' }}>
                  {id}
                  <span style={{ cursor: 'pointer', color: '#f00' }} onClick={() => { setPriorityStudentIds(prev => prev.filter(x => x !== id)); markDirty('priority_students'); }}>✕</span>
                </div>
              ))}
            </div>
            <div style={{ position: 'relative' }}>
              <input type="text" className="t-input" placeholder="Search student matric/name..."
                value={studentIdSearch} onChange={e => setStudentIdSearch(e.target.value)}
                style={{ padding: '6px', fontSize: '0.8rem' }} />
              {studentMatches.length > 0 && (
                <div className="results-list" style={{ display: 'block', zIndex: 10, border: '1px solid var(--primary)' }}>
                  {studentMatches.map(u => (
                    <div key={u.m} className="result-item" onClick={() => {
                      if (!priorityStudentIds.includes(u.m)) { setPriorityStudentIds(prev => [...prev, u.m]); markDirty('priority_students'); }
                      setStudentIdSearch('');
                    }}>
                      <span style={{ color: 'var(--primary)' }}>{u.m}</span> <span style={{ color: '#fff' }}>{u.n}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Verify log textarea */}
          <textarea readOnly ref={el => logTextRefs.current['verify'] = el}
            style={{ width: '100%', height: '80px', background: '#000', color: '#0f0', fontFamily: 'monospace', border: '1px solid #333', padding: '5px', fontSize: '0.7rem', marginTop: '12px', boxSizing: 'border-box', resize: 'none' }}
            value={jobLogs.verify} />
        </div>

        {/* ================================================================ */}
        {/* SYNC MANAGER */}
        {/* ================================================================ */}
        <div className="admin-section">
          <div className="admin-title">SYNC MANAGER</div>

          {/* Class Sync */}
          <div style={{ borderTop: '1px solid #333', paddingTop: '15px', marginTop: '5px' }}>
            <div style={{ fontSize: '0.7rem', color: 'var(--primary)', fontWeight: 'bold', marginBottom: '8px' }}>CLASS SYNC (DISCOVERY)</div>
            <div className="ctrl-row">
              <input type="number" className="t-input" style={{ flex: 1 }} placeholder="Start ID"
                value={formSync.classStart} onChange={e => { setFormSync(p => ({ ...p, classStart: e.target.value })); markDirty('sync_class'); }} />
              <RunBtn type="class" color="var(--primary)" label="RUN" onClick={() => triggerSync('class')} />
            </div>
            <textarea readOnly ref={el => logTextRefs.current['class'] = el}
              style={{ width: '100%', height: '70px', background: '#000', color: 'var(--primary)', fontFamily: 'monospace', border: '1px solid #333', padding: '5px', fontSize: '0.7rem', boxSizing: 'border-box', resize: 'none' }}
              value={jobLogs.class} />
          </div>

          {/* Student Sync */}
          <div style={{ borderTop: '1px solid #333', paddingTop: '15px', marginTop: '10px' }}>
            <div style={{ fontSize: '0.7rem', color: '#0f0', fontWeight: 'bold', marginBottom: '8px' }}>STUDENT SYNC (FILL DB)</div>
            <div style={{ background: 'rgba(0,0,0,0.3)', padding: '10px', borderRadius: '4px', marginBottom: '10px' }}>
              <div style={{ fontSize: '0.65rem', color: '#aaa', marginBottom: '5px' }}>PRIORITY COURSES</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', marginBottom: '10px' }}>
                {priorityCourses.length === 0 && <span style={{ color: '#555', fontSize: '0.7rem' }}>None Set</span>}
                {priorityCourses.map(c => (
                  <div key={c} style={{ background: 'rgba(0,255,0,0.1)', border: '1px solid #0f0', color: '#0f0', padding: '2px 6px', borderRadius: '4px', fontSize: '0.7rem', display: 'flex', alignItems: 'center', gap: '5px' }}>
                    {c} <span style={{ cursor: 'pointer', color: '#f00' }} onClick={() => { setPriorityCourses(prev => prev.filter(x => x !== c)); markDirty('priority_courses'); }}>✕</span>
                  </div>
                ))}
              </div>
              <div style={{ position: 'relative' }}>
                <input type="text" className="t-input" placeholder="Add Priority Course Code..."
                  value={courseSearch} onChange={e => setCourseSearch(e.target.value)}
                  style={{ padding: '6px', fontSize: '0.8rem' }} />
                {courseMatches.length > 0 && (
                  <div className="results-list" style={{ display: 'block', zIndex: 10, border: '1px solid #0f0' }}>
                    {courseMatches.map(u => (
                      <div key={u.m} className="result-item" onClick={() => {
                        if (!priorityCourses.includes(u.m)) { setPriorityCourses(prev => [...prev, u.m]); markDirty('priority_courses'); }
                        setCourseSearch('');
                      }}>
                        <span style={{ color: '#0f0' }}>{u.n}</span> <span style={{ color: '#fff' }}>{u.m}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="ctrl-row">
              <div style={{ flex: 1 }} />
              <RunBtn type="student" color="#0f0" label="RUN" onClick={() => triggerSync('student')} />
            </div>
            <textarea readOnly ref={el => logTextRefs.current['student'] = el}
              style={{ width: '100%', height: '70px', background: '#000', color: '#0f0', fontFamily: 'monospace', border: '1px solid #333', padding: '5px', fontSize: '0.7rem', boxSizing: 'border-box', resize: 'none' }}
              value={jobLogs.student} />
          </div>

          {/* Activity Sync */}
          <div style={{ borderTop: '1px solid #333', paddingTop: '15px', marginTop: '10px' }}>
            <div style={{ fontSize: '0.7rem', color: 'var(--accent)', fontWeight: 'bold', marginBottom: '8px' }}>ACTIVITY SYNC</div>
            <div className="ctrl-row">
              <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flex: '0 0 auto' }}>
                <label>MTH:</label>
                <input type="number" className="t-input" style={{ width: '50px' }} value={formSync.actMonths}
                  onChange={e => { setFormSync(p => ({ ...p, actMonths: e.target.value })); markDirty('sync_activity'); }} />
              </div>
              <input type="number" className="t-input" style={{ flex: 1 }} placeholder="Start ID"
                value={formSync.actStart} onChange={e => { setFormSync(p => ({ ...p, actStart: e.target.value })); markDirty('sync_activity'); }} />
              <RunBtn type="activity" color="var(--accent)" label="RUN" onClick={() => triggerSync('activity')} />
            </div>
            <textarea readOnly ref={el => logTextRefs.current['activity'] = el}
              style={{ width: '100%', height: '70px', background: '#000', color: 'var(--accent)', fontFamily: 'monospace', border: '1px solid #333', padding: '5px', fontSize: '0.7rem', boxSizing: 'border-box', resize: 'none' }}
              value={jobLogs.activity} />
          </div>
        </div>

        {/* ================================================================ */}
        {/* ACTIVE AUTO-JOBS */}
        {/* ================================================================ */}
        <div className="admin-section">
          <div className="admin-title">
            <span>ACTIVE AUTO-JOBS</span>
            <button onClick={() => handleJobAction('delete_all_jobs')} style={{ background: 'none', border: 'none', color: '#f00', cursor: 'pointer', fontSize: '0.7rem' }}>PURGE ALL</button>
          </div>

          <div style={{ display: 'flex', gap: '10px', marginBottom: '10px' }}>
            <button className="btn" style={{ flex: 1, borderColor: jobRunning.autojobs ? '#555' : '#f0f', color: jobRunning.autojobs ? '#555' : '#f0f', cursor: jobRunning.autojobs ? 'not-allowed' : 'pointer' }}
              disabled={jobRunning.autojobs} onClick={() => triggerAutoJobs()}>
              {jobRunning.autojobs ? 'RUNNING...' : 'TRIGGER ALL JOBS (CRON)'}
            </button>
          </div>
          <textarea readOnly ref={el => logTextRefs.current['autojobs'] = el}
            style={{ width: '100%', height: '70px', background: '#000', color: '#f0f', fontFamily: 'monospace', border: '1px solid #333', padding: '5px', fontSize: '0.7rem', marginBottom: '12px', boxSizing: 'border-box', resize: 'none' }}
            value={jobLogs.autojobs} />

          <div style={{ maxHeight: '200px', overflowY: 'auto', background: 'rgba(0,0,0,0.3)', border: '1px solid #333', marginBottom: '15px' }}>
            {(!data?.jobs || data.jobs.length === 0) && <div style={{ padding: '10px', color: '#555', textAlign: 'center', fontSize: '0.8rem' }}>No Active Auto-Jobs</div>}
            {data?.jobs?.map(job => {
              const isReg = job.type === 'register';
              const isActivity = job.job_type === 'activity' || (!isReg && !job.code && (job.target || String(job.gid).length > 6));
              const isClass = job.job_type === 'class' || (!isReg && !isActivity);
              const jobLabel = isReg ? 'REG' : isActivity ? 'ACTIVITY' : 'CLASS';
              const jobColor = isReg ? '#f0f' : isActivity ? 'var(--accent)' : 'var(--primary)';
              const jobName = isReg 
                ? `${job.code || job.gid || 'Course'} ${job.group_id || ''}`
                : `${job.target || job.code || job.gid || (isActivity ? 'Activity' : 'Class')}`;
              
              const userDesc = job.matric || '';
              return (
                <div key={job.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px', borderBottom: '1px solid #333', alignItems: 'center' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                      <span style={{ color: jobColor, fontWeight: 'bold', fontSize: '0.65rem', padding: '1px 4px', border: `1px solid ${jobColor}`, borderRadius: '3px', letterSpacing: '0.5px' }}>{jobLabel}</span>
                      <span style={{ color: '#eee', fontWeight: 'bold', fontSize: '0.8rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{jobName}</span>
                      {job.mode && (
                        <span style={{ fontSize: '0.6rem', padding: '2px 6px', borderRadius: '4px', background: 'rgba(255,255,255,0.05)', color: '#888', fontWeight: 'bold' }}>
                          {formatMode(job.mode)}
                        </span>
                      )}
                    </div>
                    <span style={{ fontSize: '0.68rem', color: '#666', marginTop: '2px' }}>User: {userDesc}</span>
                  </div>
                  <button className="btn" style={{ color: '#f00', padding: '4px 10px', height: '28px', minWidth: 'auto', borderColor: '#f00', marginLeft: '8px', flexShrink: 0 }} onClick={() => handleJobAction('delete_single_job', job.id)}>DEL</button>
                </div>
              );
            })}
          </div>
        </div>

        {/* ================================================================ */}
        {/* NETWORK ACTIVITY */}
        {/* ================================================================ */}
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
                      <div style={{ display: 'inline-flex', flexDirection: 'column' }}>
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
                      <button className="btn" style={{ color, padding: '4px 8px', minWidth: 'auto' }} onClick={() => handleIpAction(group.id, group.banned ? 'unban' : 'ban')}>{group.banned ? 'UNBAN' : 'BAN'}</button>
                    </div>
                  </div>
                  {isExpanded && (
                    <div className="ip-logs" style={{ display: 'block' }}>
                      {group.logs.length === 0 && <div style={{ padding: '5px', color: '#555', fontSize: '0.7rem' }}>No recent logs</div>}
                      {group.logs.map(l => (
                        <div key={l.id} className="log-row">
                          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span>{formatTs(l.timestamp)}</span>
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

        {/* Tag Modal */}
        <Modal title="TAG DEVICE / IP" isOpen={!!tagModalData} onClose={closeTagModal} maxWidth="300px">
          <div style={{ textAlign: 'center' }}>
            <div style={{ marginBottom: '15px', color: '#888', fontFamily: 'monospace', fontSize: '0.8rem', wordBreak: 'break-all' }}>{tagModalData?.id}</div>
            <input type="text" className="t-input" placeholder="Nickname" style={{ width: '100%', marginBottom: '15px' }}
              value={tagModalData?.name || ''} onChange={e => setTagModalData({ ...tagModalData, name: e.target.value })} />
            <button className="btn" style={{ width: '100%' }} onClick={saveIpTag}>SAVE TAG</button>
          </div>
        </Modal>

        {/* ================================================================ */}
        {/* FLOATING SAVE BUTTON */}
        {/* ================================================================ */}
        {pendingCount > 0 && (
          <div className="floating-save-btn" onClick={saveAllSettings}>
            <span className="floating-save-count">{pendingCount} change{pendingCount > 1 ? 's' : ''} pending</span>
            <span className="floating-save-label">CLICK TO SAVE ALL</span>
          </div>
        )}
      </div>
    </ErrorBoundary>
  );
}

// --- END OF FILE AdminPanel.jsx ---