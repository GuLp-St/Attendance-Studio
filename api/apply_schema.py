import os
import psycopg2

SUPABASE_POSTGRES_URL_NON_POOLING = "postgres://postgres.gzbprvnzaxknqbpxzifa:TTksSjMC4WYgaCXM@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres?sslmode=require"
SCHEMA_FILE = r"C:\Users\Administrator\.gemini\antigravity\brain\4dbafa17-52d9-4e74-96f9-5e0dfaad1907\supabase_schema.sql"

def apply_schema():
    print("Connecting to Supabase PostgreSQL...")
    conn = psycopg2.connect(SUPABASE_POSTGRES_URL_NON_POOLING)
    conn.autocommit = True
    cursor = conn.cursor()
    
    with open(SCHEMA_FILE, 'r') as f:
        sql = f.read()
    
    print("Applying schema...")
    try:
        cursor.execute(sql)
        print("Schema applied successfully!")
    except Exception as e:
        print(f"Error applying schema: {e}")
    finally:
        cursor.close()
        conn.close()

if __name__ == "__main__":
    apply_schema()
