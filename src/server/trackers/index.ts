// The one place that picks an issue tracker for a project folder. Everything else sees only IssueTracker.
import { githubRepo, hostKindOf } from '../hosts/index.js';
import { overrides } from '../projects/store.js';
import { ClickUpApi, ClickUpTracker, NO_TOKEN, clickUpEnv, type ClickUpList, type ClickUpSpace } from './clickup/index.js';
import { GitHubTracker } from './github/index.js';
import { NoTracker } from './none.js';
import type { IssueTracker } from './types.js';

export type { IssueTracker } from './types.js';
export { Claims } from './claims.js';

const clickupApi = new ClickUpApi();
/** The ClickUp spaces the office's token sees, for ⚙️ Project settings, or why there are none. */
export async function clickUpSpaces(): Promise<{ spaces: ClickUpSpace[]; error?: string }> {
  if (!clickUpEnv().token) return { spaces: [], error: NO_TOKEN };
  return clickupApi.spaces().then((spaces) => ({ spaces }), (err: Error) => ({ spaces: [], error: err.message }));
}

/** A space's lists, for ⚙️ Project settings to pick where new tasks go, or why there are none. */
export async function clickUpLists(space: string): Promise<{ lists: ClickUpList[]; error?: string }> {
  if (!clickUpEnv().token) return { lists: [], error: NO_TOKEN };
  return clickupApi.lists(space).then((lists) => ({ lists }), (err: Error) => ({ lists: [], error: err.message }));
}

/** GitLab projects keep their issues in ClickUp: until a space is picked, no issues board on them. */
export const GITLAB_NO_ISSUES = "GitLab projects keep their issues in ClickUp: pick the floor's ClickUp space in ⚙️ Project settings to see its tasks here";

/** The tracker a folder has without a ClickUp space: its host's issues (GitHub), else none. */
function hostTracker(dir: string, kind: 'github' | 'gitlab' | 'none'): IssueTracker {
  return kind === 'github' ? new GitHubTracker(githubRepo(dir)) : new NoTracker(GITLAB_NO_ISSUES);
}

/** Bumped when ⚙️ Project settings are saved, so every FloorTracker reads its space again. */
let generation = 0;
export function trackerChanged(): void {
  generation++;
}

/**
 * A floor's tracker: its ClickUp space when ⚙️ Project settings has one, else its host's. Asked
 * again each time it's used, so picking or clearing a space takes effect on the next look.
 */
export class FloorTracker implements IssueTracker {
  private fallback?: IssueTracker;
  private clickup?: ClickUpTracker;
  /** The space as last read, and when (reading it runs git, and kind/caps are asked often). */
  private read = { at: 0, gen: -1, space: undefined as string | undefined, list: undefined as string | undefined };

  constructor(
    private readonly dir: string,
    private readonly hostKind: 'github' | 'gitlab' | 'none',
  ) {}

  /** What it is right now. */
  current(): IssueTracker {
    const now = Date.now();
    if (now - this.read.at > 2000 || this.read.gen !== generation) {
      const o = overrides(this.dir);
      this.read = { at: now, gen: generation, space: o.clickupSpace, list: o.clickupList };
    }
    const { space, list } = this.read;
    if (space) {
      if (this.clickup?.space !== space || this.clickup.newTaskList !== list) this.clickup = new ClickUpTracker(space, list);
      return this.clickup;
    }
    return (this.fallback ??= hostTracker(this.dir, this.hostKind));
  }

  get kind() {
    return this.current().kind;
  }
  get caps() {
    return this.current().caps;
  }
  list() {
    return this.current().list();
  }
  detail(id: string) {
    return this.current().detail(id);
  }
  reference(...a: Parameters<IssueTracker['reference']>) {
    return this.current().reference(...a);
  }
  get viewer() {
    const t = this.current();
    return t.viewer?.bind(t);
  }
  get comment() {
    const t = this.current();
    return t.comment?.bind(t);
  }
  get close() {
    const t = this.current();
    return t.close?.bind(t);
  }
  get assignSelf() {
    const t = this.current();
    return t.assignSelf?.bind(t);
  }
  get statuses() {
    const t = this.current();
    return t.statuses?.bind(t);
  }
  get setStatus() {
    const t = this.current();
    return t.setStatus?.bind(t);
  }
  get create() {
    const t = this.current();
    return t.create?.bind(t);
  }
  get labels() {
    return this.current().labels;
  }
}

export function trackerFor(dir: string, kind: 'github' | 'gitlab' | 'none' = hostKindOf(dir)): IssueTracker {
  return new FloorTracker(dir, kind);
}
