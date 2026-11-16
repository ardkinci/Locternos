<div align="center">

# Locternos
**A self-hosted, local-first control panel for your Minecraft servers.**

[![Latest Version](https://img.shields.io/github/v/release/ardkinci/Locternos?display_name=tag&sort=semver&color=blue&label=version)](https://github.com/ardkinci/Locternos/releases)
[![Last Commit](https://img.shields.io/github/last-commit/ardkinci/Locternos?color=orange&label=last%20commit)](https://github.com/ardkinci/Locternos/commits/main)
[![License](https://img.shields.io/github/license/ardkinci/Locternos?color=green&label=license)](https://github.com/ardkinci/Locternos/blob/main/LICENSE)

</div>
<br>

Locternos is an **Aternos alternative you run yourself**. Instead of depending on a hosted service, it gives you a clean web interface to create, configure and manage Minecraft servers on your own machine — with full control over files, memory and data.

Everything lives locally. Servers, logs, worlds and backups stay on your disk, and nothing is sent anywhere you did not ask for.

> [!NOTE]
> Locternos is under active development. The foundation is in place and the feature set below is being built out phase by phase — see [`PROGRESS.md`](PROGRESS.md) for the live roadmap.

## What it's about

**Start simple.** Pick Vanilla, Paper or Fabric, or bring your own `.jar`. Set a port, choose how much RAM to give it, and hit start. No Java hunting, no manual jar downloads — Locternos resolves the right version and runtime for you.

**Know what's happening.** Watch the live console, follow resource usage, and come back later to browse past runs and search through historical logs. Crashes and exits are recorded, not lost to a closed terminal.

**Make it yours.** Edit `server.properties` visually, manage players, tweak configs, and install plugins or mods straight from a Modrinth link or a local file — dependencies included.

**Never lose a world.** Create and restore backups, reset worlds, and keep everything safe under one predictable `data/` directory.

## Under the hood

- **Backend** — Node.js, Fastify, WebSockets, Drizzle ORM with SQLite (WAL + FTS5)
- **Frontend** — React, Vite, TailwindCSS
- **Shared** — a common TypeScript + Zod contract layer used by both sides

A TypeScript monorepo keeps the API and UI honest with each other, while SQLite keeps the whole thing portable and dependency-free.

## Status

Locternos is early. The monorepo, shared contracts and application skeleton are ready; server lifecycle, the artifact installer and the web UI are in progress. The roadmap in [`PROGRESS.md`](PROGRESS.md) is the source of truth for what works today.

## License

Released under the terms in [`LICENSE`](LICENSE).
