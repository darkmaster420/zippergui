# Zipper GUI

Web UI + API for creating ZIP archives from server-side folders in the background.

Designed to run in Docker so you can mount a folder, pick subfolders from the UI, queue jobs, and download finished zip files.

## Features

- Folder tree browser for mounted source directories
- Background zip jobs (non-blocking)
- Job statuses (`queued`, `running`, `completed`, `failed`, `cancelled`)
- Cancel running/queued jobs from the UI
- Persisted job history (`jobs.json`)
- Optional zip retention cleanup (disabled in compose by default)
- Download completed archives directly from the jobs table

## Quick Start (Docker Compose)

1. Put folders you want to zip inside `./data`.
2. Start the app:

```bash
docker compose up --build
```

3. Open [http://localhost:3000](http://localhost:3000)
4. Generated zip files are written to `./output`

## Local Development (No Docker)

```bash
npm install
npm start
```

Then open `http://localhost:3000`.

## How It Works

- The UI calls backend APIs to list folders and create jobs.
- A zip job is executed asynchronously with `archiver`.
- Job metadata is saved to `JOB_STORE_PATH`.
- Completed files are stored in `ZIP_OUTPUT_DIR`.
- If retention is enabled, old zip files are deleted on an interval.

## API

### `GET /api/health`

Returns service health and active root/output directories.

### `GET /api/folders`

Returns the browsable folder tree under `ZIP_ROOT`.

### `POST /api/jobs`

Creates a new zip job.

Request body:

```json
{
  "sourceRelativePath": "my-folder/subfolder"
}
```

### `GET /api/jobs`

Returns all jobs (newest first).

### `GET /api/jobs/:id`

Returns one job by ID.

### `DELETE /api/jobs/:id`

Cancels a `queued` or `running` job.

### `GET /api/download/:file`

Downloads a completed zip file.

## Configuration

Environment variables:

- `PORT` (default: `3000`)
- `ZIP_ROOT` (default: `/data`)
- `ZIP_OUTPUT_DIR` (default: `/output`)
- `MAX_BROWSE_DEPTH` (default: `5`)
- `JOB_STORE_PATH` (default: `/output/jobs.json`)
- `ZIP_RETENTION_DAYS` (default: `7`)
- `RETENTION_SCAN_MS` (default: `60000`)

### Retention Behavior

- `ZIP_RETENTION_DAYS=0` disables retention cleanup
- `ZIP_RETENTION_DAYS>0` deletes `.zip` files older than N days
- In this repo's `docker-compose.yml`, retention is currently set to `0` (disabled)

## Volumes in Compose

- `./data:/data` -> source folders to zip
- `./output:/output` -> generated zip files + persisted job history
