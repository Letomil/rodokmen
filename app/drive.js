/* Rodokmeňovec – ukladanie priamo na Google Disk (prihlásenie Google účtom).
   Rovnaké rozhranie ako RK.LocalStore: read, write, changedOnDisk, backup, saveBackupText, photoUrl, savePhoto. */
(function () {
  'use strict';
  const RK = (globalThis.RK = globalThis.RK || {});

  const API = 'https://www.googleapis.com/drive/v3';
  const UP = 'https://www.googleapis.com/upload/drive/v3';
  const SCOPE = 'https://www.googleapis.com/auth/drive';
  const ALL = 'supportsAllDrives=true';
  const FOLDER = 'application/vnd.google-apps.folder';
  const BACKUP_EVERY_MS = 60 * 60 * 1000;
  const BACKUP_KEEP = 60;
  const PARALLEL_DOWNLOADS = 4;

  function stamp() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
  }

  function authError() {
    const e = new Error('Prihlásenie do Google vypršalo.');
    e.auth = true;
    return e;
  }

  const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");

  // jednoduchý limit súbežných sťahovaní (mobilné dáta)
  let running = 0;
  const waiting = [];
  async function limited(fn) {
    if (running >= PARALLEL_DOWNLOADS) await new Promise((r) => waiting.push(r));
    running++;
    try {
      return await fn();
    } finally {
      running--;
      if (waiting.length) waiting.shift()();
    }
  }

  let gisPromise = null;
  function loadGis() {
    if (!gisPromise) {
      gisPromise = new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = 'https://accounts.google.com/gsi/client';
        s.onload = res;
        s.onerror = () => { gisPromise = null; rej(new Error('Nepodarilo sa načítať prihlásenie Google (si online?).')); };
        document.head.appendChild(s);
      });
    }
    return gisPromise;
  }

  const Drive = {
    kind: 'drive',
    token: null,
    expires: 0,
    fileId: null,
    dataId: null,
    folders: {},
    known: null,
    lastBackup: 0,
    urls: new Map(),
    photoIndex: null,

    available() {
      return !!(RK.Config && RK.Config.googleClientId) && /^https?:$/.test(location.protocol);
    },

    get signedIn() {
      return !!this.token && Date.now() < this.expires;
    },

    /** Prihlásenie (musí sa volať z kliknutia – otvára okno Google). */
    async signIn() {
      await loadGis();
      return new Promise((res, rej) => {
        const client = google.accounts.oauth2.initTokenClient({
          client_id: RK.Config.googleClientId,
          scope: SCOPE,
          callback: (r) => {
            if (r.error) return rej(new Error('Prihlásenie zlyhalo: ' + r.error));
            this.token = r.access_token;
            this.expires = Date.now() + (Number(r.expires_in || 3600) - 60) * 1000;
            res();
          },
          error_callback: (e) => rej(new Error(e && e.type === 'popup_closed' ? 'Okno prihlásenia bolo zatvorené.' : 'Prihlásenie zlyhalo: ' + ((e && (e.message || e.type)) || e))),
        });
        client.requestAccessToken({ prompt: '' });
      });
    },

    async api(url, opts) {
      if (!this.signedIn) throw authError();
      opts = opts || {};
      const r = await fetch(url, Object.assign({}, opts, { headers: Object.assign({}, opts.headers, { Authorization: 'Bearer ' + this.token }) }));
      if (r.status === 401) {
        this.token = null;
        throw authError();
      }
      if (!r.ok) {
        let msg = r.status + '';
        try { msg += ' ' + ((await r.json()).error || {}).message; } catch (e) { /* bez detailu */ }
        throw new Error('Google Disk: ' + msg);
      }
      return r;
    },

    async json(url, opts) {
      return (await this.api(url, opts)).json();
    },

    async list(q, fields) {
      const out = [];
      let page = '';
      do {
        const r = await this.json(`${API}/files?q=${encodeURIComponent(q)}&fields=nextPageToken,files(${fields})&pageSize=1000&includeItemsFromAllDrives=true&${ALL}${page ? '&pageToken=' + page : ''}`);
        out.push(...r.files);
        page = r.nextPageToken;
      } while (page);
      return out;
    },

    /** Všetky súbory rodokmen.ged, ku ktorým má prihlásený prístup (aj zdieľané). */
    async findTrees() {
      const files = await this.list("name='rodokmen.ged' and trashed=false", 'id,name,parents,modifiedTime,owners(displayName)');
      for (const f of files) {
        const names = [];
        let parent = f.parents && f.parents[0];
        for (let i = 0; i < 3 && parent; i++) {
          try {
            const m = await this.json(`${API}/files/${parent}?fields=name,parents&${ALL}`);
            names.unshift(m.name);
            parent = m.parents && m.parents[0];
          } catch (e) {
            break;
          }
        }
        f.path = names.join(' / ');
        f.owner = f.owners && f.owners[0] ? f.owners[0].displayName : '';
      }
      return files;
    },

    async attach(fileId) {
      const meta = await this.json(`${API}/files/${fileId}?fields=id,parents,trashed&${ALL}`);
      if (meta.trashed) throw new Error('Súbor rodokmeňa je v koši.');
      this.fileId = fileId;
      this.dataId = meta.parents[0];
      this.folders = {};
      for (const f of await this.list(`'${this.dataId}' in parents and mimeType='${FOLDER}' and trashed=false`, 'id,name')) this.folders[f.name] = f.id;
      for (const name of ['fotky', 'zalohy']) {
        if (!this.folders[name]) {
          const r = await this.json(`${API}/files?fields=id&${ALL}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, mimeType: FOLDER, parents: [this.dataId] }),
          });
          this.folders[name] = r.id;
        }
      }
      this.photoIndex = null;
      this.urls.forEach((u) => URL.revokeObjectURL(u));
      this.urls.clear();
      return true;
    },

    async version() {
      return (await this.json(`${API}/files/${this.fileId}?fields=version&${ALL}`)).version;
    },

    async read() {
      const v = await this.version();
      const text = await (await this.api(`${API}/files/${this.fileId}?alt=media&${ALL}`)).text();
      this.known = v;
      return text;
    },

    async changedOnDisk() {
      return (await this.version()) !== this.known;
    },

    async createFile(name, parent, blob, mime) {
      const b = 'rk' + Math.random().toString(36).slice(2);
      const body = new Blob([
        `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name, parents: [parent] })}\r\n`,
        `--${b}\r\nContent-Type: ${mime}\r\n\r\n`, blob, `\r\n--${b}--`,
      ]);
      return this.json(`${UP}/files?uploadType=multipart&fields=id,name,md5Checksum&${ALL}`, {
        method: 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + b }, body,
      });
    },

    async saveBackupText(text, label) {
      await this.createFile(`rodokmen_${label ? label + '_' : ''}${stamp()}.ged`, this.folders.zalohy, new Blob([text]), 'text/plain');
    },

    async backup(force) {
      if (!force && Date.now() - this.lastBackup < BACKUP_EVERY_MS) return;
      const cur = await (await this.api(`${API}/files/${this.fileId}?alt=media&${ALL}`)).text();
      await this.saveBackupText(cur, '');
      this.lastBackup = Date.now();
      try {
        const old = (await this.list(`'${this.folders.zalohy}' in parents and trashed=false`, 'id,name'))
          .filter((f) => /^rodokmen_.*\.ged$/.test(f.name)).sort((a, b) => a.name.localeCompare(b.name));
        // staré zálohy len presunieme do koša (ostanú 30 dní obnoviteľné)
        for (const f of old.slice(0, Math.max(0, old.length - BACKUP_KEEP))) {
          await this.api(`${API}/files/${f.id}?${ALL}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trashed: true }) });
        }
      } catch (e) { /* zálohy cudzieho vlastníka nemusíme vedieť upratať */ }
    },

    async write(text, force) {
      if (!force && (await this.changedOnDisk())) {
        const e = new Error('Súbor bol medzitým zmenený inde.');
        e.conflict = true;
        throw e;
      }
      try {
        await this.backup(false);
      } catch (e) {
        if (e.auth) throw e;
        console.warn('Záloha sa nepodarila', e); // uloženie samotné je dôležitejšie
      }
      const r = await this.json(`${UP}/files/${this.fileId}?uploadType=media&fields=version&${ALL}`, {
        method: 'PATCH', headers: { 'Content-Type': 'text/plain; charset=UTF-8' }, body: text,
      });
      this.known = r.version;
    },

    async photos() {
      if (!this.photoIndex) {
        this.photoIndex = this.list(`'${this.folders.fotky}' in parents and trashed=false`, 'id,name,md5Checksum')
          .then((files) => new Map(files.map((f) => [f.name, f])))
          .catch((e) => { this.photoIndex = null; throw e; });
      }
      return this.photoIndex;
    },

    /** Object URL fotky; stiahnuté fotky sa držia v cache prehliadača, aby sa nesťahovali stále znova. */
    async photoUrl(relPath) {
      if (!relPath) return null;
      if (this.urls.has(relPath)) return this.urls.get(relPath);
      try {
        const f = (await this.photos()).get(relPath.split('/').pop());
        if (!f) return null;
        const key = `https://rodokmen.cache/${f.id}/${f.md5Checksum || ''}`;
        let blob = null, cache = null;
        try {
          cache = await caches.open('rk-fotky');
          const hit = await cache.match(key);
          if (hit) blob = await hit.blob();
        } catch (e) { cache = null; }
        if (!blob) {
          blob = await limited(async () => (await this.api(`${API}/files/${f.id}?alt=media&${ALL}`)).blob());
          if (cache) cache.put(key, new Response(blob)).catch(() => {});
        }
        const u = URL.createObjectURL(blob);
        this.urls.set(relPath, u);
        return u;
      } catch (e) {
        return null;
      }
    },

    async savePhoto(file, baseName) {
      const ext = (file.name.match(/\.([a-z0-9]+)$/i) || [, 'jpg'])[1].toLowerCase();
      const name = `${baseName}.${ext}`;
      const r = await this.createFile(name, this.folders.fotky, file, file.type || 'image/jpeg');
      (await this.photos()).set(name, r);
      return { path: 'fotky/' + name, format: ext === 'jpeg' ? 'jpg' : ext };
    },
  };

  RK.DriveStore = Drive;
})();
