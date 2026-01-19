import sys
import os

# FIX: Add the current folder to Python's path so it can find 'core_api.py'
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from flask import Flask, request, jsonify, Response
from firebase_admin import credentials, initialize_app, firestore
from google.cloud.firestore import FieldFilter
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
import json
import os
import requests
import traceback
import core_api

# ==========================================
#  INITIALIZATION
# ==========================================
app = Flask(__name__)

# Initialize Firebase only once to prevent Vercel hot-reload errors
if not len(initialize_app._apps):
    # Retrieve JSON string from Vercel Environment Variables
    cred_content = os.environ.get('FIREBASE_CREDENTIALS')
    if cred_content:
        cred_json = json.loads(cred_content)
        cred = credentials.Certificate(cred_json)
        initialize_app(cred)
    else:
        # Fallback for local testing if env var missing
        print("WARNING: FIREBASE_CREDENTIALS env var not found.")

db = firestore.client()

# --- CONFIGURATION ---
ADMIN_SECRET_KEY = "nexus"
FALLBACK_USER = "85699"
FALLBACK_PASS = "Unimas!010914011427"
FALLBACK_START_ID = 100000 
FALLBACK_BATCH = 1000
FALLBACK_THRESH = 500
FALLBACK_LIMIT = 5000
FALLBACK_ACT_START = 107000
FALLBACK_ACT_MONTHS = 6 

# ==========================================
#  HELPERS
# ==========================================

def get_malaysia_time():
    """Returns current time in UTC+8."""
    return datetime.now(timezone.utc) + timedelta(hours=8)

def get_sys_config():
    try:
        conf_doc = db.collection('system').document('config').get()
        auth_doc = db.collection('system').document('auth').get()
        conf = conf_doc.to_dict() if conf_doc.exists else {}
        auth = auth_doc.to_dict() if auth_doc.exists else {}
    except:
        conf, auth = {}, {}
    
    return {
        "user": auth.get("username", FALLBACK_USER),
        "pass": auth.get("password", FALLBACK_PASS),
        "start_id": int(conf.get("last_scanned_id", FALLBACK_START_ID)),
        "batch_size": int(conf.get("batch_size", FALLBACK_BATCH)),
        "empty_thresh": int(conf.get("empty_threshold", FALLBACK_THRESH)),
        "scan_limit": int(conf.get("scan_limit", FALLBACK_LIMIT)),
        "current_semester": conf.get("current_semester", ""),
        "act_start_id": int(conf.get("act_last_scanned_id", FALLBACK_ACT_START)),
        "act_months": int(conf.get("act_time_threshold", FALLBACK_ACT_MONTHS))
    }

def get_authorized_session():
    cfg = get_sys_config()
    s = requests.Session()
    core_api.configure_session(s, cfg['user'], cfg['pass'])
    return s

def get_client_ip():
    if request.headers.getlist("X-Forwarded-For"):
        return request.headers.getlist("X-Forwarded-For")[0]
    return request.remote_addr

def log_action(ip, matric, action, details=""):
    try:
        # Capture Device ID from headers if available
        dev_id = request.headers.get('X-Device-ID', 'unknown')
        
        db.collection('system_logs').add({
            "timestamp": get_malaysia_time().isoformat(),
            "ip": ip,
            "device_id": dev_id,
            "matric": matric,
            "action": action,
            "details": str(details)
        })
    except: pass

def create_notification(matric, type, title, status, details, mode):
    try:
        db.collection('notifications').add({
            "matric": matric,
            "type": type,
            "title": title,
            "status": status,
            "details": details,
            "mode": mode,
            "timestamp": get_malaysia_time().isoformat()
        })
    except: pass

def save_sync_log(type, status, messages, items_count):
    try:
        db.collection('sync_history').add({
            "timestamp": get_malaysia_time().isoformat(),
            "type": type,
            "status": status,
            "log_text": "\n".join(messages),
            "items_found": items_count
        })
        # Cleanup
        docs = list(db.collection('sync_history').order_by('timestamp', direction=firestore.Query.DESCENDING).stream())
        if len(docs) > 10:
            batch = db.batch()
            for doc in docs[10:]: batch.delete(doc.reference)
            batch.commit()
    except: pass

def consolidate_timetable(slots):
    if not slots: return []
    by_day = {}
    for s in slots:
        if s['day'] not in by_day: by_day[s['day']] = []
        by_day[s['day']].append(s)
    final_slots = []
    for day, day_slots in by_day.items():
        def parse_t(t_str):
            try: return datetime.strptime(t_str, '%I:%M %p')
            except: return datetime.min
        for s in day_slots:
            s['dt_start'] = parse_t(s['start'])
            s['dt_end'] = parse_t(s['end'])
        day_slots.sort(key=lambda x: x['dt_start'])
        merged = []
        if day_slots:
            curr = day_slots[0]
            for next_s in day_slots[1:]:
                if curr['code'] == next_s['code'] and curr['loc'] == next_s['loc']:
                    if next_s['dt_start'] <= curr['dt_end']:
                        if next_s['dt_end'] > curr['dt_end']:
                            curr['dt_end'] = next_s['dt_end']
                            curr['end'] = next_s['end']
                        continue 
                merged.append(curr)
                curr = next_s
            merged.append(curr)
        for s in merged:
            del s['dt_start']
            del s['dt_end']
        final_slots.extend(merged)
    return final_slots

def delete_collection(collection_name, batch_size=400):
    docs = db.collection(collection_name).limit(batch_size).stream()
    deleted = 0
    batch = db.batch()
    for doc in docs:
        batch.delete(doc.reference)
        deleted += 1
    if deleted > 0:
        batch.commit()
        delete_collection(collection_name, batch_size)

# ==========================================
#  MAIN ROUTE HANDLER (CATCH-ALL)
# ==========================================

@app.route('/', defaults={'path': ''}, methods=['GET', 'POST', 'DELETE', 'OPTIONS'])
@app.route('/<path:path>', methods=['GET', 'POST', 'DELETE', 'OPTIONS'])
def api_handler(path):
    # CORS HEADERS
    headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, X-Device-ID',
        'Content-Type': 'application/json'
    }
    
    if request.method == 'OPTIONS':
        return Response("", status=204, headers=headers)

    path = "/" + path
    args = request.args
    client_ip = get_client_ip()

    # 0. IP BAN CHECK
    if db.collection('banned_ips').document(client_ip).get().exists:
        return jsonify({"error": "Access Denied"}), 403

    # ==========================================
    #  ENDPOINTS
    # ==========================================

    # 1. DIRECTORY
    if path == '/directory':
        dir_type = args.get('type', 'student')
        prefix = 'dir_' if dir_type == 'student' else 'org_dir_'
        try:
            full_dir = []
            for i in range(50):
                doc = db.collection('system').document(f'{prefix}{i}').get()
                if not doc.exists: break
                full_dir.extend(json.loads(doc.to_dict().get('json', '[]')))
            return Response(json.dumps(full_dir), headers=headers)
        except: return jsonify([])

    # 2. SEARCH
    elif path == '/search':
        query = args.get('q', '').strip()
        if len(query) < 2: return jsonify([])
        results = []
        try:
            students_ref = db.collection('students')
            q_upper = query.upper()
            if query[0].isdigit(): docs = students_ref.order_by('__name__').start_at([q_upper]).end_at([q_upper + '\uf8ff']).limit(10).stream()
            else: docs = students_ref.order_by('name').start_at([q_upper]).end_at([q_upper + '\uf8ff']).limit(10).stream()
            for doc in docs: results.append({"matric": doc.id, "name": doc.to_dict().get('name', 'Unknown')})
        except: return jsonify([])
        return Response(json.dumps(results), headers=headers)

    # 3. DASHBOARD
    elif path == '/dashboard':
        matric = args.get('matric')
        log_action(client_ip, matric, "VIEW_DASHBOARD")
        try:
            doc = db.collection('students').document(matric).get()
            if not doc.exists: return jsonify({}), 404
            
            req_session = get_authorized_session()
            
            # Note: Requests session adapter pool size is less relevant in Serverless, but keeping safe
            user_data = doc.to_dict()
            group_ids = user_data.get('groups', [])
            following_ids = user_data.get('following', [])
            
            active_autoscan = set()
            try:
                for j in db.collection('autoscan_jobs').where(filter=FieldFilter("matric", "==", matric)).stream():
                    if j.to_dict().get('status') == 'pending': active_autoscan.add(j.to_dict().get('gid'))
            except: pass

            courses = {}
            raw_timetable = []

            # STEP 1: FETCH COURSE INFO
            with ThreadPoolExecutor(max_workers=8) as ex:
                f_info = {ex.submit(core_api.get_group_info, gid, req_session): gid for gid in group_ids}
                for f in as_completed(f_info):
                    gid = f_info[f]
                    if res := f.result(): 
                        res['autoscan_active'] = (gid in active_autoscan)
                        res['gid'] = gid
                        res['sessions'] = None
                        courses[gid] = res

            # STEP 2: FETCH TIMETABLE
            with ThreadPoolExecutor(max_workers=8) as ex:
                f_time = {ex.submit(core_api.get_timetable, gid, req_session): gid for gid in group_ids}
                for f in as_completed(f_time):
                    gid = f_time[f]
                    slots = f.result()
                    if slots and isinstance(slots, list) and gid in courses:
                        for s in slots:
                            if isinstance(s, dict):
                                raw_timetable.append({"day": s.get('KETERANGAN_HARI'), "start": s.get('MASA_MULA'), "end": s.get('MASA_TAMAT'), "loc": s.get('LOKASI'), "code": courses[gid]['code'], "name": courses[gid]['name'], "group": courses[gid]['group'], "gid": gid})
            
            final_courses = list(courses.values())
            final_courses.sort(key=lambda x: x['code'])
            
            return Response(json.dumps({
                "name": user_data['name'], 
                "courses": final_courses, 
                "timetable": consolidate_timetable(raw_timetable), 
                "following": following_ids
            }), headers=headers)
        except Exception as e:
            traceback.print_exc()
            return jsonify({"error": str(e)}), 500

    # 4. COURSE DETAILS
    elif path == '/course_details':
        matric, gid = args.get('matric'), args.get('gid')
        try:
            req_session = get_authorized_session()
            info = core_api.get_group_info(gid, req_session)
            if not info: raise Exception("Info Fail")
            
            with ThreadPoolExecutor(max_workers=4) as ex:
                f_m = ex.submit(core_api.get_sessions, gid, req_session)
                f_h = ex.submit(core_api.get_student_history, matric, info['code'], gid, req_session)
                ml, hl = f_m.result() or [], f_h.result() or []
            
            ml.sort(key=lambda x: x['eventDate'], reverse=True)
            h_map = {}
            for h in hl:
                if 'jadualKehadiran' in h and 'id' in h['jadualKehadiran']: h_map[h['jadualKehadiran']['id']] = h
            
            c_sess = []
            for s in ml:
                st, lid = "Absent", None
                if s['id'] in h_map:
                    ld = h_map[s['id']]
                    sc = ld.get('status')
                    st = "Present (Scan)" if sc == 'P' else "Present (Manual)" if sc == 'M' else "Exempted" if sc == 'L' else sc
                    lid = ld.get('id')
                c_sess.append({
                    "id": s['id'], "date": s['eventDate'], "start": s['startTime'], "end": s.get('endTime', ''),
                    "location": s.get('venue') or s.get('location') or "Unknown Venue",
                    "name": s.get('topic') or s.get('description') or "", 
                    "status": st, "log_id": lid
                })
            return Response(json.dumps(c_sess), headers=headers)
        except Exception as e: return jsonify({"error": str(e)}), 500

    # 5. TARGET DETAILS
    elif path == '/target_details':
        matric, sid, stype = args.get('matric'), args.get('sid'), args.get('type')
        log_action(client_ip, matric, "TARGET_SEARCH", f"{stype}:{sid}")
        try:
            req_session = get_authorized_session()
            res = {}
            if stype == 'class':
                log = core_api.get_log(sid, matric, req_session)
                st, lid = "Absent", None
                if log:
                    sc = log.get('status')
                    st = "Present (Scan)" if sc == 'P' else "Present (Manual)" if sc == 'M' else "Exempted" if sc == 'L' else sc
                    lid = log.get('id')
                res = {"type": "class", "id": sid, "name": f"Class {sid}", "status": st, "log_id": lid, "require_checkout": False}
            elif stype == 'activity':
                det = core_api.get_activity_details(sid, req_session)
                if not det: return jsonify({"error": "Invalid ID"}), 404
                log = core_api.get_activity_log(sid, matric, req_session)
                st, lid, cco = "Absent", None, False
                if log:
                    lid = log.get('id')
                    ci, co = log.get('checkInTime'), log.get('checkOutTime')
                    if det.get('requireCheckout', False):
                        if ci and not co: st = "Checked In (Need Out)"; cco = True
                        elif ci and co: st = "Completed"
                        else: st = "Present"
                    else: st = "Present"
                res = {"type": "activity", "id": str(det['id']), "name": det.get('name'), "date": det.get('eventDate'), "start": det.get('startTime'), "end": det.get('endTime'), "status": st, "log_id": lid, "require_checkout": det.get('requireCheckout', False), "can_checkout": cco}
            return Response(json.dumps(res), headers=headers)
        except Exception as e: return jsonify({"error": str(e)}), 500

    # 6. ACTIONS
    elif path == '/action' and request.method == 'POST':
        d = request.get_json()
        log_action(client_ip, d.get('matric'), d.get('type'), f"ID:{d.get('sid')}")
        msg = "Error"
        try:
            req_session = get_authorized_session()
            if d['type'] == 'scan': msg = core_api.scan_qr(d['sid'], d['matric'], req_session)
            elif d['type'] == 'manual': msg = core_api.manual_attendance(d['sid'], d['matric'], 'M', req_session)
            elif d['type'] == 'exempt': msg = core_api.manual_attendance(d['sid'], d['matric'], 'L', req_session, d.get('remark', ''))
            elif d['type'] == 'delete': msg = core_api.delete_attendance(d['lid'], req_session)
            elif d['type'] == 'act_scan_in': msg = core_api.scan_activity_qr(d['sid'], d['matric'], 'i')
            elif d['type'] == 'act_scan_out': msg = core_api.scan_activity_qr(d['sid'], d['matric'], 'o')
            elif d['type'] == 'act_manual_in': msg = core_api.manual_activity(d['sid'], d['matric'], 'CI', req_session)
            elif d['type'] == 'act_manual_out': msg = core_api.manual_activity(d['sid'], d['matric'], 'CO', req_session)
            elif d['type'] == 'act_delete': msg = core_api.delete_activity_log(d['lid'], req_session)
            elif d['type'] == 'autoscan':
                jid = f"{d['matric']}_{d['gid']}"
                db.collection('autoscan_jobs').document(jid).set({
                    "matric": d['matric'], "gid": str(d['gid']), 
                    "createdAt": get_malaysia_time().isoformat(),
                    "status": "pending",
                    "mode": d.get('mode', 'crowd'), "job_type": d.get('job_type', 'class')
                })
                msg = "Autoscan Activated."
            elif d['type'] == 'cancel_autoscan':
                jid = f"{d['matric']}_{d['gid']}"
                db.collection('autoscan_jobs').document(jid).delete()
                msg = "Autoscan Deactivated."
            elif d['type'] == 'follow_org':
                db.collection('students').document(d['matric']).update({'following': firestore.ArrayUnion([d['sid']])})
                msg = "Followed"
            elif d['type'] == 'unfollow_org':
                db.collection('students').document(d['matric']).update({'following': firestore.ArrayRemove([d['sid']])})
                msg = "Unfollowed"
        except Exception as e: msg = str(e)
        return jsonify({"msg": msg})

    # 7. CRON
    elif path == '/cron':
        try:
            req_session = get_authorized_session()
            now_my = get_malaysia_time()
            today_str = now_my.strftime('%Y-%m-%d')
            
            # Clean old logs
            cutoff = (now_my - timedelta(days=7)).isoformat()
            old_logs = db.collection('system_logs').where(filter=FieldFilter("timestamp", "<", cutoff)).limit(400).stream()
            batch = db.batch(); deleted_logs = 0
            for doc in old_logs: batch.delete(doc.reference); deleted_logs += 1
            if deleted_logs > 0: batch.commit()

            jobs = list(db.collection('autoscan_jobs').stream())
            results = []

            def process_autoscan_job(job):
                d = job.to_dict()
                job_time = datetime.fromisoformat(d['createdAt'])
                if (now_my - job_time).total_seconds() > 86400:
                    create_notification(d['matric'], d.get('job_type','class'), d.get('gid', 'Unknown'), 'FAILED', 'Autoscan Expired (24h)', d.get('mode','crowd'))
                    job.reference.delete(); return "Cleaned (Expired)"
                
                matric, target_id = d['matric'], d['gid']
                mode, j_type = d.get('mode', 'crowd'), d.get('job_type', 'class')

                if j_type == 'class':
                    sessions = core_api.get_sessions(target_id, req_session)
                    target = next((s for s in sessions if datetime.fromtimestamp(s['eventDate']/1000).strftime('%Y-%m-%d') == today_str), None)
                    if not target: return "No Class"
                    
                    my_log = core_api.get_log(target['id'], matric, req_session)
                    if my_log and my_log.get('status') == 'P':
                        create_notification(matric, 'class', f"Class {target_id}", 'SUCCESS', 'Already marked Present', mode)
                        job.reference.delete(); return "Already Present"
                    
                    should_scan = False
                    if mode == 'crowd' and core_api.get_attendance_count(target['id'], req_session) >= 5: should_scan = True
                    elif mode == 'time':
                        try:
                            dt_end = datetime.strptime(f"{today_str} {target['endTime']}", "%Y-%m-%d %I:%M %p")
                            if (dt_end.timestamp() - 1200) <= now_my.timestamp(): should_scan = True
                        except: pass
                    
                    if should_scan:
                        res = core_api.scan_qr(target['id'], matric, req_session)
                        is_success = ("Success" in res or "taken" in res.lower() or ("Server:" in res and "Server Error" not in res))
                        status = "SUCCESS" if is_success else "FAILED"
                        create_notification(matric, 'class', f"Class {target_id}", status, res, mode)
                        job.reference.delete()
                        return f"Attempted ({status})"
                    return f"Pending ({mode})"
                
                elif j_type == 'activity':
                    events = core_api.get_organizer_events(target_id, req_session)
                    target = next((e for e in events if e['eventDate'] == today_str), None)
                    if not target: return "No Event"
                    
                    log = core_api.get_activity_log(target['id'], matric, req_session)
                    is_ci, is_co = (log and log.get('checkInTime')), (log and log.get('checkOutTime'))
                    req_co = target.get('requireCheckout', False)
                    
                    if (req_co and is_ci and is_co) or (not req_co and is_ci):
                        create_notification(matric, 'activity', target.get('name'), 'SUCCESS', 'Activity Completed', mode)
                        job.reference.delete(); return "Completed"
                        
                    scan_ci, scan_co = False, False
                    if mode == 'crowd':
                        stats = core_api.get_event_stats(target['id'], req_session)
                        if not is_ci and stats[0] >= 5: scan_ci = True
                        if is_ci and not is_co and req_co and stats[1] >= 5: scan_co = True
                    elif mode == 'time':
                        try:
                            t_str = target['endTime']
                            try: dt_end = datetime.strptime(f"{today_str} {t_str}", "%Y-%m-%d %I:%M %p")
                            except: dt_end = datetime.strptime(f"{today_str} {t_str}", "%Y-%m-%d %H:%M:%S")
                            if (dt_end.timestamp() - 1200) <= now_my.timestamp():
                                if not is_ci: scan_ci = True
                                if is_ci and not is_co and req_co: scan_co = True
                        except: pass
                    
                    if scan_ci: 
                        r = core_api.scan_activity_qr(target['id'], matric, 'i')
                        is_success = "Success" in r or ("Server:" in r and "Server Error" not in r)
                        status = "SUCCESS" if is_success else "FAILED"
                        create_notification(matric, 'activity', target.get('name'), status, f"Check-In: {r}", mode)
                        if not req_co:
                            job.reference.delete()
                            return f"CI Attempted ({status}) - Job Deleted"
                        return f"CI Attempted ({status}) - Job Kept for CO"

                    if scan_co: 
                        r = core_api.scan_activity_qr(target['id'], matric, 'o')
                        is_success = "Success" in r or ("Server:" in r and "Server Error" not in r)
                        status = "SUCCESS" if is_success else "FAILED"
                        create_notification(matric, 'activity', target.get('name'), status, f"Check-Out: {r}", mode)
                        job.reference.delete()
                        return f"CO Attempted ({status}) - Job Deleted"
                    
                    return f"Pending ({mode})"
                return "Invalid Type"

            with ThreadPoolExecutor(max_workers=5) as ex:
                f_map = {ex.submit(process_autoscan_job, j): j for j in jobs}
                for f in as_completed(f_map):
                    try: results.append(f.result())
                    except Exception as e: results.append(f"Error: {str(e)}")

            return Response(f"Jobs: {len(jobs)} | Processed: {len(results)}", headers=headers)
        except Exception as e: return jsonify({"error": str(e)}), 500

    # 8. NOTIFICATIONS
    elif path == '/notifications':
        matric = args.get('matric')
        if request.method == 'GET':
            docs = db.collection('notifications').where(filter=FieldFilter("matric", "==", matric)).stream()
            res = [{"id": d.id, **d.to_dict()} for d in docs]
            res.sort(key=lambda x: x.get('timestamp', ''), reverse=True)
            return Response(json.dumps(res), headers=headers)
        elif request.method == 'DELETE':
            nid = args.get('id')
            db.collection('notifications').document(nid).delete()
            return jsonify({"status": "deleted"})

    # 9. PROFILE
    elif path == '/profile':
        try:
            req_session = get_authorized_session()
            data = core_api.get_student_biodata(args.get('matric'), req_session)
            if data: return Response(json.dumps(data), headers=headers)
            else: return jsonify({"error": "No Data"}), 404
        except Exception as e: return jsonify({"error": str(e)}), 500

    # 10. ADMIN SYNC CLASS
    elif path == '/admin_sync_class':
        if args.get('key') != ADMIN_SECRET_KEY: return jsonify({"error": "Unauthorized"}), 401
        log_buffer = []
        def log(msg): log_buffer.append(f"[{get_malaysia_time().strftime('%H:%M:%S')}] {msg}")
        try:
            log("Starting Class Sync...")
            cfg = get_sys_config()
            req_session = requests.Session()
            core_api.configure_session(req_session, cfg['user'], cfg['pass'])
            active_sem = core_api.get_active_semester(req_session)
            stored_sem = cfg.get('current_semester')
            if active_sem and active_sem != stored_sem:
                delete_collection('students', 400)
                batch = db.batch()
                for i in range(55): batch.delete(db.collection('system').document(f'dir_{i}'))
                batch.commit()
                db.collection('system').document('config').set({'current_semester': active_sem}, merge=True)
            curr, limit, threshold = cfg['start_id'], cfg['scan_limit'], cfg['empty_thresh']
            discovered, empty_streak, ids_checked = [], 0, 0
            highest_valid_id = curr
            with ThreadPoolExecutor(max_workers=8) as ex:
                while empty_streak < threshold and ids_checked < limit:
                    futures = {ex.submit(core_api.get_group_info, i, req_session): i for i in range(curr, curr + cfg['batch_size'])}
                    found_in_batch, batch_max = 0, 0
                    for f in as_completed(futures):
                        if res := f.result():
                            res_id = int(res['id'])
                            if res_id > batch_max: batch_max = res_id
                            if not active_sem or res.get('semester') == active_sem: discovered.append(res)
                            found_in_batch += 1
                    if found_in_batch > 0:
                        empty_streak = 0
                        if batch_max > highest_valid_id: highest_valid_id = batch_max
                        log(f"Found {found_in_batch} (Max: {batch_max})")
                    else: empty_streak += cfg['batch_size']
                    curr += cfg['batch_size']; ids_checked += cfg['batch_size']
            new_cursor = highest_valid_id if empty_streak >= threshold else curr
            if discovered:
                log(f"Processing {len(discovered)} groups...")
                updates = {}
                with ThreadPoolExecutor(max_workers=8) as ex:
                    futures = {ex.submit(core_api.get_students, g['id'], req_session): g['id'] for g in discovered}
                    for f in as_completed(futures):
                        gid = futures[f]
                        for s in f.result():
                            m, n = s.get("NOMATRIK"), s.get("NAMAPELAJAR")
                            if m:
                                if m not in updates: updates[m] = {"name": n, "groups": [], "semester": active_sem}
                                if n and n != "Unknown": updates[m]["name"] = n
                                if gid not in updates[m]["groups"]: updates[m]["groups"].append(gid)
                log(f"Updating {len(updates)} students...")
                batch = db.batch(); count = 0
                for m, d in updates.items():
                    batch.set(db.collection('students').document(m), {
                        "name": d['name'], "semester": d['semester'], "groups": firestore.ArrayUnion(d['groups'])
                    }, merge=True)
                    count += 1
                    if count >= 400: batch.commit(); batch = db.batch(); count = 0
                if count > 0: batch.commit()
                all_std = db.collection('students').stream()
                d_list = [{"m": d.id, "n": d.to_dict().get('name')} for d in all_std]
                chunks = [d_list[i:i + 4000] for i in range(0, len(d_list), 4000)]
                for idx, chunk in enumerate(chunks):
                    batch.set(db.collection('system').document(f'dir_{idx}'), {'json': json.dumps(chunk)})
                    count += 1
                    if count >= 400: batch.commit(); batch = db.batch(); count = 0
                for idx in range(len(chunks), 55): batch.delete(db.collection('system').document(f'dir_{idx}'))
                batch.commit()
            db.collection('system').document('config').set({'last_scanned_id': new_cursor}, merge=True)
            save_sync_log("CLASS", "SUCCESS", log_buffer, len(discovered))
            return Response("\n".join(log_buffer), mimetype='text/plain', headers=headers)
        except Exception as e:
            save_sync_log("CLASS", "ERROR", log_buffer + [str(e)], 0)
            return Response(f"Error: {str(e)}", status=500, headers=headers)

    # 11. ADMIN SYNC ACTIVITY
    elif path == '/admin_sync_activity':
        if args.get('key') != ADMIN_SECRET_KEY: return jsonify({"error": "Unauthorized"}), 401
        log_buffer = []
        def log(msg): log_buffer.append(f"[{get_malaysia_time().strftime('%H:%M:%S')}] {msg}")
        try:
            log("Starting Activity Sync...")
            cfg = get_sys_config()
            req_session = requests.Session()
            core_api.configure_session(req_session, cfg['user'], cfg['pass'])
            curr, limit, threshold = cfg['act_start_id'], cfg['scan_limit'], cfg['empty_thresh']
            organizers, empty_streak, ids_checked, highest_valid_id = set(), 0, 0, curr
            with ThreadPoolExecutor(max_workers=8) as ex:
                while empty_streak < threshold and ids_checked < limit:
                    futures = {ex.submit(core_api.get_activity_details, i, req_session): i for i in range(curr, curr + cfg['batch_size'])}
                    found_in_batch, batch_max = 0, 0
                    for f in as_completed(futures):
                        if res := f.result():
                            res_id = int(res['id'])
                            if res_id > batch_max: batch_max = res_id
                            if res.get('organizeBy'): organizers.add(res['organizeBy'])
                            found_in_batch += 1
                    if found_in_batch > 0:
                        empty_streak = 0
                        if batch_max > highest_valid_id: highest_valid_id = batch_max
                        log(f"Found {found_in_batch} (Max: {batch_max})")
                    else: empty_streak += cfg['batch_size']
                    curr += cfg['batch_size']; ids_checked += cfg['batch_size']
            new_cursor = highest_valid_id if empty_streak >= threshold else curr
            log(f"Unique Organizers Found: {len(organizers)}")
            cutoff = datetime.now() - timedelta(days=30 * cfg['act_months'])
            for org_id in organizers:
                events = core_api.get_organizer_events(org_id, req_session)
                if not events: continue
                valid_events, latest = [], datetime.min
                for e in events:
                    try:
                        edate = datetime.strptime(e['eventDate'], '%Y-%m-%d')
                        if edate > latest: latest = edate
                        valid_events.append({"id": e['id'], "name": e['name'], "date": e['eventDate'], "start": e['startTime'], "end": e['endTime'], "location": e['location'], "require_checkout": e.get('requireCheckout', False)})
                    except: pass
                if latest < cutoff: continue
                valid_events.sort(key=lambda x: x['date'], reverse=True)
                top10 = valid_events[:10]
                bio = core_api.get_student_biodata(org_id, req_session)
                name = f"Organizer {org_id}"
                if bio: name = bio.get('NAMAPELAJAR') or bio.get('namaPelajar') or bio.get('Name') or name
                db.collection('organizers').document(str(org_id)).set({"id": str(org_id), "name": name, "last_active": latest.isoformat(), "activities": top10})
            all_orgs = db.collection('organizers').stream()
            full_dir = []
            for doc in all_orgs:
                d = doc.to_dict()
                acts = d.get('activities', [])
                act_str = " | ".join([str(e.get('name', '')) for e in acts[:5] if e.get('name')]).upper()
                full_dir.append({"m": str(d['id']), "n": d.get('name', f"Organizer {d['id']}"), "a": act_str})
            c_size = 4000; chunks = [full_dir[i:i + c_size] for i in range(0, len(full_dir), c_size)]; batch = db.batch()
            for idx, chunk in enumerate(chunks): batch.set(db.collection('system').document(f'org_dir_{idx}'), {'json': json.dumps(chunk)})
            for idx in range(len(chunks), 20): batch.delete(db.collection('system').document(f'org_dir_{idx}'))
            batch.commit()
            db.collection('system').document('config').set({'act_last_scanned_id': new_cursor}, merge=True)
            save_sync_log("ACTIVITY", "SUCCESS", log_buffer, len(full_dir))
            return Response("\n".join(log_buffer), mimetype='text/plain', headers=headers)
        except Exception as e:
            save_sync_log("ACTIVITY", "ERROR", log_buffer + [str(e)], 0)
            return Response(f"Error: {str(e)}", status=500, headers=headers)

    # 12. ORGANIZER DETAILS
    elif path == '/organizer_details':
        oid, matric = args.get('oid'), args.get('matric')
        try:
            doc = db.collection('organizers').document(oid).get()
            data = doc.to_dict() if doc.exists else {"id": oid}
            req_session = get_authorized_session()
            live_events = core_api.get_organizer_events(oid, req_session)
            if 'name' not in data:
                bio = core_api.get_student_biodata(oid, req_session)
                if bio: data['name'] = bio.get('NAMAPELAJAR') or bio.get('namaPelajar') or bio.get('Name') or f"Organizer {oid}"
                else: data['name'] = f"Organizer {oid}"
            if live_events:
                proc_evts = []
                for e in live_events:
                    try: proc_evts.append({"id": e['id'], "name": e['name'], "date": e['eventDate'], "start": e['startTime'], "end": e['endTime'], "location": e['location'], "require_checkout": e.get('requireCheckout', False)})
                    except: pass
                proc_evts.sort(key=lambda x: x['date'], reverse=True)
                data['activities'] = proc_evts[:10]
            if not data: return jsonify({"error": "Not Found"}), 404
            if matric:
                job_id = f"{matric}_{oid}"
                job_doc = db.collection('autoscan_jobs').document(job_id).get()
                data['autoscan_active'] = (job_doc.exists and job_doc.to_dict().get('status') == 'pending')
                with ThreadPoolExecutor(max_workers=10) as ex:
                    f_map = {ex.submit(core_api.get_activity_log, evt['id'], matric, req_session): evt for evt in data.get('activities', [])}
                    for f in as_completed(f_map):
                        evt = f_map[f]; log = f.result()
                        st, lid, cco = "Absent", None, False
                        if log:
                            lid = log.get('id'); ci, co = log.get('checkInTime'), log.get('checkOutTime')
                            if evt.get('require_checkout', False):
                                if ci and not co: st = "Checked In"; cco = True
                                elif ci and co: st = "Completed"
                                else: st = "Present"
                            else: st = "Present"
                        evt['status'] = st; evt['log_id'] = lid; evt['can_checkout'] = cco
            return Response(json.dumps(data), headers=headers)
        except Exception as e: return jsonify({"error": str(e)}), 500

    # 13. ADMIN DASHBOARD
    elif path == '/admin_dashboard' and request.method == 'POST':
        data = request.get_json()
        if data.get('key') != ADMIN_SECRET_KEY: return jsonify({"error": "Unauthorized"}), 401
        req_type = data.get('type')
        cfg = get_sys_config()
        if req_type == 'get_data':
            logs = []
            for l in db.collection('system_logs').order_by('timestamp', direction=firestore.Query.DESCENDING).limit(100).stream():
                ld = l.to_dict(); ld['id'] = l.id; logs.append(ld)
            sync_hist = []
            for h in db.collection('sync_history').order_by('timestamp', direction=firestore.Query.DESCENDING).limit(20).stream():
                hd = h.to_dict(); hd['id'] = h.id; sync_hist.append(hd)
            jobs = []
            for j in db.collection('autoscan_jobs').stream():
                jd = j.to_dict(); jd['id'] = j.id; jobs.append(jd)
            banned = [d.id for d in db.collection('banned_ips').stream()]
            ip_meta = {}
            for d in db.collection('ip_metadata').stream(): ip_meta[d.id] = d.to_dict().get('name')
            return Response(json.dumps({"config": cfg, "logs": logs, "jobs": jobs, "banned_ips": banned, "sync_history": sync_hist, "ip_meta": ip_meta}), headers=headers)
        elif req_type == 'save_settings':
            nu, np = data.get('user'), data.get('pass')
            if nu and np:
                if np != "******":
                    if not core_api.validate_login(nu, np): return jsonify({"status": "Error: Invalid Credentials"})
                    db.collection('system').document('auth').set({"username": nu, "password": np})
                else: db.collection('system').document('auth').set({"username": nu}, merge=True)
            update = {}
            if data.get('batch_size'): update.update({"batch_size": int(data['batch_size']), "empty_threshold": int(data['empty_thresh']), "scan_limit": int(data['scan_limit'])})
            if data.get('last_scanned'): update["last_scanned_id"] = int(data['last_scanned'])
            if data.get('act_start_id'): update["act_last_scanned_id"] = int(data['act_start_id'])
            if data.get('act_months'): update["act_time_threshold"] = int(data['act_months'])
            db.collection('system').document('config').set(update, merge=True)
            return jsonify({"status": "Settings Saved"})
        elif req_type == 'delete_all_jobs':
            batch = db.batch(); count = 0
            for j in db.collection('autoscan_jobs').stream():
                batch.delete(j.reference); count += 1
                if count >= 400: batch.commit(); batch = db.batch(); count = 0
            if count > 0: batch.commit()
            return jsonify({"status": f"Deleted {count} jobs"})
        elif req_type == 'delete_single_job':
            db.collection('autoscan_jobs').document(data.get('job_id')).delete()
            return jsonify({"status": "Deleted"})
        elif req_type == 'ban_ip':
            ip, act = data.get('ip'), data.get('action')
            if act == 'ban': db.collection('banned_ips').document(ip).set({"banned_at": get_malaysia_time().isoformat()})
            else: db.collection('banned_ips').document(ip).delete()
            return jsonify({"status": "ok"})
        elif req_type == 'set_ip_name':
            db.collection('ip_metadata').document(data.get('ip')).set({"name": data.get('name')}, merge=True)
            return jsonify({"status": "Saved"})
        
        # --- NEW: Delete Device Logs ---
        elif req_type == 'delete_device_logs':
            target_id = data.get('target_id')
            db.collection('banned_ips').document(target_id).delete()
            logs_ref = db.collection('system_logs')
            batch = db.batch(); cnt = 0
            # Delete by ID
            for doc in logs_ref.where(filter=FieldFilter("device_id", "==", target_id)).stream():
                batch.delete(doc.reference); cnt += 1
                if cnt >= 400: batch.commit(); batch = db.batch(); cnt = 0
            # Delete by IP
            for doc in logs_ref.where(filter=FieldFilter("ip", "==", target_id)).stream():
                batch.delete(doc.reference); cnt += 1
                if cnt >= 400: batch.commit(); batch = db.batch(); cnt = 0
            if cnt > 0: batch.commit()
            return jsonify({"status": "Device logs cleared & unbanned"})

    return jsonify({"error": "Endpoint Not Found"}), 404

if __name__ == '__main__':
    app.run()