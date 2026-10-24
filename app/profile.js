/* Rodokmeňovec – profil osoby v bočnom paneli. */
(function () {
  'use strict';
  const RK = (globalThis.RK = globalThis.RK || {});
  const { h, clear } = RK.UI;
  const D = RK.Dates;
  const M = RK.Model;

  function fact(k, v) {
    return v ? h('div', { class: 'fact' }, h('div', { class: 'k' }, k), h('div', null, v)) : null;
  }

  function eventText(tree, node) {
    const parts = [];
    const d = M.getPath(node, 'DATE');
    if (d) parts.push(D.formatDate(d));
    const pl = M.getPath(node, 'PLAC');
    if (pl) parts.push(pl);
    return parts.join(', ');
  }

  function mini(p, meta, onclick) {
    const tree = RK.App.tree;
    return h('div', { class: 'mini', onclick: onclick || (() => RK.App.focus(p)) },
      RK.UI.avatar(p, 34),
      h('div', null, h('div', { class: 'nm' }, tree.displayName(p)), h('div', { class: 'meta' }, [meta, tree.lifeSpan(p)].filter(Boolean).join(' · '))));
  }

  function render() {
    const el = document.getElementById('profile');
    const tree = RK.App.tree;
    const p = tree.get(RK.App.focusId);
    clear(el);
    el.classList.toggle('empty', !p);
    if (!p) {
      el.appendChild(h('div', null, 'Vyber osobu v strome.'));
      return;
    }
    const n = tree.names(p);
    const home = tree.get(tree.homeId);
    const age = tree.age(p);
    const bn = tree.birthName(p);

    // --- Hlavička ---
    const subs = [];
    if (bn) subs.push('rod. ' + bn);
    if (n.former) subs.push('predtým ' + n.former);
    if (n.nick) subs.push('„' + n.nick + '“');
    const life = [tree.lifeSpan(p), age != null ? (tree.isDeceased(p) ? `zomrel${tree.sex(p) === 'F' ? 'a' : ''} vo veku ${age}` : `${age} r.`) : ''].filter(Boolean).join(' · ');
    let relBadge = null;
    if (home && home !== p) {
      const r = tree.relationship(home, p);
      if (r.term) relBadge = h('div', { class: 'rel', title: `Vzťah k osobe ${tree.displayName(home)}` }, r.term);
    } else if (home === p) relBadge = h('div', { class: 'rel' }, 'domovská osoba');

    const addMenu = h('div', { class: 'dropdown menu hidden', style: { width: '200px' } },
      [['father', 'Otca'], ['mother', 'Matku'], ['partner', 'Partnera / manžela(ku)'], ['child', 'Dieťa'],['brother', 'Brata'], ['sister', 'Sestru']]
        .map(([k, l]) => h('button', { onclick: () => { addMenu.classList.add('hidden'); RK.Editors.addRelative(p, k); } }, l)));
    const moreMenu = h('div', { class: 'dropdown menu hidden', style: { width: '230px' } },
      h('button', { onclick: () => { moreMenu.classList.add('hidden'); RK.Editors.addPhotos(p); } }, 'Pridať fotky'),
      h('button', { onclick: () => { moreMenu.classList.add('hidden'); RK.App.setHome(p); } }, 'Nastaviť ako domovskú osobu'),
      h('button', { onclick: () => { moreMenu.classList.add('hidden'); RK.Views.showRelation(home, p); } }, 'Zobraziť príbuzenstvo'),
      h('button', { class: 'danger', onclick: () => { moreMenu.classList.add('hidden'); RK.Editors.deletePerson(p); } }, 'Vymazať osobu'));
    const toggle = (m) => (e) => {
      e.stopPropagation();
      document.querySelectorAll('.profile .dropdown').forEach((d) => d !== m && d.classList.add('hidden'));
      m.classList.toggle('hidden');
    };

    el.appendChild(h('div', { class: 'prof-mobilebar' },
      h('button', { onclick: close }, '← Späť na strom'),
      h('span', { class: 'muted small' }, tree.displayName(p))));
    el.appendChild(h('div', { class: 'prof-head' },
      RK.UI.avatar(p, 96),
      h('h2', null, tree.fullName(p)),
      subs.length ? h('div', { class: 'sub' }, subs.join(' · ')) : null,
      life ? h('div', { class: 'sub' }, life) : null,
      relBadge,
      h('div', { class: 'prof-actions' },
        h('button', { class: 'primary', onclick: () => RK.Editors.editPerson(p) }, '✎ Upraviť'),
        h('div', { class: 'menu-wrap' }, h('button', { onclick: toggle(addMenu) }, '+ Pridať'), addMenu),
        h('button', { title: 'Pridať fotku (v mobile aj odfotiť)', onclick: () => RK.Editors.addPhotos(p) }, '📷'),
        h('div', { class: 'menu-wrap' }, h('button', { onclick: toggle(moreMenu) }, '⋯'), moreMenu))));

    // --- Fakty ---
    const facts = [];
    facts.push(fact('Narodenie', eventText(tree, M.kid(p, 'BIRT'))));
    const deat = M.kid(p, 'DEAT');
    if (deat) {
      const t = eventText(tree, deat);
      const cause = M.getPath(deat, 'CAUS');
      const war = M.getPath(deat, 'TYPE') === 'WAR' ? 'padol vo vojne' : '';
      facts.push(fact('Úmrtie', [t || 'áno', cause, war].filter(Boolean).join(' – ')));
    }
    for (const f of tree.facts(p)) {
      const email = M.getPath(f, 'EMAIL');
      const where = eventText(tree, f);
      let label = f.tag === 'EVEN' || f.tag === 'FACT' ? M.getPath(f, 'TYPE') || M.FACTS[f.tag] : M.FACTS[f.tag];
      if (f.tag === 'RESI' && email && !where && !f.value) label = 'E-mail';
      const desc = f.tag === 'EVEN' || f.tag === 'FACT' || M.VALUE_FACTS.has(f.tag) ? '' : M.getPath(f, 'TYPE');
      const val = [f.value !== 'Y' ? f.value : '', desc, where, email].filter(Boolean).join(', ');
      facts.push(fact(label, val || (f.value === 'Y' ? 'áno' : '')));
    }
    if (n.religious) facts.push(fact('Iné meno', n.religious));
    const factEls = facts.filter(Boolean);
    if (factEls.length) el.appendChild(h('div', { class: 'prof-sec' }, h('h3', null, 'Údaje'), factEls));

    // --- Rodina ---
    const fam = h('div', { class: 'prof-sec' }, h('h3', null, 'Rodina'));
    const pfs = tree.famc(p);
    if (pfs.length) {
      for (const f of pfs) {
        const ped = tree.pedigree(p, f);
        const block = h('div', { class: 'fam-block' },
          h('div', { class: 'fam-head' }, h('span', null, 'Rodičia' + (ped ? ` (${M.PEDI[ped] || ped})` : '')),
            h('button', { class: 'link', onclick: () => RK.Editors.editFamily(f) }, 'upraviť')));
        for (const par of [tree.husband(f), tree.wife(f)]) if (par) block.appendChild(mini(par, tree.sex(par) === 'F' ? 'matka' : 'otec'));
        fam.appendChild(block);
      }
    } else {
      fam.appendChild(h('div', { class: 'fam-block muted small' }, 'Rodičia nie sú zadaní. ',
        h('button', { class: 'link', onclick: () => RK.Editors.addRelative(p, 'father') }, 'pridať otca'), ' · ',
        h('button', { class: 'link', onclick: () => RK.Editors.addRelative(p, 'mother') }, 'pridať matku')));
    }
    const sib = tree.siblings(p);
    if (sib.full.length || sib.half.length) {
      const block = h('div', { class: 'fam-block' }, h('div', { class: 'fam-head' }, 'Súrodenci'));
      sib.full.forEach((s) => block.appendChild(mini(s, tree.sex(s) === 'F' ? 'sestra' : 'brat')));
      sib.half.forEach((s) => block.appendChild(mini(s, tree.sex(s) === 'F' ? 'nevlastná sestra' : 'nevlastný brat')));
      fam.appendChild(block);
    }
    for (const { family, partner } of tree.spouses(p)) {
      const marr = M.kid(family, 'MARR');
      const div = M.kid(family, 'DIV');
      const info = [
        partner ? tree.partnerTerm(family, partner) : RK.Model.STATUS[tree.familyStatus(family)],
        marr && eventText(tree, marr) ? 'sobáš ' + eventText(tree, marr) : '',
        div && eventText(tree, div) ? 'rozvod ' + eventText(tree, div) : '',
      ].filter(Boolean).join(' · ');
      const block = h('div', { class: 'fam-block' },
        h('div', { class: 'fam-head' }, h('span', null, info), h('button', { class: 'link', onclick: () => RK.Editors.editFamily(family) }, 'upraviť')));
      if (partner) block.appendChild(mini(partner, ''));
      else block.appendChild(h('div', { class: 'muted small', style: { padding: '4px 6px' } }, 'partner neznámy'));
      const ch = tree.childrenOfFamily(family);
      if (ch.length) {
        const kidsEl = h('div', { class: 'kids' });
        ch.forEach((c) => {
          const ped = tree.pedigree(c, family);
          kidsEl.appendChild(mini(c, (tree.sex(c) === 'F' ? 'dcéra' : tree.sex(c) === 'M' ? 'syn' : 'dieťa') + (ped ? ` (${M.PEDI[ped] || ped})` : '')));
        });
        block.appendChild(kidsEl);
      }
      fam.appendChild(block);
    }
    el.appendChild(fam);

    // --- Fotky ---
    const links = tree.photoLinks(p);
    const ph = h('div', { class: 'prof-sec' }, h('h3', null, `Fotky (${links.length})`, h('button', { class: 'link', onclick: () => RK.Editors.addPhotos(p) }, '+ pridať')));
    if (links.length) {
      const grid = h('div', { class: 'thumbs' });
      for (const l of links) {
        const th = h('div', { class: 'th', title: tree.mediaTitle(l.media), onclick: () => RK.Editors.photoDialog(l.media) });
        RK.UI.cropUrl(l.media, null, 90).then((u) => u && (th.style.backgroundImage = `url("${u}")`));
        grid.appendChild(th);
      }
      ph.appendChild(grid);
    }
    el.appendChild(ph);

    // --- Poznámky ---
    const notes = tree.notes(p);
    const ns = h('div', { class: 'prof-sec' }, h('h3', null, 'Poznámky', h('button', { class: 'link', onclick: () => RK.Editors.editPerson(p, 'notes') }, notes.length ? 'upraviť' : '+ pridať')));
    for (const x of notes) ns.appendChild(h('div', { class: 'note' }, linkify(x.text)));
    el.appendChild(ns);

    el.appendChild(h('div', { class: 'prof-sec muted small' }, `ID ${p.xref.replace(/@/g, '')}` + (M.getPath(p, '_UPD') ? ` · upravené ${M.getPath(p, '_UPD').replace(/ GMT.*/, '')}` : '')));
  }

  function linkify(text) {
    const parts = String(text).split(/(https?:\/\/\S+)/g);
    return parts.map((s, i) => (i % 2 ? h('a', { href: s, target: '_blank', rel: 'noopener' }, s) : s));
  }

  document.addEventListener('click', () => document.querySelectorAll('.profile .dropdown').forEach((d) => d.classList.add('hidden')));

  // V mobile je profil celoobrazovkový panel, ktorý sa otvára a zatvára.
  const mq = window.matchMedia('(max-width: 700px)');
  const isMobile = () => mq.matches;
  function open() {
    const el = document.getElementById('profile');
    el.classList.add('open');
    el.scrollTop = 0;
  }
  function close() {
    document.getElementById('profile').classList.remove('open');
  }
  document.getElementById('fab-profile').addEventListener('click', open);

  RK.Profile = { render, open, close, isMobile };
})();
