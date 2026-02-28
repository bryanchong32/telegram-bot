/**
 * Project configuration for the Request Agent.
 * Maps project keys (from frontmatter) to GitHub repo + Notion DB details.
 *
 * Bryan fills in notion_database_id after creating the Notion databases.
 */

module.exports = {
  'ecomwave-crm': {
    github_repo: 'bryanchong32/mom-crm-webapp',
    github_branch: 'main',
    notion_database_id: '315cb310-967f-816c-9b5c-cb246c681079',
    docs_path: 'docs/requests',
  },
  'telegram-bot': {
    github_repo: 'bryanchong32/telegram-bot',
    github_branch: 'main',
    notion_database_id: '315cb310-967f-816c-9b5c-cb246c681079',
    docs_path: 'docs/requests',
  },
};
