/* Rodokmeňovec – dátový model nad GEDCOM stromom: osoby, rodiny, fotky, úpravy, príbuzenstvo. */
(function () {
  'use strict';
  const RK = (globalThis.RK = globalThis.RK || {});
  const { node } = RK.Gedcom;
  const D = RK.Dates;

  const META = new Set(['_UID', 'RIN', '_UPD']);
  const kid = (n, tag) => (n && n.children.find((c) => c.tag === tag)) || null;
  const kids = (n, tag) => (n ? n.children.filter((c) => c.tag === tag) : []);
  const isPtr = (v) => /^@[^@\s]+@$/.test(v || '');

  function getPath(n, path) {
    for (const t of path.split('.')) {
      n = kid(n, t);
      if (!n) return '';
    }
    return n.value || '';
  }

  // Poradie značiek v zázname – nové položky vkladáme na rozumné miesto.
  const ORDER = ['NAME', 'SEX', 'HUSB', 'WIFE', 'CHIL', 'BIRT', 'CHR', 'BAPM', 'DEAT', 'BURI', 'CREM', 'MARR', 'ENGA', 'DIV', 'EVEN',
    'OCCU', 'EDUC', 'RESI', 'NATI', 'RELI', 'DSCR', 'FAMC', 'FAMS', 'OBJE', 'NOTE', 'RIN', '_UID', '_UPD'];
  const rank = (t) => {
    const i = ORDER.indexOf(t);
    return i < 0 ? ORDER.indexOf('EVEN') + 0.5 : i;
  };

  function insertChild(parent, child) {
    const r = rank(child.tag);
    const i = parent.children.findIndex((c) => rank(c.tag) > r);
    if (i < 0) parent.children.push(child);
    else parent.children.splice(i, 0, child);
    return child;
  }

  function isEmpty(n) {
    return !n.value && !n.children.some((c) => !META.has(c.tag));
  }

  /** Nastaví hodnotu na ceste (napr. 'BIRT.DATE'); prázdna hodnota položku odstráni aj s prázdnymi rodičmi. */
  function setPath(n, path, value) {
    value = (value || '').trim();
    const tags = path.split('.');
    const chain = [n];
    let cur = n;
    for (const t of tags) {
      let c = kid(cur, t);
      if (!c) {
        if (!value) return;
        c = insertChild(cur, node(t));
      }
      chain.push(c);
      cur = c;
    }
    cur.value = value;
    if (!value) {
      for (let i = chain.length - 1; i > 0; i--) {
        if (!isEmpty(chain[i])) break;
        remove(chain[i - 1], chain[i]);
      }
    }
  }

  function remove(parent, child) {
    const i = parent.children.indexOf(child);
    if (i >= 0) parent.children.splice(i, 1);
  }

  function uuid() {
    if (globalThis.crypto && crypto.randomUUID) return crypto.randomUUID().toUpperCase();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : (r & 3) | 8).toString(16).toUpperCase();
    });
  }

  function gedTimestamp() {
    const n = RK.Gedcom.gedNow();
    return `${n.date} ${n.time}`;
  }

  // ---------- Typy faktov a vzťahov ----------
  const FACTS = {
    BIRT: 'Narodenie', CHR: 'Krst', BAPM: 'Krst', CONF: 'Birmovka', FCOM: 'Prvé sv. prijímanie', DEAT: 'Úmrtie', BURI: 'Pohreb',
    CREM: 'Kremácia', OCCU: 'Povolanie', EDUC: 'Vzdelanie', GRAD: 'Promócia', RESI: 'Bydlisko', EMIG: 'Emigrácia', IMMI: 'Prisťahovanie',
    NATU: 'Získanie občianstva', NATI: 'Národnosť', RELI: 'Vierovyznanie', DSCR: 'Opis osoby', TITL: 'Titul', _MILT: 'Vojenská služba',
    RETI: 'Odchod do dôchodku', CENS: 'Sčítanie ľudu', ADOP: 'Adopcia', PROP: 'Majetok', NCHI: 'Počet detí', NMR: 'Počet manželstiev',
    WILL: 'Závet', PROB: 'Dedičské konanie', EVEN: 'Iná udalosť', FACT: 'Iný fakt',
  };
  // Fakty, pri ktorých má zmysel samotný text (povolanie, národnosť…)
  const VALUE_FACTS = new Set(['OCCU', 'EDUC', 'NATI', 'RELI', 'DSCR', 'TITL', 'NCHI', 'NMR', 'PROP', 'FACT', 'EVEN']);
  const FAMILY_EVENT_TYPES = { SEPARATION: 'Separation', WIDOWED: 'Death of Spouse', FRIENDS: 'MYHERITAGE:REL_FRIENDS', PARTNERS: 'MYHERITAGE:REL_PARTNERS' };
  const STATUS = {
    married: 'manželia', divorced: 'rozvedení', separated: 'odlúčení', widowed: 'ovdovení', engaged: 'zasnúbení',
    partners: 'partneri', friends: 'priatelia', unknown: 'neznámy vzťah',
  };
  const PEDI = { '': 'vlastné', adopted: 'adoptované', foster: 'v pestúnskej starostlivosti', step: 'nevlastné' };

  // ---------- Strom ----------
  class Tree {
    constructor(root) {
      this.root = root;
      this.reindex();
    }

    static fromText(text) {
      return new Tree(RK.Gedcom.parse(text));
    }

    /** Nahradí obsah stromu (rovnaký objekt – otvorené dialógy naň ostávajú napojené). */
    load(text) {
      this.root = RK.Gedcom.parse(text);
      this.reindex();
    }

    reindex() {
      this.byId = new Map();
      this.people = [];
      this.families = [];
      this.media = [];
      for (const r of this.root.children) {
        if (r.xref) this.byId.set(r.xref, r);
        if (r.tag === 'INDI') this.people.push(r);
        else if (r.tag === 'FAM') this.families.push(r);
        else if (r.tag === 'OBJE') this.media.push(r);
      }
    }

    get(id) {
      return this.byId.get(id) || null;
    }

    head() {
      let h = this.root.children.find((r) => r.tag === 'HEAD');
      if (!h) {
        h = RK.Gedcom.makeHeader();
        this.root.children.unshift(h);
      }
      return h;
    }

    /** Domovská osoba: voľba v tomto prehliadači (homeOverride), inak zo súboru, inak prvá osoba. */
    get homeId() {
      if (this.homeOverride && this.get(this.homeOverride)) return this.homeOverride;
      const id = getPath(this.head(), '_HOME');
      return this.get(id) ? id : this.people[0] ? this.people[0].xref : null;
    }

    set homeId(id) {
      setPath(this.head(), '_HOME', id);
    }

    toText() {
      const h = this.head();
      const now = RK.Gedcom.gedNow();
      setPath(h, 'DATE', now.date);
      setPath(h, 'DATE.TIME', now.time);
      setPath(h, 'SOUR', 'RODOKMENOVEC');
      setPath(h, 'SUBM', '@U1@');
      if (!this.get('@U1@')) this.addRecord('SUBM', null, '@U1@').children.push(node('NAME', 'Rodokmeňovec'));
      if (!this.root.children.some((r) => r.tag === 'TRLR')) this.root.children.push(node('TRLR'));
      return RK.Gedcom.serialize(this.root);
    }

    nextId(prefix) {
      let max = 0;
      const re = new RegExp('^@' + prefix + '(\\d+)@$');
      for (const id of this.byId.keys()) {
        const m = id.match(re);
        if (m) max = Math.max(max, +m[1]);
      }
      return '@' + prefix + (max + 1) + '@';
    }

    addRecord(tag, prefix, xref) {
      const r = node(tag, '', [], xref || this.nextId(prefix));
      const t = this.root.children.findIndex((c) => c.tag === 'TRLR');
      if (t < 0) this.root.children.push(r);
      else this.root.children.splice(t, 0, r);
      this.reindex();
      return r;
    }

    removeRecord(r) {
      remove(this.root, r);
      this.reindex();
    }

    touch(r) {
      setPath(r, '_UPD', gedTimestamp());
    }

    // ----- Mená -----
    names(p) {
      const n = kid(p, 'NAME');
      const v = n ? n.value : '';
      const m = v.match(/^([^/]*)(?:\/([^/]*)\/?)?(.*)$/) || [];
      return {
        given: getPath(n, 'GIVN') || (m[1] || '').trim(),
        surname: getPath(n, 'SURN') || (m[2] || '').trim(),
        married: getPath(n, '_MARNM'),
        former: getPath(n, '_FORMERNAME'),
        prefix: getPath(n, 'NPFX'),
        suffix: getPath(n, 'NSFX'),
        nick: getPath(n, 'NICK'),
        religious: getPath(n, '_RNAME'),
      };
    }

    setNames(p, o) {
      let n = kid(p, 'NAME');
      if (!n) n = insertChild(p, node('NAME'));
      n.value = `${(o.given || '').trim()} /${(o.surname || '').trim()}/`.trim();
      const map = { prefix: 'NPFX', given: 'GIVN', nick: 'NICK', surname: 'SURN', suffix: 'NSFX', married: '_MARNM', former: '_FORMERNAME', religious: '_RNAME' };
      for (const [k, tag] of Object.entries(map)) {
        const val = (o[k] || '').trim();
        const c = kid(n, tag);
        if (val && c) c.value = val;
        else if (val) n.children.push(node(tag, val));
        else if (c) remove(n, c);
      }
    }

    /** Meno na kartičku: krstné + priezvisko po sobáši (ak je), inak rodné. */
    displayName(p) {
      if (!p) return '';
      const n = this.names(p);
      const s = [n.given, n.married || n.surname].filter(Boolean).join(' ');
      return s || '(bez mena)';
    }

    fullName(p) {
      const n = this.names(p);
      let s = [n.prefix, n.given, n.married || n.surname].filter(Boolean).join(' ');
      if (n.suffix) s += ', ' + n.suffix;
      return s || '(bez mena)';
    }

    birthName(p) {
      const n = this.names(p);
      return n.married && n.surname && n.married !== n.surname ? n.surname : '';
    }

    sex(p) {
      const s = getPath(p, 'SEX').toUpperCase();
      return s === 'M' || s === 'F' ? s : 'U';
    }

    // ----- Udalosti -----
    eventDate(p, tag) {
      return getPath(p, tag + '.DATE');
    }

    eventPlace(p, tag) {
      return getPath(p, tag + '.PLAC');
    }

    isDeceased(p) {
      if (kid(p, 'DEAT') || kid(p, 'BURI') || kid(p, 'CREM')) return true;
      const y = D.yearOf(this.eventDate(p, 'BIRT'));
      return !!y && new Date().getFullYear() - y > 105;
    }

    lifeSpan(p) {
      const b = D.formatDate(this.eventDate(p, 'BIRT'), 'year');
      const d = D.formatDate(this.eventDate(p, 'DEAT'), 'year');
      if (this.isDeceased(p)) return b || d ? `${b || '?'} – ${d || '?'}` : '†';
      return b ? `* ${b}` : '';
    }

    /** Vek v rokoch (pri žijúcich ku dnešku), alebo null. */
    age(p) {
      const b = D.parseDate(this.eventDate(p, 'BIRT'));
      if (!b || !b.d1 || b.type !== 'exact') return null;
      let end;
      if (this.isDeceased(p)) {
        const d = D.parseDate(this.eventDate(p, 'DEAT'));
        if (!d || !d.d1 || d.type !== 'exact') return null;
        end = d.d1;
      } else {
        const t = new Date();
        end = { y: t.getFullYear(), m: t.getMonth() + 1, d: t.getDate() };
      }
      let a = end.y - b.d1.y;
      if (b.d1.m && end.m && (end.m < b.d1.m || (end.m === b.d1.m && b.d1.d && end.d && end.d < b.d1.d))) a--;
      return a >= 0 && a < 130 ? a : null;
    }

    // ----- Rodinné väzby -----
    famc(p) {
      return kids(p, 'FAMC').map((c) => this.get(c.value)).filter(Boolean);
    }

    fams(p) {
      return kids(p, 'FAMS').map((c) => this.get(c.value)).filter(Boolean);
    }

    husband(f) {
      return this.get(getPath(f, 'HUSB'));
    }

    wife(f) {
      return this.get(getPath(f, 'WIFE'));
    }

    childrenOfFamily(f) {
      return kids(f, 'CHIL').map((c) => this.get(c.value)).filter(Boolean);
    }

    partnerIn(f, p) {
      const h = this.husband(f), w = this.wife(f);
      return h === p ? w : w === p ? h : null;
    }

    pedigree(child, f) {
      const l = kids(child, 'FAMC').find((c) => c.value === f.xref);
      return l ? getPath(l, 'PEDI').toLowerCase().replace('birth', '') : '';
    }

    /** Hlavná rodina rodičov (prednostne biologická). */
    parentFamily(p) {
      const fs = this.famc(p);
      return fs.find((f) => !this.pedigree(p, f)) || fs[0] || null;
    }

    father(p) {
      const f = this.parentFamily(p);
      return f ? this.husband(f) : null;
    }

    mother(p) {
      const f = this.parentFamily(p);
      return f ? this.wife(f) : null;
    }

    parents(p) {
      const out = [];
      for (const f of this.famc(p)) for (const x of [this.husband(f), this.wife(f)]) if (x && !out.includes(x)) out.push(x);
      return out;
    }

    spouses(p) {
      return this.fams(p).map((f) => ({ family: f, partner: this.partnerIn(f, p) }));
    }

    children(p) {
      const out = [];
      for (const f of this.fams(p)) for (const c of this.childrenOfFamily(f)) if (!out.includes(c)) out.push(c);
      return out;
    }

    siblings(p) {
      const full = [], half = [];
      for (const f of this.famc(p)) for (const c of this.childrenOfFamily(f)) if (c !== p && !full.includes(c)) full.push(c);
      for (const par of this.parents(p))
        for (const f of this.fams(par))
          for (const c of this.childrenOfFamily(f)) if (c !== p && !full.includes(c) && !half.includes(c)) half.push(c);
      const byBirth = (a, b) => (D.sortKey(this.eventDate(a, 'BIRT')) || 9e9) - (D.sortKey(this.eventDate(b, 'BIRT')) || 9e9);
      return { full: full.sort(byBirth), half: half.sort(byBirth) };
    }

    // ----- Stav vzťahu -----
    familyEvents(f, type) {
      return kids(f, 'EVEN').filter((e) => getPath(e, 'TYPE') === type);
    }

    familyStatus(f) {
      const has = (t) => !!kid(f, t);
      const ev = (t) => this.familyEvents(f, t).length > 0;
      if (has('DIV')) return 'divorced';
      if (ev(FAMILY_EVENT_TYPES.WIDOWED)) return 'widowed';
      if (ev(FAMILY_EVENT_TYPES.SEPARATION)) return 'separated';
      if (has('MARR')) return 'married';
      if (has('ENGA')) return 'engaged';
      if (ev(FAMILY_EVENT_TYPES.PARTNERS)) return 'partners';
      if (ev(FAMILY_EVENT_TYPES.FRIENDS)) return 'friends';
      return 'unknown';
    }

    setFamilyStatus(f, status) {
      if (status === this.familyStatus(f)) return;
      const ensure = (tag) => kid(f, tag) || insertChild(f, node(tag, 'Y', [node('_UID', uuid())]));
      const ensureEv = (type) => this.familyEvents(f, type)[0] || insertChild(f, node('EVEN', '', [node('_UID', uuid()), node('TYPE', type)]));
      const drop = (tag) => kids(f, tag).forEach((c) => remove(f, c));
      const dropEv = (type) => this.familyEvents(f, type).forEach((c) => remove(f, c));
      const marriedLike = ['married', 'divorced', 'separated', 'widowed'].includes(status);
      if (marriedLike) ensure('MARR');
      else drop('MARR');
      if (status === 'divorced') ensure('DIV');
      else drop('DIV');
      if (status === 'separated') ensureEv(FAMILY_EVENT_TYPES.SEPARATION);
      else dropEv(FAMILY_EVENT_TYPES.SEPARATION);
      if (status === 'widowed') ensureEv(FAMILY_EVENT_TYPES.WIDOWED);
      else dropEv(FAMILY_EVENT_TYPES.WIDOWED);
      if (status === 'engaged') ensure('ENGA');
      if (status === 'partners') ensureEv(FAMILY_EVENT_TYPES.PARTNERS);
      else dropEv(FAMILY_EVENT_TYPES.PARTNERS);
      if (status === 'friends') ensureEv(FAMILY_EVENT_TYPES.FRIENDS);
      else dropEv(FAMILY_EVENT_TYPES.FRIENDS);
      if (status === 'unknown') drop('ENGA');
    }

    /** Označenie partnera podľa stavu vzťahu, napr. „manželka“, „bývalý manžel“. */
    partnerTerm(f, partner) {
      const fem = this.sex(partner) === 'F';
      switch (this.familyStatus(f)) {
        case 'married': case 'widowed': case 'separated': return fem ? 'manželka' : 'manžel';
        case 'divorced': return fem ? 'bývalá manželka' : 'bývalý manžel';
        case 'engaged': return fem ? 'snúbenica' : 'snúbenec';
        case 'friends': return fem ? 'priateľka' : 'priateľ';
        default: return fem ? 'partnerka' : 'partner';
      }
    }

    // ----- Úpravy štruktúry -----
    createPerson(o) {
      o = o || {};
      const p = this.addRecord('INDI', 'I');
      p.children.push(node('_UID', uuid()));
      this.setNames(p, o);
      setPath(p, 'SEX', o.sex || 'U');
      this.touch(p);
      return p;
    }

    createFamily() {
      const f = this.addRecord('FAM', 'F');
      f.children.push(node('_UID', uuid()));
      this.touch(f);
      return f;
    }

    setSpouse(f, p) {
      if (this.husband(f) === p || this.wife(f) === p) return;
      let role = this.sex(p) === 'F' ? 'WIFE' : 'HUSB';
      if (kid(f, role)) role = role === 'WIFE' ? 'HUSB' : 'WIFE';
      if (kid(f, role)) throw new Error('Táto rodina už má oboch partnerov.');
      insertChild(f, node(role, p.xref));
      if (!kids(p, 'FAMS').some((c) => c.value === f.xref)) insertChild(p, node('FAMS', f.xref));
      this.touch(f);
    }

    addChild(f, c, pedi) {
      if (!kids(f, 'CHIL').some((x) => x.value === c.xref)) insertChild(f, node('CHIL', c.xref));
      let l = kids(c, 'FAMC').find((x) => x.value === f.xref);
      if (!l) l = insertChild(c, node('FAMC', f.xref));
      setPath(l, 'PEDI', pedi || '');
      this.sortChildren(f);
      this.touch(f);
    }

    setPedigree(f, c, pedi) {
      const l = kids(c, 'FAMC').find((x) => x.value === f.xref);
      if (l) setPath(l, 'PEDI', pedi || '');
    }

    sortChildren(f) {
      const ch = kids(f, 'CHIL');
      if (ch.length < 2) return;
      const key = (l) => D.sortKey(this.eventDate(this.get(l.value), 'BIRT'));
      // Deti s neznámym dátumom ostávajú na svojom mieste voči ostatným.
      const known = ch.filter((l) => key(l) != null).sort((a, b) => key(a) - key(b));
      let k = 0;
      const ordered = ch.map((l) => (key(l) != null ? known[k++] : l));
      const first = f.children.indexOf(ch[0]);
      f.children = f.children.filter((c) => c.tag !== 'CHIL');
      f.children.splice(Math.min(first, f.children.length), 0, ...ordered);
    }

    removeChild(f, c) {
      kids(f, 'CHIL').filter((x) => x.value === c.xref).forEach((x) => remove(f, x));
      kids(c, 'FAMC').filter((x) => x.value === f.xref).forEach((x) => remove(c, x));
      this.cleanupFamily(f);
    }

    removeSpouse(f, p) {
      f.children = f.children.filter((x) => !((x.tag === 'HUSB' || x.tag === 'WIFE') && x.value === p.xref));
      kids(p, 'FAMS').filter((x) => x.value === f.xref).forEach((x) => remove(p, x));
      this.cleanupFamily(f);
    }

    /** Rodina s menej ako dvoma členmi stráca zmysel – zrušíme ju. */
    cleanupFamily(f) {
      const members = [this.husband(f), this.wife(f), ...this.childrenOfFamily(f)].filter(Boolean);
      if (members.length >= 2) return false;
      for (const m of members) m.children = m.children.filter((x) => !((x.tag === 'FAMS' || x.tag === 'FAMC') && x.value === f.xref));
      this.removeRecord(f);
      return true;
    }

    deletePerson(p) {
      for (const f of [...this.fams(p)]) this.removeSpouse(f, p);
      for (const f of [...this.famc(p)]) this.removeChild(f, p);
      for (const n of kids(p, 'NOTE')) {
        if (isPtr(n.value) && this.referenceCount(n.value) <= 1) {
          const rec = this.get(n.value);
          if (rec) remove(this.root, rec);
        }
      }
      this.removeRecord(p);
    }

    referenceCount(xref) {
      let n = 0;
      const walk = (x) => {
        for (const c of x.children) {
          if (c.value === xref) n++;
          walk(c);
        }
      };
      walk(this.root);
      return n;
    }

    /** Pridá rodiča danej osobe. sex: 'M' | 'F'. Ak `existing`, prepojí existujúcu osobu. */
    addParent(p, sex, existing, names) {
      let f = this.parentFamily(p);
      const role = sex === 'F' ? 'WIFE' : 'HUSB';
      if (f && kid(f, role)) throw new Error(sex === 'F' ? 'Táto osoba už má matku.' : 'Táto osoba už má otca.');
      const parent = existing || this.createPerson(Object.assign({ sex }, names));
      if (!f) {
        f = this.createFamily();
        this.addChild(f, p);
      }
      insertChild(f, node(role, parent.xref));
      if (!kids(parent, 'FAMS').some((c) => c.value === f.xref)) insertChild(parent, node('FAMS', f.xref));
      if (kid(f, 'HUSB') && kid(f, 'WIFE') && this.familyStatus(f) === 'unknown') this.setFamilyStatus(f, 'married');
      return parent;
    }

    addPartner(p, existing, names, status) {
      const partner = existing || this.createPerson(names);
      const f = this.createFamily();
      this.setSpouse(f, p);
      this.setSpouse(f, partner);
      this.setFamilyStatus(f, status || 'married');
      return { partner, family: f };
    }

    /** Pridá dieťa. family: existujúca rodina, alebo null = rodina len s týmto rodičom. */
    addChildTo(p, family, existing, names, pedi) {
      const child = existing || this.createPerson(names);
      let f = family;
      if (!f) {
        f = this.createFamily();
        this.setSpouse(f, p);
      }
      this.addChild(f, child, pedi);
      return child;
    }

    addSibling(p, existing, names) {
      let f = this.parentFamily(p);
      if (!f) {
        f = this.createFamily();
        this.addChild(f, p);
      }
      const sib = existing || this.createPerson(names);
      this.addChild(f, sib);
      return sib;
    }

    // ----- Fakty -----
    facts(p) {
      return p.children.filter((c) => FACTS[c.tag] && c.tag !== 'BIRT' && c.tag !== 'DEAT');
    }

    contactEmail(p) {
      for (const r of kids(p, 'RESI')) {
        const e = getPath(r, 'EMAIL');
        if (e) return e;
      }
      return getPath(p, 'EMAIL');
    }

    setContactEmail(p, email) {
      const r = kids(p, 'RESI').find((x) => kid(x, 'EMAIL'));
      if (r) {
        setPath(r, 'EMAIL', email);
        if (isEmpty(r)) remove(p, r);
      } else if (email) {
        insertChild(p, node('RESI', '', [node('_UID', uuid()), node('EMAIL', email)]));
      }
    }

    // ----- Poznámky -----
    notes(p) {
      return kids(p, 'NOTE').map((n) => {
        const rec = isPtr(n.value) ? this.get(n.value) : null;
        return { link: n, record: rec, text: rec ? rec.value : n.value };
      }).filter((n) => n.text || n.record);
    }

    setNotes(p, texts) {
      const cur = this.notes(p);
      texts = texts.map((t) => t.trim());
      cur.forEach((n, i) => {
        const t = texts[i];
        if (t) {
          if (n.record) n.record.value = t;
          else n.link.value = t;
        } else {
          remove(p, n.link);
          if (n.record && this.referenceCount(n.record.xref) === 0) this.removeRecord(n.record);
        }
      });
      for (const t of texts.slice(cur.length)) if (t) insertChild(p, node('NOTE', t));
    }

    // ----- Fotky -----
    mediaFile(m) {
      return getPath(m, 'FILE');
    }

    mediaTitle(m) {
      return getPath(m, 'FILE.TITL') || getPath(m, 'TITL');
    }

    setMediaTitle(m, t) {
      if (kid(m, 'TITL') && !kid(kid(m, 'FILE'), 'TITL')) setPath(m, 'TITL', t);
      else setPath(m, 'FILE.TITL', t);
    }

    photoLinks(p) {
      return kids(p, 'OBJE').filter((l) => isPtr(l.value) && this.get(l.value)).map((l) => {
        const c = getPath(l, '_CROP').split(/\s+/).map(Number);
        return { link: l, media: this.get(l.value), crop: c.length === 4 && c.every((v) => v >= 0) && c[2] > 0 ? c : null, primary: getPath(l, '_PRIM') === 'Y' };
      });
    }

    primaryPhoto(p) {
      const ls = this.photoLinks(p);
      return ls.find((l) => l.primary) || ls[0] || null;
    }

    peopleInMedia(m) {
      const out = [];
      for (const p of this.people) {
        const l = this.photoLinks(p).find((x) => x.media === m);
        if (l) out.push(Object.assign({ person: p }, l));
      }
      return out;
    }

    addMedia(file, title, format) {
      const m = this.addRecord('OBJE', 'P');
      const f = node('FILE', file, [node('FORM', format || 'jpg', [node('TYPE', 'photo')])]);
      if (title) f.children.push(node('TITL', title));
      m.children.push(f, node('_UID', uuid()));
      this.touch(m);
      return m;
    }

    linkMedia(p, m, crop) {
      let l = kids(p, 'OBJE').find((x) => x.value === m.xref);
      if (!l) l = insertChild(p, node('OBJE', m.xref));
      setPath(l, '_CROP', crop ? crop.map(Math.round).join(' ') : '');
      if (!this.photoLinks(p).some((x) => x.primary)) setPath(l, '_PRIM', 'Y');
    }

    unlinkMedia(p, m) {
      kids(p, 'OBJE').filter((x) => x.value === m.xref).forEach((x) => remove(p, x));
    }

    setPrimaryPhoto(p, m) {
      for (const l of kids(p, 'OBJE')) setPath(l, '_PRIM', l.value === m.xref ? 'Y' : '');
    }

    deleteMedia(m) {
      for (const p of this.people) this.unlinkMedia(p, m);
      this.removeRecord(m);
    }

    // ----- Príbuzenstvo -----
    /** Mapa predkov: xref → vzdialenosť v generáciách (osoba sama = 0). */
    ancestorDistances(p) {
      const dist = new Map([[p.xref, 0]]);
      const q = [p];
      while (q.length) {
        const x = q.shift();
        for (const par of this.parents(x)) {
          if (!dist.has(par.xref)) {
            dist.set(par.xref, dist.get(x.xref) + 1);
            q.push(par);
          }
        }
      }
      return dist;
    }

    bloodRelation(a, b) {
      const da = this.ancestorDistances(a), db = this.ancestorDistances(b);
      let best = null;
      for (const [id, u] of da) {
        if (!db.has(id)) continue;
        const d = db.get(id);
        if (!best || u + d < best.u + best.d) best = { u, d, ancestor: this.get(id) };
      }
      if (!best) return null;
      best.term = this.kinTerm(a, b, best);
      return best;
    }

    kinTerm(a, b, r) {
      const { u, d } = r;
      const sx = this.sex(b);
      const t = (m, f) => (sx === 'F' ? f : sx === 'M' ? m : `${m}/${f}`);
      const pra = (n) => 'pra'.repeat(Math.max(0, n));
      if (u === 0 && d === 0) return 'tá istá osoba';
      if (d === 0) return u === 1 ? t('otec', 'matka') : t(pra(u - 2) + 'starý otec', pra(u - 2) + 'stará matka');
      if (u === 0) return d === 1 ? t('syn', 'dcéra') : t(pra(d - 2) + 'vnuk', pra(d - 2) + 'vnučka');
      if (u === 1 && d === 1) {
        const pa = this.parents(a), pb = this.parents(b);
        const shared = pa.filter((x) => pb.includes(x)).length;
        if (shared === 1 && pa.length > 1 && pb.length > 1) return t('nevlastný brat', 'nevlastná sestra') + ' (jeden spoločný rodič)';
        return t('brat', 'sestra');
      }
      if (u === 1) return t(pra(d - 2) + 'synovec', pra(d - 2) + 'neter');
      if (d === 1) {
        if (u === 2 && sx !== 'F') {
          // strýko = otcov brat, ujo = mamin brat
          const viaFather = this.father(a) && this.ancestorDistances(this.father(a)).get(r.ancestor.xref) === 1;
          const viaMother = this.mother(a) && this.ancestorDistances(this.mother(a)).get(r.ancestor.xref) === 1;
          if (viaMother && !viaFather) return 'ujo';
          if (viaFather && !viaMother) return 'strýko';
          return 'strýko/ujo';
        }
        return t(pra(u - 2) + 'strýko', pra(u - 2) + 'teta');
      }
      const k = Math.min(u, d) - 1;
      const diff = Math.abs(u - d);
      const kolena = k > 1 ? ` z ${k}. kolena` : '';
      if (!diff) return t('bratranec', 'sesternica') + kolena;
      if (u > d) {
        // b je bratranec/sesternica niektorého predka osoby a
        const elder = ['', 'rodiča', 'starého rodiča'][diff] || pra(diff - 2) + 'starého rodiča';
        return `${t('bratranec', 'sesternica')}${kolena} ${elder}`;
      }
      // b je potomok bratranca/sesternice osoby a
      const younger = diff === 1 ? t('syn', 'dcéra') : t(pra(diff - 2) + 'vnuk', pra(diff - 2) + 'vnučka');
      return `${younger} bratranca/sesternice${kolena}`;
    }

    /** Najkratšia cesta medzi osobami cez rodičov, deti a partnerov. */
    path(a, b) {
      const prev = new Map([[a.xref, null]]);
      const q = [a];
      while (q.length) {
        const x = q.shift();
        if (x === b) break;
        const next = [
          ...this.parents(x).map((y) => [y, this.sex(y) === 'F' ? 'matka' : 'otec']),
          ...this.children(x).map((y) => [y, this.sex(y) === 'F' ? 'dcéra' : 'syn']),
          ...this.spouses(x).filter((s) => s.partner).map((s) => [s.partner, this.partnerTerm(s.family, s.partner)]),
        ];
        for (const [y, label] of next) {
          if (prev.has(y.xref)) continue;
          prev.set(y.xref, { from: x, label });
          q.push(y);
        }
      }
      if (!prev.has(b.xref)) return null;
      const chain = [];
      for (let x = b; x; ) {
        const p = prev.get(x.xref);
        chain.unshift({ person: x, label: p ? p.label : '' });
        x = p ? p.from : null;
      }
      return chain;
    }

    /** Slovný popis vzťahu: kým je b pre a. */
    relationship(a, b) {
      const out = { term: '', path: this.path(a, b), blood: null };
      if (!out.path) return out;
      if (a === b) return Object.assign(out, { term: 'tá istá osoba' });
      const sp = this.spouses(a).find((s) => s.partner === b);
      if (sp) return Object.assign(out, { term: this.partnerTerm(sp.family, b) });
      const blood = this.bloodRelation(a, b);
      if (blood) return Object.assign(out, { term: blood.term, blood });
      const fem = this.sex(b) === 'F';
      // b je partnerom pokrvného príbuzného osoby a
      for (const s of this.spouses(b)) {
        if (!s.partner) continue;
        const r = this.bloodRelation(a, s.partner);
        if (!r) continue;
        let term;
        if (r.d === 0) term = (fem ? 'nevlastná ' : 'nevlastný ') + this.kinTerm(a, b, r);
        else if (r.u === 0 && r.d === 1) term = fem ? 'nevesta' : 'zať';
        else if (r.u === 1 && r.d === 1) term = fem ? 'švagriná' : 'švagor';
        else if (r.u === 2 && r.d === 1) term = fem ? 'teta (cez manželstvo)' : 'strýko (cez manželstvo)';
        else {
          const rel = this.sex(s.partner) === 'F' ? 'príbuznej' : 'príbuzného';
          term = `${this.partnerTerm(s.family, b)} ${rel} (${r.term} ${this.displayName(s.partner)})`;
        }
        return Object.assign(out, { term });
      }
      // b je pokrvným príbuzným partnera osoby a
      for (const s of this.spouses(a)) {
        if (!s.partner) continue;
        const r = this.bloodRelation(s.partner, b);
        if (!r) continue;
        let term;
        if (r.u === 1 && r.d === 0) term = fem ? 'svokra' : 'svokor';
        else if (r.u === 0 && r.d === 1) term = fem ? 'nevlastná dcéra' : 'nevlastný syn';
        else if (r.u === 1 && r.d === 1) term = fem ? 'švagriná' : 'švagor';
        else term = `${r.term} (príbuzenstvo cez partnera ${this.displayName(s.partner)})`;
        return Object.assign(out, { term });
      }
      return Object.assign(out, { term: 'vzdialený príbuzný cez manželstvá' });
    }
  }

  RK.Tree = Tree;
  RK.Model = { node, kid, kids, getPath, setPath, insertChild, remove, isEmpty, uuid, isPtr, FACTS, VALUE_FACTS, STATUS, PEDI, FAMILY_EVENT_TYPES };
  if (typeof module !== 'undefined') module.exports = RK;
})();
