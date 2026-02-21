# Descargar YouTube Web

App web para pegar un link de YouTube, listar formatos y descargar en local usando `yt-dlp`.

Arquitectura recomendada:

- Frontend estático en Netlify (`public/`)
- Backend en Render (Node + `yt-dlp` + `ffmpeg` con Docker)

## Requisitos locales

- Node.js 18+
- `yt-dlp` instalado y accesible en PATH
- `ffmpeg` (recomendado para mergear audio+video)

Instalación rápida en macOS:

```bash
brew install yt-dlp ffmpeg
```

## Uso local (todo junto)

1. Instalar dependencias:

```bash
npm install
```

2. Levantar servidor:

```bash
npm run dev
```

3. Abrir:

```text
http://localhost:3000
```

4. En `Backend API URL` dejalo vacío para usar el mismo dominio local.

## Deploy backend en Render

Este repo ya incluye `Dockerfile` y `render.yaml`.

1. Subí el repo a GitHub.
2. En Render, crear `New +` -> `Blueprint` (o `Web Service` usando Dockerfile).
3. Seleccioná el repo.
4. Deploy.
5. Verificá salud en:

```text
https://tu-servicio.onrender.com/health
```

Debe devolver algo como:

```json
{"ok":true,"service":"descargar-youtube-web"}
```

## Deploy frontend en Netlify

1. Crear sitio desde repo en Netlify.
2. Configuración:
   - Build command: vacío
   - Publish directory: `public`
3. Deploy.
4. Abrí tu sitio Netlify y en el campo `Backend API URL` pegá:

```text
https://tu-servicio.onrender.com
```

5. Tocá `Guardar API`.

La URL queda guardada en `localStorage` del navegador.

## URLs de ejemplo

- `https://www.youtube.com/watch?v=lGSDHNIUhHA`
- `https://www.youtube.com/live/siGj2Q-og0g`

## Notas importantes

- El plan free de Render puede “dormir” el servicio por inactividad; la primera request puede tardar.
- No uses solo frontend para esto: descargar desde YouTube requiere backend.
- Usá esta herramienta solo con contenido que tengas derecho a descargar.

## Si aparece error anti-bot de YouTube

Para algunos videos YouTube exige sesión. En Render podés cargar cookies:

1. Exportá tus cookies de YouTube en formato `cookies.txt`.
2. Convertí a base64:

```bash
base64 -i cookies.txt
```

3. En Render -> Service -> Environment, creá:

```text
YTDLP_COOKIES_B64=<pegá_el_base64_completo>
```

4. Redeploy del servicio.
