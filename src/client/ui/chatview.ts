// A chat-mode worker's window (WorkerInfo.chat): its chat drawn by the office, not a terminal. What it
// says as markdown, its tool calls as cards (collapsed, the command and the tail of the output), its
// questions answered in place, and a box to prompt it, steer it, queue something for after its turn,
// or stop it. Its terminal is still a button away, with a plain transcript of the same.
import './chatview.css';
import type { Net } from '../net';
import { store } from '../state';
import { ChatLog } from '../../shared/chatlog';
import type { ChatFooter, ChatItem, ChatSendMode, ServerMsg } from '../../shared/protocol';
import { isAsleep } from '../../shared/status';
import { h, openModal, STATUS_LABEL, toast, type Modal } from './dom';
import { markdown } from './markdown';

export interface ChatOptions {
  /** Its terminal instead, for this time. */
  onRaw(): void;
  onChanges?: () => void;
}

let current: { workerId: string; modal: Modal; route(msg: ServerMsg): void } | null = null;

/** Every server message, for the open chat. */
export function routeChatMessage(msg: ServerMsg) {
  current?.route(msg);
}

/** Closes the open chat, if any (a terminal is opening instead). */
export function closeChat() {
  current?.modal.close();
}

const SEND_LABEL: Record<ChatSendMode, string> = { prompt: 'Send', steer: 'Steer now', follow_up: 'After this turn' };

export function openChat(net: Net, workerId: string, opts: ChatOptions) {
  if (current?.workerId === workerId) return;
  current?.modal.close();
  const info = store.workers.get(workerId);
  if (!info) return;

  const log = new ChatLog();
  const views = new Map<string, HTMLElement>();
  let footer: ChatFooter = { busy: false, status: [], widgets: [] };

  const pill = h('span.pill', {}, '');
  const rawBtn = h('button.btn', { type: 'button', title: 'Its terminal: a plain transcript of the same, and the keys' }, '⌨️ Terminal');
  const modeBtn = h('button.btn', { type: 'button', title: 'Run it in a terminal again (it restarts, carrying on the same conversation)' }, '↩︎ Terminal mode');
  const changesBtn = h('button.btn', { type: 'button', title: 'What this worker changed: files, diff, commit, open a PR' }, '🌿 Changes');
  const closeBtn = h('button.btn.close', { type: 'button', title: 'Close (Esc)', 'aria-label': 'Close' }, '✕');
  const list = h('div.chat-list', { role: 'log', 'aria-live': 'polite' });
  const foot = h('div.chat-foot');
  const box = h('textarea', { rows: 2, placeholder: `Tell ${info.name} what to do…`, 'aria-label': 'Message', enterkeyhint: 'send' }) as HTMLTextAreaElement;
  const mode = h('select.chat-mode', { 'aria-label': 'Send as' }) as HTMLSelectElement;
  for (const m of ['steer', 'follow_up'] as ChatSendMode[]) mode.append(h('option', { value: m }, SEND_LABEL[m]));
  const sendBtn = h('button.btn.primary', { type: 'submit' }, 'Send');
  const stopBtn = h('button.btn', { type: 'button', title: 'Stop its turn' }, '⏹ Stop');
  const form = h('form.chat-say', {}, box, h('div.chat-say-btns', {}, mode, stopBtn, sendBtn));
  const el = h(
    'div.modal.chat',
    { role: 'dialog', 'aria-label': `${info.name} chat` },
    h('header', {}, h('span.dot', { style: `background:${info.color}` }), h('h2', {}, `💬 ${info.name}`), pill, rawBtn, modeBtn, opts.onChanges ? changesBtn : null, closeBtn),
    list,
    foot,
    form,
  );

  /** Stuck to the bottom while you're reading there, left alone while you've scrolled up. */
  const atBottom = () => list.scrollHeight - list.scrollTop - list.clientHeight < 60;
  const toBottom = () => (list.scrollTop = list.scrollHeight);

  const answer = (id: string, reply: { value?: string; confirmed?: boolean; cancelled?: boolean }) => net.send({ t: 'chat.answer', workerId, askId: id.replace(/^ask-/, ''), ...reply });

  const render = (item: ChatItem): HTMLElement => {
    switch (item.k) {
      case 'user':
        return h('div.chat-item.chat-user', {}, item.text);
      case 'text': {
        // While it streams, plain text; once it's done, markdown.
        return h('div.chat-item.chat-text', {}, item.done && item.text.trim() ? markdown(item.text) : h('div.chat-plain', {}, item.text));
      }
      case 'thinking':
        return h('details.chat-item.chat-thinking', {}, h('summary', {}, item.done ? '💭 Thought' : '💭 Thinking…'), h('div.chat-plain', {}, item.text));
      case 'tool': {
        const icon = !item.done ? '⏳' : item.error ? '✗' : '✓';
        const out = item.output.trim();
        return h(
          'details.chat-item.chat-tool',
          { class: item.error ? 'bad' : '' },
          h('summary', {}, h('span.chat-tool-icon', {}, icon), h('b', {}, item.name), ' ', h('code', {}, item.args)),
          out ? h('pre', {}, out) : h('p.chat-none', {}, item.done ? 'No output' : 'Running…'),
        );
      }
      case 'note':
        return h(`div.chat-item.chat-note.${item.level}`, {}, item.text);
      case 'ask':
        return renderAsk(item);
    }
  };

  const renderAsk = (item: Extract<ChatItem, { k: 'ask' }>): HTMLElement => {
    const head = [h('b', {}, `❓ ${item.title}`), item.message ? h('p', {}, item.message) : null];
    if (item.done) return h('div.chat-item.chat-ask.done', {}, ...head, h('p.chat-answer', {}, `→ ${item.answer ?? ''}`));
    const dismiss = h('button.btn', { type: 'button', onclick: () => answer(item.id, { cancelled: true }) }, 'Dismiss');
    let controls: HTMLElement;
    if (item.method === 'confirm') {
      controls = h('div.chat-ask-btns', {}, h('button.btn.primary', { type: 'button', onclick: () => answer(item.id, { confirmed: true }) }, 'Yes'), h('button.btn', { type: 'button', onclick: () => answer(item.id, { confirmed: false }) }, 'No'));
    } else if (item.method === 'select') {
      controls = h('div.chat-ask-btns.pick', {}, ...(item.options ?? []).map((o) => h('button.btn', { type: 'button', onclick: () => answer(item.id, { value: o }) }, o)), dismiss);
    } else {
      const input = (item.method === 'editor' ? h('textarea', { rows: 5 }) : h('input', { type: 'text' })) as HTMLInputElement | HTMLTextAreaElement;
      input.value = item.prefill ?? '';
      const f = h('form.chat-ask-form', {}, input, h('div.chat-ask-btns', {}, h('button.btn.primary', { type: 'submit' }, 'Answer'), dismiss));
      f.addEventListener('submit', (e) => {
        e.preventDefault();
        answer(item.id, { value: input.value });
      });
      controls = f;
    }
    return h('div.chat-item.chat-ask', {}, ...head, controls);
  };

  /** Draws `item` in place (or at the end), keeping a tool card open if it was. */
  const draw = (item: ChatItem) => {
    const was = views.get(item.id);
    const next = render(item);
    if (was instanceof HTMLDetailsElement && next instanceof HTMLDetailsElement) next.open = was.open;
    if (was) was.replaceWith(next);
    else list.append(next);
    views.set(item.id, next);
  };

  const prune = () => {
    for (const [id, view] of views) {
      if (log.get(id)) continue;
      view.remove();
      views.delete(id);
    }
  };

  const paintFooter = () => {
    foot.replaceChildren(...[...footer.status, ...footer.widgets].map((line) => h('div', {}, line)));
    foot.classList.toggle('hidden', !footer.status.length && !footer.widgets.length);
  };

  const refresh = () => {
    const w = store.workers.get(workerId);
    if (!w) return;
    pill.textContent = STATUS_LABEL[w.status] ?? w.status;
    pill.className = `pill ${w.status}`;
    const busy = footer.busy || w.status === 'working';
    // While it works, a message steers it or waits for the end of its turn; otherwise it's a prompt.
    mode.classList.toggle('hidden', !busy);
    stopBtn.classList.toggle('hidden', !busy);
    sendBtn.textContent = isAsleep(w.status) ? 'Wake & send' : 'Send';
    modeBtn.classList.toggle('hidden', !w.chat);
  };

  const route = (msg: ServerMsg) => {
    if (msg.t === 'welcome') {
      // Back from a reconnect: the server has forgotten this browser had it open.
      net.send({ t: 'worker.attach', workerId });
      net.send({ t: 'chat.open', workerId });
      return;
    }
    if (!('workerId' in msg) || msg.workerId !== workerId) return;
    const stick = atBottom();
    if (msg.t === 'chat.snapshot') {
      log.reset(msg.items);
      list.replaceChildren();
      views.clear();
      for (const item of log.items) draw(item);
      footer = msg.footer;
      paintFooter();
      refresh();
      toBottom();
      return;
    }
    if (msg.t === 'chat.ops') {
      for (const op of msg.ops) {
        const item = log.apply(op);
        if (item) draw(item);
      }
      prune();
    } else if (msg.t === 'chat.footer') {
      footer = msg.footer;
      paintFooter();
      refresh();
    } else return;
    if (stick) toBottom();
  };

  const send = () => {
    const text = box.value.trim();
    if (!text) return;
    const w = store.workers.get(workerId);
    const busy = footer.busy || w?.status === 'working';
    net.send({ t: 'chat.send', workerId, text, mode: busy ? (mode.value as ChatSendMode) : 'prompt' });
    box.value = '';
    toBottom();
  };
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    send();
  });
  box.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      send();
    }
  });
  stopBtn.addEventListener('click', () => net.send({ t: 'chat.abort', workerId }));

  const unsub = store.on('workers', () => {
    if (!store.workers.has(workerId)) return modal.close();
    refresh();
    // Moved back to its terminal (by anyone): this window goes with it.
    if (!store.workers.get(workerId)?.chat) {
      modal.close();
      opts.onRaw();
    }
  });
  const modal = openModal(el, {
    backdropCloses: true,
    doing: `💬 in ${info.name}'s chat`,
    onClose: () => {
      unsub();
      net.send({ t: 'worker.detach', workerId });
      if (current?.modal === modal) current = null;
    },
  });
  current = { workerId, modal, route };
  closeBtn.addEventListener('click', () => modal.close());
  rawBtn.addEventListener('click', () => {
    modal.close();
    opts.onRaw();
  });
  modeBtn.addEventListener('click', () => {
    if (!confirm(`Run ${info.name} in its terminal again? It restarts and carries on the same conversation.`)) return;
    net.send({ t: 'chat.mode', workerId, chat: false });
  });
  changesBtn.addEventListener('click', () => {
    modal.close();
    opts.onChanges?.();
  });
  refresh();
  if (isAsleep(info.status)) toast(`${info.name} is asleep: a message wakes it up`);
  net.send({ t: 'worker.attach', workerId });
  net.send({ t: 'chat.open', workerId });
  setTimeout(() => box.focus(), 50);
}
