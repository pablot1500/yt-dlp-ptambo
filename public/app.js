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
  return v.replace(/\/+$/, '');
}

function getApiBase() {
  return normalizeBase(localStorage.getItem(API_STORAGE_KEY) || '');
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
    localStorage.setItem(API_STORAGE_KEY, normalizeBase(parsed.toString()));
    apiBaseInput.value = normalizeBase(parsed.toString());
    setStatus('API guardada correctamente.', 'ok');
  } catch {
    setStatus('La URL de API no es válida.', 'err');
  }
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
    const response = await fetch(apiPath('/api/formats'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Error desconocido.');

    const filtered = (data.formats || []).filter((f) => f.formatId && f.ext);

    if (!filtered.length) {
      setStatus('No se encontraron formatos para ese link.', 'err');
      return;
    }

    formatSelect.innerHTML = '<option value="">Elegí un formato</option>';

    for (const f of filtered) {
      const opt = document.createElement('option');
      opt.value = f.formatId;
      const details = [
        f.ext,
        f.resolution || 'res?',
        f.fps && f.fps !== 'NA' ? `${f.fps}fps` : '',
        f.note && f.note !== 'NA' ? f.note : ''
      ]
        .filter(Boolean)
        .join(' · ');
      opt.textContent = `${f.formatId} - ${details}`;
      formatSelect.appendChild(opt);
    }

    formatSelect.disabled = false;
    setStatus(`Listo: ${filtered.length} formato(s) encontrados.`, 'ok');
  } catch (error) {
    setStatus(error.message, 'err');
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
    const response = await fetch(apiPath('/api/download'), {
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
    setStatus(error.message, 'err');
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
