// Ellie Cast – forfatterside. Alt innhold ligger i data/site.json og redigeres i admin/.

(() => {
  const UI = {
    en: {
      nav_books: 'Books', nav_music: 'Music', nav_about: 'About Ellie', nav_contact: 'Contact',
      books: 'The books', all_books: 'All books', see_books: 'See the books', about_me: 'About Ellie', read_more: 'Read more',
      latest: 'Latest book', read_about: 'About the book', upcoming: 'Coming', coming: 'Coming soon', pages: 'Pages', year: 'Published', genre: 'Genre', series: 'Series',
      excerpt: 'Excerpt', back: '← All books', more_books: 'More books', contact: 'Contact', say_hi: 'Say hello', write: 'Send an email',
      music: 'Music', music_lead: 'Listen while you read. The music keeps playing as you move around the site.', listen: 'Listen now',
      all_music: '← All music', play: 'Play', pause: 'Pause', shuffle_play: 'Shuffle', song: 'song', songs: 'songs', minutes: 'min',
      prev: 'Previous', next: 'Next', shuffle: 'Shuffle', repeat_off: 'Repeat: off', repeat_all: 'Repeat: all', repeat_one: 'Repeat: this song',
      queue: 'Show queue', up_next: 'Up next', close_player: 'Close player', volume: 'Volume', seek: 'Seek',
      search: 'Search for a song or album …', results: 'results', no_results: 'Nothing found. Try another word.',
      not_found: "Couldn't find that page.", go_home: 'Go home', load_error: "Couldn't load the content.",
      to_light: 'Switch to light theme', to_dark: 'Switch to dark theme', menu: 'Menu', role: 'Author',
    },
  };

  const store = {
    get(k) { try { return localStorage.getItem('ec-' + k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem('ec-' + k, v); } catch (e) {} },
  };

  let data = null;
    const $ = (s, el = document) => el.querySelector(s);
  const main = $('#main');
  const t = (k) => UI.en[k] || k;
  const tr = (v) => (v && typeof v === 'object') ? (v.en || v.no || '') : (v || '');
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const paragraphs = (text) => esc(text).split(/\n\s*\n/).filter((p) => p.trim()).map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('');
  const safeColor = (c) => /^#[0-9a-f]{3,8}$/i.test(c || '') ? c : '#23203a';
  const safeUrl = (u) => /^(https?:|mailto:)/i.test(u || '') ? u : '';
  const fold = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
  const fmt = (sec) => {
    if (!isFinite(sec) || sec < 0) return '0:00';
    return `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
  };

  const books = () => (data.books || []).filter((b) => b.status !== 'hidden');
  const featured = () => books().find((b) => b.status === 'published') || books()[0];

  // ---------- Musikkdata ----------

  const playable = (album) => (album.tracks || []).filter((tk) => tk.src);
  const albums = () => ((data && data.music && data.music.albums) || []).filter((a) => playable(a).length);
  const ref = (album, ti) => ({ album, ti, track: playable(album)[ti], key: `${album.id}:${ti}` });
  const albumRefs = (album) => playable(album).map((_, ti) => ref(album, ti));
  const allRefs = () => albums().flatMap(albumRefs);
  const trackTitle = (r) => r.track.title || `${t('song')} ${r.ti + 1}`;
  const totalMin = (tracks) => Math.round(tracks.reduce((n, tk) => n + (+tk.duration || 0), 0) / 60);
  const countText = (n) => `${n} ${n === 1 ? t('song') : t('songs')}`;

  // ---------- Omslag ----------
  // Bøker og album uten eget bilde får et typografisk omslag i sin egen farge.

  function bookHTML(b) {
    const inner = b.cover
      ? `<img src="${esc(b.cover)}" alt="${esc(tr(b.title))}" loading="lazy">`
      : `<div class="gen-cover"><span class="gc-title">${esc(tr(b.title))}</span><span class="gc-author">${esc(data.site.name)}</span></div>`;
    return `<div class="book" style="--b:${safeColor(b.color)}">${inner}</div>`;
  }

  const ALBUM_COLORS = [['#7b6cff', '#3fa9ff'], ['#ff7ab0', '#7b6cff'], ['#3fd0c9', '#3f6bff'], ['#ffb86b', '#ff6b8b'], ['#9b8cff', '#2c2a5a']];
  function albumCover(a) {
    if (a.cover) return `<img src="${esc(a.cover)}" alt="${esc(tr(a.title))}" loading="lazy">`;
    const i = (data.music.albums || []).indexOf(a);
    const [c1, c2] = ALBUM_COLORS[(i < 0 ? 0 : i) % ALBUM_COLORS.length];
    return `<div class="gen-album" style="--c1:${c1};--c2:${c2}"><span class="ga-note" aria-hidden="true">♪</span><span class="ga-title">${esc(tr(a.title))}</span></div>`;
  }

  // ---------- Sider ----------

  const metaLine = (b) => [b.status === 'upcoming' ? `${t('upcoming')} ${b.year || ''}`.trim() : b.year, tr(b.genre)].filter(Boolean).map(esc).join(' · ');

  function bookCard(b, i = 0) {
    return `
      <a class="book-card reveal" href="#/book/${encodeURIComponent(b.id)}" style="--d:${i * 70}ms">
        <div class="book-wrap">${bookHTML(b)}${b.status === 'upcoming' ? `<span class="badge">${t('coming')}</span>` : ''}</div>
        <h3>${esc(tr(b.title))}</h3>
        ${metaLine(b) ? `<p class="meta">${metaLine(b)}</p>` : ''}
      </a>`;
  }

  function viewHome() {
    const s = data.site;
    const f = featured();
    const a = data.about || {};
    const music = albums();
    return `
      <section class="hero">
        <div class="hero-text reveal">
          <span class="pill">${esc(tr(s.role))}</span>
          <h1>${esc(s.name).replace(/ (\S+)$/, ' <em>$1</em>')}</h1>
          <p class="lead">${esc(tr(s.tagline))}</p>
          <div class="actions">
            <a class="btn" href="#/books">${t('see_books')} <span aria-hidden="true">→</span></a>
            <a class="btn ghost" href="#/about">${t('about_me')}</a>
          </div>
        </div>
        ${f ? `
        <a class="hero-book reveal" href="#/book/${encodeURIComponent(f.id)}" style="--d:150ms" data-tilt>
          <div class="hero-halo" style="--b:${safeColor(f.color)}"></div>
          ${bookHTML(f)}
        </a>` : ''}
      </section>

      <section class="bento">
        ${f ? `
        <a class="tile tile-book glass reveal" href="#/book/${encodeURIComponent(f.id)}">
          <span class="pill">${t('latest')}</span>
          <h2>${esc(tr(f.title))}</h2>
          <p>${esc(tr(f.blurb).split(/\n\s*\n/)[0])}</p>
          <span class="link">${t('read_about')} →</span>
        </a>` : ''}
        ${tr(s.quote) ? `
        <figure class="tile tile-quote glass reveal" style="--d:80ms">
          <blockquote>${esc(tr(s.quote))}</blockquote>
          ${tr(s.quoteSource) ? `<figcaption>${esc(tr(s.quoteSource))}</figcaption>` : ''}
        </figure>` : ''}
        <a class="tile tile-about glass reveal" href="#/about" style="--d:160ms">
          <div class="avatar">${a.image ? `<img src="${esc(a.image)}" alt="">` : '<span>EC</span>'}</div>
          <div>
            <h3>${t('about_me')}</h3>
            <p>${esc(tr(a.short))}</p>
          </div>
        </a>
        ${music.length ? `
        <div class="tile tile-music glass reveal" style="--d:240ms">
          <div class="mini-cover">${albumCover(music[0])}</div>
          <div>
            <h3>${t('music')}</h3>
            <p>${countText(allRefs().length)}</p>
            <button class="btn small" data-play-album="0">▶ ${t('listen')}</button>
          </div>
        </div>` : ''}
      </section>

      <section class="section">
        <div class="section-head">
          <h2>${t('books')}</h2>
          <a class="link" href="#/books">${t('all_books')} →</a>
        </div>
        <div class="shelf">${books().map(bookCard).join('')}</div>
      </section>

      ${contactHTML()}`;
  }

  function viewBooks() {
    return `
      <div class="page-head reveal"><span class="pill">${esc(data.site.name)}</span><h1>${t('books')}</h1></div>
      <div class="shelf large">${books().map(bookCard).join('')}</div>`;
  }

  function viewBook(id) {
    const b = books().find((x) => x.id === id);
    if (!b) return viewNotFound();
    const links = (b.links || []).filter((l) => safeUrl(l.url));
    const facts = [[t('series'), tr(b.series)], [b.status === 'upcoming' ? t('upcoming') : t('year'), b.year], [t('genre'), tr(b.genre)], [t('pages'), b.pages]].filter(([, v]) => v);
    const others = books().filter((x) => x !== b);
    return `
      <a class="back" href="#/books">${t('back')}</a>
      <article class="book-page">
        <div class="book-page-cover reveal" data-tilt><div class="hero-halo" style="--b:${safeColor(b.color)}"></div>${bookHTML(b)}</div>
        <div class="book-page-info glass reveal" style="--d:120ms">
          ${b.status === 'upcoming' ? `<span class="pill accent">${t('coming')}</span>` : ''}
          <h1>${esc(tr(b.title))}</h1>
          <p class="byline">${esc(data.site.name)}</p>
          <div class="prose">${paragraphs(tr(b.blurb))}</div>
          ${facts.length ? `<dl class="facts">${facts.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>` : ''}
          ${links.length ? `<div class="actions">${links.map((l, i) => `<a class="btn ${i ? 'ghost' : ''}" href="${esc(safeUrl(l.url))}" target="_blank" rel="noopener">${esc(tr(l.label))}</a>`).join('')}</div>` : ''}
        </div>
      </article>
      ${tr(b.excerpt) ? `
      <section class="excerpt reveal">
        <span class="pill">${t('excerpt')}</span>
        <div class="excerpt-text">${paragraphs(tr(b.excerpt))}</div>
      </section>` : ''}
      ${others.length ? `
      <section class="section">
        <div class="section-head"><h2>${t('more_books')}</h2></div>
        <div class="shelf">${others.map(bookCard).join('')}</div>
      </section>` : ''}`;
  }

  function viewAbout() {
    const a = data.about || {};
    const s = data.site;
    return `
      <section class="about">
        <div class="portrait reveal">${a.image ? `<img src="${esc(a.image)}" alt="${esc(s.name)}">` : '<span>EC</span>'}</div>
        <div class="about-text reveal" style="--d:120ms">
          <span class="pill">${t('about_me')}</span>
          <h1>${esc(s.name)}</h1>
          <div class="prose">${paragraphs(tr(a.text))}</div>
          ${(a.facts || []).length ? `<dl class="facts">${a.facts.map((f) => `<div><dt>${esc(tr(f.label))}</dt><dd>${esc(tr(f.value))}</dd></div>`).join('')}</dl>` : ''}
        </div>
      </section>
      ${contactHTML()}`;
  }

  function contactHTML() {
    const c = data.contact || {};
    const links = (c.links || []).filter((l) => safeUrl(l.url));
    const email = /^[^\s@]+@[^\s@]+$/.test(c.email || '') ? c.email : '';
    return `
      <section class="contact glass reveal" id="contact">
        <span class="pill">${t('contact')}</span>
        <h2>${t('say_hi')}</h2>
        <p>${esc(tr(c.text))}</p>
        <div class="actions center">
          ${email ? `<a class="btn" href="mailto:${esc(email)}">${t('write')}</a>` : `<span class="btn disabled" aria-disabled="true">${t('write')}</span>`}
          ${links.map((l) => `<a class="btn ghost" href="${esc(safeUrl(l.url))}" target="_blank" rel="noopener">${esc(l.label)}</a>`).join('')}
        </div>
      </section>`;
  }

  function albumCard(a) {
    const ai = albums().indexOf(a);
    const tracks = playable(a);
    return `
      <article class="album-card reveal" style="--d:${ai * 60}ms">
        <a class="album-link" href="#/music/${encodeURIComponent(a.id)}">
          <div class="cover">${albumCover(a)}</div>
          <h3>${esc(tr(a.title))}</h3>
          <p class="meta">${[countText(tracks.length), totalMin(tracks) ? `${totalMin(tracks)} ${t('minutes')}` : ''].filter(Boolean).join(' · ')}</p>
        </a>
        <button class="cover-play" data-play-album="${ai}" aria-label="${t('play')}: ${esc(tr(a.title))}">▶</button>
      </article>`;
  }

  function trackRow(r, n, list) {
    return `
      <li><button class="track" data-key="${esc(r.key)}" data-list="${list}" data-i="${n}">
        <span class="num"><span class="n">${n + 1}</span><span class="eq" aria-hidden="true"><i></i><i></i><i></i></span></span>
        <span class="t"><span class="tt">${esc(trackTitle(r))}</span>${list === 'search' ? `<span class="ta">${esc(tr(r.album.title))}</span>` : ''}</span>
        <span class="d">${r.track.duration ? fmt(r.track.duration) : ''}</span>
      </button></li>`;
  }

  let listContext = {};
  let searchQuery = '';
  function searchResults() {
    const q = fold(searchQuery.trim());
    if (!q) return `<div class="album-grid">${albums().map(albumCard).join('')}</div>`;
    const hits = allRefs().filter((r) => fold(trackTitle(r)).includes(q) || fold(tr(r.album.title)).includes(q));
    listContext.search = hits;
    if (!hits.length) return `<p class="muted">${t('no_results')}</p>`;
    return `<p class="muted">${hits.length} ${t('results')}</p><ol class="tracklist glass">${hits.map((r, i) => trackRow(r, i, 'search')).join('')}</ol>`;
  }

  function viewMusic(id) {
    if (!albums().length) return viewNotFound();
    if (id) {
      const a = albums().find((x) => x.id === id);
      if (!a) return viewNotFound();
      const ai = albums().indexOf(a);
      const refs = albumRefs(a);
      listContext.album = refs;
      return `
        <a class="back" href="#/music">${t('all_music')}</a>
        <section class="album-hero glass reveal">
          <div class="cover big">${albumCover(a)}</div>
          <div>
            ${tr(a.tag) ? `<span class="pill">${esc(tr(a.tag))}</span>` : ''}
            <h1>${esc(tr(a.title))}</h1>
            <p class="muted">${[a.artist, a.year, countText(refs.length), totalMin(refs.map((r) => r.track)) ? `${totalMin(refs.map((r) => r.track))} ${t('minutes')}` : ''].filter(Boolean).map(esc).join(' · ')}</p>
            ${tr(a.description) ? `<div class="prose">${paragraphs(tr(a.description))}</div>` : ''}
            <div class="actions">
              <button class="btn" data-play-album="${ai}">▶ ${t('play')}</button>
              <button class="btn ghost" data-shuffle-album="${ai}">${t('shuffle_play')}</button>
            </div>
          </div>
        </section>
        <ol class="tracklist glass">${refs.map((r, i) => trackRow(r, i, 'album')).join('')}</ol>`;
    }
    return `
      <div class="page-head reveal">
        <span class="pill">${esc(data.site.name)}</span>
        <h1>${t('music')}</h1>
        <p class="muted">${t('music_lead')}</p>
        <label class="search glass"><span aria-hidden="true">⌕</span><input type="search" id="search" placeholder="${t('search')}" value="${esc(searchQuery)}" autocomplete="off" aria-label="${t('search')}"></label>
      </div>
      <div id="results">${searchResults()}</div>`;
  }

  function viewNotFound() {
    return `<div class="page-head"><h1>${t('not_found')}</h1><a class="btn" href="#/">${t('go_home')}</a></div>`;
  }

  // ---------- Adresser og språk ----------
  let lastPath = null;
  function render() {
    if (!data) return;
    const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
    listContext = {};
    let route = 'home', html, title = '';
    if (!parts.length) html = viewHome();
    else if (parts[0] === 'books') { route = 'books'; html = viewBooks(); title = t('books'); }
    else if (parts[0] === 'book' && parts[1]) {
      route = 'books';
      const id = decodeURIComponent(parts[1]);
      html = viewBook(id);
      title = tr(books().find((b) => b.id === id)?.title);
    }
    else if (parts[0] === 'music') {
      route = 'music';
      const id = parts[1] ? decodeURIComponent(parts[1]) : '';
      html = viewMusic(id);
      title = id ? tr(albums().find((a) => a.id === id)?.title) : t('music');
    }
    else if (parts[0] === 'about') { route = 'about'; html = viewAbout(); title = t('about_me'); }
    else if (parts[0] === 'contact') { route = 'contact'; html = viewHome(); }
    else { route = ''; html = viewNotFound(); }

    main.innerHTML = `<div class="view">${html}</div>`;
    observeReveals();
    markPlaying();
    document.querySelectorAll('.nav a').forEach((a) => {
      const on = a.dataset.route === route;
      a.classList.toggle('active', on);
      if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    document.title = title ? `${title} · ${data.site.name}` : `${data.site.name} · ${tr(data.site.role)}`;

    const path = parts.join('/');
    if (route === 'contact') $('#contact')?.scrollIntoView({ behavior: lastPath === null ? 'auto' : 'smooth' });
    else if (path !== lastPath) window.scrollTo(0, 0);
    lastPath = path;
  }

  function applyStaticText() {
    document.querySelectorAll('[data-t]').forEach((el) => { el.textContent = t(el.dataset.t); });
    $('#menuBtn').setAttribute('aria-label', t('menu'));
    $('#footerRole').textContent = data ? tr(data.site.role) : t('role');
    if (data) {
      $('#brandName').textContent = data.site.name;
      document.querySelectorAll('[data-route="music"]').forEach((a) => { a.hidden = !albums().length; });
    }
    updateThemeBtn();
    updatePlayerText();
  }

  // ---------- Inntoning og 3D-vipp ----------

  const io = 'IntersectionObserver' in window
    ? new IntersectionObserver((entries) => entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { rootMargin: '0px 0px -6% 0px' })
    : null;
  function observeReveals() {
    document.querySelectorAll('.reveal').forEach((el) => (io ? io.observe(el) : el.classList.add('in')));
  }

  // Vipper bare for mus. Sjekker selve bevegelsen, fordi noen PC-er (berøringsskjerm, tegnebrett)
  // sier at de ikke har mus selv om de har det.
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
    main.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse') return;
      const el = e.target.closest('[data-tilt]');
      if (!el) return;
      const r = el.getBoundingClientRect();
      el.style.setProperty('--rx', `${((e.clientY - r.top) / r.height - .5) * -10}deg`);
      el.style.setProperty('--ry', `${((e.clientX - r.left) / r.width - .5) * 12}deg`);
    });
    main.addEventListener('pointerout', (e) => {
      const el = e.target.closest('[data-tilt]');
      if (el && !el.contains(e.relatedTarget)) { el.style.removeProperty('--rx'); el.style.removeProperty('--ry'); }
    });
  }

  // ---------- Klikk ----------

  main.addEventListener('click', (e) => {
    const list = albums();
    const pa = e.target.closest('[data-play-album]');
    if (pa) { const a = list[+pa.dataset.playAlbum]; if (a) playList(albumRefs(a), 0, false); return; }
    const sa = e.target.closest('[data-shuffle-album]');
    if (sa) { const a = list[+sa.dataset.shuffleAlbum]; if (a) { const refs = albumRefs(a); playList(refs, Math.floor(Math.random() * refs.length), true); } return; }
    const tb = e.target.closest('.track[data-key]');
    if (tb) {
      if (now() && now().key === tb.dataset.key) { togglePlay(); return; }
      playList(listContext[tb.dataset.list] || [], +tb.dataset.i, null);
    }
  });
  main.addEventListener('input', (e) => {
    if (e.target.id !== 'search') return;
    searchQuery = e.target.value;
    $('#results').innerHTML = searchResults();
    observeReveals();
    markPlaying();
  });

  // ---------- Tema, språk og meny ----------

  const darkQuery = matchMedia('(prefers-color-scheme: dark)');
  const currentTheme = () => document.documentElement.dataset.theme || (darkQuery.matches ? 'dark' : 'light');
  function updateThemeBtn() {
    const dark = currentTheme() === 'dark';
    const btn = $('#themeBtn');
    btn.textContent = dark ? '☀' : '☾';
    btn.setAttribute('aria-label', t(dark ? 'to_light' : 'to_dark'));
    btn.title = t(dark ? 'to_light' : 'to_dark');
  }
  $('#themeBtn').addEventListener('click', () => {
    const next = currentTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    store.set('theme', next);
    updateThemeBtn();
  });
  darkQuery.addEventListener('change', updateThemeBtn);

  const nav = $('#nav');
  const menuBtn = $('#menuBtn');
  menuBtn.addEventListener('click', () => { const open = nav.classList.toggle('open'); menuBtn.setAttribute('aria-expanded', open); });
  nav.addEventListener('click', (e) => { if (e.target.closest('a')) { nav.classList.remove('open'); menuBtn.setAttribute('aria-expanded', 'false'); } });

  // ---------- Musikkspiller ----------
  // Spilleren ligger utenfor <main>, så musikken fortsetter når man bytter side.

  const ICONS = {
    play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/></svg>',
    pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1.2"/><rect x="14" y="5" width="4" height="14" rx="1.2"/></svg>',
    prev: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="6" width="2.5" height="12" rx="1"/><path d="M19 6.8v10.4a.8.8 0 0 1-1.25.66L10 12.66a.8.8 0 0 1 0-1.32l7.75-5.2A.8.8 0 0 1 19 6.8z"/></svg>',
    next: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="16.5" y="6" width="2.5" height="12" rx="1"/><path d="M5 6.8v10.4a.8.8 0 0 0 1.25.66L14 12.66a.8.8 0 0 0 0-1.32L6.25 6.14A.8.8 0 0 0 5 6.8z"/></svg>',
    shuffle: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h4v4"/><path d="M4 19 20 4"/><path d="M20 16v4h-4"/><path d="m14.5 14.5 5.5 5.5"/><path d="M4 5l5 5"/></svg>',
    repeat: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m17 2 3 3-3 3"/><path d="M4 11V9a4 4 0 0 1 4-4h12"/><path d="m7 22-3-3 3-3"/><path d="M20 13v2a4 4 0 0 1-4 4H4"/></svg>',
    repeatOne: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m17 2 3 3-3 3"/><path d="M4 11V9a4 4 0 0 1 4-4h12"/><path d="m7 22-3-3 3-3"/><path d="M20 13v2a4 4 0 0 1-4 4H4"/><path d="M11 10h1.2v4.5"/></svg>',
    queue: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h12M4 12h12M4 18h8"/><path d="M18 15v6l4-3z" fill="currentColor" stroke-linejoin="round"/></svg>',
  };

  const audio = new Audio();
  audio.preload = 'metadata';
  const player = $('#player');
  const queuePanel = $('#queuePanel');
  let baseList = [];
  let queue = [];
  let qi = 0;
  let shuffle = store.get('shuffle') === '1';
  let repeat = ['off', 'all', 'one'].includes(store.get('repeat')) ? store.get('repeat') : 'off';
  const now = () => queue[qi] || null;

  const v = parseFloat(store.get('volume'));
  if (v >= 0 && v <= 1) audio.volume = v;
  $('#plVol').value = audio.volume;
  $('#plPrev').innerHTML = ICONS.prev;
  $('#plNext').innerHTML = ICONS.next;
  $('#plShuffle').innerHTML = ICONS.shuffle;
  $('#plQueue').innerHTML = ICONS.queue;

  const shuffled = (arr) => {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  };
  const buildQueue = (start) => shuffle ? [baseList[start], ...shuffled(baseList.filter((_, i) => i !== start))] : baseList.slice();

  function playList(list, start, forceShuffle) {
    if (!list.length) return;
    if (forceShuffle !== null && forceShuffle !== shuffle) setShuffle(forceShuffle, false);
    baseList = list.slice();
    queue = buildQueue(start);
    qi = shuffle ? 0 : start;
    loadTrack(true);
  }

  function loadTrack(autoplay) {
    const r = now();
    if (!r) return;
    audio.src = r.track.src;
    if (autoplay) audio.play().catch(() => {});
    player.hidden = false;
    document.body.classList.add('has-player');
    $('#plCover').innerHTML = albumCover(r.album);
    $('#plAlbum').href = `#/music/${encodeURIComponent(r.album.id)}`;
    $('#plDur').textContent = r.track.duration ? fmt(r.track.duration) : '0:00';
    updatePlayerText();
    markPlaying();
    renderQueue();
    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: trackTitle(r), artist: r.album.artist || data.site.name, album: tr(r.album.title),
        artwork: r.album.cover ? [{ src: new URL(r.album.cover, location.href).href }] : [],
      });
    }
  }

  function updatePlayerText() {
    const set = (id, key) => { const el = $(id); el.setAttribute('aria-label', t(key)); el.title = t(key); };
    set('#plPlay', audio.paused ? 'play' : 'pause');
    set('#plPrev', 'prev'); set('#plNext', 'next'); set('#plClose', 'close_player'); set('#plQueue', 'queue'); set('#plShuffle', 'shuffle');
    $('#plVol').setAttribute('aria-label', t('volume'));
    $('#plSeek').setAttribute('aria-label', t('seek'));
    $('#queueClose').setAttribute('aria-label', t('close_player'));
    $('#plShuffle').setAttribute('aria-pressed', shuffle);
    const rp = $('#plRepeat');
    rp.innerHTML = repeat === 'one' ? ICONS.repeatOne : ICONS.repeat;
    set('#plRepeat', 'repeat_' + repeat);
    rp.setAttribute('aria-pressed', repeat !== 'off');
    const r = now();
    if (!r) return;
    $('#plTitle').textContent = trackTitle(r);
    $('#plAlbum').textContent = [r.album.artist, tr(r.album.title)].filter(Boolean).join(' · ');
  }

  function markPlaying() {
    const r = now();
    document.querySelectorAll('.track[data-key]').forEach((b) => {
      const on = !!r && b.dataset.key === r.key;
      b.classList.toggle('playing', on);
      b.classList.toggle('paused', on && audio.paused);
      if (on) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current');
    });
  }

  function renderQueue() {
    $('#queueList').innerHTML = queue.slice(qi, qi + 60).map((r, i) => `
      <li><button class="q-item ${i === 0 ? 'current' : ''}" data-q="${qi + i}">
        <span class="q-cover">${albumCover(r.album)}</span>
        <span class="t"><span class="tt">${esc(trackTitle(r))}</span><span class="ta">${esc(tr(r.album.title))}</span></span>
        <span class="d">${r.track.duration ? fmt(r.track.duration) : ''}</span>
      </button></li>`).join('');
  }
  $('#queueList').addEventListener('click', (e) => { const b = e.target.closest('[data-q]'); if (b) { qi = +b.dataset.q; loadTrack(true); } });
  $('#plQueue').addEventListener('click', () => {
    queuePanel.hidden = !queuePanel.hidden;
    $('#plQueue').setAttribute('aria-expanded', !queuePanel.hidden);
    if (!queuePanel.hidden) renderQueue();
  });
  $('#queueClose').addEventListener('click', () => { queuePanel.hidden = true; $('#plQueue').setAttribute('aria-expanded', 'false'); });

  function togglePlay() { if (now()) { if (audio.paused) audio.play().catch(() => {}); else audio.pause(); } }

  function skip(d, auto = false) {
    if (!now()) return;
    if (d < 0 && audio.currentTime > 3) { audio.currentTime = 0; return; }
    let next = qi + d;
    if (next >= queue.length) {
      if (repeat !== 'all') { if (auto) { audio.currentTime = 0; audio.pause(); } return; }
      if (shuffle) queue = shuffled(baseList);
      next = 0;
    }
    if (next < 0) next = repeat === 'all' ? queue.length - 1 : 0;
    qi = next;
    loadTrack(true);
  }

  function setShuffle(on, keepPlaying = true) {
    shuffle = on;
    store.set('shuffle', on ? '1' : '0');
    if (keepPlaying && now()) {
      const cur = now();
      queue = shuffle ? [cur, ...shuffled(baseList.filter((r) => r !== cur))] : baseList.slice();
      qi = shuffle ? 0 : Math.max(0, baseList.indexOf(cur));
      renderQueue();
    }
    updatePlayerText();
  }

  function closePlayer() {
    audio.pause(); audio.removeAttribute('src'); audio.load();
    queue = []; baseList = []; qi = 0;
    player.hidden = true; queuePanel.hidden = true;
    document.body.classList.remove('has-player');
    markPlaying();
  }

  function syncPlayState() {
    $('#plPlay').innerHTML = audio.paused ? ICONS.play : ICONS.pause;
    player.classList.toggle('is-playing', !audio.paused);
    updatePlayerText();
    markPlaying();
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = audio.paused ? 'paused' : 'playing';
  }
  audio.addEventListener('play', syncPlayState);
  audio.addEventListener('pause', syncPlayState);
  audio.addEventListener('ended', () => {
    if (repeat === 'one') { audio.currentTime = 0; audio.play().catch(() => {}); return; }
    skip(1, true);
  });
  let seeking = false;
  const seek = $('#plSeek');
  audio.addEventListener('timeupdate', () => {
    if (seeking) return;
    const d = audio.duration;
    seek.value = isFinite(d) && d ? (audio.currentTime / d) * 1000 : 0;
    seek.style.setProperty('--p', `${seek.value / 10}%`);
    $('#plTime').textContent = fmt(audio.currentTime);
  });
  audio.addEventListener('loadedmetadata', () => { $('#plDur').textContent = fmt(audio.duration); });
  seek.addEventListener('input', () => {
    seeking = true;
    seek.style.setProperty('--p', `${seek.value / 10}%`);
    if (isFinite(audio.duration)) $('#plTime').textContent = fmt((seek.value / 1000) * audio.duration);
  });
  seek.addEventListener('change', () => { if (isFinite(audio.duration)) audio.currentTime = (seek.value / 1000) * audio.duration; seeking = false; });
  const vol = $('#plVol');
  vol.addEventListener('input', () => { audio.volume = +vol.value; vol.style.setProperty('--p', `${audio.volume * 100}%`); store.set('volume', audio.volume); });
  vol.style.setProperty('--p', `${audio.volume * 100}%`);
  $('#plPlay').addEventListener('click', togglePlay);
  $('#plPrev').addEventListener('click', () => skip(-1));
  $('#plNext').addEventListener('click', () => skip(1));
  $('#plShuffle').addEventListener('click', () => setShuffle(!shuffle));
  $('#plRepeat').addEventListener('click', () => { repeat = { off: 'all', all: 'one', one: 'off' }[repeat]; store.set('repeat', repeat); updatePlayerText(); });
  $('#plClose').addEventListener('click', closePlayer);

  if ('mediaSession' in navigator) {
    navigator.mediaSession.setActionHandler('play', () => audio.play());
    navigator.mediaSession.setActionHandler('pause', () => audio.pause());
    navigator.mediaSession.setActionHandler('previoustrack', () => skip(-1));
    navigator.mediaSession.setActionHandler('nexttrack', () => skip(1));
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !queuePanel.hidden) { queuePanel.hidden = true; return; }
    const typing = e.target.closest?.('input, textarea, select, button, a, [contenteditable]');
    if (e.key === ' ' && !typing && now()) { e.preventDefault(); togglePlay(); }
  });

  // ---------- Start ----------

  $('#year').textContent = new Date().getFullYear();
  syncPlayState();
  applyStaticText();

  fetch('data/site.json?v=' + Date.now())
    .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then((json) => {
      data = json;
      applyStaticText();
      render();
      window.addEventListener('hashchange', render);
    })
    .catch(() => { main.innerHTML = `<div class="page-head"><h1>${t('load_error')}</h1></div>`; });
})();
