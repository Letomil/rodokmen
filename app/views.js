/* Rodokmeňovec – zobrazenia: zoznam ľudí, fotky, štatistiky, príbuzenstvo. */
(function () {
  'use strict';
  const RK = (globalThis.RK = globalThis.RK || {});
  const { h, clear, personPicker } = RK.UI;
  const D = RK.Dates;
  const M = RK.Model;
  const T = () => RK.App.tree;

  // ---------- Ľudia ----------
  const peopleState = { q: '', filter: 'all', sort: 'name', dir: 1 };

  function renderPeople() {
    const el = clear(document.getElementById('view-people'));
    const tree = T();
    const home = tree.get(tree.homeId);
    const page = h('div', { class: 'page' });
    const q = h('input', { type: 'search', placeholder: 'Filtrovať podľa mena, priezviska, miesta…', value: peopleState.q });
    const filter = h('select', { style: { width: 'auto' } },
      [['all', 'Všetci'], ['alive', 'Žijúci'], ['dead', 'Zosnulí'], ['M', 'Muži'], ['F', 'Ženy']].map(([v, l]) => h('option', { value: v, selected: v === peopleState.filter }, l)));
    const count = h('span', { class: 'muted small' });
    const tbody = h('tbody');

    const rel = new Map();
    const relOf = (p) => {
      if (!home) return '';
      if (!rel.has(p)) rel.set(p, p === home ? 'ja' : tree.relationship(home, p).term);
      return rel.get(p);
    };
    const cols = [
      ['name', 'Meno', (p) => tree.displayName(p), (p) => {
        const n = tree.names(p);
        const k = (s) => (!s || /^\?+$/.test(s) ? '￿' : RK.fold(s));
        return k(n.married || n.surname) + ' ' + k(n.given); // priezvisko, potom meno; neznáme na koniec
      }],
      ['birthName', 'Rodné priezvisko', (p) => tree.birthName(p)],
      ['birth', 'Narodenie', (p) => D.formatDate(tree.eventDate(p, 'BIRT'), 'short'), (p) => D.sortKey(tree.eventDate(p, 'BIRT')) || 0],
      ['bplace', 'Miesto narodenia', (p) => tree.eventPlace(p, 'BIRT')],
      ['death', 'Úmrtie', (p) => (tree.isDeceased(p) ? D.formatDate(tree.eventDate(p, 'DEAT'), 'short') || '†' : ''), (p) => D.sortKey(tree.eventDate(p, 'DEAT')) || 0],
      ['age', 'Vek', (p) => (tree.age(p) != null ? String(tree.age(p)) : ''), (p) => tree.age(p) ?? -1],
      ['rel', home ? `Vzťah k: ${tree.displayName(home)}` : 'Vzťah', relOf],
    ];

    const draw = () => {
      clear(tbody);
      const terms = RK.fold(peopleState.q).split(/\s+/).filter(Boolean);
      let list = tree.people.filter((p) => {
        if (peopleState.filter === 'alive' && tree.isDeceased(p)) return false;
        if (peopleState.filter === 'dead' && !tree.isDeceased(p)) return false;
        if ((peopleState.filter === 'M' || peopleState.filter === 'F') && tree.sex(p) !== peopleState.filter) return false;
        if (!terms.length) return true;
        const n = tree.names(p);
        const hay = RK.fold([n.given, n.surname, n.married, n.nick, tree.eventPlace(p, 'BIRT'), tree.eventPlace(p, 'DEAT')].join(' '));
        return terms.every((t) => hay.includes(t));
      });
      const col = cols.find((c) => c[0] === peopleState.sort);
      const key = col[3] || col[2];
      list.sort((a, b) => {
        const x = key(a), y = key(b);
        return (typeof x === 'number' ? x - y : String(x).localeCompare(String(y), 'sk')) * peopleState.dir;
      });
      count.textContent = `${list.length} z ${tree.people.length}`;
      for (const p of list) {
        tbody.appendChild(h('tr', { onclick: () => { RK.App.focus(p); RK.App.show('tree'); } },
          cols.map((c, i) => h('td', null, i === 0 ? RK.UI.personRow(p, 28) : c[2](p)))));
      }
    };

    const thead = h('thead', null, h('tr', null, cols.map(([k, label]) => h('th', {
      onclick: () => {
        if (peopleState.sort === k) peopleState.dir *= -1;
        else { peopleState.sort = k; peopleState.dir = 1; }
        renderPeople();
      },
    }, label + (peopleState.sort === k ? (peopleState.dir > 0 ? ' ▲' : ' ▼') : '')))));

    q.addEventListener('input', () => { peopleState.q = q.value; draw(); });
    filter.addEventListener('change', () => { peopleState.filter = filter.value; draw(); });
    page.append(
      h('h2', null, 'Ľudia v rodokmeni'),
      h('div', { class: 'toolbar' }, q, filter, count,
        h('button', { style: { marginLeft: 'auto' }, onclick: newPerson }, '+ Nová osoba bez väzby')),
      h('table', { class: 'list' }, thead, tbody));
    el.appendChild(page);
    draw();
  }

  function newPerson() {
    const tree = T();
    let p;
    RK.App.change('Nová osoba', () => { p = tree.createPerson({ given: '', surname: '', sex: 'U' }); }).then(() => {
      RK.App.focus(p);
      RK.Editors.editPerson(p);
    });
  }

  // ---------- Fotky ----------
  let photoQ = '';
  function renderPhotos() {
    const el = clear(document.getElementById('view-photos'));
    const tree = T();
    const page = h('div', { class: 'page' });
    const q = h('input', { type: 'search', placeholder: 'Filtrovať podľa názvu alebo osoby…', value: photoQ });
    const grid = h('div', { class: 'gallery' });
    const count = h('span', { class: 'muted small' });
    const draw = () => {
      clear(grid);
      const terms = RK.fold(photoQ).split(/\s+/).filter(Boolean);
      const items = tree.media.map((m) => ({ m, people: tree.peopleInMedia(m) })).filter(({ m, people }) => {
        const hay = RK.fold(tree.mediaTitle(m) + ' ' + people.map((x) => tree.displayName(x.person)).join(' '));
        return terms.every((t) => hay.includes(t));
      });
      count.textContent = `${items.length} fotiek`;
      for (const { m, people } of items) {
        const img = h('div', { class: 'img' });
        RK.UI.cropUrl(m, null, 160).then((u) => u && (img.style.backgroundImage = `url("${u}")`));
        grid.appendChild(h('div', { class: 'ph', onclick: () => RK.Editors.photoDialog(m) }, img,
          h('div', { class: 'cap' }, tree.mediaTitle(m) || '(bez názvu)',
            h('div', { class: 'muted' }, people.length ? people.map((x) => tree.displayName(x.person)).join(', ') : 'nikto neoznačený'))));
      }
    };
    q.addEventListener('input', () => { photoQ = q.value; draw(); });
    page.append(h('h2', null, 'Fotky'),
      h('div', { class: 'toolbar' }, q, count,
        h('button', { class: 'primary', style: { marginLeft: 'auto' }, onclick: async () => { await RK.Editors.uploadPhotos(await RK.Editors.pickFiles(), null); renderPhotos(); } }, '+ Nahrať fotky')),
      grid);
    el.appendChild(page);
    draw();
  }

  // ---------- Štatistiky ----------
  function bars(entries, max) {
    const top = Math.max(1, ...entries.map((e) => e[1]));
    return entries.slice(0, max || 10).map(([k, v]) => h('div', { class: 'bar-row' },
      h('div', { title: k, style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, k),
      h('div', null, h('div', { class: 'bar', style: { width: (v / top) * 100 + '%' } })),
      h('div', { class: 'n' }, v)));
  }

  function countBy(list, fn) {
    const m = new Map();
    for (const x of list) {
      const k = fn(x);
      if (k && !/^\?+$/.test(k)) m.set(k, (m.get(k) || 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'sk'));
  }

  /** Najbližšie výročie (dni do neho) pre GEDCOM dátum s dňom a mesiacom. */
  function daysUntil(ged) {
    const p = D.parseDate(ged);
    if (!p || p.type !== 'exact' || !p.d1.d || !p.d1.m) return null;
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    let next = new Date(now.getFullYear(), p.d1.m - 1, p.d1.d);
    if (next < today) next = new Date(now.getFullYear() + 1, p.d1.m - 1, p.d1.d);
    return { days: Math.round((next - today) / 864e5), years: next.getFullYear() - p.d1.y, d: p.d1 };
  }

  function renderStats() {
    const el = clear(document.getElementById('view-stats'));
    const tree = T();
    const ppl = tree.people;
    const dead = ppl.filter((p) => tree.isDeceased(p));
    const ages = dead.map((p) => tree.age(p)).filter((a) => a != null);
    const avg = ages.length ? Math.round(ages.reduce((a, b) => a + b, 0) / ages.length) : null;
    const years = ppl.map((p) => D.yearOf(tree.eventDate(p, 'BIRT'))).filter(Boolean);
    const stat = (v, k) => h('div', { class: 'stat' }, h('div', { class: 'v' }, v), h('div', { class: 'k' }, k));

    const page = h('div', { class: 'page' }, h('h2', null, 'Štatistiky'));
    page.appendChild(h('div', { class: 'stat-grid' },
      stat(ppl.length, 'osôb'),
      stat(tree.families.length, 'rodín a vzťahov'),
      stat(tree.media.length, 'fotiek'),
      stat(`${ppl.filter((p) => tree.sex(p) === 'M').length} / ${ppl.filter((p) => tree.sex(p) === 'F').length}`, 'mužov / žien'),
      stat(ppl.length - dead.length, 'žijúcich'),
      stat(avg != null ? avg + ' r.' : '–', 'priemerný vek dožitia'),
      stat(years.length ? Math.min(...years) : '–', 'najstarší známy rok narodenia'),
      stat(generations(tree), 'generácií v najdlhšej línii')));

    // Výročia
    const upcoming = [];
    for (const p of ppl) {
      const b = daysUntil(tree.eventDate(p, 'BIRT'));
      if (b && b.days <= 45 && !tree.isDeceased(p)) upcoming.push({ days: b.days, text: `🎂 ${tree.displayName(p)} – ${b.years}. narodeniny`, d: b.d, p });
      const dd = tree.isDeceased(p) && daysUntil(tree.eventDate(p, 'DEAT'));
      if (dd && dd.days <= 45) upcoming.push({ days: dd.days, text: `🕯 ${tree.displayName(p)} – ${dd.years} rokov od úmrtia`, d: dd.d, p });
    }
    for (const f of tree.families) {
      if (tree.familyStatus(f) !== 'married') continue;
      const a = daysUntil(M.getPath(f, 'MARR.DATE'));
      const hu = tree.husband(f), wi = tree.wife(f);
      if (a && a.days <= 45 && hu && wi && !tree.isDeceased(hu) && !tree.isDeceased(wi))
        upcoming.push({ days: a.days, text: `💍 ${tree.displayName(hu)} a ${tree.displayName(wi)} – ${a.years}. výročie sobáša`, d: a.d, p: hu });
    }
    upcoming.sort((a, b) => a.days - b.days);

    const oldestLiving = ppl.filter((p) => !tree.isDeceased(p) && tree.age(p) != null).sort((a, b) => tree.age(b) - tree.age(a)).slice(0, 5);
    const longest = dead.filter((p) => tree.age(p) != null).sort((a, b) => tree.age(b) - tree.age(a)).slice(0, 5);
    const personList = (list, fmt) => list.map((p) => h('div', { class: 'event-row', onclick: () => { RK.App.focus(p); RK.App.show('tree'); } }, h('span', null, tree.displayName(p)), h('span', { class: 'muted' }, fmt(p))));

    const decades = new Map();
    for (const y of years) decades.set(Math.floor(y / 10) * 10, (decades.get(Math.floor(y / 10) * 10) || 0) + 1);
    const decadeEntries = [...decades.entries()].sort((a, b) => a[0] - b[0]).map(([d, n]) => [d + '–' + (d + 9), n]);

    page.appendChild(h('div', { class: 'panel-grid' },
      h('div', { class: 'panel' }, h('h3', null, 'Najbližšie výročia (45 dní)'),
        upcoming.length ? upcoming.map((u) => h('div', { class: 'event-row', onclick: () => { RK.App.focus(u.p); RK.App.show('tree'); } },
          h('span', null, u.text), h('span', { class: 'muted' }, u.days === 0 ? 'dnes' : u.days === 1 ? 'zajtra' : `${u.d.d}. ${u.d.m}. (o ${u.days} dní)`)))
          : h('div', { class: 'muted small' }, 'V najbližších dňoch nič.')),
      h('div', { class: 'panel' }, h('h3', null, 'Najčastejšie priezviská'), bars(countBy(ppl, (p) => RK.UI.masculine(tree.names(p).surname)), 12)),
      h('div', { class: 'panel' }, h('h3', null, 'Najčastejšie mená – muži'), bars(countBy(ppl.filter((p) => tree.sex(p) === 'M'), (p) => tree.names(p).given), 10)),
      h('div', { class: 'panel' }, h('h3', null, 'Najčastejšie mená – ženy'), bars(countBy(ppl.filter((p) => tree.sex(p) === 'F'), (p) => tree.names(p).given), 10)),
      h('div', { class: 'panel' }, h('h3', null, 'Miesta narodenia'), bars(countBy(ppl, (p) => tree.eventPlace(p, 'BIRT')), 12)),
      h('div', { class: 'panel' }, h('h3', null, 'Narodení podľa desaťročí'), bars(decadeEntries, 40)),
      h('div', { class: 'panel' }, h('h3', null, 'Najstarší žijúci'), personList(oldestLiving, (p) => tree.age(p) + ' r.')),
      h('div', { class: 'panel' }, h('h3', null, 'Najdlhšie žijúci (zosnulí)'), personList(longest, (p) => tree.age(p) + ' r.'))));
    el.appendChild(page);
  }

  function generations(tree) {
    const memo = new Map();
    const depth = (p, seen) => {
      if (memo.has(p)) return memo.get(p);
      if (seen.has(p)) return 0;
      seen.add(p);
      const d = 1 + Math.max(0, ...tree.parents(p).map((x) => depth(x, seen)));
      seen.delete(p);
      memo.set(p, d);
      return d;
    };
    return Math.max(0, ...tree.people.map((p) => depth(p, new Set())));
  }

  // ---------- Príbuzenstvo ----------
  const relState = { a: null, b: null };
  function showRelation(a, b) {
    relState.a = a;
    relState.b = b;
    RK.App.show('relation');
  }

  function renderRelation() {
    const el = clear(document.getElementById('view-relation'));
    const tree = T();
    if (relState.a && !tree.get(relState.a.xref)) relState.a = null;
    if (relState.b && !tree.get(relState.b.xref)) relState.b = null;
    if (!relState.a) relState.a = tree.get(tree.homeId);
    if (!relState.b) relState.b = tree.get(RK.App.focusId);
    const result = h('div');
    const pa = personPicker({ value: relState.a, onChange: (p) => { relState.a = p; draw(); } });
    const pb = personPicker({ value: relState.b, onChange: (p) => { relState.b = p; draw(); } });
    const draw = () => {
      clear(result);
      const { a, b } = relState;
      if (!a || !b) return result.appendChild(h('div', { class: 'muted' }, 'Vyber dve osoby.'));
      const r = tree.relationship(a, b);
      const box = h('div', { class: 'rel-result' });
      if (!r.path) {
        box.appendChild(h('div', { class: 'rel-term' }, 'Tieto osoby nie sú v strome nijako prepojené.'));
      } else {
        box.appendChild(h('div', null, h('span', { class: 'muted' }, `${tree.displayName(b)} je pre ${tree.displayName(a)}: `)));
        box.appendChild(h('div', { class: 'rel-term' }, r.term));
        if (r.blood && r.blood.ancestor && r.blood.u && r.blood.d) box.appendChild(h('p', { class: 'muted small' }, `Najbližší spoločný predok: ${tree.displayName(r.blood.ancestor)}`));
        const chain = h('div', { class: 'chain' });
        r.path.forEach((s, i) => {
          if (i) chain.appendChild(h('div', { class: 'arrow' }, '→', h('br'), s.label));
          chain.appendChild(h('div', { class: 'mini', onclick: () => { RK.App.focus(s.person); RK.App.show('tree'); } }, RK.UI.avatar(s.person, 30),
            h('div', null, h('div', { class: 'nm' }, tree.displayName(s.person)), h('div', { class: 'meta' }, tree.lifeSpan(s.person)))));
        });
        box.append(h('h4', { style: { margin: '6px 0 10px' } }, 'Cesta v strome'), chain);
      }
      result.appendChild(box);
    };
    el.appendChild(h('div', { class: 'page' },
      h('h2', null, 'Aký je medzi nimi vzťah?'),
      h('div', { class: 'rel-pickers' },
        RK.UI.field('Osoba A', pa.el),
        h('button', { title: 'Vymeniť', onclick: () => { [relState.a, relState.b] = [relState.b, relState.a]; renderRelation(); } }, '⇄'),
        RK.UI.field('Osoba B', pb.el)),
      result));
    draw();
  }

  RK.Views = { renderPeople, renderPhotos, renderStats, renderRelation, showRelation };
})();
