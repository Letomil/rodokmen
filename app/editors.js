/* Rodokmeňovec – dialógy na úpravy: osoba, pridanie príbuzného, vzťah (rodina), fotky. */
(function () {
  'use strict';
  const RK = (globalThis.RK = globalThis.RK || {});
  const { h, clear, modal, field, textInput, dateField, placeInput, personPicker, toast } = RK.UI;
  const M = RK.Model;
  const D = RK.Dates;

  const app = () => RK.App;
  const T = () => RK.App.tree;

  function radios(name, options, value) {
    const wrap = h('div', { class: 'radio-row' });
    for (const [v, label] of options) {
      wrap.appendChild(h('label', null, h('input', { type: 'radio', name, value: v, checked: v === value }), label));
    }
    return { el: wrap, get: () => (wrap.querySelector('input:checked') || {}).value, onChange: (fn) => wrap.addEventListener('change', fn) };
  }

  function select(options, value) {
    const s = h('select');
    for (const [v, label] of options) s.appendChild(h('option', { value: v, selected: v === value }, label));
    return s;
  }

  function hasContent(ev) {
    return ev.children.some((c) => !['_UID', 'RIN', '_UPD'].includes(c.tag));
  }

  /** Nastaví udalosť (BIRT, DEAT…). flag=true: udalosť ostane aj bez údajov (napr. „zosnulý“). */
  function setEvent(rec, tag, vals, flag) {
    let ev = M.kid(rec, tag);
    const any = Object.values(vals).some((v) => v && v.trim());
    if (!ev && !any && !flag) return;
    if (!ev) ev = M.insertChild(rec, M.node(tag, '', [M.node('_UID', M.uuid())]));
    for (const [k, v] of Object.entries(vals)) M.setPath(ev, k, v);
    if (hasContent(ev)) {
      if (ev.value === 'Y') ev.value = '';
    } else if (flag) ev.value = 'Y';
    else M.remove(rec, ev);
  }

  // ---------- Úprava osoby ----------
  function editPerson(p, focusSection) {
    const tree = T();
    RK.UI.refreshPlaces();
    const n = tree.names(p);
    const inp = {};
    for (const k of ['prefix', 'given', 'surname', 'married', 'suffix', 'nick', 'former', 'religious']) inp[k] = textInput(n[k]);
    const sex = radios('sex', [['M', 'Muž'], ['F', 'Žena'], ['U', 'Neznáme']], tree.sex(p));
    const alive = radios('alive', [['1', 'Žije'], ['0', 'Zosnulý / zosnulá']], tree.isDeceased(p) ? '0' : '1');
    const birthDate = dateField('Dátum narodenia', tree.eventDate(p, 'BIRT'));
    const birthPlace = placeInput(tree.eventPlace(p, 'BIRT'));
    const deathDate = dateField('Dátum úmrtia', tree.eventDate(p, 'DEAT'));
    const deathPlace = placeInput(tree.eventPlace(p, 'DEAT'));
    const deathCause = textInput(M.getPath(p, 'DEAT.CAUS'));
    const buriDate = dateField('Dátum pohrebu', tree.eventDate(p, 'BURI'));
    const buriPlace = placeInput(tree.eventPlace(p, 'BURI'));
    const email = h('input', { type: 'email', value: tree.contactEmail(p) });

    const deathBox = h('div', { class: 'fieldset' }, h('div', { class: 'legend' }, 'Úmrtie a pohreb'),
      h('div', { class: 'form-grid' },
        deathDate.el, field('Miesto úmrtia', deathPlace), field('Príčina úmrtia', deathCause, { full: true }),
        buriDate.el, field('Miesto pohrebu', buriPlace)));
    const syncDeath = () => deathBox.classList.toggle('hidden', alive.get() !== '0');
    alive.onChange(syncDeath);
    syncDeath();

    // Ďalšie fakty
    const isEmailOnly = (f) => f.tag === 'RESI' && M.kid(f, 'EMAIL') && !f.value && !M.kid(f, 'DATE') && !M.kid(f, 'PLAC');
    const rows = [];
    const factList = h('div');
    const factTypes = Object.entries(M.FACTS).filter(([t]) => !['BIRT', 'DEAT', 'BURI'].includes(t));
    const addRow = (nodeRef) => {
      const tag = nodeRef ? nodeRef.tag : 'OCCU';
      const typeSel = select(factTypes, tag);
      const descOf = (n) => (!n ? '' : M.VALUE_FACTS.has(n.tag) && n.tag !== 'EVEN' ? (n.value === 'Y' ? '' : n.value) : M.getPath(n, 'TYPE'));
      const desc = textInput(descOf(nodeRef), { placeholder: 'popis (napr. lekár)' });
      const date = textInput(nodeRef ? D.gedToInput(M.getPath(nodeRef, 'DATE')) : '', { placeholder: 'dátum' });
      const place = placeInput(nodeRef ? M.getPath(nodeRef, 'PLAC') : '');
      const row = { node: nodeRef, typeSel, desc, date, place, removed: false };
      const el = h('div', { class: 'fact-row' }, typeSel, desc, date, place,
        h('button', { class: 'link danger', title: 'Odstrániť', onclick: () => { row.removed = true; el.remove(); } }, '✕'));
      rows.push(row);
      factList.appendChild(el);
    };
    tree.facts(p).filter((f) => f.tag !== 'BURI' && !isEmailOnly(f)).forEach(addRow);

    // Poznámky
    const noteList = h('div');
    const noteAreas = [];
    const addNote = (text) => {
      const ta = h('textarea', { rows: 3 }, text || '');
      noteAreas.push(ta);
      noteList.appendChild(h('div', { style: { marginBottom: '6px' } }, ta));
      return ta;
    };
    tree.notes(p).forEach((x) => addNote(x.text));

    const notesBox = h('div', { class: 'fieldset' }, h('div', { class: 'legend' }, 'Poznámky'), noteList,
      h('button', { class: 'link', onclick: () => addNote('').focus() }, '+ pridať poznámku'));

    const body = h('div', null,
      h('div', { class: 'form-grid' },
        field('Krstné meno', inp.given), field('Priezvisko (rodné)', inp.surname),
        field('Priezvisko po sobáši', inp.married, { hint: h('div', { class: 'hint' }, 'ak sa líši od rodného') }), field('Prezývka', inp.nick),
        field('Titul pred menom', inp.prefix), field('Titul za menom', inp.suffix),
        field('Predchádzajúce priezvisko', inp.former), field('Iné meno (rehoľné…)', inp.religious),
        field('Pohlavie', sex.el), field('Stav', alive.el)),
      h('div', { class: 'fieldset' }, h('div', { class: 'legend' }, 'Narodenie'),
        h('div', { class: 'form-grid' }, birthDate.el, field('Miesto narodenia', birthPlace))),
      deathBox,
      h('div', { class: 'fieldset' }, h('div', { class: 'legend' }, 'Ďalšie údaje a udalosti'),
        h('div', { class: 'form-grid', style: { marginBottom: '10px' } }, field('E-mail', email)),
        h('div', { class: 'fact-row muted small' }, h('div', null, 'typ'), h('div', null, 'popis'), h('div', null, 'dátum'), h('div', null, 'miesto'), h('div')),
        factList,
        h('button', { class: 'link', onclick: () => addRow(null) }, '+ pridať údaj alebo udalosť')),
      notesBox);

    const dlg = modal({
      title: 'Upraviť: ' + tree.displayName(p),
      wide: true,
      body,
      buttons: [
        { label: 'Zrušiť' },
        {
          label: 'Uložiť', primary: true,
          onClick: () => app().change('Úprava osoby ' + tree.displayName(p), () => {
            const v = {};
            for (const k of Object.keys(inp)) v[k] = inp[k].value;
            tree.setNames(p, v);
            M.setPath(p, 'SEX', sex.get() || 'U');
            setEvent(p, 'BIRT', { DATE: birthDate.get(), PLAC: birthPlace.value });
            if (alive.get() === '0') {
              setEvent(p, 'DEAT', { DATE: deathDate.get(), PLAC: deathPlace.value, CAUS: deathCause.value }, true);
              setEvent(p, 'BURI', { DATE: buriDate.get(), PLAC: buriPlace.value });
            } else {
              M.kids(p, 'DEAT').concat(M.kids(p, 'BURI'), M.kids(p, 'CREM')).forEach((x) => M.remove(p, x));
            }
            tree.setContactEmail(p, email.value.trim());
            for (const r of rows) {
              if (r.removed) {
                if (r.node) M.remove(p, r.node);
                continue;
              }
              const tag = r.typeSel.value;
              const d = r.desc.value.trim(), dt = D.inputToGed(r.date.value), pl = r.place.value.trim();
              if (!r.node && !d && !dt && !pl) continue;
              const nd = r.node || M.insertChild(p, M.node(tag, '', [M.node('_UID', M.uuid())]));
              nd.tag = tag;
              if (M.VALUE_FACTS.has(tag) && tag !== 'EVEN') {
                nd.value = d;
              } else {
                M.setPath(nd, 'TYPE', d);
                if (nd.value !== 'Y') nd.value = '';
              }
              M.setPath(nd, 'DATE', dt);
              M.setPath(nd, 'PLAC', pl);
              if (!nd.value && !hasContent(nd)) nd.value = 'Y';
            }
            tree.setNotes(p, noteAreas.map((t) => t.value));
            tree.touch(p);
          }),
        },
      ],
    });
    if (focusSection === 'notes') setTimeout(() => (noteAreas[0] || addNote('')).focus(), 60);
    return dlg;
  }

  // ---------- Pridanie príbuzného ----------
  const KIND = {
    father: { title: 'Pridať otca', sex: 'M' },
    mother: { title: 'Pridať matku', sex: 'F' },
    partner: { title: 'Pridať partnera / manžela(ku)', sex: null },
    child: { title: 'Pridať dieťa', sex: null },
    brother: { title: 'Pridať brata', sex: 'M' },
    sister: { title: 'Pridať sestru', sex: 'F' },
  };

  function addRelative(p, kind, opts) {
    opts = opts || {};
    if (kind === 'son' || kind === 'daughter') {
      opts = Object.assign({ sex: kind === 'son' ? 'M' : 'F' }, opts);
      kind = 'child';
    }
    const tree = T();
    const K = KIND[kind];
    RK.UI.refreshPlaces();
    if (kind === 'father' && tree.father(p)) return toast('Táto osoba už má otca. Upraviť ho môžeš v sekcii Rodina.');
    if (kind === 'mother' && tree.mother(p)) return toast('Táto osoba už má matku. Upraviť ju môžeš v sekcii Rodina.');

    const pn = tree.names(p);
    const pSur = pn.surname;
    const fams = tree.fams(p);
    let famSel = null, pediSel = null, statusSel = null;
    const marrDate = dateField('Dátum sobáša', '');

    // Rodina pre dieťa
    if (kind === 'child') {
      const optsList = fams.map((f) => {
        const q = tree.partnerIn(f, p);
        return [f.xref, q ? `s osobou ${tree.displayName(q)}` : 'druhý rodič neznámy'];
      });
      optsList.push(['', 'iný / neznámy druhý rodič']);
      famSel = select(optsList, opts.family ? opts.family.xref : optsList[0][0]);
      pediSel = select(Object.entries(M.PEDI), '');
    }
    const childSurname = () => {
      const f = famSel && famSel.value ? tree.get(famSel.value) : null;
      const dad = f ? tree.husband(f) : tree.sex(p) === 'M' ? p : null;
      return dad ? tree.names(dad).surname : pn.married || pSur;
    };

    // Predvyplnené priezvisko
    let sex = K.sex || opts.sex || (kind === 'child' ? 'M' : tree.sex(p) === 'F' ? 'M' : tree.sex(p) === 'M' ? 'F' : 'U');
    const suggest = () => {
      switch (kind) {
        case 'father': return { surname: RK.UI.masculine(pSur) };
        case 'mother': {
          const dad = tree.father(p);
          return { surname: '', married: RK.UI.feminine(dad ? tree.names(dad).surname : pSur) };
        }
        case 'brother': return { surname: RK.UI.masculine(pSur) };
        case 'sister': return { surname: RK.UI.feminine(pSur) };
        case 'child': return { surname: sex === 'F' ? RK.UI.feminine(childSurname()) : RK.UI.masculine(childSurname()) };
        case 'partner':
          if (sex === 'F' && tree.sex(p) === 'M') return { surname: '', married: RK.UI.feminine(pSur) };
          return { surname: '' };
        default: return {};
      }
    };

    const given = textInput('', { autofocus: true });
    const surname = textInput('');
    const married = textInput('');
    const sexR = radios('nsex', kind === 'child' ? [['M', 'Chlapec'], ['F', 'Dievča']] : [['M', 'Muž'], ['F', 'Žena'], ['U', 'Neznáme']], sex);
    const birth = dateField('Dátum narodenia', '');
    const birthPlace = placeInput('');
    const dead = h('input', { type: 'checkbox' });
    const death = dateField('Dátum úmrtia', '');
    let last = {};
    const applySuggest = () => {
      // prepíšeme len to, čo používateľ ručne nezmenil
      const s = suggest();
      if (surname.value === (last.surname || '')) surname.value = s.surname || '';
      if (married.value === (last.married || '')) married.value = s.married || '';
      last = s;
    };
    applySuggest();
    sexR.onChange(() => { sex = sexR.get(); applySuggest(); });
    if (famSel) famSel.addEventListener('change', applySuggest);
    const deathWrap = h('div', { class: 'hidden' }, death.el);
    dead.addEventListener('change', () => deathWrap.classList.toggle('hidden', !dead.checked));

    const newForm = h('div', { class: 'form-grid' },
      field('Krstné meno', given), field('Priezvisko (rodné)', surname),
      field('Priezvisko po sobáši', married), K.sex ? h('div') : field(kind === 'child' ? 'Chlapec / dievča' : 'Pohlavie', sexR.el),
      birth.el, field('Miesto narodenia', birthPlace),
      h('div', { class: 'field' }, h('label', { style: { display: 'flex', gap: '6px', alignItems: 'center', cursor: 'pointer' } }, dead, 'Osoba už nežije')),
      deathWrap);

    const exclude = [p];
    const picker = personPicker({ exclude, placeholder: 'Vyhľadaj osobu, ktorá už je v strome…' });
    const existForm = h('div', { class: 'hidden' }, field('Existujúca osoba', picker.el));

    let mode = 'new';
    const seg = h('div', { class: 'seg' });
    const segBtn = (m, label) => {
      const b = h('button', { class: m === mode ? 'on' : '' }, label);
      b.addEventListener('click', () => {
        mode = m;
        seg.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
        newForm.classList.toggle('hidden', m !== 'new');
        existForm.classList.toggle('hidden', m !== 'existing');
      });
      return b;
    };
    seg.append(segBtn('new', 'Nová osoba'), segBtn('existing', 'Osoba už je v strome'));

    const extra = h('div', { class: 'form-grid', style: { marginTop: '14px' } });
    if (famSel) extra.append(field('Druhý rodič', famSel), field('Vzťah k rodičom', pediSel));
    if (kind === 'partner') {
      statusSel = select(Object.entries(M.STATUS), 'married');
      extra.append(field('Vzťah', statusSel), marrDate.el);
    }

    modal({
      title: `${K.title} – ${tree.displayName(p)}`,
      body: h('div', null, seg, newForm, existForm, extra),
      buttons: [
        { label: 'Zrušiť' },
        {
          label: 'Pridať', primary: true,
          onClick: () => {
            let existing = null;
            if (mode === 'existing') {
              existing = picker.get();
              if (!existing) { alert('Vyber osobu zo zoznamu.'); return false; }
            } else if (!given.value.trim() && !surname.value.trim()) {
              alert('Zadaj aspoň meno alebo priezvisko.');
              return false;
            }
            const names = { given: given.value, surname: surname.value, married: married.value, sex: K.sex || sexR.get() };
            let added;
            return app().change(`${K.title}`, () => {
              switch (kind) {
                case 'father': added = tree.addParent(p, 'M', existing, names); break;
                case 'mother': added = tree.addParent(p, 'F', existing, names); break;
                case 'partner': {
                  const r = tree.addPartner(p, existing, names, statusSel.value);
                  added = r.partner;
                  if (marrDate.get()) setEvent(r.family, 'MARR', { DATE: marrDate.get() }, true);
                  break;
                }
                case 'child':
                  added = tree.addChildTo(p, famSel.value ? tree.get(famSel.value) : null, existing, names, pediSel.value);
                  break;
                case 'brother': case 'sister': added = tree.addSibling(p, existing, names); break;
              }
              if (!existing) {
                setEvent(added, 'BIRT', { DATE: birth.get(), PLAC: birthPlace.value });
                if (dead.checked) setEvent(added, 'DEAT', { DATE: death.get() }, true);
              }
            }).then((ok) => {
              if (ok !== false && added) toast(`Pridané: ${tree.displayName(added)}`);
            });
          },
        },
      ],
    });
  }

  // ---------- Úprava vzťahu (rodiny) ----------
  function editFamily(f) {
    const tree = T();
    RK.UI.refreshPlaces();
    const hus = tree.husband(f), wif = tree.wife(f);
    const removed = new Set();
    const statusSel = select(Object.entries(M.STATUS), tree.familyStatus(f));
    const marr = dateField('Dátum sobáša', M.getPath(f, 'MARR.DATE'));
    const marrPlace = placeInput(M.getPath(f, 'MARR.PLAC'));
    const div = dateField('Dátum rozvodu', M.getPath(f, 'DIV.DATE'));
    const enga = dateField('Dátum zásnub', M.getPath(f, 'ENGA.DATE'));
    const marrBox = h('div', { class: 'form-grid' }, marr.el, field('Miesto sobáša', marrPlace));
    const divBox = h('div', { class: 'form-grid' }, div.el);
    const engaBox = h('div', { class: 'form-grid' }, enga.el);
    const sync = () => {
      const s = statusSel.value;
      marrBox.classList.toggle('hidden', !['married', 'divorced', 'separated', 'widowed'].includes(s));
      divBox.classList.toggle('hidden', s !== 'divorced');
      engaBox.classList.toggle('hidden', s !== 'engaged' && !M.kid(f, 'ENGA'));
    };
    statusSel.addEventListener('change', sync);
    sync();

    const partnerRow = (p, label) => {
      if (!p) return h('div', { class: 'mini muted' }, `${label}: neznámy`);
      const row = h('div', { class: 'mini', style: { cursor: 'default' } }, RK.UI.avatar(p, 32),
        h('div', { style: { flex: 1 } }, h('div', { class: 'nm' }, tree.displayName(p)), h('div', { class: 'meta' }, label)),
        h('button', { class: 'link danger', onclick: () => { removed.add(p); row.style.opacity = 0.35; row.querySelector('button').disabled = true; } }, 'odpojiť'));
      return row;
    };

    const kidRows = tree.childrenOfFamily(f).map((c) => {
      const ped = select(Object.entries(M.PEDI), tree.pedigree(c, f));
      const row = h('div', { class: 'mini', style: { cursor: 'default' } }, RK.UI.avatar(c, 30),
        h('div', { style: { flex: 1 } }, h('div', { class: 'nm' }, tree.displayName(c)), h('div', { class: 'meta' }, tree.lifeSpan(c))),
        h('div', { style: { width: '170px' } }, ped),
        h('button', { class: 'link danger', onclick: () => { removed.add(c); row.style.opacity = 0.35; } }, 'odobrať'));
      return { c, ped, row };
    });

    const first = hus || wif;
    modal({
      title: 'Upraviť vzťah',
      wide: true,
      body: h('div', null,
        h('div', { class: 'form-grid' },
          h('div', { class: 'full' }, partnerRow(hus, 'partner 1'), partnerRow(wif, 'partner 2')),
          field('Stav vzťahu', statusSel)),
        h('div', { class: 'fieldset' }, h('div', { class: 'legend' }, 'Udalosti'), marrBox, divBox, engaBox),
        h('div', { class: 'fieldset' }, h('div', { class: 'legend' }, 'Deti'),
          kidRows.length ? kidRows.map((k) => k.row) : h('div', { class: 'muted small' }, 'Bez detí.'),
          first ? h('button', { class: 'link', onclick: () => { closeAll(); addRelative(first, 'child', { family: f }); } }, '+ pridať dieťa') : null)),
      buttons: [
        {
          label: 'Zrušiť celý vzťah', danger: true, left: true,
          onClick: async () => {
            if (!(await RK.UI.confirmDialog('Zrušiť tento vzťah? Osoby ostanú v strome, len sa medzi nimi zruší väzba (aj väzba na deti).', 'Zrušiť vzťah', true))) return false;
            return app().change('Zrušenie vzťahu', () => {
              for (const c of tree.childrenOfFamily(f)) tree.removeChild(f, c);
              if (tree.get(f.xref)) for (const p of [hus, wif]) if (p && tree.get(f.xref)) tree.removeSpouse(f, p);
              if (tree.get(f.xref)) tree.removeRecord(f);
            });
          },
        },
        { label: 'Zrušiť' },
        {
          label: 'Uložiť', primary: true,
          onClick: () => app().change('Úprava vzťahu', () => {
            tree.setFamilyStatus(f, statusSel.value);
            if (M.kid(f, 'MARR')) setEvent(f, 'MARR', { DATE: marr.get(), PLAC: marrPlace.value }, true);
            if (M.kid(f, 'DIV')) setEvent(f, 'DIV', { DATE: div.get() }, true);
            if (M.kid(f, 'ENGA')) setEvent(f, 'ENGA', { DATE: enga.get() }, true);
            for (const k of kidRows) if (!removed.has(k.c)) tree.setPedigree(f, k.c, k.ped.value);
            tree.touch(f);
            for (const x of removed) {
              if (!tree.get(f.xref)) break;
              if (x === hus || x === wif) tree.removeSpouse(f, x);
              else tree.removeChild(f, x);
            }
          }),
        },
      ],
    });
  }

  const closeAll = () => RK.UI.closeAll();

  // ---------- Vymazanie osoby ----------
  async function deletePerson(p) {
    const tree = T();
    const ok = await RK.UI.confirmDialog(`Naozaj vymazať osobu ${tree.fullName(p)}? Zrušia sa aj jej väzby na rodičov, partnerov a deti. (Dá sa vrátiť tlačidlom Späť.)`, 'Vymazať', true);
    if (!ok) return;
    const next = tree.parents(p)[0] || tree.spouses(p).map((s) => s.partner).find(Boolean) || tree.children(p)[0] || null;
    await app().change('Vymazanie osoby', () => tree.deletePerson(p));
    const home = tree.get(tree.homeId);
    app().focus(next && tree.get(next.xref) ? next : home || tree.people[0]);
  }

  // ---------- Fotky ----------
  function pickFiles() {
    return new Promise((res) => {
      const i = h('input', { type: 'file', accept: 'image/*', multiple: true, style: { display: 'none' } });
      i.addEventListener('change', () => { res([...i.files]); i.remove(); });
      document.body.appendChild(i);
      i.click();
    });
  }

  /** Veľké fotky (napr. z mobilu) zmenší na rozumnú veľkosť; čo nevie načítať, nechá tak. */
  async function shrinkImage(file) {
    const MAX = 2400;
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((res, rej) => {
        const i = new Image();
        i.onload = () => res(i);
        i.onerror = rej;
        i.src = url;
      });
      const s = Math.min(1, MAX / Math.max(img.naturalWidth, img.naturalHeight));
      if (s === 1 && file.size < 2.5e6) return file;
      const c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * s);
      c.height = Math.round(img.naturalHeight * s);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.88));
      return blob ? new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' }) : file;
    } catch (e) {
      return file;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  /** Nahrá fotky do priečinka data/fotky a založí záznamy. Vráti zoznam nových záznamov. */
  async function uploadPhotos(files, person) {
    const tree = T();
    if (!files.length) return [];
    const created = [];
    const saved = [];
    let next = +tree.nextId('P').replace(/\D/g, '');
    toast(files.length > 1 ? `Nahrávam ${files.length} fotky…` : 'Nahrávam fotku…', 60000);
    for (const f of files) {
      const base = 'P' + next++;
      saved.push({ file: f, info: await RK.Storage.savePhoto(await shrinkImage(f), base) });
    }
    await app().change('Pridanie fotiek', () => {
      for (const s of saved) {
        const title = person ? tree.displayName(person) : s.file.name.replace(/\.[^.]+$/, '');
        const m = tree.addMedia(s.info.path, title, s.info.format);
        if (person) tree.linkMedia(person, m, null);
        created.push(m);
      }
    });
    toast(`Pridané fotky: ${created.length}`);
    return created;
  }

  async function addPhotos(p) {
    const files = await pickFiles();
    const created = await uploadPhotos(files, p);
    if (created.length === 1) photoDialog(created[0], p);
  }

  /** Detail fotky: označené osoby, výrez tváre, názov. tagPerson: rovno začne označovať túto osobu. */
  function photoDialog(m, tagPerson) {
    const tree = T();
    const titleIn = textInput(tree.mediaTitle(m));
    const stage = h('div', { class: 'photo-stage' });
    const inner = h('div', { style: { position: 'relative', display: 'inline-block', lineHeight: 0 } });
    const img = h('img', { alt: '' });
    inner.appendChild(img);
    stage.appendChild(inner);
    const side = h('div');
    let tagging = tagPerson || null;
    let drawing = null;

    RK.Storage.photoUrl(tree.mediaFile(m)).then((u) => {
      if (u) img.src = u;
      else stage.appendChild(h('div', { class: 'muted', style: { color: '#ccc', padding: '30px', lineHeight: 1.4 } }, 'Súbor fotky sa nenašiel: ' + tree.mediaFile(m)));
    });
    img.addEventListener('load', () => drawBoxes());

    const scale = () => (img.naturalWidth ? img.clientWidth / img.naturalWidth : 1);

    function drawBoxes() {
      inner.querySelectorAll('.box').forEach((b) => b.remove());
      const s = scale();
      for (const t of tree.peopleInMedia(m)) {
        if (!t.crop) continue;
        const [x, y, w, hh] = t.crop;
        inner.appendChild(h('div', { class: 'box', style: { left: x * s + 'px', top: y * s + 'px', width: w * s + 'px', height: hh * s + 'px' } },
          h('span', null, tree.displayName(t.person))));
      }
    }

    function renderSide() {
      clear(side);
      stage.classList.toggle('tagging', !!tagging);
      const people = tree.peopleInMedia(m);
      side.append(
        field('Názov / popis', titleIn),
        h('button', { class: 'link', onclick: () => app().change('Názov fotky', () => tree.setMediaTitle(m, titleIn.value)).then(() => toast('Uložené')) }, 'uložiť názov'),
        h('h4', { style: { margin: '14px 0 6px' } }, `Na fotke (${people.length})`));
      const list = h('div', { class: 'tag-list' });
      for (const t of people) {
        list.appendChild(h('div', { class: 'mini', style: { cursor: 'default', flexWrap: 'wrap' } },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }, onclick: () => { closeAll(); app().focus(t.person); } },
            RK.UI.avatar(t.person, 30), h('div', { class: 'nm' }, tree.displayName(t.person))),
          h('div', null,
            t.primary ? h('span', { class: 'muted small' }, 'profilová ') : h('button', { class: 'link', title: 'Použiť ako profilovú fotku', onclick: () => act('Profilová fotka', () => tree.setPrimaryPhoto(t.person, m)) }, 'profilová'),
            h('button', { class: 'link', title: 'Označiť tvár ťahaním myšou', onclick: () => { tagging = t.person; renderSide(); } }, 'tvár'),
            h('button', { class: 'link danger', title: 'Odobrať z fotky', onclick: () => act('Odobratie z fotky', () => tree.unlinkMedia(t.person, m)) }, '✕'))));
      }
      side.appendChild(list);
      if (tagging) {
        side.appendChild(h('div', { class: 'fieldset' },
          h('div', null, h('b', null, tree.displayName(tagging)), ': ťahaním myšou na fotke označ tvár.'),
          h('div', { style: { marginTop: '8px', display: 'flex', gap: '6px' } },
            h('button', { onclick: () => act('Prepojenie fotky', () => tree.linkMedia(tagging, m, null)).then(() => { tagging = null; renderSide(); }) }, 'Bez výrezu'),
            h('button', { onclick: () => { tagging = null; renderSide(); } }, 'Zrušiť'))));
      } else {
        const picker = personPicker({ placeholder: 'Pridať osobu na fotku…', onChange: (p) => { if (p) { tagging = p; renderSide(); } } });
        side.appendChild(h('div', { style: { marginTop: '10px' } }, picker.el));
      }
    }

    async function act(label, fn) {
      await app().change(label, fn);
      drawBoxes();
      renderSide();
    }

    // Kreslenie výrezu tváre
    inner.addEventListener('pointerdown', (e) => {
      if (!tagging || !img.naturalWidth) return;
      e.preventDefault();
      const r = inner.getBoundingClientRect();
      drawing = { x0: e.clientX - r.left, y0: e.clientY - r.top, el: h('div', { class: 'box sel' }) };
      inner.appendChild(drawing.el);
      document.addEventListener('pointermove', onDrawMove);
      document.addEventListener('pointerup', onDrawEnd);
    });
    function onDrawMove(e) {
      if (!drawing) return;
      const r = inner.getBoundingClientRect();
      const x = Math.max(0, Math.min(e.clientX - r.left, r.width)), y = Math.max(0, Math.min(e.clientY - r.top, r.height));
      Object.assign(drawing, { x1: x, y1: y });
      Object.assign(drawing.el.style, {
        left: Math.min(drawing.x0, x) + 'px', top: Math.min(drawing.y0, y) + 'px',
        width: Math.abs(x - drawing.x0) + 'px', height: Math.abs(y - drawing.y0) + 'px',
      });
    }
    function onDrawEnd(e) {
      document.removeEventListener('pointermove', onDrawMove);
      document.removeEventListener('pointerup', onDrawEnd);
      if (!drawing) return;
      onDrawMove(e);
      const d = drawing;
      drawing = null;
      d.el.remove();
      if (d.x1 == null || Math.abs(d.x1 - d.x0) < 8 || Math.abs(d.y1 - d.y0) < 8) return;
      const s = scale();
      const crop = [Math.min(d.x0, d.x1) / s, Math.min(d.y0, d.y1) / s, Math.abs(d.x1 - d.x0) / s, Math.abs(d.y1 - d.y0) / s];
      const who = tagging;
      tagging = null;
      act('Označenie tváre', () => tree.linkMedia(who, m, crop));
    }

    renderSide();
    modal({
      title: tree.mediaTitle(m) || 'Fotka',
      wide: true,
      body: h('div', { class: 'photo-view' }, stage, side),
      onClose: () => app().renderAll(),
      buttons: [
        {
          label: 'Vymazať fotku', danger: true, left: true,
          onClick: async () => {
            if (!(await RK.UI.confirmDialog('Odstrániť fotku z rodokmeňa? (Súbor ostane v priečinku data/fotky.)', 'Odstrániť', true))) return false;
            return app().change('Vymazanie fotky', () => tree.deleteMedia(m));
          },
        },
        { label: 'Zavrieť' },
      ],
    });
  }

  RK.Editors = { editPerson, addRelative, editFamily, deletePerson, addPhotos, uploadPhotos, pickFiles, photoDialog, setEvent };
})();
