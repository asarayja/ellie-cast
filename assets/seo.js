// Lager filene som gjør at Google (og Discord, Messenger osv.) finner og forstår innholdet:
//  - books/<id>/, news/<id>/, news/ og events/: vanlige sider som kan leses uten JavaScript
//  - sitemap.xml: liste over sidene
//  - strukturdata i index.html: forteller søkemotorer at dette er en forfatter og hvilke bøker som finnes
// Brukes av admin når du publiserer. Kan også kjøres med node: require('./assets/seo.js').

(function (root) {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const tr = (v) => (v && typeof v === 'object') ? (v.en || v.no || '') : (v || '');
  const paragraphs = (text) => esc(text).split(/\n\s*\n/).filter((p) => p.trim()).map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('');
  const safeUrl = (u) => /^(https?:|mailto:)/i.test(u || '') ? u : '';
  const safeColor = (c) => /^#[0-9a-f]{3,8}$/i.test(c || '') ? c : '#23203a';
  const oneLine = (s, max = 200) => {
    const t = String(s || '').replace(/\s+/g, ' ').trim();
    return t.length > max ? t.slice(0, max).replace(/\s+\S*$/, '') + ' …' : t;
  };
  const json = (o) => JSON.stringify(o, null, 2).replace(/</g, '\\u003c');
  const ID = /^[a-z0-9-]+$/;
  const DAY = /^\d{4}-\d{2}-\d{2}$/;

  const visibleBooks = (c) => (c.books || []).filter((b) => b.id && b.status !== 'hidden' && ID.test(b.id));
  const posts = (c) => (c.news || []).filter((p) => ID.test(p.id || '') && tr(p.title)).sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const events = (c) => (c.events || []).filter((e) => DAY.test(e.date || '') && tr(e.title)).sort((a, b) => a.date.localeCompare(b.date));
  const albums = (c) => (c.music?.albums || []).filter((a) => ID.test(a.id || '') && (a.tracks || []).some((t) => t.src));
  const bookPath = (b) => `books/${b.id}/`;
  const postPath = (p) => `news/${p.id}/`;

  // «June 26, 2026» eller «2026» → 2026-06-26 / 2026
  function isoDate(v) {
    const s = String(v || '').trim();
    if (/^\d{4}(-\d{2}(-\d{2})?)?$/.test(s)) return s;
    const d = new Date(`${s} 12:00`);
    if (!s || isNaN(d)) return '';
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  const niceDate = (d) => {
    const dt = DAY.test(d || '') ? new Date(`${d}T12:00:00`) : null;
    return dt ? dt.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : (d || '');
  };
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

  // ---------- Strukturdata ----------

  function bookLd(c, b, site) {
    const links = (b.links || []).map((l) => safeUrl(l.url)).filter(Boolean);
    return {
      '@type': 'Book',
      '@id': `${site}${bookPath(b)}#book`,
      name: tr(b.title),
      url: `${site}${bookPath(b)}`,
      author: { '@id': `${site}#author` },
      ...(b.cover ? { image: new URL(b.cover, site).href } : {}),
      ...(isoDate(b.year) && b.status !== 'upcoming' ? { datePublished: isoDate(b.year) } : {}),
      ...(tr(b.blurb) ? { description: oneLine(tr(b.blurb), 500) } : {}),
      ...(tr(b.genre) ? { genre: tr(b.genre) } : {}),
      ...(+b.pages ? { numberOfPages: +b.pages } : {}),
      ...(links.length ? { sameAs: links } : {}),
    };
  }

  function personLd(c, site) {
    const same = (c.contact?.links || []).map((l) => safeUrl(l.url)).filter(Boolean);
    return {
      '@type': 'Person',
      '@id': `${site}#author`,
      name: c.site.name,
      url: site,
      jobTitle: tr(c.site.role) || 'Author',
      ...(c.about?.image ? { image: new URL(c.about.image, site).href } : {}),
      ...(same.length ? { sameAs: same } : {}),
    };
  }

  function postLd(c, p, site) {
    return {
      '@type': 'BlogPosting',
      '@id': `${site}${postPath(p)}#post`,
      headline: tr(p.title),
      url: `${site}${postPath(p)}`,
      author: { '@id': `${site}#author` },
      ...(DAY.test(p.date || '') ? { datePublished: p.date } : {}),
      ...(p.image ? { image: new URL(p.image, site).href } : {}),
      ...(tr(p.text) ? { description: oneLine(tr(p.text), 300) } : {}),
    };
  }

  function eventLd(c, e, site) {
    const online = /online|live|stream|zoom|tiktok|instagram|youtube/i.test(e.place || '');
    const link = safeUrl(e.link?.url);
    return {
      '@type': 'Event',
      name: tr(e.title),
      startDate: e.date,
      url: `${site}events/`,
      eventStatus: 'https://schema.org/EventScheduled',
      eventAttendanceMode: online ? 'https://schema.org/OnlineEventAttendanceMode' : 'https://schema.org/OfflineEventAttendanceMode',
      location: online
        ? { '@type': 'VirtualLocation', url: link || site }
        : { '@type': 'Place', name: e.place || c.site.name, address: e.place || '' },
      organizer: { '@id': `${site}#author` },
      performer: { '@id': `${site}#author` },
      ...(tr(e.text) ? { description: oneLine(tr(e.text), 300) } : {}),
    };
  }

  // Blokken mellom <!-- data:start --> og <!-- data:slutt --> i index.html
  function indexLd(c, site) {
    const graph = [
      { '@type': 'WebSite', '@id': `${site}#website`, url: site, name: c.site.name },
      personLd(c, site),
      ...visibleBooks(c).map((b) => bookLd(c, b, site)),
    ];
    return [
      '  <!-- data:start (oppdateres automatisk av admin når du publiserer) -->',
      '  <script type="application/ld+json">',
      json({ '@context': 'https://schema.org', '@graph': graph }).replace(/^/gm, '  '),
      '  </script>',
      '  <!-- data:slutt -->',
    ].join('\n');
  }

  function sitemap(c, site) {
    const urls = [
      site,
      `${site}books/`,
      ...visibleBooks(c).map((b) => site + bookPath(b)),
      ...(posts(c).length ? [`${site}news/`] : []),
      ...posts(c).map((p) => site + postPath(p)),
      ...(events(c).length ? [`${site}events/`] : []),
      ...(albums(c).length ? [`${site}music/`] : []),
      `${site}about/`,
      `${site}contact/`,
    ];
    return '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
      urls.map((u) => `  <url><loc>${esc(u)}</loc></url>`).join('\n') + '\n</urlset>\n';
  }

  // ---------- Felles ramme for sidene ----------
  // up = veien tilbake til roten («../» eller «../../»)

  function page(c, site, { up, path, title, desc, image, type = 'website', ld, active, body }) {
    const name = c.site.name;
    const url = site + path;
    const img = image || new URL('bilder/deling.jpg', site).href;
    const nav = [
      ['books', 'Books', 'books/'],
      ...(posts(c).length ? [['news', 'News', 'news/']] : []),
      ...(events(c).length ? [['events', 'Events', 'events/']] : []),
      ...(albums(c).length ? [['music', 'Music', 'music/']] : []),
      ['about', 'About Ellie', 'about/'],
      ['contact', 'Contact', 'contact/'],
    ];
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <!-- Denne siden lages automatisk av admin når du publiserer. Endringer her blir overskrevet. -->
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(desc)}">
  <link rel="canonical" href="${esc(url)}">
  <meta property="og:type" content="${type}">
  <meta property="og:site_name" content="${esc(name)}">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(desc)}">
  <meta property="og:url" content="${esc(url)}">
  <meta property="og:image" content="${esc(img)}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="theme-color" content="#f8edf3" media="(prefers-color-scheme: light)">
  <meta name="theme-color" content="#1b1936" media="(prefers-color-scheme: dark)">
  <script>try{var t=localStorage.getItem('ec-theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}</script>
  <script type="application/ld+json">
${json({ '@context': 'https://schema.org', '@graph': [...ld, personLd(c, site)] })}
  </script>
  <link rel="icon" href="${up}bilder/ikon.svg" type="image/svg+xml">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Manrope:wght@400;500;600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="${up}assets/style.css">
</head>
<body>
  <a class="skip" href="#main">Skip to content</a>
  <div class="glow" aria-hidden="true"><i></i><i></i></div>

  <header class="topbar">
    <div class="topbar-inner glass">
      <a class="brand" href="${up}"><span class="mono" aria-hidden="true">EC</span><span>${esc(name)}</span></a>
      <nav class="nav" id="nav">
        ${nav.map(([k, label, href]) => `<a href="${up}${href}"${k === active ? ' class="active" aria-current="page"' : ''}>${label}</a>`).join('\n        ')}
      </nav>
      <div class="tools">
        <button class="tool menu-btn" id="menuBtn" aria-label="Menu" aria-expanded="false" aria-controls="nav"><span></span><span></span></button>
      </div>
    </div>
  </header>

  <main id="main" tabindex="-1">
${body}
  </main>

  <footer class="footer">
    <div class="footer-inner glass">
      <span class="footer-name">${esc(name)}</span>
      <span class="footer-meta">${esc(tr(c.site.role) || 'Author')}</span>
    </div>
  </footer>
  <script>
    (function () {
      var nav = document.getElementById('nav'), btn = document.getElementById('menuBtn');
      btn.addEventListener('click', function () { btn.setAttribute('aria-expanded', nav.classList.toggle('open')); });
    })();
  </script>
</body>
</html>
`;
  }

  // ---------- Bøker ----------

  function bookPage(c, b, site) {
    const up = '../../';
    const name = c.site.name;
    const title = tr(b.title);
    const rel = (p) => /^(https?:)?\/\//.test(p) ? p : up + p;
    const links = (b.links || []).filter((l) => safeUrl(l.url));
    const facts = [['Series', tr(b.series)], [b.status === 'upcoming' ? 'Coming' : 'Published', b.year], ['Genre', tr(b.genre)], ['Pages', b.pages]].filter(([, v]) => v);
    const warnings = tr(b.warnings).split(/\n|,/).map((w) => w.trim()).filter(Boolean);
    const reviews = (b.reviews || []).filter((r) => tr(r.quote));
    const cover = b.cover
      ? `<img src="${esc(rel(b.cover))}" alt="${esc(title)}">`
      : `<div class="gen-cover"><span class="gc-title">${esc(title)}</span><span class="gc-author">${esc(name)}</span></div>`;
    return page(c, site, {
      up, path: bookPath(b), active: 'books', type: 'book',
      title: `${title} by ${name}`,
      desc: oneLine(tr(b.blurb)) || `${title} by ${name}.`,
      image: b.cover ? new URL(b.cover, site).href : '',
      ld: [bookLd(c, b, site)],
      body: `
    <a class="back" href="../">← All books</a>
    <article class="book-page">
      <div class="book-page-cover"><div class="hero-halo" style="--b:${safeColor(b.color)}"></div><div class="book" style="--b:${safeColor(b.color)}">${cover}</div></div>
      <div class="book-page-info glass">
        ${b.status === 'upcoming' ? '<span class="pill accent">Coming soon</span>' : ''}
        <h1>${esc(title)}</h1>
        <p class="byline">${esc(name)}</p>
        <div class="prose">${paragraphs(tr(b.blurb))}</div>
        ${facts.length ? `<dl class="facts">${facts.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>` : ''}
        ${warnings.length ? `
        <details class="cw">
          <summary>Content warnings</summary>
          <p class="muted">Some readers like to know before they start. Open to see the list.</p>
          <ul>${warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>
        </details>` : ''}
        <div class="actions">
          ${links.map((l, i) => `<a class="btn ${i ? 'ghost' : ''}" href="${esc(safeUrl(l.url))}" target="_blank" rel="noopener">${esc(tr(l.label))}</a>`).join('')}
          <a class="btn ghost" href="${up}#/book/${encodeURIComponent(b.id)}">More on ${esc(name)}'s website →</a>
        </div>
      </div>
    </article>
    ${tr(b.excerpt) ? `
    <section class="excerpt">
      <span class="pill">Excerpt</span>
      <div class="excerpt-text">${paragraphs(tr(b.excerpt))}</div>
    </section>` : ''}
    ${reviews.length ? `
    <section class="section">
      <div class="section-head"><h2>What readers say</h2></div>
      <div class="reviews">${reviews.map((r) => `
        <figure class="review glass">
          ${+r.stars ? `<div class="stars" role="img" aria-label="${+r.stars} out of 5 stars">${'★'.repeat(+r.stars)}<span>${'★'.repeat(5 - +r.stars)}</span></div>` : ''}
          <blockquote>${esc(tr(r.quote))}</blockquote>
          ${r.source ? `<figcaption>${esc(r.source)}</figcaption>` : ''}
        </figure>`).join('')}
      </div>
    </section>` : ''}`,
    });
  }

  // ---------- Nyheter ----------

  function newsCard(p, up) {
    const img = p.image ? (/^(https?:)?\/\//.test(p.image) ? p.image : up + p.image) : '';
    return `
      <a class="news-card glass" href="${up}${postPath(p)}">
        ${img ? `<div class="news-img"><img src="${esc(img)}" alt="" loading="lazy"></div>` : ''}
        <div class="news-body">
          ${p.date ? `<time datetime="${esc(p.date)}">${esc(niceDate(p.date))}</time>` : ''}
          <h3>${esc(tr(p.title))}</h3>
          ${tr(p.text) ? `<p>${esc(oneLine(tr(p.text).split(/\n\s*\n/)[0], 180))}</p>` : ''}
          <span class="link">Read more →</span>
        </div>
      </a>`;
  }

  function newsList(c, site) {
    const up = '../';
    return page(c, site, {
      up, path: 'news/', active: 'news',
      title: `News · ${c.site.name}`,
      desc: `News from ${c.site.name}: new books, sneak peeks and updates.`,
      ld: [{ '@type': 'CollectionPage', name: `News · ${c.site.name}`, url: `${site}news/` }],
      body: `
    <div class="page-head"><span class="pill">${esc(c.site.name)}</span><h1>News</h1></div>
    <div class="news-grid">${posts(c).map((p) => newsCard(p, up)).join('')}</div>`,
    });
  }

  function postPage(c, p, site) {
    const up = '../../';
    const link = safeUrl(p.link?.url) ? p.link : null;
    const img = p.image ? (/^(https?:)?\/\//.test(p.image) ? p.image : up + p.image) : '';
    const more = posts(c).filter((x) => x !== p).slice(0, 3);
    return page(c, site, {
      up, path: postPath(p), active: 'news', type: 'article',
      title: `${tr(p.title)} · ${c.site.name}`,
      desc: oneLine(tr(p.text)) || tr(p.title),
      image: p.image ? new URL(p.image, site).href : '',
      ld: [postLd(c, p, site)],
      body: `
    <a class="back" href="../">← All news</a>
    <article class="post glass">
      ${p.date ? `<time datetime="${esc(p.date)}">${esc(niceDate(p.date))}</time>` : ''}
      <h1>${esc(tr(p.title))}</h1>
      ${img ? `<img class="post-img" src="${esc(img)}" alt="">` : ''}
      <div class="prose">${paragraphs(tr(p.text))}</div>
      ${link ? `<div class="actions"><a class="btn" href="${esc(safeUrl(link.url))}" target="_blank" rel="noopener">${esc(tr(link.label) || 'Read more')}</a></div>` : ''}
    </article>
    ${more.length ? `
    <section class="section">
      <div class="section-head"><h2>More news</h2><a class="link" href="../">All news →</a></div>
      <div class="news-grid">${more.map((x) => newsCard(x, up)).join('')}</div>
    </section>` : ''}`,
    });
  }

  // ---------- Arrangementer ----------

  function eventHTML(e) {
    const d = new Date(`${e.date}T12:00:00`);
    const link = safeUrl(e.link?.url) ? e.link : null;
    const meta = [e.time, e.place].filter(Boolean).map(esc).join(' · ');
    return `
      <article class="event glass">
        <time class="ev-date" datetime="${esc(e.date)}">
          <span class="ev-mon">${d.toLocaleDateString('en-US', { month: 'short' })}</span>
          <span class="ev-day">${d.getDate()}</span>
          <span class="ev-year">${d.getFullYear()}</span>
        </time>
        <div class="ev-body">
          <h3>${esc(tr(e.title))}</h3>
          ${meta ? `<p class="ev-meta">${meta}</p>` : ''}
          ${tr(e.text) ? `<div class="prose">${paragraphs(tr(e.text))}</div>` : ''}
          ${link ? `<a class="btn small" href="${esc(safeUrl(link.url))}" target="_blank" rel="noopener">${esc(tr(link.label) || 'Read more')}</a>` : ''}
        </div>
      </article>`;
  }

  function eventsPage(c, site) {
    const up = '../';
    const now = today();
    const coming = events(c).filter((e) => e.date >= now);
    const past = events(c).filter((e) => e.date < now).reverse();
    return page(c, site, {
      up, path: 'events/', active: 'events',
      title: `Events · ${c.site.name}`,
      desc: coming.length
        ? `Upcoming events with ${c.site.name}: ${coming.slice(0, 3).map((e) => `${tr(e.title)} (${niceDate(e.date)})`).join(', ')}.`
        : `Readings, signings and live events with ${c.site.name}.`,
      ld: events(c).map((e) => eventLd(c, e, site)),
      body: `
    <div class="page-head"><span class="pill">${esc(c.site.name)}</span><h1>Events</h1></div>
    ${coming.length ? `<div class="events">${coming.map(eventHTML).join('')}</div>` : '<p class="muted">No upcoming events right now. Check back soon.</p>'}
    ${past.length ? `
    <section class="section">
      <div class="section-head"><h2>Past events</h2></div>
      <div class="events past">${past.map(eventHTML).join('')}</div>
    </section>` : ''}`,
    });
  }

  // ---------- Bokoversikt, Om, Musikk og Kontakt ----------

  const img = (p, up) => /^(https?:)?\/\//.test(p) ? p : up + p;

  function booksList(c, site) {
    const up = '../';
    const list = visibleBooks(c);
    return page(c, site, {
      up, path: 'books/', active: 'books',
      title: `Books by ${c.site.name}`,
      desc: `All books by ${c.site.name}: ${list.map((b) => tr(b.title)).join(', ')}.`,
      ld: [{ '@type': 'CollectionPage', name: `Books by ${c.site.name}`, url: `${site}books/`,
        mainEntity: { '@type': 'ItemList', itemListElement: list.map((b, i) => ({ '@type': 'ListItem', position: i + 1, url: site + bookPath(b), name: tr(b.title) })) } }],
      body: `
    <div class="page-head"><span class="pill">${esc(c.site.name)}</span><h1>The books</h1></div>
    <div class="shelf large">${list.map((b) => `
      <a class="book-card" href="${b.id}/">
        <div class="book-wrap">
          <div class="book" style="--b:${safeColor(b.color)}">${b.cover
            ? `<img src="${esc(img(b.cover, up))}" alt="${esc(tr(b.title))}" loading="lazy">`
            : `<div class="gen-cover"><span class="gc-title">${esc(tr(b.title))}</span><span class="gc-author">${esc(c.site.name)}</span></div>`}</div>
          ${b.status === 'upcoming' ? '<span class="badge">Coming soon</span>' : ''}
        </div>
        <h3>${esc(tr(b.title))}</h3>
        ${b.year ? `<p class="meta">${b.status === 'upcoming' ? 'Coming ' : ''}${esc(b.year)}</p>` : ''}
      </a>`).join('')}
    </div>`,
    });
  }

  function aboutPage(c, site) {
    const up = '../';
    const a = c.about || {};
    const facts = (a.facts || []).filter((f) => tr(f.label) && tr(f.value));
    return page(c, site, {
      up, path: 'about/', active: 'about', type: 'profile',
      title: `About ${c.site.name}`,
      desc: oneLine(tr(a.short) || tr(a.text)) || `About ${c.site.name}.`,
      image: a.image ? new URL(a.image, site).href : '',
      ld: [{ '@type': 'ProfilePage', name: `About ${c.site.name}`, url: `${site}about/`, mainEntity: { '@id': `${site}#author` } }],
      body: `
    <section class="about">
      <div class="portrait">${a.image ? `<img src="${esc(img(a.image, up))}" alt="${esc(c.site.name)}">` : '<span>EC</span>'}</div>
      <div class="about-text">
        <span class="pill">About Ellie</span>
        <h1>${esc(c.site.name)}</h1>
        <div class="prose">${paragraphs(tr(a.text))}</div>
        ${facts.length ? `<dl class="facts">${facts.map((f) => `<div><dt>${esc(tr(f.label))}</dt><dd>${esc(tr(f.value))}</dd></div>`).join('')}</dl>` : ''}
        <div class="actions"><a class="btn" href="../contact/">Contact</a><a class="btn ghost" href="../books/">See the books</a></div>
      </div>
    </section>`,
    });
  }

  const ALBUM_COLORS = [['#7b6cff', '#3fa9ff'], ['#ff7ab0', '#7b6cff'], ['#3fd0c9', '#3f6bff'], ['#ffb86b', '#ff6b8b'], ['#9b8cff', '#2c2a5a']];
  const dur = (s) => s ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : '';

  function musicPage(c, site) {
    const up = '../';
    const list = albums(c);
    return page(c, site, {
      up, path: 'music/', active: 'music',
      title: `Music · ${c.site.name}`,
      desc: `Music by ${c.site.name}: ${list.map((a) => tr(a.title)).join(', ')}.`,
      ld: list.map((a) => ({
        '@type': 'MusicAlbum', name: tr(a.title), url: `${site}music/`,
        byArtist: { '@type': 'MusicGroup', name: a.artist || c.site.name },
        ...(a.year ? { datePublished: String(a.year) } : {}),
        ...(a.cover ? { image: new URL(a.cover, site).href } : {}),
        numTracks: a.tracks.filter((t) => t.src).length,
        track: a.tracks.filter((t) => t.src).map((t) => ({ '@type': 'MusicRecording', name: t.title || tr(a.title), ...(t.duration ? { duration: `PT${Math.floor(t.duration / 60)}M${t.duration % 60}S` } : {}) })),
      })),
      body: `
    <div class="page-head"><span class="pill">${esc(c.site.name)}</span><h1>Music</h1>
      <p class="muted">Listen while you read. The music keeps playing as you move around the website.</p></div>
    ${list.map((a, i) => {
      const [c1, c2] = ALBUM_COLORS[i % ALBUM_COLORS.length];
      const tracks = a.tracks.filter((t) => t.src);
      return `
    <section class="album-hero glass" style="margin-bottom:22px">
      <div class="cover big">${a.cover ? `<img src="${esc(img(a.cover, up))}" alt="${esc(tr(a.title))}">`
        : `<div class="gen-album" style="--c1:${c1};--c2:${c2}"><span class="ga-note" aria-hidden="true">♪</span><span class="ga-title">${esc(tr(a.title))}</span></div>`}</div>
      <div>
        <h2 style="font-size:clamp(2.2rem,5vw,3.2rem)">${esc(tr(a.title))}</h2>
        <p class="muted">${[a.artist, a.year].filter(Boolean).map(esc).join(' · ')}</p>
        ${tr(a.description) ? `<div class="prose">${paragraphs(tr(a.description))}</div>` : ''}
        <ol class="prose">${tracks.map((t) => `<li>${esc(t.title || tr(a.title))}${t.duration ? ` <span class="muted">· ${dur(t.duration)}</span>` : ''}</li>`).join('')}</ol>
        <div class="actions"><a class="btn" href="${up}#/music/${encodeURIComponent(a.id)}">▶ Listen on the website</a></div>
      </div>
    </section>`;
    }).join('')}`,
    });
  }

  function contactPage(c, site) {
    const up = '../';
    const k = c.contact || {};
    const email = /^[^\s@]+@[^\s@]+$/.test(k.email || '') ? k.email : '';
    const links = (k.links || []).filter((l) => safeUrl(l.url));
    return page(c, site, {
      up, path: 'contact/', active: 'contact',
      title: `Contact ${c.site.name}`,
      desc: oneLine(tr(k.text)) || `How to get in touch with ${c.site.name}.`,
      ld: [{ '@type': 'ContactPage', name: `Contact ${c.site.name}`, url: `${site}contact/`, mainEntity: { '@id': `${site}#author` } }],
      body: `
    <section class="contact glass" style="margin-top:20px">
      <span class="pill">Contact</span>
      <h1 style="font-size:clamp(3rem,8vw,5rem)">Say hello</h1>
      <p>${esc(tr(k.text))}</p>
      <div class="actions center">
        ${email ? `<a class="btn" href="mailto:${esc(email)}">Send an email</a>` : ''}
        ${links.map((l) => `<a class="btn ghost" href="${esc(safeUrl(l.url))}" target="_blank" rel="noopener">${esc(l.label)}</a>`).join('')}
      </div>
    </section>`,
    });
  }

  // ---------- Alle filene ----------

  // { sti: innhold } for alt som skal ligge i repoet
  function files(c, site) {
    const out = { 'sitemap.xml': sitemap(c, site), 'books/index.html': booksList(c, site), 'about/index.html': aboutPage(c, site), 'contact/index.html': contactPage(c, site) };
    if (albums(c).length) out['music/index.html'] = musicPage(c, site);
    for (const b of visibleBooks(c)) out[`${bookPath(b)}index.html`] = bookPage(c, b, site);
    if (posts(c).length) {
      out['news/index.html'] = newsList(c, site);
      for (const p of posts(c)) out[`${postPath(p)}index.html`] = postPage(c, p, site);
    }
    if (events(c).length) out['events/index.html'] = eventsPage(c, site);
    return out;
  }

  // Sidene admin har ansvar for. Ligger det en slik side i repoet som ikke lages lenger, slettes den.
  const MANAGED = /^(books\/([a-z0-9-]+\/)?index\.html|news\/([a-z0-9-]+\/)?index\.html|(events|music|about|contact)\/index\.html)$/;
  const DATA_BLOCK = /  <!-- data:start[\s\S]*?<!-- data:slutt -->/;

  const SEO = { files, indexLd, bookPath, postPath, MANAGED, BOOK_PAGE: MANAGED, DATA_BLOCK };
  if (typeof module === 'object' && module.exports) module.exports = SEO;
  else root.EC_SEO = SEO;
})(this);
