// The port every code host (GitHub, GitLab, none) implements. Consumers only ever see this.
import type { ChangeRequest, ChangeRequestDetail, CloseOptions, Comment, MergeOptions } from '../../shared/model/change-request.js';
import type { HostCapabilities, HostKind, HostVocabulary } from '../../shared/model/host.js';
import type { Label } from '../../shared/model/label.js';

/** Someone signed in to their own account on the host: the CLI runs with `env` (see signins.ts). */
export interface Actor {
  key: string;
  env: Record<string, string>;
}

export interface LabelOps {
  /** The repository's labels, for the picker. */
  list(): Promise<Label[]>;
  /** Resolves to the labels it has now, when the host says. */
  set(n: number, add: string[], remove: string[], as?: Actor): Promise<Label[] | void>;
}

export interface CodeHost {
  readonly kind: HostKind;
  readonly caps: HostCapabilities;
  readonly words: HostVocabulary;

  viewer(): Promise<string>;
  /** Open, plus recently merged and closed. */
  list(): Promise<ChangeRequest[]>;
  /** One change request, by number (or, on hosts that take one, its URL). */
  get(n: number | string): Promise<ChangeRequest>;
  detail(n: number): Promise<ChangeRequestDetail>;
  diff(n: number): Promise<string>;
  create(o: { source: string; target?: string; title: string; body: string }, as?: Actor): Promise<ChangeRequest>;
  findForBranch(branch: string): Promise<ChangeRequest | undefined>;
  comment(n: number, body: string, as?: Actor): Promise<Comment>;
  review(n: number, body: string, as?: Actor): Promise<string>;
  merge(n: number, o: MergeOptions, as?: Actor): Promise<void>;
  close(n: number, o: CloseOptions, as?: Actor): Promise<void>;
  /** A change request's description, and replacing it (the list of a change's others across repositories). */
  body?(n: number | string, as?: Actor): Promise<string>;
  setBody?(n: number | string, body: string, as?: Actor): Promise<void>;
  /** Present only when caps.labels. */
  labels?: LabelOps;
  /** Recognises "I opened one myself" in a worker's shell (gh pr create / glab mr create): the URL. */
  createdBy(command: string, output: string): string | undefined;
}
