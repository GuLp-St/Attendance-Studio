import sys
import os
sys.path.append(r"c:\Users\Administrator\Desktop\Attendance-Studio\api")
from core_api import configure_session
import requests

matric = "85699"
password = "Unimas!010914011427"

def check_timetable_access(username, password):
    try:
        s = requests.Session()
        configure_session(s, username, password)
        r = s.get("https://qr.unimas.my/atdcloud/api/class/v1/get/timetable/ug/class_id/82000", timeout=5)
        print("Status code:", r.status_code)
        print("Response text:", r.text[:200])
        return r.status_code == 200
    except Exception as e:
        print("Error:", e)
        return False

print("Check access:", check_timetable_access(matric, password))
