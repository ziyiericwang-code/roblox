// Conversation with an NPC: who they are, what they say, a few choices.
import { h, clear } from './dom.js';
import { insigniaSVG } from './insignia.js';
import { MSG } from '../../shared/protocol.js';

export class Dialog {
  constructor(root, app) {
    this.app = app;
    this.el = h('div', { class: 'dialog' });
    root.appendChild(this.el);
    this.npc = 0;
    this.hideAt = 0;
  }

  show(msg) {
    const app = this.app;
    if (msg.close) {
      this.hideAt = performance.now() + 1800;
      const t = this.el.querySelector('.dg-text');
      if (t) t.textContent = msg.text;
      clear(this.el.querySelector('.dg-opts') || h('div'));
      return;
    }
    this.npc = msg.npc;
    this.hideAt = 0;
    clear(this.el);
    const opts = h('div', { class: 'dg-opts' });
    (msg.options || []).forEach((o, i) => {
      opts.appendChild(h('button', { class: `btn tiny${o.id === 'bye' ? ' sec' : ''}`, onclick: () => this.choose(o.id) }, `${i + 1}. ${o.label}`));
    });
    this.el.append(
      h('div', { class: 'dg-head' },
        h('span', { class: 'dg-ins', html: insigniaSVG(msg.rank, 30) }),
        h('div', {}, h('div', { class: 'dg-name' }, msg.name), msg.title ? h('div', { class: 'dg-title' }, msg.title) : null)),
      h('div', { class: 'dg-text' }, msg.text),
      opts);
    this.options = msg.options || [];
    this.el.classList.add('on');
    app.audio.radio(0);
  }

  choose(id) {
    if (!this.npc) return;
    if (id === 'bye') {
      this.app.send({ t: MSG.TALK, id: this.npc, opt: 'bye' });
      this.close();
      return;
    }
    this.app.send({ t: MSG.TALK, id: this.npc, opt: id });
  }

  close() {
    this.el.classList.remove('on');
    this.npc = 0;
  }

  // Number keys pick options; walking away closes the conversation.
  update() {
    const app = this.app;
    if (!this.el.classList.contains('on')) return;
    if (this.hideAt && performance.now() > this.hideAt) {
      this.close();
      return;
    }
    const e = app.cw.ents.get(this.npc);
    const me = app.player;
    if (!e || !e.latest || Math.hypot(e.latest.x - me.s.x, e.latest.z - me.s.z) > 7) {
      this.close();
      return;
    }
    const keys = ['slot1', 'slot2', 'slot3', 'slot4', 'slot5'];
    keys.forEach((k, i) => {
      if (app.input.pressed(k) && this.options[i]) this.choose(this.options[i].id);
    });
  }

  get open() {
    return this.el.classList.contains('on') && !this.hideAt;
  }
}
