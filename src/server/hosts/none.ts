// A floor with no code host: empty boards, and every change says why it can't happen.
import type { ChangeRequest, ChangeRequestDetail, Comment } from '../../shared/model/change-request.js';
import { HostError, type HostCapabilities, type HostVocabulary } from '../../shared/model/host.js';
import type { CodeHost } from './types.js';

const unsupported = (): never => {
  throw new HostError('unsupported', "This project has no code host the office knows (GitHub or GitLab)", 'Push it to GitHub or GitLab, or set its host in ⚙️ Project settings');
};

export class NoHost implements CodeHost {
  readonly kind = 'none' as const;
  readonly caps: HostCapabilities = { labels: false, reviews: false, autoMerge: false, draft: false, lineComments: false, mergeMethods: [] };
  readonly words: HostVocabulary = { crNoun: 'pull request', crShort: 'PR', refPrefix: '#', cli: 'gh' };

  async viewer(): Promise<string> { return ''; }
  async list(): Promise<ChangeRequest[]> { return []; }
  async detail(): Promise<ChangeRequestDetail> { return unsupported(); }
  async diff(): Promise<string> { return unsupported(); }
  async create(): Promise<ChangeRequest> { return unsupported(); }
  async findForBranch(): Promise<ChangeRequest | undefined> { return undefined; }
  async comment(): Promise<Comment> { return unsupported(); }
  async review(): Promise<string> { return unsupported(); }
  async merge(): Promise<void> { unsupported(); }
  async close(): Promise<void> { unsupported(); }
  createdBy(): string | undefined { return undefined; }
}
