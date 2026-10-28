# Adley Machine Learning Tools

A login-protected, local-first image classification workflow. The server hosts the app and authenticates the team; **images never leave the browser**. Labels and copies are written directly to a result folder you choose with the File System Access API.

- **Free hosting on Render** with an HTTPS `*.onrender.com` URL. No VPS, domain, credit card, database, or Caddy required.
- **No built-in account.** The app refuses to start until you provide your own username, password hash, and a strong session secret.
- **No database.** No server database, no browser database, no dataset upload.
- **Default output: Flat by class.** Optional **Preserve source folder structure (Full mirror)**.
- **Crash-safe checkpoints** stored as files inside the result folder.
- **Pause, resume, skip, undo, retry**, recursive scans, destination previews, and collision-safe names.
- **Target browser:** Chrome or Edge on desktop over HTTPS (or `localhost`).

---

## 1. Architecture

```
Chrome / Edge on the user's computer
┌──────────────────────────────────────────────────────────┐
│ React UI                                                 │
│  ├─ scan worker      → discovers nested image metadata   │
│  ├─ preview worker   → decodes a few images at a time    │
│  ├─ copy workers     → source file → result file         │
│  └─ checkpoint writer → result/.adley-labeling/...       │
│                                                          │
│  File System Access API handles (never sent to server)   │
└───────────────────────────┬──────────────────────────────┘
                            │ HTTPS, signed session cookie
┌───────────────────────────▼──────────────────────────────┐
│ FastAPI on Render (or any Docker host)                   │
│  ├─ login / logout / me                                  │
│  ├─ per-IP sliding-window rate limiting (in memory)      │
│  ├─ CSRF origin checks + security headers                │
│  └─ serves the built React app                           │
│                                                          │
│  No database. No file uploads. No user data at rest.     │
└──────────────────────────────────────────────────────────┘
```

The server is stateless apart from in-memory rate-limit counters and the session-signing secret. Session cookies are signed with `itsdangerous`, expire after 12 hours by default, and are `HttpOnly` + `SameSite=Lax`.

A request never contains image bytes. The browser reads the source folder and writes labeled copies; the server only serves the app and checks the login session.

### Five-minute setup

1. Generate your password hash (the script prompts for the password):

   ```bash
   python3 scripts/hash_password.py
   ```

2. Generate a session secret:

   ```bash
   python3 -c "import secrets; print(secrets.token_urlsafe(48))"
   ```

3. Set `ADLEY_USERNAME`, `ADLEY_PASSWORD_HASH`, and `ADLEY_SESSION_SECRET` in your deployment environment. Never commit them.
4. Deploy with `render.yaml` or Docker Compose.
5. Sign in with the username and password you chose.

There is **no default account** and no fallback credential.

---

## 2. Deploy for free on Render (recommended)

Render is the primary deployment target. It provides:

- A free web service with **no credit card**.
- Automatic HTTPS at `https://<service-name>.onrender.com`.
- Docker builds from the included `Dockerfile`.
- Secret generation, deploy logs, health checks, and Git-based redeploys.
- No persistent server storage needed, because this app stores nothing on the server.

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/shynor-source/adley-machinelearning-tools)

### 2.1 Free-plan limits you should know

| Limit | What it means here |
| --- | --- |
| 0.1 CPU, 512 MB RAM | Fine for serving this small app; image work happens in the browser. |
| Spins down after 15 minutes idle | The next visit takes about a minute to wake. Render shows a loading page. |
| 750 instance hours / workspace / month | One always-on service would use roughly 730 hours; idle spin-down saves more. |
| 5 GB outbound bandwidth / month (Hobby workspace) | The app is small, but a very large number of page loads can use this up. |
| No persistent disk | Irrelevant: checkpoints and labeled images live in your local result folder. |
| Render may restart the service | In-memory rate limits reset. Login cookies remain valid while the secret stays the same. |

Render's free plan is suitable for a small team / hobby deployment, not for production-critical availability. If a request arrives during spin-up, wait for the loading page to finish.

Once the app is loaded and you are signed in, labeling is entirely local. If Render spins down while a tab is open, the current session keeps working; only a reload or a new login request needs the service to wake.

### 2.2 Prerequisites

- A [Render account](https://dashboard.render.com/register) (free, no card).
- A GitHub, GitLab, or Bitbucket account, and this project pushed to a repository.
- Python 3 on the computer used to generate the password hash.
- Chrome or Edge on a desktop for the people labeling images.

The repository can be public. It contains **no usable credentials**: no `.env`, no default account, no password hash, and no session secret. The login values exist only in Render's environment settings.

### 2.3 Push the project to a Git provider

If the project is not already a repository, from the project root:

```bash
git init -b main

# Only needed if Git has no identity configured on this machine:
git config user.name "Your Name"
git config user.email "you@example.com"

git add .
git commit -m "Adley Machine Learning Tools"
```

Create an empty repository on GitHub (or GitLab/Bitbucket; the commands below use GitHub). Do not initialize it with a README or `.gitignore`, then:

```bash
git remote add origin https://github.com/<your-account>/<your-repo>.git
git push -u origin main
```

`.gitignore` already excludes `.env`, key/certificate files, SSH keys, `frontend/node_modules`, `frontend/dist`, `backend/.venv`, and test caches. Check `git status` before every push.

### 2.4 Generate your credentials

Run these commands locally, from the repository root.

Choose a username and generate the password hash:

```bash
python3 scripts/hash_password.py
```

The script:

- Prompts for the password without echoing it.
- Requires at least 12 characters.
- Confirms the password.
- Uses 600,000 PBKDF2-SHA256 iterations by default.
- Refuses fewer than 100,000 iterations.
- Prints a hash shaped like `pbkdf2_sha256$600000$<salt>$<digest>`.

Keep the printed hash. You will paste it into Render in the next step. Do not add it to any file in the repository.

Generate the session secret:

```bash
python3 -c "import secrets; print(secrets.token_urlsafe(48))"
```

The secret must be at least 32 characters. The app also rejects known placeholder values.

### 2.5 Create the Blueprint

1. Open the [Render Dashboard](https://dashboard.render.com).
2. Click **New → Blueprint**.
3. Connect your Git provider and select the repository.
4. Render reads `render.yaml` and shows the service and its environment variables.
5. When prompted, enter:
   - **`ADLEY_USERNAME`** — the login name you chose.
   - **`ADLEY_PASSWORD_HASH`** — the hash printed by `scripts/hash_password.py`, pasted **without quotes**.
6. Leave **`ADLEY_SESSION_SECRET`** on the generated value. Render creates a unique secret and keeps it across deploys.
7. Click **Apply** or **Create Web Service**.

The Blueprint creates one Docker web service named `adley-ml-tools` on the **Free** plan, with:

- `healthCheckPath: /api/health`
- `ADLEY_COOKIE_SECURE=true`
- `ADLEY_TRUST_CLOUDFLARE=true`
- `ADLEY_TRUST_PROXY=false`
- A generated `ADLEY_SESSION_SECRET`
- Prompted `ADLEY_USERNAME` and `ADLEY_PASSWORD_HASH`
- Automatic redeploys on each commit to the connected branch

`sync: false` means Render does not take these two values from the repository; it asks for them during creation and does not overwrite your values on later Blueprint syncs.

The public URL is shown in the dashboard and looks like:

```text
https://adley-ml-tools.onrender.com
```

The `adley-ml-tools` name may already be taken. If Render reports a conflict, change `name:` in `render.yaml` before applying, for example `adley-ml-tools-yourname`. The service URL follows the name.

**Region:** the Blueprint defaults to `oregon`. You can change `region:` to `ohio`, `virginia`, `frankfurt`, or `singapore` before the first apply. Render cannot move an existing service between regions, so choose before deploying.

### 2.6 Environment variables

Required variables:

| Variable | Value | Purpose |
| --- | --- | --- |
| `ADLEY_USERNAME` | your login name | The only account name accepted at login. |
| `ADLEY_PASSWORD_HASH` | generated PBKDF2 hash | Verifies the password. Plaintext passwords are not supported. |
| `ADLEY_SESSION_SECRET` | 32+ random characters | Signs login cookies. Changing it signs everyone out. |

Render-specific variables:

| Variable | Value | Purpose |
| --- | --- | --- |
| `ADLEY_COOKIE_SECURE` | `true` | Cookies are only sent over HTTPS. Keep this on Render. |
| `ADLEY_TRUST_CLOUDFLARE` | `true` | Use Cloudflare's `CF-Connecting-IP` for per-IP rate limiting. Cloudflare overwrites it on every request to Render. |
| `ADLEY_TRUST_PROXY` | `false` | Do not trust caller-supplied `X-Forwarded-For` on Render; Cloudflare only appends to it. |
| `ADLEY_SESSION_MAX_AGE` | `43200` | Optional session lifetime in seconds (12 hours by default). |

The app validates all of this at startup and refuses to run if:

- Any required variable is missing or blank.
- `ADLEY_SESSION_SECRET` is shorter than 32 characters or is a known placeholder.
- `ADLEY_PASSWORD_HASH` is malformed, uses another algorithm, or has fewer than 100,000 PBKDF2 iterations.

A failed startup appears in the Render logs. The health check never passes until the configuration is fixed.

**Plaintext passwords:** `ADLEY_PASSWORD` is intentionally not supported. Only `ADLEY_PASSWORD_HASH` is read, so a stray plaintext password cannot silently override the hash.

### 2.7 First deploy and sign in

1. Watch the deploy logs under **Deploys** until the build and health check pass.
2. Open the `onrender.com` URL.
3. Sign in with:
   - The `ADLEY_USERNAME` you entered.
   - The password you typed into `scripts/hash_password.py`.

There is no default login to try. If the app was asleep, the first request may show Render's loading page for about a minute.

### 2.8 Change the username or password

Generate a new hash locally:

```bash
python3 scripts/hash_password.py
```

Then in the Render Dashboard:

1. Open the service → **Environment**.
2. Edit `ADLEY_USERNAME` and/or `ADLEY_PASSWORD_HASH`.
3. Paste the hash **without quotes**. It looks like `pbkdf2_sha256$600000$...$...`.
4. Choose **Save and deploy** (or save and trigger a manual deploy). The app reads the new values at startup.

Changing the password does **not** invalidate existing signed sessions. To sign everyone out immediately, also replace `ADLEY_SESSION_SECRET` with a new random value. That invalidates every existing cookie.

### 2.9 Update the app

Push to the connected branch:

```bash
git add .
git commit -m "Update"
git push
```

Render rebuilds and redeploys automatically. There is no database migration. You can also click **Manual Deploy → Deploy latest commit** in the dashboard.

Because the container is stateless, a redeploy does not touch checkpoints or images on the labeling computers.

### 2.10 Manual setup (without the Blueprint)

If you prefer not to use `render.yaml`:

1. **New → Web Service** and select the repository.
2. Set **Language** to **Docker**.
3. Choose the **Free** plan.
4. Set **Health Check Path** to `/api/health`.
5. Add these environment variables:
   - `ADLEY_USERNAME=<your login name>`
   - `ADLEY_PASSWORD_HASH=<hash from scripts/hash_password.py>`
   - `ADLEY_SESSION_SECRET=<48+ random characters>`
   - `ADLEY_COOKIE_SECURE=true`
   - `ADLEY_TRUST_CLOUDFLARE=true`
   - `ADLEY_TRUST_PROXY=false`
6. Click **Create Web Service**.

The service will fail its health check if any required value is missing. Check the logs; the startup error names the missing variable.

The manual route does not auto-deploy from a *public repository URL*. Connect your Git provider if you want automatic deploys.

The image is otherwise portable: any Docker host that injects `PORT`, provides HTTPS in front of the container, and sets the same environment variables can run it. Render is documented here because it has a no-card free tier and an automatic `onrender.com` HTTPS URL.

### 2.11 Custom domain (optional)

You do not need one. If you later buy a domain, add it in the Render Dashboard under **Settings → Custom Domains** and follow the DNS instructions. Render issues and renews the TLS certificate automatically.

---

## 3. Optional: self-host with Docker Compose + Caddy

> This section is only for people who already have a VPS and a domain. It is **not** needed for Render.

### Requirements

- A Linux VPS with Docker Engine and Docker Compose v2.
- A domain whose DNS `A`/`AAAA` record points at the VPS.
- Ports 80 and 443 reachable from the internet (Caddy gets TLS certificates automatically).

### Steps

```bash
git clone <your-repo-url> adley-machine-learning-tools
cd adley-machine-learning-tools

cp .env.example .env
chmod 600 .env
```

Edit `.env` and fill in every required value:

1. Set `ADLEY_DOMAIN` and `ACME_EMAIL`.
2. Set `ADLEY_USERNAME` to your chosen login name.
3. Generate and set `ADLEY_PASSWORD_HASH`:
   ```bash
   python3 scripts/hash_password.py
   ```
   Put the result in `.env`, **single-quoted** so Compose does not treat `$` as variable interpolation:
   ```dotenv
   ADLEY_PASSWORD_HASH='pbkdf2_sha256$600000$...$...'
   ```
4. Set `ADLEY_SESSION_SECRET` to a long random value:
   ```bash
   python3 -c "import secrets; print(secrets.token_urlsafe(48))"
   ```
   It must be at least 32 characters. With `ADLEY_COOKIE_SECURE=true`, the app refuses to start if it is missing, too short, or a known placeholder.
5. Keep `ADLEY_COOKIE_SECURE=true`, `ADLEY_TRUST_PROXY=true`, and `ADLEY_TRUST_CLOUDFLARE=false` unless Cloudflare is in front of Caddy.

Start the stack:

```bash
docker compose up -d --build
docker compose logs -f caddy app
```

Open `https://<ADLEY_DOMAIN>` and sign in with your chosen credentials.

The app container is only exposed on the internal Docker network. Caddy is the sole public entry point and forwards the real client IP for rate limiting.

### Updating / stopping

```bash
git pull
docker compose up -d --build

# Stop:
docker compose down
```

No database migration is needed because there is no database. Caddy's certificates live in the `caddy_data` volume and survive restarts.

---

## 4. Local development

### Configure local credentials

```bash
cp .env.example .env
chmod 600 .env
```

Edit `.env`:

```dotenv
ADLEY_USERNAME=your-local-name
ADLEY_PASSWORD_HASH='<hash from scripts/hash_password.py>'
ADLEY_SESSION_SECRET=<48+ random characters>
ADLEY_COOKIE_SECURE=false
ADLEY_TRUST_PROXY=false
ADLEY_TRUST_CLOUDFLARE=false
```

The backend loads `.env` from the repository root automatically. Never commit `.env`.

### Backend

```bash
cd backend
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements-dev.txt
uvicorn app.asgi:app --reload --port 8000
```

### Frontend

In a second terminal:

```bash
cd frontend
npm install
npm run dev
```

Open <http://localhost:5173>. Vite proxies `/api` to the backend on port 8000.

To exercise the production path locally (FastAPI serving the built SPA):

```bash
cd frontend
npm run build

cd ../backend
. .venv/bin/activate
uvicorn app.asgi:app --port 8000
```

Open <http://localhost:8000>. `localhost` counts as a secure context for the File System Access API.

### Container-like port test

To simulate Render's `$PORT` handling, build the image and run it with a non-default port:

```bash
docker build -t adley-ml-tools .
docker run --rm -p 10000:10000 \
  -e PORT=10000 \
  -e ADLEY_COOKIE_SECURE=false \
  -e ADLEY_TRUST_PROXY=false \
  -e ADLEY_USERNAME='your-local-name' \
  -e ADLEY_PASSWORD_HASH='<generated-hash>' \
  -e ADLEY_SESSION_SECRET='<generated-secret>' \
  adley-ml-tools
```

Open <http://localhost:10000>. Keep the hash and secret single-quoted so the shell does not expand `$`.

### Tests

```bash
cd backend && .venv/bin/pytest -q
cd frontend && npm test
cd frontend && npx tsc --noEmit
cd frontend && npm run build
```

The backend tests expect the virtual environment created above.

---

## 5. Using the labeling workspace

1. **New session.**
   - Name the session.
   - Add 1–20 classes. Class names must be unique; unsafe filesystem characters are replaced automatically.
   - Choose a **source folder** (read-only) containing images.
   - Choose a **result folder** (read + write) for labeled copies and checkpoints.
   - Choose **Flat by class** (default) or **Preserve source folder structure (Full mirror)**.
   - Run the recursive scan and review the destination preview.
2. **Label.**
   - Click a class or press `1`…`9`, `0` for classes 1–10.
   - For classes 11–20, press `Shift+1`…`Shift+0`.
   - `S` or `→` skips the current image.
   - `U` or `Ctrl/Cmd+Z` undoes the most recent label or skip.
   - `Space` or `P` pauses/resumes.
   - The preview is decoded off the main thread. Only a small number of nearby images are decoded at a time.
3. **Pause / resume.** Pausing stops accepting new labels; already queued copy tasks finish. Resume continues from the first unhandled image.
4. **Failures.** Copy failures are recorded in the checkpoint and listed in the right panel. Retry one or all; retries never overwrite an existing file.
5. **Finish.** When the queue is complete, the workspace shows totals and links to start another session or reconnect a checkpoint.
6. **Resume later.**
   - Open **Resume session**, choose the same **result folder**, select a checkpoint, then reconnect the original **source folder**.
   - A warning is shown if the source folder name differs; the app also samples the first few manifest paths to catch obvious mismatches.
   - Browsers intentionally discard File System Access handles on reload, so re-picking both folders is required. Nothing is stored in `localStorage` or IndexedDB.

### Keyboard notes

Keyboard handling is ignored while typing in an input or dialog. Class shortcuts use physical digit keys, so `Shift+1` means class 11 regardless of keyboard layout punctuation.

---

## 6. Result layout and collision handling

### Flat by class (default)

Every discovered image enters one queue. Copies go directly into `<result>/<class-folder>/`.

```
result/
├── cats/
│   ├── photo.jpg
│   └── photo__1.jpg        # collision with an existing file
├── dogs/
│   └── photo.jpg
└── .adley-labeling/        # hidden checkpoint folder
    └── <session-id>/
        ├── session.json
        ├── manifest.jsonl
        └── progress.jsonl
```

### Full mirror

The source-relative parent is recreated, and the class folder is placed **inside that same parent**:

```
source/train/cats/photo.jpg  →  result/train/cats/cats/photo.jpg
source/root-photo.jpg        →  result/cats/root-photo.jpg
```

This preserves every source directory while still grouping each directory's copied images by class.

### Filenames

- The original filename is kept when possible.
- Conflicts become `name__1.ext`, `name__2.ext`, and so on.
- Before copying, the app checks both the in-session reserved set and the actual result folder.
- Existing files are never overwritten or deleted by labeling.
- If a destination changes because of a race or reconciliation, a `dest` correction event is appended to the checkpoint.

### Source/result rules

- Source and result must be different folders.
- The source cannot be inside the result folder.
- The result **can** be inside the source folder; the app excludes that result subtree from scanning and warns you.
- Copy operations only read source files. Originals are never modified, moved, or deleted.

---

## 7. Checkpoints and resume semantics

Each session writes three files under:

```
<result>/.adley-labeling/<session-id>/
```

| File | Purpose |
| --- | --- |
| `session.json` | Session id, name, classes, output mode, source/result names, totals, summary counts, timestamps. |
| `manifest.jsonl` | One JSON record per discovered image: relative path, parent directory, filename, byte size, last-modified time. |
| `progress.jsonl` | Append-only event log. The source of truth for labels, destinations, copies, skips, undos, retries, and completion. |

### Event types

- `label` — class assignment and initially allocated destination.
- `dest` — destination correction (collision/race).
- `copy_done` — copy completed with byte count.
- `copy_error` — copy failed with an error message.
- `retry` — retry started for an existing destination.
- `skip` — image intentionally skipped.
- `undo` — undo of a label or skip.
- `finished` — completion summary marker.

### Resume reconciliation

On reconnect, the app replays `progress.jsonl` and verifies every labeled destination against the real result folder:

- **Copied + size matches** → keep as completed; never relabel.
- **State says copying/preparing but destination size matches** → mark copied.
- **Destination missing** → retry the same destination.
- **Destination exists but size differs** → allocate a new collision-safe name, append `dest`, and retry; never overwrite the mismatched file.
- **Failed copy** → leave failed until you retry, unless the destination now matches exactly.
- **Skipped** → remain skipped (undoable).

The checkpoint is written as the session runs. If checkpoint writing fails, the session pauses and surfaces an error instead of continuing without recoverability.

### Undo semantics

- Undo removes the latest label or skip action and returns the image to the queue.
- For labels, the copied file is removed only when the session can attribute it safely and its size still matches the expected size.
- Undo cleanup may finish in the background. A copy that finishes after undo is cleaned up by the same size check.
- A crash can leave a partial file; resume reconciliation detects the size mismatch and chooses a new destination rather than reusing the partial file.

---

## 8. Security notes

- **No built-in account or secret.** Startup fails unless `ADLEY_USERNAME`, `ADLEY_PASSWORD_HASH`, and `ADLEY_SESSION_SECRET` are supplied through the environment.
- **Passwords are never stored in plaintext.** The app reads a PBKDF2-SHA256 hash with at least 100,000 iterations. `ADLEY_PASSWORD` is ignored.
- **Cookie:** HttpOnly, SameSite=Lax, signed, 12-hour lifetime by default, Secure in production.
- **CSRF:** unsafe `/api/*` requests reject cross-site `Sec-Fetch-Site` and mismatched `Origin`/`Referer`.
- **Rate limits:** per client IP, in memory, for login, API, and page/asset traffic. On Render the client IP comes from Cloudflare's `CF-Connecting-IP`; on the optional Caddy setup it comes from Caddy's overwritten `X-Forwarded-For`. Health checks are exempt so Render (or a load balancer) can probe `/api/health` without consuming the API bucket. Failed logins also trigger a temporary block.
- **Headers:** CSP, `X-Content-Type-Options`, `X-Frame-Options: DENY`, Referrer-Policy, CORP/COOP, Permissions-Policy, HSTS over HTTPS, `Cache-Control: no-store` on API responses.
- **No uploads:** there are no dataset upload endpoints. The backend never receives image bytes.
- **No database:** there is nothing to migrate and no server-side dataset metadata.
- **Public repository safe:** `.env`, keys, certificates, virtual environments, and build output are ignored. Only the blank `.env.example` template is tracked.

### Production checklist

- [ ] Generate a unique `ADLEY_PASSWORD_HASH` with `scripts/hash_password.py`; never commit it or a plaintext password.
- [ ] Generate a unique `ADLEY_SESSION_SECRET` with at least 32 characters. Render's Blueprint does this automatically; a manual or VPS setup must set it.
- [ ] Set `ADLEY_USERNAME` to your own login name. There is no default account.
- [ ] Keep `ADLEY_COOKIE_SECURE=true` on Render or any HTTPS host.
- [ ] On Render, keep `ADLEY_TRUST_CLOUDFLARE=true` and `ADLEY_TRUST_PROXY=false`. On the optional Caddy setup, use `ADLEY_TRUST_PROXY=true` and `ADLEY_TRUST_CLOUDFLARE=false` unless Cloudflare is in front.
- [ ] Do not publish the app container port directly on a self-hosted machine; let Caddy (or Render) be the only entry point.
- [ ] Keep `.env` at mode `600` and confirm `git status` shows no credentials before every push.
- [ ] Rotate both the password hash and `ADLEY_SESSION_SECRET` if a credential may have leaked. Rotating the secret signs everyone out.
- [ ] Back up result folders from the computers doing the labeling; checkpoints and copies live there, not on the server.
- [ ] Keep one app worker. Rate-limit state is deliberately in memory, so multiple workers would each enforce their own counters.

### Trusted proxies

On Render, set `ADLEY_TRUST_CLOUDFLARE=true` and leave `ADLEY_TRUST_PROXY=false`. Public Render web services sit behind Cloudflare, which overwrites `CF-Connecting-IP` with the real client address. Cloudflare only appends to `X-Forwarded-For`, so its leftmost value can be supplied by the caller and must not be used for rate limiting.

On a self-hosted VPS, `ADLEY_TRUST_PROXY=true` is safe only when the app cannot be reached directly. The provided Compose setup exposes the app solely to Caddy, and Caddy overwrites incoming forwarding headers with the real remote address.

If you publish the app port directly, set `ADLEY_TRUST_PROXY=false` and `ADLEY_TRUST_CLOUDFLARE=false`, or clients can spoof their IP and evade rate limits.

`ADLEY_TRUST_CLOUDFLARE=true` tells the app to prefer `CF-Connecting-IP`, which Cloudflare sets and overwrites. This applies on Render, and on the optional VPS setup when Cloudflare proxies traffic to Caddy. If you put Cloudflare in front of a VPS, use **Full (strict)** TLS and firewall the origin so only Cloudflare's IP ranges can reach ports 80/443.

Cookie invalidation: changing `ADLEY_PASSWORD_HASH` does **not** invalidate existing signed sessions. Replace `ADLEY_SESSION_SECRET` to force everyone to log in again.

---

## 9. Operational limits and known constraints

- Classification only. Object detection, segmentation, tabular, and text tools are placeholders.
- Chrome/Edge desktop is required. Firefox, Safari, and mobile browsers show a compatibility screen.
- File System Access requires a secure context (HTTPS or localhost). Render's `onrender.com` URL is HTTPS, so it works without a custom domain.
- One active labeling session per tab. Opening another session closes the current one after confirmation; its checkpoint remains resumable.
- Up to 20 classes per session.
- Class folder names are sanitized for Windows/macOS/Linux compatibility. Names that collapse to the same folder are rejected.
- The scan and manifest handle nested folders recursively and are intended for multi-GB datasets; progress events and manifests are streamed/appended rather than held as one giant JSON document. Resume still replays progress and reads the manifest, so extremely large file counts can take time to restore.
- Copies require free disk space equal to the sum of labeled files. A failed copy is recorded, not silently ignored.
- Image previews are decoded at a maximum of 2400 px on the longest side to bound memory.
- Rate-limit counters reset when the app restarts or Render spins the service down. This is intentional for a stateless single-node deployment.
- Render's free service can restart at any time. A restart does not affect local checkpoints or images; it only clears in-memory rate-limit counters.
- The login system supports a single team account, not per-user accounts or audit trails.

---

## 10. Project layout

```
backend/
  app/
    asgi.py          production ASGI entrypoint
    auth.py          login/logout/me and signed cookie
    config.py        environment loading and fail-closed validation
    main.py          FastAPI app factory, startup checks, SPA serving
    middleware.py    origin checks and security headers
    rate_limit.py    per-IP sliding window and failed-login guard
    security.py      PBKDF2 verification and signed tokens
  tests/             pytest suite
frontend/
  src/
    components/      shell, browser gate, UI primitives
    context/         auth and active session providers
    lib/
      path.ts        destinations, sanitization, collisions
      checkpoint.ts  schema, replay, reconciliation decisions
      session.ts     runtime, copy queue, pause/skip/undo/resume
      *.worker.ts    scan, preview, copy workers
    pages/           login, dashboard, new/resume/workspace
deploy/Caddyfile     optional VPS TLS/compression/proxy config
Dockerfile           multi-stage frontend + FastAPI image
docker-compose.yml   optional app + Caddy stack, no database
render.yaml          Render Blueprint (primary deployment)
scripts/             interactive password hash helper
.env.example         blank template; no real credentials
```

---

## 11. Troubleshooting

**Startup fails with `Missing required environment variables`**  
Set `ADLEY_USERNAME`, `ADLEY_PASSWORD_HASH`, and `ADLEY_SESSION_SECRET`. On Render, the Blueprint prompts for the first two and generates the third. On a manual service, add them in **Environment** and redeploy.

**Startup fails with `ADLEY_PASSWORD_HASH is not a valid PBKDF2-SHA256 hash`**  
Generate a fresh hash with `python3 scripts/hash_password.py` and paste it without quotes. Make sure you did not paste a plaintext password or truncate the value.

**Startup fails with `ADLEY_SESSION_SECRET must be at least 32 characters`**  
Generate a new secret with `python3 -c "import secrets; print(secrets.token_urlsafe(48))"` and set it as `ADLEY_SESSION_SECRET`. Do not use the example text.

**Render deploy fails because the service does not bind to a port**  
The container command must bind `0.0.0.0` on `$PORT`. The included Dockerfile does this with an `8000` fallback for Compose. Check the deploy logs for the uvicorn startup line and confirm no `dockerCommand` override in Render.

**The first page load takes about a minute**  
The free service was asleep. Render wakes it on the next request and shows a loading page. Subsequent requests are fast until it idles again.

**“Frontend is not built”**  
Run `cd frontend && npm run build`, or use the Vite dev server. In Docker/Render, rebuild the image.

**Login rejects the username or password**  
Use the exact `ADLEY_USERNAME` value from the environment. Passwords are case-sensitive. If you changed `ADLEY_PASSWORD_HASH`, redeploy so the app reloads it. A stale browser cookie is not the cause of a rejected fresh login.

**Everyone was signed out after a deploy**  
`ADLEY_SESSION_SECRET` changed, which invalidates every existing cookie. Keep Render's generated value stable unless you intentionally want to force sign-out.

**Folder picker is missing / compatibility screen**  
Use current Chrome or Edge on a desktop. Check that the site is HTTPS (or localhost). Embedded webviews may not support the API.

**“Folder permission was not granted”**  
Pick the folder again and accept the browser permission prompt. After a reload, handles must be reconnected manually; this is a browser privacy rule.

**“Checkpoint is incomplete: expected N images, found M”**  
The manifest write did not finish. The partial session is intentionally ignored when listing checkpoints. Start a new session; do not edit checkpoint files by hand unless you are recovering data.

**Copies fail with missing files**  
The source folder may have been renamed, moved, or disconnected. Reconnect the original source (not a parent or copy). Failed copies can be retried from the workspace.

**Login rate limit / blocked**  
Wait for the `Retry-After` period. Limits are per client IP and reset on app restart or Render spin-down.

**TLS certificate fails (self-hosted VPS only)**  
Confirm DNS points at the VPS and ports 80/443 are open. Check `docker compose logs caddy`. If using Cloudflare proxy, verify TLS mode and consider DNS-01 or temporarily switching to DNS-only while issuing the certificate. Render manages its own certificates; there is nothing to configure there.
