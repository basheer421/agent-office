import './projects.css';
import type { FolderEntry, ProjectConfig, ServerMsg } from '../../shared/protocol';
import type { Net } from '../net';
import { store } from '../state';
import { h, openModal } from './dom';

// 📂 Open folder: browse the office machine's folders (inside the allowed roots) and open one as a
// floor. And ⚙️ Project settings: what's detected about a floor's checkout, and overrides for it.

const listeners = new Set<(msg: ServerMsg) => void>();
/** Main feeds server messages through here, so an open window hears its answers. */
export function routeProjectMessage(msg: ServerMsg) {
  if (msg.t.startsWith('project.')) for (const fn of listeners) fn(msg);
}

export function listen(fn: (msg: ServerMsg) => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function openFolderBrowser(net: Net, ride: (floorId: string) => void): void {
  let at = '';
  let busy = false;
  const crumbs = h('div.crumbs');
  const list = h('div.dir-list', { role: 'listbox', 'aria-label': 'Folders' });
  const status = h('p.note');
  const openBtn = h('button.btn.primary', { type: 'button', disabled: true }, '📂 Open this folder');
  const el = h(
    'div.modal.folders',
    { role: 'dialog', 'aria-label': 'Open folder' },
    h('header', {}, h('h2', {}, '📂 Open folder')),
    h('div.body', {}, h('p.intro', {}, 'A folder on the office’s machine becomes a floor, where it is.'), crumbs, list, status),
    h('footer', {}, h('span.grow', {}, 'Esc to close'), openBtn),
  );
  const go = (path?: string) => {
    status.textContent = 'Looking…';
    net.send({ t: 'project.browse', path });
  };
  const row = (e: FolderEntry) => {
    const b = h('button.btn.dir-row', { type: 'button' }, h('span', {}, e.git ? '📦' : '📁'), h('span.grow', {}, e.name), e.git ? h('span.badge', {}, 'git') : null, e.floor ? h('span.badge.floor', {}, `floor: ${e.floor}`) : null);
    b.addEventListener('click', () => go(`${at}/${e.name}`));
    return b;
  };
  const off = listen((msg) => {
    if (msg.t === 'project.listing') {
      at = msg.path;
      status.textContent = msg.error ?? (msg.entries.length ? '' : 'No folders in here.');
      const parts = msg.path.split('/');
      crumbs.replaceChildren(
        ...msg.roots.map((r) => {
          const b = h('button.btn', { type: 'button', title: 'An allowed root' }, `⌂ ${r}`);
          b.addEventListener('click', () => go(r));
          return b;
        }),
        ...(msg.parent ? [h('button.btn', { type: 'button', onclick: () => go(msg.parent) }, '⬆')] : []),
        h('span', {}, parts.join(' / ')),
      );
      list.replaceChildren(...msg.entries.map(row));
      openBtn.disabled = !!msg.error;
      openBtn.textContent = msg.git ? '📂 Open this checkout' : '📂 Open this folder';
    } else if (msg.t === 'project.opened' && busy) {
      busy = false;
      if (msg.error) {
        status.textContent = msg.error;
        openBtn.disabled = false;
      } else if (msg.floor) {
        modal.close();
        ride(msg.floor);
      }
    }
  });
  openBtn.addEventListener('click', () => {
    busy = true;
    openBtn.disabled = true;
    status.textContent = 'Opening…';
    net.send({ t: 'project.open', dir: at });
  });
  const modal = openModal(el, { doing: '📂 opening a folder', onClose: () => off() });
  go();
}

export function openProjectSettings(net: Net, floorId: string): void {
  const floor = store.floors.find((f) => f.id === floorId);
  const admin = store.me.admin;
  const facts = h('dl');
  const remote = h('input', { type: 'text', 'aria-label': 'Push remote', spellcheck: 'false', disabled: !admin }) as HTMLInputElement;
  const base = h('input', { type: 'text', 'aria-label': 'Base branch', spellcheck: 'false', disabled: !admin }) as HTMLInputElement;
  const status = h('p.note');
  const save = h('button.btn.primary', { type: 'button', disabled: !admin, title: admin ? '' : 'Only admins can change project settings' }, 'Save');
  const el = h(
    'div.modal.project-settings',
    { role: 'dialog', 'aria-label': 'Project settings' },
    h('header', {}, h('h2', {}, `⚙️ ${floor?.name ?? floorId}: project settings`)),
    h(
      'div.body',
      {},
      h('p.intro', {}, 'Detected from the checkout. Fill a field only to override a wrong guess; leave it empty to keep detecting it.'),
      facts,
      h('label', {}, 'Push remote', remote),
      h('label', {}, 'Base branch', base),
      status,
    ),
    h('footer', {}, h('span.grow', {}, 'Esc to close'), save),
  );
  const show = (c: ProjectConfig) => {
    const d = c.detected;
    const fact = (k: string, v: string | undefined) => [h('dt', {}, k), h('dd', {}, v || '—')];
    facts.replaceChildren(
      ...fact('Git checkout', d.isGit ? 'yes' : 'no'),
      ...fact('Remotes', d.remotes.join(', ')),
      ...fact('Code host', `${c.host}${c.hostname ? ` (${c.hostname})` : ''}`),
      ...fact('Project path', c.projectPath),
      ...fact('Detected push remote', d.pushRemote),
      ...fact('Detected base branch', d.baseBranch),
    );
    remote.placeholder = d.pushRemote ?? 'origin';
    base.placeholder = d.baseBranch ?? 'the branch the checkout is on';
    remote.value = c.overridden.includes('pushRemote') ? (c.pushRemote ?? '') : '';
    base.value = c.overridden.includes('baseBranch') ? (c.baseBranch ?? '') : '';
  };
  const off = listen((msg) => {
    if (msg.t !== 'project.config' || msg.floor !== floorId) return;
    status.classList.toggle('error', !!msg.error);
    status.textContent = msg.error ?? '';
    if (msg.config) show(msg.config);
  });
  save.addEventListener('click', () => {
    status.textContent = 'Saving…';
    net.send({ t: 'project.configure', floor: floorId, overrides: { pushRemote: remote.value.trim() || undefined, baseBranch: base.value.trim() || undefined } });
  });
  openModal(el, { doing: '⚙️ in project settings', onClose: () => off() });
  net.send({ t: 'project.config', floor: floorId });
}
