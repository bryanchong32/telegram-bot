# DECISION NOTES

## Context & Problem Framing

Bryan's original request was about two friction points: (1) he can't see which quick requests need scoping, and (2) scoping a previously-captured quick request creates a duplicate. During discussion, we added a third item: the REQ-ID format is project-blind, making IDs meaningless at a glance across multiple projects.

## Options Considered

### Viewing Unscoped Requests

**Option A: `/unscoped` with project selection (chosen)**
- Two-step: command → pick project → see list
- Pros: Focused results, consistent with existing button patterns
- Cons: Extra tap vs. showing everything

**Option B: `/unscoped` dumps all projects**
- Pros: One command, see everything
- Cons: Gets noisy as projects grow, no structure

### Replace vs. Duplicate on Scoped File

**Option A: Auto-detect and confirm (chosen)**
- Query Notion by Request ID before creating. If match found, show confirmation with context.
- Pros: Safe, gives Bryan control, handles both Unscoped→Scoped upgrade and Scoped→Scoped overwrite
- Cons: Extra Notion query on every scoped file submission

**Option B: Always create new, let Bryan clean up manually**
- Pros: Zero logic change
- Cons: Exactly the problem Bryan raised — duplicates pile up

### ID Format

**Option A: `ECW-001` — short code + number**
- Pros: Shortest, clean
- Cons: Could collide with other numbered things if Bryan introduces task IDs later

**Option B: `ECW-REQ-001` — short code + REQ label + number (chosen)**
- Pros: Self-documenting, unambiguous, distinguishes requests from other future numbered items
- Cons: Slightly longer

**Option C: `ECOMWAVE-001` — full project key**
- Pros: No code mapping needed
- Cons: Too long for projects with long names

## Decision & Rationale

- `/unscoped` with project selection — keeps it focused and consistent with existing UX patterns
- Confirm before replacing — safety net without friction (one tap)
- `{CODE}-REQ-{NNN}` format — Bryan preferred the explicitness of the REQ label. Slight extra length is worth the clarity.
- Notion-only migration — GitHub folders keep old names. Not worth the commit noise for a cosmetic rename. Old commit messages reference old IDs which is fine as history.

## What We Explicitly Chose NOT To Do

- **No GitHub folder renaming** — old `docs/requests/REQ-001/` folders stay. New requests use the new format in folder names going forward. This avoids meaningless churn in git history.
- **No edit/delete commands in Telegram** — Notion is the right place for that. Rekko is for filing, not managing.
- **No filtering `/unscoped` by priority/type** — premature. If the list gets long enough to need filtering, we'll revisit.
- **No auto-generating project codes** — Bryan wants to choose meaningful codes. Worth the extra prompt during custom project creation.

## Risks Accepted

- **Notion query on every scoped file:** Adds one API call before GitHub commit. Acceptable — latency is already dominated by the GitHub commit step, not Notion reads.
- **Old and new format coexistence:** Parser accepts both during transition. Minimal risk since it's only Bryan filing requests.
- **Custom projects file format change:** `custom-projects.json` changes from a string array to an object array. Existing file needs handling on first load (migrate in place or reset).

## Future Considerations

- If Bryan adds more projects, he may want `/projects` command to list all known projects with their codes
- Could add `/request {ID}` to view a specific request's details from Telegram
- Effort field redefined as context risk indicator (Small/Medium/Large) — reflects Claude Code session complexity, not Bryan's time