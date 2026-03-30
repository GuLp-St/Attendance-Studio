# --- START OF FILE index.py ---

import sys
import os
import time
import threading

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
from decimal import Decimal

# ==========================================
#  JOB LOCK & STATUS (in-process, per job type)
# ==========================================
_JOB_TYPES = ['class', 'student', 'activity', 'verify', 'autojobs']
_job_locks = {t: threading.Lock() for t in _JOB_TYPES}
_job_status = {t: {'running': False, 'lines': [], 'lock': threading.Lock()} for t in _JOB_TYPES}

def _job_start(job_type):
    """Returns True if lock acquired (job can run). False if already running."""
    if not _job_locks[job_type].acquire(blocking=False):
        return False
    with _job_status[job_type]['lock']:
        _job_status[job_type]['running'] = True
        _job_status[job_type]['lines'] = []
    return True

def _job_log(job_type, msg):
    ts = (datetime.now(timezone.utc) + timedelta(hours=8)).strftime('%H:%M:%S')
    line = f"[{ts}] {msg}"
    with _job_status[job_type]['lock']:
        _job_status[job_type]['lines'].append(line)
    return line

def _job_end(job_type):
    with _job_status[job_type]['lock']:
        _job_status[job_type]['running'] = False
    try:
        _job_locks[job_type].release()
    except RuntimeError:
        pass

def json_serial(obj):
    if isinstance(obj, (datetime, datetime)):
        return obj.isoformat()
    if isinstance(obj, timedelta):
        return str(obj)
    if isinstance(obj, Decimal):
        return float(obj)
    raise TypeError("Type %s not serializable" % type(obj))

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
        "priority_student_ids": conf.get("priority_students", []),
        "system_matric": conf.get("system_matric", ""),
        "system_pwd": conf.get("system_pwd", ""),
        "force_student_sync": conf.get("force_student_sync", False),
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

def save_sync_log(log_type_key, status, messages, items_count):
    """Saves a sync log and trims to keep only top 10 per category."""
    try:
        # Map job type keys to log_type + category for DB storage
        _type_map = {
            'CLASS': ('SYNC', 'CLASS'), 'STUDENT': ('SYNC', 'STUDENT'),
            'ACTIVITY': ('SYNC', 'ACTIVITY'), 'VERIFY': ('SYS', 'VERIFY'),
            'MANUAL VERIFY': ('SYS', 'VERIFY')
        }
        db_log_type, db_category = _type_map.get(log_type_key, ('SYNC', log_type_key))
        pg_db.execute(
            "INSERT INTO logs (timestamp, log_type, category, status, log_text, items_found) VALUES (%s, %s, %s, %s, %s, %s)",
            (get_malaysia_time(), db_log_type, db_category, status, "\n".join(messages), items_count)
        )
        # Trim: keep only 10 most recent rows per (log_type, category)
        pg_db.execute("""
            DELETE FROM logs WHERE id IN (
                SELECT id FROM logs WHERE log_type = %s AND category = %s
                ORDER BY timestamp DESC OFFSET 10
            )
        """, (db_log_type, db_category))
    except: pass

def save_sys_log(action, status, items_processed):
    try:
        pg_db.execute(
            "INSERT INTO logs (timestamp, log_type, action, status, items_processed) VALUES (%s, %s, %s, %s, %s)",
            (get_malaysia_time(), "SYS", action, status, items_processed)
        )
    except: pass

def save_job_log(category, status, items_processed, log_text=""):
    try:
        pg_db.execute(
            "INSERT INTO logs (timestamp, log_type, category, status, items_processed, log_text) VALUES (%s, %s, %s, %s, %s, %s)",
            (get_malaysia_time(), "JOB", category, status, items_processed, log_text)
        )
        pg_db.execute("""
            DELETE FROM logs WHERE id IN (
                SELECT id FROM logs WHERE log_type = 'JOB' AND category = %s
                ORDER BY timestamp DESC OFFSET 10
            )
        """, (category,))
    except: pass

# ==========================================
#  TELEGRAM HELPERS
# ==========================================

def ensure_telegram_tables():
    """Create telegram tables if they don't exist yet."""
    try:
        pg_db.execute("""
            CREATE TABLE IF NOT EXISTS telegram_settings (
                matric TEXT PRIMARY KEY,
                chat_id TEXT,
                enabled BOOLEAN DEFAULT TRUE,
                features JSONB DEFAULT '{}',
                created_at TIMESTAMP DEFAULT NOW()
            )
        """)
        pg_db.execute("""
            ALTER TABLE system_config ADD COLUMN IF NOT EXISTS telegram_bot_token TEXT
        """)
        pg_db.execute("""
            ALTER TABLE system_config ADD COLUMN IF NOT EXISTS telegram_bot_username TEXT
        """)
    except: pass

def get_telegram_bot_config():
    """Returns (token, username) from system_config."""
    try:
        row = pg_db.query_one("SELECT telegram_bot_token, telegram_bot_username FROM system_config WHERE id = 'config'")
        if row:
            return row.get('telegram_bot_token', ''), row.get('telegram_bot_username', '')
    except: pass
    return '', ''

def send_telegram_message(chat_id, text, reply_markup=None, parse_mode='HTML', message_id=None, append_menu=True):
    """Send or edit a message via Telegram Bot API. Returns True on success."""
    token, _ = get_telegram_bot_config()
    if not token or not chat_id:
        return False
        
    if append_menu:
        main_menu = [
            {"text": "📅 Timetable", "callback_data": "/timetable"},
            {"text": "⚙️ Config", "callback_data": "/config"},
            {"text": "🌐 Open App", "url": "https://no-class.vercel.app"}
        ]
        
        if reply_markup is None:
            reply_markup = {"inline_keyboard": [main_menu]}
        elif isinstance(reply_markup, dict) and 'inline_keyboard' in reply_markup:
            reply_markup['inline_keyboard'].append(main_menu)

    try:
        payload = {'chat_id': chat_id, 'text': text, 'parse_mode': parse_mode}
        if message_id:
            payload['message_id'] = message_id
            endpoint = 'editMessageText'
        else:
            endpoint = 'sendMessage'
            
        if reply_markup:
            payload['reply_markup'] = json.dumps(reply_markup)
        r = requests.post(
            f'https://api.telegram.org/bot{token}/{endpoint}',
            json=payload, timeout=10
        )
        return r.status_code == 200
    except:
        return False

def get_user_telegram(matric):
    """Returns telegram_settings row for a matric or None."""
    try:
        ensure_telegram_tables()
        return pg_db.query_one("SELECT * FROM telegram_settings WHERE matric = %s AND enabled = TRUE", (matric,))
    except:
        return None

def notify_telegram_autojob(matric, title, status, details, mode):
    """Send autojob result notification to user's Telegram if enabled."""
    try:
        ts = get_user_telegram(matric)
        if not ts or not ts.get('chat_id'): return
        features = ts.get('features') or {}
        if isinstance(features, str):
            try: features = json.loads(features)
            except: features = {}
        if not features.get('notify_autojobs', True): return
        emoji = '✅' if status == 'SUCCESS' else '❌'
        mode_str = mode.upper().replace('_', ' • ') if mode else 'AUTO'
        msg = (f"{emoji} <b>AutoScan {status}</b>\n"
               f"<b>{title}</b>\n"
               f"Mode: {mode_str}\n"
               f"<code>{details[:200]}</code>")
        send_telegram_message(ts['chat_id'], msg)
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
        pg_db.execute("UPDATE students SET password = 'Unknown', last_verified = %s WHERE matric = %s", (get_malaysia_time(), m))
        return False, f"{m}: Cached as Unverified"

    bio = core_api.spc_fetch(f"api/v1/biodata/personal-v2/{m}", m, pwd)
    if not bio:
        pg_db.execute("UPDATE students SET password = 'Unknown', last_verified = %s WHERE matric = %s", (get_malaysia_time(), m))
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
        INSERT INTO students (matric, name, cgpa, program, password, faculty, intake_year, timetable_ready, last_verified)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (matric) DO UPDATE SET
            name = EXCLUDED.name, cgpa = EXCLUDED.cgpa, program = EXCLUDED.program,
            password = EXCLUDED.password, faculty = EXCLUDED.faculty,
            intake_year = EXCLUDED.intake_year, timetable_ready = EXCLUDED.timetable_ready, last_verified = EXCLUDED.last_verified
    """, (m, name, cgpa, prog, pwd, faculty, intake, is_timetableable, get_malaysia_time()))

    return True, f"{m}: Valid - CGPA {cgpa} - TT: {is_timetableable}"

# ==========================================
#  MAIN ROUTE HANDLER
# ==========================================

def send_telegram_timetable(chat_id, message_id=None):
    ensure_telegram_tables()
    # Send a temporary loading message if we have a message_id to edit (interactive button click) or start a new one
    temp_msg_id = message_id
    if message_id:
        send_telegram_message(chat_id, "⏳ Fetching your latest timetable...", message_id=message_id, append_menu=False)
        
    ts_row = pg_db.query_one("SELECT matric FROM telegram_settings WHERE chat_id = %s AND enabled = TRUE", (chat_id,))
    if not ts_row:
        send_telegram_message(chat_id, "❌ Not linked. Open Attendance Studio to connect your account.", message_id=temp_msg_id)
        return
    matric = ts_row['matric']
    stud = pg_db.query_one("SELECT name, groups FROM students WHERE matric = %s", (matric,))
    if not stud:
        send_telegram_message(chat_id, "❌ Could not find your account.", message_id=temp_msg_id)
        return
    name = stud.get('name', matric)
    group_ids = stud.get('groups') or []
    try:
        req_s = get_authorized_session()
        att_dict = {}
        master_slots = []
        for gid in group_ids:
            c = pg_db.query_one("SELECT code, name, course_group FROM courses WHERE id = %s", (gid,))
            if not c: continue
            try:
                sessions = core_api.get_sessions(gid, req_s) or []
                hist = core_api.get_student_history(matric, c['code'], gid, req_s) or []
                total = len(sessions)
                attended = sum(1 for h in hist if h.get('status') in ('P','M','L'))
                att_dict[gid] = f"{attended}/{total} ({int(attended/total*100)}%)" if total > 0 else "N/A"
            except:
                att_dict[gid] = "N/A"
            try:
                raw_slots = core_api.get_timetable(gid, req_s) or []
                for s in raw_slots:
                    if isinstance(s, dict) and s.get('KETERANGAN_HARI'):
                        master_slots.append({
                            'day': s['KETERANGAN_HARI'],
                            'start': s['MASA_MULA'],
                            'end': s['MASA_TAMAT'],
                            'code': c['code'],
                            'name': c.get('name') or s.get('NAMA_KURSUS_BI', ''),
                            'group': c.get('course_group') or s.get('KUMP_KULIAH', ''),
                            'loc': s.get('LOKASI') or s.get('RUANG') or s.get('KOD_RUANG') or None,
                            'group_id': gid
                        })
            except: pass
            
        final_slots = consolidate_timetable(master_slots)
        days = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"]
        d_map = {}
        for fs in final_slots:
            d = str(fs['day']).upper()
            if d not in d_map: d_map[d] = []
            d_map[d].append(fs)
        
        lines = [f"📅 <b>Timetable for {name}</b>\n<code>{matric}</code>"]
        for d in days:
            if d in d_map:
                lines.append(f"\n<b>━━ {d} ━━</b>")
                for fs in d_map[d]:
                    group_str = f"({fs['group']})" if fs.get('group') else ""
                    loc_str = f"📍 {fs['loc']}\n" if fs.get('loc') else ""
                    lines.append(f"🕐 {fs['start']} - {fs['end']}\n📚 <b>{fs['code']} {group_str}</b> [{att_dict.get(fs['group_id'])}]\n📖 {fs['name']}\n{loc_str}")
                    
        send_telegram_message(chat_id, "\n".join(lines), message_id=temp_msg_id)
    except Exception as e:
        send_telegram_message(chat_id, f"⚠️ Error fetching timetable: {str(e)[:100]}", message_id=temp_msg_id)

def send_telegram_config(chat_id, message_id=None):
    ts_row = pg_db.query_one("SELECT features FROM telegram_settings WHERE chat_id = %s", (chat_id,))
    if not ts_row:
        send_telegram_message(chat_id, "❌ Not linked.", message_id=message_id)
        return
    feats = ts_row.get('features') or {}
    if isinstance(feats, str):
        try: feats = json.loads(feats)
        except: feats = {}
    kb = {
        "inline_keyboard": [
            [{"text": f"{'✅' if feats.get('notify_autojobs', True) else '❌'} Auto-Job Notifications", "callback_data": "tg_feat_autojobs"}],
            [{"text": f"{'✅' if feats.get('notify_morning_schedule', False) else '❌'} Morning Schedule", "callback_data": "tg_feat_morning"}],
            [{"text": f"{'✅' if feats.get('notify_class_awareness', False) else '❌'} Class Awareness", "callback_data": "tg_feat_awareness"}],
            [{"text": "🛑 Disconnect Telegram", "callback_data": "/stop"}]
        ]
    }
    send_telegram_message(chat_id, "<b>⚙️ Notification Settings</b>\nTap a feature below to toggle it:", reply_markup=kb, message_id=message_id)


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
                # Global Directory for Search/Admin (No limit to stay dynamic per user request)
                students = pg_db.query("SELECT matric as m, name as n, 's' as t FROM students ORDER BY matric")
                courses = pg_db.query("SELECT MIN(id) as m, CONCAT(code, ' ', name) as n, 'c' as t FROM courses GROUP BY code, name ORDER BY m")
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
            }, default=json_serial), headers=headers)
        except Exception as e:
            traceback.print_exc()
            return jsonify({"error": str(e)}), 500

    elif path == '/search':
        query = args.get('q', '').strip()
        if len(query) < 2: return jsonify([])
        results = []
        try:
            q = f"%{query}%"
            # Fixed: Include grouped courses in results
            docs = pg_db.query("SELECT matric as m, name as n, 's' as t FROM students WHERE matric ILIKE %s OR name ILIKE %s LIMIT 10", (q, q))
            courses = pg_db.query("SELECT MIN(id) as m, CONCAT(code, ' ', name) as n, 'c' as t FROM courses WHERE code ILIKE %s OR name ILIKE %s GROUP BY code, name LIMIT 10", (q, q))
            results = list(docs) + list(courses)
        except: pass
        return Response(json.dumps(results, default=json_serial), headers=headers)

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

            active_autoscan = {}
            try:
                for j in pg_db.query("SELECT gid, mode FROM autoscan_jobs WHERE matric = %s AND status = 'pending'", (matric,)):
                    active_autoscan[j['gid']] = j.get('mode', 'crowd')
            except: pass

            active_auto_register = []
            try:
                for j in pg_db.query("SELECT a.gid, c.code, c.name, c.course_group FROM auto_register_jobs a JOIN courses c ON a.gid = c.id WHERE a.matric = %s", (matric,)):
                    active_auto_register.append({
                        "gid": str(j['gid']),
                        "code": j.get('code', 'Unknown'),
                        "name": j.get('name', ''),
                        "group": j.get('course_group', '')
                    })
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
                        info['autoscan_mode'] = active_autoscan.get(gid)
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
            }, default=json_serial), headers=headers)
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
            return Response(json.dumps(res, default=json_serial), headers=headers)
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
                # Use current semester courses timestamp update to trigger sync? No, just follow.
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
            elif d['type'] == 'clear_all_notifications':
                pg_db.execute("DELETE FROM notifications WHERE matric = %s", (d.get('matric'),))
                msg = "Notifications Cleared."
        except Exception as e: msg = str(e)
        return jsonify({"msg": msg})

    elif path == '/cron':
        try:
            start_time = time.time()
            req_session = get_authorized_session()
            now_my = get_malaysia_time()
            today_str = now_my.strftime('%Y-%m-%d')
            # Cleanup old logs (moved here to save a route)
            cutoff = now_my - timedelta(days=7)
            jobs = pg_db.query("SELECT * FROM autoscan_jobs")
            results = []
            def process_autoscan_job(job):
                d = dict(job)
                job_time = d.get('createdAt', d.get('created_at', d.get('createdat')))
                if job_time is None: job_time = now_my
                if isinstance(job_time, str): job_time = datetime.fromisoformat(job_time.replace("Z", "+00:00"))
                if job_time.tzinfo is None: job_time = job_time.replace(tzinfo=timezone.utc)
                
                if (now_my - job_time).total_seconds() > 86400:
                    create_notification(d['matric'], d.get('job_type','class'), d.get('gid', 'Unknown'), 'FAILED', 'Autoscan Expired (24h)', d.get('mode','crowd'))
                    pg_db.execute("DELETE FROM autoscan_jobs WHERE matric = %s AND gid = %s", (d['matric'], d['gid']))
                    return "Cleaned (Expired)"
                matric, target_id = d['matric'], str(d['gid'])
                raw_mode, j_type = d.get('mode', 'crowd'), d.get('job_type', 'class')
                
                # Extract trigger mode and automation mode
                mode_parts = str(raw_mode).split('_')
                trigger_mode = mode_parts[0]
                auto_mode = mode_parts[1] if len(mode_parts) > 1 else 'permanent'
                
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
                    if trigger_mode == 'crowd' and core_api.get_attendance_count(target['id'], req_session) >= 5: should_scan = True
                    elif trigger_mode == 'time':
                        try:
                            dt_end = datetime.strptime(f"{today_str} {target['endTime']}", "%Y-%m-%d %I:%M %p").replace(tzinfo=timezone(timedelta(hours=8)))
                            if (dt_end.timestamp() - 1200) <= now_my.timestamp(): should_scan = True
                        except: pass
                    
                    # If auto_mode is one time, do NOT unconditionally say True, it must still trigger on crowd/time.
                    # Wait, 'one time' means it waits for the trigger (crowd/time) just ONCE and then deletes itself.
                    # 'permanent' means it waits for trigger and keeps the job.
                    # So should_scan is completely dictated by trigger_mode!

                    if should_scan:
                        res = core_api.scan_qr(target['id'], matric, req_session)
                        is_success = ("Success" in res or "taken" in res.lower() or ("Server:" in res and "Server Error" not in res))
                        status = "SUCCESS" if is_success else "FAILED"
                        # Get course name for nicer notification
                        c_doc = pg_db.query_one("SELECT code, name, course_group FROM courses WHERE id = %s", (target_id,))
                        c_label = f"{c_doc['code']} {c_doc.get('course_group','')}" if c_doc else f"Class {target_id}"
                        create_notification(matric, 'class', c_label, status, res, raw_mode)
                        notify_telegram_autojob(matric, c_label, status, res, raw_mode)
                        
                        if auto_mode == 'onetime':
                            pg_db.execute("DELETE FROM autoscan_jobs WHERE matric = %s AND gid = %s", (matric, target_id))
                        return f"Attempted ({status})"
                    return f"Pending ({raw_mode})"
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
                    if trigger_mode == 'crowd':
                        stats = core_api.get_event_stats(target['id'], req_session)
                        if not is_ci and stats[0] >= 5: scan_ci = True
                        if is_ci and not is_co and req_co and stats[1] >= 5: scan_co = True
                    elif trigger_mode == 'time':
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
                        create_notification(matric, 'activity', target.get('name'), status, f"Check-In: {r}", raw_mode)
                        notify_telegram_autojob(matric, target.get('name','Activity'), status, f"Check-In: {r}", raw_mode)
                        if not req_co:
                            if auto_mode == 'onetime':
                                pg_db.execute("DELETE FROM autoscan_jobs WHERE matric = %s AND gid = %s", (matric, target_id))
                            return f"CI Attempted ({status}) - Job Deleted"
                        return f"CI Attempted ({status}) - Job Kept for CO"
                    if scan_co:
                        r = core_api.scan_activity_qr(target['id'], matric, 'o')
                        is_success = "Success" in r or ("Server:" in r and "Server Error" not in r)
                        status = "SUCCESS" if is_success else "FAILED"
                        create_notification(matric, 'activity', target.get('name'), status, f"Check-Out: {r}", raw_mode)
                        notify_telegram_autojob(matric, target.get('name','Activity'), status, f"Check-Out: {r}", raw_mode)
                        if auto_mode == 'onetime':
                            pg_db.execute("DELETE FROM autoscan_jobs WHERE matric = %s AND gid = %s", (matric, target_id))
                        return f"CO Attempted ({status}) - Job Deleted"
                    return f"Pending ({raw_mode})"
                return "Invalid Type"

            with ThreadPoolExecutor(max_workers=5) as ex:
                f_map = {ex.submit(process_autoscan_job, j): j for j in jobs if time.time() - start_time < 45}
                for f in as_completed(f_map):
                    try: results.append(f.result())
                    except Exception as e: results.append(f"Error: {str(e)}")

            # --- AUTO REGISTER JOBS ---
            ar_jobs = pg_db.query("SELECT * FROM auto_register_jobs")
            def process_auto_register_job(job):
                d = dict(job)
                matric, gid = d['matric'], str(d['gid'])
                job_time = d.get('createdAt', d.get('created_at', d.get('createdat')))
                if job_time is None: job_time = now_my
                if isinstance(job_time, str): job_time = datetime.fromisoformat(job_time.replace("Z", "+00:00"))
                if job_time.tzinfo is None: job_time = job_time.replace(tzinfo=timezone.utc)

                if (now_my - job_time).total_seconds() > 86400 * 7:
                    create_notification(matric, 'class', f'GID:{gid}', 'FAILED', 'Auto Register Expired (7d)', 'auto')
                    pg_db.execute("DELETE FROM auto_register_jobs WHERE matric = %s AND gid = %s", (matric, gid))
                    return "AR Expired"
                try:
                    course_doc = pg_db.query_one("SELECT code, course_group FROM courses WHERE id = %s", (gid,))
                    code, group = (course_doc.get('code', 'Unknown'), course_doc.get('course_group', '')) if course_doc else ('Unknown', '')
                    stud_doc = pg_db.query_one("SELECT password FROM students WHERE matric = %s", (matric,))
                    pwd = stud_doc.get('password') if stud_doc else ''
                    if not pwd or pwd == 'Unknown': return "AR Pending (No Password)"
                    sem = get_sys_config().get('current_semester', '2025/2026-2')
                    status_c, resp_c = core_api.register_course(matric, pwd, code, gid, sem, group, "P")
                    resp_str = str(resp_c).lower()
                    
                    is_success = ("berjaya" in resp_str or "success" in resp_str or '"error":false' in resp_str.replace(" ", ""))
                    # Treat "already registered" as success
                    if not is_success and ("sudah berdaftar" in resp_str or "already registered" in resp_str): is_success = True
                    
                    if not is_success and ("error\":true" in resp_str.replace(" ", "") or "taraf" in resp_str or "syarat" in resp_str):
                        status_c, resp_c = core_api.register_course(matric, pwd, code, gid, sem, group, "T")
                        resp_str = str(resp_c).lower()
                        is_success = ("berjaya" in resp_str or "success" in resp_str or '"error":false' in resp_str.replace(" ", ""))
                        if not is_success and ("sudah berdaftar" in resp_str or "already registered" in resp_str): is_success = True
                    
                    status = 'SUCCESS' if is_success else 'FAILED'
                    create_notification(matric, 'class', f'{code} {group}', status, f'Auto Register: {str(resp_c)[:80]}', 'auto')
                    if is_success:
                        pg_db.execute("UPDATE students SET groups = array_append(COALESCE(groups, '{}'), %s) WHERE matric = %s AND NOT (%s = ANY(COALESCE(groups, '{}')))", (gid, matric, gid))
                        pg_db.execute("DELETE FROM auto_register_jobs WHERE matric = %s AND gid = %s", (matric, gid))
                        return f"AR SUCCESS: {code} {group}"
                    return f"AR FAILED: {code} {group} - Response: {str(resp_c)[:100]}"
                except Exception as e: return f"AR Error: {str(e)}"
            with ThreadPoolExecutor(max_workers=5) as ex:
                ar_map = {ex.submit(process_auto_register_job, j): j for j in ar_jobs if time.time() - start_time < 45}
                for f in as_completed(ar_map):
                    try: results.append(f.result())
                    except Exception as e: results.append(f"AR Error: {str(e)}")
            # --- RESULTS AGGREGATION ---
            full_log = f"Jobs: {len(jobs)} | AR Jobs: {len(ar_jobs)} | Processed: {len(results)}\n" + "\n".join(results)
            save_job_log("autojobs", "SUCCESS", len(results), full_log)

            # --- TELEGRAM: MORNING SCHEDULE + CLASS AWARENESS ---
            try:
                ensure_telegram_tables()
                tg_users = pg_db.query("SELECT * FROM telegram_settings WHERE enabled = TRUE AND chat_id IS NOT NULL")
                is_morning_window = (now_my.hour == 0)  # midnight hour

                for tg in tg_users:
                    try:
                        tg_matric = tg['matric']
                        chat_id = tg['chat_id']
                        features = tg.get('features') or {}
                        if isinstance(features, str):
                            try: features = json.loads(features)
                            except: features = {}

                        stud = pg_db.query_one("SELECT name, groups FROM students WHERE matric = %s", (tg_matric,))
                        if not stud: continue
                        group_ids = stud.get('groups') or []
                        stud_name = stud.get('name', tg_matric)

                        # --- MORNING SCHEDULE ---
                        if features.get('notify_morning_schedule', True) and is_morning_window:
                            morning_lines = [f"🌅 <b>Good Morning, {stud_name}!</b>\nHere is your schedule for today:\n"]
                            has_classes = False
                            for gid in group_ids:
                                c_doc = pg_db.query_one("SELECT code, name, course_group FROM courses WHERE id = %s", (gid,))
                                if not c_doc: continue
                                try:
                                    slots = core_api.get_timetable(str(gid), req_session) or []
                                    day_map = {'AHAD':'Sunday','ISNIN':'Monday','SELASA':'Tuesday','RABU':'Wednesday','KHAMIS':'Thursday','JUMAAT':'Friday','SABTU':'Saturday'}
                                    today_day = now_my.strftime('%A').upper()
                                    day_my = {v.upper(): k for k, v in day_map.items()}
                                    today_bm = day_my.get(today_day, today_day)
                                    today_slots = [s for s in slots if isinstance(s, dict) and s.get('KETERANGAN_HARI', '').upper() == today_bm]
                                    if today_slots:
                                        has_classes = True
                                        slot = today_slots[0]
                                        code_label = f"{c_doc['code']} {c_doc.get('course_group','')}"
                                        time_str = f"{slot.get('MASA_MULA','')} - {slot.get('MASA_TAMAT','')}"
                                        loc = slot.get('LOKASI', '?')
                                        # Check if autoscan already active
                                        aj = pg_db.query_one("SELECT mode FROM autoscan_jobs WHERE matric = %s AND gid = %s", (tg_matric, str(gid)))
                                        if aj:
                                            morning_lines.append(f"📚 <b>{code_label}</b>\n🕐 {time_str} @ {loc}\n✅ AutoScan active ({aj['mode'].upper().replace('_',' • ')})\n")
                                        else:
                                            morning_lines.append(f"📚 <b>{code_label}</b>\n🕐 {time_str} @ {loc}\n")
                                            morning_lines.append(f"▸ Activate AutoScan?")
                                        # Inline buttons to activate autoscan
                                        keyboard = {"inline_keyboard": [[
                                            {"text": "✅ CROWD", "callback_data": f"autoscan_{tg_matric}_{gid}_crowd_onetime"},
                                            {"text": "⏰ L.MINUTE", "callback_data": f"autoscan_{tg_matric}_{gid}_time_onetime"}
                                        ]]} if not aj else None
                                        if keyboard:
                                            send_telegram_message(chat_id, "\n".join(morning_lines), reply_markup=keyboard)
                                            morning_lines = []  # reset for next course
                                except: pass
                            if morning_lines and has_classes:
                                send_telegram_message(chat_id, "\n".join(morning_lines))
                            elif not has_classes and is_morning_window:
                                send_telegram_message(chat_id, f"🌅 <b>Good Morning, {stud_name}!</b>\nNo classes scheduled for today. Have a great day! 🎉")

                        # --- CLASS AWARENESS ---
                        if features.get('notify_class_awareness', True):
                            for gid in group_ids:
                                c_doc = pg_db.query_one("SELECT code, name, course_group FROM courses WHERE id = %s", (gid,))
                                if not c_doc: continue
                                try:
                                    slots = core_api.get_timetable(str(gid), req_session) or []
                                    day_map = {'AHAD':'Sunday','ISNIN':'Monday','SELASA':'Tuesday','RABU':'Wednesday','KHAMIS':'Thursday','JUMAAT':'Friday','SABTU':'Saturday'}
                                    today_day = now_my.strftime('%A').upper()
                                    day_my = {v.upper(): k for k, v in day_map.items()}
                                    today_bm = day_my.get(today_day, today_day)
                                    today_slots = [s for s in slots if isinstance(s, dict) and s.get('KETERANGAN_HARI', '').upper() == today_bm]
                                    for slot in today_slots:
                                        try:
                                            dt_start = datetime.strptime(f"{today_str} {slot['MASA_MULA']}", "%Y-%m-%d %I:%M %p").replace(tzinfo=timezone(timedelta(hours=8)))
                                            mins_until = (dt_start.timestamp() - now_my.timestamp()) / 60
                                            if 25 <= mins_until <= 35:  # ~30min window
                                                code_label = f"{c_doc['code']} {c_doc.get('course_group','')}"
                                                loc = slot.get('LOKASI', '?')
                                                aj = pg_db.query_one("SELECT mode FROM autoscan_jobs WHERE matric = %s AND gid = %s", (tg_matric, str(gid)))
                                                if aj:
                                                    msg = (f"🔔 <b>Class Incoming!</b>\n<b>{code_label}</b>\n{c_doc.get('name','')}\n"
                                                           f"🕐 {slot['MASA_MULA']} @ {loc}\n"
                                                           f"✅ AutoScan is active ({aj['mode'].upper().replace('_',' • ')})")
                                                    send_telegram_message(chat_id, msg)
                                                else:
                                                    msg = (f"🔔 <b>Class Incoming!</b>\n<b>{code_label}</b>\n{c_doc.get('name','')}\n"
                                                           f"🕐 {slot['MASA_MULA']} @ {loc}\n"
                                                           f"⚠️ AutoScan not active. Activate?")
                                                    keyboard = {"inline_keyboard": [[
                                                        {"text": "✅ CROWD", "callback_data": f"autoscan_{tg_matric}_{gid}_crowd_onetime"},
                                                        {"text": "⏰ L.MINUTE", "callback_data": f"autoscan_{tg_matric}_{gid}_time_onetime"}
                                                    ]]}
                                                    send_telegram_message(chat_id, msg, reply_markup=keyboard)
                                        except: pass
                                except: pass
                    except: pass
            except: pass

            return Response(full_log, headers=headers)

        except Exception as e: return jsonify({"error": str(e)}), 500

    elif path == '/notifications':
        matric = args.get('matric')
        if request.method == 'GET':
            docs = pg_db.query("SELECT * FROM notifications WHERE matric = %s ORDER BY timestamp DESC", (matric,))
            res = [{"id": str(d.get('id', '')), **dict(d)} for d in docs]
            for r in res:
                if 'timestamp' in r and isinstance(r['timestamp'], datetime): r['timestamp'] = r['timestamp'].isoformat()
            return Response(json.dumps(res, default=json_serial), headers=headers)
        elif request.method == 'DELETE':
            nid = args.get('id'); pg_db.execute("DELETE FROM notifications WHERE id = %s", (nid,))
            return jsonify({"status": "deleted"})

    elif path == '/profile':
        try:
            req_session = get_authorized_session()
            data = core_api.get_student_biodata(args.get('matric'), req_session)
            if data: return Response(json.dumps(data, default=json_serial), headers=headers)
            else: return jsonify({"error": "No Data"}), 404
        except Exception as e: return jsonify({"error": str(e)}), 500

    elif path == '/cron_verify':
        try:
            cfg = get_sys_config()
            docs = pg_db.query("SELECT * FROM students ORDER BY last_verified ASC NULLS FIRST LIMIT 100")
            results, start_time, active_sem = [], time.time(), cfg.get('current_semester', '2025/2026-2')
            with ThreadPoolExecutor(max_workers=10) as ex:
                futures = {}
                try: req_s = get_authorized_session()
                except: req_s = None
                for d in docs:
                    if time.time() - start_time > 45: break
                    m, data, pwd = d['matric'], dict(d), d.get('password')
                    if (not pwd or pwd == 'Unknown') and req_s:
                        try:
                            bio = core_api.get_student_biodata(m, req_s)
                            if bio:
                                ic = bio.get('noKadPengenalan') or bio.get('noIc')
                                if ic: pwd = f"Unimas!{ic}"
                        except: pass
                    futures[ex.submit(verify_and_save_student, m, data, pwd, active_sem)] = m
            tt_valid, login_valid = 0, 0
            for f in as_completed(futures):
                try:
                    success, msg = f.result()
                    if success: login_valid += 1
                    if "TT: True" in msg: tt_valid += 1
                except: pass
            log_str = f"Processed: {len(futures)} | Valid Logins: {login_valid} | Valid+TT: {tt_valid} | Queue rotated."
            save_sync_log("VERIFY", "SUCCESS", [log_str], len(futures))
            return Response(json.dumps({"processed": len(futures), "details": log_str}, default=json_serial), headers=headers)
        except Exception as e:
            save_sync_log("VERIFY", "ERROR", [str(e)], 0)
            return jsonify({"error": str(e)}), 500

    elif path == '/student_details_proxy':
        m, pwd = args.get('matric'), args.get('password')
        if not pwd:
            doc = pg_db.query_one("SELECT password FROM students WHERE matric = %s", (m,))
            pwd = doc.get('password') if doc else None
            
        if not pwd or pwd == 'Unknown':
            try:
                # Use admin session to fetch normal biodata as fallback
                s = get_authorized_session()
                bio = core_api.get_student_biodata(m, s)
                if not bio: return jsonify({"error": "No valid password and fallback failed"}), 401
                
                # We return only what we have. Frontend should handle missing 'attendance', 'activities', etc.
                return Response(json.dumps({'biodata': bio}, default=json_serial), headers=headers)
            except Exception as e:
                return jsonify({"error": f"Fallback Error: {str(e)}"}), 500

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
            return Response(json.dumps(results, default=json_serial), headers=headers)
        except Exception as e: return jsonify({"error": str(e)}), 500

    elif path == '/directory_dump':
        try:
            # High-performance full directory dump for client-side filtering
            # Fetches only essential fields to minimize bandwidth.
            # Compressed m=matric, n=name, f=faculty, p=program, i=intake, c=cgpa, pw=password (for status check)
            sql = "SELECT matric as m, name as n, faculty as f, program as p, intake_year as i, cgpa as c, password as pw FROM students ORDER BY matric"
            data = pg_db.query(sql)
            return Response(json.dumps(list(data), default=json_serial), headers=headers)
        except Exception as e:
            return jsonify({"error": str(e)}), 500

    elif path == '/tools/details':
        query, q_type = args.get('q'), args.get('t')
        try:
            res = []
            if q_type == 'c':
                if query.isdigit():
                    c_rec = pg_db.query_one("SELECT code FROM courses WHERE id = %s", (query,))
                    docs = pg_db.query("SELECT * FROM courses WHERE code = %s", (c_rec['code'],)) if c_rec else []
                else: docs = pg_db.query("SELECT * FROM courses WHERE code = %s", (query,))
                for d in docs: res.append({"id": str(d['id']), "group": d.get('course_group'), "name": d.get('name'), "code": d.get('code'), "students": len(d.get('enrolled_students') or [])})
            elif q_type == 's':
                s_data = pg_db.query_one("SELECT * FROM students WHERE matric = %s", (query,))
                if s_data:
                    for gid in (s_data.get('groups') or []):
                        c_data = pg_db.query_one("SELECT * FROM courses WHERE id = %s", (gid,))
                        if c_data: res.append({"id": str(gid), "group": c_data.get('course_group'), "name": c_data.get('name'), "code": c_data.get('code'), "students": len(c_data.get('enrolled_students') or [])})
            return Response(json.dumps(res, default=json_serial), headers=headers)
        except Exception as e: return jsonify({"error": str(e)}), 500

    elif path == '/tools/timetable':
        gid = args.get('gid')
        try:
            req_s = get_authorized_session(); slots = core_api.get_timetable(gid, req_s)
            if not slots or not isinstance(slots, list): return Response(json.dumps({"error": "No Timetable"}, default=json_serial), headers=headers)
            day_map = {}
            for s in slots:
                if not isinstance(s, dict): continue
                d, st, en, lc = s.get('KETERANGAN_HARI', '').strip(), s.get('MASA_MULA', '').strip(), s.get('MASA_TAMAT', '').strip(), s.get('LOKASI', '').strip()
                if not d: continue
                day_map[(d, st, en, lc)] = True
            
            from collections import defaultdict
            grouped = defaultdict(list)
            for d, st, en, lc in day_map.keys(): grouped[(d, lc)].append([st, en])
            def p_time(t_str):
                try: return datetime.strptime(t_str, '%I:%M %p')
                except: return datetime.min
            
            merged_res = []
            for (d, lc), times in grouped.items():
                times.sort(key=lambda x: p_time(x[0]))
                merged = []
                for st, en in times:
                    if not merged: merged.append([st, en])
                    elif p_time(st) <= p_time(merged[-1][1]):
                        if p_time(en) > p_time(merged[-1][1]): merged[-1][1] = en
                    else: merged.append([st, en])
                for st, en in merged: merged_res.append(f"{d} {st}-{en} | {lc}")
            
            return Response(json.dumps({"timetable": " | ".join(merged_res) if merged_res else "No Timetable"}, default=json_serial), headers=headers)
        except: return Response(json.dumps({"timetable": "No Timetable"}, default=json_serial), headers=headers)

    elif path == '/tools/session_master':
        sid = args.get('sid')
        try:
            req_s = get_authorized_session(); logs = core_api.get_all_session_logs(sid, req_s)
            return Response(json.dumps(logs, default=json_serial), headers=headers)
        except Exception as e: return jsonify({"error": str(e)}), 500

    elif path == '/tools/roster':
        gid = args.get('gid')
        try:
            req_s = get_authorized_session(); students = core_api.get_students(gid, req_s)
            matrics = [s.get("NOMATRIK") for s in students if s.get("NOMATRIK")]
            pwd_map = {}
            if matrics:
                format_strings = ','.join(['%s'] * len(matrics))
                docs = pg_db.query(f"SELECT matric, password FROM students WHERE matric IN ({format_strings})", tuple(matrics))
                pwd_map = {d['matric']: d.get('password', '') for d in docs}
            roster = [{"matric": s.get("NOMATRIK"), "name": s.get("NAMAPELAJAR"), "password": pwd_map.get(s.get("NOMATRIK"), ''), "valid": bool(pwd_map.get(s.get("NOMATRIK"), ''))} for s in students]
            return Response(json.dumps(roster, default=json_serial), headers=headers)
        except Exception as e: return jsonify({"error": str(e)}), 500

    elif path == '/tools/validate' and request.method == 'POST':
        data = request.get_json()
        m, pwd, auto_fetch, initiator = data.get('matric'), data.get('password'), data.get('auto'), data.get('initiator', 'unknown')
        if auto_fetch:
            try:
                req_s = get_authorized_session(); bio = core_api.get_student_biodata(m, req_s)
                if bio:
                    ic = bio.get('noKadPengenalan') or bio.get('noIc')
                    if ic: pwd = f"Unimas!{ic}"
            except: pass
        if not pwd: return jsonify({"valid": False})
        if core_api.validate_login(m, pwd):
            active_sem = get_sys_config().get('current_semester', '2025/2026-2')
            try:
                student_doc = pg_db.query_one("SELECT * FROM students WHERE matric = %s", (m,))
                verify_and_save_student(m, dict(student_doc) if student_doc else {}, pwd, active_sem)
            except: pass
            pg_db.execute("UPDATE students SET password = %s WHERE matric = %s", (pwd, m))
            return jsonify({"valid": True, "password": pwd})
        else:
            if auto_fetch: pg_db.execute("INSERT INTO students (matric, password) VALUES (%s, %s) ON CONFLICT (matric) DO UPDATE SET password = EXCLUDED.password", (m, "Unknown"))
            return jsonify({"valid": False})

    elif path == '/tools/action' and request.method == 'POST':
        d = request.get_json()
        action, m, pwd, code, cid, group_name, initiator = d.get('action'), d.get('matric'), d.get('password'), d.get('code'), d.get('cid'), d.get('group_name', 'G01'), d.get('initiator', 'unknown')
        sem = get_sys_config().get('current_semester', '2025/2026-2')
        try:
            if not pwd:
                doc = pg_db.query_one("SELECT password FROM students WHERE matric = %s", (m,))
                pwd = doc.get('password') if doc else None
            if not pwd or pwd == 'Unknown': return jsonify({"needs_password": True})
            if action == "DROP":
                status, resp = core_api.drop_course(m, pwd, code, cid, sem)
                is_success = status == 200 and ("berjaya" in resp.lower() or "success" in resp.lower() or "gugur" in resp.lower())
                if is_success: pg_db.execute("UPDATE students SET groups = array_remove(groups, %s), password = %s WHERE matric = %s", (str(cid), pwd, m))
            else:
                status, resp = core_api.register_course(m, pwd, code, cid, sem, group_name, "P")
                is_success = status == 200 and ("berjaya" in resp.lower() or "success" in resp.lower())
                if not is_success and ("taraf" in resp.lower() or "syarat" in resp.lower()):
                    status, resp = core_api.register_course(m, pwd, code, cid, sem, group_name, "T")
                    is_success = status == 200 and ("berjaya" in resp.lower() or "success" in resp.lower())
                if is_success: pg_db.execute("UPDATE students SET groups = array_append(COALESCE(groups, '{}'), %s), password = %s WHERE matric = %s AND NOT (%s = ANY(COALESCE(groups, '{}')))", (str(cid), pwd, m, str(cid)))
            return jsonify({"status": status, "response": resp, "success": is_success})
        except Exception as e: return jsonify({"error": str(e)}), 500

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
                    docs = pg_db.query("SELECT id, code, name, semester, course_group AS group FROM courses WHERE (code = %s OR id = %s) AND semester = %s", (code, code, active_sem))
                    for d in docs:
                        target_courses.append(dict(d))
                        seen_gids.add(d['id'])
            
            # --- FETCH ALL COURSES, STALEST FIRST (no hard limit; timeout controls actual work done) ---
            courses_query = pg_db.query("SELECT id, code, name, semester, course_group AS group, last_student_sync FROM courses WHERE semester = %s ORDER BY last_student_sync ASC", (active_sem,))
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
                                        name = CASE WHEN EXCLUDED.name != 'Unknown' THEN EXCLUDED.name ELSE students.name END
                                """, tuple(params))

                        # 2. Get Diffs
                        old_rec = pg_db.query_one("SELECT enrolled_students FROM courses WHERE id = %s", (gid,))
                        previous_matrics = set(old_rec['enrolled_students'] if old_rec and old_rec['enrolled_students'] else [])
                        
                        added = list(current_matrics - previous_matrics)
                        removed = list(previous_matrics - current_matrics)
                        
                        if added or removed:
                            log(f"  [{c['code']}]: +{len(added)}, -{len(removed)} | {len(current_matrics)} total")
                            
                        # FORCE HEAL: Always ensure current students have the group in their array
                        if current_matrics:
                            pg_db.execute("UPDATE students SET groups = array_append(COALESCE(groups, '{}'), %s) WHERE matric = ANY(%s) AND NOT (%s = ANY(COALESCE(groups, '{}')))", (gid, list(current_matrics), gid))

                        # Remove group from students who dropped
                        if removed:
                            pg_db.execute("UPDATE students SET groups = array_remove(groups, %s) WHERE matric = ANY(%s)", (gid, removed))
                            
                            # Prune orphans in bulk
                            pg_db.execute("DELETE FROM students WHERE matric = ANY(%s) AND (groups IS NULL OR array_length(groups, 1) IS NULL OR array_length(groups, 1) = 0)", (removed,)) 

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
            # 1. DISCOVERY PHASE (max 28s so processing gets adequate time)
            while True:
                if time.time() - start_time > 28: 
                    log(f"Discovery paused. Stopped at ID {i}. Found {len(organizers)} organizers.")
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
            
            # Save progress from discovery immediately
            pg_db.execute("UPDATE system_config SET act_last_scanned_id = %s WHERE id = 'config'", (highest_valid_id,))
            
            # 2. PROCESSING PHASE (gets remaining ~27s)
            cutoff = datetime.now() - timedelta(days=30 * cfg['act_months'])
            processed = 0
            log(f"Processing {len(organizers)} organizers...")
            for org_id in organizers:
                if time.time() - start_time > 55:
                    log("Global timeout reached. Saving and stopping.")
                    break
                    
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
                
                # Use a generic name if biodata fetch is slow/missing
                name = f"Organizer {org_id}"
                try:
                    bio = core_api.get_student_biodata(org_id, req_session)
                    if bio: name = bio.get('NAMAPELAJAR') or bio.get('namaPelajar') or bio.get('Name') or name
                except: pass
                
                pg_db.execute("""
                    INSERT INTO organizers (id, name, last_active, activities)
                    VALUES (%s, %s, %s, %s)
                    ON CONFLICT (id) DO UPDATE SET 
                        name = EXCLUDED.name, 
                        last_active = EXCLUDED.last_active, 
                        activities = EXCLUDED.activities
                """, (str(org_id), name, latest, json.dumps(top10)))
                processed += 1
                
            log(f"Sync complete. Advanced pointer to {highest_valid_id}. Processed {processed} organizers.")
            save_sync_log("ACTIVITY", "SUCCESS", log_buffer, processed)
            return Response("\n".join(log_buffer), mimetype='text/plain', headers=headers)
        except Exception as e:
            traceback.print_exc()
            save_sync_log("ACTIVITY", "ERROR", log_buffer + [str(e)], 0)
            return Response(f"Error: {str(e)}", status=500, headers=headers)



    elif path == '/admin_verify_directory':
        if args.get('key') != ADMIN_SECRET_KEY: return jsonify({"error": "Unauthorized"}), 401
        log_buffer = []
        def log(msg): log_buffer.append(f"[{get_malaysia_time().strftime('%H:%M:%S')}] {msg}")
        try:
            log("Starting Directory Verification...")
            cfg = get_sys_config()
            active_sem = cfg.get('current_semester', '2025/2026-2')
            priority_ids = cfg.get('priority_student_ids', [])
            if priority_ids:
                log(f"Priority mode: {len(priority_ids)} student IDs will be verified first.")
                # Fetch priority students first, then the rest ordered by last_verified
                priority_placeholders = ','.join(['%s'] * len(priority_ids))
                docs = pg_db.query(
                    f"""SELECT * FROM students WHERE matric IN ({priority_placeholders}) """,
                    tuple(priority_ids)
                )
                rest = pg_db.query(
                    f"""SELECT * FROM students WHERE matric NOT IN ({priority_placeholders})
                        ORDER BY last_verified ASC NULLS FIRST LIMIT 300""",
                    tuple(priority_ids)
                )
                docs = list(docs) + list(rest)
            else:
                log("Fetching up to 300 of the least recently verified accounts...")
                docs = pg_db.query("SELECT * FROM students ORDER BY last_verified ASC NULLS FIRST LIMIT 300")
                
            start_time = time.time()
            results = []
            tt_valid_count = 0
            login_valid_count = 0
            last_id = None
            
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

            log(f"Processed {len(results)} accounts from the priority queue.")
            log(f"Results: {login_valid_count} Valid Logins | {tt_valid_count} Valid+Timetable.")
            save_sync_log("MANUAL VERIFY", "SUCCESS", log_buffer, len(results))
            return Response("\n".join(log_buffer), mimetype='text/plain', headers=headers)
        except Exception as e:
            traceback.print_exc()
            save_sync_log("VERIFY", "ERROR", log_buffer + [str(e)], 0)
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
                # Fixed: autoscan_jobs has no 'id' column. Use composite key.
                job_doc = pg_db.query_one("SELECT status, mode FROM autoscan_jobs WHERE matric = %s AND gid = %s", (matric, oid))
                data['autoscan_active'] = (job_doc and job_doc['status'] == 'pending')
                data['autoscan_mode'] = job_doc['mode'] if job_doc else None
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
            return Response(json.dumps(data, default=json_serial), headers=headers)
        except Exception as e: return jsonify({"error": str(e)}), 500

    elif path == '/admin_test_system_account':
        if args.get('key') != ADMIN_SECRET_KEY: return jsonify({"error": "Unauthorized"}), 401
        m, pwd = args.get('matric'), args.get('password')
        if not m or not pwd: return jsonify({"valid": False, "error": "Missing credentials"})
        
        is_valid = core_api.validate_login(m, pwd)
        if not is_valid: return jsonify({"valid": False, "error": "Invalid login credentials"})
        
        return jsonify({"valid": True})

    elif path == '/admin_job_status':
        """Polling endpoint for real-time job log updates."""
        if args.get('key') != ADMIN_SECRET_KEY: return jsonify({"error": "Unauthorized"}), 401
        job_type = args.get('type', 'class')
        offset = int(args.get('offset', 0))
        if job_type not in _job_status:
            return jsonify({"error": "Invalid type"}), 400
        with _job_status[job_type]['lock']:
            all_lines = list(_job_status[job_type]['lines'])
            running = _job_status[job_type]['running']
        new_lines = all_lines[offset:]
        return Response(json.dumps({
            "running": running, "lines": new_lines, "total": len(all_lines)
        }), headers={**headers, 'Content-Type': 'application/json'})

    elif path == '/admin_dashboard' and request.method == 'POST':
        try:
            data = request.get_json()
            if data.get('key') != ADMIN_SECRET_KEY: return jsonify({"error": "Unauthorized"}), 401
            req_type = data.get('type')
            cfg = get_sys_config()
            if req_type == 'get_data':
                # Structured logs per category (top 10 each)
                _cat_map = {
                    'class':    ("log_type = 'SYNC' AND category = 'CLASS'"),
                    'student':  ("log_type = 'SYNC' AND category = 'STUDENT'"),
                    'activity': ("log_type = 'SYNC' AND category = 'ACTIVITY'"),
                    'verify':   ("log_type = 'SYS' AND category = 'VERIFY'"),
                    'autojobs': ("log_type = 'JOB'"),
                }
                system_logs = {}
                for cat, where in _cat_map.items():
                    rows = pg_db.query(f"SELECT * FROM logs WHERE {where} ORDER BY timestamp DESC LIMIT 10")
                    system_logs[cat] = [dict(r) for r in rows]

                # User-action logs for network activity
                logs = []
                for l in pg_db.query("SELECT * FROM logs WHERE log_type = 'USER_ACTION' OR log_type IS NULL ORDER BY timestamp DESC LIMIT 100"):
                    ld = dict(l); ld['id'] = str(ld.get('timestamp', '')); logs.append(ld)
                jobs = []
                for j in pg_db.query("SELECT * FROM autoscan_jobs"):
                    jd = dict(j); jd['id'] = f"{jd['matric']}_{jd['gid']}"; jd['type'] = 'autoscan'; jobs.append(jd)
                for j in pg_db.query("SELECT *, 'register' as job_source FROM auto_register_jobs"):
                    jd = dict(j); jd['id'] = f"ar_{jd['matric']}_{jd['gid']}"; jd['type'] = 'register'
                    # Enrich with course code for display
                    course = pg_db.query_one("SELECT code, course_group FROM courses WHERE id = %s", (str(jd['gid']),))
                    if course: jd['code'] = course.get('code', ''); jd['group_id'] = course.get('course_group', '')
                    jobs.append(jd)
                banned = [d['ip'] for d in pg_db.query("SELECT ip FROM banned_ips")]
                ip_meta = {d['ip']: d['name'] for d in pg_db.query("SELECT ip, name FROM ip_metadata")}
                
                auto_accounts = []
                for s in pg_db.query("SELECT matric, password FROM students WHERE timetable_ready = true AND password IS NOT NULL AND password != 'Unknown'"):
                    auto_accounts.append({"matric": s['matric'], "password": s['password']})
                auto_accounts.sort(key=lambda x: int(x['matric']) if str(x['matric']).isdigit() else 0, reverse=True)

                # Also include current job running states
                job_running = {t: _job_status[t]['running'] for t in _JOB_TYPES}

                # Telegram users
                telegram_users = []
                try:
                    ensure_telegram_tables()
                    tg_rows = pg_db.query("SELECT matric, phone, chat_id, enabled, features, created_at FROM telegram_settings ORDER BY created_at DESC")
                    tg_token, tg_username = get_telegram_bot_config()
                    for r in tg_rows:
                        rd = dict(r)
                        feats = rd.get('features') or {}
                        if isinstance(feats, str):
                            try: feats = json.loads(feats)
                            except: feats = {}
                        rd['features'] = feats
                        telegram_users.append(rd)
                except: tg_token, tg_username = '', ''

                return Response(json.dumps({
                    "config": cfg, "logs": logs, "system_logs": system_logs,
                    "jobs": jobs, "banned_ips": banned, "ip_meta": ip_meta,
                    "auto_accounts": auto_accounts, "job_running": job_running,
                    "telegram_users": telegram_users,
                    "telegram_token": tg_token if 'tg_token' in dir() else '',
                    "telegram_username": tg_username if 'tg_username' in dir() else ''
                }, default=json_serial), headers=headers)
            
            elif req_type == 'save_settings':
                fields, values = [], []
                if data.get('last_scanned') is not None: fields.append('last_scanned_id = %s'); values.append(int(data['last_scanned']))
                if data.get('act_start_id') is not None: fields.append('act_last_scanned_id = %s'); values.append(int(data['act_start_id']))
                if data.get('act_months'): fields.append('act_time_threshold = %s'); values.append(int(data['act_months']))
                if 'priority_courses' in data: fields.append('priority_courses = %s'); values.append(data['priority_courses'])
                if 'priority_student_ids' in data: fields.append('priority_students = %s'); values.append(data['priority_student_ids'])
                if 'system_matric' in data: fields.append('system_matric = %s'); values.append(data['system_matric'])
                if 'system_pwd' in data: fields.append('system_pwd = %s'); values.append(data['system_pwd'])
                if 'telegram_token' in data: fields.append('telegram_bot_token = %s'); values.append(data['telegram_token'])
                if 'telegram_username' in data: fields.append('telegram_bot_username = %s'); values.append(data['telegram_username'])
                
                if fields:
                    pg_db.execute(f"UPDATE system_config SET {', '.join(fields)} WHERE id = 'config'", tuple(values))
                return jsonify({"status": "Settings Saved"})
                
            elif req_type == 'delete_all_jobs':
                pg_db.execute("TRUNCATE autoscan_jobs")
                pg_db.execute("TRUNCATE auto_register_jobs")
                return jsonify({"status": "Deleted all jobs"})
                
            elif req_type == 'delete_single_job':
                j_parts = data.get('job_id').split('_')
                if len(j_parts) == 2:
                    pg_db.execute("DELETE FROM autoscan_jobs WHERE matric = %s AND gid = %s", (j_parts[0], j_parts[1]))
                return jsonify({"status": "Deleted"})
                
            elif req_type == 'trigger_jobs':
                job_category = data.get('job_category', 'autoscan')
                if not _job_start('autojobs'):
                    return jsonify({"error": "An auto-job trigger is already in progress. Try again later."}), 409
                out_logs = [f"--- MANUAL TRIGGER: {job_category.upper()} ---"]
                _job_log('autojobs', f"Manual trigger: {job_category}")
                req_session = get_authorized_session()
                now_my = get_malaysia_time()
                today_str = now_my.strftime('%Y-%m-%d')
                
                if job_category == 'autoscan':
                    jobs = list(pg_db.query("SELECT * FROM autoscan_jobs"))
                    _job_log('autojobs', f"Found {len(jobs)} active autoscan jobs.")
                    for j in jobs:
                        matric = j['matric']; target = j.get('gid', '')
                        t = j.get('job_type', 'class')
                        if t == 'class':
                            res = core_api.scan_qr(target, matric, req_session)
                            _job_log('autojobs', f"[{matric}] Class {target}: {res[:80]}")
                        else:
                            r1 = core_api.scan_activity_qr(target, matric, 'i')
                            _job_log('autojobs', f"[{matric}] Act {target} CI: {r1[:80]}")
                else:
                    jobs = list(pg_db.query("SELECT * FROM auto_register_jobs"))
                    _job_log('autojobs', f"Found {len(jobs)} auto-register jobs.")
                    sem = cfg.get('current_semester', '2025/2026-2')
                    for j in jobs:
                        matric = j['matric']; gid = str(j['gid'])
                        job_time = j.get('createdAt', j.get('created_at', j.get('createdat')))
                        if job_time is None: job_time = now_my
                        stud = pg_db.query_one("SELECT password FROM students WHERE matric = %s", (matric,))
                        if stud:
                            pwd = stud.get('password')
                            course = pg_db.query_one("SELECT code, course_group FROM courses WHERE id = %s", (gid,))
                            code = course.get('code', 'Unknown') if course else 'Unknown'
                            grp = course.get('course_group', '') if course else ''
                            if pwd and pwd != 'Unknown':
                                st, rp = core_api.register_course(matric, pwd, code, gid, sem, grp, "P")
                                rp_str = str(rp).lower()
                                is_success = ("berjaya" in rp_str or "success" in rp_str or '"error":false' in rp_str.replace(" ", ""))
                                if not is_success and ("sudah berdaftar" in rp_str or "already registered" in rp_str): is_success = True
                                
                                if not is_success and ("error\":\"true" in rp_str.replace(" ", "") or "taraf" in rp_str or "syarat" in rp_str):
                                    st, rp = core_api.register_course(matric, pwd, code, gid, sem, grp, "T")
                                    rp_str = str(rp).lower()
                                    is_success = ("berjaya" in rp_str or "success" in rp_str or '"error":false' in rp_str.replace(" ", ""))
                                    if not is_success and ("sudah berdaftar" in rp_str or "already registered" in rp_str): is_success = True

                                status_str = 'SUCCESS' if is_success else 'FAILED'
                                _job_log('autojobs', f"[{matric}] AR {code} {grp}: {status_str} — {rp[:60]}")
                                if is_success:
                                    pg_db.execute("UPDATE students SET groups = array_append(COALESCE(groups, '{}'), %s) WHERE matric = %s AND NOT (%s = ANY(COALESCE(groups, '{}')))", (gid, matric, gid))
                                    pg_db.execute("DELETE FROM auto_register_jobs WHERE matric = %s AND gid = %s", (matric, gid))
                                    create_notification(matric, 'class', f'{code} {grp}', 'SUCCESS', f'Auto Register (Manual): {rp[:80]}', 'auto')
                                else:
                                    create_notification(matric, 'class', f'{code} {grp}', 'FAILED', f'Auto Register (Manual): {rp[:80]}', 'auto')
                            else:
                                _job_log('autojobs', f"[{matric}] AR {code}: No Password")
                
                _job_log('autojobs', f"Done. Processed {len(jobs)} jobs.")
                save_job_log(job_category, "SUCCESS", len(jobs), "\n".join(_job_status['autojobs']['lines']))
                _job_end('autojobs')
                return jsonify({"status": "ok", "count": len(jobs)})
                
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
                pg_db.execute("DELETE FROM logs WHERE ip = %s OR device_id = %s", (target_id, target_id))
                return jsonify({"status": "Device logs cleared & unbanned"})

            elif req_type == 'save_bot_token':
                token = data.get('token', '').strip()
                username = data.get('username', '').strip()
                ensure_telegram_tables()
                pg_db.execute("UPDATE system_config SET telegram_bot_token = %s, telegram_bot_username = %s WHERE id = 'config'", (token, username))
                return jsonify({"status": "Bot token saved"})

            elif req_type == 'delete_telegram_user':
                matric = data.get('matric')
                ensure_telegram_tables()
                pg_db.execute("DELETE FROM telegram_settings WHERE matric = %s", (matric,))
                return jsonify({"status": "Removed"})
        except Exception as e:
            traceback.print_exc()
            return jsonify({"error": str(e)}), 500

    # ==========================================
    #  TELEGRAM ENDPOINTS
    # ==========================================

    elif path == '/telegram/status':
        matric = args.get('matric')
        try:
            ensure_telegram_tables()
            ts = pg_db.query_one("SELECT * FROM telegram_settings WHERE matric = %s", (matric,))
            _, bot_username = get_telegram_bot_config()
            result = {
                "enabled": False, "chat_id": None,
                "features": {}, "bot_username": bot_username
            }
            if ts:
                feats = ts.get('features') or {}
                if isinstance(feats, str):
                    try: feats = json.loads(feats)
                    except: feats = {}
                result = {
                    "enabled": bool(ts.get('enabled')),
                    "chat_id": ts.get('chat_id'), "features": feats,
                    "bot_username": bot_username
                }
            return Response(json.dumps(result, default=json_serial), headers=headers)
        except Exception as e:
            traceback.print_exc()
            return jsonify({"error": str(e)}), 500

    elif path == '/telegram/setup' and request.method == 'POST':
        d = request.get_json() or {}
        matric = d.get('matric')
        try:
            ensure_telegram_tables()
            features = d.get('features', {})
            pg_db.execute("""
                INSERT INTO telegram_settings (matric, enabled, features, created_at)
                VALUES (%s, TRUE, %s, %s)
                ON CONFLICT (matric) DO UPDATE SET
                    enabled = TRUE,
                    features = EXCLUDED.features
            """, (matric, json.dumps(features), get_malaysia_time()))
            _, bot_username = get_telegram_bot_config()
            if bot_username:
                clean_uname = bot_username.lstrip('@')
                deep_link = f"tg://resolve?domain={clean_uname}&start={matric}"
            else:
                deep_link = None
            return jsonify({"status": "ok", "deep_link": deep_link})
        except Exception as e:
            return jsonify({"error": str(e)}), 500

    elif path == '/telegram/disable' and request.method == 'POST':
        d = request.get_json() or {}
        matric = d.get('matric')
        try:
            ensure_telegram_tables()
            pg_db.execute("UPDATE telegram_settings SET enabled = FALSE, chat_id = NULL WHERE matric = %s", (matric,))
            return jsonify({"status": "disabled"})
        except Exception as e:
            return jsonify({"error": str(e)}), 500

    elif path == '/telegram/webhook' and request.method == 'POST':
        """Receives Telegram Bot API updates."""
        try:
            update = request.get_json() or {}
            cb = update.get('callback_query')
            
            if cb:
                cb_id = cb.get('id')
                cb_data = cb.get('data', '')
                msg = cb.get('message', {})
                chat_id = str(msg.get('chat', {}).get('id', ''))
                
                token, _ = get_telegram_bot_config()
                if token and cb_id:
                    try: requests.post(f'https://api.telegram.org/bot{token}/answerCallbackQuery', json={'callback_query_id': cb_id}, timeout=5)
                    except: pass

                if cb_data.startswith('autoscan_'):
                    parts = cb_data.split('_', 3)
                    if len(parts) == 4:
                        _, matric, gid, mode = parts
                        try:
                            ensure_telegram_tables()
                            pg_db.execute(
                                "INSERT INTO autoscan_jobs (matric, gid, createdAt, status, mode, job_type) VALUES (%s, %s, %s, %s, %s, %s) ON CONFLICT (matric, gid) DO UPDATE SET status = EXCLUDED.status, mode = EXCLUDED.mode",
                                (matric, gid, get_malaysia_time(), 'pending', mode, 'class')
                            )
                            send_telegram_message(chat_id, f"✅ AutoScan activated for class <code>{gid}</code> in <b>{mode.upper().replace('_',' • ')}</b> mode.")
                        except Exception as e:
                            send_telegram_message(chat_id, f"❌ Could not activate autoscan: {str(e)[:80]}")
                            
                elif cb_data == '/timetable':
                    send_telegram_timetable(chat_id, message_id=msg.get('message_id'))
                    
                elif cb_data == '/config':
                    send_telegram_config(chat_id, message_id=msg.get('message_id'))
                    
                elif cb_data.startswith('tg_feat_'):
                    key_map = {'tg_feat_autojobs': 'notify_autojobs', 'tg_feat_morning': 'notify_morning_schedule', 'tg_feat_awareness': 'notify_class_awareness'}
                    feat_key = key_map.get(cb_data)
                    if feat_key:
                        ts_row = pg_db.query_one("SELECT features FROM telegram_settings WHERE chat_id = %s", (chat_id,))
                        if ts_row:
                            feats = ts_row.get('features') or {}
                            if isinstance(feats, str):
                                try: feats = json.loads(feats)
                                except: feats = {}
                            default = True if feat_key == 'notify_autojobs' else False
                            feats[feat_key] = not feats.get(feat_key, default)
                            pg_db.execute("UPDATE telegram_settings SET features = %s WHERE chat_id = %s", (json.dumps(feats), chat_id))
                            send_telegram_config(chat_id, message_id=msg.get('message_id'))

            elif update.get('message'):
                msg = update.get('message')
                chat_id = str(msg.get('chat', {}).get('id', ''))
                text = msg.get('text', '').strip()

                if text.startswith('/start'):
                    parts = text.split(' ', 1)
                    if len(parts) > 1:
                        matric = parts[1].strip()
                        ensure_telegram_tables()
                        row = pg_db.query_one("SELECT matric FROM telegram_settings WHERE matric = %s", (matric,))
                        if row:
                            pg_db.execute("UPDATE telegram_settings SET chat_id = %s WHERE matric = %s", (chat_id, matric))
                            stud = pg_db.query_one("SELECT name FROM students WHERE matric = %s", (matric,))
                            name = stud['name'] if stud else matric
                            send_telegram_message(chat_id,
                                f"✅ <b>Linked!</b>\nYour Attendance Studio account (<code>{matric}</code>) is now connected, <b>{name}</b>!\n\n"
                                f"Access your settings and schedule from the menu below! 👇")
                        else:
                            send_telegram_message(chat_id, "❌ Matric not found. Please enable Telegram in Attendance Studio first.")
                    else:
                        send_telegram_message(chat_id, "👋 Welcome to Attendance Studio Bot!\nOpen the app to link your account.")

                elif text == '/timetable':
                    send_telegram_timetable(chat_id)

                elif text == '/config':
                    send_telegram_config(chat_id)

                elif text == '/stop':
                    ensure_telegram_tables()
                    pg_db.execute("UPDATE telegram_settings SET enabled = FALSE, chat_id = NULL WHERE chat_id = %s", (chat_id,))
                    send_telegram_message(chat_id, "🔕 Telegram notifications disabled. You can re-enable from Attendance Studio.")


            return jsonify({"ok": True})
        except Exception as e:
            traceback.print_exc()
            return jsonify({"ok": True})  # Always 200 to Telegram

    return jsonify({"error": "Endpoint Not Found"}), 404


if __name__ == '__main__':
    app.run()