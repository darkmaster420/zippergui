const express = require("express");
const path = require("path");
const fs = require("fs");
const fsp = require("fs/promises");
const archiver = require("archiver");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;
const ROOT_DIR = process.env.ZIP_ROOT || "/data";
const OUTPUT_DIR = process.env.ZIP_OUTPUT_DIR || "/output";
const MAX_DEPTH = Number(process.env.MAX_BROWSE_DEPTH || 5);
const JOB_STORE_PATH = process.env.JOB_STORE_PATH || path.join(OUTPUT_DIR, "jobs.json");
const RETENTION_DAYS = Number(process.env.ZIP_RETENTION_DAYS || 7);
const RETENTION_SCAN_MS = Number(process.env.RETENTION_SCAN_MS || 60_000);
const ALLOW_SOURCE_DELETE = String(process.env.ALLOW_SOURCE_DELETE || "false").toLowerCase() === "true";

const jobs = new Map();
const activeJobs = new Map();
let httpServer = null;
let shuttingDown = false;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

function safeResolve(baseDir, userPath = "") {
  const candidate = path.resolve(baseDir, userPath);
  const rel = path.relative(baseDir, candidate);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error("Path escapes allowed root.");
  }
  return candidate;
}

async function ensureDir(dirPath) {
  await fsp.mkdir(dirPath, { recursive: true });
}

function getJobsSnapshot() {
  return [...jobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

async function persistJobs() {
  const parent = path.dirname(JOB_STORE_PATH);
  await ensureDir(parent);
  const payload = JSON.stringify({ jobs: getJobsSnapshot() }, null, 2);
  await fsp.writeFile(JOB_STORE_PATH, payload, "utf8");
}

async function loadPersistedJobs() {
  try {
    const raw = await fsp.readFile(JOB_STORE_PATH, "utf8");
    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed?.jobs) ? parsed.jobs : [];
    for (const job of list) {
      jobs.set(job.id, job);
    }
  } catch (err) {
    if (err.code !== "ENOENT") {
      console.error("Failed to load persisted jobs:", err.message);
    }
  }
}

function makeJob(sourceRelativePath, deleteSourceAfterZip) {
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  return {
    id,
    sourceRelativePath,
    status: "queued",
    createdAt,
    startedAt: null,
    finishedAt: null,
    outputFile: null,
    bytesWritten: 0,
    processedEntries: 0,
    totalEntries: 0,
    progressPercent: 0,
    error: null,
    cancelledAt: null,
    deleteSourceAfterZip: Boolean(deleteSourceAfterZip)
  };
}

async function listDirectories(basePath, depth = 0, root = basePath) {
  if (depth > MAX_DEPTH) {
    return [];
  }

  const entries = await fsp.readdir(basePath, { withFileTypes: true });
  const dirs = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const absolute = path.join(basePath, entry.name);
    const relative = path.relative(root, absolute).replaceAll("\\", "/");
    const children = await listDirectories(absolute, depth + 1, root);
    dirs.push({
      name: entry.name,
      relativePath: relative,
      children
    });
  }

  dirs.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  return dirs;
}

async function runZipJob(job) {
  const sourceAbs = safeResolve(ROOT_DIR, job.sourceRelativePath);
  const sourceStats = await fsp.stat(sourceAbs);
  if (!sourceStats.isDirectory()) {
    throw new Error("Selected path is not a directory.");
  }

  await ensureDir(OUTPUT_DIR);
  const folderName = path.basename(sourceAbs);
  const stamp = new Date().toISOString().replaceAll(":", "-");
  const outputFile = `${folderName}-${stamp}.zip`;
  const outputPath = path.join(OUTPUT_DIR, outputFile);

  job.status = "running";
  job.startedAt = new Date().toISOString();
  job.outputFile = outputFile;
  job.bytesWritten = 0;
  job.processedEntries = 0;
  job.totalEntries = 0;
  job.progressPercent = 0;

  await new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outputPath);
    const archive = archiver("zip", { zlib: { level: 9 } });
    activeJobs.set(job.id, { archive, output, outputPath });

    output.on("close", () => {
      activeJobs.delete(job.id);
      if (job.status === "cancelled") {
        resolve();
        return;
      }
      job.status = "completed";
      job.finishedAt = new Date().toISOString();
      job.bytesWritten = archive.pointer();
      job.progressPercent = 100;
      persistJobs().catch(() => {});
      resolve();
    });

    output.on("error", (err) => {
      activeJobs.delete(job.id);
      reject(err);
    });

    archive.on("warning", (err) => {
      if (err.code === "ENOENT") {
        return;
      }
      reject(err);
    });

    archive.on("error", (err) => {
      activeJobs.delete(job.id);
      reject(err);
    });

    archive.on("progress", (progress) => {
      job.bytesWritten = archive.pointer();
      const processed = progress?.entries?.processed ?? 0;
      const total = progress?.entries?.total ?? 0;
      job.processedEntries = processed;
      job.totalEntries = total;
      job.progressPercent = total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 0;
    });

    archive.pipe(output);
    archive.directory(sourceAbs, false);
    archive.finalize().catch(reject);
  });

  if (job.status === "completed" && job.deleteSourceAfterZip) {
    await fsp.rm(sourceAbs, { recursive: true, force: false });
  }
}

async function cancelJob(job) {
  if (job.status !== "running" && job.status !== "queued") {
    throw new Error("Only queued or running jobs can be cancelled.");
  }

  job.status = "cancelled";
  job.cancelledAt = new Date().toISOString();
  job.finishedAt = job.cancelledAt;
  job.error = null;

  const active = activeJobs.get(job.id);
  if (!active) {
    await persistJobs();
    return;
  }

  try {
    active.archive.abort();
  } catch (_err) {}

  try {
    active.output.destroy();
  } catch (_err) {}

  activeJobs.delete(job.id);

  if (active.outputPath) {
    try {
      await fsp.unlink(active.outputPath);
    } catch (err) {
      if (err.code !== "ENOENT") {
        console.error(`Failed to delete partial zip for ${job.id}:`, err.message);
      }
    }
  }

  await persistJobs();
}

async function forceStopAndDeleteJob(job) {
  const active = activeJobs.get(job.id);
  if (active) {
    try {
      active.archive.abort();
    } catch (_err) {}

    try {
      active.output.destroy();
    } catch (_err) {}

    activeJobs.delete(job.id);

    if (active.outputPath) {
      try {
        await fsp.unlink(active.outputPath);
      } catch (err) {
        if (err.code !== "ENOENT") {
          console.error(`Failed to delete partial zip for ${job.id}:`, err.message);
        }
      }
    }
  }

  jobs.delete(job.id);
}

async function shutdownGracefully(signal) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  console.log(`Received ${signal}. Stopping active zip jobs before shutdown...`);

  const targets = [...jobs.values()].filter((job) => job.status === "running" || job.status === "queued");
  for (const job of targets) {
    await forceStopAndDeleteJob(job);
  }
  await persistJobs();

  if (!httpServer) {
    process.exit(0);
    return;
  }

  await new Promise((resolve) => {
    httpServer.close(() => resolve());
  });
  process.exit(0);
}

async function applyRetention() {
  if (RETENTION_DAYS <= 0) {
    return;
  }

  const cutoffMs = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const entries = await fsp.readdir(OUTPUT_DIR, { withFileTypes: true }).catch(() => []);

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".zip")) {
      continue;
    }
    const abs = path.join(OUTPUT_DIR, entry.name);
    try {
      const stat = await fsp.stat(abs);
      if (stat.mtimeMs < cutoffMs) {
        await fsp.unlink(abs);
      }
    } catch (_err) {}
  }
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, rootDir: ROOT_DIR, outputDir: OUTPUT_DIR });
});

app.get("/api/folders", async (_req, res) => {
  try {
    await ensureDir(ROOT_DIR);
    const tree = await listDirectories(ROOT_DIR, 0, ROOT_DIR);
    res.json({ rootDir: ROOT_DIR, tree });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/jobs", async (req, res) => {
  const sourceRelativePath = (req.body?.sourceRelativePath || "").trim();
  const deleteSourceAfterZip = Boolean(req.body?.deleteSourceAfterZip) && ALLOW_SOURCE_DELETE;
  if (!sourceRelativePath) {
    return res.status(400).json({ error: "sourceRelativePath is required." });
  }

  let sourceAbs;
  try {
    sourceAbs = safeResolve(ROOT_DIR, sourceRelativePath);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  try {
    const stats = await fsp.stat(sourceAbs);
    if (!stats.isDirectory()) {
      return res.status(400).json({ error: "Path is not a directory." });
    }
  } catch (_err) {
    return res.status(404).json({ error: "Directory does not exist." });
  }

  const job = makeJob(sourceRelativePath, deleteSourceAfterZip);
  jobs.set(job.id, job);
  await persistJobs();

  runZipJob(job).catch((err) => {
    if (job.status === "cancelled") {
      return;
    }
    job.status = "failed";
    job.finishedAt = new Date().toISOString();
    job.error = err.message;
    persistJobs().catch(() => {});
  });

  return res.status(202).json({ job });
});

app.get("/api/jobs", (_req, res) => {
  const all = getJobsSnapshot();
  res.json({ jobs: all });
});

app.get("/api/jobs/:id", (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) {
    return res.status(404).json({ error: "Job not found." });
  }
  return res.json({ job });
});

app.delete("/api/jobs/:id", async (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) {
    return res.status(404).json({ error: "Job not found." });
  }

  try {
    await cancelJob(job);
    return res.json({ job });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

app.get("/api/download/:file", (req, res) => {
  const fileName = req.params.file;
  if (!fileName.endsWith(".zip")) {
    return res.status(400).json({ error: "Invalid file name." });
  }
  const filePath = path.join(OUTPUT_DIR, fileName);
  return res.download(filePath);
});

async function start() {
  await ensureDir(ROOT_DIR);
  await ensureDir(OUTPUT_DIR);
  await loadPersistedJobs();
  await applyRetention();
  setInterval(() => {
    applyRetention().catch((err) => {
      console.error("Retention scan failed:", err.message);
    });
  }, RETENTION_SCAN_MS);

  httpServer = app.listen(PORT, () => {
    console.log(`Zipper GUI listening on http://localhost:${PORT}`);
    console.log(`Source root: ${ROOT_DIR}`);
    console.log(`Zip output: ${OUTPUT_DIR}`);
    console.log(`Allow source deletion: ${ALLOW_SOURCE_DELETE}`);
  });
}

process.on("SIGINT", () => {
  shutdownGracefully("SIGINT").catch((err) => {
    console.error("Shutdown failed:", err);
    process.exit(1);
  });
});

process.on("SIGTERM", () => {
  shutdownGracefully("SIGTERM").catch((err) => {
    console.error("Shutdown failed:", err);
    process.exit(1);
  });
});

start().catch((err) => {
  console.error("Failed to start service:", err);
  process.exit(1);
});
