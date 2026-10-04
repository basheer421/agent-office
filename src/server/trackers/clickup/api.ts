// ClickUp's REST API (v2), with the office's own API token. The ClickUp MCP sign-in is per
// agent session, so the server can't use it: it reads CLICKUP_API_TOKEN from its environment.
import { HostError } from '../../../shared/model/host.js';

const PAGES_MAX = 10;

export interface ClickUpTask {
  id: string;
  custom_id?: string | null;
  name: string;
  text_content?: string | null;
  description?: string | null;
  status?: { status?: string; type?: string };
  url: string;
  creator?: { username?: string | null };
  assignees?: { username?: string | null }[];
  tags?: { name: string; tag_bg?: string }[];
  list?: { id: string; name: string };
  date_created?: string;
  date_updated?: string;
}

export interface ClickUpComment {
  id: string;
  comment_text?: string;
  user?: { username?: string | null };
  date?: string;
}

export interface ClickUpStatus {
  status: string;
  color?: string;
  type?: string;
  orderindex?: number | string;
}

export interface ClickUpList {
  id: string;
  name: string;
}

export interface ClickUpSpace {
  id: string;
  name: string;
}

/** Where the API is (a test points it at a fake one) and the token, read when asked so a restart isn't needed to fix either. */
export function clickUpEnv(): { base: string; token?: string; team?: string } {
  return {
    base: (process.env.CLICKUP_API_URL || 'https://api.clickup.com/api/v2').replace(/\/+$/, ''),
    token: process.env.CLICKUP_API_TOKEN?.trim() || undefined,
    team: process.env.CLICKUP_TEAM_ID?.trim() || undefined,
  };
}

export const NO_TOKEN = 'The office has no ClickUp API token: set CLICKUP_API_TOKEN in its environment and restart it';

export class ClickUpApi {
  private team?: Promise<string>;

  get<T>(pathAndQuery: string): Promise<T> {
    return this.call<T>('GET', pathAndQuery);
  }

  /** A write: only ever from a person's click on the board, never a worker's own. */
  send<T>(method: 'POST' | 'PUT', path: string, body: unknown): Promise<T> {
    return this.call<T>(method, path, body);
  }

  private async call<T>(method: string, pathAndQuery: string, body?: unknown): Promise<T> {
    const { base, token } = clickUpEnv();
    if (!token) throw new HostError('auth', NO_TOKEN);
    let res: Response;
    try {
      const headers: Record<string, string> = { Authorization: token, Accept: 'application/json' };
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      res = await fetch(`${base}${pathAndQuery}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20_000) });
    } catch (err) {
      throw new HostError('failed', `Couldn't reach ClickUp: ${(err as Error).message}`);
    }
    if (res.status === 429) throw new HostError('rate-limit', 'ClickUp says the office is asking too often; it will try again');
    if (res.status === 401) throw new HostError('auth', "ClickUp turned the office's API token away (CLICKUP_API_TOKEN)");
    if (res.status === 404) throw new HostError('not-found', 'ClickUp has no such thing');
    if (!res.ok) throw new HostError('failed', `ClickUp answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return (await res.json()) as T;
  }

  /** The workspace: CLICKUP_TEAM_ID, else the token's first. */
  teamId(): Promise<string> {
    const fixed = clickUpEnv().team;
    if (fixed) return Promise.resolve(fixed);
    this.team ??= this.get<{ teams: { id: string }[] }>('/team').then((r) => {
      if (!r.teams?.length) throw new HostError('not-found', "The office's ClickUp token sees no workspace");
      return String(r.teams[0].id);
    });
    this.team.catch(() => (this.team = undefined));
    return this.team;
  }

  async spaces(): Promise<ClickUpSpace[]> {
    const team = await this.teamId();
    const r = await this.get<{ spaces: ClickUpSpace[] }>(`/team/${encodeURIComponent(team)}/space?archived=false`);
    return (r.spaces ?? []).map((s) => ({ id: String(s.id), name: s.name }));
  }

  /** A space's open tasks (subtasks too), a page of 100 at a time. */
  async openTasks(space: string): Promise<ClickUpTask[]> {
    const team = await this.teamId();
    const out: ClickUpTask[] = [];
    for (let page = 0; page < PAGES_MAX; page++) {
      const q = new URLSearchParams({ 'space_ids[]': space, page: String(page), subtasks: 'true', include_closed: 'false', order_by: 'updated' });
      const r = await this.get<{ tasks: ClickUpTask[]; last_page?: boolean }>(`/team/${encodeURIComponent(team)}/task?${q}`);
      out.push(...(r.tasks ?? []));
      if (r.last_page !== false || (r.tasks ?? []).length < 100) break;
    }
    return out;
  }

  task(id: string): Promise<ClickUpTask> {
    return this.get<ClickUpTask>(`/task/${encodeURIComponent(id)}`);
  }

  async comments(id: string): Promise<ClickUpComment[]> {
    const r = await this.get<{ comments: ClickUpComment[] }>(`/task/${encodeURIComponent(id)}/comment`);
    return r.comments ?? [];
  }

  /** A list's workflow statuses, in order. */
  async listStatuses(list: string): Promise<ClickUpStatus[]> {
    const r = await this.get<{ statuses?: ClickUpStatus[] }>(`/list/${encodeURIComponent(list)}`);
    return [...(r.statuses ?? [])].sort((a, b) => Number(a.orderindex ?? 0) - Number(b.orderindex ?? 0));
  }

  /** A space's lists: those in its folders, in order, then those outside any folder (ClickUp's sidebar order). */
  async lists(space: string): Promise<ClickUpList[]> {
    const s = encodeURIComponent(space);
    const [folders, loose] = await Promise.all([
      this.get<{ folders?: { name: string; lists?: ClickUpList[] }[] }>(`/space/${s}/folder?archived=false`),
      this.get<{ lists?: ClickUpList[] }>(`/space/${s}/list?archived=false`),
    ]);
    const inFolders = (folders.folders ?? []).flatMap((f) => (f.lists ?? []).map((l) => ({ id: String(l.id), name: `${f.name} › ${l.name}` })));
    return [...inFolders, ...(loose.lists ?? []).map((l) => ({ id: String(l.id), name: l.name }))];
  }

  async addComment(id: string, text: string): Promise<{ id: string; date?: string | number }> {
    const r = await this.send<{ id: string | number; date?: string | number }>('POST', `/task/${encodeURIComponent(id)}/comment`, { comment_text: text, notify_all: false });
    return { id: String(r.id), date: r.date };
  }

  setStatus(id: string, status: string): Promise<ClickUpTask> {
    return this.send<ClickUpTask>('PUT', `/task/${encodeURIComponent(id)}`, { status });
  }

  createTask(list: string, name: string, description: string): Promise<ClickUpTask> {
    return this.send<ClickUpTask>('POST', `/list/${encodeURIComponent(list)}/task`, { name, description });
  }
}
