import sys
import os
sys.path.append(r"c:\Users\Administrator\Desktop\Attendance-Studio\api")
from core_api import configure_session
import requests
import base64

matric = "85699"
password = "Unimas!010914011427"
active_sem = "2025/2026-2"

endpoints = [
    f"api/v1/course/list/{matric}?kodSesiSem={active_sem}",
    f"api/v1/course/registered/{matric}?kodSesiSem={active_sem}",
    f"api/v1/course/student-course/{matric}?kodSesiSem={active_sem}",
    f"api/v1/course/{matric}?kodSesiSem={active_sem}",
    f"api/v1/course/student?matricNo={matric}&kodSesiSem={active_sem}",
    f"api/v1/course/list?matricNo={matric}",
]

s = requests.Session()
encoded = base64.b64encode(f"{matric}:{password}".encode()).decode()
s.headers.update({
    'Authorization': f'Basic {encoded}',
    'Content-Type': 'application/json',
    'User-Agent': 'Mozilla/5.0'
})

for ep in endpoints:
    url = f"https://samarahan.unimas.my/studentportalcloud/{ep}"
    print(f"\nTesting: {url}")
    try:
        r = s.get(url, timeout=5)
        print(f"Status: {r.status_code}")
        if r.status_code == 200:
            print(f"Response: {r.text[:200]}")
    except Exception as e:
        print(f"Error: {e}")
