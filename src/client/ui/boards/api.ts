import type { ChangeRequest, Comment, Issue, Label, ServerMsg } from '../../../shared/protocol';
import { store } from '../../state';

// Talking to the office about the boards: the reads (over HTTP, for the floor you're on), and the
// answers to what the dialogs asked for over the socket (merged, commented, closed, labeled).

/** The board windows ask about the floor you're on. */
function onFloor(url: string): string {
  return store.floor ? `${url}${url.includes('?') ? '&' : '?'}floor=${encodeURIComponent(store.floor)}` : url;
}

export async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(onFloor(url), { credentials: 'same-origin' });
  if (!r.ok) throw new Error((await r.json().catch(() => null))?.error ?? `HTTP ${r.status}`);
  return r.json() as Promise<T>;
}

export async function getText(url: string): Promise<string> {
  const r = await fetch(onFloor(url), { credentials: 'same-origin' });
  if (!r.ok) throw new Error((await r.json().catch(() => null))?.error ?? `HTTP ${r.status}`);
  return r.text();
}

/** Which board an item is on: a change request (`pull`) or an issue. */
export type BoardKind = 'issue' | 'pull';

/** What an item is called in messages to the office: an issue's id, or a change request's number. */
export function idOf(it: Issue | ChangeRequest): string {
  return 'id' in it ? it.id : String(it.number);
}

/** How people write it: "#12" for an issue (its tracker's ref), "#5" or "!5" for a change request. */
export function refOf(it: Issue | ChangeRequest): string {
  return 'ref' in it ? it.ref : `${store.host.words.refPrefix}${it.number}`;
}

/** The floor's word for a change request, short ("PR", "MR") or in full ("pull request"). */
export function crShort(): string {
  return store.host.words.crShort;
}
export function crNoun(): string {
  return store.host.words.crNoun;
}

export const mergeWaiters = new Map<number, (msg: Extract<ServerMsg, { t: 'cr.merged' }>) => void>();
/** Open comment boxes, by "issue#id" or "pull#N". */
export const commentWaiters = new Map<string, (msg: { comment?: Comment; error?: string }) => void>();
/** Open close dialogs, by "issue:id" or "pull:N". */
export const closeWaiters = new Map<string, (msg: { error?: string }) => void>();
/** Open label pickers, by "issue:id" or "pull:N". */
export const labelWaiters = new Map<string, (msg: { labels?: Label[]; error?: string }) => void>();

/** Main feeds server messages through here so an open merge, close or label dialog or comment box hears back. */
export function routePullMessage(msg: ServerMsg) {
  if (msg.t === 'cr.merged') mergeWaiters.get(msg.number)?.(msg);
  if (msg.t === 'cr.commented') commentWaiters.get(`pull#${msg.number}`)?.(msg);
  if (msg.t === 'issues.commented') commentWaiters.get(`issue#${msg.id}`)?.(msg);
  if (msg.t === 'cr.closed') closeWaiters.get(`pull:${msg.number}`)?.(msg);
  if (msg.t === 'issues.closed') closeWaiters.get(`issue:${msg.id}`)?.(msg);
  if (msg.t === 'labels.changed') labelWaiters.get(`${msg.target === 'cr' ? 'pull' : 'issue'}:${msg.id}`)?.(msg);
}
