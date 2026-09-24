// Title screen: callsign, play mode, quality.
import { h } from './dom.js';
import { QUALITY, detectQuality } from '../render/Renderer.js';
import { GAME_NAME } from '../../shared/constants.js';

export class TitleScreen {
  constructor(root, opts) {
    this.opts = opts;
    this.el = h('div', { class: 'title' });
    root.appendChild(this.el);
    const saved = opts.settings;
    const name = h('input', { class: 'tt-name', maxlength: 18, placeholder: 'Callsign', value: saved.name || '' });
    const quality = h('select', { class: 'tt-q' }, ...Object.keys(QUALITY).map((q) => h('option', { value: q, selected: (saved.quality || detectQuality()) === q ? true : undefined }, `Graphics: ${q[0].toUpperCase()}${q.slice(1)}`)));
    const status = h('div', { class: 'tt-status' });
    const solo = h('button', { class: 'btn big', onclick: () => go('solo') }, 'PLAY — SOLO CAMPAIGN');
    const mp = h('button', { class: 'btn big sec', onclick: () => go('mp') }, 'JOIN MULTIPLAYER SERVER');
    mp.style.display = opts.multiplayer ? '' : 'none';
    const go = (mode) => {
      const n = name.value.trim();
      if (n.length < 2) {
        status.textContent = 'Enter a callsign (2-18 characters).';
        name.focus();
        return;
      }
      solo.disabled = true;
      mp.disabled = true;
      opts.onStart({ mode, name: n, quality: quality.value });
    };
    name.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') go(opts.multiplayer ? 'mp' : 'solo');
    });
    this.el.append(
      h('div', { class: 'tt-bg' }),
      h('div', { class: 'tt-box' },
        h('div', { class: 'tt-kicker' }, 'ENLIST · FIGHT · COMMAND'),
        h('h1', {}, GAME_NAME.toUpperCase()),
        h('p', { class: 'tt-sub' }, 'Join the Allied Coalition as a recruit. Take objectives, lead squads, earn your promotions — from Private to General — while the war for the eight territories rages around you.'),
        name,
        h('div', { class: 'tt-row' }, quality),
        solo, mp,
        status,
        h('div', { class: 'tt-foot' }, opts.touch ? 'Touch controls enabled · landscape recommended' : 'Mouse + keyboard · gamepad supported · all audio and art generated live'),
      ),
    );
    this.status = status;
    setTimeout(() => name.focus(), 50);
  }

  setStatus(t) {
    this.status.textContent = t;
  }

  hide() {
    this.el.classList.add('off');
    setTimeout(() => this.el.remove(), 600);
  }
}
