/**
 * GitHub Git Data API wrapper.
 * Commits multiple files in a single commit using the low-level
 * trees/blobs API (no working directory needed).
 *
 * Uses native fetch() — no Octokit dependency.
 */

const config = require('./config');
const logger = require('./logger');

const GITHUB_API = 'https://api.github.com';

/**
 * Makes an authenticated GitHub API request.
 *
 * @param {string} endpoint — API path (e.g. /repos/owner/repo/git/ref/heads/main)
 * @param {Object} [options] — fetch options (method, body)
 * @returns {Promise<Object>} — parsed JSON response
 * @throws {Error} with status code and message from GitHub
 */
async function githubFetch(endpoint, options = {}) {
  const url = `${GITHUB_API}${endpoint}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${config.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...options.headers,
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (!response.ok) {
    const errorBody = await response.text();
    const err = new Error(`GitHub API ${response.status}: ${errorBody}`);
    err.status = response.status;
    throw err;
  }

  return response.json();
}

/**
 * Commits multiple files to a GitHub repository in a single commit.
 * Uses the Git Data API (trees + commits + refs).
 *
 * @param {Object} params
 * @param {string} params.owner — repo owner (e.g. "bryanchong32")
 * @param {string} params.repo — repo name (e.g. "mom-crm-webapp")
 * @param {string} params.branch — branch name (e.g. "main")
 * @param {Array<{path: string, content: string}>} params.files — files to commit
 * @param {string} params.message — commit message
 * @returns {Promise<{commitSha: string, commitUrl: string}>}
 */
async function commitFiles({ owner, repo, branch, files, message }) {
  logger.info('GitHub commit starting', { owner, repo, branch, fileCount: files.length });

  const ref = await githubFetch(`/repos/${owner}/${repo}/git/ref/heads/${branch}`);
  const latestCommitSha = ref.object.sha;

  const commit = await githubFetch(`/repos/${owner}/${repo}/git/commits/${latestCommitSha}`);
  const baseTreeSha = commit.tree.sha;

  const tree = files.map((file) => ({
    path: file.path,
    mode: '100644',
    type: 'blob',
    content: file.content,
  }));

  const newTree = await githubFetch(`/repos/${owner}/${repo}/git/trees`, {
    method: 'POST',
    body: {
      base_tree: baseTreeSha,
      tree,
    },
  });

  const newCommit = await githubFetch(`/repos/${owner}/${repo}/git/commits`, {
    method: 'POST',
    body: {
      message,
      tree: newTree.sha,
      parents: [latestCommitSha],
    },
  });

  /* Note: GET uses /git/ref/ (singular) but PATCH uses /git/refs/ (plural) */
  await githubFetch(`/repos/${owner}/${repo}/git/refs/heads/${branch}`, {
    method: 'PATCH',
    body: {
      sha: newCommit.sha,
    },
  });

  logger.info('GitHub commit complete', { sha: newCommit.sha });

  return {
    commitSha: newCommit.sha,
    commitUrl: newCommit.html_url,
  };
}

module.exports = { commitFiles };
