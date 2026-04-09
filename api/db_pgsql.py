import psycopg2
from psycopg2.extras import RealDictCursor
import json
import os
import time
import random
from contextlib import contextmanager
from urllib.parse import urlparse, parse_qsl, urlencode, urlunparse

SUPABASE_POSTGRES_URL = os.environ.get("SUPABASE_POSTGRES_URL")
if not SUPABASE_POSTGRES_URL:
    # ✅ Transaction Mode: port 6543 — releases connections after each transaction
    SUPABASE_POSTGRES_URL = "postgres://postgres.gzbprvnzaxknqbpxzifa:TTksSjMC4WYgaCXM@aws-1-ap-southeast-1.pooler.supabase.com:6543/postgres?sslmode=require"

# Sanitize DSN to remove the unsupported 'supa' parameter added by newer Supabase pooler connection strings
parsed_url = urlparse(SUPABASE_POSTGRES_URL)
clean_query = urlencode([(k, v) for k, v in parse_qsl(parsed_url.query) if k != 'supa'])
SUPABASE_POSTGRES_URL = urlunparse(parsed_url._replace(query=clean_query))

from psycopg2.pool import ThreadedConnectionPool

# Small pool per serverless invocation — transaction mode handles concurrency at the pooler level
# so we don't need large per-process pools (they'd exhaust the server-side limit faster)
_pool = None

def _get_pool():
    global _pool
    if _pool is None or _pool.closed:
        _pool = ThreadedConnectionPool(1, 3, SUPABASE_POSTGRES_URL)
    return _pool

@contextmanager
def get_db():
    """Acquire a DB connection with retry + jitter backoff on pool exhaustion."""
    max_attempts = 5
    for attempt in range(max_attempts):
        try:
            pool = _get_pool()
            conn = pool.getconn()
            conn.autocommit = True
            try:
                yield conn
            except psycopg2.OperationalError:
                # Broken connection — drop it and recreate pool next time
                _pool = None
                pool.putconn(conn, close=True)
                raise
            else:
                pool.putconn(conn)
            return
        except psycopg2.pool.PoolError:
            # Pool exhausted — wait with exponential backoff + jitter then retry
            if attempt < max_attempts - 1:
                wait = (2 ** attempt) * 0.1 + random.uniform(0, 0.1)
                time.sleep(wait)
            else:
                raise

def query(sql, params=()):
    with get_db() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(sql, params)
            if cur.description:
                return cur.fetchall()
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

