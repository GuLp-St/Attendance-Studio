import sys
sys.path.append('c:/Users/Administrator/Desktop/Attendance-Studio/api')
from index import db

refs = [db.collection('system').document(f'dir_cache_{format(i, "x")}') for i in range(16)]
chunks = [doc for doc in db.get_all(refs) if doc.exists]
accounts = []
for c in chunks:
    for s in c.to_dict().get('students', {}).values():
        accounts.append((s.get('m'), s.get('pwd'), s.get('t'), type(s.get('t'))))

print('Total cache accounts:', len(accounts))
valid = [a for a in accounts if a[1] and a[1] != 'Unknown' and a[2] is True]
print('Valid accounts:', valid[:10])
print('Account 85699:', [a for a in accounts if a[0] == '85699'])
