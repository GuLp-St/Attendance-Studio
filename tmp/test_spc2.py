import sys
import os
sys.path.append(r"c:\Users\Administrator\Desktop\Attendance-Studio\api")
from core_api import spc_fetch
import urllib.parse
import requests
import base64

matric = "85699"
password = "Unimas!010914011427"
active_sem = "2025/2026-2"

endpoints = [
    f"api/v1/course/carry-mark/{matric}?kodSesiSem={active_sem}",
    f"api/v1/biodata/personal-v2/{matric}",
    f"api/v1/result/transcript/{matric}"
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
        r = s.get(url, timeout=10)
        print(f"Status Code: {r.status_code}")
        print(f"Response: {r.text[:200]}")
    except Exception as e:
        print(f"Error: {e}")

