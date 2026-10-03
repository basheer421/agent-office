import './projects.css';
import type { GitLabRepoChoice, ProjectRootsState } from '../../shared/protocol';
import type { Net } from '../net';
import { store } from '../state';
import { h, openModal, timeAgo } from './dom';
import { listen } from './projects';

// ⬇️ Clone from GitLab: the projects the office's glab sign-in belongs to on the first GitLab host in
// ⚙️, cloned into the workspace folder and opened as a floor. And ⚙️'s "Clone from" setting: whether
// the elevator's clone list is GitHub's (gh) or GitLab's (glab).

/** The last ⚙️ projects state the office sent, so the elevator knows where to clone from. */
let roots: ProjectRootsState | undefined;
const watchers = new Set<() => void>();
listen((msg) => {
  if (msg.t !== 'project.roots') return;
  roots = msg.state;
  for (const fn of watchers) fn();
});
export const gitlabDefault = () => roots?.defaultHost === 'gitlab';
/** Hears every change to where clones come from; returns how to stop. */
export function onRoots(fn: () => void): () => void {
  watchers.add(fn);
  return () => watchers.delete(fn);
}

export function openGitlabClone(net: Net, ride: (floorId: string) => void): void {
  let repos: GitLabRepoChoice[] = [];
  let picked: string | undefined;
  let busy = false;
  const input = h('input', { type: 'text', placeholder: 'Search your GitLab projects, or type group/name', 'aria-label': 'GitLab project', autocomplete: 'off', spellcheck: 'false' }) as HTMLInputElement;
  const list = h('div.dir-list', { role: 'listbox', 'aria-label': 'GitLab projects' });
  const status = h('p.note', {}, 'Asking GitLab…');
  const cloneBtn = h('button.btn.primary', { type: 'button', disabled: true }, '⬇️ Clone');
  const refresh = h('button.btn', { type: 'button', title: 'Ask GitLab for the list again' }, '↻');
  const el = h(
    'div.modal.folders',
    { role: 'dialog', 'aria-label': 'Clone from GitLab' },
    h('header', {}, h('h2', {}, '🦊 Clone from GitLab')),
    h('div.body', {}, h('p.intro', {}, 'Projects the office’s glab sign-in is a member of. The office clones one into the workspace folder and it becomes a floor.'), h('div.crumbs', {}, input, refresh), list, status),
    h('footer', {}, h('span.grow', {}, 'Esc to close'), cloneBtn),
  );
  const want = () => picked ?? (/^[\w.-]+(\/[\w.-]+)+$/.test(input.value.trim()) ? input.value.trim() : undefined);
  const paint = () => {
    const q = input.value.trim().toLowerCase();
    list.replaceChildren(
      ...repos
        .filter((r) => !q || r.path.toLowerCase().includes(q) || (r.description ?? '').toLowerCase().includes(q))
        .slice(0, 100)
        .map((r) => {
          const b = h('button.btn.dir-row', { type: 'button', 'aria-selected': String(r.path === picked), class: r.path === picked ? 'on' : '' }, h('span', {}, '🦊'), h('span.grow', {}, r.path), r.floor ? h('span.badge.floor', {}, `floor: ${r.floor}`) : null, r.activityAt ? h('span.badge', {}, timeAgo(Date.parse(r.activityAt))) : null);
          b.addEventListener('click', () => ((picked = r.path), (input.value = r.path), paint()));
          return b;
        }),
    );
    const p = want();
    cloneBtn.disabled = busy || !p;
    if (busy) cloneBtn.textContent = '⏳ Cloning…';
    else cloneBtn.textContent = p ? `⬇️ Clone ${p}` : '⬇️ Clone';
  };
  const off = listen((msg) => {
    if (msg.t === 'project.gitlabRepos') {
      repos = msg.repos;
      status.textContent = msg.error ?? (repos.length ? `${repos.length} projects on ${msg.host}` : `No projects on ${msg.host}`);
      paint();
    } else if (msg.t === 'project.opened' && busy) {
      busy = false;
      if (msg.error) status.textContent = msg.error;
      else if (msg.floor) return modal.close(), ride(msg.floor);
      paint();
    }
  });
  input.addEventListener('input', () => {
    if (picked !== input.value.trim()) picked = undefined;
    paint();
  });
  refresh.addEventListener('click', () => ((status.textContent = 'Asking GitLab…'), net.send({ t: 'project.gitlabRepos', refresh: true })));
  cloneBtn.addEventListener('click', () => {
    const p = want();
    if (!p) return;
    busy = true;
    status.textContent = `Cloning ${p}…`;
    paint();
    net.send({ t: 'project.clone', path: p });
  });
  const modal = openModal(el, { doing: '🦊 cloning from GitLab', onClose: () => off() });
  net.send({ t: 'project.gitlabRepos' });
  setTimeout(() => input.focus(), 30);
}

/** ⚙️ Building → "Clone from": GitHub or GitLab, for everyone; admins change it. */
export function cloneFromSetting(net: Net, frame: (body: Node[]) => HTMLElement): { section: HTMLElement; off: () => void } {
  const row = h('div.seg', { role: 'radiogroup', 'aria-label': 'Clone from' });
  const note = h('p.setting-note');
  const paint = () => {
    const gl = gitlabDefault();
    const host = roots?.gitlabHosts[0] ?? 'GitLab';
    row.replaceChildren(
      ...(['github', 'gitlab'] as const).map((k) =>
        h(
          'button.btn',
          { type: 'button', role: 'radio', disabled: !store.me.admin, 'aria-checked': String(gl === (k === 'gitlab')), class: gl === (k === 'gitlab') ? 'on' : '', onclick: () => net.send({ t: 'project.roots', state: { defaultHost: k } }) },
          k === 'github' ? '🐙 GitHub (gh)' : `🦊 ${host} (glab)`,
        ),
      ),
    );
    note.textContent = `What the elevator’s ⬇️ Clone lists: your GitHub repositories, or the GitLab projects the office’s glab sign-in belongs to on ${host}. 📂 Open folder works with either.` + (store.me.admin ? '' : ' Admins can change it.');
  };
  paint();
  net.send({ t: 'project.roots' });
  return { section: frame([row, note]), off: onRoots(paint) };
}
