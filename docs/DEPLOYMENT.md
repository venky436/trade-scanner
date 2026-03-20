# Deployment Guide — Trading Scanner

This document covers the full deployment of the real-time trading scanner to a DigitalOcean droplet, from provisioning to production HTTPS with WebSocket support.

---

## Architecture Overview

```
Browser
  |
  ├── HTTPS ──→ Nginx (SSL termination)
  │                ├── /         → Next.js frontend (:3000)
  │                ├── /api      → Fastify backend  (:4000)
  │                └── /ws       → Fastify WebSocket (:4000)
  │
Backend (Fastify :4000)
  ├── Kite WebSocket API  (live market data inbound)
  └── Browser WebSocket   (price broadcast outbound)
```

**Tech stack:**

| Layer    | Technology                                    |
|----------|-----------------------------------------------|
| Backend  | Node.js, Fastify, WebSocket (`ws`), TypeScript |
| Frontend | Next.js (standalone output)                   |
| Infra    | Docker, Docker Compose, Nginx, Let's Encrypt  |
| Database | PostgreSQL 17 (present but not required for the real-time feature) |

---

## 1. Provision the Droplet

Create a droplet on [DigitalOcean](https://cloud.digitalocean.com/):

| Setting       | Value                                          |
|---------------|------------------------------------------------|
| Image         | Ubuntu 22.04 LTS                               |
| Plan          | Basic — $8/mo (1 vCPU, 1 GB RAM, 35 GB SSD)   |
| Region        | Bangalore (`blr1`) — low latency to Kite/Zerodha servers |
| Authentication| SSH key                                        |

### Generate an SSH key (if you don't have one)

```bash
ssh-keygen -t ed25519 -C "your-email@example.com"
```

Add the contents of `~/.ssh/id_ed25519.pub` to the droplet during creation.

### Connect to the droplet

```bash
ssh root@YOUR_DROPLET_IP
```

---

## 2. Initial Server Setup

Run these commands on the droplet as root.

### Update the system

```bash
apt-get update && apt-get upgrade -y
```

### Install Docker

```bash
curl -fsSL https://get.docker.com | sh
systemctl enable docker
systemctl start docker
```

Verify:

```bash
docker --version
docker compose version
```

If the Compose plugin is missing:

```bash
apt-get install -y docker-compose-plugin
```

### Configure the firewall

```bash
ufw allow 22/tcp     # SSH
ufw allow 80/tcp     # HTTP (needed for Let's Encrypt verification)
ufw allow 443/tcp    # HTTPS
ufw allow 3000/tcp   # Frontend (direct, useful for debugging)
ufw allow 4000/tcp   # Backend (direct, useful for debugging)
ufw --force enable
ufw status
```

> Once Nginx is confirmed working, you can optionally remove the 3000 and 4000 rules since all traffic flows through 80/443.

---

## 3. Clone and Configure the Project

```bash
git clone <your-repo-url> /opt/trading-scanner
cd /opt/trading-scanner
```

### Create the `.env` file

```bash
nano .env
```

Populate it with:

```env
# Kite Connect
KITE_API_KEY=your_kite_api_key
KITE_API_SECRET=your_kite_api_secret
KITE_ACCESS_TOKEN=

# Market mode: "commodity" (MCX) or "equity" (NSE top 100)
MARKET_MODE=commodity

# Frontend URL (used for auth redirect after Kite login)
FRONTEND_URL=https://tradescanner.io

# Next.js build-time variables (MUST match your domain)
NEXT_PUBLIC_API_URL=https://tradescanner.io/api
NEXT_PUBLIC_WS_URL=wss://tradescanner.io/ws

# PostgreSQL
POSTGRES_PASSWORD=a_strong_password_here
```

> **Important:** `NEXT_PUBLIC_*` variables are baked into the Next.js bundle at build time. They are passed as Docker build args in `docker-compose.yml`, not as runtime environment variables. If you change them, you must rebuild the frontend image.

---

## 4. Docker Build and Deploy

The project uses two multi-stage Dockerfiles:

- **Backend** (`apps/server/Dockerfile`): Compiles TypeScript with `tsc`, then copies only production dependencies and the compiled `dist/` into the final image.
- **Frontend** (`apps/web/Dockerfile`): Builds Next.js with standalone output. `NEXT_PUBLIC_*` values are injected as `ARG` at build time.

### Deploy

```bash
cd /opt/trading-scanner
docker compose up -d --build
```

This starts three containers:

| Container           | Port  | Description              |
|---------------------|-------|--------------------------|
| `trading-backend`   | 4000  | Fastify API + WebSocket  |
| `trading-frontend`  | 3000  | Next.js standalone       |
| `trading-db`        | 5432  | PostgreSQL 17            |

### Verify

```bash
docker ps
docker logs trading-backend -f
docker logs trading-frontend -f
```

---

## 5. DNS Setup (Cloudflare)

In your Cloudflare dashboard for `tradescanner.io`:

1. Add an **A record**:
   - **Name:** `@` (or `tradescanner.io`)
   - **Content:** `YOUR_DROPLET_IP`
   - **Proxy status:** **DNS only** (grey cloud)

> **Critical:** Do NOT enable Cloudflare proxy (orange cloud). It will:
> - Block Let's Encrypt HTTP-01 challenge verification, preventing SSL certificate issuance.
> - Interfere with WebSocket connections.
>
> Keep the proxy status as "DNS only" at all times.

2. Remove any duplicate A records for the same domain to avoid certificate verification failures.

Verify DNS propagation:

```bash
dig tradescanner.io +short
```

This should return your droplet IP.

---

## 6. Nginx Reverse Proxy

### Install Nginx

```bash
apt-get install -y nginx
```

### Create the site configuration

```bash
nano /etc/nginx/sites-available/tradescanner
```

```nginx
server {
    listen 80;
    server_name tradescanner.io;

    # Frontend (Next.js)
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Backend API
    location /api {
        proxy_pass http://localhost:4000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # WebSocket
    location /ws {
        proxy_pass http://localhost:4000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400;
    }
}
```

### Enable the site

```bash
ln -s /etc/nginx/sites-available/tradescanner /etc/nginx/sites-enabled/
nginx -t
systemctl reload nginx
```

At this point, `http://tradescanner.io` should serve the app (without SSL).

---

## 7. SSL with Let's Encrypt

### Install Certbot

```bash
apt-get install -y certbot python3-certbot-nginx
```

### Issue the certificate

```bash
certbot --nginx -d tradescanner.io
```

Certbot will:
- Verify domain ownership via HTTP-01 challenge (requires port 80 open and DNS pointing to the droplet).
- Obtain the certificate.
- Automatically modify the Nginx config to add SSL directives and a redirect from HTTP to HTTPS.

### Verify auto-renewal

```bash
certbot renew --dry-run
```

Certbot installs a systemd timer that renews certificates automatically before expiry.

After this step, the site is live at `https://tradescanner.io`.

---

## 8. Kite Connect Configuration

On [developers.kite.trade](https://developers.kite.trade):

1. Set the **Redirect URL** to:
   ```
   https://tradescanner.io/api/auth/callback
   ```
   This requires SSL to be set up first — Kite rejects non-HTTPS redirect URLs.

2. Access tokens expire daily. Each trading morning:
   - Open the app in the browser.
   - Click "Connect Kite" to initiate the OAuth flow.
   - After successful login, the backend stores the token in `.kite-session.json`.
   - This file is persisted via a Docker volume, so it survives container restarts.

---

## Useful Commands

### Deployment

```bash
# Full rebuild and deploy
docker compose up -d --build

# Start without rebuilding (e.g., after a reboot)
docker compose up -d

# Stop all containers
docker compose down

# Restart a single service
docker compose restart backend
```

### Logs

```bash
# Follow backend logs
docker logs trading-backend -f

# Follow frontend logs
docker logs trading-frontend -f

# Last 100 lines of backend logs
docker logs trading-backend --tail 100
```

### Debugging

```bash
# Shell into a running container
docker exec -it trading-backend sh

# Check what's listening on which port
ss -tlnp

# Check Nginx config syntax
nginx -t

# Reload Nginx after config changes
systemctl reload nginx

# Check SSL certificate status
certbot certificates
```

---

## Troubleshooting

### "Not a valid HTTPS URI" when configuring Kite redirect URL

Kite requires an HTTPS redirect URL. Complete sections 5-7 (DNS, Nginx, SSL) before configuring the Kite redirect URL.

### Let's Encrypt certificate issuance fails

- **Cloudflare proxy enabled:** Turn off the orange cloud (set to "DNS only"). Cloudflare's proxy intercepts the HTTP-01 challenge, causing verification to fail.
- **Duplicate DNS records:** If there are multiple A records for `tradescanner.io`, remove the extras so only one points to the droplet.
- **Port 80 blocked:** Ensure `ufw allow 80/tcp` has been run. Certbot needs port 80 for the HTTP-01 challenge.

### WebSocket connections fail in production

- Ensure the Nginx `/ws` location block includes the `Upgrade` and `Connection` headers (see section 6).
- Ensure Cloudflare proxy is disabled (DNS only). Cloudflare's free tier WebSocket support is unreliable and adds complications.
- Check that `NEXT_PUBLIC_WS_URL` is set to `wss://tradescanner.io/ws` (not `ws://`).

### `NEXT_PUBLIC_*` environment variables not taking effect

These variables are embedded into the JavaScript bundle at build time. Changing them in `.env` requires a full rebuild:

```bash
docker compose up -d --build
```

Simply restarting the frontend container will not pick up the new values.

### App works on `http://YOUR_DROPLET_IP:3000` but not on `https://tradescanner.io`

Nginx is not configured or not running. Verify:

```bash
systemctl status nginx
nginx -t
```

Then check that the site config is symlinked into `sites-enabled` and reload Nginx.

### Kite token expired / market data not streaming

Access tokens expire at the end of each trading day. Re-authenticate by clicking "Connect Kite" in the app each morning. The new token is saved to `.kite-session.json` and persists across container restarts via the Docker volume.

### Container keeps restarting

Check logs for the failing container:

```bash
docker logs trading-backend --tail 200
```

Common causes:
- Missing or malformed `.env` file.
- PostgreSQL not ready yet (the backend depends on it; Docker Compose `depends_on` only waits for the container to start, not for Postgres to be ready).

---

## Deployment Checklist

Use this when deploying from scratch or to a new droplet:

- [ ] Provision Ubuntu 22.04 droplet with SSH key
- [ ] SSH in and run initial setup (Docker, firewall)
- [ ] Clone repo to `/opt/trading-scanner`
- [ ] Create `.env` with API keys, domain URLs, and database password
- [ ] `docker compose up -d --build`
- [ ] Verify containers are running (`docker ps`)
- [ ] Add A record in Cloudflare (DNS only, no proxy)
- [ ] Verify DNS resolves (`dig tradescanner.io`)
- [ ] Install Nginx and create site config
- [ ] Install Certbot and issue SSL certificate
- [ ] Verify HTTPS works in browser
- [ ] Set Kite redirect URL to `https://tradescanner.io/api/auth/callback`
- [ ] Log in via "Connect Kite" and verify market data streams
