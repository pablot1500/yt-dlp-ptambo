const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DOWNLOADS_DIR = path.join(__dirname, 'downloads');
const LIST_FORMATS_SCRIPT = path.join(__dirname, 'scripts', 'list_formats.py');
const MAX_BODY_SIZE = '1mb';
const TMP_COOKIES_FILE = '/tmp/yt-cookies.txt';

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

function getCookieFilePath() {
  if (process.env.YTDLP_COOKIES_B64) {
    try {
      const cookiesTxt = Buffer.from(process.env.YTDLP_COOKIES_B64, 'base64').toString('utf8');
      if (cookiesTxt.includes('youtube.com')) {
        fs.writeFileSync(TMP_COOKIES_FILE, cookiesTxt, 'utf8');
        return TMP_COOKIES_FILE;
      }
    } catch {
      // Ignore invalid base64 and continue without cookies.
    }
  } else if (process.env.YTDLP_COOKIES_FILE && fs.existsSync(process.env.YTDLP_COOKIES_FILE)) {
    return process.env.YTDLP_COOKIES_FILE;
  } else if (process.env.YTDLP_COOKIES_FROM_BROWSER) {
    return `browser:${process.env.YTDLP_COOKIES_FROM_BROWSER}`;
  }

  return '';
}

function getYtDlpAuthArgs() {
  const args = [];
  const cookiePath = getCookieFilePath();
  if (!cookiePath) return args;

  if (cookiePath.startsWith('browser:')) {
    args.push('--cookies-from-browser', cookiePath.replace('browser:', ''));
  } else {
    args.push('--cookies', cookiePath);
  }
  return args;
}

function buildYtDlpArgs(extraArgs) {
  return [
    '--ignore-config',
    '--no-warnings',
    ...getYtDlpAuthArgs(),
    ...extraArgs
  ];
}

function explainYtDlpError(errorMessage) {
  const message = String(errorMessage || '');
  if (message.includes('Sign in to confirm you’re not a bot') || message.includes("Sign in to confirm you're not a bot")) {
    return 'YouTube está pidiendo verificación anti-bot para ese video. Configurá cookies de YouTube en el backend (Render env `YTDLP_COOKIES_B64`) e intentá de nuevo.';
  }
  return message;
}

function runPythonFormats(url) {
  return new Promise((resolve, reject) => {
    const cookiePath = getCookieFilePath();
    const args = [LIST_FORMATS_SCRIPT, url];
    if (cookiePath && !cookiePath.startsWith('browser:')) {
      args.push(cookiePath);
    }

    const child = spawn('python3', args, { stdio: ['ignore', 'pipe', 'pipe'] });
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
        resolve(stdout);
      } else {
        reject(new Error(stderr || stdout || `Python formats script finalizo con codigo ${code}`));
      }
    });
  });
}

async function resolveDownloadFormat(url, formatId) {
  try {
    const stdout = await runPythonFormats(url);
    const metadata = JSON.parse(stdout);
    const target = (metadata.formats || []).find((f) => String(f.format_id) === String(formatId));
    if (!target) return formatId;

    const hasVideo = target.vcodec && target.vcodec !== 'none';
    const hasAudio = target.acodec && target.acodec !== 'none';

    // If selected stream is video-only, force merge with best available audio.
    if (hasVideo && !hasAudio) {
      return `${formatId}+bestaudio[ext=m4a]/${formatId}+bestaudio/best[ext=mp4]/best`;
    }
    return formatId;
  } catch {
    return formatId;
  }
}

app.post('/api/formats', async (req, res) => {
  const { url } = req.body || {};

  if (!url || !isYoutubeUrl(url)) {
    return res.status(400).json({ error: 'URL invalida de YouTube.' });
  }

  try {
    const stdout = await runPythonFormats(url);
    const metadata = JSON.parse(stdout);
    const formats = (metadata.formats || []).map((f) => {
      return {
        videoId: metadata.id || '',
        duration: metadata.duration || 0,
        formatId: f.format_id || '',
        ext: f.ext || '',
        resolution: f.resolution || (f.width && f.height ? `${f.width}x${f.height}` : 'audio'),
        fps: f.fps || '',
        vcodec: f.vcodec || '',
        acodec: f.acodec || '',
        note: f.format_note || '',
        protocol: f.protocol || '',
        filesize: f.filesize || f.filesize_approx || '',
        tbr: f.tbr || 0
      };
    });

    return res.json({ formats });
  } catch (error) {
    return res.status(500).json({ error: `No pude obtener formatos: ${explainYtDlpError(error.message)}` });
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
    const requestTag = `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const outputTemplate = path.join(DOWNLOADS_DIR, `%(title)s [%(id)s] [${requestTag}].%(ext)s`);
    const resolvedFormat = await resolveDownloadFormat(url, formatId);
    const args = buildYtDlpArgs([
      '--newline',
      '--no-progress',
      '-f',
      resolvedFormat,
      '--merge-output-format',
      'mp4',
      '--print',
      'after_move:filepath',
      '-o',
      outputTemplate,
      url
    ]);

    const { stdout: downloadStdout } = await runYtDlp(args);
    const candidate = downloadStdout
      .split('\n')
      .map((v) => v.trim())
      .filter(Boolean)
      .find((line) => line.startsWith(DOWNLOADS_DIR) && line.includes(requestTag) && fs.existsSync(line));

    if (!candidate || !fs.existsSync(candidate)) {
      const recent = fs
        .readdirSync(DOWNLOADS_DIR)
        .filter((file) => file.includes(requestTag))
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
    return res.status(500).json({ error: `Error al descargar: ${explainYtDlpError(error.message)}` });
  }
});

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'descargar-youtube-web' });
});

app.listen(PORT, () => {
  console.log(`Servidor listo en http://localhost:${PORT}`);
  console.log(`Descargas en: ${DOWNLOADS_DIR}`);
});
