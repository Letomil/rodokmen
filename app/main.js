/* Rodokmeňovec – štart aplikácie, stav, ukladanie, späť, synchronizácia so súborom. */
(function () {
  'use strict';
  const RK = (globalThis.RK = globalThis.RK || {});
  const { h, clear, toast, modal } = RK.UI;
  const St = () => RK.Storage; // aktívne úložisko (priečinok na počítači alebo Google Disk)

  const POLL_MS = 15000;
  const UNDO_MAX = 40;

  const ls = {
    get(k) { try { return localStorage.getItem('rk.' + k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem('rk.' + k, v); } catch (e) { /* súkromné okno */ } },
    del(k) { try { localStorage.removeItem('rk.' + k); } catch (e) { /* súkromné okno */ } },
  };

  function status(text, err) {
    const el = document.getElementById('save-status');
    el.textContent = text;
    el.classList.toggle('err', !!err);
  }

  const App = (RK.App = {
    tree: null,
    focusId: null,
    view: 'tree',
    undoStack: [],
    saving: false,
    saveAgain: false,
    dirty: false,

    /** Vykoná zmenu stromu, prekreslí a uloží. Pri chybe vráti stav späť. Vráti true/false. */
    async change(label, fn) {
      const before = this.tree.toText();
      try {
        await fn();
      } catch (e) {
        console.error(e);
        this.tree.load(before);
        alert(e.message || String(e));
        this.renderAll();
        return false;
      }
      this.tree.reindex();
      this.undoStack.push({ label, text: before });
      if (this.undoStack.length > UNDO_MAX) this.undoStack.shift();
      this.dirty = true;
      this.renderAll();
      await this.save();
      return true;
    },

    async undo() {
      const u = this.undoStack.pop();
      if (!u) return;
      this.tree.load(u.text);
      this.dirty = true;
      this.renderAll();
      toast('Vrátené: ' + u.label);
      await this.save();
    },

    async save(force) {
      if (this.saving) { this.saveAgain = true; return; }
      this.saving = true;
      status('Ukladám…');
      try {
        if (force) await St().backup(true);
        await St().write(this.tree.toText(), force);
        this.dirty = false;
        const d = new Date();
        status(`Uložené ✓ ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`);
      } catch (e) {
        this.saving = false;
        if (e.conflict) {
          status('Konflikt!', true);
          return this.resolveConflict();
        }
        if (e.auth) {
          status('Neuložené – prihlás sa', true);
          return this.reauth(() => this.save(force));
        }
        console.error(e);
        status('Neuložené!', true);
        alert('Uloženie zlyhalo: ' + (e.message || e) + '\nSkontroluj pripojenie / či je priečinok dostupný. Zmena ostáva v aplikácii – skús znova cez ☰ → Uložiť znova.');
      } finally {
        this.saving = false;
      }
      if (this.saveAgain) {
        this.saveAgain = false;
        await this.save();
      }
    },

    /** Prístup do Google Disku po čase vyprší – prihlásenie musí potvrdiť kliknutie. */
    reauth(then) {
      if (document.getElementById('reauth')) return Promise.resolve();
      return new Promise((res) => {
        const dlg = modal({
          title: 'Prihlás sa znova',
          dismissable: false,
          body: h('p', { id: 'reauth' }, 'Prístup ku Google Disku po hodine vyprší. Prihlás sa znova – rozpracované zmeny sa potom uložia.'),
          buttons: [{
            label: 'Prihlásiť sa cez Google', primary: true,
            onClick: async () => {
              await RK.DriveStore.signIn();
              dlg.close();
              RK.UI.clearImageCaches();
              this.renderAll();
              if (then) await then();
              res();
              return false;
            },
          }],
        });
      });
    },

    resolveConflict() {
      const mine = this.tree.toText();
      return new Promise((res) => {
        modal({
          title: 'Rodokmeň sa medzitým zmenil',
          dismissable: false,
          body: h('div', null,
            h('p', null, 'Súbor rodokmeňa bol medzitým upravený inde (napríklad na druhom počítači alebo v mobile).'),
            h('p', null, 'Tvoja verzia sa v každom prípade uloží aj do priečinka ', h('b', null, 'data/zalohy'), ', takže sa nič nestratí.')),
          buttons: [
            {
              label: 'Načítať novšiu verziu', primary: true,
              onClick: async () => {
                await St().saveBackupText(mine, 'moja-verzia');
                await this.reload(true);
                toast('Načítaná novšia verzia. Tvoje posledné zmeny sú v zálohe – zopakuj ich, prosím.', 6000);
                res();
              },
            },
            {
              label: 'Prepísať mojou verziou',
              onClick: async () => {
                await St().saveBackupText(mine, 'moja-verzia');
                await this.save(true);
                res();
              },
            },
          ],
        });
      });
    },

    async reload(silent) {
      const text = await St().read();
      this.tree.load(text);
      this.undoStack = [];
      this.dirty = false;
      RK.UI.clearImageCaches();
      if (!this.tree.get(this.focusId)) this.focusId = this.tree.homeId;
      this.renderAll();
      status('Načítané ✓');
      if (!silent) toast('Rodokmeň znova načítaný.');
    },

    async poll() {
      if (!this.tree || this.saving || this.dirty || document.hidden || document.querySelector('.modal-back')) return;
      if (St().kind === 'drive' && !St().signedIn) return this.reauth(() => this.reload(true));
      try {
        if (await St().changedOnDisk()) {
          await this.reload(true);
          toast('Rodokmeň bol aktualizovaný – načítané zmeny z iného zariadenia.', 5000);
        }
      } catch (e) { /* úložisko je dočasne nedostupné */ }
    },

    focus(p) {
      if (!p) return;
      this.focusId = p.xref;
      ls.set('focus', p.xref);
      if (this.view === 'tree') {
        RK.TreeView.render();
        RK.Profile.render();
      }
    },

    setHome(p) {
      this.tree.homeOverride = p.xref;
      ls.set('home', p.xref);
      this.renderAll();
      toast(`Domovská osoba v tomto prehliadači: ${this.tree.displayName(p)}`);
    },

    show(view) {
      this.view = view;
      document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
      document.querySelectorAll('.view').forEach((v) => v.classList.toggle('hidden', v.id !== 'view-' + view));
      if (view !== 'tree') RK.Profile.close();
      this.renderView(true);
    },

    renderView(recenter) {
      switch (this.view) {
        case 'tree': RK.TreeView.render(recenter); RK.Profile.render(); break;
        case 'people': RK.Views.renderPeople(); break;
        case 'photos': RK.Views.renderPhotos(); break;
        case 'stats': RK.Views.renderStats(); break;
        case 'relation': RK.Views.renderRelation(); break;
      }
    },

    renderAll() {
      if (!this.tree.get(this.focusId)) this.focusId = this.tree.homeId;
      document.getElementById('btn-undo').disabled = !this.undoStack.length;
      document.getElementById('btn-undo').title = this.undoStack.length ? 'Vrátiť: ' + this.undoStack[this.undoStack.length - 1].label : 'Nie je čo vrátiť';
      this.renderView(true);
    },
  });

  // ---------- Štart ----------
  function emptyTreeText() {
    const t = new RK.Tree(RK.Gedcom.parse(''));
    t.root.children.push(RK.Gedcom.makeHeader());
    const p = t.createPerson({ given: 'Ja', surname: '', sex: 'U' });
    t.homeId = p.xref;
    return t.toText();
  }

  const welcomeMsg = (t) => { document.getElementById('welcome-msg').textContent = t; };

  /** Spoločné dokončenie otvorenia – úložisko je pripravené. */
  async function start() {
    App.tree = RK.Tree.fromText(await St().read());
    App.tree.homeOverride = ls.get('home');
    const last = ls.get('focus');
    App.focusId = App.tree.get(last) ? last : App.tree.homeId;
    document.getElementById('welcome').classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');
    document.body.classList.toggle('mode-drive', St().kind === 'drive');
    status('Načítané ✓');
    App.show('tree');
    setInterval(() => App.poll(), POLL_MS);
    window.addEventListener('focus', () => App.poll());
    document.addEventListener('visibilitychange', () => App.poll());
  }

  // --- Priečinok na počítači ---
  async function openFolder(handle) {
    const S = RK.LocalStore;
    RK.Storage = S;
    welcomeMsg('Načítavam…');
    if (!(await S.permit(handle))) {
      welcomeMsg('Bez povolenia na prístup k priečinku to nepôjde. Skús znova.');
      return;
    }
    if (!(await S.attach(handle))) {
      welcomeMsg('');
      const actions = clear(document.getElementById('welcome-actions'));
      actions.append(
        h('p', null, `V priečinku „${handle.name}“ sa nenašiel rodokmeň (data/rodokmen.ged). Vyber priečinok `, h('b', null, 'Rodokmen'), ' – ten, v ktorom je súbor Rodokmen.html.'),
        h('button', { class: 'primary', onclick: pickFolder }, 'Vybrať iný priečinok'),
        h('button', { onclick: async () => { await S.createNew(emptyTreeText()); openFolder(handle); } }, 'Založiť tu nový prázdny rodokmeň'));
      return;
    }
    try {
      ls.set('mode', 'local');
      await start();
    } catch (e) {
      console.error(e);
      welcomeMsg('Súbor rodokmeňa sa nepodarilo prečítať: ' + e.message);
    }
  }

  async function pickFolder() {
    try {
      openFolder(await RK.LocalStore.pick());
    } catch (e) {
      if (e.name !== 'AbortError') welcomeMsg('Chyba: ' + e.message);
    }
  }

  // --- Google Disk ---
  async function openDrive() {
    const D = RK.DriveStore;
    RK.Storage = D;
    try {
      welcomeMsg('Prihlasujem…');
      await D.signIn();
      welcomeMsg('Hľadám rodokmeň na Google Disku…');
      const saved = ls.get('driveFile');
      if (saved) {
        try {
          await D.attach(saved);
          ls.set('mode', 'drive');
          return await start();
        } catch (e) {
          ls.del('driveFile'); // súbor už neexistuje alebo k nemu nie je prístup
        }
      }
      const trees = await D.findTrees();
      if (!trees.length) {
        welcomeMsg('Na tvojom Google Disku sa nenašiel súbor rodokmen.ged. Skontroluj, či je priečinok Rodokmen nahratý alebo s tebou zdieľaný.');
        return;
      }
      const choose = async (f) => {
        welcomeMsg('Načítavam…');
        await D.attach(f.id);
        ls.set('driveFile', f.id);
        ls.set('mode', 'drive');
        await start();
      };
      if (trees.length === 1) return await choose(trees[0]);
      welcomeMsg('');
      const actions = clear(document.getElementById('welcome-actions'));
      actions.appendChild(h('p', null, 'Našlo sa viac rodokmeňov. Ktorý otvoriť?'));
      for (const f of trees) {
        actions.appendChild(h('button', { onclick: () => choose(f).catch((e) => welcomeMsg('Chyba: ' + e.message)) },
          h('div', null, f.path || 'rodokmen.ged'),
          h('div', { class: 'muted small' }, [f.owner && 'vlastník ' + f.owner, f.modifiedTime && 'zmenený ' + new Date(f.modifiedTime).toLocaleString('sk')].filter(Boolean).join(' · '))));
      }
    } catch (e) {
      console.error(e);
      welcomeMsg(e.message || String(e));
    }
  }

  async function welcome() {
    const actions = document.getElementById('welcome-actions');
    const driveOk = RK.DriveStore.available();
    const localOk = RK.LocalStore.supported;
    const preferLocal = ls.get('mode') === 'local';
    if (driveOk) {
      actions.appendChild(h('button', { class: preferLocal ? '' : 'primary', onclick: openDrive }, 'Prihlásiť sa cez Google'));
    }
    if (localOk) {
      const saved = await RK.LocalStore.savedHandle();
      if (saved) actions.appendChild(h('button', { class: !driveOk || preferLocal ? 'primary' : '', onclick: () => openFolder(saved) }, `Otvoriť priečinok na počítači („${saved.name}“)`));
      actions.appendChild(h('button', { class: !driveOk && !saved ? 'primary' : '', onclick: pickFolder }, saved ? 'Vybrať iný priečinok…' : 'Otvoriť priečinok na počítači…'));
    }
    if (!driveOk && !localOk) {
      actions.appendChild(h('p', null, 'Tento prehliadač nevie pracovať s priečinkom. Na počítači otvor ', h('b', null, 'Rodokmen.html'), ' v Google Chrome alebo Microsoft Edge; v mobile použi webovú adresu aplikácie.'));
      return;
    }
    if (driveOk) welcomeMsg('Prihlás sa Google účtom, ktorý má prístup k priečinku Rodokmen na Google Disku.');
    else welcomeMsg('Vyber priečinok „Rodokmen“ – ten, v ktorom je súbor Rodokmen.html. Prehliadač sa spýta na povolenie upravovať súbory – potvrď ho.');
  }

  function help() {
    modal({
      title: 'Pomoc',
      body: h('div', null,
        h('p', null, h('b', null, 'Strom: '), 'kliknutím na osobu ju presunieš do stredu, ďalším kliknutím na ňu otvoríš profil (v mobile). Plochu ťaháš prstom alebo myšou, približuješ kolieskom alebo dvoma prstami.'),
        h('p', null, h('b', null, 'Pridávanie: '), 'v profile „+ Pridať“ – otec, matka, partner, dieťa, súrodenci. Pri každom môžeš vybrať aj osobu, ktorá už v strome je.'),
        h('p', null, h('b', null, 'Dátumy: '), 'píš ako zvykneš – 8.6.1964, jún 1964, 1964, okolo 1938, pred 1900, medzi 1900 a 1910.'),
        h('p', null, h('b', null, 'Fotky z mobilu: '), 'v profile ⋯ → Pridať fotky – mobil ponúkne fotoaparát alebo galériu. Veľké fotky sa pred nahratím zmenšia.'),
        h('p', null, h('b', null, 'Ukladanie: '), 'každá zmena sa uloží hneď do data/rodokmen.ged. Raz za hodinu práce sa robí záloha do data/zalohy. „Späť“ vráti poslednú zmenu.'),
        h('p', null, h('b', null, 'Viac zariadení: '), 'aplikácia každých 15 sekúnd zisťuje, či súbor nezmenil niekto iný, a zmeny načíta. Ak by ste upravovali naraz, ponúkne, čo s tým.'),
        h('p', null, h('b', null, 'Formát: '), 'rodokmeň je v štandardnom formáte GEDCOM 5.5.1 – otvorí ho takmer každý genealogický program.')),
      buttons: [{ label: 'Zavrieť', primary: true }],
    });
  }

  function exportGedcom() {
    const blob = new Blob([App.tree.toText()], { type: 'text/plain;charset=utf-8' });
    const a = h('a', { href: URL.createObjectURL(blob), download: 'rodokmen.ged' });
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  function wire() {
    RK.TreeView.init();
    document.querySelectorAll('#tabs button').forEach((b) => (b.onclick = () => App.show(b.dataset.view)));
    document.getElementById('btn-undo').onclick = () => App.undo();
    const search = document.getElementById('search');
    RK.UI.attachSearch(search, document.getElementById('search-results'), (p) => {
      search.value = '';
      search.blur();
      App.show('tree');
      App.focus(p);
    });
    const menu = document.getElementById('main-menu');
    document.getElementById('btn-menu').onclick = (e) => { e.stopPropagation(); menu.classList.toggle('hidden'); };
    document.addEventListener('click', () => menu.classList.add('hidden'));
    menu.querySelectorAll('button').forEach((b) => (b.onclick = () => {
      menu.classList.add('hidden');
      switch (b.dataset.act) {
        case 'home': App.show('tree'); App.focus(App.tree.get(App.tree.homeId)); break;
        case 'save': App.dirty = true; App.save(); break;
        case 'export': exportGedcom(); break;
        case 'print': App.show('tree'); setTimeout(() => window.print(), 100); break;
        case 'reload': App.reload(); break;
        case 'switch': ls.del('driveFile'); ls.del('mode'); location.reload(); break;
        case 'help': help(); break;
      }
    }));
    document.addEventListener('keydown', (e) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !typing && App.tree && !document.querySelector('.modal-back')) {
        e.preventDefault();
        App.undo();
      }
    });
    window.addEventListener('beforeunload', (e) => {
      if (App.saving || App.dirty) { e.preventDefault(); e.returnValue = ''; }
    });
  }

  RK.Boot = { openDrive, openFolder }; // pre testy a ladenie
  wire();
  welcome();
})();
