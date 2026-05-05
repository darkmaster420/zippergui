# Zipper GUI

Web UI + API for creating ZIP archives from server-side folders in the background.

Designed to run in Docker so you can mount a folder, pick subfolders from the UI, queue jobs, and download finished zip files.

## Features

- Folder tree browser for mounted source directories
- Background zip jobs (non-blocking)
- Job statuses (`queued`, `running`, `completed`, `failed`, `cancelled`)
- Cancel running/queued jobs from the UI
- Optional delete-source-after-zip setting (disabled by default)
- Persisted job history (`jobs.json`)
- Optional zip retention cleanup (disabled in compose by default)
- Download completed archives directly from the jobs table

## Quick Start (Docker Compose)

1. Copy env template and set your image name:

```bash
cp .env.example .env
```

2. In `.env`, set:

- `IMAGE_NAME=ghcr.io/<your-org-or-user>/zippergui:latest`

3. Put folders you want to zip inside `./data` (or change `DATA_PATH`).
4. Start the app:

```bash
docker compose up -d
```

5. Open [http://localhost:3000](http://localhost:3000)
6. Generated zip files are written to `./output` (or your `OUTPUT_PATH`)

## Local Development (No Docker)

```bash
npm install
npm start
```

Then open `http://localhost:3000`.

## Publish Image with GitHub Actions

This repo includes `.github/workflows/docker-publish.yml` that builds and publishes to GHCR:

- On push to `main`
- On tags like `v1.2.3`
- On manual run (`workflow_dispatch`)

Published image name:

- `ghcr.io/<repo-owner>/zippergui:<tag>`

Default tags include:

- `latest` (default branch)
- branch name
- git tag (for release tags)
- short SHA

To allow pulling from another host, make sure the package visibility/access in GitHub is configured appropriately (public image, or authenticated pulls for private packages).

## How It Works

- The UI calls backend APIs to list folders and create jobs.
- A zip job is executed asynchronously with `archiver`.
- Job metadata is saved to `JOB_STORE_PATH`.
- Completed files are stored in `ZIP_OUTPUT_DIR`.
- If retention is enabled, old zip files are deleted on an interval.
- On shutdown signals (`SIGINT`/`SIGTERM`), running/queued jobs are force-stopped, removed from job history, and partial zip files are deleted before process exit.

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
  "sourceRelativePath": "my-folder/subfolder",
  "deleteSourceAfterZip": false
}
```

`deleteSourceAfterZip` is honored only when `ALLOW_SOURCE_DELETE=true`.

### `GET /api/jobs`

Returns all jobs (newest first).

### `GET /api/jobs/:id`

Returns one job by ID.

### `DELETE /api/jobs/:id`

Cancels a `queued` or `running` job, deletes any partial zip output, and removes the job from history.

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
- `ALLOW_SOURCE_DELETE` (default: `false`)

Compose-oriented variables (`.env`):

- `IMAGE_NAME` (image to deploy, e.g. `ghcr.io/acme/zippergui:latest`)
- `HOST_PORT` (host port mapped to container `3000`)
- `DATA_PATH` (host path mounted to `/data`)
- `OUTPUT_PATH` (host path mounted to `/output`)

### Retention Behavior

- `ZIP_RETENTION_DAYS=0` disables retention cleanup
- `ZIP_RETENTION_DAYS>0` deletes `.zip` files older than N days
- In this repo's `docker-compose.yml`, retention is currently `0` by default (disabled)

## Volumes in Compose

- `./data:/data` -> source folders to zip
- `./output:/output` -> generated zip files + persisted job history
