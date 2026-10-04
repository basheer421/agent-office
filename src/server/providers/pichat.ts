// Pi in chat mode: the same Pi, run as `pi --mode rpc` with the office reading its events instead of
// a terminal (see ../pirpc.ts, issue #47). Its status, usage and session id come off those events,
// so it loads no hook extension. Each desk keeps its sessions in a folder of its own, as Pi's does.
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { piArgs } from '../pi.js';
import type { ProviderAdapter } from './types.js';

export const piChat: ProviderAdapter<undefined, { dataDir: string }> = {
  id: 'pi-chat',
  transport: 'rpc',
  prepare: ({ dataDir }) => ({ dataDir }),
  launch({ h, args, resumeSessionId, setup }) {
    const { info } = h;
    const sessionDir = path.join(setup.dataDir, 'pi-sessions', info.id);
    mkdirSync(sessionDir, { recursive: true, mode: 0o700 });
    // The first prompt goes over RPC once Pi is up (see PiRpcSession), not on the command line.
    return { args: piArgs(args, { mode: 'rpc', sessionDir, sessionId: resumeSessionId, model: info.model, effort: info.effort }) };
  },
  usage: { persisted: true },
};
