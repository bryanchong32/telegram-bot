---
request_id: REQ-001
project: ecomwave-crm
title: Handle Duplicate Emails During Contact Import
type: Bug
priority: P1 Critical
effort: Small
source: Own Testing
date: 2026-02-28
---

# PRD

## Problem

When importing contacts via CSV, duplicate email addresses cause the import to fail silently. The user receives a success message but some rows are dropped without explanation.

## Solution

Detect duplicate emails during import and surface them to the user with options to skip, overwrite, or merge.

## Requirements

1. During CSV import, check each email against existing contacts
2. If duplicates found, show a summary before proceeding
3. User can choose: Skip duplicates, Overwrite existing, or Cancel import
4. Log all skipped/overwritten rows for audit trail

---

# DECISION NOTES

## Approach

- Check duplicates at parse time (before DB insert) to give fast feedback
- Use a Set for O(1) lookup of emails already seen in the CSV
- Query existing contacts in a single batch (not per-row) for DB efficiency
- Show duplicate summary in a modal with radio button choices

## Rejected Alternatives

- Post-insert cleanup: Too risky, could corrupt data
- Silent skip: Bad UX, user doesn't know what happened
- Per-row confirmation: Too tedious for large imports

---

# CLAUDE CODE INSTRUCTIONS

## Context

- Import handler: `server/routes/contacts.js` → `POST /api/contacts/import`
- CSV parsing: `server/utils/csv.js` → `parseContactsCsv()`
- Frontend: `client/src/pages/Contacts/ImportModal.jsx`

## Steps

1. In `parseContactsCsv()`, collect all emails into a Set during parsing
2. After parsing, query `contacts` table for any matching emails
3. If duplicates found, return them in the parse result (don't throw)
4. In the import route, check for duplicates before inserting
5. In `ImportModal.jsx`, show duplicate summary if present
6. Add "Skip duplicates" / "Overwrite" / "Cancel" buttons
7. Handle each choice in the import route

## Testing

- Import CSV with no duplicates → all rows imported
- Import CSV with duplicates in CSV itself → detected before DB check
- Import CSV with emails matching existing contacts → summary shown
- Choose "Skip" → only new contacts imported
- Choose "Overwrite" → existing contacts updated
