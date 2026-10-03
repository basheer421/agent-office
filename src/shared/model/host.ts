// What a code host (GitHub, GitLab, none) can do and what it calls things.
import type { MergeMethod } from './change-request.js';

export type HostKind = 'github' | 'gitlab' | 'none';

export interface HostCapabilities {
  labels: boolean;
  reviews: boolean;
  autoMerge: boolean;
  draft: boolean;
  lineComments: boolean;
  mergeMethods: MergeMethod[];
}

export interface HostVocabulary {
  crNoun: 'pull request' | 'merge request';
  crShort: 'PR' | 'MR';
  refPrefix: '#' | '!';
  cli: 'gh' | 'glab';
}

export type HostErrorKind = 'auth' | 'not-found' | 'no-remote' | 'cli-missing' | 'rate-limit' | 'unsupported' | 'failed';

export class HostError extends Error {
  constructor(readonly kind: HostErrorKind, message: string, readonly hint?: string) {
    super(message);
    this.name = 'HostError';
  }
}
