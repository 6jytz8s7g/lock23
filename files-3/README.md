# WRL resource lockout board

A small web app for coordinating exclusive access to a shared physical resource.
One person at a time holds the "lock"; everyone else sees a red light and who has it.
Every session is timestamped in a log.

## What it does

- Big light: **green** = free, **red** = someone's logged in
- Type your name, click **Lock out** → claims the resource, light goes red for everyone
- Click **Log out / release lock** → frees it, light goes green
- Session log table: user, time logged in, time logged out
- Locking is **atomic** — if two people click at the same moment, exactly one wins;
  the other is told who already has it. (This is the part a spreadsheet can't guarantee.)

## Requirements

- Node.js **22.5 or newer** (uses the built-in `node:sqlite` module — no native compilation,
  nothing to build)

## Run it

```bash
npm install
npm start
```

Then open http://localhost:3000 — share that URL (or the machine's IP, e.g.
http://192.168.1.50:3000) with the team. Everyone on the same network hits the same server,
so they all see the same light and log in real time (auto-refreshes every 3 seconds).

## Configure

Set environment variables when starting:

```bash
RESOURCE_NAME="Conference Room A" PORT=8080 npm start
```

- `RESOURCE_NAME` — what's shown as the title (default: "Shared resource")
- `PORT` — port to listen on (default: 3000)
- `DB_PATH` — where the SQLite file lives (default: ./lockout.db)

## Deploying for the team

The simplest durable setup: run it on any always-on machine the team can reach
(a spare desktop, an internal server, or a small VPS), and keep it running with a
process manager so it restarts on reboot:

```bash
npm install -g pm2
RESOURCE_NAME="Conference Room A" pm2 start server.js --name lockout
pm2 save && pm2 startup
```

The data lives in `lockout.db` (plus `-wal`/`-shm` companion files) — back that up if the
log matters. No usernames are validated; it identifies people by what they type.

## A note on what this is and isn't

This enforces **one holder at a time** at the server level, which is real and race-safe.
It does **not** authenticate anyone — there are no passwords, and anyone with the URL can
claim or release the lock. That's appropriate for honest internal coordination of a shared
resource. If you ever need to stop people releasing *someone else's* lock, or tie it to
firm logins, that's an auth layer to add on top (e.g. SSO behind the firm's identity
provider) — ask and I can extend it.
```
