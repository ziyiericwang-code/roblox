// Enlistment: choose the country you will serve. Shown once, on a new career.
import { h } from './dom.js';
import { FACTION_INFO, COUNTRY_IDS } from '../../shared/constants.js';

const FEATURES = {
  1: ['Capital: Aldhaven', 'HQ: Fort Aldric', 'Forests, highlands, the port of Wexley'],
  2: ['Capital: Kharan', 'HQ: Kharan Citadel', 'Mountains, canyons, the Ashar desert'],
  3: ['Capital: Seralis', 'HQ: Fort Valor', 'Lake Mera, farmland, the southern islands'],
};

export class CountrySelect {
  constructor(root, app, onPick) {
    this.app = app;
    const war = app.store.get('war');
    const wars = war ? war.wars : [];
    const cards = COUNTRY_IDS.map((f) => {
      const info = FACTION_INFO[f];
      const foes = wars.filter((w) => w[0] === f || w[1] === f).map((w) => FACTION_INFO[w[0] === f ? w[1] : w[0]].short);
      const held = war ? war.territories.filter((t) => t.owner === f && !t.id.startsWith('hq_')).length : 0;
      const btn = h('button', { class: 'btn', onclick: () => {
        for (const b of this.el.querySelectorAll('button')) b.disabled = true;
        btn.textContent = 'Enlisting…';
        onPick(f);
      } }, `ENLIST IN THE ${info.army.toUpperCase()}`);
      return h('div', { class: 'cs-card', style: { '--c': info.color, '--d': info.dark } },
        h('div', { class: 'cs-flag' }),
        h('div', { class: 'cs-name' }, info.name),
        h('div', { class: 'cs-motto' }, `“${info.motto}”`),
        h('p', {}, info.blurb),
        h('ul', {}, ...FEATURES[f].map((x) => h('li', {}, x))),
        h('div', { class: 'cs-war' }, foes.length ? `AT WAR WITH ${foes.join(' & ').toUpperCase()}` : 'AT PEACE — FOR NOW', held ? ` · ${held} territories` : ''),
        btn);
    });
    this.el = h('div', { class: 'country-select' },
      h('div', { class: 'cs-box' },
        h('div', { class: 'cs-kicker' }, 'ENLISTMENT'),
        h('h2', {}, 'Choose the country you will serve'),
        h('p', { class: 'dimmed' }, 'You start as a Recruit at your army headquarters. Your rank and career stay with you; a transfer to another army is possible later, but not often.'),
        h('div', { class: 'cs-cards' }, ...cards)));
    root.appendChild(this.el);
  }

  close() {
    this.el.classList.add('off');
    setTimeout(() => this.el.remove(), 400);
  }
}
