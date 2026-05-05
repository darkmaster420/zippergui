# Zipper GUI

Simple Dockerized web app that lets you select a folder and zip it in the background.

## Features

- Folder tree UI to choose a folder under mounted `/data`
- Background zip jobs with status tracking and cancellation
- Persisted job history in `jobs.json`
- Automatic retention cleanup for old zip files
- Download completed zip files from UI
- Docker and docker-compose ready

## Run with Docker Compose

1. Put folders you want to zip inside `./data`.
2. Start:

```bash
docker compose up --build
```

3. Open [http://localhost:3000](http://localhost:3000).
4. Completed zips are written to `./output`.

## Run without Docker

```bash
npm install
npm start
```

Then open `http://localhost:3000`.

## API Endpoints

- `GET /api/folders` - list available folders under `ZIP_ROOT`
- `POST /api/jobs` - create job `{ "sourceRelativePath": "my-folder" }`
- `GET /api/jobs` - list all jobs
- `GET /api/jobs/:id` - get one job
- `DELETE /api/jobs/:id` - cancel running/queued job
- `GET /api/download/:file` - download zip output

## Environment Variables

- `PORT` (default: `3000`)
- `ZIP_ROOT` (default: `/data`)
- `ZIP_OUTPUT_DIR` (default: `/output`)
- `MAX_BROWSE_DEPTH` (default: `5`)
- `JOB_STORE_PATH` (default: `/output/jobs.json`)
- `ZIP_RETENTION_DAYS` (default: `7`; in this repo compose file it is set to `0` so retention is disabled unless you enable it)
- `RETENTION_SCAN_MS` (default: `60000`)
