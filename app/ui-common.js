/* Rodokmeňovec – spoločné prvky rozhrania: tvorba DOM, dialógy, avatary, výber osoby, polia formulárov. */
(function () {
  'use strict';
  const RK = (globalThis.RK = globalThis.RK || {});
  const D = RK.Dates;

  /** h('div', {class:'x', onclick: fn}, 'text', child, [children]) */
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else if (k === 'value') el.value = v;
        else if (k === 'checked' || k === 'selected' || k === 'disabled') el[k] = !!v;
        else el.setAttribute(k, v === true ? '' : v);
      }
    }
    append(el, kids);
    return el;
  }

  function append(el, kids) {
    for (const k of kids) {
      if (k == null || k === false) continue;
      if (Array.isArray(k)) append(el, k);
      else el.appendChild(k instanceof Node ? k : document.createTextNode(String(k)));
    }
  }

  function clear(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
    return el;
  }

  // ---------- Toast ----------
  let toastTimer;
  function toast(msg, ms) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.add('hidden'), ms || 3200);
  }

  // ---------- Dialógy ----------
  const stack = [];
  function modal(o) {
    const root = document.getElementById('modal-root');
    const foot = h('div', { class: 'modal-foot' });
    const box = h('div', { class: 'modal' + (o.wide ? ' wide' : '') },
      h('div', { class: 'modal-head' }, h('h3', null, o.title || ''), h('button', { class: 'link', title: 'Zavrieť', onclick: () => close() }, '✕')),
      h('div', { class: 'modal-body' }, o.body),
      foot);
    const back = h('div', { class: 'modal-back' }, box);
    back.addEventListener('mousedown', (e) => { if (e.target === back && o.dismissable !== false) close(); });
    const close = () => {
      back.remove();
      const i = stack.indexOf(api);
      if (i >= 0) stack.splice(i, 1);
      if (o.onClose) o.onClose();
    };
    for (const b of o.buttons || []) {
      foot.appendChild(h('button', {
        class: [b.primary && 'primary', b.danger && 'danger', b.left && 'left'].filter(Boolean).join(' '),
        onclick: async () => {
          if (!b.onClick) return close();
          try {
            const r = await b.onClick();
            if (r !== false) close();
          } catch (e) {
            console.error(e);
            alert(e.message || String(e));
          }
        },
      }, b.label));
    }
    if (!o.buttons || !o.buttons.length) foot.remove();
    root.appendChild(back);
    const api = { close, el: box };
    stack.push(api);
    setTimeout(() => {
      const f = box.querySelector('[autofocus], .modal-body input, .modal-body select');
      if (f) f.focus();
    }, 30);
    return api;
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && stack.length) stack[stack.length - 1].close();
  });

  function closeAll() {
    [...stack].reverse().forEach((m) => m.close());
  }

  function confirmDialog(text, okLabel, danger) {
    return new Promise((res) => {
      let answered = false;
      modal({
        title: 'Potvrdenie',
        body: h('p', null, text),
        onClose: () => { if (!answered) res(false); },
        buttons: [
          { label: 'Zrušiť' },
          { label: okLabel || 'OK', primary: !danger, danger, onClick: () => { answered = true; res(true); } },
        ],
      });
    });
  }

  // ---------- Avatary a výrezy fotiek ----------
  const cropCache = new Map();
  const imgCache = new Map();

  function loadImage(url) {
    if (!imgCache.has(url)) {
      imgCache.set(url, new Promise((res, rej) => {
        const i = new Image();
        i.onload = () => res(i);
        i.onerror = rej;
        i.src = url;
      }));
    }
    return imgCache.get(url);
  }

  /** Štvorcový výrez z fotky (podľa výrezu tváre, inak stred). Vráti URL alebo null. */
  async function cropUrl(media, crop, size) {
    const tree = RK.App.tree;
    const file = tree.mediaFile(media);
    const key = `${file}|${crop ? crop.join(',') : ''}|${size}`;
    if (cropCache.has(key)) return cropCache.get(key);
    const p = (async () => {
      const url = await RK.Storage.photoUrl(file);
      if (!url) return null;
      const img = await loadImage(url);
      let [x, y, w, hgt] = crop || [0, 0, img.naturalWidth, img.naturalHeight];
      x = Math.max(0, x); y = Math.max(0, y);
      w = Math.min(w, img.naturalWidth - x); hgt = Math.min(hgt, img.naturalHeight - y);
      // štvorec – pri portréte berieme hornú časť (tvár)
      const s = Math.min(w, hgt);
      const sx = x + (w - s) / 2;
      const sy = hgt > w ? y + (hgt - s) * 0.25 : y + (hgt - s) / 2;
      const c = document.createElement('canvas');
      c.width = c.height = size * 2;
      c.getContext('2d').drawImage(img, sx, sy, s, s, 0, 0, size * 2, size * 2);
      const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.85));
      return blob ? URL.createObjectURL(blob) : null;
    })().catch(() => null);
    cropCache.set(key, p);
    return p;
  }

  function clearImageCaches() {
    cropCache.clear();
    imgCache.clear();
  }

  function initials(tree, p) {
    const n = tree.names(p);
    return ((n.given || '?')[0] + ((n.married || n.surname || '')[0] || '')).toUpperCase();
  }

  /** Okrúhly avatar osoby; fotka sa doplní asynchrónne. */
  function avatar(p, size) {
    const tree = RK.App.tree;
    const el = h('div', { class: 'avatar ' + tree.sex(p), style: { width: size + 'px', height: size + 'px', fontSize: Math.round(size * 0.38) + 'px' } }, initials(tree, p));
    const ph = tree.primaryPhoto(p);
    if (ph) {
      cropUrl(ph.media, ph.crop, size).then((u) => {
        if (!u) return;
        el.style.backgroundImage = `url("${u}")`;
        el.classList.add('has-photo');
      });
    }
    return el;
  }

  // ---------- Hľadanie osôb ----------
  function searchPeople(q, limit) {
    const tree = RK.App.tree;
    const terms = RK.fold(q).split(/\s+/).filter(Boolean);
    if (!terms.length) return [];
    const out = [];
    for (const p of tree.people) {
      const n = tree.names(p);
      const hay = RK.fold([n.given, n.surname, n.married, n.former, n.nick, n.prefix, tree.eventPlace(p, 'BIRT')].join(' '));
      if (!terms.every((t) => hay.includes(t))) continue;
      const score = terms.reduce((s, t) => s + (RK.fold(n.given).startsWith(t) || RK.fold(n.married || n.surname).startsWith(t) ? 2 : 1), 0);
      out.push({ p, score });
    }
    out.sort((a, b) => b.score - a.score || tree.displayName(a.p).localeCompare(tree.displayName(b.p), 'sk'));
    return out.slice(0, limit || 20).map((x) => x.p);
  }

  function personRow(p, size) {
    const tree = RK.App.tree;
    const meta = [tree.lifeSpan(p), tree.birthName(p) && 'rod. ' + tree.birthName(p)].filter(Boolean).join(' · ');
    return h('div', { class: 'result-row' }, avatar(p, size || 30), h('div', null, h('div', null, tree.displayName(p)), h('div', { class: 'meta' }, meta)));
  }

  /** Vyhľadávacie pole s rozbaľovacím zoznamom. onPick(person). */
  function attachSearch(input, list, onPick, exclude) {
    let sel = 0, items = [];
    const render = () => {
      clear(list);
      items = searchPeople(input.value, 12).filter((p) => !exclude || !exclude.includes(p));
      if (!items.length) {
        if (input.value.trim()) list.appendChild(h('div', { class: 'muted small', style: { padding: '8px 10px' } }, 'Nikto sa nenašiel.'));
        list.classList.toggle('hidden', !input.value.trim());
        return;
      }
      items.forEach((p, i) => list.appendChild(h('button', { class: i === sel ? 'sel' : '', onmousedown: (e) => { e.preventDefault(); pick(p); } }, personRow(p))));
      list.classList.remove('hidden');
    };
    const pick = (p) => {
      list.classList.add('hidden');
      onPick(p);
    };
    input.addEventListener('input', () => { sel = 0; render(); });
    input.addEventListener('focus', () => input.value.trim() && render());
    input.addEventListener('blur', () => setTimeout(() => list.classList.add('hidden'), 150));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { sel = Math.min(sel + 1, items.length - 1); render(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { sel = Math.max(sel - 1, 0); render(); e.preventDefault(); }
      else if (e.key === 'Enter' && items[sel]) { pick(items[sel]); e.preventDefault(); }
      else if (e.key === 'Escape') { list.classList.add('hidden'); e.stopPropagation(); }
    });
  }

  /** Výber existujúcej osoby. Vráti {el, get(), set(p)}. */
  function personPicker(o) {
    o = o || {};
    let value = o.value || null;
    const wrap = h('div', { class: 'picker' });
    const render = () => {
      clear(wrap);
      if (value) {
        wrap.appendChild(h('div', { class: 'chosen' }, personRow(value, 28),
          h('button', { class: 'link x', title: 'Zmeniť', onclick: () => { value = null; render(); o.onChange && o.onChange(null); wrap.querySelector('input').focus(); } }, 'zmeniť')));
      } else {
        const input = h('input', { type: 'search', placeholder: o.placeholder || 'Začni písať meno…' });
        const list = h('div', { class: 'dropdown hidden' });
        wrap.append(input, list);
        attachSearch(input, list, (p) => { value = p; render(); o.onChange && o.onChange(p); }, o.exclude);
      }
    };
    render();
    return { el: wrap, get: () => value, set: (p) => { value = p; render(); } };
  }

  // ---------- Polia formulárov ----------
  function field(label, input, extra) {
    return h('div', { class: 'field' + (extra && extra.full ? ' full' : '') }, h('label', null, label), input, extra && extra.hint);
  }

  function textInput(value, attrs) {
    return h('input', Object.assign({ type: 'text', value: value || '' }, attrs || {}));
  }

  /** Pole dátumu s náhľadom, ako sa zadanie pochopilo. */
  function dateField(label, gedValue, extra) {
    const input = textInput(D.gedToInput(gedValue), { placeholder: 'napr. 8.6.1964, 1938, okolo 1900' });
    const hint = h('div', { class: 'hint' });
    const update = () => {
      const g = D.inputToGed(input.value);
      const p = D.parseDate(g);
      hint.classList.toggle('warn', !!p && p.type === 'phrase');
      hint.textContent = !g ? '' : p.type === 'phrase' ? 'Neznámy formát – uloží sa ako text' : '→ ' + D.formatDate(g);
    };
    input.addEventListener('input', update);
    update();
    return { el: field(label, input, Object.assign({}, extra, { hint })), get: () => D.inputToGed(input.value), input };
  }

  /** Datalist známych miest pre polia „miesto“. */
  function refreshPlaces() {
    let dl = document.getElementById('places');
    if (!dl) {
      dl = h('datalist', { id: 'places' });
      document.body.appendChild(dl);
    }
    clear(dl);
    const set = new Set();
    (function walk(n) {
      for (const c of n.children) {
        if (c.tag === 'PLAC' && c.value) set.add(c.value.trim());
        walk(c);
      }
    })(RK.App.tree.root);
    [...set].sort((a, b) => a.localeCompare(b, 'sk')).forEach((v) => dl.appendChild(h('option', { value: v })));
  }

  function placeInput(value) {
    return textInput(value, { list: 'places', placeholder: 'obec, mesto, krajina' });
  }

  /** Ženská podoba priezviska (Albert → Albertová, Moravanský → Moravanská). */
  function feminine(s) {
    s = (s || '').trim();
    if (!s || /(ová|ská|cká|ná|á)$/i.test(s)) return s;
    if (/ý$/.test(s)) return s.slice(0, -1) + 'á';
    if (/[aeo]$/.test(s)) return s.slice(0, -1) + 'ová';
    return s + 'ová';
  }

  /** Mužská podoba (Albertová → Albert, Moravanská → Moravanský). */
  function masculine(s) {
    s = (s || '').trim();
    if (/ová$/.test(s)) return s.slice(0, -3);
    if (/(sk|ck|n)á$/.test(s)) return s.slice(0, -1) + 'ý';
    return s;
  }

  RK.UI = { h, clear, toast, modal, closeAll, confirmDialog, avatar, cropUrl, loadImage, clearImageCaches, searchPeople, personRow, attachSearch, personPicker, field, textInput, dateField, placeInput, refreshPlaces, feminine, masculine };
})();
