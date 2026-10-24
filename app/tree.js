/* Rodokmeňovec – kreslenie stromu: predkovia nad vybranou osobou, súrodenci vedľa nej, partneri a potomkovia pod ňou. */
(function () {
  'use strict';
  const RK = (globalThis.RK = globalThis.RK || {});
  const { h, clear } = RK.UI;

  const W = 168, H = 66;      // rozmer kartičky (zhodný s CSS)
  const GAP = 22;             // medzera medzi vetvami
  const CGAP = 16;            // medzera medzi partnermi
  const V = 58;               // zvislá medzera medzi generáciami
  const PAD = 400;            // okraj sveta okolo stromu

  const view = { x: 0, y: 0, k: 1 };
  let world, canvas, lastLayout = null;

  // ---------- Rozloženie ----------
  function computeLayout(tree, focus, up, down) {
    const cards = [];
    const lines = [];
    const cx = (c) => c.x + W / 2;

    const addCard = (p, x, y, extra) => {
      const c = Object.assign({ p, x, y }, extra || {});
      cards.push(c);
      return c;
    };

    const isEx = (f) => f && ['divorced', 'separated'].includes(tree.familyStatus(f));

    /** Spojnica rodičia → deti. from: {x, y} bod, z ktorého vedie čiara dole. */
    const connect = (fromX, fromY, kidCenters, kidY, barOffset, dashed) => {
      if (!kidCenters.length) return;
      const barY = kidY - V / 2 + (barOffset || 0);
      lines.push({ d: `M${fromX},${fromY}V${barY}`, dashed });
      const xs = kidCenters.concat(fromX);
      lines.push({ d: `M${Math.min(...xs)},${barY}H${Math.max(...xs)}`, dashed });
      for (const k of kidCenters) lines.push({ d: `M${k},${barY}V${kidY}`, dashed });
    };

    // --- Potomkovia ---
    function buildDesc(p, depth, maxDepth, withSpouses) {
      const parts = withSpouses ? tree.spouses(p) : [];
      let row;
      const withP = parts.filter((x) => x.partner);
      if (withP.length === 0) row = [{ p }];
      else if (withP.length === 1) {
        const q = withP[0];
        const pFirst = !(tree.sex(p) === 'F' && tree.sex(q.partner) !== 'F');
        row = pFirst ? [{ p }, { p: q.partner, fam: q.family }] : [{ p: q.partner, fam: q.family }, { p }];
      } else {
        row = [{ p: withP[0].partner, fam: withP[0].family }, { p }, ...withP.slice(1).map((x) => ({ p: x.partner, fam: x.family }))];
      }
      const rowW = row.length * W + (row.length - 1) * CGAP;
      const groups = depth < maxDepth
        ? parts.map((x) => ({ fam: x.family, kids: tree.childrenOfFamily(x.family).map((c) => buildDesc(c, depth + 1, maxDepth, true)) })).filter((g) => g.kids.length)
        : [];
      const kidsW = groups.reduce((s, g) => s + g.kids.reduce((a, k) => a + k.w, 0) + (g.kids.length - 1) * GAP, 0) + Math.max(0, groups.length - 1) * GAP * 2;
      const hiddenKids = !groups.length && tree.children(p).length > 0;
      return { p, row, groups, rowW, kidsW, w: Math.max(rowW, kidsW), hiddenKids };
    }

    function placeDesc(b, x0, y) {
      const rowX0 = x0 + (b.w - b.rowW) / 2;
      const placed = b.row.map((r, i) => {
        const isMain = r.p === b.p;
        const c = addCard(r.p, rowX0 + i * (W + CGAP), y, {
          more: isMain && b.hiddenKids ? 'down' : null,
          upMore: !isMain && tree.parents(r.p).length > 0,
        });
        c.fam = r.fam;
        return c;
      });
      const me = placed.find((c) => c.p === b.p);
      for (const c of placed) {
        if (c === me) continue;
        const [a, z] = c.x < me.x ? [c, me] : [me, c];
        lines.push({ d: `M${a.x + W},${y + H / 2}H${z.x}`, marr: true, dashed: isEx(c.fam) });
      }
      let x = x0 + (b.w - b.kidsW) / 2;
      const kidY = y + H + V;
      b.groups.forEach((g, gi) => {
        const pc = placed.find((c) => c.fam === g.fam);
        const fromX = pc ? (cx(me) + cx(pc)) / 2 : cx(me);
        const centers = [];
        for (const k of g.kids) {
          centers.push(placeDesc(k, x, kidY));
          x += k.w + GAP;
        }
        x += GAP;
        connect(fromX, pc ? y + H / 2 : y + H, centers, kidY, gi * 6);
      });
      return cx(me);
    }

    // --- Predkovia ---
    function pedW(p, g) {
      if (!p || g <= 0) return W;
      const pf = tree.parentFamily(p);
      if (!pf) return W;
      const f = tree.husband(pf), m = tree.wife(pf);
      if (f && m) return Math.max(W, pedW(f, g - 1) + GAP + pedW(m, g - 1));
      return Math.max(W, pedW(f || m, g - 1));
    }

    /** Umiestni rodičov z rodiny `fam` nad stredom x=centerX. ghosts: doplniť „pridať otca/matku“. */
    function placeCouple(fam, centerX, y, gens, kidCenters, kidY, ghostFor) {
      const f = fam ? tree.husband(fam) : null;
      const m = fam ? tree.wife(fam) : null;
      const showF = f || ghostFor, showM = m || ghostFor;
      const wf = f ? pedW(f, gens - 1) : W;
      const wm = m ? pedW(m, gens - 1) : W;
      let fx = null, mx = null;
      if (showF && showM) {
        fx = centerX - GAP / 2 - wf / 2;
        mx = centerX + GAP / 2 + wm / 2;
      } else if (showF) fx = centerX;
      else if (showM) mx = centerX;
      const fc = showF ? addCard(f, fx - W / 2, y, f ? {} : { ghost: 'father', of: ghostFor }) : null;
      const mc = showM ? addCard(m, mx - W / 2, y, m ? {} : { ghost: 'mother', of: ghostFor }) : null;
      let fromX, fromY;
      const ghostLine = (fc && fc.ghost) || (mc && mc.ghost);
      if (fc && mc) {
        lines.push({ d: `M${fc.x + W},${y + H / 2}H${mc.x}`, marr: true, dashed: ghostLine || isEx(fam) });
        fromX = (cx(fc) + cx(mc)) / 2;
        fromY = y + H / 2;
      } else {
        fromX = cx(fc || mc);
        fromY = y + H;
      }
      connect(fromX, fromY, kidCenters, kidY, 0, !fam);
      for (const [c, w] of [[fc, wf], [mc, wm]]) {
        if (!c || !c.p) continue;
        const pf = tree.parentFamily(c.p);
        if (!pf) continue;
        if (gens - 1 > 0) placeCouple(pf, cx(c), y - H - V, gens - 1, [cx(c)], y);
        else c.more = 'up';
      }
    }

    // --- Zostavenie ---
    const pf = tree.parentFamily(focus);
    if (up > 0) {
      const kids = pf ? tree.childrenOfFamily(pf) : [focus];
      if (!kids.includes(focus)) kids.push(focus);
      const blocks = kids.map((c) => (c === focus ? buildDesc(focus, 0, down, true) : buildDesc(c, 0, 0, false)));
      let x = 0;
      const centers = [];
      for (const b of blocks) {
        centers.push(placeDesc(b, x, 0));
        x += b.w + GAP;
      }
      const mid = (Math.min(...centers) + Math.max(...centers)) / 2;
      const missing = !pf || !tree.husband(pf) || !tree.wife(pf);
      placeCouple(pf, mid, -H - V, up, centers, 0, missing ? focus : null);
    } else {
      placeDesc(buildDesc(focus, 0, down, true), 0, 0);
      if (pf) cards.find((c) => c.p === focus).more = 'up';
    }
    return { cards, lines };
  }

  // ---------- Kreslenie ----------
  function cardEl(c, focus) {
    const tree = RK.App.tree;
    if (c.ghost) {
      return h('div', {
        class: 'card ghost', style: { left: c.x + 'px', top: c.y + 'px' }, title: 'Pridať',
        onclick: () => RK.Editors.addRelative(c.of, c.ghost),
      }, h('div', { class: 'avatar', style: { width: '44px', height: '44px', fontSize: '22px' } }, '+'),
      h('div', null, h('div', { class: 'nm' }, c.ghost === 'father' ? 'Pridať otca' : 'Pridať matku')));
    }
    const p = c.p;
    const bn = tree.birthName(p);
    const el = h('div', {
      class: ['card', tree.sex(p), p === focus && 'focus', tree.isDeceased(p) && 'dead'].filter(Boolean).join(' '),
      style: { left: c.x + 'px', top: c.y + 'px' },
      title: tree.fullName(p) + (bn ? ` (rod. ${bn})` : ''),
      'data-id': p.xref,
      // v mobile: prvé ťuknutie vycentruje, ťuknutie na vybranú osobu otvorí profil
      onclick: () => (p === focus && RK.Profile.isMobile() ? RK.Profile.open() : RK.App.focus(p)),
    },
    RK.UI.avatar(p, 44),
    h('div', { style: { minWidth: 0 } },
      h('div', { class: 'nm' }, tree.displayName(p)),
      h('div', { class: 'yr' }, tree.lifeSpan(p) || ' ')));
    if (c.more === 'up' || c.upMore) el.appendChild(h('div', { class: 'more up', title: 'Má ďalších predkov' }, '▲'));
    if (c.more === 'down') el.appendChild(h('div', { class: 'more down', title: 'Má ďalších potomkov' }, '▼'));
    return el;
  }

  function apply() {
    world.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.k})`;
  }

  function render(recenter) {
    const tree = RK.App.tree;
    const focus = tree.get(RK.App.focusId);
    world = document.getElementById('tree-world');
    canvas = document.getElementById('tree-canvas');
    clear(world);
    if (!focus) {
      world.appendChild(h('div', { class: 'muted', style: { padding: '40px' } }, 'Strom je prázdny.'));
      return;
    }
    const up = +document.getElementById('gen-up').value;
    const down = +document.getElementById('gen-down').value;
    const L = computeLayout(tree, focus, up, down);
    const minX = Math.min(...L.cards.map((c) => c.x)) - PAD;
    const minY = Math.min(...L.cards.map((c) => c.y)) - PAD;
    const maxX = Math.max(...L.cards.map((c) => c.x + W)) + PAD;
    const maxY = Math.max(...L.cards.map((c) => c.y + H)) + PAD;
    world.style.width = maxX - minX + 'px';
    world.style.height = maxY - minY + 'px';

    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('width', maxX - minX);
    svg.setAttribute('height', maxY - minY);
    const g = document.createElementNS(svgNS, 'g');
    g.setAttribute('transform', `translate(${-minX},${-minY})`);
    for (const l of L.lines) {
      const path = document.createElementNS(svgNS, 'path');
      path.setAttribute('d', l.d);
      path.setAttribute('class', 'conn' + (l.marr ? ' marr' : '') + (l.dashed ? ' ex' : ''));
      g.appendChild(path);
    }
    svg.appendChild(g);
    world.appendChild(svg);
    for (const c of L.cards) {
      const el = cardEl(Object.assign({}, c, { x: c.x - minX, y: c.y - minY }), focus);
      world.appendChild(el);
    }
    const fc = L.cards.find((c) => c.p === focus);
    lastLayout = { fx: fc.x - minX + W / 2, fy: fc.y - minY + H / 2 };
    if (recenter !== false) center();
    else apply();
  }

  function center() {
    if (!lastLayout || !canvas) return;
    const r = canvas.getBoundingClientRect();
    view.x = r.width / 2 - lastLayout.fx * view.k;
    view.y = r.height / 2 - lastLayout.fy * view.k;
    apply();
  }

  function zoomAt(factor, px, py) {
    const k = Math.min(2.2, Math.max(0.2, view.k * factor));
    const r = canvas.getBoundingClientRect();
    if (px == null) { px = r.width / 2; py = r.height / 2; }
    view.x = px - ((px - view.x) * k) / view.k;
    view.y = py - ((py - view.y) * k) / view.k;
    view.k = k;
    apply();
  }

  const defaultZoom = () => (window.matchMedia('(max-width: 700px)').matches ? 0.7 : 1);

  function init() {
    view.k = defaultZoom();
    canvas = document.getElementById('tree-canvas');
    world = document.getElementById('tree-world');
    // Posun (myš aj prst – aj po kartách; ťuknutie bez pohybu ostáva kliknutím) a priblíženie dvoma prstami.
    const pts = new Map();
    let drag = null, pinch = null, moved = false;
    const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
    canvas.addEventListener('pointerdown', (e) => {
      if (e.button > 0) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 1) {
        drag = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
        moved = false;
      } else if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        pinch = { d: dist(a, b) || 1, k: view.k };
        drag = null;
        moved = true;
      }
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch && pts.size >= 2) {
        const [a, b] = [...pts.values()];
        const r = canvas.getBoundingClientRect();
        zoomAt((pinch.k * dist(a, b)) / pinch.d / view.k, (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top);
        return;
      }
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (!moved && Math.hypot(dx, dy) > 6) {
        moved = true;
        canvas.setPointerCapture(e.pointerId);
        canvas.classList.add('dragging');
      }
      if (moved) {
        view.x = drag.vx + dx;
        view.y = drag.vy + dy;
        apply();
      }
    });
    const end = (e) => {
      pts.delete(e.pointerId);
      if (pts.size < 2) pinch = null;
      if (!pts.size) { drag = null; canvas.classList.remove('dragging'); }
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    // po potiahnutí nechceme „kliknúť“ na kartu, na ktorej ťah skončil
    canvas.addEventListener('click', (e) => {
      if (moved) { e.stopPropagation(); e.preventDefault(); moved = false; }
    }, true);
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = canvas.getBoundingClientRect();
      zoomAt(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });
    document.getElementById('zoom-in').onclick = () => zoomAt(1.2);
    document.getElementById('zoom-out').onclick = () => zoomAt(1 / 1.2);
    document.getElementById('zoom-reset').onclick = () => { view.k = defaultZoom(); center(); };
    document.getElementById('gen-up').onchange = () => render();
    document.getElementById('gen-down').onchange = () => render();
    window.addEventListener('resize', () => center());

    // Tlač: celý strom na šírku stránky
    let saved;
    window.addEventListener('beforeprint', () => {
      saved = Object.assign({}, view);
      const w = parseFloat(world.style.width) - 2 * PAD, hgt = parseFloat(world.style.height) - 2 * PAD;
      const k = Math.min(1, 1000 / w, 1400 / hgt);
      view.k = k;
      view.x = -PAD * k;
      view.y = -PAD * k;
      apply();
    });
    window.addEventListener('afterprint', () => { if (saved) { Object.assign(view, saved); apply(); } });
  }

  RK.TreeView = { init, render, center, computeLayout };
})();
