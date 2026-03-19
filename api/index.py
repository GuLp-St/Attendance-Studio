# --- START OF FILE index.py ---

import sys
import os
import time

# Fix Path for Vercel
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from flask import Flask, request, jsonify, Response
import firebase_admin 
from firebase_admin import credentials, firestore
from google.cloud.firestore import FieldFilter
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
import json
import requests
import traceback
import core_api
import base64

# ==========================================
#  INITIALIZATION
# ==========================================
app = Flask(__name__)

if not firebase_admin._apps:
    cred_content = os.environ.get('FIREBASE_CREDENTIALS')
    if cred_content:
        cred_json = json.loads(cred_content)
        cred = credentials.Certificate(cred_json)
        firebase_admin.initialize_app(cred)
    else:
        print("WARNING: FIREBASE_CREDENTIALS env var not found.")

db = firestore.client()

# --- CONFIGURATION ---
ADMIN_SECRET_KEY = "nexus"
FALLBACK_USER = "85699"
FALLBACK_PASS = "Unimas!010914011427"
FALLBACK_START_ID = 100000 
FALLBACK_LIMIT = 5000
FALLBACK_STUDENT_BATCH = 50
FALLBACK_ACT_START = 107000
FALLBACK_ACT_LIMIT = 5000
FALLBACK_ACT_MONTHS = 6 

# ==========================================
#  HELPERS
# ==========================================

def get_malaysia_time():
    return datetime.now(timezone.utc) + timedelta(hours=8)

def get_sys_config():
    try:
        conf_doc = db.collection('system').document('config').get()
        conf = conf_doc.to_dict() if conf_doc.exists else {}
    except: conf = {}
    
    return {
        "start_id": int(conf.get("last_scanned_id", 100000)),
        "scan_limit": int(conf.get("scan_limit", 5000)),
        "student_sync_batch": int(conf.get("student_sync_batch", 50)),
        "current_semester": conf.get("current_semester", ""),
        "act_start_id": int(conf.get("act_last_scanned_id", 107000)),
        "act_scan_limit": int(conf.get("act_scan_limit", 5000)),
        "act_months": int(conf.get("act_time_threshold", 6)),
        "priority_courses": conf.get("priority_courses", []),
        "system_matric": conf.get("system_matric", ""),
        "system_pwd": conf.get("system_pwd", ""),
        "force_student_sync": conf.get("force_student_sync", False)
    }
    
def get_authorized_session():
    cfg = get_sys_config()
    sys_m = cfg.get("system_matric")
    pwd = None
    
    if sys_m:
        doc = db.collection('students').document(sys_m).get()
        if doc.exists: pwd = doc.to_dict().get('password')
        
    if not pwd or pwd == "Unknown":
        docs = db.collection('valid_directory').where(filter=FieldFilter("timetable_ready", "==", True)).limit(5).stream()
        for d in docs:
            sys_m = d.id
            pwd = d.to_dict().get('password')
            if sys_m and pwd: break
            
        if not sys_m or not pwd:
            docs = db.collection('students').where(filter=FieldFilter("password", ">", "")).limit(20).stream()
            for d in docs:
                p = d.to_dict().get('password')
                if p and p != "Unknown":
                    sys_m = d.id
                    pwd = p
                    break
                
    if not sys_m or not pwd:
        raise Exception("CRITICAL: No valid system credentials found in database.")
        
    s = requests.Session()
    core_api.configure_session(s, sys_m, pwd)
    return s

def get_client_ip():
    if request.headers.getlist("X-Forwarded-For"):
        return request.headers.getlist("X-Forwarded-For")[0]
    return request.remote_addr

def log_action(ip, matric, action, details=""):
    try:
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
            "timestamp": get_malaysia_time().isoformat(), "type": type, "status": status, "log_text": "\n".join(messages), "items_found": items_count
        })
        # FIX: Keep exactly 5 logs of EACH type, instead of 10 total
        docs = list(db.collection('sync_history').where(filter=FieldFilter("type", "==", type)).order_by('timestamp', direction=firestore.Query.DESCENDING).stream())
        if len(docs) > 5:
            batch = db.batch()
            for doc in docs[5:]: batch.delete(doc.reference)
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
#  MAIN ROUTE HANDLER
# ==========================================

@app.route('/', defaults={'path': ''}, methods=['GET', 'POST', 'DELETE', 'OPTIONS'])
@app.route('/<path:path>', methods=['GET', 'POST', 'DELETE', 'OPTIONS'])
def api_handler(path):
    headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, X-Device-ID',
        'Content-Type': 'application/json'
    }
    
    if request.method == 'OPTIONS': return Response("", status=204, headers=headers)

    actual_path = request.path
    if actual_path.startswith("/api"): path = actual_path[4:]
    else: path = actual_path

    if not path.startswith("/"): path = "/" + path
    args = request.args
    client_ip = get_client_ip()

    if db.collection('banned_ips').document(client_ip).get().exists:
        return jsonify({"error": "Access Denied"}), 403

    # ==========================================
    #  STANDARD ENDPOINTS
    # ==========================================

    if path == '/directory':
        dir_type = args.get('type', 'student')
        prefix = 'dir_' if dir_type == 'student' else 'org_dir_'
        try:
            full_dir = []
            for i in range(55):
                doc = db.collection('system').document(f'{prefix}{i}').get()
                if not doc.exists: break
                full_dir.extend(json.loads(doc.to_dict().get('json', '[]')))
            return Response(json.dumps(full_dir), headers=headers)
        except: return jsonify([])

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

    elif path == '/dashboard':
        matric = args.get('matric')
        log_action(client_ip, matric, "VIEW_DASHBOARD")
        try:
            doc = db.collection('students').document(matric).get()
            if not doc.exists: return jsonify({}), 404
            
            req_session = get_authorized_session()
            user_data = doc.to_dict()
            group_ids = user_data.get('groups', [])
            following_ids = user_data.get('following', [])
            
            active_autoscan = set()
            try:
                for j in db.collection('autoscan_jobs').where(filter=FieldFilter("matric", "==", matric)).stream():
                    if j.to_dict().get('status') == 'pending': active_autoscan.add(j.to_dict().get('gid'))
            except: pass

            active_auto_register = []
            try:
                for j in db.collection('auto_register_jobs').where(filter=FieldFilter("matric", "==", matric)).stream():
                    active_auto_register.append(str(j.to_dict().get('gid')))
            except: pass

            courses = {}
            raw_timetable = []

            def fetch_group(gid):
                info = core_api.get_group_info(gid, req_session)
                timetable_slots = core_api.get_timetable(gid, req_session)
                return gid, info, timetable_slots

            with ThreadPoolExecutor(max_workers=8) as ex:
                futures = {ex.submit(fetch_group, gid): gid for gid in group_ids}
                for f in as_completed(futures):
                    gid, info, slots = f.result()
                    if info: 
                        info['autoscan_active'] = (gid in active_autoscan)
                        info['gid'] = gid
                        info['sessions'] = None
                        courses[gid] = info
                        if slots and isinstance(slots, list):
                            for s in slots:
                                if isinstance(s, dict):
                                    raw_timetable.append({"day": s.get('KETERANGAN_HARI'), "start": s.get('MASA_MULA'), "end": s.get('MASA_TAMAT'), "loc": s.get('LOKASI'), "code": info['code'], "name": info['name'], "group": info['group'], "gid": gid})

            
            final_courses = list(courses.values())
            final_courses.sort(key=lambda x: x['code'])
            
            return Response(json.dumps({
                "name": user_data['name'], 
                "courses": final_courses, 
                "timetable": consolidate_timetable(raw_timetable), 
                "following": following_ids,
                "auto_register": active_auto_register
            }), headers=headers)
        except Exception as e:
            traceback.print_exc()
            return jsonify({"error": str(e)}), 500

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
            h_map = {h['jadualKehadiran']['id']: h for h in hl if 'jadualKehadiran' in h and 'id' in h['jadualKehadiran']}
            
            c_sess = []
            for s in ml:
                st, lid = "Absent", None
                if s['id'] in h_map:
                    ld = h_map[s['id']]
                    sc = ld.get('status')
                    st = "Present (Scan)" if sc == 'P' else "Present (Manual)" if sc == 'M' else "Exempted" if sc == 'L' else sc
                    lid = ld.get('id')
                
                # FIXED DATE PARSING
                try:
                    date_str = datetime.fromtimestamp(int(s['eventDate'])/1000).strftime('%Y-%m-%d')
                except:
                    date_str = str(s['eventDate'])

                c_sess.append({
                    "id": s['id'], "date": date_str, "start": s['startTime'], "end": s.get('endTime', ''),
                    "location": s.get('venue') or s.get('location') or "Unknown Venue",
                    "name": s.get('topic') or s.get('description') or "", 
                    "status": st, "log_id": lid
                })
            return Response(json.dumps(c_sess), headers=headers)
        except Exception as e: return jsonify({"error": str(e)}), 500

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
            elif d['type'] == 'start_auto_register':
                jid = f"{d['matric']}_{d['gid']}"
                db.collection('auto_register_jobs').document(jid).set({
                    "matric": d['matric'], "gid": str(d['gid']),
                    "createdAt": get_malaysia_time().isoformat(), "status": "pending"
                })
                msg = "Auto Register Activated."
            elif d['type'] == 'stop_auto_register':
                jid = f"{d['matric']}_{d['gid']}"
                db.collection('auto_register_jobs').document(jid).delete()
                msg = "Auto Register Deactivated."
        except Exception as e: msg = str(e)
        return jsonify({"msg": msg})

    elif path == '/cron':
        try:
            start_time = time.time()
            req_session = get_authorized_session()
            now_my = get_malaysia_time()
            today_str = now_my.strftime('%Y-%m-%d')
            
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
                f_map = {}
                for j in jobs:
                    if time.time() - start_time > 45: break
                    f_map[ex.submit(process_autoscan_job, j)] = j
                for f in as_completed(f_map):
                    try: results.append(f.result())
                    except Exception as e: results.append(f"Error: {str(e)}")

            # === AUTO REGISTER JOBS ===
            ar_jobs = list(db.collection('auto_register_jobs').stream())

            def process_auto_register_job(job):
                d = job.to_dict()
                matric, gid = d['matric'], d['gid']
                job_time = datetime.fromisoformat(d['createdAt'])
                if (now_my - job_time).total_seconds() > 86400 * 7:
                    create_notification(matric, 'class', f'GID:{gid}', 'FAILED', 'Auto Register Expired (7d)', 'auto')
                    job.reference.delete()
                    return "AR Expired"
                try:
                    course_doc = db.collection('courses').document(str(gid)).get()
                    code, group = ('Unknown', '') if not course_doc.exists else (course_doc.to_dict().get('code', 'Unknown'), course_doc.to_dict().get('group', ''))
                    stud_doc = db.collection('students').document(matric).get()
                    pwd = ''
                    if stud_doc.exists:
                        pwd = stud_doc.to_dict().get('password', '')
                    if not pwd:
                        return "AR Pending (No Password)"
                        
                    sem = get_sys_config().get('current_semester', '2025/2026-2')
                    status_c, resp_c = core_api.register_course(matric, pwd, code, str(gid), sem, group, "P")
                    is_success = status_c == 200 and ("berjaya" in resp_c.lower() or "success" in resp_c.lower() or '"error":false' in resp_c.replace(" ", "").lower())
                    
                    if not is_success and ("error\":true" in resp_c.replace(" ", "").lower() or "taraf" in resp_c.lower() or "syarat" in resp_c.lower()):
                        status_c, resp_c = core_api.register_course(matric, pwd, code, str(gid), sem, group, "T")
                        is_success = status_c == 200 and ("berjaya" in resp_c.lower() or "success" in resp_c.lower() or '"error":false' in resp_c.replace(" ", "").lower())

                    status = 'SUCCESS' if is_success else 'FAILED'
                    create_notification(matric, 'class', f'{code} {group}', status, f'Auto Register: {str(resp_c)[:80]}', 'auto')
                    
                    if is_success:
                        db.collection('students').document(matric).set({"groups": firestore.ArrayUnion([str(gid)])}, merge=True)
                        db.collection('courses').document(str(gid)).set({'last_student_sync': 0}, merge=True)
                        job.reference.delete()
                        
                    return f"AR {status}"
                except Exception as e:
                    return f"AR Error: {str(e)}"

            with ThreadPoolExecutor(max_workers=5) as ex:
                ar_map = {}
                for j in ar_jobs:
                    if time.time() - start_time > 45: break
                    ar_map[ex.submit(process_auto_register_job, j)] = j
                for f in as_completed(ar_map):
                    try: results.append(f.result())
                    except Exception as e: results.append(f"AR Error: {str(e)}")

            return Response(f"Jobs: {len(jobs)} | AR Jobs: {len(ar_jobs)} | Processed: {len(results)}", headers=headers)
        except Exception as e: return jsonify({"error": str(e)}), 500

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

    elif path == '/profile':
        try:
            req_session = get_authorized_session()
            data = core_api.get_student_biodata(args.get('matric'), req_session)
            if data: return Response(json.dumps(data), headers=headers)
            else: return jsonify({"error": "No Data"}), 404
        except Exception as e: return jsonify({"error": str(e)}), 500

    elif path == '/cron_verify':
        try:
            cfg_doc = db.collection('system').document('config').get()
            cfg = cfg_doc.to_dict() if cfg_doc.exists else {}
            curr_id = cfg.get("verify_start_id", "")
            
            students_ref = db.collection('students')
            if curr_id:
                docs = students_ref.order_by('__name__').start_after([curr_id]).limit(100).stream()
            else:
                docs = students_ref.order_by('__name__').limit(100).stream()
            
            docs = list(docs)
            if not docs and curr_id:
                db.collection('system').document('config').set({"verify_start_id": ""}, merge=True)
                return Response("Reset verify pointer.", headers=headers)
                
            results = []
            last_id = curr_id
            start_time = time.time()
            active_sem = cfg.get('current_semester', '2025/2026-2')
            
            for d in docs:
                if time.time() - start_time > 45: break
                last_id = d.id
                m = d.id
                data = d.to_dict()
                pwd = data.get('password')
                if not pwd or pwd == 'Unknown': continue
                
                bio = core_api.spc_fetch(f"api/v1/biodata/personal-v2/{m}", m, pwd)
                if not bio:
                    db.collection('students').document(m).set({"password": "Unknown"}, merge=True)
                    results.append(f"{m}: Invalid")
                    continue
                
                prog = bio.get('namaProgram', 'Unknown')
                transcript = core_api.spc_fetch(f"api/v1/result/transcript/{m}", m, pwd)
                cgpa = 0.0
                if transcript and 'cgpa' in transcript:
                    cgpa = float(transcript['cgpa'])
                    
                # Timetable Ready Validation
                tt_check = core_api.spc_fetch(f"api/v1/course/student/{m}?kodSesiSem={active_sem}", m, pwd)
                is_timetableable = True if tt_check is not None else False
                
                db.collection('students').document(m).set({"cgpa": cgpa, "namaProgram": prog, "password": pwd}, merge=True)
                name = bio.get('nama', data.get('name', 'Unknown'))
                
                db.collection('valid_directory').document(m).set({
                    "matric": m, "name": name, "cgpa": cgpa, "programme": prog, "password": pwd, 
                    "timetable_ready": is_timetableable,
                    "last_verified": get_malaysia_time().isoformat()
                })
                results.append(f"{m}: Valid - CGPA {cgpa} - TT: {is_timetableable}")
            
            if last_id: db.collection('system').document('config').set({"verify_start_id": last_id}, merge=True)
            return Response(json.dumps({"processed": len(results), "details": results}), headers=headers)
        except Exception as e: return jsonify({"error": str(e)}), 500

    elif path == '/directory_v2' and request.method == 'POST':
        page = int(args.get('page', 1))
        limit = min(int(args.get('limit', 10)), 50)
        sort_by = args.get('sort_by', 'name')
        order = args.get('order', 'asc')
        search_q = args.get('q', '').strip().upper()
        req_body = request.get_json(silent=True) or {}
        
        try:
            docs = db.collection('valid_directory').stream()
            all_valid = [d.to_dict() for d in docs]
            
            if search_q:
                all_valid = [x for x in all_valid if search_q in x.get('name', '').upper() or search_q in x.get('matric','')]
            
            prog_filter = req_body.get('programmes', [])
            if prog_filter and len(prog_filter) > 0:
                all_valid = [x for x in all_valid if x.get('programme') in prog_filter]
                
            if sort_by == 'cgpa':
                prog_groups = {}
                for v in all_valid:
                    p = v.get('programme', 'Unknown')
                    if p not in prog_groups: prog_groups[p] = []
                    prog_groups[p].append(v)
                
                for p, group in prog_groups.items():
                    group.sort(key=lambda x: x.get('cgpa', 0), reverse=True)
                    total = len(group)
                    for idx, v in enumerate(group):
                        rank = idx + 1
                        pct = (rank / total) * 100 if total > 0 else 0
                        v['rank'] = rank
                        v['top_pct'] = round(pct)
            else:
                for v in all_valid:
                    v['rank'] = 0
                    v['top_pct'] = 0
            
            rev = (order == 'desc')
            if sort_by == 'cgpa':
                all_valid.sort(key=lambda x: x.get('cgpa', 0), reverse=rev)
            elif sort_by == 'matric':
                all_valid.sort(key=lambda x: x.get('matric', ''), reverse=rev)
            else:
                all_valid.sort(key=lambda x: x.get('name', ''), reverse=rev)
                
            total_matches = len(all_valid)
            start_idx = (page - 1) * limit
            end_idx = start_idx + limit
            paged = all_valid[start_idx:end_idx]
            
            prog_counts = {}
            for x in all_valid:
                p = x.get('programme', 'Unknown')
                prog_counts[p] = prog_counts.get(p, 0) + 1
                
            res_data = {"total": total_matches, "results": paged, "programmes": prog_counts}
            
            req_matric = args.get('matric')
            if req_matric and sort_by == 'cgpa':
                # Force visibility of own row at bottom if out of scope
                user_found = next((x for x in paged if x.get('matric') == req_matric), None)
                if not user_found:
                    owner_row = next((x for x in all_valid if x.get('matric') == req_matric), None)
                    if owner_row:
                        owner_row['is_appended_owner'] = True
                        paged.append(owner_row)
            
            return Response(json.dumps(res_data), headers=headers)
        except Exception as e: return jsonify({"error": str(e)}), 500

    elif path == '/student_details_proxy':
        m, pwd = args.get('matric'), args.get('password')
        if not pwd:
            doc = db.collection('students').document(m).get()
            pwd = doc.to_dict().get('password') if doc.exists else None
        
        if not pwd or pwd == 'Unknown':
            return jsonify({"error": "No valid password"}), 401
            
        try:
            results = {}
            with ThreadPoolExecutor(max_workers=7) as ex:
                futures = {
                    'biodata': ex.submit(core_api.spc_fetch, f"api/v1/biodata/personal-v2/{m}", m, pwd),
                    'attendance': ex.submit(core_api.spc_fetch, f"api/v1/activity/list-activity-attendance?matricNo={m}", m, pwd),
                    'activities': ex.submit(core_api.spc_fetch, f"api/v1/activity/list?matricNo={m}", m, pwd),
                    'sponsor': ex.submit(core_api.spc_fetch, f"api/finance/list-sponsor/{m}", m, pwd),
                    'debt': ex.submit(core_api.spc_fetch, f"api/finance/list-debt/{m}", m, pwd),
                    'transcript': ex.submit(core_api.spc_fetch, f"api/v1/result/transcript/{m}", m, pwd),
                    'carry_mark': ex.submit(core_api.spc_fetch, f"api/v1/course/carry-mark/{m}?kodSesiSem={get_sys_config().get('current_semester', '2025/2026-2')}", m, pwd)
                }
                for key, f in futures.items():
                    try: results[key] = f.result()
                    except: results[key] = None
                    
            return Response(json.dumps(results), headers=headers)
        except Exception as e: return jsonify({"error": str(e)}), 500

    # ==========================================
    #  TOOLS & MASTER API
    # ==========================================

    elif path == '/tools/details':
        query, q_type = args.get('q'), args.get('t') # t = 's' (student) or 'c' (course)
        try:
            res = []
            if q_type == 'c':
                docs = db.collection('courses').where(filter=FieldFilter("code", "==", query)).stream()
                for d in docs:
                    data = d.to_dict()
                    res.append({"id": d.id, "group": data.get('group'), "name": data.get('name'), "code": data.get('code'), "students": len(data.get('enrolled_students', []))})
            elif q_type == 's':
                student = db.collection('students').document(query).get()
                if student.exists:
                    s_data = student.to_dict()
                    for gid in s_data.get('groups', []):
                        cdoc = db.collection('courses').document(str(gid)).get()
                        if cdoc.exists:
                            c_data = cdoc.to_dict()
                            res.append({"id": gid, "group": c_data.get('group'), "name": c_data.get('name'), "code": c_data.get('code'), "students": len(c_data.get('enrolled_students', []))})
            return Response(json.dumps(res), headers=headers)
        except Exception as e: return jsonify({"error": str(e)}), 500

    elif path == '/tools/timetable':
        gid = args.get('gid')
        try:
            req_s = get_authorized_session()
            slots = core_api.get_timetable(gid, req_s)
            if not slots or not isinstance(slots, list):
                return Response(json.dumps({"timetable": "No Timetable"}), headers=headers)
            # Build a compact textual timetable summary
            day_map = {}
            for s in slots:
                if not isinstance(s, dict): continue
                day = s.get('KETERANGAN_HARI', '')
                start = s.get('MASA_MULA', '')
                end = s.get('MASA_TAMAT', '')
                loc = s.get('LOKASI', '')
                key = (day, start, end, loc)
                day_map[key] = True
            parts = [f"{d} {st}-{en} | {lc}" for (d, st, en, lc) in sorted(day_map.keys())]
            summary = " | ".join(parts) if parts else "No Timetable"
            return Response(json.dumps({"timetable": summary}), headers=headers)
        except Exception as e: return jsonify({"error": str(e)}), 500

    elif path == '/tools/session_master':

        sid = args.get('sid')
        try:
            req_s = get_authorized_session()
            logs = core_api.get_all_session_logs(sid, req_s)
            return Response(json.dumps(logs), headers=headers)
        except Exception as e: return jsonify({"error": str(e)}), 500

    elif path == '/tools/roster':
        gid = args.get('gid')
        try:
            req_s = get_authorized_session()
            students = core_api.get_students(gid, req_s)
            roster = []
            
            # --- SUPER FAST FIREBASE BATCH READ ---
            matrics = [s.get("NOMATRIK") for s in students if s.get("NOMATRIK")]
            refs = [db.collection('students').document(m) for m in matrics]
            docs = db.get_all(refs) if refs else []
            pwd_map = {d.id: d.to_dict().get('password', '') for d in docs if d.exists}
            
            for s in students:
                m = s.get("NOMATRIK")
                pwd = pwd_map.get(m, '')
                # If password exists, mark as valid automatically
                roster.append({"matric": m, "name": s.get("NAMAPELAJAR"), "password": pwd, "valid": bool(pwd)})
            
            return Response(json.dumps(roster), headers=headers)
        except Exception as e: return jsonify({"error": str(e)}), 500

    elif path == '/tools/validate' and request.method == 'POST':
        data = request.get_json()
        m, pwd, auto_fetch, initiator = data.get('matric'), data.get('password'), data.get('auto'), data.get('initiator', 'unknown')
        req_s = get_authorized_session()
        
        if auto_fetch:
            try:
                bio = core_api.get_student_biodata(m, req_s)
                if bio:
                    ic = bio.get('noKadPengenalan') or bio.get('noIc')
                    if ic: pwd = f"Unimas!{ic}"
            except: pass
            
        if not pwd: return jsonify({"valid": False})
        
        is_valid = core_api.validate_login(m, pwd)
        if is_valid:
            db.collection('students').document(m).set({"password": pwd}, merge=True)
            log_action(client_ip, initiator, "TOOL_VALIDATE_PWD", f"Target:{m}")
            return jsonify({"valid": True, "password": pwd})
        else:
            if auto_fetch:
                # Save as Unknown so it doesn't re-test next time
                db.collection('students').document(m).set({"password": "Unknown"}, merge=True)
            return jsonify({"valid": False})

    elif path == '/tools/action' and request.method == 'POST':
        d = request.get_json()
        action, m, pwd, code, cid, group_name, initiator = d.get('action'), d.get('matric'), d.get('password'), d.get('code'), d.get('cid'), d.get('group_name', 'G01'), d.get('initiator', 'unknown')
        sem = get_sys_config().get('current_semester', '2025/2026-2')
        
        log_action(client_ip, initiator, f"TOOL_MASTER_{action}", f"Target:{m} Course:{code}({cid})")
        
        try:
            if not pwd:
                doc = db.collection('students').document(m).get()
                pwd = doc.to_dict().get('password') if doc.exists else None
            
            if not pwd or pwd == 'Unknown':
                return jsonify({"needs_password": True})

            is_success = False

            if action == "DROP":
                status, resp = core_api.drop_course(m, pwd, code, cid, sem)
                is_success = status == 200 and ("berjaya" in resp.lower() or "success" in resp.lower() or '"error":false' in resp.replace(" ", "").lower() or 'gugur' in resp.lower())
                
                if is_success:
                    # FIX: Remove BOTH int and str to clean up old DB state to use strictly string moving onward
                    db.collection('students').document(m).set({"groups": firestore.ArrayRemove([int(cid), str(cid)]), "password": pwd}, merge=True)
                    db.collection('courses').document(str(cid)).set({'last_student_sync': 0}, merge=True)
            else:
                status, resp = core_api.register_course(m, pwd, code, cid, sem, group_name, "P")
                is_success = status == 200 and ("berjaya" in resp.lower() or "success" in resp.lower() or '"error":false' in resp.replace(" ", "").lower())
                
                if not is_success and ("error\":true" in resp.replace(" ", "").lower() or "taraf" in resp.lower() or "syarat" in resp.lower()):
                    status, resp = core_api.register_course(m, pwd, code, cid, sem, group_name, "T")
                    is_success = status == 200 and ("berjaya" in resp.lower() or "success" in resp.lower() or '"error":false' in resp.replace(" ", "").lower())
                
                if is_success:
                    # FIX: Enforce str(cid)
                    db.collection('students').document(m).set({"groups": firestore.ArrayUnion([str(cid)]), "password": pwd}, merge=True)
                    db.collection('courses').document(str(cid)).set({'last_student_sync': 0}, merge=True)
            
            return jsonify({"status": status, "response": resp, "success": is_success})
        except Exception as e: return jsonify({"error": str(e)}), 500
        
    elif path == '/tools/timetable':
        gid = args.get('gid')
        try:
            req_s = get_authorized_session()
            slots = core_api.get_timetable(gid, req_s)
            
            # Format slots for the consolidate function
            fmt_slots = []
            for s in (slots or []):
                fmt_slots.append({"day": s.get('KETERANGAN_HARI'), "start": s.get('MASA_MULA'), "end": s.get('MASA_TAMAT'), "loc": s.get('LOKASI'), "code": "", "name": ""})
            
            merged = consolidate_timetable(fmt_slots)
            tt_str = " | ".join([f"{s['day']} {s['start']}-{s['end']}" for s in merged]) if merged else "No Timetable"
            return Response(json.dumps({"timetable": tt_str}), headers=headers)
        except: return Response(json.dumps({"timetable": "No Timetable"}), headers=headers)

    # ==========================================
    #  ADMIN SYNC CRONS (OPTIMIZED)
    # ==========================================
    
    elif path == '/admin_sync_class':
        if args.get('key') != ADMIN_SECRET_KEY: return jsonify({"error": "Unauthorized"}), 401
        log_buffer = []
        def log(msg): log_buffer.append(f"[{get_malaysia_time().strftime('%H:%M:%S')}] {msg}")
        try:
            log("Starting Class Discovery...")
            cfg = get_sys_config()
            req_session = get_authorized_session() # <--- FIXED
            active_sem = core_api.get_active_semester(req_session)
            stored_sem = cfg.get('current_semester')
            
            if active_sem and active_sem != stored_sem:
                log(f"New Semester Detected: {active_sem}. Clearing DB...")
                delete_collection('students', 400)
                delete_collection('courses', 400)
                batch = db.batch()
                for i in range(55): batch.delete(db.collection('system').document(f'dir_{i}'))
                batch.commit()
                db.collection('system').document('config').set({'current_semester': active_sem}, merge=True)
                
            curr = cfg['start_id']
            limit = cfg['scan_limit']
            highest_valid_id = curr
            discovered = []
            
            log(f"Scanning from {curr} to {curr + limit}...")
            start_time = time.time()
            for i in range(curr, curr + limit, 100):
                if time.time() - start_time > 45: 
                    log("Timeout reached. Stopping scan early.")
                    break
                end = min(i + 100, curr + limit)
                with ThreadPoolExecutor(max_workers=10) as ex:
                    futures = {ex.submit(core_api.get_group_info, j, req_session): j for j in range(i, end)}
                    for f in as_completed(futures):
                        if res := f.result():
                            res_id = int(res['id'])
                            if not active_sem or res.get('semester') == active_sem:
                                discovered.append(res)
                                if res_id > highest_valid_id: highest_valid_id = res_id
                                
            if discovered:
                batch = db.batch(); count = 0
                for d in discovered:
                    batch.set(db.collection('courses').document(str(d['id'])), {
                        "code": d['code'], "name": d['name'], "semester": d['semester'], "group": d['group']
                    }, merge=True)
                    count += 1
                    if count >= 400: batch.commit(); batch = db.batch(); count = 0
                if count > 0: batch.commit()

            # REBUILD UNIFIED DIRECTORY
            log("Rebuilding Unified Search Directory (Students + Courses)...")
            d_list = []
            for d in db.collection('students').stream():
                d_list.append({"m": d.id, "n": d.to_dict().get('name'), "t": "s"})
                
            seen_c = set()
            for c in db.collection('courses').stream():
                cd = c.to_dict()
                code = cd.get('code')
                if code and code not in seen_c:
                    seen_c.add(code)
                    d_list.append({"m": code, "n": cd.get('name'), "t": "c"})
                    
            chunks = [d_list[i:i + 4000] for i in range(0, len(d_list), 4000)]
            dir_batch = db.batch()
            for idx, chunk in enumerate(chunks): dir_batch.set(db.collection('system').document(f'dir_{idx}'), {'json': json.dumps(chunk)})
            for idx in range(len(chunks), 55): dir_batch.delete(db.collection('system').document(f'dir_{idx}'))
            dir_batch.commit()

            db.collection('system').document('config').set({'last_scanned_id': highest_valid_id}, merge=True)
            save_sync_log("CLASS", "SUCCESS", log_buffer, len(discovered))
            return Response("\n".join(log_buffer), mimetype='text/plain', headers=headers)
        except Exception as e:
            save_sync_log("CLASS", "ERROR", log_buffer + [str(e)], 0)
            return Response(f"Error: {str(e)}", status=500, headers=headers)

    elif path == '/admin_sync_student':
        if args.get('key') != ADMIN_SECRET_KEY: return jsonify({"error": "Unauthorized"}), 401
        log_buffer = []
        def log(msg): log_buffer.append(f"[{get_malaysia_time().strftime('%H:%M:%S')}] {msg}")
        try:
            log("Starting Student Sync...")
            cfg = get_sys_config()
            req_session = requests.Session()
            core_api.configure_session(req_session, cfg['system_matric'] or '85699', 'dummy') 
            req_session = get_authorized_session() 
            
            active_sem = core_api.get_active_semester(req_session)
            batch_limit = cfg.get('student_sync_batch', 50)
            
            # --- THE NEW FORCE SYNC LOGIC ---
            force_sync = cfg.get('force_student_sync', False)
            if force_sync: log("FORCE HEAL ENABLED: Ignoring database memory.")
            
            target_courses = []
            seen_gids = set()
            
            # --- PRIORITY COURSES FETCH ---
            priority_codes = cfg.get('priority_courses', [])
            if priority_codes:
                log(f"Processing {len(priority_codes)} Priority Courses...")
                for code in priority_codes:
                    docs = db.collection('courses').where(filter=FieldFilter("code", "==", code)).where(filter=FieldFilter("semester", "==", active_sem)).stream()
                    for c in docs:
                        d = c.to_dict(); d['id'] = c.id
                        target_courses.append(d)
                        seen_gids.add(c.id)
            
            # --- NORMAL FETCH TO FILL QUOTA ---
            rem_limit = batch_limit - len(target_courses)
            if rem_limit > 0:
                courses_query = db.collection('courses').order_by('last_student_sync').limit(batch_limit + len(target_courses)).stream()
                skip_batch = db.batch(); skip_count = 0
                
                for c in courses_query:
                    if rem_limit <= 0: break
                    if c.id in seen_gids: continue
                    d = c.to_dict(); d['id'] = c.id
                    if d.get('semester') == active_sem:
                        target_courses.append(d)
                        seen_gids.add(c.id)
                        rem_limit -= 1
                    else:
                        skip_batch.set(c.reference, {"last_student_sync": 9999999999}, merge=True)
                        skip_count += 1
                if skip_count > 0: skip_batch.commit()
            
            if not target_courses: return Response("No courses to sync", headers=headers)
            log(f"Selected {len(target_courses)} total courses to sync.")
            
            course_students = {}
            student_names = {}
            start_time = time.time()
            with ThreadPoolExecutor(max_workers=8) as ex:
                futures = {}
                for c in target_courses:
                    if time.time() - start_time > 40: break
                    futures[ex.submit(core_api.get_students, c['id'], req_session)] = c['id']
                    
                for f in as_completed(futures):
                    gid = futures[f]
                    matrics = []
                    for s in (f.result() or []):
                        m, n = s.get("NOMATRIK"), s.get("NAMAPELAJAR")
                        if m:
                            matrics.append(m)
                            if n and n != "Unknown": student_names[m] = n
                    course_students[gid] = matrics
                    
            updates_by_student = {}
            for m, name in student_names.items(): updates_by_student[m] = {"add": [], "remove": [], "name": name}
            
            now_ts = int(datetime.now().timestamp())
            course_batch = db.batch(); cb_count = 0
            
            for c in target_courses:
                gid = c['id']
                current_matrics = set(course_students.get(gid, []))
                
                # --- APPLY THE CHECKBOX LOGIC HERE ---
                if force_sync:
                    previous_matrics = set() 
                else:
                    previous_matrics = set(c.get('enrolled_students', []))
                
                for m in (current_matrics - previous_matrics):
                    if m not in updates_by_student: updates_by_student[m] = {"add": [], "remove": []}
                    updates_by_student[m]["add"].append(str(gid)) # Safe String Cast
                    
                for m in (previous_matrics - current_matrics):
                    if m not in updates_by_student: updates_by_student[m] = {"add": [], "remove": []}
                    updates_by_student[m]["remove"].append(str(gid)) # Safe String Cast
                    
                course_batch.set(db.collection('courses').document(gid), {"enrolled_students": list(current_matrics), "last_student_sync": now_ts}, merge=True)
                cb_count += 1
                if cb_count >= 400: course_batch.commit(); course_batch = db.batch(); cb_count = 0
            if cb_count > 0: course_batch.commit()
            
            add_batch = db.batch(); sb_count = 0
            for m, diff in updates_by_student.items():
                if diff["add"]: 
                    add_batch.set(db.collection('students').document(m), {"semester": active_sem, "name": diff.get("name", ""), "groups": firestore.ArrayUnion(diff["add"])}, merge=True)
                    sb_count += 1
                if sb_count >= 400: add_batch.commit(); add_batch = db.batch(); sb_count = 0
            if sb_count > 0: add_batch.commit()
            
            rem_batch = db.batch(); rb_count = 0
            for m, diff in updates_by_student.items():
                if diff["remove"]:
                    rem_batch.set(db.collection('students').document(m), {"groups": firestore.ArrayRemove(diff["remove"])}, merge=True)
                    rb_count += 1
                if rb_count >= 400: rem_batch.commit(); rem_batch = db.batch(); rb_count = 0
            if rb_count > 0: rem_batch.commit()
            
            # --- VALID_DIRECTORY PRUNING ---
            log("Identifying departed students for directory cleanup...")
            active_m = set(student_names.keys())
            vd_docs = db.collection('valid_directory').stream()
            vd_batch = db.batch(); vdb_count = 0; pruned = 0
            for vdoc in vd_docs:
                vm = vdoc.id
                if vm not in active_m:
                    # Check if actually in students
                    if not db.collection('students').document(vm).get().exists:
                        vd_batch.delete(vdoc.reference)
                        vdb_count += 1; pruned += 1
                if vdb_count >= 400: vd_batch.commit(); vd_batch = db.batch(); vdb_count = 0
            if vdb_count > 0: vd_batch.commit()
            log(f"Pruned {pruned} departed accounts from Valid Directory.")

            save_sync_log("STUDENT", "SUCCESS", log_buffer, len(target_courses))
            return Response("\n".join(log_buffer), mimetype='text/plain', headers=headers)
        except Exception as e:
            traceback.print_exc()
            save_sync_log("STUDENT", "ERROR", log_buffer + [str(e)], 0)
            return Response(f"Error: {str(e)}", status=500, headers=headers)

    elif path == '/admin_sync_activity':
        if args.get('key') != ADMIN_SECRET_KEY: return jsonify({"error": "Unauthorized"}), 401
        log_buffer = []
        def log(msg): log_buffer.append(f"[{get_malaysia_time().strftime('%H:%M:%S')}] {msg}")
        try:
            log("Starting Activity Sync...")
            cfg = get_sys_config()
            req_session = get_authorized_session() # <--- FIXED
            
            curr = cfg['act_start_id']
            limit = cfg.get('act_scan_limit', 5000)
            highest_valid_id = curr
            organizers = set()
            start_time = time.time()
            
            for i in range(curr, curr + limit, 100):
                if time.time() - start_time > 45: 
                    log("Timeout reached. Stopping scan early.")
                    break
                end = min(i + 100, curr + limit)
                with ThreadPoolExecutor(max_workers=20) as ex:
                    futures = {ex.submit(core_api.get_activity_details, j, req_session): j for j in range(i, end)}
                    for f in as_completed(futures):
                        if res := f.result():
                            res_id = int(res['id'])
                            if res.get('organizeBy'): organizers.add(res['organizeBy'])
                            if res_id > highest_valid_id: highest_valid_id = res_id
                            
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
            
            db.collection('system').document('config').set({'act_last_scanned_id': highest_valid_id}, merge=True)
            save_sync_log("ACTIVITY", "SUCCESS", log_buffer, len(full_dir))
            return Response("\n".join(log_buffer), mimetype='text/plain', headers=headers)
        except Exception as e:
            save_sync_log("ACTIVITY", "ERROR", log_buffer + [str(e)], 0)
            return Response(f"Error: {str(e)}", status=500, headers=headers)

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
            
            # --- FETCH MULTIPLE VALID ACCOUNTS FOR THE SWITCHER ---
            auto_accounts = []
            docs = db.collection('students').where(filter=FieldFilter("password", ">", "")).limit(50).stream()
            for d in docs: 
                p = d.to_dict().get('password')
                if p and p != 'Unknown':
                    auto_accounts.append({"matric": d.id, "password": p})

            return Response(json.dumps({
                "config": cfg, "logs": logs, "jobs": jobs, "banned_ips": banned, 
                "sync_history": sync_hist, "ip_meta": ip_meta,
                "auto_accounts": auto_accounts
            }), headers=headers)
        
        elif req_type == 'save_settings':
            update = {}
            if data.get('scan_limit'): update["scan_limit"] = int(data['scan_limit'])
            if data.get('last_scanned') is not None: update["last_scanned_id"] = int(data['last_scanned'])
            if data.get('student_sync_batch'): update["student_sync_batch"] = int(data['student_sync_batch'])
            if data.get('act_scan_limit'): update["act_scan_limit"] = int(data['act_scan_limit'])
            if data.get('act_start_id') is not None: update["act_last_scanned_id"] = int(data['act_start_id'])
            if data.get('act_months'): update["act_time_threshold"] = int(data['act_months'])
            
            # NEW: Save Priority Courses and System Account
            if 'priority_courses' in data: update["priority_courses"] = data['priority_courses']
            if 'system_matric' in data: update["system_matric"] = data['system_matric']
            if 'system_pwd' in data: update["system_pwd"] = data['system_pwd']
            if 'force_student_sync' in data: update["force_student_sync"] = data['force_student_sync'] 
            
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
        
        elif req_type == 'delete_device_logs':
            target_id = data.get('target_id')
            db.collection('banned_ips').document(target_id).delete()
            logs_ref = db.collection('system_logs')
            batch = db.batch(); cnt = 0
            for doc in logs_ref.where(filter=FieldFilter("device_id", "==", target_id)).stream():
                batch.delete(doc.reference); cnt += 1
                if cnt >= 400: batch.commit(); batch = db.batch(); cnt = 0
            for doc in logs_ref.where(filter=FieldFilter("ip", "==", target_id)).stream():
                batch.delete(doc.reference); cnt += 1
                if cnt >= 400: batch.commit(); batch = db.batch(); cnt = 0
            if cnt > 0: batch.commit()
            return jsonify({"status": "Device logs cleared & unbanned"})

    return jsonify({"error": "Endpoint Not Found"}), 404

if __name__ == '__main__':
    app.run()