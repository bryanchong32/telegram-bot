/**
 * Markdown file parser for request documents.
 * Extracts YAML frontmatter and splits the body into three sections:
 * PRD, Decision Notes, and Claude Code Instructions.
 */

const matter = require('gray-matter');

const REQUIRED_FIELDS = [
  'request_id',
  'project',
  'title',
  'type',
  'priority',
  'effort',
  'source',
  'date',
];

const VALID_TYPES = ['Bug', 'Feature', 'Enhancement', 'UX/Polish', 'Refactor'];
const VALID_PRIORITIES = ['P1 Critical', 'P2 Important', 'P3 Backlog'];
const VALID_EFFORTS = ['Small', 'Medium', 'Large'];
const VALID_SOURCES = [
  'Own Testing',
  'Client Feedback',
  'Claude Chat Session',
  'Code Review',
  'User Report',
];

/**
 * Parses YAML frontmatter from the markdown content.
 * Validates all required fields are present and valid.
 *
 * @param {string} content — raw markdown file content
 * @returns {{ meta: Object, body: string }}
 * @throws {Error} with descriptive message listing issues
 */
function parseFrontmatter(content) {
  const { data, content: body } = matter(content);

  /* gray-matter parses YAML dates as JS Date objects.
     Convert back to YYYY-MM-DD string for consistent handling.
     Use UTC methods to avoid timezone shifts in local dev. */
  if (data.date instanceof Date) {
    const d = data.date;
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    data.date = `${yyyy}-${mm}-${dd}`;
  }

  const missing = REQUIRED_FIELDS.filter((field) => !data[field]);
  if (missing.length > 0) {
    throw new Error(`Missing required fields: ${missing.join(', ')}`);
  }

  const errors = [];

  if (!/^REQ-\d+$/.test(data.request_id)) {
    errors.push(`request_id must match format REQ-XXX (got "${data.request_id}")`);
  }

  if (!VALID_TYPES.includes(data.type)) {
    errors.push(`type must be one of: ${VALID_TYPES.join(', ')} (got "${data.type}")`);
  }

  if (!VALID_PRIORITIES.includes(data.priority)) {
    errors.push(`priority must be one of: ${VALID_PRIORITIES.join(', ')} (got "${data.priority}")`);
  }

  if (!VALID_EFFORTS.includes(data.effort)) {
    errors.push(`effort must be one of: ${VALID_EFFORTS.join(', ')} (got "${data.effort}")`);
  }

  if (!VALID_SOURCES.includes(data.source)) {
    errors.push(`source must be one of: ${VALID_SOURCES.join(', ')} (got "${data.source}")`);
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(data.date)) {
    errors.push(`date must be YYYY-MM-DD format (got "${data.date}")`);
  }

  if (errors.length > 0) {
    throw new Error(`Validation errors:\n${errors.join('\n')}`);
  }

  return { meta: data, body: body.trim() };
}

/**
 * Splits the markdown body into three sections by top-level headers.
 * Sections: # PRD, # DECISION NOTES, # CLAUDE CODE INSTRUCTIONS
 *
 * Strips --- horizontal rule separators between sections.
 *
 * @param {string} body — markdown body (after frontmatter)
 * @returns {{ prd: string, decisionNotes: string, ccInstructions: string }}
 * @throws {Error} if any section is missing or empty
 */
function splitSections(body) {
  const prdMatch = body.match(/^# PRD\s*$/im);
  const dnMatch = body.match(/^# DECISION NOTES\s*$/im);
  const ccMatch = body.match(/^# CLAUDE CODE INSTRUCTIONS\s*$/im);

  const missing = [];
  if (!prdMatch) missing.push('# PRD');
  if (!dnMatch) missing.push('# DECISION NOTES');
  if (!ccMatch) missing.push('# CLAUDE CODE INSTRUCTIONS');

  if (missing.length > 0) {
    throw new Error(`Missing sections: ${missing.join(', ')}`);
  }

  const prdStart = prdMatch.index;
  const dnStart = dnMatch.index;
  const ccStart = ccMatch.index;

  const prdRaw = body.substring(prdStart, dnStart);
  const dnRaw = body.substring(dnStart, ccStart);
  const ccRaw = body.substring(ccStart);

  const clean = (text) => text.replace(/\n---\s*$/, '').trim();

  const prd = clean(prdRaw);
  const decisionNotes = clean(dnRaw);
  const ccInstructions = clean(ccRaw);

  const empties = [];
  if (prd.split('\n').length <= 1) empties.push('PRD');
  if (decisionNotes.split('\n').length <= 1) empties.push('DECISION NOTES');
  if (ccInstructions.split('\n').length <= 1) empties.push('CLAUDE CODE INSTRUCTIONS');

  if (empties.length > 0) {
    throw new Error(`Empty sections (no content after header): ${empties.join(', ')}`);
  }

  return { prd, decisionNotes, ccInstructions };
}

module.exports = { parseFrontmatter, splitSections };
