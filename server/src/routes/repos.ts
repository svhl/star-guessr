import { Router, Request, Response } from 'express';
import https from 'https';
import { getDb } from '../db';
import { RepoRecord, RepoForGame, FileTreeNode } from '../types';

function fetchRaw(url: string, headers: Record<string, string> = {}): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'star-guessr/1.0', ...headers } }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    }).on('error', reject);
  });
}

function githubHeaders(): Record<string, string> {
  const token = process.env.GITHUB_TOKEN;
  return token
    ? { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }
    : { Accept: 'application/vnd.github+json' };
}

// filter out star history charts from README to prevent them from being used as hints in the game

const STAR_HISTORY_API_MARKER = 'https://api.star-history.com';

function findEnclosingBlockStart(lines: string[], fromIndex: number, startPattern: RegExp, endPattern: RegExp): number {
  for (let index = fromIndex; index >= 0; index--) {
    if (endPattern.test(lines[index])) {
      break;
    }
    if (startPattern.test(lines[index])) {
      return index;
    }
  }
  return -1;
}

function findEnclosingBlockEnd(lines: string[], fromIndex: number, endPattern: RegExp): number {
  for (let index = fromIndex; index < lines.length; index++) {
    if (endPattern.test(lines[index])) {
      return index;
    }
  }
  return -1;
}

function buildProtectedCodeFenceLines(lines: string[]): boolean[] {
  const protectedLines = new Array(lines.length).fill(false);
  let openFenceLine = -1;

  for (let index = 0; index < lines.length; index++) {
    if (!/^```/.test(lines[index].trim())) {
      continue;
    }

    if (openFenceLine === -1) {
      openFenceLine = index;
      continue;
    }

    for (let blockIndex = openFenceLine + 1; blockIndex < index; blockIndex++) {
      protectedLines[blockIndex] = true;
    }
    openFenceLine = -1;
  }

  return protectedLines;
}

function sanitizeReadme(content: string): string {
  const newline = content.includes('\r\n') ? '\r\n' : '\n';
  const lines = content.split(/\r?\n/);
  const protectedCodeFenceLines = buildProtectedCodeFenceLines(lines);
  const replacements = new Map<number, string>();
  const removeLine = new Array(lines.length).fill(false);

  for (let index = 0; index < lines.length; index++) {
    if (protectedCodeFenceLines[index]) {
      continue;
    }

    if (!lines[index].includes(STAR_HISTORY_API_MARKER)) {
      continue;
    }

    let start = findEnclosingBlockStart(lines, index, /<a\b/i, /<\/a>/i);
    let end = start !== -1 ? findEnclosingBlockEnd(lines, index, /<\/a>/i) : -1;

    if (start === -1 || end === -1) {
      start = findEnclosingBlockStart(lines, index, /<picture\b/i, /<\/picture>/i);
      end = start !== -1 ? findEnclosingBlockEnd(lines, index, /<\/picture>/i) : -1;
    }

    if (start === -1 || end === -1) {
      removeLine[index] = true;
      replacements.set(index, ';)');
      continue;
    }

    replacements.set(start, ';)');
    for (let blockIndex = start; blockIndex <= end; blockIndex++) {
      removeLine[blockIndex] = true;
    }
  }

  return lines
    .flatMap((line, index) => {
      if (!removeLine[index]) {
        return [line];
      }
      return replacements.get(index) ? [replacements.get(index) as string] : [];
    })
    .join(newline);
}

const router = Router();

router.get('/:id/readme', async (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id) || id <= 0) {
    res.status(400).json({ error: 'Invalid repo id' });
    return;
  }

  const db = getDb();
  const row = db.prepare('SELECT owner, name, default_branch FROM repos WHERE id = ?').get(id) as { owner: string; name: string; default_branch: string } | undefined;
  if (!row) {
    res.status(404).json({ error: 'Repo not found' });
    return;
  }

  const { owner, name, default_branch } = row;
  const url = `https://raw.githubusercontent.com/${owner}/${name}/${default_branch}/README.md`;
  try {
    const { status, body } = await fetchRaw(url);
    if (status === 200) {
      res.json({ content: sanitizeReadme(body) });
    } else {
      res.json({ content: '' });
    }
  } catch {
    res.json({ content: '' });
  }
});

router.get('/:id/file', async (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id) || id <= 0) {
    res.status(400).json({ error: 'Invalid repo id' });
    return;
  }

  const filePath = req.query.path as string | undefined;
  if (!filePath || typeof filePath !== 'string' || filePath.length > 500) {
    res.status(400).json({ error: 'path query param required' });
    return;
  }
  if (filePath.includes('..') || filePath.startsWith('/')) {
    res.status(400).json({ error: 'Invalid path' });
    return;
  }

  const db = getDb();
  const row = db.prepare('SELECT owner, name, default_branch, file_tree FROM repos WHERE id = ?').get(id) as { owner: string; name: string; default_branch: string; file_tree: string } | undefined;
  if (!row) {
    res.status(404).json({ error: 'Repo not found' });
    return;
  }

  const tree: FileTreeNode[] = JSON.parse(row.file_tree || '[]');

  function findNode(nodes: FileTreeNode[], targetPath: string): FileTreeNode | null {
    for (const node of nodes) {
      if (node.path === targetPath) return node;
      if (node.children) {
        const found = findNode(node.children, targetPath);
        if (found) return found;
      }
    }
    return null;
  }

  const node = findNode(tree, filePath);
  if (!node || node.type !== 'blob') {
    res.status(404).json({ error: 'File not found in tree' });
    return;
  }

  const { owner, name, default_branch } = row;
  const url = `https://raw.githubusercontent.com/${owner}/${name}/${default_branch}/${filePath}`;
  try {
    const { status, body } = await fetchRaw(url);
    if (status === 200) {
      res.json({ content: body, name: node.name });
    } else {
      res.status(404).json({ error: 'File content unavailable' });
    }
  } catch {
    res.status(502).json({ error: 'Failed to fetch file content' });
  }
});

router.get('/:id/stars', (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id) || id <= 0) {
    res.status(400).json({ error: 'Invalid repo id' });
    return;
  }

  const db = getDb();
  const row = db.prepare('SELECT stars FROM repos WHERE id = ?').get(id) as { stars: number } | undefined;
  if (!row) {
    res.status(404).json({ error: 'Repo not found' });
    return;
  }

  res.json({ stars: row.stars });
});

router.get('/:id/tree/:sha', async (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id) || id <= 0) {
    res.status(400).json({ error: 'Invalid repo id' });
    return;
  }

  const sha = req.params.sha;
  if (!/^[0-9a-f]{40}$/.test(sha)) {
    res.status(400).json({ error: 'Invalid sha' });
    return;
  }

  const db = getDb();
  const row = db.prepare('SELECT owner, name FROM repos WHERE id = ?').get(id) as { owner: string; name: string } | undefined;
  if (!row) {
    res.status(404).json({ error: 'Repo not found' });
    return;
  }

  const url = `https://api.github.com/repos/${row.owner}/${row.name}/git/trees/${sha}`;
  try {
    const { status, body } = await fetchRaw(url, githubHeaders());
    if (status !== 200) {
      res.status(502).json({ error: 'Failed to fetch tree' });
      return;
    }
    const data = JSON.parse(body) as { tree: { path: string; type: string; sha: string }[] };
    const nodes: FileTreeNode[] = data.tree.map(item => ({
      name: item.path,
      type: item.type === 'tree' ? 'tree' : 'blob',
      path: item.path,
      sha: item.sha,
    }));
    res.json({ nodes });
  } catch {
    res.status(502).json({ error: 'Failed to fetch tree' });
  }
});

router.get('/:id', (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id) || id <= 0) {
    res.status(400).json({ error: 'Invalid repo id' });
    return;
  }

  const db = getDb();
  const row = db.prepare('SELECT * FROM repos WHERE id = ?').get(id) as RepoRecord | undefined;
  if (!row) {
    res.status(404).json({ error: 'Repo not found' });
    return;
  }

  const repo: RepoForGame = {
    id: row.id,
    name: row.name,
    owner: row.owner,
    description: row.description,
    language: row.language,
    created_at: row.created_at,
    topics: JSON.parse(row.topics || '[]') as string[],
    license: row.license,
    file_tree: JSON.parse(row.file_tree || '[]'),
    commits: JSON.parse(row.commits || '[]'),
  };

  res.json(repo);
});

export default router;