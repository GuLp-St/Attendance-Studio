import sys, os
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
import db_pgsql as pg_db

# Re-add priority_student_ids so the currently deployed Vercel code doesn't break.
# After deploying the new code (which uses priority_students), run drop_old_column.py to remove this.
try:
    pg_db.execute("ALTER TABLE system_config ADD COLUMN IF NOT EXISTS priority_student_ids TEXT[] DEFAULT '{}'")
    print("Re-added priority_student_ids: OK")
except Exception as e:
    print(f"Re-add: {e}")

print("Migration complete.")

