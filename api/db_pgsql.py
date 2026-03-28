import psycopg2
from psycopg2.extras import RealDictCursor
import json
import os
from contextlib import contextmanager

SUPABASE_POSTGRES_URL_NON_POOLING = os.environ.get("SUPABASE_POSTGRES_URL_NON_POOLING")
if not SUPABASE_POSTGRES_URL_NON_POOLING:
    # Switch to port 6543 for PgBouncer serverless connection pooler
    SUPABASE_POSTGRES_URL_NON_POOLING = "postgres://postgres.gzbprvnzaxknqbpxzifa:TTksSjMC4WYgaCXM@aws-1-ap-southeast-1.pooler.supabase.com:6543/postgres?sslmode=require"

from psycopg2.pool import ThreadedConnectionPool
pool = ThreadedConnectionPool(1, 12, SUPABASE_POSTGRES_URL_NON_POOLING)

@contextmanager
def get_db():
    conn = pool.getconn()
    conn.autocommit = True
    try:
        yield conn
    finally:
        pool.putconn(conn)

def query(sql, params=()):
    with get_db() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(sql, params)
            if cur.description:
                res = cur.fetchall()
                return res
    return []

def query_one(sql, params=()):
    res = query(sql, params)
    return res[0] if res else None

def execute(sql, params=()):
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params)
        conn.commit()
        
def execute_batch(sql, args_list):
    with get_db() as conn:
        with conn.cursor() as cur:
            psycopg2.extras.execute_batch(cur, sql, args_list)
        conn.commit()
