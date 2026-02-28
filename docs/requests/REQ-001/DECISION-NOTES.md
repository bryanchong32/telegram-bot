# DECISION NOTES

## 1. Context & Problem Framing

Original framing was "I need a better Notion tracker." Through discussion, reframed as a workflow automation problem — the tracker structure is fine, the bottleneck is the filing process between scoping and building.

## 2. Options Considered

### Option A: Enhanced Notion database only (Level 1)
- **Description:** Better-structured Notion database with templates and views. All manual.
- **Pros:** Zero engineering effort.
- **Cons:** Doesn't solve filing friction. Relies on discipline.

### Option B: Claude Chat as process enforcer (Level 2)
- **Description:** Claude Chat follows a protocol — checks status, enforces process, produces structured outputs. Filing still manual.
- **Pros:** Low effort.
- **Cons:** Admin tax per request remains ~5-10 minutes.

### Option C: Telegram bot as filing agent (Level 3) — CHOSEN
- **Description:** After scoping in Claude Chat, send a single file to Telegram bot. Bot handles all filing.
- **Pros:** Filing drops from 5-10 min to 30 seconds. Zero manual data entry. Builds on existing bot infrastructure.
- **Cons:** Requires engineering effort. Another bot to maintain.

## 3. Decision & Rationale

Chose Option C. Admin tax is the real bottleneck. Bryan's receipt bot proves the pattern works. Multi-project support from day one means the investment pays off across all projects.

## 4. Key Architectural Decisions

**Repo structure — module inside telegram-bot, not standalone:** The telegram-bot repo is a personal automation hub. All bots share infrastructure (server, PM2, nginx, deployment). Separate repo would duplicate all of this.

**Doc storage — GitHub project repos, not Drive:** When Claude Code starts a build, it's in the project repo. Docs are right there. Google Drive would require copy-pasting.

**Input format — single combined markdown file:** One file = one download, one upload. Three files = six actions. Combined format also prevents incomplete submissions.

**Content fidelity — no AI expansion:** Requirements must be exact. Bot files content as-is. No second AI pass.

## 5. What We Explicitly Chose NOT To Do

- Standalone repo (duplicates deployment infrastructure)
- Google Drive storage (adds friction, no benefit)
- AI expansion of summaries (requirements must be exact)
- Auto-trigger Claude Code builds (no clean programmatic trigger)
- Status sync Notion → Telegram (Bryan checks Notion directly)
- Auto-incrementing request IDs (manual assignment for now, v2 candidate)

## 6. Risks Accepted

- Telegram downtime: can file manually in Notion as fallback
- GitHub API rate limits: unlikely at current volume, bot should retry gracefully
- Frontmatter format rigidity: strict validation with clear errors for quick fix-and-resend

## 7. Future Considerations

- `/status` command to query Notion from Telegram
- `/update` command to change request status from Telegram
- Auto-increment request IDs per project
- Template validation (check sections have content)
- Batch filing (multiple files in one message)