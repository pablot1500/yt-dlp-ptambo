const apiBaseInput = document.getElementById('apiBaseInput');
const saveApiBtn = document.getElementById('saveApiBtn');
const urlInput = document.getElementById('urlInput');
const formatsBtn = document.getElementById('formatsBtn');
const formatSelect = document.getElementById('formatSelect');
const downloadBtn = document.getElementById('downloadBtn');
const statusBox = document.getElementById('status');
const API_STORAGE_KEY = 'yt_downloader_api_base';

function setStatus(message, type = '') {
  statusBox.textContent = message;
  statusBox.classList.remove('ok', 'err');
  if (type) statusBox.classList.add(type);
}

function resetFormats() {
  formatSelect.innerHTML = '<option value="">Primero cargá formatos</option>';
  formatSelect.disabled = true;
  downloadBtn.disabled = true;
}

function getUrl() {
  return urlInput.value.trim();
}

function normalizeBase(value) {
  const v = value.trim();
  if (!v) return '';
  try {
    const parsed = new URL(v);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return '';
    }
    // Use only origin for API base to avoid malformed patterns.
    return parsed.origin.replace(/\/+$/, '');
  } catch {
    return '';
  }
}

function getApiBase() {
  const normalized = normalizeBase(localStorage.getItem(API_STORAGE_KEY) || '');
  if (!normalized) {
    localStorage.removeItem(API_STORAGE_KEY);
  }
  return normalized;
}

function apiPath(path) {
  const base = getApiBase();
  return base ? `${base}${path}` : path;
}

function saveApiBase() {
  const raw = apiBaseInput.value.trim();
  if (!raw) {
    localStorage.removeItem(API_STORAGE_KEY);
    apiBaseInput.value = '';
    setStatus('API limpiada. Se usa el mismo dominio.', 'ok');
    return;
  }

  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('invalid_protocol');
    }
    const cleanBase = normalizeBase(parsed.toString());
    if (!cleanBase) {
      throw new Error('invalid_base');
    }
    localStorage.setItem(API_STORAGE_KEY, cleanBase);
    apiBaseInput.value = cleanBase;
    setStatus('API guardada correctamente.', 'ok');
  } catch {
    setStatus('La URL de API no es válida. Usá solo dominio, ej: https://tu-app.onrender.com', 'err');
  }
}

function formatBytes(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = n;
  let idx = 0;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx += 1;
  }
  const rounded = value >= 10 ? value.toFixed(0) : value.toFixed(1);
  return `${rounded} ${units[idx]}`;
}

function estimateBytes(format) {
  const direct = Number(format.filesize || 0);
  if (Number.isFinite(direct) && direct > 0) return direct;

  const tbr = Number(format.tbr || 0);
  const duration = Number(format.duration || 0);
  if (tbr > 0 && duration > 0) {
    return (tbr * 1000 * duration) / 8;
  }
  return 0;
}

function isUsefulMediaFormat(format) {
  if (!format?.formatId || !format?.ext) return false;
  const note = String(format.note || '').toLowerCase();
  if (format.ext === 'mhtml') return false;
  if (format.ext !== 'mp4') return false;
  if (format.formatId.startsWith('sb')) return false;
  if (note.includes('storyboard')) return false;

  const hasVideo = format.vcodec && format.vcodec !== 'none';
  return hasVideo;
}

async function fetchFormats() {
  const url = getUrl();
  if (!url) {
    setStatus('Pegá un link de YouTube.', 'err');
    return;
  }

  setStatus('Consultando formatos disponibles...');
  formatsBtn.disabled = true;
  resetFormats();

  try {
    const apiUrl = apiPath('/api/formats');
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Error desconocido.');

    const filtered = (data.formats || [])
      .filter(isUsefulMediaFormat)
      .map((f) => ({
        ...f,
        estimatedBytes: estimateBytes(f)
      }))
      .sort((a, b) => {
        const aVideo = a.vcodec && a.vcodec !== 'none' ? 1 : 0;
        const bVideo = b.vcodec && b.vcodec !== 'none' ? 1 : 0;
        if (aVideo !== bVideo) return bVideo - aVideo;
        return Number(b.estimatedBytes || 0) - Number(a.estimatedBytes || 0);
      });

    if (!filtered.length) {
      setStatus('No se encontraron formatos para ese link.', 'err');
      return;
    }

    formatSelect.innerHTML = '<option value="">Elegí un formato</option>';

    for (const f of filtered) {
      const opt = document.createElement('option');
      opt.value = f.formatId;
      const hasVideo = f.vcodec && f.vcodec !== 'none';
      const hasAudio = f.acodec && f.acodec !== 'none';
      const mediaType = hasVideo && hasAudio ? 'video+audio' : hasVideo ? 'video' : 'audio';
      const estLabel = formatBytes(f.estimatedBytes);
      const details = [
        mediaType,
        f.ext,
        f.resolution || 'res?',
        f.fps && f.fps !== 'NA' ? `${f.fps}fps` : '',
        f.note && f.note !== 'NA' ? f.note : ''
      ]
        .filter(Boolean)
        .join(' · ');
      opt.textContent = `${f.formatId} - ${details}${estLabel ? ` (${estLabel})` : ''}`;
      formatSelect.appendChild(opt);
    }

    formatSelect.disabled = false;
    setStatus(`Listo: ${filtered.length} formato(s) encontrados.`, 'ok');
  } catch (error) {
    const message =
      error?.message && error.message.includes('expected pattern')
        ? 'La URL de API guardada es inválida. Reconfigurala en "Backend API URL".'
        : error.message;
    setStatus(message, 'err');
  } finally {
    formatsBtn.disabled = false;
  }
}

async function downloadSelected() {
  const url = getUrl();
  const formatId = formatSelect.value;

  if (!url) {
    setStatus('Pegá un link de YouTube.', 'err');
    return;
  }

  if (!formatId) {
    setStatus('Seleccioná un formato antes de descargar.', 'err');
    return;
  }

  setStatus('Descargando... esto puede tardar según el tamaño.');
  downloadBtn.disabled = true;
  formatsBtn.disabled = true;

  try {
    const apiUrl = apiPath('/api/download');
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, formatId })
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || 'No se pudo descargar.');
    }

    const blob = await response.blob();
    const disposition = response.headers.get('content-disposition') || '';
    const match = disposition.match(/filename="?([^\"]+)"?/i);
    const filename = match?.[1] || 'video-descargado.mp4';

    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(objectUrl);

    setStatus(`Descarga completada: ${filename}`, 'ok');
  } catch (error) {
    const message =
      error?.message && error.message.includes('expected pattern')
        ? 'La URL de API guardada es inválida. Reconfigurala en "Backend API URL".'
        : error.message;
    setStatus(message, 'err');
  } finally {
    downloadBtn.disabled = false;
    formatsBtn.disabled = false;
  }
}

formatsBtn.addEventListener('click', fetchFormats);
saveApiBtn.addEventListener('click', saveApiBase);
apiBaseInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    saveApiBase();
  }
});
formatSelect.addEventListener('change', () => {
  downloadBtn.disabled = !formatSelect.value;
});
downloadBtn.addEventListener('click', downloadSelected);
urlInput.addEventListener('input', () => {
  if (!urlInput.value.trim()) {
    resetFormats();
    setStatus('');
  }
});

apiBaseInput.value = getApiBase();
