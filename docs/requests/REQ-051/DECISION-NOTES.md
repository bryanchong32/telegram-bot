# DECISION NOTES

## Context & Problem Framing

Bryan's sales staff post order confirmations in a Telegram group as part of their daily workflow. They then manually re-enter the same information into Google Sheets. The CRM reads from this sheet every 30 minutes to create orders, generate follow-up tasks, and track customer data. The manual entry step is the bottleneck — it's slow, error-prone, and creates a gap between when an order is closed and when the CRM knows about it.

The original request was "can staff send orders into a Telegram bot and have it auto-written to Google Sheets?" This is exactly the right framing — the bot sits between the Telegram group and Google Sheets, eliminating the manual step.

## Options Considered

### Option A: Bot → Google Sheets (chosen)
Bot parses Telegram messages and writes directly to the Google Sheet. CRM sync picks up new rows as usual.

**Pros:** Google Sheet remains the master record (other people reference it). No changes to CRM sync logic. Clean separation — bot is a standalone input tool. If bot breaks, staff can still enter manually.

**Cons:** Orders go through an extra hop (Sheet) before reaching the CRM. 30-min sync delay still exists.

### Option B: Bot → CRM directly
Bot parses Telegram messages and calls the CRM API to create orders directly in the database.

**Pros:** Orders appear in CRM immediately. No sync delay.

**Cons:** Bypasses Google Sheets — creates two sources of truth. Other people who reference the sheet won't see these orders. Would need to build a CRM → Sheet reverse sync to keep the sheet updated. More complex, more risk.

### Option C: Bot → Both (Sheet + CRM)
Bot writes to both Google Sheets and CRM simultaneously.

**Pros:** Immediate CRM visibility + sheet stays current.

**Cons:** Dual-write complexity. If one write fails, they're out of sync. Hardest to get right.

## Decision & Rationale

**Option A: Bot → Google Sheets.** Bryan confirmed the sheet is still the master record that other people reference. The 30-min sync delay is acceptable — it's already the current cadence and nobody has complained. This approach is the simplest, safest, and doesn't change any existing system behavior. The bot is purely additive.

## What We Explicitly Chose NOT To Do

1. **Not writing to CRM directly** — the sheet is the master record. Bypassing it creates dual source of truth problems that aren't worth solving right now.
2. **Not using regex for parsing** — multiple staff write in slightly different formats. AI parsing (Gemini) handles variations much better than brittle regex patterns. The cost (~$0.001-0.003 per order) is negligible for 10-20 orders/day.
3. **Not requiring staff to change their posting format** — the bot adapts to how staff naturally write, not the other way around. No structured forms, no slash commands, no mandatory templates.
4. **Not requiring Telegram reply threading to link screenshot + text** — phone number matching is reliable enough since only one person posts at a time, and it requires zero behavior change from staff.
5. **Not building screenshot OCR as optional** — Order ID is required for every order (it's the dedup key). If there's no screenshot, the bot asks for one rather than proceeding without it.
6. **Not adding to the existing Rekko bot** — different purpose, different group, different complexity. Standalone bot is cleaner to build, test, and deploy independently.
7. **Not building order edit/amendment handling** — Phase 2 concern. For now, if an order needs correction after confirmation, staff edits the Google Sheet directly (same as today).
8. **Not building multi-tenant support** — this is for Minionions Marketing only. If ECOMWAVE wants the same capability, it's a separate configuration, not a multi-tenant architecture decision right now.

## Risks Accepted

1. **AI parsing accuracy** — Gemini could misparse product names or quantities. Mitigated by: (a) confirmation card requires staff approval before writing, (b) SKU lookup validates against actual product catalog, (c) price and PV shown on confirmation card so staff can spot errors.
2. **Gemini Vision OCR reliability** — screenshot format could change if FIV5S updates their app. Mitigated by: the bot asks staff to re-send or type the Order ID manually if OCR fails.
3. **Google Sheets API write failures** — network issues or quota limits could prevent writes. Mitigated by: bot informs staff immediately and retries. No silent failures.
4. **Phone number matching edge cases** — if two orders have the same phone number posted within 5 minutes, the bot could mis-link. Mitigated by: Bryan confirmed only one person posts at a time, and the confirmation card lets staff verify.

## Future Considerations

- **Order amendments** — staff could reply to a confirmed order with corrections, and the bot updates the sheet row. Requires tracking which sheet row each order was written to.
- **Multi-tenant** — ECOMWAVE onboarding would need its own Telegram group, sheet, and promo config.
- **Direct CRM integration** — if/when the Google Sheet is deprecated, the bot could switch to writing directly to the CRM API with minimal changes (same parsed data, different write target).
- **Analytics** — the bot could track: orders per staff member, average time from posting to confirmation, parse failure rate.
- **Voice message support** — Telegram voice messages could be transcribed and parsed. Low priority unless staff start using voice.