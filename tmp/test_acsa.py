import sys
import os
import requests
import base64

matric = "85699"
password = "Unimas!010914011427"
active_sem = "2025/2026-2"

endpoints = [
    f"api/course-registration/{matric}",
    f"api/course-registration/list/{matric}",
    f"api/course-registration/student/{matric}",
    f"api/course-registration/student-course/{matric}",
    f"api/course-registration/registered-course/{matric}",
    f"api/course-registration/add-course/{matric}",
    f"api/students/biodata/{matric}",
]

s = requests.Session()
encoded = base64.b64encode(f"{matric}:{password}".encode()).decode()
s.headers.update({
    'Authorization': f'Basic {encoded}',
    'Content-Type': 'application/json',
    'User-Agent': 'Mozilla/5.0'
})

for ep in endpoints:
    url = f"https://acsa2.unimas.my/courseregcloud/{ep}"
    print(f"\nTesting: {url}")
    try:
        r = s.get(url, timeout=5)
        print(f"Status: {r.status_code}")
        if r.status_code == 200:
            print(f"Response: {r.text[:200]}")
    except Exception as e:
        print(f"Error: {e}")
