/* Rodokmeňovec – práca so súbormi cez File System Access API (Chrome, Edge).
   Dáta: <priečinok>/data/rodokmen.ged, fotky v data/fotky, zálohy v data/zalohy. */
(function () {
  'use strict';
  const RK = (globalThis.RK = globalThis.RK || {});

  const DATA_FILE = 'rodokmen.ged';
  const BACKUP_EVERY_MS = 60 * 60 * 1000;
  const BACKUP_KEEP = 60;

  // ---------- IndexedDB: zapamätanie vybraného priečinka ----------
  function idb() {
    return new Promise((res, rej) => {
      const r = indexedDB.open('rodokmenovec', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }

  async function kvGet(key) {
    const db = await idb();
    return new Promise((res) => {
      const q = db.transaction('kv').objectStore('kv').get(key);
      q.onsuccess = () => res(q.result || null);
      q.onerror = () => res(null);
    });
  }

  async function kvSet(key, val) {
    const db = await idb();
    return new Promise((res) => {
      const tx = db.transaction('kv', 'readwrite');
      tx.objectStore('kv').put(val, key);
      tx.oncomplete = () => res();
      tx.onerror = () => res();
    });
  }

  function stamp() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
  }

  async function exists(dir, name, kind) {
    try {
      if (kind === 'dir') await dir.getDirectoryHandle(name);
      else await dir.getFileHandle(name);
      return true;
    } catch (e) {
      return false;
    }
  }

  const Storage = {
    kind: 'local',
    supported: typeof window !== 'undefined' && 'showDirectoryPicker' in window,
    root: null,
    dataDir: null,
    known: 0, // lastModified súboru pri poslednom čítaní/zápise
    lastBackup: 0,
    urls: new Map(),

    async savedHandle() {
      try {
        return await kvGet('root');
      } catch (e) {
        return null;
      }
    },

    async pick() {
      const h = await window.showDirectoryPicker({ id: 'rodokmen', mode: 'readwrite' });
      await kvSet('root', h);
      return h;
    },

    async permit(handle) {
      const opts = { mode: 'readwrite' };
      if ((await handle.queryPermission(opts)) === 'granted') return true;
      return (await handle.requestPermission(opts)) === 'granted';
    },

    /** Nájde dátový priečinok. Vráti false, ak v ňom rodokmeň nie je. */
    async attach(handle) {
      this.root = handle;
      this.urls.forEach((u) => URL.revokeObjectURL(u));
      this.urls.clear();
      if (await exists(handle, DATA_FILE)) this.dataDir = handle;
      else if ((await exists(handle, 'data', 'dir')) && (await exists(await handle.getDirectoryHandle('data'), DATA_FILE)))
        this.dataDir = await handle.getDirectoryHandle('data');
      else {
        this.dataDir = null;
        return false;
      }
      return true;
    },

    /** Vytvorí nový prázdny rodokmeň v podpriečinku data. */
    async createNew(text) {
      this.dataDir = await this.root.getDirectoryHandle('data', { create: true });
      await this.dataDir.getDirectoryHandle('fotky', { create: true });
      await this.dataDir.getDirectoryHandle('zalohy', { create: true });
      const fh = await this.dataDir.getFileHandle(DATA_FILE, { create: true });
      const w = await fh.createWritable();
      await w.write(text);
      await w.close();
    },

    async read() {
      const fh = await this.dataDir.getFileHandle(DATA_FILE);
      const f = await fh.getFile();
      this.known = f.lastModified;
      return f.text();
    },

    async diskModified() {
      const fh = await this.dataDir.getFileHandle(DATA_FILE);
      return (await fh.getFile()).lastModified;
    },

    /** Zmenil súbor niekto iný (napr. druhý počítač cez Google Disk)? */
    async changedOnDisk() {
      return (await this.diskModified()) !== this.known;
    },

    async backup(force) {
      if (!force && Date.now() - this.lastBackup < BACKUP_EVERY_MS) return;
      const fh = await this.dataDir.getFileHandle(DATA_FILE);
      const cur = await (await fh.getFile()).text();
      const dir = await this.dataDir.getDirectoryHandle('zalohy', { create: true });
      const bh = await dir.getFileHandle(`rodokmen_${stamp()}.ged`, { create: true });
      const w = await bh.createWritable();
      await w.write(cur);
      await w.close();
      this.lastBackup = Date.now();
      // staré zálohy upraceme
      const names = [];
      for await (const [name, h] of dir.entries()) if (h.kind === 'file' && /^rodokmen_.*\.ged$/.test(name)) names.push(name);
      names.sort();
      for (const n of names.slice(0, Math.max(0, names.length - BACKUP_KEEP))) await dir.removeEntry(n);
    },

    /** Uloží ľubovoľný text ako samostatnú zálohu (napr. pri konflikte). */
    async saveBackupText(text, label) {
      const dir = await this.dataDir.getDirectoryHandle('zalohy', { create: true });
      const bh = await dir.getFileHandle(`rodokmen_${label}_${stamp()}.ged`, { create: true });
      const w = await bh.createWritable();
      await w.write(text);
      await w.close();
    },

    /** Zapíše rodokmeň. Ak sa súbor medzitým zmenil inde, vyhodí chybu s conflict=true (pokiaľ nie je force). */
    async write(text, force) {
      if (!force && (await this.changedOnDisk())) {
        const e = new Error('Súbor bol medzitým zmenený inde.');
        e.conflict = true;
        throw e;
      }
      try {
        await this.backup(false);
      } catch (e) {
        console.warn('Záloha sa nepodarila', e); // uloženie samotné je dôležitejšie
      }
      const fh = await this.dataDir.getFileHandle(DATA_FILE);
      const w = await fh.createWritable();
      await w.write(text);
      await w.close();
      this.known = await this.diskModified();
    },

    async fileHandle(relPath, create) {
      const parts = relPath.split('/').filter(Boolean);
      let dir = this.dataDir;
      for (const p of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(p, { create: !!create });
      return dir.getFileHandle(parts[parts.length - 1], { create: !!create });
    },

    /** Object URL fotky podľa relatívnej cesty (fotky/P1.jpg). */
    async photoUrl(relPath) {
      if (!relPath) return null;
      if (this.urls.has(relPath)) return this.urls.get(relPath);
      try {
        const f = await (await this.fileHandle(relPath)).getFile();
        const u = URL.createObjectURL(f);
        this.urls.set(relPath, u);
        return u;
      } catch (e) {
        return null;
      }
    },

    /** Uloží nahratú fotku do data/fotky. Vráti relatívnu cestu. */
    async savePhoto(file, baseName) {
      const ext = (file.name.match(/\.([a-z0-9]+)$/i) || [, 'jpg'])[1].toLowerCase();
      const rel = `fotky/${baseName}.${ext}`;
      const fh = await this.fileHandle(rel, true);
      const w = await fh.createWritable();
      await w.write(file);
      await w.close();
      return { path: rel, format: ext === 'jpeg' ? 'jpg' : ext };
    },
  };

  RK.LocalStore = Storage;
  RK.Storage = Storage; // aktívne úložisko; pri prihlásení cez Google sa prepne na RK.DriveStore
})();
