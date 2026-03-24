import firebase_pg as firestore

db = firestore.client()
print("Mock init start...")

db.collection('system').document('config').set({'start_id': 1}, merge=True)
doc = db.collection('system').document('config').get()
print("Config:", doc.to_dict())

db.collection('students').document('12345').set({'name': 'Test Student', 'groups': []})
print("Student:", db.collection('students').document('12345').get().to_dict())

db.collection('students').document('12345').update({'groups': firestore.ArrayUnion(['G1'])})
print("Updated student groups:", db.collection('students').document('12345').get().to_dict()['groups'])
print("Test completed successfully.")
