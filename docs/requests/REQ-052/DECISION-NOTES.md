# DECISION NOTES

## Context & Problem Framing

During the REQ-051 scoping session, we identified four enhancements that don't belong in the base build but should ship immediately after. The base bot (REQ-051) focuses on: parse → confirm → write. This REQ focuses on: what happens after write, who can write, how promos are managed, and what happens when things go wrong.

## Options Considered

### Confirmation display

**Option A: Edit the original message** — cleaner group chat, no extra messages. But staff might miss the update if they've scrolled past.

**Option B: Send a new reply message (chosen)** — more visible, creates a clear "posted → confirmed" thread. Slightly more chat clutter but Bryan preferred the visibility.

**Option C: Both** — overkill for a small team.

### Promo management

**Option A: Config file + redeploy** — zero extra code, but requires Bryan to push to GitHub and wait for Coolify deploy every time a promo changes (every few weeks).

**Option B: Bot commands (chosen)** — 10-second operation via Telegram. Persisted to JSON file. No deploy needed. Worth the small dev effort for ongoing convenience.

**Option C: Admin UI in the CRM** — over-engineered for 1-2 promos at a time. Would require API endpoints, frontend page, and cross-system coordination.

### Persistence

**Option A: In-memory only** — simplest, but pending orders lost on crash/restart.

**Option B: JSON file on disk (chosen)** — simple, human-readable, sufficient for low volume (~20 orders/day). No database dependency.

**Option C: SQLite** — overkill. JSON files handle this volume easily.

## Decision & Rationale

All four enhancements are small, high-impact, and tightly coupled to the base bot UX. Building them as a follow-up REQ (not bundled into REQ-051) keeps the base build focused while ensuring these ship immediately after.

## What We Explicitly Chose NOT To Do

1. **Not editing the original message for confirmation** — Bryan wants the reply pattern for visibility. The original confirmation card stays as-is (with buttons removed or disabled after action).
2. **Not building order stats or daily summaries** — useful but separate scope. Can be a future REQ once the base + this enhancement are stable.
3. **Not using a database for persistence** — JSON files on disk are sufficient for promo lists (1-2 items) and pending orders (max ~20 at any time). Adding SQLite or PostgreSQL would add unnecessary complexity.
4. **Not supporting multiple admins** — single admin user ID is fine. If needed later, the env var can become a comma-separated list with minimal code change.

## Risks Accepted

1. **JSON file corruption** — if the bot crashes mid-write to a JSON file, it could be corrupted. Mitigated by: write to a temp file first, then rename (atomic on most filesystems). Also, the data is transient — worst case, staff re-posts the order.
2. **Docker volume persistence** — Coolify container rebuilds could lose the data directory if not configured as a volume. The CLAUDE.md and deployment notes must document this.

## Future Considerations

- `/stats today` and `/stats week` commands for quick order metrics
- Daily auto-summary posted at 10 PM HKT
- Multi-admin support via comma-separated env var
- Promo start/end dates (auto-activate/deactivate campaigns)