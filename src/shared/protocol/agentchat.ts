// A worker in chat mode (WorkerInfo.chat): the office drives its agent over a structured transport
// (Pi's --mode rpc) instead of a terminal, and draws its own chat for it. The server turns the
// agent's events into these items, keeps the latest of them, and sends browsers only what changed.

/** One thing in a worker's chat. `done` once it won't change any more. */
export type ChatItem =
  | { id: string; k: 'user'; text: string }
  /** What it says, as markdown, growing while it streams. */
  | { id: string; k: 'text'; text: string; done?: boolean }
  | { id: string; k: 'thinking'; text: string; done?: boolean }
  /** A tool call: `args` is a short summary of what it was called with (a bash command, a path), `output` the tail of its result. */
  | { id: string; k: 'tool'; name: string; args: string; output: string; error?: boolean; done?: boolean }
  /** The agent asks whoever is at the desk something (an extension's select, confirm, input or editor). `answer` once it's answered. */
  | { id: string; k: 'ask'; method: ChatAskMethod; title: string; message?: string; options?: string[]; prefill?: string; answer?: string; done?: boolean }
  | { id: string; k: 'note'; text: string; level: 'info' | 'warn' | 'error' };

export type ChatAskMethod = 'select' | 'confirm' | 'input' | 'editor';

/**
 * A change to a chat: an item added or replaced, text appended to one (`text` of a message, `output`
 * of a tool, or put in place of it with `replace`), or one finished (a tool's with `error` if it failed).
 */
export type ChatOp =
  | { op: 'put'; item: ChatItem }
  | { op: 'add'; id: string; field: 'text' | 'output'; text: string; replace?: boolean }
  | { op: 'done'; id: string; error?: boolean };

/** The lines under the chat: its extensions' status and widgets, and whether it's mid-turn. */
export interface ChatFooter {
  busy: boolean;
  status: string[];
  widgets: string[];
}

export type ChatSendMode = 'prompt' | 'steer' | 'follow_up';

export type ChatClientMsg =
  /** Opening a worker's chat: answered with a `chat.snapshot`, then its `chat.ops` while you're attached (worker.attach). */
  | { t: 'chat.open'; workerId: string }
  /** A message for it: a prompt, or while it's working, steering it now or queued for after. */
  | { t: 'chat.send'; workerId: string; text: string; mode?: ChatSendMode }
  | { t: 'chat.abort'; workerId: string }
  /** An answer to one of its asks: a pick or text (`value`), a yes or no (`confirmed`), or none (`cancelled`). */
  | { t: 'chat.answer'; workerId: string; askId: string; value?: string; confirmed?: boolean; cancelled?: boolean }
  /** Moves a Pi worker between chat mode and its terminal: it restarts, carrying on the same session. */
  | { t: 'chat.mode'; workerId: string; chat: boolean };

export type ChatServerMsg =
  | { t: 'chat.snapshot'; workerId: string; items: ChatItem[]; footer: ChatFooter }
  | { t: 'chat.ops'; workerId: string; ops: ChatOp[] }
  | { t: 'chat.footer'; workerId: string; footer: ChatFooter };
