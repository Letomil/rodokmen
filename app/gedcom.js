/* Rodokmeňovec – GEDCOM jadro: čítanie, zápis, prevod z MyHeritage, dátumy.
   Funguje v prehliadači (klasický <script>) aj v Node (require). */
(function () {
  'use strict';
  const RK = (globalThis.RK = globalThis.RK || {});

  // ---------- Uzly ----------
  function node(tag, value, children, xref) {
    return { tag, value: value || '', xref: xref || null, children: children || [] };
  }

  // ---------- Čítanie ----------
  const LINE_RE = /^\s*(\d+)\s+(?:(@[^@\s]+@)\s+)?(\S+)(?: (.*))?$/;
  const CONT_RE = /^(CONC|CONT)(__\w+)?$/;

  function parse(text) {
    text = text.replace(/^﻿/, '');
    const root = node('ROOT');
    const stack = [root];
    for (const raw of text.split(/\r\n|\r|\n/)) {
      if (!raw.trim()) continue;
      const m = raw.match(LINE_RE);
      if (!m) continue;
      const level = +m[1];
      const tag = m[3];
      let value = m[4] || '';
      if (!/^@[^@\s]+@$/.test(value)) value = value.replace(/@@/g, '@');
      const parent = stack[Math.min(level, stack.length - 1)];
      const cm = tag.match(CONT_RE);
      if (cm && level > 0) {
        parent.value += (cm[1] === 'CONT' ? '\n' : '') + value;
        continue;
      }
      const n = node(tag, value, [], m[2] || null);
      parent.children.push(n);
      stack[level + 1] = n;
      stack.length = level + 2;
    }
    return root;
  }

  // ---------- Zápis ----------
  const MAX_LINE = 200;

  function escapeValue(v) {
    if (/^@[^@\s]+@/.test(v)) return v; // ukazovateľ (aj s doplnkom, napr. starý PERS)
    return v.replace(/@/g, '@@');
  }

  function splitLong(s) {
    const parts = [];
    while (s.length > MAX_LINE) {
      let cut = MAX_LINE;
      // nedelíme pri medzere – niektoré programy ju orežú
      while (cut > 1 && (s[cut - 1] === ' ' || s[cut] === ' ')) cut--;
      parts.push(s.slice(0, cut));
      s = s.slice(cut);
    }
    parts.push(s);
    return parts;
  }

  function writeNode(n, level, out) {
    const lines = String(n.value || '').split('\n');
    const first = splitLong(escapeValue(lines[0]));
    out.push(level + ' ' + (n.xref ? n.xref + ' ' : '') + n.tag + (first[0] ? ' ' + first[0] : ''));
    for (const c of first.slice(1)) out.push(level + 1 + ' CONC ' + c);
    for (const l of lines.slice(1)) {
      const parts = splitLong(escapeValue(l));
      out.push(level + 1 + ' CONT' + (parts[0] ? ' ' + parts[0] : ''));
      for (const c of parts.slice(1)) out.push(level + 1 + ' CONC ' + c);
    }
    for (const c of n.children) writeNode(c, level + 1, out);
  }

  function serialize(root) {
    const out = [];
    for (const r of root.children) writeNode(r, 0, out);
    return out.join('\r\n') + '\r\n';
  }

  // ---------- Dátumy ----------
  const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const MON_NOM = ['január', 'február', 'marec', 'apríl', 'máj', 'jún', 'júl', 'august', 'september', 'október', 'november', 'december'];
  const MON_GEN = ['januára', 'februára', 'marca', 'apríla', 'mája', 'júna', 'júla', 'augusta', 'septembra', 'októbra', 'novembra', 'decembra'];
  const SIMPLE_RE = /^(?:(\d{1,2})\s+)?(?:(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s+)?(\d{3,4})(?:\/\d{2})?$/i;

  function parseSimple(s) {
    const m = String(s || '').trim().match(SIMPLE_RE);
    if (!m) return null;
    if (m[1] && !m[2]) return null;
    const d = m[1] ? +m[1] : 0;
    const mo = m[2] ? MON.indexOf(m[2].toUpperCase()) + 1 : 0;
    if (d > 31) return null;
    return { y: +m[3], m: mo, d };
  }

  /** Rozloží GEDCOM dátum na štruktúru. Vráti null pre prázdny reťazec. */
  function parseDate(str) {
    const s = String(str || '').trim();
    if (!s) return null;
    let m;
    if ((m = s.match(/^\((.*)\)$/))) return { type: 'phrase', text: m[1] };
    if ((m = s.match(/^INT\s+(.+?)\s*\((.*)\)$/i))) {
      const d1 = parseSimple(m[1]);
      return d1 ? { type: 'exact', d1, text: m[2] } : { type: 'phrase', text: s };
    }
    if ((m = s.match(/^BET\s+(.+?)\s+AND\s+(.+)$/i))) {
      const d1 = parseSimple(m[1]), d2 = parseSimple(m[2]);
      if (d1 && d2) return { type: 'between', d1, d2 };
    }
    if ((m = s.match(/^FROM\s+(.+?)(?:\s+TO\s+(.+))?$/i))) {
      const d1 = parseSimple(m[1]), d2 = m[2] ? parseSimple(m[2]) : null;
      if (d1 && (!m[2] || d2)) return { type: 'from', d1, d2 };
    }
    if ((m = s.match(/^TO\s+(.+)$/i))) {
      const d1 = parseSimple(m[1]);
      if (d1) return { type: 'to', d1 };
    }
    if ((m = s.match(/^(ABT|CAL|EST|BEF|AFT)\.?\s+(.+)$/i))) {
      const d1 = parseSimple(m[2]);
      const k = m[1].toUpperCase();
      if (d1) return { type: k === 'BEF' ? 'before' : k === 'AFT' ? 'after' : 'about', d1 };
    }
    const d1 = parseSimple(s);
    if (d1) return { type: 'exact', d1 };
    return { type: 'invalid', text: s };
  }

  function sortKey(str) {
    const p = parseDate(str);
    if (!p || !p.d1) return null;
    return p.d1.y * 10000 + p.d1.m * 100 + p.d1.d;
  }

  function yearOf(str) {
    const p = parseDate(str);
    return p && p.d1 ? p.d1.y : null;
  }

  function fmtSimple(d, style) {
    if (style === 'short') {
      if (d.d) return `${d.d}. ${d.m}. ${d.y}`;
      if (d.m) return `${d.m}/${d.y}`;
      return String(d.y);
    }
    if (d.d) return `${d.d}. ${MON_GEN[d.m - 1]} ${d.y}`;
    if (d.m) return `${MON_NOM[d.m - 1]} ${d.y}`;
    return String(d.y);
  }

  /** Slovenské zobrazenie dátumu. style: 'long' | 'short' | 'year' */
  function formatDate(str, style) {
    style = style || 'long';
    const p = parseDate(str);
    if (!p) return '';
    if (p.type === 'phrase' || p.type === 'invalid') return style === 'year' ? '' : p.text;
    if (style === 'year') {
      const y = p.d1.y;
      if (p.type === 'about') return '~' + y;
      if (p.type === 'before') return '<' + y;
      if (p.type === 'after') return '>' + y;
      return String(y);
    }
    const a = fmtSimple(p.d1, style);
    // Po predložkách by sa mesiac musel skloňovať rôzne – použijeme číselný tvar.
    const n1 = fmtSimple(p.d1, 'short');
    const n2 = p.d2 ? fmtSimple(p.d2, 'short') : '';
    switch (p.type) {
      case 'about': return 'okolo ' + (style === 'long' && p.d1.m && !p.d1.d ? `${MON_GEN[p.d1.m - 1]} ${p.d1.y}` : a);
      case 'before': return 'pred ' + n1;
      case 'after': return 'po ' + n1;
      case 'between': return `medzi ${n1} a ${n2}`;
      case 'from': return p.d2 ? `od ${n1} do ${n2}` : 'od ' + n1;
      case 'to': return 'do ' + n1;
      default: return p.text ? `${a} (${p.text})` : a;
    }
  }

  function fold(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  }

  const MON_KEYS = { jan: 1, feb: 2, mar: 3, apr: 4, maj: 5, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, okt: 10, oct: 10, nov: 11, dec: 12 };

  function simpleToGed(d) {
    return (d.d ? d.d + ' ' : '') + (d.m ? MON[d.m - 1] + ' ' : '') + d.y;
  }

  function parseInputSimple(s) {
    s = fold(s).trim().replace(/\s+/g, ' ');
    let m;
    const ok = (d, mo, y) => (mo >= 0 && mo <= 12 && d >= 0 && d <= 31 && (!d || mo) && y >= 100 && y <= 2999 ? { y, m: mo, d } : null);
    if ((m = s.match(/^(\d{1,2}) ?\. ?(\d{1,2}) ?\. ?(\d{3,4})$/))) return ok(+m[1], +m[2], +m[3]);
    if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) return ok(+m[3], +m[2], +m[1]);
    if ((m = s.match(/^(\d{1,2}) ?[./] ?(\d{3,4})$/))) return ok(0, +m[1], +m[2]);
    if ((m = s.match(/^(\d{3,4})$/))) return ok(0, 0, +m[1]);
    if ((m = s.match(/^(?:(\d{1,2})\.? )?([a-z]{3,})\.? (\d{3,4})$/))) {
      const mo = MON_KEYS[m[2].slice(0, 3)];
      if (mo) return ok(m[1] ? +m[1] : 0, mo, +m[3]);
    }
    return null;
  }

  /** Prevedie zadanie používateľa (napr. „8.6.1964“, „okolo 1938“) na GEDCOM. */
  function inputToGed(input) {
    const raw = String(input || '').trim();
    if (!raw) return '';
    const g = parseDate(raw.toUpperCase());
    if (g && g.type !== 'invalid' && g.type !== 'phrase') return raw.toUpperCase().replace(/\s+/g, ' ');
    const f = fold(raw).trim();
    let m;
    if ((m = f.match(/^medzi (.+) a (.+)$/))) {
      const a = parseInputSimple(m[1]), b = parseInputSimple(m[2]);
      if (a && b) return `BET ${simpleToGed(a)} AND ${simpleToGed(b)}`;
    }
    if ((m = f.match(/^od (.+?)(?: do (.+))?$/))) {
      const a = parseInputSimple(m[1]), b = m[2] ? parseInputSimple(m[2]) : null;
      if (a && (!m[2] || b)) return `FROM ${simpleToGed(a)}` + (b ? ` TO ${simpleToGed(b)}` : '');
    }
    if ((m = f.match(/^do (.+)$/))) {
      const a = parseInputSimple(m[1]);
      if (a) return 'TO ' + simpleToGed(a);
    }
    if ((m = f.match(/^(?:okolo|cca\.?|asi|priblizne|pribl\.?|~)\s*(?:roku |r\. ?)?(.+)$/))) {
      const a = parseInputSimple(m[1]);
      if (a) return 'ABT ' + simpleToGed(a);
    }
    if ((m = f.match(/^(?:pred|<)\s*(?:rokom )?(.+)$/))) {
      const a = parseInputSimple(m[1]);
      if (a) return 'BEF ' + simpleToGed(a);
    }
    if ((m = f.match(/^(?:po|>)\s*(?:roku )?(.+)$/))) {
      const a = parseInputSimple(m[1]);
      if (a) return 'AFT ' + simpleToGed(a);
    }
    const a = parseInputSimple(f);
    if (a) return simpleToGed(a);
    return '(' + raw.replace(/[()]/g, '') + ')';
  }

  function simpleToInput(d) {
    if (d.d) return `${d.d}.${d.m}.${d.y}`;
    if (d.m) return `${d.m}.${d.y}`;
    return String(d.y);
  }

  /** Opačný smer: GEDCOM dátum do podoby na úpravu. */
  function gedToInput(str) {
    const p = parseDate(str);
    if (!p) return '';
    switch (p.type) {
      case 'phrase': case 'invalid': return p.text;
      case 'about': return 'okolo ' + simpleToInput(p.d1);
      case 'before': return 'pred ' + simpleToInput(p.d1);
      case 'after': return 'po ' + simpleToInput(p.d1);
      case 'between': return `medzi ${simpleToInput(p.d1)} a ${simpleToInput(p.d2)}`;
      case 'from': return 'od ' + simpleToInput(p.d1) + (p.d2 ? ' do ' + simpleToInput(p.d2) : '');
      case 'to': return 'do ' + simpleToInput(p.d1);
      default: return simpleToInput(p.d1);
    }
  }

  // ---------- Prevod z MyHeritage (ZEDCOM) do štandardného GEDCOM 5.5.1 ----------
  // Interné príznaky MyHeritage bez významu pre rodokmeň.
  const MH_DROP = new Set(['_STOP', '_HTMLREADY', 'AUXX', '_PENDL', '_THUMB', 'TSRC', 'CTOR', 'PRIN', '_CRC', '_SIZE', 'FUPD']);
  // Udalosti, ktoré majú význam aj bez dátumu (napr. „zosnulý“, „zosobášení“).
  const FLAG_EVENTS = new Set(['DEAT', 'BURI', 'CREM', 'MARR', 'DIV', 'ENGA']);
  const META = new Set(['_UID', 'RIN', '_UPD']);
  const EVENT_TAGS = /^(BIRT|CHR|BAPM|DEAT|BURI|CREM|DSCR|RESI|EDUC|OCCU|NATI|RELI|EVEN|MARR|DIV|ENGA)$/;

  function stripLang(n) {
    n.tag = n.tag.replace(/__\w+$/, '');
    n.children = n.children.filter((c) => !MH_DROP.has(c.tag.replace(/__\w+$/, '')));
    n.children.forEach(stripLang);
  }

  function fixDates(n) {
    for (const c of n.children) {
      if (c.tag === 'DATE' && c.value) {
        const p = parseDate(c.value);
        if (p && p.type === 'invalid') {
          const m = fold(c.value).match(/^(?:okolo|cca|asi)\s*(?:roku )?(\d{3,4})$/);
          c.value = m ? 'ABT ' + m[1] : '(' + c.value.replace(/[()]/g, '') + ')';
        }
      }
      fixDates(c);
    }
  }

  /**
   * Upraví strom načítaný zo súboru .uzed (MyHeritage Family Tree Builder) na štandardný GEDCOM.
   * opts.photoFile(id, ext, w, h) → relatívna cesta k súboru fotky
   * opts.homeId → xref domovskej osoby
   */
  function convertMyHeritage(root, opts) {
    opts = opts || {};
    stripLang(root);
    root.children = root.children.filter((r) => r.tag !== 'HEAD' && r.tag !== 'TRLR' && r.tag !== '_PUBLISH');
    const byId = new Map(root.children.filter((r) => r.xref).map((r) => [r.xref, r]));
    const report = { photos: 0, links: 0, oddDates: [] };

    for (const r of root.children) {
      if (r.tag === 'INDI' || r.tag === 'FAM') {
        r.children = r.children.filter((ev) => {
          if (!EVENT_TAGS.test(ev.tag)) return true;
          if (ev.tag === 'RESI' && ev.value.startsWith('<')) ev.value = '';
          if (ev.value || ev.children.some((c) => !META.has(c.tag))) return true;
          if (FLAG_EVENTS.has(ev.tag)) { ev.value = 'Y'; return true; }
          return false; // prázdna udalosť bez obsahu
        });
      }
      if (r.tag === 'NOTE') r.children = r.children.filter((c) => c.tag !== 'NOTE');
    }

    // Fotky: INDP → OBJE, prepojenia osoba–fotka (+ výrez tváre) do záznamov osôb
    const primary = new Map(); // personXref → photoXref
    for (const r of root.children) {
      if (r.tag !== 'INDI') continue;
      const ph = r.children.find((c) => c.tag === '_PHOT');
      if (ph) primary.set(r.xref, ph.value);
      r.children = r.children.filter((c) => c.tag !== '_PHOT');
    }
    const links = new Map(); // personXref → [{photo, crop}]
    const addLink = (pid, photo, crop) => {
      if (!links.has(pid)) links.set(pid, []);
      const arr = links.get(pid);
      if (!arr.some((l) => l.photo === photo)) arr.push({ photo, crop });
    };
    for (const r of root.children) {
      if (r.tag !== 'INDP') continue;
      report.photos++;
      const phot = (r.children.find((c) => c.tag === 'PHOT') || { value: 'jpg 0 0' }).value.split(/\s+/);
      const title = (r.children.find((c) => c.tag === 'TITL') || {}).value || '';
      const file = node('FILE', opts.photoFile ? opts.photoFile(r.xref.replace(/@/g, ''), phot[0], phot[1], phot[2]) : '', [
        node('FORM', (phot[0] || 'jpg').toLowerCase(), [node('TYPE', 'photo')]),
      ]);
      if (title) file.children.push(node('TITL', title));
      const kids = [file];
      for (const c of r.children) {
        if (c.tag === 'PERS') {
          const [pid, ...nums] = c.value.split(/\s+/);
          const crop = nums.map(Number);
          addLink(pid, r.xref, crop.length === 4 && crop.some((v) => v > 0) ? crop.join(' ') : '');
        } else if (c.tag === 'PARE') kids.push(node('_PARENT', c.value));
        else if (META.has(c.tag) || c.tag === 'DATE' || c.tag === 'PLAC' || c.tag === 'NOTE') kids.push(c);
      }
      r.tag = 'OBJE';
      r.value = '';
      r.children = kids;
    }
    for (const [pid, ph] of primary) addLink(pid, ph, '');
    for (const [pid, arr] of links) {
      const p = byId.get(pid);
      if (!p || p.tag !== 'INDI') continue;
      const prim = primary.get(pid);
      for (const l of arr) {
        const lk = node('OBJE', l.photo);
        if (l.crop) lk.children.push(node('_CROP', l.crop));
        if (l.photo === prim) lk.children.push(node('_PRIM', 'Y'));
        p.children.push(lk);
        report.links++;
      }
    }

    // Dátumy, ktoré nie sú platné podľa štandardu
    (function walk(n) {
      for (const c of n.children) {
        if (c.tag === 'DATE' && c.value && parseDate(c.value).type === 'invalid') report.oddDates.push(c.value);
        walk(c);
      }
    })(root);
    fixDates(root);

    root.children.unshift(makeHeader(opts.homeId));
    root.children.push(node('TRLR'));
    return report;
  }

  function two(n) { return String(n).padStart(2, '0'); }

  function gedNow() {
    const d = new Date();
    return { date: `${d.getDate()} ${MON[d.getMonth()]} ${d.getFullYear()}`, time: `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}` };
  }

  function makeHeader(homeId) {
    const now = gedNow();
    const h = node('HEAD', '', [
      node('SOUR', 'RODOKMENOVEC', [node('NAME', 'Rodokmeňovec'), node('VERS', '1.0')]),
      node('DATE', now.date, [node('TIME', now.time)]),
      node('SUBM', '@U1@'),
      node('GEDC', '', [node('VERS', '5.5.1'), node('FORM', 'LINEAGE-LINKED')]),
      node('CHAR', 'UTF-8'),
      node('LANG', 'Slovak'),
    ]);
    if (homeId) h.children.push(node('_HOME', homeId));
    return h;
  }

  RK.Gedcom = { node, parse, serialize, convertMyHeritage, makeHeader, gedNow };
  RK.Dates = { parseDate, formatDate, sortKey, yearOf, inputToGed, gedToInput, MON, MON_NOM, MON_GEN };
  RK.fold = fold;
  if (typeof module !== 'undefined') module.exports = RK;
})();
