# Local Development Environment Guide

This guide describes how to configure, run, and troubleshoot the local development environment for Setline.

---

## 1. Prerequisites

Before starting, ensure your host system has the following software installed:

- **Node.js:** 24.x LTS (`node --version`)
- **Package Manager:** pnpm 10.x (`corepack enable && pnpm --version`)
- **Container Engine:** Docker Desktop (Windows/macOS) or Docker Engine with Docker Compose v2 (Linux) (`docker compose version`)
- **OpenSSL / Node.js:** For generating cryptographic secrets

---

## 2. First-Run Setup

### Step 1: Clone Repository & Install Dependencies

```bash
git clone <repo-url> setline
cd setline
pnpm install --frozen-lockfile
```

### Step 2: Configure Environment Variables

Create your local `.env` file from `.env.example`:

```bash
cp .env.example .env
```

Generate a secure 32-byte secret for `AUTH_SECRET`:

```bash
# Using OpenSSL:
openssl rand -hex 32

# Or using Node.js:
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Edit `.env` and set:

- `AUTH_SECRET` to your generated 32-byte hex key.
- `POSTGRES_PASSWORD`, `POSTGRES_APP_PASSWORD`, `POSTGRES_MIGRATOR_PASSWORD` to secure local passwords.
- Update `DATABASE_URL` and `MIGRATION_DATABASE_URL` with your chosen passwords.
- `STORAGE_ACCESS_KEY` and `STORAGE_SECRET_KEY` to your chosen storage credentials.

> [!IMPORTANT]
> The environment validator (`src/env.ts`) strictly rejects placeholder words (such as `changeme`, `password`, `secret`, `admin`) and enforces a minimum length of 32 bytes for `AUTH_SECRET`. The application will refuse to start if weak or placeholder credentials are detected.

---

## 3. Starting Development Services

Setline uses Docker Compose (`compose.dev.yml`) to orchestrate three containerized services:

1. **PostgreSQL 16:** Relational database with least-privilege role separation.
2. **Mailpit:** Local SMTP catch-all server with an embedded web mailbox.
3. **MinIO:** S3-compatible local object storage with an embedded management console.

### Launch Services

Start all services in the background:

```bash
pnpm services:up
```

### Verify Service Health

Inspect the health status of all containers:

```bash
docker compose -f compose.dev.yml ps
```

All three services should show `(healthy)` status within 10–30 seconds.

---

## 4. Service Access & Endpoints

All dev services are strictly bound to `127.0.0.1` (localhost) to prevent accidental exposure to your local network.

| Service            | Protocol / Port | Local URL / Endpoint                           | Credentials / Roles                         |
| :----------------- | :-------------- | :--------------------------------------------- | :------------------------------------------ |
| **Next.js App**    | HTTP / 3000     | [http://localhost:3000](http://localhost:3000) | Local admin user                            |
| **Mailpit Web UI** | HTTP / 8025     | [http://localhost:8025](http://localhost:8025) | No authentication required (dev sink)       |
| **Mailpit SMTP**   | SMTP / 1025     | `127.0.0.1:1025`                               | Accepts any credential in dev               |
| **MinIO Console**  | HTTP / 9001     | [http://localhost:9001](http://localhost:9001) | `STORAGE_ACCESS_KEY` / `STORAGE_SECRET_KEY` |
| **MinIO S3 API**   | HTTP / 9000     | `http://127.0.0.1:9000`                        | S3 API endpoint for SDK clients             |
| **PostgreSQL**     | TCP / 5432      | `127.0.0.1:5432`                               | See Role Separation below                   |

### PostgreSQL Least-Privilege Role Separation

During container initialization (`infra/postgres/init-roles.sh`), the database sets up strict role boundaries:

1. **Application Role (`setline_app`):**
   - Used by the Next.js runtime application via `DATABASE_URL`.
   - Granted DML permissions (`SELECT`, `INSERT`, `UPDATE`, `DELETE`) on application tables.
   - **Explicitly denied DDL:** Cannot `CREATE TABLE`, `ALTER TABLE`, or `DROP TABLE` in schema `public`.
2. **Migration Role (`setline_migrator`):**
   - Used exclusively by Drizzle Kit migrations via `MIGRATION_DATABASE_URL`.
   - Owns schema `public` and has DDL creation rights.
3. **Superuser (`postgres`):**
   - Used only by Docker during container provisioning; never used by the application.

---

## 5. Service Lifecycle Commands

Manage your containers using the following pnpm scripts:

- **Start Services:**
  ```bash
  pnpm services:up
  ```
- **Stop Services (Preserve Data):**
  ```bash
  pnpm services:down
  ```
- **View Container Logs:**
  ```bash
  pnpm services:logs
  ```
- **Reset Services (Destroy Data Volumes):**
  ```bash
  pnpm services:reset
  ```

> [!WARNING]
> `pnpm services:reset` irreversibly destroys all named Docker volumes (`postgres_data`, `mailpit_data`, `minio_data`). Use this command only when you want to wipe local databases and test fresh migrations.

---

## 6. Connecting to External or Synology NAS Docker Containers

Many photographers maintain a home lab or Synology DiskStation NAS (via Container Manager or Docker package) to centralize storage and database backups.

You can configure Setline to connect directly to services running on your Synology NAS instead of running local Docker containers on your workstation:

### Step 1: Create `.env.local`

Next.js prioritizes `.env.local` over `.env`. Create `.env.local` (which is gitignored):

```bash
touch .env.local
```

### Step 2: Override Endpoints with NAS Host IP

Replace `127.0.0.1` with your NAS LAN IP (e.g., `192.168.1.150`):

```bash
# Database on Synology NAS
DATABASE_URL=postgres://setline_app:password@192.168.1.150:5432/setline_dev
MIGRATION_DATABASE_URL=postgres://setline_migrator:password@192.168.1.150:5432/setline_dev

# MinIO / S3 on Synology NAS
STORAGE_ENDPOINT=http://192.168.1.150:9000
STORAGE_ACCESS_KEY=your_nas_minio_access_key
STORAGE_SECRET_KEY=your_nas_minio_secret_key

# Mailpit on Synology NAS
SMTP_HOST=192.168.1.150
SMTP_PORT=1025
```

### Step 3: Synology Firewall and Security Best Practices

- **LAN Only:** Never expose your NAS PostgreSQL (5432) or MinIO (9000/9001) ports to the public internet without a VPN (WireGuard or Tailscale).
- **Non-Root User:** In Synology Container Manager, ensure container processes run with non-root PUID/PGID matching your Synology storage permissions.
- **Dedicated Volume Paths:** Map `/var/lib/postgresql/data` and `/data` to an encrypted Btrfs share on your Synology volume for data protection.

---

## 7. Troubleshooting

### Port Conflicts (Port 5432, 8025, or 9000 already in use)

If a service fails to start because a port is bound by a native service (e.g., native Windows PostgreSQL service):

1. Open `.env`.
2. Change the host port variable, for example:
   ```bash
   POSTGRES_PORT=5433
   MAILPIT_HTTP_PORT=8026
   MINIO_PORT=9002
   MINIO_CONSOLE_PORT=9003
   ```
3. Update `DATABASE_URL` and `MIGRATION_DATABASE_URL` to reflect the new port (e.g., `127.0.0.1:5433`).
4. Re-run `pnpm services:up`.

### Windows WSL2 Line Endings (`init-roles.sh` carriage returns)

If you see `/bin/sh^M: bad interpreter` when the PostgreSQL container boots on Windows:

- Ensure Git preserves LF line endings for shell scripts:
  ```bash
  git config core.autocrlf false
  git checkout infra/postgres/init-roles.sh
  ```

### Linux Docker Permissions

If you encounter `permission denied while trying to connect to the Docker daemon socket`:

- Add your user to the `docker` group:
  ```bash
  sudo usermod -aG docker $USER
  newgrp docker
  ```
