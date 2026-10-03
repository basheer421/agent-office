// Your own GitLab sign-ins (see gitlab-signins.ts). Accounts only: the shared password runs on the office's.
import type { SignInsClientMsg } from '../../../shared/protocol.js';
import type { Ctx } from '../../office/context.js';
import type { Client } from '../../office/client.js';
import { str } from '../../office/input.js';
import type { HandlerMap } from './types.js';

type GitLabMsg = Extract<SignInsClientMsg, { t: `signins.gitlab.${string}` }>;

const accountOf = (ctx: Ctx, c: Client): string | undefined => {
  const id = c.accountId;
  if (!id) ctx.warn(c, "On the shared office password, workers run on the office's own sign-ins");
  return id;
};

export const gitlabSigninsHandlers = {
  'signins.gitlab.token'(ctx, c, msg) {
    const id = accountOf(ctx, c);
    if (!id) return;
    void ctx.signins.gitlab.token(id, str(msg.host, 255), str(msg.token, 4096)).then((err) => ctx.warn(c, err));
  },
  'signins.gitlab.signout'(ctx, c, msg) {
    const id = accountOf(ctx, c);
    if (!id) return;
    void ctx.signins.gitlab.signOut(id, str(msg.host, 255));
  },
  'signins.gitlab.office'(ctx, c, msg) {
    const id = accountOf(ctx, c);
    if (!id) return;
    ctx.warn(c, ctx.signins.gitlab.useOffice(id, msg.on === true));
  },
} satisfies HandlerMap<GitLabMsg>;
