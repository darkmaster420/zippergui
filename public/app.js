const folderTree = document.getElementById("folderTree");
const refreshFoldersBtn = document.getElementById("refreshFolders");
const startZipBtn = document.getElementById("startZip");
const statusText = document.getElementById("statusText");
const refreshJobsBtn = document.getElementById("refreshJobs");
const jobsTableBody = document.getElementById("jobsTableBody");
const selectedFolderEl = document.getElementById("selectedFolder");

let selectedFolder = "";

function formatStatus(status) {
  const cls = `status-pill status-${status}`;
  return `<span class="${cls}">${status}</span>`;
}

function createNode(node) {
  const li = document.createElement("li");
  li.className = "tree-node";

  const button = document.createElement("button");
  button.type = "button";
  button.className = "folder-btn";
  button.textContent = node.name;
  button.title = node.relativePath;
  button.addEventListener("click", () => {
    selectedFolder = node.relativePath;
    selectedFolderEl.textContent = selectedFolder;
    document.querySelectorAll(".folder-btn.active").forEach((el) => el.classList.remove("active"));
    button.classList.add("active");
  });
  li.appendChild(button);

  if (Array.isArray(node.children) && node.children.length > 0) {
    const ul = document.createElement("ul");
    ul.className = "tree-children";
    for (const child of node.children) {
      ul.appendChild(createNode(child));
    }
    li.appendChild(ul);
  }
  return li;
}

function renderTree(nodes) {
  folderTree.innerHTML = "";
  if (!nodes.length) {
    folderTree.textContent = "No folders available.";
    selectedFolder = "";
    selectedFolderEl.textContent = "(none)";
    return 0;
  }

  const root = document.createElement("ul");
  root.className = "tree-root";
  for (const node of nodes) {
    root.appendChild(createNode(node));
  }
  folderTree.appendChild(root);
  return nodes.length;
}

function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toFixed(1)} ${units[i]}`;
}

async function loadFolders() {
  statusText.textContent = "Loading folders...";
  const res = await fetch("/api/folders");
  const data = await res.json();
  if (!res.ok) {
    statusText.textContent = `Failed to load folders: ${data.error || "Unknown error"}`;
    return;
  }

  const count = renderTree(data.tree);
  if (count === 0) {
    statusText.textContent = "No folders found under mounted /data directory.";
  } else {
    statusText.textContent = `Loaded folder tree from ${data.rootDir}`;
  }
}

async function loadJobs() {
  const res = await fetch("/api/jobs");
  const data = await res.json();
  if (!res.ok) {
    statusText.textContent = `Failed to load jobs: ${data.error || "Unknown error"}`;
    return;
  }

  jobsTableBody.innerHTML = "";
  for (const job of data.jobs) {
    const tr = document.createElement("tr");
    const download =
      job.status === "completed" && job.outputFile
        ? `<a href="/api/download/${encodeURIComponent(job.outputFile)}" target="_blank" rel="noreferrer">${job.outputFile}</a>`
        : job.outputFile || "-";
    const action =
      job.status === "running" || job.status === "queued"
        ? `<button data-cancel-id="${job.id}" class="cancel-btn btn-danger">Cancel</button>`
        : "-";
    tr.innerHTML = `
      <td class="mono">${job.id.slice(0, 8)}</td>
      <td>${job.sourceRelativePath}</td>
      <td>${formatStatus(job.status)}</td>
      <td>${formatBytes(job.bytesWritten)}</td>
      <td>${download}</td>
      <td>${action}</td>
    `;
    jobsTableBody.appendChild(tr);
  }

  document.querySelectorAll(".cancel-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-cancel-id");
      const confirmed = window.confirm(`Cancel job ${id.slice(0, 8)}?`);
      if (!confirmed) {
        return;
      }
      const res = await fetch(`/api/jobs/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) {
        statusText.textContent = `Cancel failed: ${data.error || "Unknown error"}`;
      } else {
        statusText.textContent = `Job ${id.slice(0, 8)} cancelled.`;
        await loadJobs();
      }
    });
  });
}

async function startJob() {
  const sourceRelativePath = selectedFolder;
  if (!sourceRelativePath) {
    statusText.textContent = "Select a folder first.";
    return;
  }

  statusText.textContent = `Starting zip job for "${sourceRelativePath}"...`;
  const res = await fetch("/api/jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sourceRelativePath })
  });
  const data = await res.json();
  if (!res.ok) {
    statusText.textContent = `Failed to start job: ${data.error || "Unknown error"}`;
    return;
  }
  statusText.textContent = `Job ${data.job.id.slice(0, 8)} started.`;
  await loadJobs();
}

refreshFoldersBtn.addEventListener("click", () => {
  loadFolders().catch((err) => {
    statusText.textContent = `Folder refresh failed: ${err.message}`;
  });
});

startZipBtn.addEventListener("click", () => {
  startJob().catch((err) => {
    statusText.textContent = `Could not start zip: ${err.message}`;
  });
});

refreshJobsBtn.addEventListener("click", () => {
  loadJobs().catch((err) => {
    statusText.textContent = `Job refresh failed: ${err.message}`;
  });
});

setInterval(() => {
  loadJobs().catch(() => {});
}, 3000);

loadFolders().catch((err) => {
  statusText.textContent = `Initial folder load failed: ${err.message}`;
});
loadJobs().catch(() => {});
