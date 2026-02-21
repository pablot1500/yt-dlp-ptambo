const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DOWNLOADS_DIR = path.join(__dirname, 'downloads');
const MAX_BODY_SIZE = '1mb';

if (!fs.existsSync(DOWNLOADS_DIR)) {
  fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
}

app.use(cors());
app.use(express.json({ limit: MAX_BODY_SIZE }));
app.use(express.static(PUBLIC_DIR));

function isYoutubeUrl(url) {
  try {
    const parsed = new URL(url);
    return [
      'youtube.com',
      'www.youtube.com',
      'm.youtube.com',
      'youtu.be'
    ].includes(parsed.hostname);
  } catch {
    return false;
  }
}

function runYtDlp(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('yt-dlp', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (err) => reject(err));
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(stderr || stdout || `yt-dlp finalizo con codigo ${code}`));
      }
    });
  });
}

app.post('/api/formats', async (req, res) => {
  const { url } = req.body || {};

  if (!url || !isYoutubeUrl(url)) {
    return res.status(400).json({ error: 'URL invalida de YouTube.' });
  }

  try {
    const { stdout } = await runYtDlp([
      '--no-warnings',
      '-J',
      url
    ]);

    const metadata = JSON.parse(stdout);
    const formats = (metadata.formats || []).map((f) => {
      return {
        videoId: metadata.id || '',
        formatId: f.format_id || '',
        ext: f.ext || '',
        resolution: f.resolution || (f.width && f.height ? `${f.width}x${f.height}` : 'audio'),
        fps: f.fps || '',
        vcodec: f.vcodec || '',
        acodec: f.acodec || '',
        note: f.format_note || '',
        protocol: f.protocol || '',
        filesize: f.filesize || f.filesize_approx || ''
      };
    });

    return res.json({ formats });
  } catch (error) {
    return res.status(500).json({ error: `No pude obtener formatos: ${error.message}` });
  }
});

app.post('/api/download', async (req, res) => {
  const { url, formatId } = req.body || {};

  if (!url || !isYoutubeUrl(url)) {
    return res.status(400).json({ error: 'URL invalida de YouTube.' });
  }

  if (!formatId) {
    return res.status(400).json({ error: 'Falta formatId.' });
  }
  if (!/^[a-zA-Z0-9+._-]+$/.test(formatId)) {
    return res.status(400).json({ error: 'formatId invalido.' });
  }

  try {
    const outputTemplate = path.join(DOWNLOADS_DIR, '%(title)s [%(id)s].%(ext)s');
    const args = [
      '--no-warnings',
      '--newline',
      '-f',
      formatId,
      '-o',
      outputTemplate,
      url
    ];

    // Si hay ffmpeg disponible, yt-dlp mergea audio+video cuando aplica.
    await runYtDlp(args);

    const { stdout: filenameStdout } = await runYtDlp([
      '--no-warnings',
      '--print',
      path.join(DOWNLOADS_DIR, '%(title)s [%(id)s].%(ext)s'),
      '-f',
      formatId,
      '--simulate',
      url
    ]);

    const candidate = filenameStdout.split('\n').map((v) => v.trim()).filter(Boolean).pop();

    if (!candidate || !fs.existsSync(candidate)) {
      const recent = fs
        .readdirSync(DOWNLOADS_DIR)
        .map((file) => ({
          file,
          mtime: fs.statSync(path.join(DOWNLOADS_DIR, file)).mtimeMs
        }))
        .sort((a, b) => b.mtime - a.mtime)[0];

      if (!recent) {
        return res.status(500).json({ error: 'La descarga termino pero no encontre el archivo.' });
      }

      const fallbackPath = path.join(DOWNLOADS_DIR, recent.file);
      return res.download(fallbackPath, recent.file);
    }

    return res.download(candidate, path.basename(candidate));
  } catch (error) {
    return res.status(500).json({ error: `Error al descargar: ${error.message}` });
  }
});

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'descargar-youtube-web' });
});

app.listen(PORT, () => {
  console.log(`Servidor listo en http://localhost:${PORT}`);
  console.log(`Descargas en: ${DOWNLOADS_DIR}`);
});
