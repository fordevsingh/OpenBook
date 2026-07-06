import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

// IndexedDB Helper Functions
const DB_NAME = 'OpenBookDB';
const DB_VERSION = 1;

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('files')) {
        db.createObjectStore('files', { keyPath: 'name' });
      }
      if (!db.objectStoreNames.contains('metadata')) {
        db.createObjectStore('metadata', { keyPath: 'name' });
      }
      if (!db.objectStoreNames.contains('bookmarks')) {
        db.createObjectStore('bookmarks', { keyPath: 'name' });
      }
    };
    request.onsuccess = (e) => resolve(e.target.result);
    request.onerror = (e) => reject(e.target.error);
  });
}

async function getFromStore(storeName, key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readonly');
    const store = transaction.objectStore(storeName);
    const request = store.get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getAllFromStore(storeName) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readonly');
    const store = transaction.objectStore(storeName);
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

async function saveToStore(storeName, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readwrite');
    const store = transaction.objectStore(storeName);
    const request = store.put(value);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

async function deleteFromStore(storeName, key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readwrite');
    const store = transaction.objectStore(storeName);
    const request = store.delete(key);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

// Manage Recent Files List (Limit to 5)
async function addRecentFile(name, size, arrayBuffer) {
  const meta = {
    name,
    size,
    currentPage: 1,
    zoom: 1.0,
    lastOpened: Date.now()
  };

  // Write to store
  await saveToStore('metadata', meta);
  await saveToStore('files', { name, data: arrayBuffer });

  // Evict older files if we have more than 5
  const allMetas = await getAllFromStore('metadata');
  if (allMetas.length > 5) {
    allMetas.sort((a, b) => a.lastOpened - b.lastOpened); // Oldest first
    const toEvictCount = allMetas.length - 5;
    for (let i = 0; i < toEvictCount; i++) {
      const evictName = allMetas[i].name;
      await deleteFromStore('files', evictName);
      await deleteFromStore('metadata', evictName);
      await deleteFromStore('bookmarks', evictName);
    }
  }
}

async function updateReadingProgress(name, pageNum, zoom) {
  const meta = await getFromStore('metadata', name);
  if (meta) {
    meta.currentPage = pageNum;
    meta.zoom = zoom;
    meta.lastOpened = Date.now();
    await saveToStore('metadata', meta);
  }
}

// Viewer State
let pdfDoc = null;
let currentPageNumber = 1;
let currentZoom = 1.0;
let currentFileName = '';
let renderTask = null;

// Core Rendering Functions
async function loadPDF(arrayBuffer, fileName, initialPage = 1, initialZoom = 1.0) {
  showLoading(true, "Opening PDF...");
  currentFileName = fileName;
  currentPageNumber = initialPage;
  currentZoom = initialZoom;

  try {
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
    pdfDoc = await loadingTask.promise;

    // UI Updates
    document.getElementById('appSubtitle').textContent = fileName;
    document.getElementById('pageCount').textContent = pdfDoc.numPages;
    document.getElementById('pageInput').max = pdfDoc.numPages;
    document.getElementById('zoomLabel').textContent = `${Math.round(currentZoom * 100)}%`;

    enableControls(true);

    document.getElementById('emptyState').style.display = 'none';
    document.getElementById('pdfContainer').style.display = 'flex';

    await renderPage(currentPageNumber);
    await loadBookmarksUI();
    await loadOutlineUI();
    await loadRecentFilesUI();
  } catch (err) {
    console.error("Error loading PDF document:", err);
    alert("Could not load PDF. The file might be corrupted or in an unsupported format.");
    showLoading(false);
  }
}

async function renderPage(pageNum) {
  if (!pdfDoc) return;

  showLoading(true, `Rendering Page ${pageNum}...`);
  currentPageNumber = pageNum;
  document.getElementById('pageInput').value = pageNum;

  // Toggle button availability
  document.getElementById('prevPageBtn').disabled = (pageNum <= 1);
  document.getElementById('nextPageBtn').disabled = (pageNum >= pdfDoc.numPages);

  try {
    const page = await pdfDoc.getPage(pageNum);

    if (renderTask) {
      renderTask.cancel();
    }

    const canvas = document.getElementById('pdfCanvas');
    const context = canvas.getContext('2d');

    const viewport = page.getViewport({ scale: currentZoom });
    canvas.width = viewport.width;
    canvas.height = viewport.height;

    const renderContext = {
      canvasContext: context,
      viewport: viewport
    };

    renderTask = page.render(renderContext);
    await renderTask.promise;
    renderTask = null;

    // Update progress metadata and bookmarked star outline state
    await updateReadingProgress(currentFileName, currentPageNumber, currentZoom);
    await updateBookmarkButtonState();

    showLoading(false);
  } catch (err) {
    if (err.name === 'RenderingCancelledException') {
      // Ignored
    } else {
      console.error("Error rendering page:", err);
      showLoading(false);
    }
  }
}

function changeZoom(factor) {
  if (!pdfDoc) return;
  if (factor === 'reset') {
    currentZoom = 1.0;
  } else {
    currentZoom = Math.min(Math.max(currentZoom + factor, 0.5), 4.0);
  }
  document.getElementById('zoomLabel').textContent = `${Math.round(currentZoom * 100)}%`;
  renderPage(currentPageNumber);
}

// Outline Resolver Functions
async function getPageNumberFromDest(pdfDoc, dest) {
  if (!dest) return null;
  let explicitDest = dest;
  if (typeof dest === 'string') {
    explicitDest = await pdfDoc.getDestination(dest);
  }
  if (Array.isArray(explicitDest)) {
    const pageRef = explicitDest[0];
    if (pageRef && typeof pageRef === 'object') {
      try {
        const pageIndex = await pdfDoc.getPageIndex(pageRef);
        return pageIndex + 1;
      } catch (err) {
        console.error("Error getting page index from ref", err);
      }
    }
  }
  return null;
}

async function loadOutlineUI() {
  const container = document.getElementById('outlineTree');
  const emptyPanel = document.getElementById('outlineEmpty');
  container.innerHTML = '';

  if (!pdfDoc) return;

  try {
    const outline = await pdfDoc.getOutline();
    if (!outline || outline.length === 0) {
      emptyPanel.style.display = 'block';
      container.style.display = 'none';
      return;
    }

    emptyPanel.style.display = 'none';
    container.style.display = 'block';

    const tree = await buildOutlineTree(outline);
    container.appendChild(tree);
  } catch (err) {
    console.error("Error fetching outline:", err);
    emptyPanel.style.display = 'block';
    container.style.display = 'none';
  }
}

async function buildOutlineTree(items) {
  const ul = document.createElement('ul');
  ul.style.listStyle = 'none';
  ul.style.padding = '0';
  ul.style.margin = '0';
  ul.className = 'outline-list';

  for (const item of items) {
    const li = document.createElement('li');
    li.className = 'outline-item';

    const link = document.createElement('a');
    link.className = 'outline-link';
    link.textContent = item.title;

    let pageNum = null;
    if (item.dest) {
      pageNum = await getPageNumberFromDest(pdfDoc, item.dest);
    }

    if (pageNum !== null) {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        renderPage(pageNum);
      });
    } else {
      link.style.cursor = 'default';
      link.style.opacity = '0.7';
    }

    li.appendChild(link);

    if (item.items && item.items.length > 0) {
      const childUl = await buildOutlineTree(item.items);
      childUl.className = 'outline-children';
      li.appendChild(childUl);
    }

    ul.appendChild(li);
  }

  return ul;
}

// Bookmarks Panel Helper Functions
async function loadBookmarksUI() {
  const container = document.getElementById('bookmarksList');
  const emptyPanel = document.getElementById('bookmarksEmpty');
  container.innerHTML = '';

  if (!pdfDoc || !currentFileName) {
    emptyPanel.style.display = 'block';
    return;
  }

  const bookmarksData = await getFromStore('bookmarks', currentFileName);
  const list = bookmarksData ? bookmarksData.list : [];

  if (list.length === 0) {
    emptyPanel.style.display = 'block';
    return;
  }

  emptyPanel.style.display = 'none';
  list.sort((a, b) => a.page - b.page);

  list.forEach(bm => {
    const li = document.createElement('li');
    li.className = 'bookmark-item';

    const info = document.createElement('div');
    info.className = 'bookmark-info';

    const name = document.createElement('span');
    name.className = 'bookmark-name';
    name.textContent = bm.label || `Page ${bm.page}`;

    const meta = document.createElement('span');
    meta.className = 'bookmark-meta';
    meta.textContent = `Page ${bm.page} • Added ${new Date(bm.addedAt).toLocaleDateString()}`;

    info.appendChild(name);
    info.appendChild(meta);
    li.appendChild(info);

    li.addEventListener('click', (e) => {
      if (e.target.closest('.delete-btn')) return;
      renderPage(bm.page);
    });

    const delBtn = document.createElement('button');
    delBtn.className = 'delete-btn';
    delBtn.title = 'Remove Bookmark';
    delBtn.innerHTML = `
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="3 6 5 6 21 6"></polyline>
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
      </svg>
    `;
    delBtn.addEventListener('click', async () => {
      await removeBookmark(bm.page);
    });

    li.appendChild(delBtn);
    container.appendChild(li);
  });
}

async function removeBookmark(page) {
  if (!currentFileName) return;
  const bookmarksData = await getFromStore('bookmarks', currentFileName);
  if (bookmarksData) {
    bookmarksData.list = bookmarksData.list.filter(bm => bm.page !== page);
    await saveToStore('bookmarks', bookmarksData);
    await loadBookmarksUI();
    await updateBookmarkButtonState();
  }
}

async function addBookmark(page, label = '') {
  if (!currentFileName) return;

  let bookmarksData = await getFromStore('bookmarks', currentFileName);
  if (!bookmarksData) {
    bookmarksData = { name: currentFileName, list: [] };
  }

  if (bookmarksData.list.some(bm => bm.page === page)) return;

  bookmarksData.list.push({
    page,
    label: label || `Page ${page}`,
    addedAt: Date.now()
  });

  await saveToStore('bookmarks', bookmarksData);
  await loadBookmarksUI();
  await updateBookmarkButtonState();
}

// Custom Modal DOM elements
const bookmarkModal = document.getElementById('bookmarkModal');
const bookmarkModalInput = document.getElementById('bookmarkModalInput');
const bookmarkModalPageNum = document.getElementById('bookmarkModalPageNum');

function showBookmarkModal(page) {
  bookmarkModalPageNum.textContent = page;
  bookmarkModalInput.value = `Page ${page}`;
  bookmarkModal.classList.add('active');
  setTimeout(() => bookmarkModalInput.select(), 50);
}

function hideBookmarkModal() {
  bookmarkModal.classList.remove('active');
}

document.getElementById('bookmarkModalCancelBtn').addEventListener('click', hideBookmarkModal);
document.getElementById('bookmarkModalSaveBtn').addEventListener('click', async () => {
  const page = parseInt(bookmarkModalPageNum.textContent);
  const label = bookmarkModalInput.value.trim() || `Page ${page}`;
  await addBookmark(page, label);
  hideBookmarkModal();
});

if (bookmarkModal) {
  bookmarkModal.addEventListener('click', (e) => {
    if (e.target === bookmarkModal) {
      hideBookmarkModal();
    }
  });
}

async function toggleCurrentPageBookmark() {
  if (!pdfDoc || !currentFileName) return;

  const bookmarksData = await getFromStore('bookmarks', currentFileName);
  const exists = bookmarksData ? bookmarksData.list.some(bm => bm.page === currentPageNumber) : false;

  if (exists) {
    await removeBookmark(currentPageNumber);
  } else {
    showBookmarkModal(currentPageNumber);
  }
}

async function updateBookmarkButtonState() {
  const btn = document.getElementById('bookmarkPageBtn');
  const star = btn.querySelector('.star-icon');

  if (!pdfDoc || !currentFileName) {
    btn.disabled = true;
    star.classList.remove('active');
    return;
  }

  btn.disabled = false;
  const bookmarksData = await getFromStore('bookmarks', currentFileName);
  const exists = bookmarksData ? bookmarksData.list.some(bm => bm.page === currentPageNumber) : false;

  if (exists) {
    star.classList.add('active');
    btn.title = 'Remove Bookmark';
  } else {
    star.classList.remove('active');
    btn.title = 'Bookmark page';
  }
}

// Recent Files UI Panel Functions
async function loadRecentFilesUI() {
  const container = document.getElementById('recentList');
  const panel = document.getElementById('panel-recent');
  const emptyPanel = panel.querySelector('.panel-empty');

  container.innerHTML = '';
  const allMetas = await getAllFromStore('metadata');

  if (allMetas.length === 0) {
    emptyPanel.style.display = 'block';
    return;
  }

  emptyPanel.style.display = 'none';
  allMetas.sort((a, b) => b.lastOpened - a.lastOpened);

  allMetas.forEach(meta => {
    const li = document.createElement('li');
    li.className = 'recent-item';

    const info = document.createElement('div');
    info.className = 'recent-info';

    const name = document.createElement('span');
    name.className = 'recent-name';
    name.textContent = meta.name;

    const sub = document.createElement('span');
    sub.className = 'recent-meta';
    const sizeMB = (meta.size / (1024 * 1024)).toFixed(2);
    sub.textContent = `${sizeMB} MB • Page ${meta.currentPage} • ${new Date(meta.lastOpened).toLocaleDateString()}`;

    info.appendChild(name);
    info.appendChild(sub);
    li.appendChild(info);

    li.addEventListener('click', async (e) => {
      if (e.target.closest('.delete-btn')) return;

      showLoading(true, "Loading recent file...");
      try {
        const fileData = await getFromStore('files', meta.name);
        if (fileData && fileData.data) {
          await loadPDF(fileData.data, meta.name, meta.currentPage, meta.zoom);
        } else {
          alert(`File data for "${meta.name}" not found in storage.`);
          await deleteFromStore('files', meta.name);
          await deleteFromStore('metadata', meta.name);
          await deleteFromStore('bookmarks', meta.name);
          loadRecentFilesUI();
          showLoading(false);
        }
      } catch (err) {
        console.error("Error opening recent file:", err);
        showLoading(false);
      }
    });

    const delBtn = document.createElement('button');
    delBtn.className = 'delete-btn';
    delBtn.title = 'Remove from recent files';
    delBtn.innerHTML = `
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="3 6 5 6 21 6"></polyline>
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
      </svg>
    `;
    delBtn.addEventListener('click', async () => {
      if (confirm(`Remove "${meta.name}" from recent files? This will clear its saved progress and bookmarks.`)) {
        await deleteFromStore('files', meta.name);
        await deleteFromStore('metadata', meta.name);
        await deleteFromStore('bookmarks', meta.name);
        await loadRecentFilesUI();

        if (currentFileName === meta.name) {
          resetViewerToEmptyState();
        }
      }
    });

    li.appendChild(delBtn);
    container.appendChild(li);
  });
}

function resetViewerToEmptyState() {
  pdfDoc = null;
  currentFileName = '';
  document.getElementById('appSubtitle').textContent = 'Read local PDFs privately in your browser.';
  document.getElementById('emptyState').style.display = 'flex';
  document.getElementById('pdfContainer').style.display = 'none';
  enableControls(false);
  document.getElementById('outlineTree').innerHTML = '';
  document.getElementById('outlineEmpty').style.display = 'block';
  document.getElementById('bookmarksList').innerHTML = '';
  document.getElementById('bookmarksEmpty').style.display = 'block';
}

function showLoading(show, message = "Loading...") {
  const overlay = document.getElementById('loadingOverlay');
  const msg = document.getElementById('loadingMessage');
  msg.textContent = message;
  overlay.style.display = show ? 'flex' : 'none';
}

function enableControls(enabled) {
  document.getElementById('prevPageBtn').disabled = !enabled;
  document.getElementById('nextPageBtn').disabled = !enabled;
  document.getElementById('pageInput').disabled = !enabled;
  document.getElementById('zoomOutBtn').disabled = !enabled;
  document.getElementById('zoomInBtn').disabled = !enabled;
  document.getElementById('zoomResetBtn').disabled = !enabled;
  document.getElementById('bookmarkPageBtn').disabled = !enabled;
}

// Collapsible Sidebar Setup
const toggleSidebarBtn = document.getElementById('toggleSidebar');
const closeSidebarBtn = document.getElementById('closeSidebar');
const sidebar = document.getElementById('sidebar');

function toggleSidebar() {
  sidebar.classList.toggle('collapsed');
}

toggleSidebarBtn.addEventListener('click', toggleSidebar);
closeSidebarBtn.addEventListener('click', toggleSidebar);

// Tab Switching Setup
const tabBtns = document.querySelectorAll('.tab-btn');
tabBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    tabBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    const tab = btn.dataset.tab;
    document.querySelectorAll('.tab-panel').forEach(panel => {
      panel.classList.remove('active');
    });
    document.getElementById(`panel-${tab}`).classList.add('active');
  });
});

// Theme Toggle Integration
const themeToggle = document.querySelector("#themeToggle");
themeToggle.addEventListener("click", () => {
  document.documentElement.classList.toggle("dark");
  const isDarkMode = document.documentElement.classList.contains("dark");
  themeToggle.textContent = isDarkMode ? "Light mode" : "Dark mode";
});

// Event Listeners for PDF Controls
const fileInput = document.getElementById('fileInput');
fileInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file || file.type !== 'application/pdf') return;

  showLoading(true, "Reading file...");
  const reader = new FileReader();
  reader.onload = async (evt) => {
    const buffer = evt.target.result;
    await addRecentFile(file.name, file.size, buffer);
    await loadPDF(buffer, file.name, 1, 1.0);
  };
  reader.readAsArrayBuffer(file);
});

document.getElementById('prevPageBtn').addEventListener('click', () => {
  if (pdfDoc && currentPageNumber > 1) {
    renderPage(currentPageNumber - 1);
  }
});

document.getElementById('nextPageBtn').addEventListener('click', () => {
  if (pdfDoc && currentPageNumber < pdfDoc.numPages) {
    renderPage(currentPageNumber + 1);
  }
});

const pageInput = document.getElementById('pageInput');
pageInput.addEventListener('change', () => {
  let pageNum = parseInt(pageInput.value);
  if (isNaN(pageNum) || pageNum < 1) {
    pageInput.value = currentPageNumber;
    return;
  }
  if (pdfDoc && pageNum > pdfDoc.numPages) {
    pageNum = pdfDoc.numPages;
  }
  renderPage(pageNum);
});

document.getElementById('zoomOutBtn').addEventListener('click', () => changeZoom(-0.25));
document.getElementById('zoomInBtn').addEventListener('click', () => changeZoom(0.25));
document.getElementById('zoomResetBtn').addEventListener('click', () => changeZoom('reset'));
document.getElementById('bookmarkPageBtn').addEventListener('click', toggleCurrentPageBookmark);

const loadSampleBtn = document.getElementById('loadSampleBtn');
if (loadSampleBtn) {
  loadSampleBtn.addEventListener('click', async () => {
    showLoading(true, "Fetching sample PDF...");
    try {
      const response = await fetch('/sample.pdf');
      if (!response.ok) throw new Error("Failed to fetch sample PDF");
      const buffer = await response.arrayBuffer();
      await addRecentFile('sample.pdf', buffer.byteLength, buffer);
      await loadPDF(buffer, 'sample.pdf', 1, 1.0);
    } catch (err) {
      console.error("Error loading sample PDF:", err);
      alert("Could not load sample PDF. Please select a local PDF file instead.");
      showLoading(false);
    }
  });
}

// Keyboard Shortcuts Integration
window.addEventListener('keydown', (e) => {
  if (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA') {
    return;
  }

  if (e.key === 'ArrowRight' || e.key === 'PageDown') {
    if (pdfDoc && currentPageNumber < pdfDoc.numPages) {
      renderPage(currentPageNumber + 1);
    }
  } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
    if (pdfDoc && currentPageNumber > 1) {
      renderPage(currentPageNumber - 1);
    }
  } else if (e.key === 'Home') {
    if (pdfDoc) renderPage(1);
  } else if (e.key === 'End') {
    if (pdfDoc) renderPage(pdfDoc.numPages);
  } else if (e.ctrlKey && (e.key === '+' || e.key === '=')) {
    e.preventDefault();
    changeZoom(0.25);
  } else if (e.ctrlKey && e.key === '-') {
    e.preventDefault();
    changeZoom(-0.25);
  } else if (e.ctrlKey && e.key === '0') {
    e.preventDefault();
    changeZoom('reset');
  } else if (e.key.toLowerCase() === 'b') {
    toggleCurrentPageBookmark();
  } else if (e.key.toLowerCase() === 's') {
    toggleSidebar();
  } else if (e.key.toLowerCase() === 'd') {
    themeToggle.click();
  }
});

// App Startup Load
window.addEventListener('DOMContentLoaded', () => {
  loadRecentFilesUI();
});
