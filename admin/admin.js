// Admin-panel for Ellie Cast sin forfatterside.
// Samme fil brukes i begge versjonene av siden:
//  - GitHub Pages: lagrer innhold og bilder direkte i repoet via GitHub sitt API.
//  - PHP: lagrer i databasen på webhotellet via ../api/admin.php  (<body data-backend="php">)

(() => {
  const BACKEND = document.body.dataset.backend === 'php' ? 'php' : 'github';
  const SETTINGS_KEY = 'ec-admin-github'; // eget navn, så det ikke blandes med andre sider på samme github.io-adresse
  const DATA_PATH = 'data/site.json';
  const UPLOAD_DIR = 'bilder/uploads';
  const AUDIO_ROOT = 'musikk'; // hvert album har sin egen mappe: musikk/<album-id>/
  const ALBUM_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;
  const LOCAL_AUDIO = /^musikk\/[a-z0-9-]+\/[^/]+$/;
  const MAX_AUDIO_MB = 40;
  const DEFAULT_SHARE_IMAGE = 'bilder/deling.jpg';
  const MAX_IMAGE = 2000;

  const app = document.getElementById('app');
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  let gh = loadSettings();
  let data = null;
  let view = 'general';
  let dirty = false;
  let busy = 0;
  const previews = {}; // bildesti -> lokal blob-URL, så nye bilder vises før Pages er oppdatert
  let published = null; // innholdet slik det sist ble lagret, for å se hvilke lydfiler som er flyttet eller fjernet
  const sessionAudio = new Set(); // lydfiler lastet opp siden forrige publisering

  // ---------- Innstillinger ----------

  function loadSettings() {
    let s = {};
    try { s = JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}; } catch (e) {}
    if (!s.owner && location.hostname.endsWith('.github.io')) {
      s.owner = location.hostname.split('.')[0];
      const first = location.pathname.split('/').filter(Boolean)[0];
      s.repo = first && first !== 'admin' ? first : `${s.owner}.github.io`;
    }
    return { owner: '', repo: '', branch: 'main', folder: '', token: '', ...s };
  }
  function saveSettings() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(gh)); } catch (e) {}
  }

  // ---------- GitHub API ----------

  const repoPath = (p) => [gh.folder.replace(/^\/+|\/+$/g, ''), p].filter(Boolean).join('/');
  const apiUrl = (p) => `https://api.github.com/repos/${encodeURIComponent(gh.owner)}/${encodeURIComponent(gh.repo)}${p}`;

  async function api(path, opts = {}) {
    const res = await fetch(apiUrl(path), {
      ...opts,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${gh.token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
      },
      cache: 'no-store',
    });
    if (res.status === 404 && opts.allow404) return null;
    if (!res.ok) {
      let msg = `GitHub svarte ${res.status}`;
      let githubMessage = '';
      try { const j = await res.json(); if (j.message) { githubMessage = j.message; msg += `: ${j.message}`; } } catch (e) {}
      const err = new Error(msg); err.status = res.status; err.githubMessage = githubMessage; throw err;
    }
    return res.json();
  }

  const contentsPath = (p) => `/contents/${repoPath(p).split('/').map(encodeURIComponent).join('/')}`;

  async function getFile(p) {
    return api(`${contentsPath(p)}?ref=${encodeURIComponent(gh.branch)}&t=${Date.now()}`, { allow404: true });
  }

  // Alle skriv går i kø, ett om gangen, så GitHub ikke får to commits samtidig.
  let queue = Promise.resolve();
  function putFile(p, base64, message) {
    const job = queue.then(async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        const existing = await getFile(p);
        try {
          return await api(contentsPath(p), {
            method: 'PUT',
            body: JSON.stringify({ message, content: base64, branch: gh.branch, ...(existing ? { sha: existing.sha } : {}) }),
          });
        } catch (e) {
          if ((e.status === 409 || e.status === 422) && attempt < 2) { await new Promise((r) => setTimeout(r, 800)); continue; }
          throw e;
        }
      }
    });
    queue = job.catch(() => {});
    return job;
  }

  function bytesToBase64(bytes) {
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }
  const textToBase64 = (s) => bytesToBase64(new TextEncoder().encode(s));
  const base64ToText = (b) => new TextDecoder().decode(Uint8Array.from(atob(b.replace(/\s/g, '')), (c) => c.charCodeAt(0)));

  // ---------- Data ----------

  const i18n = (v) => (v && typeof v === 'object' ? { no: v.no || '', en: v.en || '' } : { no: '', en: v || '' });

  const BOOK_STATUS = ['published', 'upcoming', 'hidden'];

  function normalize(d) {
    d.site = d.site || {};
    d.site.name = typeof d.site.name === 'string' ? d.site.name : 'Ellie Cast';
    ['role', 'tagline', 'quote', 'quoteSource'].forEach((k) => (d.site[k] = i18n(d.site[k])));
    d.site.shareImage = d.site.shareImage || '';
    d.about = d.about || {};
    d.about.image = d.about.image || '';
    d.about.short = i18n(d.about.short);
    d.about.text = i18n(d.about.text);
    d.about.facts = (d.about.facts || []).map(normFact);
    d.contact = d.contact || {};
    d.contact.email = d.contact.email || '';
    d.contact.text = i18n(d.contact.text);
    d.contact.links = (d.contact.links || []).map((l) => ({ label: l.label || '', url: l.url || '' }));
    d.books = (d.books || []).map((b) => ({
      id: '', year: '', pages: '', seriesNo: '', cover: '', color: '#23203a', ...b,
      status: BOOK_STATUS.includes(b.status) ? b.status : 'published',
      title: i18n(b.title), series: i18n(b.series), genre: i18n(b.genre), blurb: i18n(b.blurb), excerpt: i18n(b.excerpt),
      warnings: i18n(b.warnings),
      release: normRelease(b),
      editions: (b.editions || []).map((e) => ({ name: e.name || '', release: { date: '', time: '', tz: '', ...e.release } })),
      links: (b.links || []).map((l) => ({ label: i18n(l.label), url: l.url || '' })),
      reviews: (b.reviews || []).map((r) => ({ quote: i18n(r.quote), source: r.source || '', stars: String(r.stars || '') })),
    }));
    d.news = (d.news || []).map((n) => ({
      id: '', date: '', time: '', tz: '', image: '', book: '', ...n,
      title: i18n(n.title), text: i18n(n.text),
      link: { label: i18n(n.link?.label), url: n.link?.url || '' },
    }));
    d.events = (d.events || []).map((e) => ({
      date: '', time: '', place: '', ...e,
      title: i18n(e.title), text: i18n(e.text),
      link: { label: i18n(e.link?.label), url: e.link?.url || '' },
    }));
    d.newsletter = { provider: '', buttondown: '', url: '', ...d.newsletter };
    d.newsletter.title = i18n(d.newsletter.title);
    d.newsletter.text = i18n(d.newsletter.text);
    d.music = d.music || {};
    d.music.albums = (d.music.albums || []).map((a) => ({
      id: '', artist: '', year: '', cover: '', ...a,
      title: i18n(a.title), tag: i18n(a.tag), description: i18n(a.description),
      tracks: (a.tracks || []).map((tk) => ({ title: tk.title || '', src: tk.src || '', ...(tk.duration ? { duration: tk.duration } : {}) })),
    }));
    return d;
  }
  // Utgivelse: { date: 'YYYY-MM-DD', time: 'HH:MM' (24 t) eller '', tz: 'America/New_York' }.
  // Eldre bøker har bare tekst i «year»; en hel dato der («June 26, 2026») flyttes inn hit.
  function normRelease(b) {
    const r = { date: '', time: '', tz: '', ...b.release };
    if (!r.date) {
      const s = String(b.year || '').trim();
      const d = /\b\d{1,2}\b/.test(s.replace(/\d{4}/, '')) ? new Date(`${s} 12:00`) : null;
      if (d && !isNaN(d)) r.date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }
    return r;
  }
  function normFact(f) { return { label: i18n(f.label), value: i18n(f.value) }; }

  function getPath(path) { return path.split('.').reduce((o, k) => (o == null ? o : o[k]), data); }
  function setPath(path, value) {
    const keys = path.split('.');
    const last = keys.pop();
    const obj = keys.reduce((o, k) => o[k], data);
    obj[last] = value;
  }

  const slug = (s, fallback = 'bok') => String(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/æ/g, 'ae').replace(/ø/g, 'o').replace(/å/g, 'a').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || fallback;

  function markDirty() { dirty = true; updateStatus(); }

  // ---------- Bilder ----------

  async function compress(file) {
    if (file.type === 'image/gif') return { blob: file, ext: 'gif' }; // beholder animasjon
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, MAX_IMAGE / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/webp', 0.88));
    if (blob && blob.type === 'image/webp') return { blob, ext: 'webp' };
    const png = await new Promise((r) => canvas.toBlob(r, 'image/png'));
    return { blob: png, ext: 'png' };
  }

  async function uploadImage(file, nameHint) {
    if (!/^image\/(png|jpeg|webp|gif|avif|bmp)$/.test(file.type)) throw new Error(`${file.name} er ikke et bilde som støttes (PNG, JPG, WebP eller GIF)`);
    busy++; updateStatus(`Laster opp ${file.name} …`);
    try {
      const { blob, ext } = await compress(file);
      const base = slug(nameHint || file.name.replace(/\.[^.]+$/, ''));
      const path = await backend.upload(blob, base, ext);
      previews[path] = URL.createObjectURL(blob);
      return path;
    } finally {
      busy--; updateStatus();
    }
  }

  // ---------- Lyd ----------

  const AUDIO_EXT = /\.(mp3|m4a|aac|ogg|oga|wav|flac)$/i;
  const isAudio = (f) => f.type.startsWith('audio/') || AUDIO_EXT.test(f.name);
  const niceTitle = (name) => name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();

  async function uploadAudio(file, folder) {
    if (!ALBUM_ID.test(folder)) throw new Error('Gi albumet et gyldig nettadresse-navn (id) før du laster opp: små bokstaver, tall og bindestrek.');
    if (!isAudio(file)) throw new Error(`${file.name} er ikke en lydfil som støttes (MP3, M4A, OGG, WAV eller FLAC)`);
    if (file.size > MAX_AUDIO_MB * 1024 * 1024) throw new Error(`${file.name} er for stor (maks ${MAX_AUDIO_MB} MB). Prøv å lagre den som MP3.`);
    busy++; updateStatus(`Laster opp ${file.name} …`);
    try {
      let ext = (file.name.match(AUDIO_EXT) || [, 'mp3'])[1].toLowerCase();
      if (ext === 'oga') ext = 'ogg';
      const base = slug(niceTitle(file.name), 'spor').slice(0, 60).replace(/-+$/, '');
      const path = await backend.upload(file, base, ext, 'audio', folder);
      previews[path] = URL.createObjectURL(file);
      sessionAudio.add(path);
      return path;
    } finally {
      busy--; updateStatus();
    }
  }

  // Lengden på sangen i sekunder, så siden kan vise den uten å laste ned lydfilen.
  function audioDuration(file) {
    return new Promise((resolve) => {
      const a = new Audio();
      const url = URL.createObjectURL(file);
      const done = (v) => { URL.revokeObjectURL(url); resolve(v); };
      a.preload = 'metadata';
      a.onloadedmetadata = () => done(isFinite(a.duration) ? Math.floor(a.duration) : 0);
      a.onerror = () => done(0);
      setTimeout(() => done(0), 8000);
      a.src = url;
    });
  }

  // Finner lydfiler som må flyttes (albumet har fått ny id) eller slettes (sporet er fjernet).
  // Endrer src i `next` til de nye stiene.
  function planMusicFiles(old, next) {
    const srcs = (d) => (d?.music?.albums || []).flatMap((a) => a.tracks.map((t) => t.src)).filter((p) => LOCAL_AUDIO.test(p));
    const owners = {};
    for (const a of next.music.albums) for (const t of a.tracks) (owners[t.src] ||= new Set()).add(a.id);
    const taken = new Set(srcs(next));
    const moved = {};
    const moves = [];
    for (const a of next.music.albums) {
      for (const t of a.tracks) {
        if (!LOCAL_AUDIO.test(t.src)) continue;
        const [, folder, file] = t.src.split('/');
        if (owners[t.src]?.has(folder)) continue; // ligger allerede i riktig mappe
        if (!moved[t.src]) {
          let to = `${AUDIO_ROOT}/${a.id}/${file}`;
          for (let n = 2; taken.has(to); n++) to = `${AUDIO_ROOT}/${a.id}/${file.replace(/(\.[^.]+)?$/, `-${n}$1`)}`;
          taken.add(to);
          moved[t.src] = to;
          moves.push({ from: t.src, to });
        }
        t.src = moved[t.src];
      }
    }
    const keep = new Set(srcs(next));
    const deletes = [...new Set([...srcs(old), ...sessionAudio])].filter((p) => LOCAL_AUDIO.test(p) && !keep.has(p) && !moved[p]);
    return { moves, deletes };
  }

  const imgSrc = (p) => !p ? '' : previews[p] || (/^(https?:)?\/\//.test(p) ? p : `../${p}`);

  function pickFiles(multiple, accept = 'image/*') {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file'; input.accept = accept; input.multiple = multiple;
      input.onchange = () => resolve([...input.files]);
      input.click();
    });
  }

  // ---------- Lagring: GitHub Pages ----------

  const githubBackend = {
    publishedMsg: 'Publisert! Siden oppdateres om ca. ett minutt ♥',

    start() {
      if (gh.token && gh.owner && gh.repo) {
        app.innerHTML = '<p class="center">Kobler til GitHub …</p>';
        this.connect().catch((err) => this.renderConnect(friendlyError(err)));
      } else {
        this.renderConnect();
      }
    },

    renderConnect(error) {
      app.innerHTML = `
        <div class="connect">
          <h1 style="font-size:2rem">Admin ♥</h1>
          <p class="muted">Koble til GitHub-repoet der siden ligger. Dette gjør du bare én gang per nettleser.</p>
          <div class="box">
            ${error ? `<div class="error">${esc(error)}</div>` : ''}
            <form id="connectForm">
              <div class="grid2">
                <div class="field"><label for="owner">GitHub-brukernavn</label><input type="text" id="owner" value="${esc(gh.owner)}" required autocomplete="off"></div>
                <div class="field"><label for="repo">Repo</label><input type="text" id="repo" value="${esc(gh.repo)}" required autocomplete="off" placeholder="brukernavn.github.io"></div>
                <div class="field"><label for="branch">Branch</label><input type="text" id="branch" value="${esc(gh.branch)}" required></div>
                <div class="field"><label for="folder">Mappe i repoet (valgfritt)</label><input type="text" id="folder" value="${esc(gh.folder)}" placeholder="tom = roten av repoet"></div>
              </div>
              <div class="field"><label for="token">Tilgangsnøkkel (token)</label><input type="password" id="token" value="${esc(gh.token)}" required autocomplete="off"></div>
              <button class="primary" type="submit" style="width:100%">Koble til</button>
            </form>
            <h3>Slik lager du nøkkelen</h3>
            <ol class="small">
              <li>Gå til <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">github.com/settings/personal-access-tokens/new</a></li>
              <li>Gi den et navn, f.eks. <code>Admin furry-side</code>, og velg en utløpsdato.</li>
              <li>Under <b>Repository access</b>: velg <b>Only select repositories</b> og velg repoet til siden.</li>
              <li>Under <b>Permissions → Repository permissions</b>: sett <b>Contents</b> til <b>Read and write</b>.</li>
              <li>Trykk <b>Generate token</b>, kopier den og lim den inn her.</li>
            </ol>
            <p class="small muted">Nøkkelen lagres bare i denne nettleseren. Del den aldri med noen.</p>
          </div>
        </div>`;
      $('#connectForm').onsubmit = async (e) => {
        e.preventDefault();
        gh = {
          owner: $('#owner').value.trim(), repo: $('#repo').value.trim(), branch: $('#branch').value.trim() || 'main',
          folder: $('#folder').value.trim(), token: $('#token').value.trim(),
        };
        const btn = e.submitter; btn.disabled = true; btn.textContent = 'Kobler til …';
        try {
          await this.connect();
          saveSettings();
        } catch (err) {
          this.renderConnect(friendlyError(err));
        }
      };
    },

    async connect() {
      const repo = await api('');
      if (repo.permissions && !repo.permissions.push) {
        const e = new Error('Nøkkelen kan ikke skrive til repoet.'); e.status = 403; e.githubMessage = 'kontoen din har ikke skrivetilgang til dette repoet'; throw e;
      }
      const file = await getFile(DATA_PATH);
      if (file) return ready(JSON.parse(base64ToText(file.content)));
      // Første gang: start med det som ligger på siden nå.
      const res = await fetch(`../${DATA_PATH}?v=${Date.now()}`);
      if (!res.ok) { const e = new Error(`Fant ikke ${repoPath(DATA_PATH)} i repoet.`); e.status = 404; throw e; }
      ready(await res.json(), true);
    },

    // Innhold, delingsinfo, flytting og sletting av lydfiler lagres i én commit, så alt skjer samtidig eller ikke i det hele tatt.
    save(content, files = { moves: [], deletes: [] }) {
      const job = queue.then(() => this.commit(content, files));
      queue = job.catch(() => {});
      return job;
    },

    async commit(content, files) {
      const ref = `/git/refs/heads/${gh.branch.split('/').map(encodeURIComponent).join('/')}`;
      for (let attempt = 0; ; attempt++) {
        const head = (await api(ref)).object.sha;
        const baseTree = (await api(`/git/commits/${head}`)).tree.sha;
        const tree = await api(`/git/trees/${baseTree}?recursive=1`);
        const blobs = new Map(tree.tree.filter((e) => e.type === 'blob').map((e) => [e.path, e]));
        const text = (p, body) => ({ path: repoPath(p), mode: '100644', type: 'blob', content: body });
        const entries = [text(DATA_PATH, JSON.stringify(content, null, 2) + '\n')];

        // Delingsinfo, strukturdata og egne sider (uten #) for bøker, nyheter osv. Sider for innhold som er slettet eller skjult, fjernes.
        const SEO = window.EC_SEO;
        const index = blobs.get(repoPath('index.html'));
        if (index) {
          let pages = null;
          try {
            const html = base64ToText((await api(`/git/blobs/${index.sha}`)).content);
            pages = siteFiles(content, html);
            if (pages['index.html'] === html) delete pages['index.html'];
          } catch (err) {
            console.warn('Klarte ikke å lage sidene', err);
          }
          if (pages) {
            for (const [p, body] of Object.entries(pages)) entries.push(text(p, body));
            const keep = new Set(Object.keys(pages).map(repoPath));
            const prefix = gh.folder.replace(/^\/+|\/+$/g, '');
            for (const [p, b] of blobs) {
              const rel = prefix ? (p.startsWith(prefix + '/') ? p.slice(prefix.length + 1) : null) : p;
              if (SEO && rel && SEO.MANAGED.test(rel) && !keep.has(p)) entries.push({ path: p, mode: b.mode, type: 'blob', sha: null });
            }
          }
        }

        for (const { from, to } of files.moves) {
          const b = blobs.get(repoPath(from));
          if (!b) continue;
          entries.push({ path: repoPath(to), mode: b.mode, type: 'blob', sha: b.sha });
          entries.push({ path: repoPath(from), mode: b.mode, type: 'blob', sha: null });
        }
        for (const p of files.deletes) {
          const b = blobs.get(repoPath(p));
          if (b) entries.push({ path: repoPath(p), mode: b.mode, type: 'blob', sha: null });
        }

        const newTree = await api('/git/trees', { method: 'POST', body: JSON.stringify({ base_tree: baseTree, tree: entries }) });
        const commit = await api('/git/commits', {
          method: 'POST',
          body: JSON.stringify({ message: 'Oppdater innhold fra admin-panelet', tree: newTree.sha, parents: [head] }),
        });
        try {
          await api(ref, { method: 'PATCH', body: JSON.stringify({ sha: commit.sha }) });
          return;
        } catch (e) {
          // Noe annet ble lagret i mellomtiden: prøv på nytt oppå den nye versjonen.
          if ((e.status === 409 || e.status === 422) && attempt < 2) { await new Promise((r) => setTimeout(r, 800)); continue; }
          throw e;
        }
      }
    },

    async upload(blob, base, ext, kind = 'image', folder = '') {
      const dir = kind === 'audio' ? `${AUDIO_ROOT}/${folder}` : UPLOAD_DIR;
      const path = `${dir}/${base}-${Date.now().toString(36)}.${ext}`;
      await putFile(path, bytesToBase64(new Uint8Array(await blob.arrayBuffer())), `Last opp ${kind === 'audio' ? 'lydfil' : 'bilde'} ${path}`);
      return path;
    },

    settingsHTML() {
      return `
        <div class="card">
          <p>Koblet til <b>${esc(gh.owner)}/${esc(gh.repo)}</b> (branch <code>${esc(gh.branch)}</code>${gh.folder ? `, mappe <code>${esc(gh.folder)}</code>` : ''}).</p>
          <p class="small muted">Hver gang du publiserer blir det lagret en ny versjon i GitHub. Du kan se alle tidligere versjoner under
            <a href="https://github.com/${encodeURIComponent(gh.owner)}/${encodeURIComponent(gh.repo)}/commits/${encodeURIComponent(gh.branch)}" target="_blank" rel="noopener">Commits på GitHub</a>.</p>
          <button class="danger" data-act="disconnect">Logg ut (glem nøkkelen i denne nettleseren)</button>
        </div>`;
    },

    logout() {
      gh.token = '';
      saveSettings();
      this.renderConnect();
    },
  };

  // Discord, Messenger, Google osv. leser ikke JavaScript, så delingsinfo og strukturdata må stå rett i index.html,
  // og hver bok, nyhet osv. får sin egen side. Brukes av begge versjonene. `html` er index.html slik den er nå.
  function siteFiles(content, html) {
    const SEO = window.EC_SEO;
    const site = new URL('../', location.href).href;
    let index = html.replace(/  <!-- deling:start[\s\S]*?<!-- deling:slutt -->/, () => shareMetaHTML(content));
    if (SEO) index = index.replace(SEO.DATA_BLOCK, () => SEO.indexLd(content, site));
    return { 'index.html': index, ...(SEO ? SEO.files(content, site, index) : {}) };
  }

  function shareMetaHTML(content) {
    const siteUrl = new URL('../', location.href).href;
    const abs = (p) => new URL(p, siteUrl).href;
    const image = content.site.shareImage || DEFAULT_SHARE_IMAGE;
    const title = content.site.name || 'Ellie Cast';
    const desc = content.site.tagline.en || '';
    const a = (v) => esc(v).replace(/\n/g, ' ');
    return [
      '  <!-- deling:start (oppdateres automatisk av admin når du publiserer) -->',
      `  <meta name="description" content="${a(desc)}">`,
      '  <meta property="og:type" content="website">',
      `  <meta property="og:site_name" content="${a(title)}">`,
      `  <meta property="og:title" content="${a(title)}">`,
      `  <meta property="og:description" content="${a(desc)}">`,
      `  <meta property="og:url" content="${a(siteUrl)}">`,
      `  <meta property="og:image" content="${a(abs(image))}">`,
      ...(image === DEFAULT_SHARE_IMAGE ? ['  <meta property="og:image:width" content="1200">', '  <meta property="og:image:height" content="630">'] : []),
      '  <meta name="twitter:card" content="summary_large_image">',
      '  <!-- deling:slutt -->',
    ].join('\n');
  }

  // ---------- Lagring: PHP + SQL ----------

  const phpBackend = {
    publishedMsg: 'Lagret! Endringene er ute på siden nå ♥',
    csrf: '',
    username: '',
    role: 'admin', // 'admin' eller 'editor' (redaktør). Serveren sjekker rollen selv, dette styrer bare hva som vises.
    users: null, // brukerne (bare admin, null = ikke hentet ennå)
    messages: null, // meldinger fra kontaktskjemaet (null = ikke hentet ennå)
    unread: 0,

    async loadMessages() {
      const r = await this.call('messages');
      this.setMessages(r.messages);
    },

    setMessages(list) {
      this.messages = Array.isArray(list) ? list : [];
      this.unread = this.messages.filter((m) => !m.read).length;
    },

    async call(action, { body, form } = {}) {
      const res = await fetch(`../api/admin.php?action=${action}`, {
        method: body || form ? 'POST' : 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'X-CSRF-Token': this.csrf, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: form || (body ? JSON.stringify(body) : undefined),
      });
      let json = null;
      try { json = await res.json(); } catch (e) {}
      if (!json || typeof json !== 'object') {
        const err = new Error(`Serveren svarte ikke som forventet (${res.status}). Prøv igjen, eller sjekk PHP-feilloggen.`);
        err.status = res.status; throw err;
      }
      if (!res.ok || json.error) {
        const err = new Error(json.error || `Serveren svarte ${res.status}`);
        err.status = res.status;
        err.serverMessage = json.error;
        throw err;
      }
      return json;
    },

    async start() {
      app.innerHTML = '<p class="center">Laster …</p>';
      try {
        const s = await this.call('session');
        this.csrf = s.csrf || '';
        if (!s.installed) return this.renderLogin('Siden er ikke installert ennå. Åpne install.php først.');
        if (!s.loggedIn) return this.renderLogin();
        this.username = s.username;
        this.role = s.role || 'admin';
        await this.load();
      } catch (err) {
        this.renderLogin(friendlyError(err));
      }
    },

    renderLogin(error) {
      app.innerHTML = `
        <div class="connect">
          <h1 style="font-size:2rem">Admin ♥</h1>
          <p class="muted">Logg inn for å redigere siden.</p>
          <div class="box">
            ${error ? `<div class="error">${esc(error)}</div>` : ''}
            <form id="loginForm">
              <div class="field"><label for="username">Brukernavn</label><input type="text" id="username" required autocomplete="username"></div>
              <div class="field"><label for="password">Passord</label><input type="password" id="password" required autocomplete="current-password"></div>
              <button class="primary" type="submit" style="width:100%">Logg inn</button>
            </form>
          </div>
        </div>`;
      $('#username').focus();
      $('#loginForm').onsubmit = async (e) => {
        e.preventDefault();
        const btn = e.submitter; btn.disabled = true; btn.textContent = 'Logger inn …';
        try {
          const r = await this.call('login', { body: { username: $('#username').value.trim(), password: $('#password').value } });
          this.csrf = r.csrf;
          this.username = r.username;
          this.role = r.role || 'admin';
          await this.load();
        } catch (err) {
          this.renderLogin(friendlyError(err));
        }
      };
    },

    async load() {
      const r = await this.call('data');
      // Første gang på et nytt domene: sidene og sitemap.xml har fortsatt den gamle adressen til de publiseres her.
      let stale = false;
      try {
        const res = await fetch(`../sitemap.xml?v=${Date.now()}`, { cache: 'no-store' });
        const site = new URL('../', location.href).href;
        const index = await fetch(`../index.html?v=${Date.now()}`, { cache: 'no-store' });
        stale = !res.ok || !(await res.text()).includes(`<loc>${site}</loc>`)
          || !index.ok || !(await index.text()).includes(`<meta property="og:url" content="${esc(site)}">`);
      } catch (e) {}
      ready(r.data, stale);
      if (stale) toast('Trykk «Publiser» én gang, så får alle sidene og Google riktig adresse.');
      this.loadMessages().then(() => renderNav()).catch(() => {});
      // Holder økten i live mens admin er åpent, og henter ny CSRF-nøkkel hvis du har logget inn i en annen fane.
      clearInterval(this.ping);
      this.ping = setInterval(() => this.call('session').then((s) => { if (s.csrf) this.csrf = s.csrf; }).catch(() => {}), 5 * 60 * 1000);
    },

    async save(content, files = { moves: [], deletes: [] }) {
      let pages = {};
      try {
        const res = await fetch(`../index.html?v=${Date.now()}`, { cache: 'no-store' });
        if (res.ok) pages = siteFiles(content, await res.text());
      } catch (err) {
        console.warn('Klarte ikke å lage sidene', err);
      }
      await this.call('save', { body: { data: content, files, pages } });
    },

    async upload(blob, base, ext, kind = 'image', folder = '') {
      const form = new FormData();
      form.append('kind', kind);
      form.append('folder', folder);
      form.append('file', blob, `${base}.${ext}`);
      const { path } = await this.call('upload', { form });
      if (typeof path !== 'string' || !path) throw new Error('Serveren sendte ikke tilbake hvor filen ble lagret.');
      return path;
    },

    settingsHTML() {
      return `
        <div class="card">
          <p>Logget inn som <b>${esc(this.username)}</b> (${this.role === 'editor' ? 'redaktør' : 'admin'}). Innholdet lagres i databasen på serveren.</p>
          <button class="danger" data-act="disconnect">Logg ut</button>
        </div>
        <div class="card">
          <h3 style="margin-top:0">Bytt passord</h3>
          <form id="pwForm">
            <div class="field"><label for="pwCurrent">Nåværende passord</label><input type="password" id="pwCurrent" required autocomplete="current-password"></div>
            <div class="grid2">
              <div class="field"><label for="pwNew">Nytt passord (minst 10 tegn)</label><input type="password" id="pwNew" required minlength="10" autocomplete="new-password"></div>
              <div class="field"><label for="pwNew2">Gjenta nytt passord</label><input type="password" id="pwNew2" required minlength="10" autocomplete="new-password"></div>
            </div>
            <button class="primary" type="submit">Bytt passord</button>
          </form>
        </div>`;
    },

    afterSettings() {
      $('#pwForm').onsubmit = async (e) => {
        e.preventDefault();
        if ($('#pwNew').value !== $('#pwNew2').value) return toast('De nye passordene er ikke like.', true);
        try {
          await this.call('password', { body: { current: $('#pwCurrent').value, new: $('#pwNew').value } });
          e.target.reset();
          toast('Passordet er byttet ♥');
        } catch (err) {
          toast(friendlyError(err), true);
        }
      };
    },

    async logout() {
      clearInterval(this.ping);
      try { await this.call('logout', { body: {} }); } catch (e) {}
      this.csrf = '';
      this.renderLogin();
    },
  };

  const backend = BACKEND === 'php' ? phpBackend : githubBackend;

  function friendlyError(err) {
    if (err.serverMessage) return err.serverMessage;
    if (BACKEND === 'github') {
      // Ta med GitHub sin egen forklaring, så det er lettere å se hva som er galt.
      const detail = err.githubMessage ? ` (GitHub: ${err.githubMessage})` : '';
      if (err.status === 401) return 'Nøkkelen er ugyldig eller utløpt. Lag en ny.' + detail;
      if (err.status === 403) return 'Nøkkelen får ikke skrive til repoet. Sjekk at repoet er valgt under «Repository access», og at «Contents» står på «Read and write».' + detail;
      if (err.status === 404) return 'Fant ikke repoet eller filen. Sjekk brukernavn, repo, branch og mappe, og at nøkkelen har tilgang til dette repoet.' + detail;
    }
    if (err instanceof TypeError) return 'Fikk ikke kontakt med serveren. Sjekk nettet og prøv igjen.';
    return err.message || String(err);
  }

  function ready(content, isDirty = false) {
    data = normalize(content);
    published = structuredClone(data);
    sessionAudio.clear();
    dirty = isDirty;
    renderShell();
  }

  // ---------- Hovedvisning ----------

  function renderShell() {
    app.innerHTML = `
      <div class="shell">
        <aside class="side" id="side">
          <div class="logo"><img src="../bilder/ikon.svg" alt="">Admin</div>
          <nav id="sideNav"></nav>
        </aside>
        <div class="content">
          <div class="topbar">
            <div class="row">
              <button class="menu-toggle icon" id="menuToggle" aria-label="Meny">☰</button>
              <span class="status" id="status"><span class="dot"></span><span id="statusText"></span></span>
            </div>
            <div class="row">
              <a class="btn" href="../" target="_blank" rel="noopener">Se siden ↗</a>
              <button class="primary" id="publishBtn">Publiser</button>
            </div>
          </div>
          <div class="editor" id="editor"></div>
        </div>
      </div>`;
    $('#publishBtn').onclick = publish;
    $('#menuToggle').onclick = () => $('#side').classList.toggle('open');
    $('#side').addEventListener('click', (e) => { if (e.target === $('#side')) $('#side').classList.remove('open'); });
    const editor = $('#editor');
    editor.addEventListener('input', onInput);
    editor.addEventListener('change', onInput);
    editor.addEventListener('click', onAction);
    editor.addEventListener('dragover', (e) => { const dz = e.target.closest('.dropzone'); if (dz) { e.preventDefault(); dz.classList.add('over'); } });
    editor.addEventListener('dragleave', (e) => e.target.closest('.dropzone')?.classList.remove('over'));
    editor.addEventListener('drop', onDrop);
    $('#sideNav').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.view === 'new') return addBook();
      if (b.dataset.view === 'new-album') return addAlbum();
      if (b.dataset.view === 'new-post') return addPost();
      if (b.dataset.view === 'new-event') return addEvent();
      view = b.dataset.view; cal = { obj: null, ym: '' }; renderNav(); renderEditor(); $('#side').classList.remove('open');
      window.scrollTo(0, 0);
    });
    renderNav(); renderEditor(); updateStatus();
  }

  function renderNav() {
    const item = (v, label) => `<button data-view="${v}" class="${view === v ? 'active' : ''}">${label}</button>`;
    const statusNote = (b) => b.status === 'hidden' ? ' <span class="muted small">(skjult)</span>' : b.status === 'upcoming' ? ' <span class="muted small">(kommer)</span>' : '';
    $('#sideNav').innerHTML = `
      ${item('general', '🏠 Forside')}
      ${item('about', '✍️ Om Ellie')}
      ${item('contact', '✉️ Kontakt')}
      ${BACKEND === 'php' ? item('messages', `📥 Meldinger${phpBackend.unread ? ` <span class="badge">${phpBackend.unread}</span>` : ''}`) : ''}
      ${item('newsletter', '📬 Nyhetsbrev')}
      <div class="group">Nyheter</div>
      ${data.news.map((n, i) => item(`post:${i}`, `📰 ${esc(n.title.en || 'Uten tittel')}`)).join('')}
      <button data-view="new-post" class="add">＋ Ny nyhet</button>
      <div class="group">Arrangementer</div>
      ${data.events.map((e, i) => item(`event:${i}`, `📅 ${esc(e.title.en || 'Uten navn')} <span class="muted small">${esc(e.date)}</span>`)).join('')}
      <button data-view="new-event" class="add">＋ Nytt arrangement</button>
      <div class="group">Bøker</div>
      ${data.books.map((b, i) => item(`book:${i}`, `📖 ${esc(b.title.en || 'Uten tittel')}${statusNote(b)}`)).join('')}
      <button data-view="new" class="add">＋ Ny bok</button>
      <div class="group">Musikk</div>
      ${data.music.albums.map((a, i) => item(`album:${i}`, `♪ ${esc(a.title.en || 'Uten navn')} <span class="muted small">(${a.tracks.length})</span>`)).join('')}
      <button data-view="new-album" class="add">＋ Nytt album</button>
      <div class="group">Annet</div>
      ${BACKEND === 'php' && phpBackend.role === 'admin' ? item('users', '👥 Brukere') : ''}
      ${item('settings', '⚙️ Innstillinger')}`;
  }

  function updateStatus(msg) {
    const el = $('#status'); if (!el) return;
    el.className = 'status' + (busy ? ' busy' : dirty ? ' dirty' : '');
    $('#statusText').textContent = msg || (busy ? 'Jobber …' : dirty ? 'Ulagrede endringer' : 'Alt er publisert');
    $('#publishBtn').disabled = busy > 0;
  }

  // ---------- Feltbyggere ----------

  const textField = (label, path, attrs = '') => `
    <div class="field"><label>${label}</label><input type="text" data-path="${path}" value="${esc(getPath(path))}" ${attrs}></div>`;

  // Siden er bare på engelsk, så tekstene skrives bare på engelsk.
  const langField = (label, path, multiline) => {
    const p = `${path}.en`;
    const input = multiline
      ? `<textarea data-path="${p}">${esc(getPath(p))}</textarea>`
      : `<input type="text" data-path="${p}" value="${esc(getPath(p))}">`;
    return `<div class="field"><label>${label}</label>${input}</div>`;
  };

  // ---------- Kalender ----------
  // Egen kalender med AM/PM (det eieren bruker) og tidssone. Lagrer { date, time (24 t), tz } i objektet på objPath.
  // Siden selv viser dato og klokkeslett etter hvor besøkende er.

  const BROWSER_TZ = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch (e) { return 'UTC'; } })();
  const TZS = (() => { try { return Intl.supportedValuesOf('timeZone'); } catch (e) { return [BROWSER_TZ]; } })();
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const usDate = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', year: 'numeric', month: 'long', day: 'numeric' });
  const usTime = (t) => { const [h, m] = t.split(':').map(Number); return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };
  const tzShort = (iso, tz) => {
    try { return new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' }).formatToParts(new Date(`${iso}T12:00:00Z`)).find((x) => x.type === 'timeZoneName').value; } catch (e) { return tz; }
  };
  const isoToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  let cal = { obj: null, ym: '' };

  function dateField(label, objPath, yearPath) {
    const o = getPath(objPath);
    const text = o.date ? `${usDate(o.date)}${o.time ? ` · ${usTime(o.time)} ${tzShort(o.date, o.tz || BROWSER_TZ)}` : ''}` : (yearPath ? getPath(yearPath) : '');
    const y = yearPath ? ` data-year="${yearPath}"` : '';
    return `<div class="field"><label>${label}</label>
      <button type="button" class="cal-btn" data-act="cal-toggle" data-obj="${objPath}"${y}>📅 <span>${esc(text || 'Velg dato')}</span></button>
      ${cal.obj === objPath ? calendarHTML(objPath, yearPath) : ''}
    </div>`;
  }

  function calendarHTML(objPath, yearPath) {
    const o = getPath(objPath);
    const [Y, M] = cal.ym.split('-').map(Number);
    const first = new Date(Date.UTC(Y, M - 1, 1)).getUTCDay();
    const days = new Date(Date.UTC(Y, M, 0)).getUTCDate();
    const d = (iso) => `data-obj="${objPath}"${yearPath ? ` data-year="${yearPath}"` : ''}`;
    const cells = [];
    for (let i = 0; i < first; i++) cells.push('<span></span>');
    for (let n = 1; n <= days; n++) {
      const iso = `${Y}-${String(M).padStart(2, '0')}-${String(n).padStart(2, '0')}`;
      cells.push(`<button type="button" data-act="cal-day" data-date="${iso}" ${d()} class="${iso === o.date ? 'sel' : ''} ${iso === isoToday() ? 'today' : ''}">${n}</button>`);
    }
    let time = '';
    if (o.time) {
      const [h, m] = o.time.split(':').map(Number);
      const mins = [...new Set([...Array(12)].map((_, i) => i * 5).concat(m))].sort((a, b) => a - b);
      time = `
        <div class="cal-time">
          <select data-cal="hour" ${d()} aria-label="Time">${[...Array(12)].map((_, i) => i + 1).map((v) => `<option ${v === (h % 12 || 12) ? 'selected' : ''}>${v}</option>`).join('')}</select>
          <span>:</span>
          <select data-cal="min" ${d()} aria-label="Minutt">${mins.map((v) => `<option value="${v}" ${v === m ? 'selected' : ''}>${String(v).padStart(2, '0')}</option>`).join('')}</select>
          <div class="ampm">
            <button type="button" data-act="cal-ampm" data-v="AM" ${d()} class="${h < 12 ? 'on' : ''}">AM</button>
            <button type="button" data-act="cal-ampm" data-v="PM" ${d()} class="${h >= 12 ? 'on' : ''}">PM</button>
          </div>
        </div>
        <div class="field" style="margin:10px 0 0"><label>Tidssone</label>
          <select data-cal="tz" ${d()}>${TZS.map((z) => `<option ${z === (o.tz || BROWSER_TZ) ? 'selected' : ''}>${esc(z)}</option>`).join('')}</select>
          <p class="small muted" style="margin:4px 0 0">Tiden du velger gjelder i denne tidssonen. På siden ser hver besøkende den i sin egen tid.</p>
        </div>`;
    }
    return `
      <div class="cal">
        <div class="cal-head">
          <button type="button" class="icon" data-act="cal-month" data-d="-1" ${d()} aria-label="Forrige måned">‹</button>
          <b>${MONTHS[M - 1]} ${Y}</b>
          <button type="button" class="icon" data-act="cal-month" data-d="1" ${d()} aria-label="Neste måned">›</button>
        </div>
        <div class="cal-grid">${['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((w) => `<i>${w}</i>`).join('')}${cells.join('')}</div>
        <label class="cal-check"><input type="checkbox" data-cal="timeon" ${d()} ${o.time ? 'checked' : ''}> Klokkeslett</label>
        ${time}
        ${yearPath ? `<div class="cal-year"><label>Vet bare året?</label><input type="text" data-cal="year" ${d()} maxlength="4" inputmode="numeric" placeholder="2027" value="${o.date ? '' : esc(getPath(yearPath) || '')}"></div>` : ''}
        <div class="row" style="justify-content:space-between;margin-top:12px">
          <button type="button" class="danger" data-act="cal-clear" ${d()}>Fjern dato</button>
          <button type="button" class="primary" data-act="cal-toggle" ${d()}>Ferdig</button>
        </div>
      </div>`;
  }

  function onCalInput(el) {
    const o = getPath(el.dataset.obj);
    const k = el.dataset.cal;
    const [h, m] = (o.time || '12:00').split(':').map(Number);
    const set = (hh, mm) => { o.time = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`; };
    if (k === 'timeon') { o.time = el.checked ? (o.time || '12:00') : ''; if (el.checked && !o.tz) o.tz = BROWSER_TZ; }
    else if (k === 'hour') set((+el.value % 12) + (h >= 12 ? 12 : 0), m);
    else if (k === 'min') set(h, +el.value);
    else if (k === 'tz') o.tz = el.value;
    else if (k === 'year') {
      const v = el.value.replace(/\D/g, '').slice(0, 4);
      setPath(el.dataset.year, v);
      if (v) { o.date = ''; o.time = ''; }
      markDirty();
      return; // ikke tegn på nytt mens hun skriver
    }
    markDirty(); renderEditor();
  }

  const imageField = (label, path, hint = '') => {
    const v = getPath(path);
    return `<div class="field"><label>${label}</label>
      <div class="image-field">
        <div class="thumb ${v ? 'has' : ''}" style="${v ? `background-image:url('${esc(imgSrc(v))}')` : ''}">${v ? '' : '🖼️'}</div>
        <div class="row">
          <button type="button" data-act="upload" data-path="${path}">${v ? 'Bytt bilde' : 'Last opp bilde'}</button>
          ${v ? `<button type="button" class="danger" data-act="clear" data-path="${path}">Fjern</button>` : ''}
        </div>
        ${hint ? `<p class="small muted" style="margin:0;flex-basis:100%">${hint}</p>` : ''}
      </div></div>`;
  };

  const factsEditor = (path) => {
    const list = getPath(path);
    return `<div class="field">
      ${list.map((f, i) => `
        <div class="list-item">
          <div><label>Hva</label>
            <input type="text" data-path="${path}.${i}.label.en" value="${esc(f.label.en)}" placeholder="Favourite food"></div>
          <div><label>Svar</label>
            <input type="text" data-path="${path}.${i}.value.en" value="${esc(f.value.en)}"></div>
          <div class="tools">
            <button class="icon" data-act="move" data-path="${path}" data-i="${i}" data-d="-1" aria-label="Flytt opp" ${i === 0 ? 'disabled' : ''}>↑</button>
            <button class="icon" data-act="move" data-path="${path}" data-i="${i}" data-d="1" aria-label="Flytt ned" ${i === list.length - 1 ? 'disabled' : ''}>↓</button>
            <button class="icon danger" data-act="remove" data-path="${path}" data-i="${i}" aria-label="Slett">✕</button>
          </div>
        </div>`).join('')}
      <button data-act="add-fact" data-path="${path}">＋ Legg til fakta</button>
    </div>`;
  };

  // ---------- Sider i admin ----------

  // Liste med lenker: bøkene har tospråklig tekst på knappen, kontakt har bare ett navn (f.eks. «TikTok»).
  const linksEditor = (path, bilingual) => {
    const list = getPath(path);
    return `<div class="field">
      ${list.map((l, i) => `
        <div class="list-item">
          <div><label>${bilingual ? 'Tekst på knappen' : 'Navn'}</label>${bilingual ? `
            <input type="text" data-path="${path}.${i}.label.en" value="${esc(l.label.en)}" placeholder="Buy the book">`
            : `<input type="text" data-path="${path}.${i}.label" value="${esc(l.label)}" placeholder="Instagram">`}</div>
          <div><label>Lenke</label><input type="url" data-path="${path}.${i}.url" value="${esc(l.url)}" placeholder="https://…"></div>
          <div class="tools">
            <button class="icon" data-act="move" data-path="${path}" data-i="${i}" data-d="-1" aria-label="Flytt opp" ${i === 0 ? 'disabled' : ''}>↑</button>
            <button class="icon" data-act="move" data-path="${path}" data-i="${i}" data-d="1" aria-label="Flytt ned" ${i === list.length - 1 ? 'disabled' : ''}>↓</button>
            <button class="icon danger" data-act="remove" data-path="${path}" data-i="${i}" aria-label="Slett">✕</button>
          </div>
        </div>`).join('')}
      <button data-act="add-link" data-path="${path}" data-bilingual="${bilingual ? 1 : 0}">＋ Legg til lenke</button>
      <p class="small muted">Lenker uten adresse vises ikke på siden.</p>
    </div>`;
  };

  function renderEditor() {
    const ed = $('#editor');
    if (view === 'general') {
      ed.innerHTML = `
        <h2>Forside</h2>
        <div class="card">
          ${textField('Navn', 'site.name')}
          ${langField('Tittel under navnet (f.eks. «Author»)', 'site.role')}
          ${langField('Kort tekst på forsiden', 'site.tagline', true)}
        </div>
        <div class="card">
          <h3 style="margin-top:0">Sitat</h3>
          <p class="small muted">Vises i en egen rute på forsiden. Tomt = ingen sitat-rute.</p>
          ${langField('Sitat', 'site.quote', true)}
          ${langField('Hvor sitatet er fra', 'site.quoteSource')}
        </div>
        <div class="card">
          <h3 style="margin-top:0">Deling</h3>
          <p class="small muted">Dette vises når noen deler lenken til siden på Discord, Messenger, Bluesky og lignende.
            Navnet og den korte teksten over brukes som tekst.</p>
          ${imageField('Delingsbilde', 'site.shareImage', 'Liggende bilde, helst 1200 × 630 piksler. Tomt = standardbildet.')}
        </div>`;
    } else if (view === 'about') {
      ed.innerHTML = `
        <h2>Om Ellie</h2>
        <div class="card">
          ${imageField('Bilde', 'about.image', 'Stående bilde passer best. Tomt = «EC» i en bue.')}
          ${langField('Kort tekst (på forsiden)', 'about.short', true)}
          ${langField('Hele teksten (på Om Ellie-siden)', 'about.text', true)}
        </div>
        <div class="card">
          <h3 style="margin-top:0">Fakta</h3>
          ${factsEditor('about.facts')}
        </div>`;
    } else if (view === 'contact') {
      ed.innerHTML = `
        <h2>Kontakt</h2>
        <div class="card">
          ${textField('E-post', 'contact.email', 'inputmode="email" placeholder="navn@eksempel.no"')}
          <p class="small muted">${BACKEND === 'php' ? 'Meldinger fra kontaktskjemaet sendes hit.' : 'Tomt = knappen «Send en e-post» vises nedtonet.'}</p>
          ${langField('Tekst', 'contact.text', true)}
        </div>
        ${BACKEND === 'php' ? `
        <div class="card">
          <h3 style="margin-top:0">Kontaktskjema</h3>
          <p class="small muted">Kontaktsiden har et skjema der man skriver navn, e-post og melding. For å sende må man skrive inn en kode
            fra et bilde, så boter ikke kan sende meldinger. Meldingene kommer på e-post til adressen over, og ligger også under
            <b>Meldinger</b>. E-postadressen vises ikke på siden, så den ikke havner hos spam-boter.</p>
        </div>` : ''}
        <div class="card">
          <h3 style="margin-top:0">Sosiale medier og andre lenker</h3>
          ${linksEditor('contact.links', false)}
        </div>`;
    } else if (view === 'newsletter') {
      const n = data.newsletter;
      ed.innerHTML = `
        <h2>Nyhetsbrev</h2>
        <div class="card">
          <p class="small muted">Lesere kan melde seg på og få e-post når det kommer nye bøker. Påmeldingen vises på forsiden,
            på boksidene og under Nyheter. Den er skjult til du har valgt en tjeneste her.</p>
          <div class="field"><label>Tjeneste</label>
            <select data-path="newsletter.provider">
              <option value="" ${!n.provider ? 'selected' : ''}>Av – vises ikke på siden</option>
              <option value="buttondown" ${n.provider === 'buttondown' ? 'selected' : ''}>Buttondown – skjema rett på siden (anbefalt)</option>
              <option value="link" ${n.provider === 'link' ? 'selected' : ''}>En annen tjeneste – knapp med lenke (MailerLite, Substack …)</option>
            </select></div>
          ${n.provider === 'buttondown' ? `
            ${textField('Brukernavn på Buttondown', 'newsletter.buttondown', 'placeholder="elliecast" autocomplete="off"')}
            <p class="small muted">Lag en gratis konto på <a href="https://buttondown.com" target="_blank" rel="noopener">buttondown.com</a>
              og skriv brukernavnet her. Påmeldte lesere og utsending av e-post styrer du inne på Buttondown.</p>` : ''}
          ${n.provider === 'link' ? `
            ${textField('Lenke til påmeldingssiden', 'newsletter.url', 'placeholder="https://…"')}` : ''}
        </div>
        ${n.provider ? `
        <div class="card">
          <h3 style="margin-top:0">Tekst</h3>
          <p class="small muted">Tomt = standardteksten («Be the first to know» …).</p>
          ${langField('Overskrift', 'newsletter.title')}
          ${langField('Tekst', 'newsletter.text', true)}
        </div>` : ''}
        <div class="card">
          <h3 style="margin-top:0">Personvern</h3>
          <p class="small muted">Siden har en egen personvernside (<a href="../privacy/" target="_blank" rel="noopener">se den ↗</a>) som forteller
            hvordan e-postadressene brukes. Den lages automatisk ut fra tjenesten du har valgt.</p>
        </div>`;
    } else if (view.startsWith('event:')) {
      renderEvent(+view.slice(6));
    } else if (view.startsWith('post:')) {
      renderPost(+view.slice(5));
    } else if (view.startsWith('book:')) {
      renderBook(+view.slice(5));
    } else if (view.startsWith('album:')) {
      renderAlbum(+view.slice(6));
    } else if (view === 'messages') {
      phpBackend.messages = null;
      renderMessages();
    } else if (view === 'users') {
      phpBackend.users = null;
      renderUsers();
    } else if (view === 'settings') {
      ed.innerHTML = `<h2>Innstillinger</h2>${backend.settingsHTML()}`;
      backend.afterSettings?.();
    }
  }

  // Brukere og roller (bare på webhotellet, bare for admin)
  function renderUsers() {
    const ed = $('#editor');
    const list = phpBackend.users;
    const pwFields = (a, b) => `
          <div class="grid2">
            <div class="field"><label for="${a}">Passord (minst 10 tegn)</label><input type="password" id="${a}" required minlength="10" autocomplete="new-password"></div>
            <div class="field"><label for="${b}">Gjenta passordet</label><input type="password" id="${b}" required minlength="10" autocomplete="new-password"></div>
          </div>`;
    const roleSelect = (attrs, value) => `<select ${attrs}>
            <option value="editor" ${value === 'editor' ? 'selected' : ''}>Redaktør</option>
            <option value="admin" ${value === 'admin' ? 'selected' : ''}>Admin</option></select>`;
    ed.innerHTML = `
      <h2>Brukere</h2>
      <div class="card">
        <p class="small muted" style="margin:0"><b>Admin</b> kan alt, også legge til og fjerne brukere.
          <b>Redaktør</b> kan redigere og publisere alt innhold og lese meldinger, men ser ikke denne siden.<br>
          Passordene lagres kryptert, som en kode som ikke kan gjøres om til passordet igjen. Ingen kan se dem, heller ikke admin.
          Glemmer noen passordet, lager du et nytt her.</p>
      </div>
      ${list === null ? '<p class="muted">Laster …</p>' : list.map((u) => {
        const me = u.username === phpBackend.username;
        return `
        <div class="card" data-uid="${u.id}">
          <div class="row" style="justify-content:space-between">
            <div><b>${esc(u.username)}</b>${me ? ' <span class="muted small">(deg)</span>' : ''}</div>
            <div class="row">
              ${me ? `<span class="small muted">${u.role === 'editor' ? 'Redaktør' : 'Admin'}</span>`
                : roleSelect('data-user="role" aria-label="Rolle" style="width:auto"', u.role)}
              <button data-user="pw">Nytt passord</button>
              ${me ? '' : '<button class="danger" data-user="delete">Slett</button>'}
            </div>
          </div>
          <form class="user-pw" hidden style="margin-top:14px">
            ${pwFields(`pwA${u.id}`, `pwB${u.id}`)}
            <button class="primary" type="submit">Lagre passordet</button>
          </form>
        </div>`;
      }).join('')}
      <div class="card">
        <h3 style="margin-top:0">Ny bruker</h3>
        <form id="newUser">
          <div class="grid2">
            <div class="field"><label for="nuName">Brukernavn</label><input type="text" id="nuName" required minlength="3" maxlength="60" autocomplete="off"></div>
            <div class="field"><label for="nuRole">Rolle</label>${roleSelect('id="nuRole"', 'editor')}</div>
          </div>
          ${pwFields('nuPw', 'nuPw2')}
          <button class="primary" type="submit">Legg til bruker</button>
          <p class="small muted">Gi brukernavnet og passordet til personen. Passordet kan de bytte selv under Innstillinger.</p>
        </form>
      </div>`;
    const call = async (body, done) => {
      try {
        const r = await phpBackend.call('user', { body });
        phpBackend.users = r.users;
        renderUsers();
        toast(done);
      } catch (err) {
        toast(friendlyError(err), true);
        if (body.id && 'role' in body) renderUsers(); // sett rollevalget tilbake
      }
    };
    if (list === null) {
      phpBackend.call('users')
        .then((r) => { phpBackend.users = r.users; if (view === 'users') renderUsers(); })
        .catch((err) => toast(friendlyError(err), true));
      return;
    }
    ed.querySelectorAll('[data-uid]').forEach((card) => {
      const id = +card.dataset.uid;
      const u = list.find((x) => x.id === id);
      const sel = card.querySelector('[data-user="role"]');
      if (sel) sel.onchange = () => call({ id, role: sel.value }, `${u.username} er nå ${sel.value === 'editor' ? 'redaktør' : 'admin'}.`);
      card.querySelector('[data-user="pw"]').onclick = () => { const f = card.querySelector('.user-pw'); f.hidden = !f.hidden; if (!f.hidden) f.querySelector('input').focus(); };
      const del = card.querySelector('[data-user="delete"]');
      if (del) del.onclick = () => { if (confirm(`Slette brukeren «${u.username}»? Hen kan ikke logge inn lenger.`)) call({ id, delete: true }, `${u.username} er slettet.`); };
      card.querySelector('.user-pw').onsubmit = (e) => {
        e.preventDefault();
        const [a, b] = e.target.querySelectorAll('input');
        if (a.value !== b.value) return toast('Passordene er ikke like.', true);
        call({ id, password: a.value }, `Nytt passord til ${u.username} er lagret.`);
      };
    });
    $('#newUser').onsubmit = (e) => {
      e.preventDefault();
      if ($('#nuPw').value !== $('#nuPw2').value) return toast('Passordene er ikke like.', true);
      const username = $('#nuName').value.trim();
      call({ username, role: $('#nuRole').value, password: $('#nuPw').value }, `${username} er lagt til.`);
    };
  }

  // Meldinger fra kontaktskjemaet (bare på webhotellet)
  function renderMessages() {
    const ed = $('#editor');
    const list = phpBackend.messages;
    const when = (s) => new Date(s * 1000).toLocaleString('nb-NO', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    ed.innerHTML = `
      <h2>Meldinger</h2>
      <p class="small muted">Meldinger fra kontaktskjemaet på siden. De kommer også på e-post til adressen under «Kontakt».
        «Svar» åpner e-posten din med adressen ferdig utfylt.</p>
      ${list === null ? '<p class="muted">Laster …</p>'
        : !list.length ? '<div class="card"><p class="muted" style="margin:0">Ingen meldinger ennå.</p></div>'
        : list.map((m) => `
        <div class="card msg${m.read ? '' : ' unread'}" data-id="${m.id}">
          <div class="row" style="justify-content:space-between">
            <div><b>${esc(m.name)}</b> <span class="muted">${esc(m.email)}</span></div>
            <span class="small muted">${when(m.at)}${m.emailed ? '' : ' · ikke sendt på e-post'}</span>
          </div>
          <p class="msg-text">${esc(m.message)}</p>
          <div class="row">
            <a class="btn" href="mailto:${esc(m.email)}?subject=${encodeURIComponent('Re: your message')}">Svar</a>
            <button data-msg="read">${m.read ? 'Merk som ulest' : 'Merk som lest'}</button>
            <button class="danger" data-msg="delete">Slett</button>
          </div>
        </div>`).join('')}`;
    if (list === null) {
      phpBackend.loadMessages()
        .then(() => { if (view === 'messages') { renderNav(); renderMessages(); } })
        .catch((err) => toast(friendlyError(err), true));
      return;
    }
    ed.querySelectorAll('[data-msg]').forEach((b) => {
      b.onclick = async () => {
        const id = +b.closest('[data-id]').dataset.id;
        const m = list.find((x) => x.id === id);
        if (b.dataset.msg === 'delete' && !confirm(`Slette meldingen fra ${m?.name || 'denne personen'}?`)) return;
        try {
          const r = await phpBackend.call('message', { body: b.dataset.msg === 'delete' ? { id, delete: true } : { id, read: !m?.read } });
          phpBackend.setMessages(r.messages);
          renderNav();
          renderMessages();
        } catch (err) { toast(friendlyError(err), true); }
      };
    });
  }

  function renderBook(i) {
    const b = data.books[i];
    if (!b) { view = 'general'; renderNav(); return renderEditor(); }
    const p = `books.${i}`;
    $('#editor').innerHTML = `
      <div class="row" style="justify-content:space-between;margin-bottom:12px">
        <h2 style="margin:0">📖 ${esc(b.title.en || 'Ny bok')}</h2>
        <div class="row">
          <button class="icon" data-act="move-book" data-i="${i}" data-d="-1" ${i === 0 ? 'disabled' : ''} title="Flytt opp i rekkefølgen">↑</button>
          <button class="icon" data-act="move-book" data-i="${i}" data-d="1" ${i === data.books.length - 1 ? 'disabled' : ''} title="Flytt ned i rekkefølgen">↓</button>
          <a class="btn" href="../books/${encodeURIComponent(b.id)}/" target="_blank" rel="noopener">Se ↗</a>
        </div>
      </div>

      <div class="card">
        ${langField('Tittel', `${p}.title`)}
        <div class="grid2">
          <div class="field"><label>Status</label>
            <select data-path="${p}.status">
              <option value="published" ${b.status === 'published' ? 'selected' : ''}>Utgitt</option>
              <option value="upcoming" ${b.status === 'upcoming' ? 'selected' : ''}>Kommer – får merket «Kommer snart»</option>
              <option value="hidden" ${b.status === 'hidden' ? 'selected' : ''}>Skjult – vises ikke</option>
            </select></div>
          ${textField('Nettadresse-navn (id)', `${p}.id`, 'pattern="[a-z0-9-]+"')}
          ${dateField('Utgitt / kommer', `${p}.release`, `${p}.year`)}
          ${textField('Sider', `${p}.pages`, 'maxlength="8"')}
        </div>
        <p class="small muted" style="margin-top:-8px">Med status «Kommer» og en dato i kalenderen får boka nedtelling på siden og på forsiden.</p>
        ${editionsEditor(`${p}.editions`)}
        ${langField('Sjanger', `${p}.genre`)}
        <div class="grid2">
          ${langField('Serie (valgfritt)', `${p}.series`)}
          ${textField('Nummer i serien', `${p}.seriesNo`, 'inputmode="numeric" maxlength="3" placeholder="1"')}
        </div>
        <p class="small muted" style="margin-top:-8px">Bøker med nøyaktig samme serienavn vises i leserekkefølge etter nummeret, både under Bøker og nederst på hver bokside. Det vises først når serien har minst to bøker.</p>
      </div>

      <div class="card">
        <h3 style="margin-top:0">Omslag</h3>
        <div class="grid2">
          ${imageField('Omslagsbilde', `${p}.cover`, 'Stående bilde (2:3) passer best.')}
          <div class="field"><label>Bokfarge</label>
            <input type="color" data-path="${p}.color" value="${esc(b.color)}">
            <p class="small muted">Brukes på omslaget når boka ikke har et bilde, og i gløden bak boka.</p></div>
        </div>
      </div>

      <div class="card">
        ${langField('Om boka', `${p}.blurb`, true)}
        ${langField('Utdrag (valgfritt)', `${p}.excerpt`, true)}
        <p class="small muted">Hold utdraget kort – et par avsnitt. Tom linje mellom avsnittene.</p>
      </div>

      <div class="card">
        <h3 style="margin-top:0">Kjøp og les</h3>
        ${linksEditor(`${p}.links`, true)}
      </div>

      <div class="card">
        <h3 style="margin-top:0">Innholdsadvarsler</h3>
        ${langField('Én per linje', `${p}.warnings`, true)}
        <p class="small muted">F.eks. «Kidnapping». Vises sammenbrettet på boksiden, så bare de som vil se dem, åpner listen. Tomt = vises ikke.</p>
      </div>

      <div class="card">
        <h3 style="margin-top:0">Hva leserne sier</h3>
        ${reviewsEditor(`${p}.reviews`)}
      </div>

      <div class="card" style="border-color:rgba(194,26,43,.4)">
        <h3 style="margin-top:0">Slett bok</h3>
        <p class="small muted">Vil du bare skjule boka en stund? Bruk «Skjult» under Status i stedet.</p>
        <button class="danger" data-act="delete-book" data-i="${i}">Slett ${esc(b.title.en || 'boka')}</button>
      </div>`;
  }

  const editionsEditor = (path) => {
    const list = getPath(path);
    return `<div class="field"><label>Utgaver (valgfritt)</label>
      ${list.map((e, i) => `
        <div class="list-item" style="grid-template-columns:1fr">
          <div class="grid2">
            <div><label>Utgave</label><input type="text" data-path="${path}.${i}.name" value="${esc(e.name)}" placeholder="Paperback"></div>
            ${dateField('Utgitt', `${path}.${i}.release`)}
          </div>
          <div class="tools">
            <button class="icon" data-act="move" data-path="${path}" data-i="${i}" data-d="-1" aria-label="Flytt opp" ${i === 0 ? 'disabled' : ''}>↑</button>
            <button class="icon" data-act="move" data-path="${path}" data-i="${i}" data-d="1" aria-label="Flytt ned" ${i === list.length - 1 ? 'disabled' : ''}>↓</button>
            <button class="icon danger" data-act="remove" data-path="${path}" data-i="${i}" aria-label="Slett">✕</button>
          </div>
        </div>`).join('')}
      <button data-act="add-edition" data-path="${path}">＋ Legg til utgave</button>
      <p class="small muted">Har boka kommet ut flere ganger, f.eks. Paperback og Kindle, vises hver utgave med sin dato på boksiden i stedet for «Utgitt». Skriv navnet på engelsk. Sett «Utgitt / kommer» over til den første datoen.</p>
    </div>`;
  };

  const reviewsEditor = (path) => {
    const list = getPath(path);
    return `<div class="field">
      ${list.map((r, i) => `
        <div class="list-item" style="grid-template-columns:1fr">
          <div><label>Sitat</label><textarea data-path="${path}.${i}.quote.en" placeholder="I couldn't put it down …">${esc(r.quote.en)}</textarea></div>
          <div class="grid2">
            <div><label>Hvem / hvor</label><input type="text" data-path="${path}.${i}.source" value="${esc(r.source)}" placeholder="Amazon reader"></div>
            <div><label>Stjerner</label>
              <select data-path="${path}.${i}.stars">
                ${['', '5', '4', '3', '2', '1'].map((v) => `<option value="${v}" ${r.stars === v ? 'selected' : ''}>${v ? '★'.repeat(+v) : 'Ingen'}</option>`).join('')}
              </select></div>
          </div>
          <div class="tools">
            <button class="icon" data-act="move" data-path="${path}" data-i="${i}" data-d="-1" aria-label="Flytt opp" ${i === 0 ? 'disabled' : ''}>↑</button>
            <button class="icon" data-act="move" data-path="${path}" data-i="${i}" data-d="1" aria-label="Flytt ned" ${i === list.length - 1 ? 'disabled' : ''}>↓</button>
            <button class="icon danger" data-act="remove" data-path="${path}" data-i="${i}" aria-label="Slett">✕</button>
          </div>
        </div>`).join('')}
      <button data-act="add-review" data-path="${path}">＋ Legg til anmeldelse</button>
      <p class="small muted">Korte sitater fra anmeldelser på Amazon, Goodreads, TikTok og lignende. Vises under utdraget på boksiden.</p>
    </div>`;
  };

  function renderPost(i) {
    const n = data.news[i];
    if (!n) { view = 'general'; renderNav(); return renderEditor(); }
    const p = `news.${i}`;
    $('#editor').innerHTML = `
      <div class="row" style="justify-content:space-between;margin-bottom:12px">
        <h2 style="margin:0">📰 ${esc(n.title.en || 'Ny nyhet')}</h2>
        <a class="btn" href="../news/${encodeURIComponent(n.id)}/" target="_blank" rel="noopener">Se ↗</a>
      </div>
      <div class="card">
        ${langField('Overskrift', `${p}.title`)}
        <div class="grid2">
          ${dateField('Dato', p)}
          ${textField('Nettadresse-navn (id)', `${p}.id`, 'pattern="[a-z0-9-]+"')}
        </div>
        <div class="field"><label>Vis en bok (valgfritt)</label>
          <select data-path="${p}.book">
            <option value="">Ingen – bruk bildet under</option>
            ${data.books.map((b) => `<option value="${esc(b.id)}" ${n.book === b.id ? 'selected' : ''}>${esc(b.title.en || b.id)}</option>`).join('')}
          </select>
          <p class="small muted">Velger du en bok, vises den i 3D med omslaget (som på boksiden) i stedet for bildet.</p></div>
        ${n.book ? '' : imageField('Bilde (valgfritt)', `${p}.image`, 'Liggende bilde passer best.')}
        ${langField('Tekst', `${p}.text`, true)}
        <p class="small muted">Tom linje mellom avsnittene. Nyeste dato vises først på siden.</p>
      </div>
      <div class="card">
        <h3 style="margin-top:0">Knapp (valgfritt)</h3>
        <div class="grid2">
          ${langField('Tekst på knappen', `${p}.link.label`)}
          ${textField('Lenke', `${p}.link.url`, 'placeholder="https://…"')}
        </div>
        <p class="small muted">F.eks. «Buy the book» med lenke til Amazon. Tom lenke = ingen knapp.</p>
      </div>
      <div class="card" style="border-color:rgba(194,26,43,.4)">
        <h3 style="margin-top:0">Slett nyhet</h3>
        <button class="danger" data-act="delete-post" data-i="${i}">Slett ${esc(n.title.en || 'nyheten')}</button>
      </div>`;
  }

  function renderEvent(i) {
    const e = data.events[i];
    if (!e) { view = 'general'; renderNav(); return renderEditor(); }
    const p = `events.${i}`;
    $('#editor').innerHTML = `
      <div class="row" style="justify-content:space-between;margin-bottom:12px">
        <h2 style="margin:0">📅 ${esc(e.title.en || 'Nytt arrangement')}</h2>
        <a class="btn" href="../events/" target="_blank" rel="noopener">Se ↗</a>
      </div>
      <div class="card">
        ${langField('Navn', `${p}.title`)}
        <div class="grid2">
          <div class="field"><label>Dato</label><input type="date" data-path="${p}.date" value="${esc(e.date)}"></div>
          ${textField('Klokkeslett (valgfritt)', `${p}.time`, 'placeholder="7 pm EST"')}
        </div>
        ${textField('Sted', `${p}.place`, 'placeholder="Online – TikTok Live"')}
        ${langField('Om arrangementet (valgfritt)', `${p}.text`, true)}
        <p class="small muted">Arrangementer med dato fram i tid vises under «Upcoming» og på forsiden. Når datoen har vært, flyttes de automatisk til «Past events».</p>
      </div>
      <div class="card">
        <h3 style="margin-top:0">Knapp (valgfritt)</h3>
        <div class="grid2">
          ${langField('Tekst på knappen', `${p}.link.label`)}
          ${textField('Lenke', `${p}.link.url`, 'placeholder="https://…"')}
        </div>
        <p class="small muted">F.eks. «Get tickets» eller «Watch live». Tom lenke = ingen knapp.</p>
      </div>
      <div class="card" style="border-color:rgba(194,26,43,.4)">
        <h3 style="margin-top:0">Slett arrangement</h3>
        <button class="danger" data-act="delete-event" data-i="${i}">Slett ${esc(e.title.en || 'arrangementet')}</button>
      </div>`;
  }

  function renderAlbum(i) {
    const a = data.music.albums[i];
    if (!a) { view = 'general'; renderNav(); return renderEditor(); }
    const p = `music.albums.${i}`;
    const albums = data.music.albums;
    $('#editor').innerHTML = `
      <div class="row" style="justify-content:space-between;margin-bottom:12px">
        <h2 style="margin:0">♪ ${esc(a.title.en || 'Nytt album')}</h2>
        <div class="row">
          <button class="icon" data-act="move-album" data-i="${i}" data-d="-1" ${i === 0 ? 'disabled' : ''} title="Flytt opp i rekkefølgen">↑</button>
          <button class="icon" data-act="move-album" data-i="${i}" data-d="1" ${i === albums.length - 1 ? 'disabled' : ''} title="Flytt ned i rekkefølgen">↓</button>
          <a class="btn" href="../music/" target="_blank" rel="noopener">Se ↗</a>
        </div>
      </div>

      <div class="card">
        ${langField('Albumnavn', `${p}.title`)}
        <div class="grid2">
          ${textField('Artist', `${p}.artist`)}
          ${textField('År', `${p}.year`, 'maxlength="12"')}
        </div>
        ${langField('Merkelapp (valgfritt)', `${p}.tag`)}
        ${langField('Om albumet (valgfritt)', `${p}.description`, true)}
        ${imageField('Albumcover', `${p}.cover`, 'Kvadratisk bilde passer best. Tomt = et fargerikt cover med albumnavnet lages automatisk.')}
        ${textField('Nettadresse-navn (id)', `${p}.id`, 'pattern="[a-z0-9]+(-[a-z0-9]+)*"')}
        <p class="small muted">Brukes også som mappenavn for lydfilene: <code>musikk/${esc(a.id || '…')}/</code>. Endrer du den, flyttes filene når du publiserer.</p>
      </div>

      <div class="card">
        <h3 style="margin-top:0">Spor</h3>
        ${a.tracks.map((tk, j) => `
          <div class="track-item">
            <span class="track-num">${j + 1}</span>
            <input type="text" data-path="${p}.tracks.${j}.title" value="${esc(tk.title)}" placeholder="Sangtittel" aria-label="Tittel på spor ${j + 1}">
            <audio controls preload="none" src="${esc(imgSrc(tk.src))}"></audio>
            <div class="tools">
              <button class="icon" data-act="move" data-path="${p}.tracks" data-i="${j}" data-d="-1" aria-label="Flytt opp" ${j === 0 ? 'disabled' : ''}>↑</button>
              <button class="icon" data-act="move" data-path="${p}.tracks" data-i="${j}" data-d="1" aria-label="Flytt ned" ${j === a.tracks.length - 1 ? 'disabled' : ''}>↓</button>
              <button class="icon danger" data-act="remove" data-path="${p}.tracks" data-i="${j}" aria-label="Fjern spor">✕</button>
            </div>
          </div>`).join('')}
        <div class="dropzone" data-act="add-tracks" data-kind="audio" data-path="${p}.tracks" tabindex="0" role="button" style="min-height:120px;margin-top:10px">
          <div><div style="font-size:2rem">♪</div>Klikk eller dra lydfiler hit<br><span class="small">MP3, M4A, OGG, WAV eller FLAC · maks ${MAX_AUDIO_MB} MB per fil</span></div>
        </div>
        <p class="small muted">Tittelen hentes fra filnavnet, men du kan endre den. MP3 gir minst filer og virker overalt.</p>
      </div>

      <div class="card" style="border-color:rgba(194,26,43,.4)">
        <h3 style="margin-top:0">Slett album</h3>
        <button class="danger" data-act="delete-album" data-i="${i}">Slett ${esc(a.title.en || 'albumet')}</button>
      </div>`;
  }

  // ---------- Hendelser ----------

  function onInput(e) {
    const el = e.target;
    if (el.dataset.cal) return onCalInput(el);
    const path = el.dataset.path;
    if (!path) return;
    let value = el.value;
    if (path.endsWith('.id')) {
      value = slug(value, path.startsWith('music.') ? 'album' : path.startsWith('news.') ? 'nyhet' : 'bok');
      if (e.type === 'change') el.value = value;
    }
    if (getPath(path) === value) return;
    setPath(path, value);
    markDirty();
    if (/^books\.\d+\.(title\.en|status)$|^music\.albums\.\d+\.title\.en$|^news\.\d+\.title\.en$|^events\.\d+\.(title\.en|date)$/.test(path)) {
      renderNav();
      if (view.startsWith('book:') && e.type === 'change') renderEditor();
    }
    if (path === 'newsletter.provider' || /^news\.\d+\.book$/.test(path)) renderEditor();
  }

  async function onAction(e) {
    const btn = e.target.closest('[data-act]');
    if (!btn || btn.disabled) return;
    const { act, path } = btn.dataset;
    const i = +btn.dataset.i;
    const d = +btn.dataset.d;
    const list = path ? getPath(path) : null;
    const refresh = () => { markDirty(); renderNav(); renderEditor(); };

    if (act.startsWith('cal-')) {
      const o = getPath(btn.dataset.obj);
      if (act === 'cal-toggle') {
        cal = cal.obj === btn.dataset.obj ? { obj: null, ym: '' } : { obj: btn.dataset.obj, ym: (o.date || isoToday()).slice(0, 7) };
      } else if (act === 'cal-month') {
        const [y, m] = cal.ym.split('-').map(Number);
        const t = new Date(Date.UTC(y, m - 1 + d, 1));
        cal.ym = `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}`;
      } else if (act === 'cal-day') {
        o.date = btn.dataset.date;
        if (btn.dataset.year) setPath(btn.dataset.year, usDate(o.date)); // lesbar reserve for eldre kode
        markDirty();
      } else if (act === 'cal-ampm') {
        const [h, m] = (o.time || '12:00').split(':').map(Number);
        const hh = (h % 12) + (btn.dataset.v === 'PM' ? 12 : 0);
        o.time = `${String(hh).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
        markDirty();
      } else if (act === 'cal-clear') {
        o.date = ''; o.time = '';
        if (btn.dataset.year) setPath(btn.dataset.year, '');
        cal = { obj: null, ym: '' };
        markDirty();
      }
      renderEditor();
      return;
    }

    switch (act) {
      case 'upload': {
        const [file] = await pickFiles(false);
        if (!file) return;
        try {
          setPath(path, await uploadImage(file, imageHint(path)));
          refresh();
        } catch (err) { toast(friendlyError(err), true); }
        break;
      }
      case 'clear': setPath(path, ''); refresh(); break;
      case 'add-fact': list.push({ label: { no: '', en: '' }, value: { no: '', en: '' } }); refresh(); break;
      case 'add-color': list.push('#ffffff'); refresh(); break;
      case 'remove':
        if (path.endsWith('.gallery') && !confirm('Fjerne bildet fra galleriet?')) return;
        if (path.endsWith('.tracks') && !confirm(`Fjerne «${list[i].title || 'sporet'}» fra albumet?\n\nLydfilen slettes også når du publiserer.`)) return;
        list.splice(i, 1); refresh(); break;
      case 'move': {
        const j = i + d;
        if (j < 0 || j >= list.length) return;
        [list[i], list[j]] = [list[j], list[i]]; refresh(); break;
      }
      case 'move-book': {
        const j = i + d;
        const list2 = data.books;
        [list2[i], list2[j]] = [list2[j], list2[i]];
        view = `book:${j}`; refresh(); break;
      }
      case 'add-edition': list.push({ name: '', release: { date: '', time: '', tz: '' } }); refresh(); break;
      case 'add-review': list.push({ quote: { no: '', en: '' }, source: '', stars: '' }); refresh(); break;
      case 'delete-event': {
        const ev = data.events[i];
        if (!confirm(`Slette «${ev.title.en || 'arrangementet'}»?`)) return;
        data.events.splice(i, 1);
        view = 'general'; refresh(); break;
      }
      case 'delete-post': {
        const n = data.news[i];
        if (!confirm(`Slette nyheten «${n.title.en || 'uten tittel'}»?`)) return;
        data.news.splice(i, 1);
        view = 'general'; refresh(); break;
      }
      case 'add-link':
        list.push(btn.dataset.bilingual === '1' ? { label: { no: '', en: '' }, url: '' } : { label: '', url: '' });
        refresh(); break;
      case 'move-album': {
        const j = i + d;
        const albums = data.music.albums;
        [albums[i], albums[j]] = [albums[j], albums[i]];
        view = `album:${j}`; refresh(); break;
      }
      case 'add-tracks': {
        const files = await pickFiles(true, 'audio/*,.mp3,.m4a,.aac,.ogg,.oga,.wav,.flac');
        await addTracks(path, files);
        break;
      }
      case 'delete-album': {
        const a = data.music.albums[i];
        if (!confirm(`Slette albumet «${a.title.en || 'uten navn'}»?\n\nLydfilene i albumet slettes også når du publiserer.`)) return;
        data.music.albums.splice(i, 1);
        view = 'general'; refresh(); break;
      }
      case 'add-gallery': {
        const files = await pickFiles(true);
        await addToGallery(path, files);
        break;
      }
      case 'delete-book': {
        const b = data.books[i];
        if (!confirm(`Slette «${b.title.en || 'boka'}» for godt? (Du kan fortsatt hente den tilbake fra GitHub-historikken.)`)) return;
        data.books.splice(i, 1);
        view = 'general'; refresh(); break;
      }
      case 'disconnect':
        if (dirty && !confirm('Du har ulagrede endringer. Logge ut likevel?')) return;
        dirty = false; data = null; backend.logout(); break;
    }
  }

  function imageHint(path) {
    const m = path.match(/^books\.(\d+)/);
    if (m) return data.books[+m[1]].id || 'bok';
    const n = path.match(/^news\.(\d+)/);
    if (n) return data.news[+n[1]].id || 'nyhet';
    const a = path.match(/^music\.albums\.(\d+)/);
    if (a) return data.music.albums[+a[1]].id || 'album';
    return path.split('.')[0];
  }

  async function addTracks(path, files) {
    const audios = files.filter(isAudio);
    if (!audios.length) { if (files.length) toast('Fant ingen lydfiler blant filene.', true); return; }
    const list = getPath(path);
    let done = 0;
    busy++; updateStatus(); // Publiser er låst til alle sporene er lagt til
    try {
      for (const file of audios) {
        try {
          const duration = await audioDuration(file);
          const src = await uploadAudio(file, imageHint(path));
          list.push({ title: niceTitle(file.name), src, ...(duration ? { duration } : {}) });
          done++;
          markDirty(); renderNav(); renderEditor();
        } catch (err) { toast(friendlyError(err), true); }
      }
    } finally {
      busy--; updateStatus();
    }
    if (done) toast(`${done} spor lastet opp. Husk å trykke Publiser!`);
  }

  async function addToGallery(path, files) {
    const images = files.filter((f) => f.type.startsWith('image/'));
    if (!images.length) return;
    const list = getPath(path);
    let done = 0;
    for (const file of images) {
      try {
        const src = await uploadImage(file, imageHint(path));
        list.push({ src, caption: { no: '', en: '' } });
        done++;
        markDirty(); renderEditor();
      } catch (err) { toast(friendlyError(err), true); }
    }
    if (done) toast(`${done} bilde${done > 1 ? 'r' : ''} lastet opp. Husk å trykke Publiser!`);
  }

  function onDrop(e) {
    const dz = e.target.closest('.dropzone');
    if (!dz) return;
    e.preventDefault();
    dz.classList.remove('over');
    if (dz.dataset.kind === 'audio') addTracks(dz.dataset.path, [...e.dataTransfer.files]);
    else addToGallery(dz.dataset.path, [...e.dataTransfer.files]);
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.classList?.contains('dropzone')) e.target.click();
    if ((e.ctrlKey || e.metaKey) && e.key === 's' && data) { e.preventDefault(); publish(); }
  });

  function addBook() {
    const n = data.books.length + 1;
    data.books.push({
      id: `bok-${n}`, title: { no: 'Ny bok', en: 'New book' }, status: 'hidden', year: '', pages: '', cover: '', color: '#23203a',
      series: { no: '', en: '' }, seriesNo: '', genre: { no: '', en: '' }, blurb: { no: '', en: '' }, excerpt: { no: '', en: '' }, links: [],
      warnings: { no: '', en: '' }, reviews: [], release: { date: '', time: '', tz: '' },
    });
    view = `book:${data.books.length - 1}`;
    markDirty(); renderNav(); renderEditor();
    toast('Ny bok lagt til som «Skjult» – bytt status når den skal vises.');
  }

  function addPost() {
    const today = new Date();
    const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    let id = `nyhet-${date}`;
    for (let n = 2; data.news.some((x) => x.id === id); n++) id = `nyhet-${date}-${n}`;
    data.news.unshift({ id, date, time: '', tz: '', image: '', book: '', title: { no: '', en: 'New post' }, text: { no: '', en: '' }, link: { label: { no: '', en: '' }, url: '' } });
    view = 'post:0';
    markDirty(); renderNav(); renderEditor();
  }

  function addEvent() {
    data.events.unshift({ date: '', time: '', place: '', title: { no: '', en: 'New event' }, text: { no: '', en: '' }, link: { label: { no: '', en: '' }, url: '' } });
    view = 'event:0';
    markDirty(); renderNav(); renderEditor();
  }

  function addAlbum() {
    const n = data.music.albums.length + 1;
    data.music.albums.push({
      id: `album-${n}`, title: { no: 'Nytt album', en: 'New album' }, artist: 'Ellie Cast', tag: { no: '', en: '' },
      year: String(new Date().getFullYear()), cover: '', description: { no: '', en: '' }, tracks: [],
    });
    view = `album:${data.music.albums.length - 1}`;
    markDirty(); renderNav(); renderEditor();
  }

  // ---------- Publisering ----------

  function validate() {
    const ids = new Set();
    for (const b of data.books) {
      if (!b.title.no.trim() && !b.title.en.trim()) return 'En bok mangler tittel.';
      if (!b.id) return `«${b.title.en}» mangler nettadresse-navn (id).`;
      if (ids.has(b.id)) return `To bøker har samme id: «${b.id}». Gi dem forskjellige.`;
      ids.add(b.id);
    }
    const postIds = new Set();
    for (const n of data.news) {
      if (!n.title.en.trim()) return 'En nyhet mangler overskrift.';
      if (!n.id) return `Nyheten «${n.title.en}» mangler nettadresse-navn (id).`;
      if (postIds.has(n.id)) return `To nyheter har samme id: «${n.id}». Gi dem forskjellige.`;
      postIds.add(n.id);
    }
    for (const e of data.events) {
      if (!e.title.en.trim()) return 'Et arrangement mangler navn.';
      if (!e.date) return `«${e.title.en}» mangler dato.`;
    }
    const albumIds = new Set();
    for (const a of data.music.albums) {
      if (!a.id) return `Albumet «${a.title.en}» mangler nettadresse-navn (id).`;
      if (!ALBUM_ID.test(a.id) || a.id.length > 80) return `Id-en «${a.id}» kan bare ha små bokstaver, tall og bindestrek (f.eks. «mitt-album»).`;
      if (albumIds.has(a.id)) return `To album har samme id: «${a.id}». Gi dem forskjellige.`;
      albumIds.add(a.id);
    }
    return null;
  }

  async function publish() {
    if (busy) return;
    const problem = validate();
    if (problem) return toast(problem, true);
    busy++; updateStatus('Publiserer …');
    try {
      const next = structuredClone(data);
      const files = planMusicFiles(published, next);
      await backend.save(next, files);
      // Bare stiene til flyttede lydfiler endres i det du redigerer, så endringer gjort mens den publiserte går ikke tapt.
      const moved = Object.fromEntries(files.moves.map((m) => [m.from, m.to]));
      for (const a of data.music.albums) {
        for (const t of a.tracks) {
          if (!moved[t.src]) continue;
          if (previews[t.src]) previews[moved[t.src]] = previews[t.src];
          t.src = moved[t.src];
        }
      }
      published = next;
      sessionAudio.clear();
      dirty = false;
      if (files.moves.length) renderEditor();
      toast(backend.publishedMsg);
    } catch (err) {
      toast(friendlyError(err), true);
    } finally {
      busy--; updateStatus();
    }
  }

  window.addEventListener('beforeunload', (e) => {
    if (dirty || busy) { e.preventDefault(); e.returnValue = ''; }
  });

  // ---------- Toast ----------

  let toastTimer;
  function toast(msg, isErr) {
    const el = $('#toast');
    el.textContent = msg;
    el.className = 'toast show' + (isErr ? ' err' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), isErr ? 6000 : 3500);
  }

  // ---------- Start ----------

  backend.start();
})();
