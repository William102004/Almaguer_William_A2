import os
from functools import lru_cache

from dotenv import load_dotenv
from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import create_engine, text

load_dotenv()
url = os.environ["DATABASE_URL"].replace("postgresql://", "postgresql+psycopg://", 1)
engine = create_engine(url, pool_pre_ping=True) 

app = FastAPI(title="WA EV Dashboard API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.environ.get("ALLOWED_ORIGINS", "http://localhost:5173").split(","),
    allow_methods=["GET"],
    allow_headers=["*"],
)

def query(sql: str, params: dict | None = None) -> list[dict]:
    with engine.connect() as con:
        return [dict(r._mapping) for r in con.execute(text(sql), params or {})]

def where(county=None, make=None, ev_type=None, year_min=None, year_max=None):
    conds, params = [], {}
    if county:
        conds.append("county = :county"); params["county"] = county
    if make:
        conds.append("make_group = :make"); params["make"] = make
    if ev_type in ("BEV", "PHEV"):
        conds.append("ev_type = :ev_type"); params["ev_type"] = ev_type
    if year_min is not None:
        conds.append("year_bin >= :year_min"); params["year_min"] = year_min
    if year_max is not None:
        conds.append("year_bin <= :year_max"); params["year_max"] = year_max
    return ("WHERE " + " AND ".join(conds)) if conds else "", params

@app.get("/health")
def health():
    query("SELECT 1")
    return {"ok": True}

@lru_cache                  
def _cube():
    return query("""
        SELECT county, year_bin, make_group, ev_type, COUNT(*) AS n
        FROM vehicles
        GROUP BY county, year_bin, make_group, ev_type
    """)

@app.get("/api/cube")
def cube():
    return _cube()


@app.get("/api/geo")
def geo():
    with engine.connect() as con:
        return con.execute(text("SELECT topojson FROM geo WHERE name = 'wa_counties'")).scalar_one()

@app.get("/api/cities")
def cities(make: str | None = None, ev_type: str | None = None,
           year_min: int | None = None, year_max: int | None = None):
    w, p = where(make=make, ev_type=ev_type, year_min=year_min, year_max=year_max)
    return query(f"""
        WITH coords AS (
            SELECT city, county, AVG(lon) AS lon, AVG(lat) AS lat
            FROM vehicles GROUP BY city, county
        )
        SELECT city, county, c.lon, c.lat, COUNT(*) AS n
        FROM vehicles v JOIN coords c USING (city, county)
        {w}
        GROUP BY city, county, c.lon, c.lat
        ORDER BY n DESC
    """, p)

@app.get("/api/models")
def models(make: str, county: str | None = None, ev_type: str | None = None,
           year_min: int | None = None, year_max: int | None = None,
           limit: int = Query(10, ge=1, le=30)):
    w, p = where(county=county, make=make, ev_type=ev_type, year_min=year_min, year_max=year_max)
    return query(f"""
        SELECT make, model, COUNT(*) AS n
        FROM vehicles {w}
        GROUP BY make, model
        ORDER BY n DESC
        LIMIT :limit
    """, {**p, "limit": limit})