import sys
import os
sys.path.append(r"c:\Users\Administrator\Desktop\Attendance-Studio\api")
from core_api import spc_fetch
import urllib.parse
import requests

matric = "85699"
password = "Unimas!010914011427"
active_sem = "2025/2026-2"

print("Testing unencoded sem:")
res1 = spc_fetch(f"api/v1/course/student/{matric}?kodSesiSem={active_sem}", matric, password)
print("Result unencoded:", res1)

print("\nTesting encoded sem:")
encoded_sem = urllib.parse.quote(active_sem, safe='')
res2 = spc_fetch(f"api/v1/course/student/{matric}?kodSesiSem={encoded_sem}", matric, password)
print("Result encoded:", res2)

print("\nTesting without kodSesiSem to see if it works:")
res3 = spc_fetch(f"api/v1/course/student/{matric}", matric, password)
print("Result no sem:", res3)

# Let's do raw request to see the status code
import base64
s = requests.Session()
encoded = base64.b64encode(f"{matric}:{password}".encode()).decode()
s.headers.update({
    'Authorization': f'Basic {encoded}',
    'Content-Type': 'application/json',
    'User-Agent': 'Mozilla/5.0'
})
url = f"https://samarahan.unimas.my/studentportalcloud/api/v1/course/student/{matric}?kodSesiSem={active_sem}"
print("\nRaw request URL:", url)
r = s.get(url, timeout=10)
print("Status Code:", r.status_code)
print("Response text:", r.text)

url2 = f"https://samarahan.unimas.my/studentportalcloud/api/v1/course/student/{matric}?kodSesiSem={encoded_sem}"
print("\nRaw request URL encoded:", url2)
r2 = s.get(url2, timeout=10)
print("Status Code encoded:", r2.status_code)
print("Response text encoded:", r2.text)
