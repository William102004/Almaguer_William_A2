# Washington State Electric Vehicle Adoption Dashboard

**Live site:** https://William102004.github.io/Almaguer_William_A2/

> The backend runs on Render's free tier, so the first load may take up to a minute. If the charts don't appear, wait a moment and reload.

## Architecture and File Structure

| Frontend in HTML, CSS, D3.js v7 hosted on GitHub Pages 
| Backend in Python, FastAPI hosted on Render
| Database in PostgreSQL hosted on Neon 

```
Almaguer_William_A2/
├── README.md
├── SanityCheck.ipynb          Data sanity check (missing values, duplicates, ranges)
├── backend/
│   ├── main.py                FastAPI app (API endpoints)
│   ├── load_db.py             Cleans the CSV and loads it into PostgreSQL
│   ├── requirements.txt       Python dependencies
│   └── data/
│       ├── ev_population.csv          full dataset (downloaded in step 4)
│       └── counties-10m.json          county boundaries (downloaded in step 4)
└── frontend/
    ├── index.html
    ├── css/
    │   └── style.css
    └── js/
        └── script.js
```

## Running locally

### Prerequisites

- **Python 3.10 or newer**: `python3 --version`
- **PostgreSQL 14 or newer**: `psql --version`
  - macOS: `brew install postgresql@16 && brew services start postgresql@16`
  - Windows / Linux: https://www.postgresql.org/download/
- **Git**

### 1. Clone the repository

```bash
git clone https://github.com/William102004/Almaguer_William_A2.git
cd Almaguer_William_A2
```

### 2. Create the database

```bash
createdb evdb
```

If `createdb` isn't found, or PostgreSQL uses the `postgres` user with a password (common on Windows and Linux):

```bash
psql -U postgres -c "CREATE DATABASE evdb;"
```

### 3. Set up the Python environment

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

### 4. Download the data

The full dataset is too large to commit, so download it:

```bash
curl -L -o data/ev_population.csv "https://data.wa.gov/api/v3/views/f6w7-q2d2/export.csv?accessType=DOWNLOAD"
curl -L -o data/counties-10m.json https://cdn.jsdelivr.net/npm/us-atlas@3/counties-10m.json
```

If the download fails, use the included sample: `cp data/sample_ev_population.csv data/ev_population.csv`

### 5. Configure environment variables

Create a file named `backend/.env` containing:

```
DATABASE_URL=postgresql://localhost:5432/evdb
ALLOWED_ORIGINS=http://localhost:5173
```

If your PostgreSQL uses a username and password:

```
DATABASE_URL=postgresql://postgres:<your-password>@localhost:5432/evdb
```

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `ALLOWED_ORIGINS` | Frontend origin(s) allowed by CORS, comma-separated |

### 6. Load the data into PostgreSQL

```bash
python load_db.py
```

The output should end with: `Loaded 299,344 vehicles and the map into the database.`

### 7. Start the backend (port 8000)

```bash
uvicorn main:app --reload --port 8000
```

Leave this terminal running. Interactive API docs: http://localhost:8000/docs

### 8. Start the frontend (port 5173)

In a **second terminal**, from the repository root:

```bash
cd frontend
python3 -m http.server 5173
```

### 9. Open the dashboard

Go to **http://localhost:5173**.

Use `localhost`, not `127.0.0.1`: the backend only allows `http://localhost:5173` through CORS. The frontend detects `localhost` and calls the local API automatically.

## API endpoints

| Endpoint | Returns |
|---|---|
| `GET /api/cube` | Vehicle counts by county × model year × make × EV type (~10,000 rows) |
| `GET /api/geo` | Washington county boundaries (TopoJSON) |
| `GET /api/cities` | Vehicle counts and positions per city for the current filters |
| `GET /api/models` | Top models for the selected make and filters |
| `GET /health` | Database connection check |


## Data sources

- Washington State Department of Licensing, [Electric Vehicle Population Data](https://catalog.data.gov/dataset/electric-vehicle-population-data), downloaded October 21, 2026.
- [us-atlas](https://github.com/topojson/us-atlas) county boundaries, derived from U.S. Census Bureau cartographic boundary files.
