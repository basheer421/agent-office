// A project's settings: what detect.ts finds, with whatever someone overrode on top. The overrides
// alone live in <project>/.agent-office/project.json, so they travel with the checkout and every
// field nobody touched is detected afresh. This module is the only one that reads or writes it.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { ProjectConfig, ProjectOverrides } from '../../shared/protocol/projects.js';
import { DEFAULT_GITLAB_HOSTS, detect, remoteFacts } from './detect.js';

const FIELDS = ['pushRemote', 'baseBranch'] as const;
/** A ClickUp space id: digits. */
const CLICKUP_ID = /^\d{1,20}$/;

/** The main checkout a folder belongs to (a worker's worktree reads its project's settings). */
function mainCheckout(dir: string): string {
  try {
    const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: dir, encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return path.basename(common) === '.git' ? path.dirname(common) : dir;
  } catch {
    return dir;
  }
}

export function configFile(dir: string): string {
  return path.join(mainCheckout(dir), '.agent-office', 'project.json');
}

/** The fields someone overrode; a broken file counts as none. */
export function overrides(dir: string): ProjectOverrides {
  try {
    const raw = JSON.parse(readFileSync(configFile(dir), 'utf8')) as Record<string, unknown>;
    const out: ProjectOverrides = {};
    for (const k of FIELDS) if (typeof raw[k] === 'string' && raw[k]) out[k] = raw[k] as string;
    if (typeof raw.clickupSpace === 'string' && CLICKUP_ID.test(raw.clickupSpace)) {
      out.clickupSpace = raw.clickupSpace;
      if (typeof raw.clickupList === 'string' && CLICKUP_ID.test(raw.clickupList)) out.clickupList = raw.clickupList;
    }
    return out;
  } catch {
    return {};
  }
}

/** Saves `next` as the overrides: a field that's empty, or the same as detected, isn't kept. Returns why it can't. */
export function setOverrides(dir: string, next: ProjectOverrides, gitlabHosts: readonly string[] = DEFAULT_GITLAB_HOSTS): string | undefined {
  const found = detect(dir, gitlabHosts);
  const keep: ProjectOverrides = {};
  for (const k of FIELDS) {
    const v = next[k]?.trim();
    if (!v) continue;
    if (!/^[\w./-]{1,200}$/.test(v) || v.startsWith('-') || v.includes('..')) return `${k === 'pushRemote' ? 'Push remote' : 'Base branch'} "${v}" isn't a name git takes`;
    if (k === 'pushRemote' && !found.remotes.includes(v)) return `This checkout has no remote called ${v}`;
    keep[k] = v;
  }
  const space = next.clickupSpace?.trim();
  if (space) {
    if (!CLICKUP_ID.test(space)) return `ClickUp space "${space}" isn't a space id (a number, from the space's URL)`;
    keep.clickupSpace = space;
    // The list only means something in its space.
    const list = next.clickupList?.trim();
    if (list) {
      if (!CLICKUP_ID.test(list)) return `ClickUp list "${list}" isn't a list id (a number)`;
      keep.clickupList = list;
    }
  }
  try {
    mkdirSync(path.dirname(configFile(dir)), { recursive: true });
    writeFileSync(configFile(dir), JSON.stringify(keep, null, 2) + '\n');
  } catch (err) {
    return `Couldn't save ${configFile(dir)}: ${(err as Error).message}`;
  }
  return undefined;
}

/** Detected ⊕ overrides, and which fields are overridden. */
export function effective(dir: string, gitlabHosts: readonly string[] = DEFAULT_GITLAB_HOSTS): ProjectConfig {
  const found = detect(dir, gitlabHosts);
  const over = existsSync(configFile(dir)) ? overrides(dir) : {};
  let cfg = { ...found };
  if (over.pushRemote && over.pushRemote !== found.pushRemote && found.remotes.includes(over.pushRemote)) cfg = { ...cfg, pushRemote: over.pushRemote, ...remoteFacts(dir, over.pushRemote, gitlabHosts) };
  if (over.baseBranch) cfg.baseBranch = over.baseBranch;
  return { ...cfg, ...(over.clickupSpace ? { clickupSpace: over.clickupSpace } : {}), ...(over.clickupList ? { clickupList: over.clickupList } : {}), detected: found, overridden: Object.keys(over) as (keyof ProjectOverrides)[] };
}
