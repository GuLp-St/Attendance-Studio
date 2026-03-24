# --- START OF FILE index.py ---

import sys
import os
import time

# Fix Path for Vercel
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from flask import Flask, request, jsonify, Response
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

from werkzeug.exceptions import HTTPException
@app.errorhandler(Exception)
def handle_exception(e):
    if isinstance(e, HTTPException):
        return e.get_response()

    import traceback
    traceback.print_exc()
    if "Quota exceeded" in str(e):
        return jsonify({"error": "Firebase Quota Exceeded. Please check your Google Cloud Console."}), 429
    return jsonify({"error": "Internal Server Error", "details": str(e)}), 500

import db_pgsql as pg_db

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
    conf = pg_db.query_one("SELECT * FROM system_config WHERE id = 'config'")
    if not conf: 
        pg_db.execute("INSERT INTO system_config (id) VALUES ('config') ON CONFLICT DO NOTHING")
        conf = {}
    
    return {
        "start_id": int(conf.get("last_scanned_id") or 100000),
        "scan_limit": int(conf.get("scan_limit") or 5000),
        "student_sync_batch": int(conf.get("student_sync_batch") or 50),
        "current_semester": conf.get("current_semester", ""),
        "act_start_id": int(conf.get("act_last_scanned_id") or 107000),
        "act_scan_limit": int(conf.get("act_scan_limit") or 5000),
        "act_months": int(conf.get("act_time_threshold") or 6),
        "priority_courses": conf.get("priority_courses", []),
        "system_matric": conf.get("system_matric", ""),
        "system_pwd": conf.get("system_pwd", ""),
        "force_student_sync": conf.get("force_student_sync", False),
        "verify_start_id": conf.get("verify_start_id", "")
    }

def get_authorized_session():
    cfg = get_sys_config()
    sys_m = cfg.get("system_matric")
    pwd = cfg.get("system_pwd")  # Use password stored directly in system_config
        
    if not pwd or pwd == "Unknown":
        # Fallback: find any valid student credential
        docs = pg_db.query("SELECT matric, password FROM students WHERE password IS NOT NULL AND password != 'Unknown' LIMIT 1")
        if docs:
            sys_m = docs[0]['matric']
            pwd = docs[0]['password']
                
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
        pg_db.execute("INSERT INTO logs (timestamp, log_type, ip, device_id, matric, action, details) VALUES (%s, %s, %s, %s, %s, %s, %s)",
            (get_malaysia_time(), "USER_ACTION", ip, dev_id, matric, action, str(details)))
    except: pass

def create_notification(matric, type, title, status, details, mode):
    try:
        pg_db.execute("INSERT INTO notifications (timestamp, matric, type, title, status, details, mode) VALUES (%s, %s, %s, %s, %s, %s, %s)",
            (get_malaysia_time(), matric, type, title, status, details, mode))
    except: pass

def save_sync_log(type, status, messages, items_count):
    try:
        pg_db.execute("INSERT INTO logs (timestamp, log_type, category, status, log_text, items_found) VALUES (%s, %s, %s, %s, %s, %s)",
            (get_malaysia_time(), "SYNC", type, status, "\n".join(messages), items_count))
    except: pass

def save_sys_log(action, status, items_processed):
    try:
        pg_db.execute("INSERT INTO logs (timestamp, log_type, action, status, items_processed) VALUES (%s, %s, %s, %s, %s)",
            (get_malaysia_time(), "SYS", action, status, items_processed))
    except: pass

def save_job_log(category, status, items_processed):
    try:
        pg_db.execute("INSERT INTO logs (timestamp, log_type, category, status, items_processed) VALUES (%s, %s, %s, %s, %s)",
            (get_malaysia_time(), "JOB", category, status, items_processed))
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

def verify_and_save_student(m, data, pwd, active_sem):
    is_currently_unknown = data.get('password') == 'Unknown'
    
    if not pwd or pwd == 'Unknown':
        if not is_currently_unknown:
            pg_db.execute("UPDATE students SET password = 'Unknown' WHERE matric = %s", (m,))
        return False, f"{m}: Cached as Unverified"

    bio = core_api.spc_fetch(f"api/v1/biodata/personal-v2/{m}", m, pwd)
    if not bio:
        if not is_currently_unknown:
            pg_db.execute("UPDATE students SET password = 'Unknown' WHERE matric = %s", (m,))
        return False, f"{m}: Invalid Data/Credential"
    
    prog = bio.get('namaProgram', 'Unknown')
    transcript = core_api.spc_fetch(f"api/v1/result/transcript/{m}", m, pwd)
    cgpa = 0.0
    if transcript and isinstance(transcript, list) and len(transcript) > 0:
        if 'cgpa' in transcript[0]:
            try: cgpa = float(transcript[0]['cgpa'])
            except: pass
    is_timetableable = core_api.validate_login(m, pwd)
    
    faculty = bio.get('Fakulti') or bio.get('fakulti') or bio.get('namaFakulti') or data.get('faculty') or 'Unknown Faculty'
    intake = bio.get('Sesi Pelan') or bio.get('sesiPelan') or data.get('intake') or 'Unknown Intake'
    name = bio.get('nama', data.get('name', 'Unknown'))
    
    pg_db.execute("""
        INSERT INTO students (matric, name, cgpa, program, password, faculty, intake_year, timetable_ready)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (matric) DO UPDATE SET 
            name = EXCLUDED.name, cgpa = EXCLUDED.cgpa, program = EXCLUDED.program, 
            password = EXCLUDED.password, faculty = EXCLUDED.faculty, 
            intake_year = EXCLUDED.intake_year, timetable_ready = EXCLUDED.timetable_ready
    """, (m, name, cgpa, prog, pwd, faculty, intake, is_timetableable))
    
    return True, f"{m}: Valid - CGPA {cgpa} - TT: {is_timetableable}"

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

    ip_doc = pg_db.query_one("SELECT 1 FROM banned_ips WHERE ip = %s", (client_ip,))
    if ip_doc:
        return jsonify({"error": "Access Denied"}), 403

    # ==========================================
    #  STANDARD ENDPOINTS
    # ==========================================

    if path == '/directory':
        dir_type = args.get('type', 'student')
        try:
            if dir_type == 'student':
                # Global Directory for Search/Admin (Limit to 50000 for full frontend cache)
                students = pg_db.query("SELECT matric as m, name as n, 's' as t FROM students LIMIT 50000")
                courses = pg_db.query("SELECT id as m, CONCAT(code, ' ', name) as n, 'c' as t FROM courses LIMIT 50000")
                return Response(json.dumps(list(students) + list(courses)), headers=headers)
            else:
                # Organizer search for OrgSearchView.jsx
                orgs = pg_db.query("SELECT id as m, name as n, activities FROM organizers ORDER BY id")
                results = []
                for org in orgs:
                    acts = org['activities']
                    if isinstance(acts, str):
                        try: acts = json.loads(acts)
                        except: acts = []
                    
                    act_names = []
                    if isinstance(acts, list):
                        for a in acts:
                            if isinstance(a, dict) and 'name' in a: act_names.append(a['name'])
                            elif isinstance(a, str): act_names.append(a)
                    
                    results.append({
                        "m": org['m'],
                        "n": org['n'],
                        "a": " | ".join(act_names)
                    })
                return Response(json.dumps(results), headers=headers)
        except Exception as e:
            traceback.print_exc()
            return jsonify([{"error": str(e)}])

    elif path == '/directory_v2' and request.method == 'POST':
        try:
            d = request.get_json() or {}
            page = int(args.get('page', 1))
            limit = int(d.get('row_limit', 10))
            offset = (page - 1) * limit
            q = args.get('q', '').strip()
            
            # Filters
            faculty = d.get('faculty')
            prog = d.get('programme')
            intake = d.get('intake_year')
            include_unverified = d.get('include_unverified', False)
            
            # Sort
            sort_by = d.get('sort_by', 'name')
            if sort_by not in ['name', 'matric', 'cgpa']: sort_by = 'name'
            order = d.get('sort_order', 'asc').upper()
            if order not in ['ASC', 'DESC']: order = 'ASC'

            where_clauses = []
            params = []

            if not include_unverified:
                where_clauses.append("password != 'Unknown' AND password IS NOT NULL")
            
            if q:
                where_clauses.append("(matric ILIKE %s OR name ILIKE %s)")
                params.extend([f"%{q}%", f"%{q}%"])
            
            if faculty:
                where_clauses.append("faculty = %s")
                params.append(faculty)
            
            if prog:
                where_clauses.append("program = %s")
                params.append(prog)
                
            if intake:
                where_clauses.append("intake_year = %s")
                params.append(intake)

            where_sql = ("WHERE " + " AND ".join(where_clauses)) if where_clauses else ""
            
            sql = f"""
                SELECT matric, name, faculty, program as programme, intake_year, cgpa, timetable_ready, password
                FROM students 
                {where_sql}
                ORDER BY {sort_by} {order}
                LIMIT %s OFFSET %s
            """
            data = pg_db.query(sql, params + [limit, offset])
            
            count_sql = f"SELECT COUNT(*) as count FROM students {where_sql}"
            count_res = pg_db.query_one(count_sql, params)
            total = count_res['count'] if count_res else 0
            
            # Hierarchy for filters
            hierarchy = {}
            h_data = pg_db.query("SELECT faculty, program, COUNT(*) as count FROM students GROUP BY faculty, program")
            for row in h_data:
                f, p, c = row['faculty'], row['program'], row['count']
                if f not in hierarchy: hierarchy[f] = {}
                hierarchy[f][p] = c
                
            # Intakes list
            intakes = [r['intake_year'] for r in pg_db.query("SELECT DISTINCT intake_year FROM students WHERE intake_year IS NOT NULL ORDER BY intake_year DESC")]

            return Response(json.dumps({
                "data": list(data),
                "total": total,
                "total_pages": (total + limit - 1) // limit,
                "hierarchy": hierarchy,
                "intakes": intakes
            }), headers=headers)
        except Exception as e:
            traceback.print_exc()
            return jsonify({"error": str(e)}), 500

    elif path == '/search':
        query = args.get('q', '').strip()
        if len(query) < 2: return jsonify([])
        results = []
        try:
            q = f"%{query}%"
            # Return same structure as Search.jsx expects
            docs = pg_db.query("SELECT matric as m, name as n, 's' as t FROM students WHERE matric ILIKE %s OR name ILIKE %s LIMIT 10", (q, q))
            results = list(docs)
        except: pass
        return Response(json.dumps(results), headers=headers)

    elif path == '/dashboard':
        matric = args.get('matric')
        log_action(client_ip, matric, "VIEW_DASHBOARD")
        try:
            doc = pg_db.query_one("SELECT * FROM students WHERE matric = %s", (matric,))
            
            # NEW: If student doesn't exist, try to fetch basic identity publicly via system creds
            if not doc:
                try:
                    req_session = get_authorized_session()
                    bio = core_api.spc_fetch(f"api/v1/biodata/personal-v2/{matric}", matric, "dummy", session=req_session)
                    if bio:
                        name = bio.get('nama', 'Unknown Student')
                        faculty = bio.get('namaFakulti', 'Unknown Faculty')
                        program = bio.get('namaProgram', 'Unknown Program')
                        intake = bio.get('Sesi Pelan', 'Unknown')
                        pg_db.execute("INSERT INTO students (matric, name, faculty, program, intake_year, password) VALUES (%s, %s, %s, %s, %s, %s) ON CONFLICT DO NOTHING",
                                       (matric, name, faculty, program, intake, "Unknown"))
                        doc = pg_db.query_one("SELECT * FROM students WHERE matric = %s", (matric,))
                except: pass

            if not doc: return jsonify({"error": "User not found in system directory"}), 404
            
            req_session = get_authorized_session()
            user_data = dict(doc)
            group_ids = user_data.get('groups') or []
            following_ids = user_data.get('following') or []
            
            active_autoscan = set()
            try:
                for j in pg_db.query("SELECT gid FROM autoscan_jobs WHERE matric = %s AND status = 'pending'", (matric,)):
                    active_autoscan.add(j['gid'])
            except: pass

            active_auto_register = []
            try:
                for j in pg_db.query("SELECT gid FROM auto_register_jobs WHERE matric = %s", (matric,)):
                    active_auto_register.append(str(j['gid']))
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
                pg_db.execute("INSERT INTO autoscan_jobs (matric, gid, createdAt, status, mode, job_type) VALUES (%s, %s, %s, %s, %s, %s) ON CONFLICT (matric, gid) DO UPDATE SET status = EXCLUDED.status, mode = EXCLUDED.mode, job_type = EXCLUDED.job_type",
                    (d.get('matric'), str(d.get('gid')), get_malaysia_time(), "pending", d.get('mode', 'crowd'), d.get('job_type', 'class')))
                msg = "Autoscan Activated."
            elif d['type'] == 'cancel_autoscan':
                pg_db.execute("DELETE FROM autoscan_jobs WHERE matric = %s AND gid = %s", (d.get('matric'), str(d.get('gid'))))
                msg = "Autoscan Deactivated."
            elif d['type'] == 'follow_org':
                pg_db.execute("UPDATE students SET following = array_append(COALESCE(following, '{}'), %s) WHERE matric = %s AND NOT (%s = ANY(COALESCE(following, '{}')))", (d['sid'], d['matric'], d['sid']))
                msg = "Followed"
            elif d['type'] == 'unfollow_org':
                pg_db.execute("UPDATE students SET following = array_remove(following, %s) WHERE matric = %s", (d['sid'], d['matric']))
                msg = "Unfollowed"
            elif d['type'] == 'start_auto_register':
                pg_db.execute("INSERT INTO auto_register_jobs (matric, gid, createdAt, status) VALUES (%s, %s, %s, %s) ON CONFLICT (matric, gid) DO UPDATE SET status = EXCLUDED.status",
                    (d.get('matric'), str(d.get('gid')), get_malaysia_time(), "pending"))
                msg = "Auto Register Activated."
            elif d['type'] == 'stop_auto_register':
                pg_db.execute("DELETE FROM auto_register_jobs WHERE matric = %s AND gid = %s", (d.get('matric'), str(d.get('gid'))))
                msg = "Auto Register Deactivated."
        except Exception as e: msg = str(e)
        return jsonify({"msg": msg})

    elif path == '/cron':
        try:
            start_time = time.time()
            req_session = get_authorized_session()
            now_my = get_malaysia_time()
            today_str = now_my.strftime('%Y-%m-%d')
            
            cutoff = now_my - timedelta(days=7)
            pg_db.execute("DELETE FROM system_logs WHERE timestamp < %s", (cutoff,))

            jobs = pg_db.query("SELECT * FROM autoscan_jobs")
            results = []

            def process_autoscan_job(job):
                d = dict(job)
                job_time = d['createdAt'] if isinstance(d['createdAt'], datetime) else datetime.fromisoformat(str(d['createdAt']).replace("Z", "+00:00"))
                if (now_my - job_time).total_seconds() > 86400:
                    create_notification(d['matric'], d.get('job_type','class'), d.get('gid', 'Unknown'), 'FAILED', 'Autoscan Expired (24h)', d.get('mode','crowd'))
                    pg_db.execute("DELETE FROM autoscan_jobs WHERE matric = %s AND gid = %s", (d['matric'], d['gid']))
                    return "Cleaned (Expired)"
                
                matric, target_id = d['matric'], str(d['gid'])
                mode, j_type = d.get('mode', 'crowd'), d.get('job_type', 'class')

                if j_type == 'class':
                    sessions = core_api.get_sessions(target_id, req_session)
                    target = next((s for s in sessions if datetime.fromtimestamp(s['eventDate']/1000).strftime('%Y-%m-%d') == today_str), None)
                    if not target: return "No Class"
                    
                    my_log = core_api.get_log(target['id'], matric, req_session)
                    if my_log and my_log.get('status') == 'P':
                        create_notification(matric, 'class', f"Class {target_id}", 'SUCCESS', 'Already marked Present', mode)
                        pg_db.execute("DELETE FROM autoscan_jobs WHERE matric = %s AND gid = %s", (matric, target_id))
                        return "Already Present"
                    
                    should_scan = False
                    if mode == 'crowd' and core_api.get_attendance_count(target['id'], req_session) >= 5: should_scan = True
                    elif mode == 'time':
                        try:
                            dt_end = datetime.strptime(f"{today_str} {target['endTime']}", "%Y-%m-%d %I:%M %p").replace(tzinfo=timezone(timedelta(hours=8)))
                            if (dt_end.timestamp() - 1200) <= now_my.timestamp(): should_scan = True
                        except: pass
                    
                    if should_scan:
                        res = core_api.scan_qr(target['id'], matric, req_session)
                        is_success = ("Success" in res or "taken" in res.lower() or ("Server:" in res and "Server Error" not in res))
                        status = "SUCCESS" if is_success else "FAILED"
                        create_notification(matric, 'class', f"Class {target_id}", status, res, mode)
                        pg_db.execute("DELETE FROM autoscan_jobs WHERE matric = %s AND gid = %s", (matric, target_id))
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
                        pg_db.execute("DELETE FROM autoscan_jobs WHERE matric = %s AND gid = %s", (matric, target_id))
                        return "Completed"
                        
                    scan_ci, scan_co = False, False
                    if mode == 'crowd':
                        stats = core_api.get_event_stats(target['id'], req_session)
                        if not is_ci and stats[0] >= 5: scan_ci = True
                        if is_ci and not is_co and req_co and stats[1] >= 5: scan_co = True
                    elif mode == 'time':
                        try:
                            t_str = target['endTime']
                            try: dt_end = datetime.strptime(f"{today_str} {t_str}", "%Y-%m-%d %I:%M %p").replace(tzinfo=timezone(timedelta(hours=8)))
                            except: dt_end = datetime.strptime(f"{today_str} {t_str}", "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone(timedelta(hours=8)))
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
                            pg_db.execute("DELETE FROM autoscan_jobs WHERE matric = %s AND gid = %s", (matric, target_id))
                            return f"CI Attempted ({status}) - Job Deleted"
                        return f"CI Attempted ({status}) - Job Kept for CO"

                    if scan_co: 
                        r = core_api.scan_activity_qr(target['id'], matric, 'o')
                        is_success = "Success" in r or ("Server:" in r and "Server Error" not in r)
                        status = "SUCCESS" if is_success else "FAILED"
                        create_notification(matric, 'activity', target.get('name'), status, f"Check-Out: {r}", mode)
                        pg_db.execute("DELETE FROM autoscan_jobs WHERE matric = %s AND gid = %s", (matric, target_id))
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
            ar_jobs = pg_db.query("SELECT * FROM auto_register_jobs")

            def process_auto_register_job(job):
                d = dict(job)
                matric, gid = d['matric'], str(d['gid'])
                job_time = d['createdAt'] if isinstance(d['createdAt'], datetime) else datetime.fromisoformat(str(d['createdAt']).replace("Z", "+00:00"))
                if (now_my - job_time).total_seconds() > 86400 * 7:
                    create_notification(matric, 'class', f'GID:{gid}', 'FAILED', 'Auto Register Expired (7d)', 'auto')
                    pg_db.execute("DELETE FROM auto_register_jobs WHERE matric = %s AND gid = %s", (matric, gid))
                    return "AR Expired"
                try:
                    course_doc = pg_db.query_one("SELECT code, course_group FROM courses WHERE id = %s", (gid,))
                    code, group = ('Unknown', '') if not course_doc else (course_doc.get('code', 'Unknown'), course_doc.get('course_group', ''))
                    stud_doc = pg_db.query_one("SELECT password FROM students WHERE matric = %s", (matric,))
                    pwd = stud_doc.get('password') if stud_doc else ''
                    
                    if not pwd or pwd == 'Unknown':
                        return "AR Pending (No Password)"
                        
                    sem = get_sys_config().get('current_semester', '2025/2026-2')
                    status_c, resp_c = core_api.register_course(matric, pwd, code, gid, sem, group, "P")
                    is_success = status_c == 200 and ("berjaya" in resp_c.lower() or "success" in resp_c.lower() or '"error":false' in resp_c.replace(" ", "").lower())
                    
                    if not is_success and ("error\":true" in resp_c.replace(" ", "").lower() or "taraf" in resp_c.lower() or "syarat" in resp_c.lower()):
                        status_c, resp_c = core_api.register_course(matric, pwd, code, gid, sem, group, "T")
                        is_success = status_c == 200 and ("berjaya" in resp_c.lower() or "success" in resp_c.lower() or '"error":false' in resp_c.replace(" ", "").lower())

                    status = 'SUCCESS' if is_success else 'FAILED'
                    create_notification(matric, 'class', f'{code} {group}', status, f'Auto Register: {str(resp_c)[:80]}', 'auto')
                    
                    if is_success:
                        pg_db.execute("UPDATE students SET groups = array_append(COALESCE(groups, '{}'), %s) WHERE matric = %s AND NOT (%s = ANY(COALESCE(groups, '{}')))", (gid, matric, gid))
                        pg_db.execute("UPDATE courses SET last_student_sync = 0 WHERE id = %s", (gid,))
                        pg_db.execute("DELETE FROM auto_register_jobs WHERE matric = %s AND gid = %s", (matric, gid))
                        
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
            docs = pg_db.query("SELECT * FROM notifications WHERE matric = %s ORDER BY timestamp DESC", (matric,))
            res = [{"id": str(d.get('id', '')), **dict(d)} for d in docs]
            for r in res:
                if 'timestamp' in r and isinstance(r['timestamp'], datetime):
                    r['timestamp'] = r['timestamp'].isoformat()
            return Response(json.dumps(res), headers=headers)
        elif request.method == 'DELETE':
            nid = args.get('id')
            pg_db.execute("DELETE FROM notifications WHERE id = %s", (nid,))
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
            cfg = get_sys_config()
            curr_id = cfg.get("verify_start_id", "")
            
            if curr_id:
                docs = pg_db.query("SELECT * FROM students WHERE matric > %s ORDER BY matric LIMIT 100", (curr_id,))
            else:
                docs = pg_db.query("SELECT * FROM students ORDER BY matric LIMIT 100")
            
            if not docs and curr_id:
                pg_db.execute("UPDATE system_config SET verify_start_id = '' WHERE id = 'config'")
                return Response("Reset verify pointer.", headers=headers)
                
            results = []
            last_id = curr_id
            start_time = time.time()
            active_sem = cfg.get('current_semester', '2025/2026-2')
            
            def verify_student_wrapper(m, data, pwd, active_sem):
                success, msg = verify_and_save_student(m, data, pwd, active_sem)
                return msg

            with ThreadPoolExecutor(max_workers=10) as ex:
                futures = {}
                try: req_s = get_authorized_session()
                except: req_s = None
                
                for d in docs:
                    if time.time() - start_time > 45: break
                    last_id = d['matric']
                    m = d['matric']
                    data = dict(d)
                    pwd = data.get('password')
                    
                    if (not pwd or pwd == 'Unknown') and req_s:
                        try:
                            bio = core_api.get_student_biodata(m, req_s)
                            if bio:
                                ic = bio.get('noKadPengenalan') or bio.get('noIc')
                                if ic: pwd = f"Unimas!{ic}"
                        except: pass
                        
                    futures[ex.submit(verify_student_wrapper, m, data, pwd, active_sem)] = m
                    
            tt_valid = 0
            login_valid = 0
            for f in as_completed(futures):
                try: 
                    msg = f.result()
                    if "Valid -" in msg: login_valid += 1
                    if "TT: True" in msg: tt_valid += 1
                except: pass
            
            if last_id: pg_db.execute("UPDATE system_config SET verify_start_id = %s WHERE id = 'config'", (last_id,))
            log_str = f"Processed: {len(futures)} | Valid Logins: {login_valid} | Valid+TT: {tt_valid} | Pointer: {curr_id or 'START'} -> {last_id}"
            save_sys_log("CRON VERIFY", "SUCCESS", len(futures))
            return Response(json.dumps({"processed": len(futures), "details": log_str}), headers=headers)
        except Exception as e:
            save_sys_log("CRON VERIFY", "ERROR", 0)
            return jsonify({"error": str(e)}), 500

    elif path == '/directory_v2' and request.method == 'POST':
        page = int(args.get('page', 1))
        limit = min(int(args.get('limit', 10)), 50)
        req_body = request.get_json(silent=True) or {}
        limit_val = int(req_body.get('row_limit', limit))
        include_unverified = req_body.get('include_unverified', False)
        sort_by = req_body.get('sort_by', 'name')
        sort_order = req_body.get('sort_order', 'asc')
        intake_filt = req_body.get('intake_year', '')
        search_q = args.get('q', '').strip().upper()
        
        try:
            db_docs = pg_db.query("SELECT * FROM students")
            all_valid = []
            for x in db_docs:
                s = dict(x)
                if not include_unverified and (not s.get('password') or s.get('password') == 'Unknown'):
                    continue
                if search_q and search_q not in str(s.get('name', '')).upper() and search_q not in str(s.get('matric', '')):
                    continue
                all_valid.append({
                    "matric": s.get('matric'),
                    "name": s.get('name'),
                    "faculty": s.get('faculty'),
                    "programme": s.get('program') or s.get('programme') or 'Unknown Programme',
                    "intake_year": s.get('intake_year'),
                    "cgpa": s.get('cgpa'),
                    "timetable_ready": bool(s.get('groups')),
                    "password": s.get('password')
                })
                        
            if search_q:
                all_valid = [x for x in all_valid if search_q in x.get('name', '').upper() or search_q in x.get('matric','')]
                
            if intake_filt:
                all_valid = [x for x in all_valid if x.get('intake_year') == intake_filt]
            
            # 1. Normalize fields
            for x in all_valid:
                x['programme'] = x.get('program', x.get('programme', 'Unknown Programme'))
            
            # 2. Extract hierarchy: Faculty -> { Programme: Count }
            hierarchy = {}
            for x in all_valid:
                f = x.get('faculty', 'Unknown Faculty')
                p = x.get('programme')
                if f not in hierarchy: hierarchy[f] = {}
                hierarchy[f][p] = hierarchy[f].get(p, 0) + 1
                
            # 3. Always calculate CGPA percentiles per programme FIRST (so colors are accurate globally)
            prog_groups = {}
            for v in all_valid:
                p = v.get('programme')
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
                    
            # 4. Filter by selected program/faculty
            selected_prog = req_body.get('programme')
            selected_fac = req_body.get('faculty')
            if selected_prog:
                all_valid = [v for v in all_valid if v.get('programme') == selected_prog]
            elif selected_fac:
                all_valid = [v for v in all_valid if v.get('faculty') == selected_fac]
                
            intakes = sorted(list({x.get('intake_year') for x in all_valid if x.get('intake_year')}), reverse=True)
                
            # 5. Sort
            rev = (sort_order == 'desc')
            if sort_by == 'cgpa':
                all_valid.sort(key=lambda x: float(x.get('cgpa') or 0), reverse=rev)
            elif sort_by == 'matric':
                all_valid.sort(key=lambda x: x.get('matric', ''), reverse=rev)
            else:
                all_valid.sort(key=lambda x: x.get('name', ''), reverse=rev)
                
            total_matches = len(all_valid)
            start_idx = (page - 1) * limit_val
            end_idx = start_idx + limit_val
            paged = all_valid[start_idx:end_idx]
            
            req_matric = args.get('matric')
            if req_matric and sort_by == 'cgpa':
                # Force visibility of own row at bottom if out of scope
                user_found = next((x for x in paged if x.get('matric') == req_matric), None)
                if not user_found:
                    owner_row = next((x for x in all_valid if x.get('matric') == req_matric), None)
                    if owner_row:
                        owner_row['is_appended_owner'] = True
                        paged.append(owner_row)
            
            res_data = {
                "page": page, "limit": limit_val, "total": total_matches, "total_pages": max(1, (total_matches + limit_val - 1) // limit_val),
                "hierarchy": hierarchy, "intakes": intakes, "data": paged
            }
            return Response(json.dumps(res_data), headers=headers)
        except Exception as e: return jsonify({"error": str(e)}), 500

    elif path == '/student_details_proxy':
        m, pwd = args.get('matric'), args.get('password')
        if not pwd:
            doc = pg_db.query_one("SELECT password FROM students WHERE matric = %s", (m,))
            pwd = doc.get('password') if doc else None
        
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
                docs = pg_db.query("SELECT * FROM courses WHERE code = %s", (query,))
                for data in docs:
                    res.append({"id": str(data['id']), "group": data.get('course_group'), "name": data.get('name'), "code": data.get('code'), "students": len(data.get('enrolled_students') or [])})
            elif q_type == 's':
                s_data = pg_db.query_one("SELECT * FROM students WHERE matric = %s", (query,))
                if s_data:
                    for gid in (s_data.get('groups') or []):
                        c_data = pg_db.query_one("SELECT * FROM courses WHERE id = %s", (gid,))
                        if c_data:
                            res.append({"id": str(gid), "group": c_data.get('course_group'), "name": c_data.get('name'), "code": c_data.get('code'), "students": len(c_data.get('enrolled_students') or [])})
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
            pwd_map = {}
            if matrics:
                format_strings = ','.join(['%s'] * len(matrics))
                docs = pg_db.query(f"SELECT matric, password FROM students WHERE matric IN ({format_strings})", tuple(matrics))
                pwd_map = {d['matric']: d.get('password', '') for d in docs}
            
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
            active_sem = get_sys_config().get('current_semester', '2025/2026-2')
            try:
                student_doc = pg_db.query_one("SELECT * FROM students WHERE matric = %s", (m,))
                s_data = dict(student_doc) if student_doc else {}
                verify_and_save_student(m, s_data, pwd, active_sem)
                log_action("SYSTEM", initiator, "AUTH_VERIFIED", f"System verified new valid credential for user {m} and saved to Directory Cache.")
            except Exception as e:
                print("Silent error verifying valid directory manually:", str(e))
                
            pg_db.execute("UPDATE students SET password = %s WHERE matric = %s", (pwd, m))
            log_action(client_ip, initiator, "TOOL_VALIDATE_PWD", f"Target:{m}")
            return jsonify({"valid": True, "password": pwd})
        else:
            if auto_fetch:
                # Save as Unknown so it doesn't re-test next time
                pg_db.execute("INSERT INTO students (matric, password) VALUES (%s, %s) ON CONFLICT (matric) DO UPDATE SET password = EXCLUDED.password", (m, "Unknown"))
            return jsonify({"valid": False})

    elif path == '/tools/action' and request.method == 'POST':
        d = request.get_json()
        action, m, pwd, code, cid, group_name, initiator = d.get('action'), d.get('matric'), d.get('password'), d.get('code'), d.get('cid'), d.get('group_name', 'G01'), d.get('initiator', 'unknown')
        sem = get_sys_config().get('current_semester', '2025/2026-2')
        
        log_action(client_ip, initiator, f"TOOL_MASTER_{action}", f"Target:{m} Course:{code}({cid})")
        
        try:
            if not pwd:
                doc = pg_db.query_one("SELECT password FROM students WHERE matric = %s", (m,))
                pwd = doc.get('password') if doc else None
            
            if not pwd or pwd == 'Unknown':
                return jsonify({"needs_password": True})

            is_success = False

            if action == "DROP":
                status, resp = core_api.drop_course(m, pwd, code, cid, sem)
                is_success = status == 200 and ("berjaya" in resp.lower() or "success" in resp.lower() or '"error":false' in resp.replace(" ", "").lower() or 'gugur' in resp.lower())
                
                if is_success:
                    pg_db.execute("UPDATE students SET groups = array_remove(groups, %s), password = %s WHERE matric = %s", (str(cid), pwd, m))
                    pg_db.execute("UPDATE courses SET last_student_sync = 0 WHERE id = %s", (str(cid),))
            else:
                status, resp = core_api.register_course(m, pwd, code, cid, sem, group_name, "P")
                is_success = status == 200 and ("berjaya" in resp.lower() or "success" in resp.lower() or '"error":false' in resp.replace(" ", "").lower())
                
                if not is_success and ("error\":true" in resp.replace(" ", "").lower() or "taraf" in resp.lower() or "syarat" in resp.lower()):
                    status, resp = core_api.register_course(m, pwd, code, cid, sem, group_name, "T")
                    is_success = status == 200 and ("berjaya" in resp.lower() or "success" in resp.lower() or '"error":false' in resp.replace(" ", "").lower())
                
                if is_success:
                    # FIX: Enforce str(cid)
                    pg_db.execute("UPDATE students SET groups = array_append(COALESCE(groups, '{}'), %s), password = %s WHERE matric = %s AND NOT (%s = ANY(COALESCE(groups, '{}')))", (str(cid), pwd, m, str(cid)))
                    pg_db.execute("UPDATE courses SET last_student_sync = 0 WHERE id = %s", (str(cid),))
            
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
            req_session = get_authorized_session() 
            active_sem = core_api.get_active_semester(req_session)
            stored_sem = cfg.get('current_semester')
            
            if active_sem and active_sem != stored_sem:
                log(f"New Semester Detected: {active_sem}. Clearing DB...")
                pg_db.execute("DELETE FROM students")
                pg_db.execute("DELETE FROM courses")
                pg_db.execute("UPDATE system_config SET current_semester = %s WHERE id = 'config'", (active_sem,))
                
            curr = cfg['start_id']
            highest_valid_id = curr
            last_scanned_id = curr  # tracks progress even if no current-sem courses found
            discovered = []
            timed_out = False
            i = curr
            
            log(f"Scanning from {curr} onwards until timeout...")
            start_time = time.time()
            while True:
                if time.time() - start_time > 45: 
                    timed_out = True
                    log(f"Timeout reached. Stopped at ID {i}. Scanned {i - curr} IDs this run.")
                    break
                end = i + 100
                last_scanned_id = end  # always advance, even if no results
                with ThreadPoolExecutor(max_workers=10) as ex:
                    futures = {ex.submit(core_api.get_group_info, j, req_session): j for j in range(i, end)}
                    for f in as_completed(futures):
                        if res := f.result():
                            res_id = int(res['id'])
                            if not active_sem or res.get('semester') == active_sem:
                                discovered.append(res)
                                if res_id > highest_valid_id: highest_valid_id = res_id
                i = end
                                
            if discovered:
                upsert_sql = """
                INSERT INTO courses (id, code, name, semester, course_group)
                VALUES (%s, %s, %s, %s, %s)
                ON CONFLICT (id) DO UPDATE SET 
                    code = EXCLUDED.code, name = EXCLUDED.name, 
                    semester = EXCLUDED.semester, course_group = EXCLUDED.course_group
                """
                tuples = []
                for d in discovered:
                    tuples.append((str(d['id']), d['code'], d['name'], d['semester'], d['group']))
                pg_db.execute_batch(upsert_sql, tuples)

            # Always advance pointer to where we actually scanned to,
            # so next run continues forward even if nothing current-sem was found.
            # Use highest_valid_id if we found something, otherwise use last_scanned_id.
            next_pointer = highest_valid_id if discovered else last_scanned_id
            log(f"Pointer advanced to {next_pointer} (discovered {len(discovered)} current-semester courses).")
            pg_db.execute("UPDATE system_config SET last_scanned_id = %s WHERE id = 'config'", (next_pointer,))
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
            req_session = get_authorized_session()
            
            active_sem = core_api.get_active_semester(req_session)
            log(f"Active semester: {active_sem}")

            # --- THE NEW FORCE SYNC LOGIC ---
            force_sync = cfg.get('force_student_sync', False)
            if force_sync: log("FORCE HEAL ENABLED: Ignoring database memory.")
            
            target_courses = []
            seen_gids = set()
            
            # --- PRIORITY COURSES FETCH ---
            priority_codes = cfg.get('priority_courses', [])
            if priority_codes:
                log(f"Processing {len(priority_codes)} Priority Courses first...")
                for code in priority_codes:
                    docs = pg_db.query("SELECT id, code, name, semester, course_group AS group FROM courses WHERE code = %s AND semester = %s", (code, active_sem))
                    for d in docs:
                        target_courses.append(dict(d))
                        seen_gids.add(d['id'])
            
            # --- FETCH COURSES, STALEST FIRST (LIMIT 250 per run to prevent bloat) ---
            courses_query = pg_db.query("SELECT id, code, name, semester, course_group AS group, last_student_sync FROM courses WHERE semester = %s ORDER BY last_student_sync ASC LIMIT 250", (active_sem,))
            for c in courses_query:
                if c['id'] in seen_gids: continue
                target_courses.append(dict(c))
                seen_gids.add(c['id'])
            
            # Update old-semester courses timestamp so they don't clog discovery
            pg_db.execute("UPDATE courses SET last_student_sync = 9999999999 WHERE semester != %s", (active_sem,))
            
            if not target_courses: return Response("No current-semester courses to sync", headers=headers)
            log(f"Processing {len(target_courses)} courses (stalest first). Running until timeout...")
            
            course_students = {}
            student_names = {}
            start_time = time.time()
            processed_count = 0
            total_added = 0
            total_removed = 0
            
            with ThreadPoolExecutor(max_workers=8) as ex:
                futures = {}
                for c in target_courses:
                    if time.time() - start_time > 25: 
                        log(f"Submission paused. {len(futures)} courses queued.")
                        break
                    futures[ex.submit(core_api.get_students, c['id'], req_session)] = c
                    
                for f in as_completed(futures): 
                    if time.time() - start_time > 55: 
                        log("Time limit reached. Saving progress and stopping.")
                        break
                        
                    c = futures[f]
                    try:
                        resp = f.result() or []
                        current_list = []
                        for s in resp:
                            m, n = s.get("NOMATRIK"), s.get("NAMAPELAJAR")
                            if m: current_list.append((m, n or 'Unknown'))

                        current_matrics = set(m for m, n in current_list)
                        gid = str(c['id'])
                        
                        # 1. Bulk Upsert Students (matric, name)
                        if current_list:
                            # Split into chunks of 100 to stay safe with SQL limits
                            for i in range(0, len(current_list), 100):
                                batch = current_list[i:i+100]
                                placeholders = ", ".join(["(%s, %s)"] * len(batch))
                                params = []
                                for m, n in batch: params.extend([m, n])
                                pg_db.execute(f"""
                                    INSERT INTO students (matric, name) 
                                    VALUES {placeholders}
                                    ON CONFLICT (matric) DO UPDATE SET 
                                        name = CASE WHEN students.name = 'Unknown' THEN EXCLUDED.name ELSE students.name END
                                    WHERE students.name = 'Unknown' AND EXCLUDED.name != 'Unknown'
                                """, tuple(params))

                        # 2. Get Diffs
                        old_rec = pg_db.query_one("SELECT enrolled_students FROM courses WHERE id = %s", (gid,))
                        previous_matrics = set(old_rec['enrolled_students'] if old_rec and old_rec['enrolled_students'] else [])
                        
                        added = list(current_matrics - previous_matrics)
                        removed = list(previous_matrics - current_matrics)
                        
                        if added or removed:
                            log(f"  [{c['code']}]: +{len(added)}, -{len(removed)} | {len(current_matrics)} total")
                            
                            # Bulk Update Student -> Course pointers
                            if added:
                                pg_db.execute("UPDATE students SET groups = array_append(COALESCE(groups, '{}'), %s) WHERE matric = ANY(%s) AND NOT (%s = ANY(COALESCE(groups, '{}')))", (gid, added, gid))
                            if removed:
                                pg_db.execute("UPDATE students SET groups = array_remove(groups, %s) WHERE matric = ANY(%s)", (gid, removed))
                                # Prune orphans in bulk
                                pg_db.execute("DELETE FROM students WHERE matric = ANY(%s) AND (groups IS NULL OR array_length(groups, 1) IS NULL OR array_length(groups, 1) = 0)", (removed,))
                        else:
                            # If no changes but groups are empty, we might need a heal? 
                            # But for now, just record the sync
                            if not added and len(current_matrics) > 0:
                                pass 

                        # Save course enrollment list (Course -> Students)
                        pg_db.execute("UPDATE courses SET enrolled_students = %s, last_student_sync = %s WHERE id = %s", (list(current_matrics), int(time.time()), gid))
                        
                        total_added += len(added)
                        total_removed += len(removed)
                        processed_count += 1
                        
                    except Exception as e:
                        log(f"Error syncing {c.get('code', 'Unknown')}: {str(e)}")

            log(f"Summary: {processed_count} courses synced | +{total_added} / -{total_removed} changes.")
            elapsed = round(time.time() - start_time, 1)
            log(f"Completed in {elapsed}s.")

            save_sync_log("STUDENT", "SUCCESS", log_buffer, processed_count)
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
            highest_valid_id = curr
            organizers = set()
            start_time = time.time()
            i = curr
            
            log(f"Scanning activity IDs from {curr} onwards until timeout...")
            while True:
                if time.time() - start_time > 45: 
                    log(f"Timeout reached. Stopped at ID {i}. Scanned {i - curr} IDs this run.")
                    break
                end = i + 100
                with ThreadPoolExecutor(max_workers=20) as ex:
                    futures = {ex.submit(core_api.get_activity_details, j, req_session): j for j in range(i, end)}
                    for f in as_completed(futures):
                        if res := f.result():
                            res_id = int(res['id'])
                            if res.get('organizeBy'): organizers.add(res['organizeBy'])
                            if res_id > highest_valid_id: highest_valid_id = res_id
                i = end
                            
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
                
                pg_db.execute("""
                    INSERT INTO organizers (id, name, last_active, activities)
                    VALUES (%s, %s, %s, %s)
                    ON CONFLICT (id) DO UPDATE SET 
                        name = EXCLUDED.name, 
                        last_active = EXCLUDED.last_active, 
                        activities = EXCLUDED.activities
                """, (str(org_id), name, latest, json.dumps(top10)))
                log(f"Synced {name} - Updated {len(top10)} recent activities")
                
            log(f"Pointer advanced to {highest_valid_id} (found {len(organizers)} organizers).")
            pg_db.execute("UPDATE system_config SET act_last_scanned_id = %s WHERE id = 'config'", (highest_valid_id,))
            save_sync_log("ACTIVITY", "SUCCESS", log_buffer, len(organizers))
            return Response("\n".join(log_buffer), mimetype='text/plain', headers=headers)
        except Exception as e:
            save_sync_log("ACTIVITY", "ERROR", log_buffer + [str(e)], 0)
            return Response(f"Error: {str(e)}", status=500, headers=headers)

    elif path == '/organizer_details':
        oid, matric = args.get('oid'), args.get('matric')
        try:
            doc = pg_db.query_one("SELECT * FROM organizers WHERE id = %s", (oid,))
            data = dict(doc) if doc else {"id": oid}
            if 'activities' in data and type(data['activities']) is str:
                try: data['activities'] = json.loads(data['activities'])
                except: pass
                
            req_session = get_authorized_session()
            live_events = core_api.get_organizer_events(oid, req_session)
            if 'name' not in data or not data['name']:
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
                job_doc = pg_db.query_one("SELECT status FROM autoscan_jobs WHERE id = %s", (job_id,))
                data['autoscan_active'] = (job_doc and job_doc['status'] == 'pending')
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

    elif path == '/admin_test_system_account':
        if args.get('key') != ADMIN_SECRET_KEY: return jsonify({"error": "Unauthorized"}), 401
        m, pwd = args.get('matric'), args.get('password')
        if not m or not pwd: return jsonify({"valid": False, "error": "Missing credentials"})
        
        is_valid = core_api.validate_login(m, pwd)
        if not is_valid: return jsonify({"valid": False, "error": "Invalid login credentials"})
        
        # The validate_login method intrinsically checks timetable API access over atdcloud.
        
        return jsonify({"valid": True})

    elif path == '/admin_verify_directory':
        if args.get('key') != ADMIN_SECRET_KEY: return jsonify({"error": "Unauthorized"}), 401
        log_buffer = []
        def log(msg): log_buffer.append(f"[{get_malaysia_time().strftime('%H:%M:%S')}] {msg}")
        try:
            log("Starting Directory Verification...")
            cfg = get_sys_config()
            active_sem = cfg.get('current_semester', '2025/2026-2')
            curr_id = cfg.get("verify_start_id", "")
            
            log(f"Fetching verifiable accounts from {curr_id or 'start'} (LIMIT 300) to protect database quota...")
            if curr_id:
                docs = pg_db.query("SELECT * FROM students WHERE matric > %s ORDER BY matric LIMIT 300", (curr_id,))
            else:
                docs = pg_db.query("SELECT * FROM students ORDER BY matric LIMIT 300")
                
            if not docs and curr_id:
                pg_db.execute("UPDATE system_config SET verify_start_id = '' WHERE id = 'config'")
                log("Reached the end of students database. Pointer reset to beginning.")
                return Response("\n".join(log_buffer), mimetype='text/plain', headers=headers)
                
            start_time = time.time()
            results = []
            tt_valid_count = 0
            login_valid_count = 0
            last_id = curr_id
            
            with ThreadPoolExecutor(max_workers=10) as ex:
                futures = {}
                try: req_s = get_authorized_session()
                except: req_s = None
                
                for d in docs:
                    if time.time() - start_time > 40: 
                        log("Timeout approaching. Stopping verification early.")
                        break
                    last_id = d['matric']
                    m = d['matric']
                    data = dict(d)
                    pwd = data.get('password')
                    
                    if (not pwd or pwd == 'Unknown') and req_s:
                        try:
                            bio = core_api.get_student_biodata(m, req_s)
                            if bio:
                                ic = bio.get('noKadPengenalan') or bio.get('noIc')
                                if ic: pwd = f"Unimas!{ic}"
                        except: pass
                        
                    futures[ex.submit(verify_and_save_student, m, data, pwd, active_sem)] = m
                    
                for f in as_completed(futures):
                    try: 
                        success, result_msg = f.result()
                        results.append(result_msg)
                        if success:
                            login_valid_count += 1
                            if "TT: True" in result_msg or "TT pass" in result_msg or "timetable_ready" in result_msg or "Verified" in result_msg:
                                tt_valid_count += 1
                    except Exception as e: 
                        pass

            if last_id: pg_db.execute("UPDATE system_config SET verify_start_id = %s WHERE id = 'config'", (last_id,))
            log(f"Batch Range: {curr_id or 'START'} -> {last_id}")
            log(f"Processed {len(results)} accounts with existing passwords.")
            log(f"Results: {login_valid_count} Valid Logins | {tt_valid_count} Valid+Timetable.")
            save_sys_log("MANUAL VERIFY", "SUCCESS", len(results))
            return Response("\n".join(log_buffer), mimetype='text/plain', headers=headers)
        except Exception as e:
            traceback.print_exc()
            save_sync_log("VERIFY", "ERROR", log_buffer + [str(e)], 0)
            return Response(f"Error: {str(e)}", status=500, headers=headers)

    elif path == '/admin_dashboard' and request.method == 'POST':
        try:
            data = request.get_json()
            if data.get('key') != ADMIN_SECRET_KEY: return jsonify({"error": "Unauthorized"}), 401
            req_type = data.get('type')
            cfg = get_sys_config()
            if req_type == 'get_data':
                logs = []
                for l in pg_db.query("SELECT * FROM logs ORDER BY timestamp DESC LIMIT 150"):
                    ld = dict(l); ld['id'] = str(ld.get('timestamp', '')); logs.append(ld)
                jobs = []
                for j in pg_db.query("SELECT * FROM autoscan_jobs"):
                    jd = dict(j); jd['id'] = f"{jd['matric']}_{jd['gid']}"; jobs.append(jd)
                banned = [d['ip'] for d in pg_db.query("SELECT ip FROM banned_ips")]
                ip_meta = {d['ip']: d['name'] for d in pg_db.query("SELECT ip, name FROM ip_metadata")}
                
                auto_accounts = []
                for s in pg_db.query("SELECT matric, password FROM students WHERE timetable_ready = true AND password IS NOT NULL AND password != 'Unknown'"):
                    auto_accounts.append({"matric": s['matric'], "password": s['password']})
                auto_accounts.sort(key=lambda x: int(x['matric']) if str(x['matric']).isdigit() else 0, reverse=True)

                def json_serial(obj):
                    if isinstance(obj, (datetime, datetime)): return obj.isoformat()
                    raise TypeError("Type %s not serializable" % type(obj))

                return Response(json.dumps({
                    "config": cfg, "logs": logs, "jobs": jobs, "banned_ips": banned, 
                    "ip_meta": ip_meta, "auto_accounts": auto_accounts
                }, default=json_serial), headers=headers)
            
            elif req_type == 'save_settings':
                fields, values = [], []
                if data.get('last_scanned') is not None: fields.append('last_scanned_id = %s'); values.append(int(data['last_scanned']))
                if data.get('act_start_id') is not None: fields.append('act_last_scanned_id = %s'); values.append(int(data['act_start_id']))
                if data.get('act_months'): fields.append('act_time_threshold = %s'); values.append(int(data['act_months']))
                
                if 'priority_courses' in data: fields.append('priority_courses = %s'); values.append(data['priority_courses'])
                if 'system_matric' in data: fields.append('system_matric = %s'); values.append(data['system_matric'])
                if 'system_pwd' in data: fields.append('system_pwd = %s'); values.append(data['system_pwd'])
                if 'verify_start_id' in data: fields.append('verify_start_id = %s'); values.append(data['verify_start_id'])
                
                if fields:
                    pg_db.execute(f"UPDATE system_config SET {', '.join(fields)} WHERE id = 'config'", tuple(values))
                return jsonify({"status": "Settings Saved"})
                
            elif req_type == 'delete_all_jobs':
                pg_db.execute("TRUNCATE autoscan_jobs")
                return jsonify({"status": "Deleted all jobs"})
                
            elif req_type == 'delete_single_job':
                j_parts = data.get('job_id').split('_')
                if len(j_parts) == 2:
                    pg_db.execute("DELETE FROM autoscan_jobs WHERE matric = %s AND gid = %s", (j_parts[0], j_parts[1]))
                return jsonify({"status": "Deleted"})
                
            elif req_type == 'trigger_jobs':
                job_category = data.get('job_category', 'autoscan')
                out_logs = [f"--- MANUAL TRIGGER: {job_category.upper()} ---"]
                req_session = get_authorized_session()
                now_my = get_malaysia_time()
                today_str = now_my.strftime('%Y-%m-%d')
                
                if job_category == 'autoscan':
                    jobs = list(pg_db.query("SELECT * FROM autoscan_jobs"))
                    out_logs.append(f"Found {len(jobs)} active autoscan jobs.")
                    for j in jobs:
                        matric = j['matric']; target = j.get('gid', '')
                        t = j.get('job_type', 'class')
                        if t == 'class':
                            res = core_api.scan_qr(target, matric, req_session)
                            out_logs.append(f"[{matric}] Class {target}: {res[:60]}")
                        else:
                            r1 = core_api.scan_activity_qr(target, matric, 'i')
                            out_logs.append(f"[{matric}] Act {target} CI: {r1[:60]}")
                else:
                    jobs = list(pg_db.query("SELECT * FROM auto_register_jobs"))
                    out_logs.append(f"Found {len(jobs)} auto-register jobs.")
                    sem = cfg.get('current_semester', '2025/2026-2')
                    for j in jobs:
                        matric = j['matric']; gid = j['gid']
                        stud = pg_db.query_one("SELECT password FROM students WHERE matric = %s", (matric,))
                        if stud:
                            pwd = stud.get('password')
                            course = pg_db.query_one("SELECT code, course_group FROM courses WHERE id = %s", (str(gid),))
                            code = course.get('code', 'Unknown') if course else 'Unknown'
                            grp = course.get('course_group', '') if course else ''
                            if pwd and pwd != 'Unknown':
                                st, rp = core_api.register_course(matric, pwd, code, str(gid), sem, grp, "P")
                                out_logs.append(f"[{matric}] AR {code} {grp}: {rp[:60]}")
                            else:
                                out_logs.append(f"[{matric}] AR {code}: No Password")
                
                save_job_log(job_category, "SUCCESS", len(jobs))
                return jsonify({"log": "\n".join(out_logs)})
                
            elif req_type == 'ban_ip':
                ip, act = data.get('ip'), data.get('action')
                if act == 'ban': 
                    pg_db.execute("INSERT INTO banned_ips (ip) VALUES (%s) ON CONFLICT DO NOTHING", (ip,))
                else: 
                    pg_db.execute("DELETE FROM banned_ips WHERE ip = %s", (ip,))
                return jsonify({"status": "ok"})
                
            elif req_type == 'set_ip_name':
                pg_db.execute("INSERT INTO ip_metadata (ip, name) VALUES (%s, %s) ON CONFLICT (ip) DO UPDATE SET name = EXCLUDED.name", (data.get('ip'), data.get('name')))
                return jsonify({"status": "Saved"})
            
            elif req_type == 'delete_device_logs':
                target_id = data.get('target_id')
                pg_db.execute("DELETE FROM banned_ips WHERE ip = %s", (target_id,))
                pg_db.execute("DELETE FROM system_logs WHERE message LIKE %s OR message LIKE %s", (f"%{target_id}%", f"%{target_id}%"))
                pg_db.execute("DELETE FROM logs WHERE ip = %s OR device_id = %s", (target_id, target_id))
                return jsonify({"status": "Device logs cleared & unbanned"})
        except Exception as e:
            traceback.print_exc()
            return jsonify({"error": str(e)}), 500

    return jsonify({"error": "Endpoint Not Found"}), 404

if __name__ == '__main__':
    app.run()