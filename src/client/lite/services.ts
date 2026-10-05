// The services board on the 2D view: the dev servers the floor's workers started, in the same
// window as the 3D office's board, behind a button that counts them.

import { store } from '../state';
import { $ } from '../ui/dom';
import { openServices } from '../ui/services';

export function wireServices(id = 'btn-services') {
  const btn = $(id);
  btn.addEventListener('click', () => openServices());
  const render = () => {
    btn.querySelector('.n')!.textContent = store.services.items.length ? String(store.services.items.length) : '';
  };
  store.on('services', render);
  render();
}
