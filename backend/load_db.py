import json
import os
import re

import pandas as pd
from dotenv import load_dotenv
from sqlalchemy import create_engine, text

load_dotenv()
DATABASE_URL = os.environ["DATABASE_URL"]
EV_CSV = "data/ev_population.csv"
GEO_INFO = "data/counties-10m.json"
CORE = {"King", "Pierce", "Snohomish"}

def clean_EV() -> pd.DataFrame:
    df = pd.read_csv(EV_CSV, low_memory=False)
    log = [("Raw rows", len(df))]

    df = df[["DOL Vehicle ID","County", "City", "State",  "Model Year" , "Make", "Model", "Electric Vehicle Type",  "Vehicle Location"]].copy()
    df.columns=[ "vehicle_id","county", "city", "state", "model_year", "make", "model", "ev_type", "location"]

    for c in ["county", "city", "make", "model"]:
        df[c] = df[c].str.strip()
        df["county"] = df["county"].str.title()
        df["city"] = df["city"].str.title()
        df["make"] = df["make"].str.upper()

        df = df[df["state"] == "WA"];
        log.append(("Washington State Only", len(df)))

        xy = df["location"].str.extract(r"POINT \(([-\d.]+) ([-\d.]+)\)")
        df["lon"] = pd.to_numeric(xy[0], errors="coerce")
        df["lat"] = pd.to_numeric(xy[1], errors="coerce")
        df = df.dropna(subset=["lon", "lat"])
        log.append(("Has a location", len(df)))

        df = df.drop_duplicates(subset="vehicle_id");
        df =df.dropna(subset=["county","city","model_year", "make", "model", "ev_type"])
        log.append(("No rows with missing required fields are allowed", len(df)))

        df["model_year"] = df["model_year"].astype(int)
        df["year_bin"] = df["model_year"].clip(lower=2010)       
        df["ev_type"] = df["ev_type"].str.extract(r"\((\w+)\)", expand=False)
        top10 = df["make"].value_counts().head(10).index
        df["make_group"] = df["make"].where(df["make"].isin(top10), "OTHER")
        df["core"] = df["county"].isin(CORE)

        df = df[["vehicle_id", "county", "core", "city", "model_year", "year_bin", "make","make_group", "model", "ev_type", "lon", "lat"]]

        print("Cleaning steps:")
        for step, n in log:
            print(f"  {step:<28}{n:>9,}")
        print(f"  Pre-2011 vehicles grouped   {(df['model_year'] < 2011).sum():>9,}")
        return df


def load_geo_data() -> dict:
    topo = json.load(open(GEO_INFO))
    geoms = [g for g in topo["objects"]["counties"]["geometries"]
             if str(g["id"]).startswith("53")]

    def walk(arcs, fn):
        return [walk(a, fn) if isinstance(a, list) else fn(a) for a in arcs]

    used = set()
    for g in geoms:
        walk(g["arcs"], lambda i: used.add(i if i >= 0 else ~i))
    remap = {old: new for new, old in enumerate(sorted(used))}
    for g in geoms:
        g["arcs"] = walk(g["arcs"], lambda i: remap[i] if i >= 0 else ~remap[~i])

    topo["arcs"] = [topo["arcs"][i] for i in sorted(used)]
    topo["objects"] = {"counties": {"type": "GeometryCollection", "geometries": geoms}}
    topo.pop("bbox", None)
    print(f"Map: {len(geoms)} counties")
    return topo


def check_counties(vehicles, topo):
    on_map = {g["properties"]["name"] for g in topo["objects"]["counties"]["geometries"]}
    missing = set(vehicles["county"]) - on_map
    if missing:
        print(f"  WARNING: counties not on the map: {sorted(missing)}")
    else:
        print("All county names match the map.")

def copy_table(con, name: str, df: pd.DataFrame):
    df.head(0).to_sql(name, con, if_exists="replace", index=False)
    raw = con.connection.driver_connection
    with raw.cursor().copy(f"COPY {name} ({', '.join(df.columns)}) FROM STDIN") as cp:
        for row in df.astype(object).where(df.notna(), None).itertuples(index=False):
            cp.write_row(row)


def main():
    vehicles = clean_EV()
    topo = load_geo_data()
    check_counties(vehicles, topo)

    url = re.sub(r"^postgres(ql)?://", "postgresql+psycopg://", DATABASE_URL)
    engine = create_engine(url)
    with engine.begin() as con:
        copy_table(con, "vehicles", vehicles)
        con.execute(text("ALTER TABLE vehicles ADD PRIMARY KEY (vehicle_id)"))
        for col in ["county", "model_year", "make_group", "ev_type"]:
            con.execute(text(f"CREATE INDEX idx_vehicles_{col} ON vehicles ({col})"))

        con.execute(text("DROP TABLE IF EXISTS geo"))
        con.execute(text("CREATE TABLE geo (name text PRIMARY KEY, topojson jsonb NOT NULL)"))
        con.execute(text("INSERT INTO geo VALUES ('wa_counties', CAST(:t AS jsonb))"),
                    {"t": json.dumps(topo)})
        con.execute(text("ANALYZE"))
    print(f"Loaded {len(vehicles):,} vehicles and the map into the database.")


if __name__ == "__main__":
    main()