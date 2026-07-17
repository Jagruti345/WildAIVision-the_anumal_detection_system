const API_URL = "https://4knqjwhxa6.execute-api.ap-south-1.amazonaws.com";

// Cache of images the user has uploaded this session, keyed by imageId
// (and by filename as a fallback), so result cards can show the actual photo.
const imageCache = {};
let lastUploadedFilename = null;

const fileInput = document.getElementById("fileInput");
const analyzeBtn = document.getElementById("analyzeBtn");
const status = document.getElementById("uploadStatus");
const viewfinder = document.getElementById("viewfinder");
const scanLine = document.getElementById("scanLine");
const previewImg = document.getElementById("previewImg");
const vfPlaceholder = document.getElementById("vfPlaceholder");

// ================= FILE SELECT / PREVIEW =================
fileInput.addEventListener("change", () => {
  const file = fileInput.files[0];
  if (!file) return;
  showPreview(file);
});

// drag & drop onto the viewfinder
["dragover", "dragenter"].forEach(evt =>
  viewfinder.addEventListener(evt, e => {
    e.preventDefault();
    viewfinder.style.borderColor = "var(--accent-gold)";
  })
);
["dragleave", "drop"].forEach(evt =>
  viewfinder.addEventListener(evt, e => {
    e.preventDefault();
    viewfinder.style.borderColor = "";
  })
);
viewfinder.addEventListener("drop", e => {
  const file = e.dataTransfer.files[0];
  if (!file) return;
  fileInput.files = e.dataTransfer.files;
  showPreview(file);
});

function showPreview(file) {
  const url = URL.createObjectURL(file);
  previewImg.src = url;
  previewImg.hidden = false;
  vfPlaceholder.style.display = "none";
  viewfinder.classList.remove("locked");
  status.innerText = "";
}

// ================= UPLOAD IMAGE =================
async function uploadImage() {
  if (!fileInput.files.length) {
    status.innerText = "Select a photo first.";
    return;
  }

  const file = fileInput.files[0];
  lastUploadedFilename = file.name;
  const base64 = await toBase64(file);
  const dataUrl = `data:${file.type};base64,${base64}`;

  analyzeBtn.disabled = true;
  scanLine.classList.add("scanning");
  status.innerText = "Scanning frame…";

  try {
    const res = await fetch(`${API_URL}/image`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: base64 })
    });

    const data = await res.json();

    // Cache the image against whatever identifiers we can find,
    // so the results grid can display the real photo.
    const possibleIds = [data.imageId, data.id, file.name].filter(Boolean);
    possibleIds.forEach(id => (imageCache[id] = dataUrl));

    status.innerText = "Scan complete. Pulling results…";
    viewfinder.classList.add("locked");

    setTimeout(() => {
      scanLine.classList.remove("scanning");
      fetchResults();
    }, 1600);
  } catch (err) {
    scanLine.classList.remove("scanning");
    status.innerText = "Something went wrong — try again.";
  } finally {
    analyzeBtn.disabled = false;
  }
}

// ================= FETCH RESULTS =================
async function fetchResults() {
  const container = document.getElementById("resultsContainer");
  const emptyState = document.getElementById("emptyState");

  let data = [];
  try {
    const res = await fetch(`${API_URL}/results`);
    data = await res.json();
  } catch (err) {
    status.innerText = "Couldn't load the detection log.";
    return;
  }

  status.innerText = "Log updated.";

  if (!Array.isArray(data) || data.length === 0) {
    container.innerHTML = "";
    emptyState.classList.add("visible");
    return;
  }
  emptyState.classList.remove("visible");

  container.innerHTML = "";

  data.forEach((item, i) => {
    // Prefer the image stored in S3 (returned by /results).
    // Fall back to the locally cached image only if needed.
    const imgSrc =
        item.imageUrl ||
        imageCache[item.imageId] ||
        imageCache[lastUploadedFilename] ||
        null;

    const badges = Object.entries(item.animalsDetected || {})
      .map(
        ([name, count]) =>
          `<span class="badge">${escapeHtml(name)} <span class="badge-count">×${count}</span></span>`
      )
      .join("");

    const frameContent = imgSrc
  ? `
      <img
        src="${imgSrc}"
        alt="${escapeHtml(item.imageId)}"
        loading="lazy"
        onerror="this.parentElement.innerHTML='<div class=&quot;no-img&quot;>Image not available</div>'"
      />
    `
      : `<div class="no-img">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
            <path d="M4 7h3l1.5-2h7L17 7h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1Z" stroke="currentColor" stroke-width="1.3"/>
            <circle cx="12" cy="13" r="3.2" stroke="currentColor" stroke-width="1.3"/>
          </svg>
        </div>`;

    const card = document.createElement("div");
    card.className = "card";
    card.style.animationDelay = `${i * 60}ms`;
    card.innerHTML = `
  <div class="card-frame">
    ${frameContent}
    <span class="card-corner tl"></span>
    <span class="card-corner tr"></span>
    <span class="card-corner bl"></span>
    <span class="card-corner br"></span>
    <span class="card-count-tag">${item.totalAnimals} DETECTED</span>
  </div>

  <div class="card-body">
    <h3>🖼 ${escapeHtml(item.imageId)}</h3>

    <div class="total-line">
      Total animals: <b>${item.totalAnimals}</b>
    </div>

    <div class="total-line">
      Uploaded:
      <b>${item.timestamp ? new Date(item.timestamp).toLocaleString() : "-"}</b>
    </div>

    <div class="badge-row">
      ${badges || '<span class="badge">No species tagged</span>'}
    </div>
  </div>
`;
    container.appendChild(card);
  });
}

// ================= HELPERS =================
function toBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result.split(",")[1]);
    reader.onerror = reject;
  });
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// initial load: show whatever results already exist
fetchResults();