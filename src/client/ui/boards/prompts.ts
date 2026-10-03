import type { AgentEffort, AgentProvider, Issue, MergeMethod, ChangeRequest } from '../../../shared/protocol';
import { issueRefOf } from '../../../shared/model/issue';
import { store } from '../../state';
import { repoUrlOf } from '../markdown';
import type { MeetingPreset } from '../meeting';
import { glabPrompt } from '../../../shared/glab-prompt';
import { clickupPrompts } from '../../../shared/clickup-prompt';
import { officePrompt } from '../prompts';

/** An issue prompt in ClickUp's words, when the floor's issues are a ClickUp space; else undefined. */
function clickup(which: keyof typeof clickupPrompts, it: Pick<Issue, 'id' | 'title'> & { ref?: string; url?: string }): string | undefined {
  if (store.tracker.kind !== 'clickup') return undefined;
  const v = issueVars(it);
  const text = clickupPrompts[which]({ ref: v.ref, title: v.title, url: v.url });
  return store.host.kind === 'gitlab' ? glabPrompt(text) : text;
}

// ---- Prompts for workers ------------------------------------------------------------------------

export interface BoardActions {
  /** Start a worker on a ready-made prompt (shown for editing first). With `issue`, the worker takes that issue, which moves to In progress. */
  assign(prompt: string, title: string, issue?: string): void;
  /** Your own prompt about an issue or PR; `context` goes first so the worker knows which. */
  ask(context: string, title: string): void;
  /** Walks you to the desk a pull request came from. */
  goToDesk(deskId: string): void;
  /** Put an issue on the 📋 task queue; a worker is seated for it when there's room. */
  queue(prompt: string, title: string, issue: string, provider?: AgentProvider, model?: string, effort?: AgentEffort): void;
  /** Take the issue's card off the board, to carry to a desk or the queue (not on the 2D view, where there's nobody to carry it). */
  pickUp?(issue: Issue): void;
  /** Call a meeting about it: the meeting room's form, filled in. */
  meeting(preset: MeetingPreset): void;
}

/** The task a worker gets for an issue, from the board, a carried card or the queue (the 'issue.work' prompt). */
export function issuePrompt(it: Pick<Issue, 'id' | 'title'> & { ref?: string; url?: string }): string {
  return clickup('work', it) ?? officePrompt('issue.work', issueVars(it));
}

/**
 * What an issue's prompts fill in: {{ref}} is how people write it ("#12"), {{number}} its id, which
 * prompts saved before issues had refs still use. A carried card has no URL or ref, but the board
 * usually knows them.
 */
export function issueVars(it: Pick<Issue, 'id' | 'title'> & { ref?: string; url?: string }) {
  const known = store.issues.items.find((i) => i.id === it.id);
  return { number: it.id, ref: it.ref ?? known?.ref ?? issueRefOf(it.id), title: it.title, url: it.url ?? known?.url ?? '' };
}

/** owner/repo from a PR or issue URL. */
function nameWithOwner(url: string): string {
  return repoUrlOf(url).replace(/^https?:\/\/[^/]+\//, '');
}

/** What a pull request's prompts fill in. */
export function pullVars(it: ChangeRequest) {
  return { number: it.number, title: it.title, url: it.url, branch: it.sourceBranch, base: it.targetBranch };
}

export function reviewPrompt(it: ChangeRequest) {
  return officePrompt('pull.review', pullVars(it));
}

function mergeCommand(it: ChangeRequest, method: MergeMethod, deleteBranch: boolean) {
  return `gh pr merge ${it.number} --${method}${deleteBranch ? ' --delete-branch' : ''} --repo ${nameWithOwner(it.url)}`;
}

function mergeVars(it: ChangeRequest, method: MergeMethod, deleteBranch: boolean) {
  return { ...pullVars(it), repo: nameWithOwner(it.url), merge: mergeCommand(it, method, deleteBranch) };
}

export function fixAndMergePrompt(it: ChangeRequest, method: MergeMethod, deleteBranch: boolean) {
  return officePrompt('pull.fixMerge', mergeVars(it, method, deleteBranch));
}

export function fixConflictsPrompt(it: ChangeRequest, method: MergeMethod, deleteBranch: boolean) {
  return officePrompt('pull.fixConflicts', mergeVars(it, method, deleteBranch));
}

export function pullContext(it: ChangeRequest) {
  return officePrompt('pull.ask', pullVars(it));
}

/** What a 🤝 Meeting about an issue is about, to start with. */
export function issueMeetingPrompt(it: Pick<Issue, 'id' | 'title'>) {
  return clickup('meeting', it) ?? officePrompt('issue.meeting', issueVars(it));
}

export function issueContext(it: Issue) {
  return clickup('ask', it) ?? officePrompt('issue.ask', issueVars(it));
}
