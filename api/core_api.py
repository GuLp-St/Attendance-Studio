# functions/core_api.py
import hashlib
import requests
import time
import base64
import random
import string
from datetime import datetime, time as dt_time

# --- CONFIGURATION ---
STATIC_APP_PASS = "Unimas@2016_04W7130933"

# ==========================================
#  AUTHENTICATION HELPERS
# ==========================================

def validate_login(username, password):
    """Checks if credentials work by hitting a secure endpoint."""
    try:
        s = requests.Session()
        configure_session(s, username, password)
        # Check a known endpoint. Valid auth returns 200, invalid returns 401/403.
        r = s.get("https://qr.unimas.my/atdcloud/api/class/v1/get/timetable/ug/class_id/82000", timeout=5)
        return r.status_code == 200
    except: return False

def configure_session(s, username, password):
    """Injects Admin Basic Auth into a requests Session."""
    creds = f"{username}:{password}"
    encoded = base64.b64encode(creds.encode('utf-8')).decode('utf-8')
    
    s.headers.update({
        'Authorization': f'Basic {encoded}',
        'User-Agent': 'Mozilla/5.0',
        'Origin': 'https://qr.unimas.my',
        'Referer': 'https://qr.unimas.my/attendance/class/index.html'
    })
    return s

# ==========================================
#  DATA READS (CLASS / STUDENT)
# ==========================================

def get_active_semester(s):
    """Fetches the current active semester code (e.g., 2024/2025-1)."""
    try:
        r = s.get("https://qr.unimas.my/atdcloud/api/semester/UG?flag=semaktif", timeout=5)
        if r.status_code == 200:
            data = r.json()
            if data and isinstance(data, list):
                return data[0].get("ssemKodSesisem")
    except: pass
    return None

def get_group_info(group_id, s):
    try:
        r = s.get(f"https://qr.unimas.my/atdcloud/api/class/v1/get/info/ug/{group_id}", timeout=5)
        if r.status_code == 200 and r.json():
            d = r.json()[0]
            return {
                "id": str(group_id), 
                "code": d.get("KOD_KURSUS"), 
                "name": d.get("NAMA_KURSUS_BI"), 
                "group": d.get("KUMP_KULIAH"), 
                "semester": d.get("SESI_SEMESTER")
            }
    except: pass
    return None

def get_students(group_id, s):
    try: return s.get(f"https://qr.unimas.my/atdcloud/api/class/v1/get/student/ug?classId={group_id}", timeout=10).json()
    except: return []

def get_timetable(group_id, s):
    try: return s.get(f"https://qr.unimas.my/atdcloud/api/class/v1/get/timetable/ug/class_id/{group_id}", timeout=5).json()
    except: return []

def get_sessions(group_id, s):
    try: return s.get(f"https://qr.unimas.my/atdcloud/api/class_attendance/class_id/ug/{group_id}", timeout=8).json()
    except: return []

def get_student_history(matric, course_code, group_id, s):
    try:
        url = f"https://qr.unimas.my/atdcloud/api/class_attendance/logs/username/{matric}/course_code/{course_code}?classId={group_id}"
        return s.get(url, timeout=8).json()
    except: return []

def get_log(session_id, matric, s):
    try:
        ts = int(time.time() * 1000)
        url = f"https://qr.unimas.my/atdcloud/api/class_attendance/{session_id}/logs?studCategory=ug&page=0&size=999&_t={ts}"
        logs = s.get(url, timeout=5).json()
        return next((l for l in logs if l.get("matricNo") == str(matric)), None)
    except: return None

def get_attendance_count(session_id, s):
    """Counts total 'Present' students for a class session."""
    try:
        ts = int(time.time() * 1000)
        url = f"https://qr.unimas.my/atdcloud/api/class_attendance/{session_id}/logs?studCategory=ug&page=0&size=999&_t={ts}"
        r = s.get(url, timeout=10)
        if r.status_code == 200:
            data = r.json()
            if isinstance(data, list):
                return sum(1 for entry in data if entry.get('status') == 'P')
        return 0
    except: return 0

def get_student_biodata(matric, s):
    try:
        r = s.get(f"https://acsa2.unimas.my/courseregcloud/api/students/biodata/{matric}", timeout=10)
        if r.status_code == 200: return r.json()
    except: pass
    return None

# ==========================================
#  ACTIVITY / EVENT READS
# ==========================================

def get_activity_details(event_id, s):
    try:
        r = s.get(f"https://qr.unimas.my/qrcloud/api/event/{event_id}", timeout=5)
        if r.status_code == 200: return r.json()
    except: pass
    return None

def get_organizer_events(user_id, s):
    """Fetches all events created by a specific user ID."""
    try:
        url = f"https://qr.unimas.my/qrcloud/api/event/list/user_id/{user_id}?page=0&size=999"
        r = s.get(url, timeout=10)
        if r.status_code == 200:
            data = r.json()
            if isinstance(data, dict) and 'content' in data: return data['content']
            if isinstance(data, list): return data
    except: pass
    return []

def get_activity_log(event_id, matric, s):
    """Finds a specific student log in an activity."""
    try:
        r = s.get(f"https://qr.unimas.my/qrcloud/api/event/{event_id}/logs/list", timeout=5)
        if r.status_code == 200:
            data = r.json()
            # Handle mixed API responses (List vs Nested Dict)
            if isinstance(data, list):
                for entry in data:
                    if entry.get('account', {}).get('username') == str(matric): return entry
            elif isinstance(data, dict) and 'content' in data:
                for row in data['content']:
                    if isinstance(row, list):
                        for entry in row:
                            if entry.get('account', {}).get('username') == str(matric): return entry
                    elif isinstance(row, dict):
                        if row.get('account', {}).get('username') == str(matric): return row
    except: pass
    return None

def get_event_stats(event_id, s):
    """Returns tuple (check_in_count, check_out_count) for an activity."""
    try:
        r = s.get(f"https://qr.unimas.my/qrcloud/api/event/{event_id}/logs/list", timeout=5)
        ci, co = 0, 0
        if r.status_code == 200:
            data = r.json()
            rows = []
            # Normalize data structure
            if isinstance(data, list): rows = data
            elif isinstance(data, dict) and 'content' in data:
                for sub in data['content']:
                    if isinstance(sub, list): rows.extend(sub)
                    elif isinstance(sub, dict): rows.append(sub)
            
            for row in rows:
                if row.get('checkInTime'): ci += 1
                if row.get('checkOutTime'): co += 1
        return ci, co
    except: return 0, 0

# ==========================================
#  ACTIONS (Write Operations)
# ==========================================

# --- CLASS ACTIONS ---

def get_stable_device_id(matric):
    # Create a consistent 16-char hex string based on the matric number
    hash_object = hashlib.md5(str(matric).encode())
    hex_hash = hash_object.hexdigest()[:16]
    return f"androidid{hex_hash}"

def scan_qr(class_id, matric, s=None):
    try:
        # 1. Use Session to fetch BX (Admin Auth)
        if not s: return "Error: Auth Session Missing"
        
        bx_r = s.get(f"https://qr.unimas.my/qrcloud/api/event/get/server_time_map?eid={class_id}&ct={int(time.time()*1000)}")
        bx = bx_r.json().get("bxVal")
        if not bx: return "No active QR code."
        
        # 2. Use Static Pass for Scan (User Auth)
        auth = "Basic " + base64.b64encode(f"{matric}:{STATIC_APP_PASS}".encode()).decode()
        dev_id = get_stable_device_id(matric) 
        
        r = requests.post("https://qr.unimas.my/broker/api/log/ATD-CL", 
                          headers={'Authorization': auth, 'User-Agent': 'okhttp/4.12.0'}, 
                          params={'o': 'i', 'x': bx, 'username': matric, 'h': dev_id, 'n': '0'}, 
                          timeout=10)
        
        resp = r.json()
        payload = resp.get('payload', {})
        
        # Return exact server message for feedback
        if 'message' in payload: return f"Server: {payload['message']}"
        return f"Server: {str(resp)}"
        
    except Exception as e: return str(e)

def manual_attendance(session_id, matric, status, s, remark=None):
    try:
        params = {'eventId': session_id, 'username': matric, 'status': status}
        if remark: params['remark'] = remark
        r = s.post("https://qr.unimas.my/atdcloud/api/class_attendance/check/absent", params=params, timeout=10)
        if r.status_code == 200: return "Success"
        return f"Failed ({r.status_code}): {r.text}"
    except Exception as e: return str(e)

def delete_attendance(log_id, s):
    try:
        r = s.delete(f"https://qr.unimas.my/atdcloud/api/class_attendance/logs/id/{log_id}", timeout=10)
        if r.status_code == 200: return "Deleted"
        return f"Failed: {r.text}"
    except: return "Error"

# --- ACTIVITY ACTIONS ---

def scan_activity_qr(event_id, matric, op_mode):
    """
    op_mode: 'i' (Check In) or 'o' (Check Out)
    Note: Activity Scan uses local logic to generate codes, does not need Admin Session.
    """
    try:
        # 1. Generate Auth
        random_pass = ''.join(random.choices(string.ascii_letters + string.digits, k=8))
        auth_str = f"{matric}:{random_pass}"
        auth_token = "Basic " + base64.b64encode(auth_str.encode('utf-8')).decode('utf-8')

        # 2. Generate EXP Token (Midnight)
        today = datetime.now().date()
        midnight = datetime.combine(today, dt_time.min)
        exp_token_ms = int(midnight.timestamp() * 1000)

        # 3. Generate BX
        dt_obj = datetime.fromtimestamp(exp_token_ms / 1000)
        fmt_time = dt_obj.strftime('%Y%m%d%H%M%S')
        raw_data = f"code={event_id}&exp={fmt_time}"
        bx_val = base64.b64encode(raw_data.encode('utf-8')).decode('utf-8')

        dev_id = get_stable_device_id(matric) 

        headers = { 'Authorization': auth_token, 'User-Agent': 'okhttp/4.12.0' }
        params = { 'o': op_mode, 'x': bx_val, 'username': matric, 'h': dev_id, 'n': '0' }
        
        r = requests.post("https://qr.unimas.my/broker/api/log/ATD-AC", headers=headers, params=params, timeout=15)
        
        resp = r.json()
        payload = resp.get("payload", {})
        
        # Return exact server message
        if isinstance(payload, dict) and 'message' in payload:
             return f"Server: {payload['message']}"
        
        if isinstance(payload, dict) and "exception" in payload: 
            return f"Server Error: {payload['exception']}"

        return f"Server: {str(resp)}"

    except Exception as e: return f"Error: {str(e)}"

def manual_activity(event_id, matric, type_code, s):
    try:
        url = f"https://qr.unimas.my/qrcloud/api/event/check/manual"
        params = {'eventId': event_id, 'username': matric, 'type': type_code}
        r = s.post(url, params=params, timeout=10)
        if r.status_code == 200: return "Success"
        return f"Failed: {r.text}"
    except Exception as e: return str(e)

def delete_activity_log(log_id, s):
    try:
        url = f"https://qr.unimas.my/qrcloud/api/event/delete/logs/{log_id}"
        r = s.delete(url, timeout=10)
        if r.status_code == 200: return "Deleted"
        return f"Failed: {r.text}"
    except Exception as e: return str(e)