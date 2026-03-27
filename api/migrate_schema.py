import sys, os
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
import db_pgsql as pg_db

try:
    pg_db.execute("ALTER TABLE system_config ADD COLUMN IF NOT EXISTS priority_student_ids TEXT[] DEFAULT '{}'")
    print("priority_student_ids column: OK")
except Exception as e:
    print(f"priority_student_ids: {e}")

try:
    pg_db.execute("ALTER TABLE logs ADD COLUMN IF NOT EXISTS log_text TEXT")
    print("logs.log_text column: OK")
except Exception as e:
    print(f"logs.log_text: {e}")

try:
    pg_db.execute("ALTER TABLE logs ADD COLUMN IF NOT EXISTS items_found INTEGER")
    print("logs.items_found column: OK")
except Exception as e:
    print(f"logs.items_found: {e}")

print("Migration complete.")
