# Locternos — Development Roadmap & Progress

A self-hosted, local-first Aternos alternative for creating, configuring, and managing Minecraft servers through a clean web interface.

---

## Architecture & Technical Decisions

- **Stack:** TypeScript monorepo (`npm workspaces`)
  - **Backend (`apps/backend`):** Node.js 20+, Fastify, WebSockets (`@fastify/websocket` or `ws`), Drizzle ORM + SQLite (`better-sqlite3` with `FTS5` for full-text log search)
  - **Frontend (`apps/frontend`):** React, TypeScript, Vite, TailwindCSS
  - **Shared (`packages/shared`):** Shared TypeScript interfaces, API contracts, and Zod validation schemas
- **Supported Server Cores (Phase 1):** Vanilla, Paper, Fabric, plus Custom `.jar` (local upload or direct download URL)
- **Unified Artifact Resolver:** Supports built-in provider APIs, direct `.jar` file uploads, direct `.jar` download URLs, and Modrinth page URLs (e.g., `https://modrinth.com/plugin/...` or `/mod/...`) resolved against server MC version and loader, including informing the user and installing `required` dependencies
- **Java Runtime Management:** Dynamic Java version detection using Mojang Piston version manifests (`javaVersion.majorVersion`, supporting both `1.x` and `26.x` versioning), system Java discovery, and user-confirmed Adoptium/Temurin downloads
- **Minecraft EULA Compliance:** Never auto-accept `eula.txt` silently; require explicit user confirmation via the UI (with a link to `https://aka.ms/MinecraftEULA`) before writing `eula=true`
- **Resource Control (Phase 1):** Per-server RAM allocation (`-Xms` / `-Xmx`) and optional JVM optimization profiles (Aikar's Flags / ZGC). CPU and disk usage are monitored read-only (quotas deferred to later phases)
- **Authentication (Phase 1):** First-run Admin account setup (`email` + `password` stored hashed locally, no email verification codes) protecting all panel endpoints; additional roles/users deferred to Phase 3
- **History & Logs:** All server runs, lifecycle/config/install audit events, and console logs (batched writes + FTS5 index) are persisted in SQLite with a configurable per-server retention policy (`none`, `24h`, `7d`, `30d`, `90d`, `365d`, `forever`)

---

## Phase 1 — Core Engine, Link/JAR Installer & Basic Web UI (MVP)

### 1.1 Monorepo & Project Scaffolding

- [x] Configure `npm workspaces` in root `package.json` (`apps/backend`, `apps/frontend`, `packages/shared`)
- [x] Set up shared TypeScript configs (`tsconfig.base.json`), linting/formatting, and dev scripts (`dev`, `build`, `typecheck`)
- [x] Initialize `packages/shared` with core domain types and Zod schemas (servers, runs, logs, artifacts, audit events)
- [x] Initialize `apps/backend` with Fastify server, structured logging, CORS/static serving, and WebSocket support
- [x] Initialize `apps/frontend` with React + Vite + TailwindCSS and API/WebSocket client setup
- [x] Define `data/` runtime directory layout (`data/locternos.db`, `data/servers/`, `data/runtimes/`, `data/backups/`) and ensure `.gitignore` coverage

### 1.2 Database Layer & Authentication (SQLite + Drizzle + FTS5)

- [x] Set up `better-sqlite3` connection (WAL mode enabled) and Drizzle ORM migrations
- [x] Implement `users` table (id, email, password_hash, role `admin`, created_at) with secure password hashing (Argon2/scrypt)
- [x] Implement first-run setup flow (prompt to create Admin account with email + password locally, no email verification codes) and session/JWT auth middleware for REST + WebSocket
- [ ] Implement `servers` table (id, name, slug, core type, MC version, entrypoint `.jar`, Java path, min/max RAM MB, JVM flags profile, custom JVM args, port, log_retention_policy `none|24h|7d|30d|90d|365d|forever`, eula_accepted_at, status, created/updated timestamps)
- [ ] Implement `server_runs` table (id, server_id, pid, started_at, stopped_at, exit_code, stop_reason, peak_ram_mb)
- [ ] Implement `server_logs` table + SQLite `FTS5` virtual table and sync triggers (run_id, server_id, timestamp, level, thread, message)
- [ ] Implement `artifacts` table (id, server_id, kind `core|plugin|mod`, filename, source_type `provider|modrinth_page|direct_url|upload`, source_url, project_id, version_id, sha256, installed_at)
- [ ] Implement `audit_events` table (id, server_id, user_id, action, details JSON, created_at)
- [ ] Implement per-server log & history retention cleaner (respecting `none`, `24h`, `7d`, `30d`, `90d`, `365d`, `forever` settings)
- [ ] Implement orphaned-run recovery on backend startup (reconcile `running` DB states if process exited while panel was offline)

### 1.3 Java Runtime Manager

- [ ] Scan system paths (`PATH`, `JAVA_HOME`, common OS Java directories) and extract Java major versions (`java -version`)
- [ ] Implement Adoptium (Temurin) API client to list and download JDK/JRE runtimes into `data/runtimes/`
- [ ] Resolve required Java version dynamically from Mojang version manifest (`javaVersion.majorVersion`)
- [ ] Prompt the user for confirmation when the required Java version is missing locally (`"Java X is required for this server. Download and install?"`) before downloading
- [ ] Allow manual Java runtime override per server (especially for custom `.jar` servers)

### 1.4 Server Core Providers & Unified Artifact Resolver

- [ ] Implement **Vanilla** provider (Mojang Piston API: version list + `server.jar` download + SHA-1 verification)
- [ ] Implement **Paper** provider (PaperMC API: versions, latest build lookup, download + SHA-256 verification)
- [ ] Implement **Fabric** provider (Fabric Meta API: game versions, loader versions, installer/server jar resolution)
- [ ] Implement **Direct URL Installer** (download from direct `.jar` URLs like `fill-data.papermc.io/...` or `cdn.modrinth.com/...`, derive safe filename from URL/`Content-Disposition`, verify ZIP/JAR magic bytes `PK\x03\x04`, compute SHA-256)
- [ ] Implement **Local `.jar` Upload** endpoint (multipart upload, JAR validation, SHA-256 hashing, destination selection for core vs `plugins/` vs `mods/`)
- [ ] Implement **Modrinth Page URL Resolver** (parse `modrinth.com/{plugin|mod|datapack}/<slug>` and optional `/version/<id>`, query Modrinth API v2, auto-match server MC version & loader, return selectable fallback versions if no exact match)
- [ ] Resolve and report `required` Modrinth dependencies to the user (with version/project info) and install them automatically alongside the requested mod/plugin
- [ ] Record all installed cores, plugins, and mods (including installed dependencies) in `artifacts` and log `audit_events`

### 1.5 Process Lifecycle, EULA, Console & Resource Control

- [ ] Implement server workspace initializer (default `server.properties` port assignment with collision check; never auto-write `eula=true`)
- [ ] Enforce explicit **Minecraft EULA** acceptance flow: block startup if `eula.txt` is missing or not `true`, display EULA dialog with link to `https://aka.ms/MinecraftEULA`, and write `eula=true` + log `audit_events` only after user confirmation
- [ ] Implement process spawner with per-server `-Xms` / `-Xmx` RAM limits and JVM flag presets (`default`, `aikars`, `zgc`, plus custom flags)
- [ ] Implement `Start`, `Graceful Stop` (write `stop` to `stdin` with configurable timeout fallback), `Force Kill`, and `Restart`
- [ ] Stream `stdout`/`stderr` through a ring buffer and batched WebSocket broadcaster to keep UI responsive during high log volume
- [ ] Parse Minecraft log lines (timestamp, thread, level) and flush to `server_logs` in batched transactions respecting the server's retention policy (skip DB log persistence when set to `none`)
- [ ] Support sending console commands via WebSocket/REST and recording command audit events
- [ ] Track live server process metrics (RAM RSS, CPU %, uptime) and update `peak_ram_mb` on `server_runs`
- [ ] Calculate read-only server directory disk usage for display

### 1.6 Basic Web Interface (MVP)

- [x] **First-Run Setup & Login:** Create Admin account on initial launch (email + password); login gate for subsequent visits
- [ ] **Dashboard / Server List:** View all local servers, status badges, MC version/core, RAM allocation, live metrics, and quick Start/Stop actions
- [ ] **Create Server Wizard:** Select Vanilla / Paper / Fabric / Custom `.jar` (upload or direct URL), set name, port, RAM slider, log retention policy (`none` to `forever`), Java check/install prompt, and optional EULA review
- [ ] **Server Overview & Live Console:** Real-time terminal output, log-level color coding, command input, Start/Stop/Restart/Kill controls, EULA confirmation modal when needed, live RAM/CPU/Disk indicators, and per-server settings (RAM, Java, log retention)
- [ ] **Plugins / Mods Tab:** Install via Modrinth page URL (showing detected `required` dependencies before/during install), direct `.jar` download URL, or local `.jar` file upload; list/enable/disable/delete installed artifacts
- [ ] **History & Logs Tab:**
  - View past `server_runs` (start/stop times, duration, exit code, crash indicator, peak RAM)
  - Inspect & search historical logs (`FTS5` keyword search, filter by run ID and log level `INFO|WARN|ERROR|FATAL`)
  - Download raw `logs/*.log.gz` files and inspect `audit_events` timeline

---

## Phase 2 — Daily Server Management (Aternos Experience)

### 2.1 Visual `server.properties` Editor

- [x] Parse and serialize `server.properties` safely while preserving comments/unknown keys
- [ ] Build schema-driven UI grouped by category (Gameplay, World, Network/Security, Performance) with human-readable descriptions
- [ ] Support quick toggles (`online-mode` / cracked, `white-list`, `pvp`, `allow-flight`, `gamemode`, `difficulty`, `motd`, `max-players`, `level-seed`)
- [ ] Warn user when a running server requires restart for property changes to apply and record changes in `audit_events`

### 2.2 Player Management

- [ ] Parse and manage `whitelist.json`, `ops.json`, `banned-players.json`, and `banned-ips.json`
- [ ] Track currently online players from join/leave log events (or RCON/query)
- [ ] One-click Kick, OP/De-OP, Whitelist Add/Remove, and Ban/Unban actions (executing live console commands when server is running, or editing JSON when offline)

### 2.3 File Manager & Config Editor

- [ ] Build path-traversal-safe file API restricted strictly to each server's root directory
- [ ] File browser UI with breadcrumb navigation, create folder/file, rename, delete, upload, and download
- [ ] Built-in text/code editor for `.yml`, `.yaml`, `.json`, `.toml`, `.properties`, `.txt`, and `.conf` files

### 2.4 World & Backup Management

- [ ] Detect world folders (`world`, `world_nether`, `world_the_end`) from `server.properties` (`level-name`)
- [ ] Create manual `.zip` world/server backups stored in `data/backups/` and tracked in `backups` table
- [ ] Restore a backup (only when server is stopped, with safety confirmation) and download backups as `.zip`
- [ ] Upload/import an external world `.zip` and "Reset/Regenerate World" action

---

## Phase 3 — Ecosystem, Automation & Sharing

### 3.1 Built-in Modrinth Search UI

- [ ] Add interactive Modrinth search & browse panel inside the Plugins/Mods tab
- [ ] Auto-filter results by server MC version and loader (`paper`/`spigot`/`fabric`), show version changelog/dependencies, and support one-click install/update

### 3.2 Scheduler & Crash Recovery

- [ ] Implement cron/interval task scheduler (auto-backup with retention rotation, scheduled restarts with in-game countdown warnings, scheduled console commands)
- [ ] Detect unexpected non-zero exits / crashes, parse latest `crash-reports/` summary, and optionally auto-restart crashed servers

### 3.3 Access, Network & Advanced Observability

- [ ] Multi-user accounts and role-based permissions (Admin, Operator, Viewer) + per-server access control
- [ ] Port-forwarding-free sharing helper / integration (**playit.gg** agent or **UPnP** port mapping)
- [ ] Historical RAM/CPU time-series charts and TPS/MSPT monitoring (via Paper/Fabric spark or console status parsing)
