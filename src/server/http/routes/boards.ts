// The change request and issue windows: one in full, a change request's diff, and the labels the
// project has. GET /api/boards/cr?number=N, /api/boards/cr/diff?number=N, /api/boards/issue?id=X, /api/boards/labels.
import { ISSUE_ID_MAX } from '../../../shared/protocol.js';
import { send } from '../util.js';
import type { Route } from '../router.js';
import { floorParam } from './files.js';

export const boardsRoutes = {
  boards: {
    method: 'GET',
    prefix: '/api/boards/',
    auth: 'session',
    async handle(ctx, { res, url, path: p, session }) {
      const floor = floorParam(ctx, url);
      const n = Number(url.searchParams.get('number'));
      const id = url.searchParams.get('id') ?? '';
      const isCr = p === '/api/boards/cr' || p === '/api/boards/cr/diff';
      if (isCr && (!Number.isSafeInteger(n) || n <= 0)) return send(res, 400, { error: 'Bad number' });
      if (p === '/api/boards/issue' && !(id.length <= ISSUE_ID_MAX && /^[\w.-]+$/.test(id))) return send(res, 400, { error: 'Bad id' });
      if (!floor) return send(res, 404, { error: 'No such floor' });
      const boards = floor.boards;
      try {
        // "You" on comments is your own GitHub login once you've signed in to it.
        const me = session.account ? ctx.signins.githubLogin(session.account.id) : undefined;
        if (p === '/api/boards/cr') return send(res, 200, await boards.pullDetail(n, me));
        if (p === '/api/boards/issue') return send(res, 200, await boards.issueDetail(id, me));
        if (p === '/api/boards/labels') return send(res, 200, await boards.repoLabels());
        if (p === '/api/boards/cr/diff') {
          const diff = await boards.pullDiff(n);
          res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
          res.end(diff);
          return;
        }
      } catch (err) {
        return send(res, 502, { error: (err as Error).message });
      }
      return send(res, 404, { error: 'Not found' });
    },
  },
} satisfies Record<string, Route>;
