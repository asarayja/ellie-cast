// Lager én fil per adresse på siden (books/, books/<id>/, news/, events/, music/, about/ …), så adressene
// virker uten # og Google, Discord, Messenger osv. kan lese innholdet uten JavaScript.
// Hver fil er en kopi av index.html med egen tittel, delingsinfo, strukturdata og ferdig innhold i <main>.
// Når siden lastes, tar assets/app.js over som vanlig (musikkspilleren osv.).
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
  // Serier (samme regler som app.js): sortert etter nummer, uten nummer sist
  const seriesName = (b) => tr(b.series).trim();
  const seriesNo = (b) => +b.seriesNo > 0 ? +b.seriesNo : 0;
  const inSeries = (c, name) => visibleBooks(c).filter((x) => seriesName(x) === name)
    .map((x, i) => [x, i]).sort(([a, i], [b, j]) => (seriesNo(a) || 1e9) - (seriesNo(b) || 1e9) || i - j).map(([x]) => x);
  const seriesList = (c) => [...new Set(visibleBooks(c).map(seriesName).filter(Boolean))].map((name) => ({ name, list: inSeries(c, name) })).filter((s) => s.list.length > 1);
  const posts = (c) => (c.news || []).filter((p) => ID.test(p.id || '') && tr(p.title)).sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const events = (c) => (c.events || []).filter((e) => DAY.test(e.date || '') && tr(e.title)).sort((a, b) => a.date.localeCompare(b.date));
  const albums = (c) => (c.music?.albums || []).filter((a) => ID.test(a.id || '') && (a.tracks || []).some((t) => t.src));
  const newsletterOn = (c) => { const n = c.newsletter || {}; return (n.provider === 'buttondown' && /^[A-Za-z0-9_-]+$/.test(n.buttondown || '')) || (n.provider === 'link' && !!safeUrl(n.url)); };
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
  // Dato på boka (statisk side: amerikansk format; app.js viser det etter hvor besøkende er når siden lastes)
  const releaseIso = (b) => /^\d{4}-\d{2}-\d{2}$/.test(b.release?.date || '') ? b.release.date : isoDate(b.year);
  const releaseText = (b) => {
    const r = b.release || {};
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date || '')) return b.year || '';
    return new Date(`${r.date}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', year: 'numeric', month: 'long', day: 'numeric' });
  };
  const editions = (b) => (b.editions || []).filter((e) => String(e.name || '').trim() && /^\d{4}-\d{2}-\d{2}$/.test(e.release?.date || ''));
  const FORMATS = [[/kindle|e-?book|digital/i, 'EBook'], [/paperback|pocket/i, 'Paperback'], [/hardcover|hardback|innbundet/i, 'Hardcover'], [/audio|lydbok/i, 'AudiobookFormat']];
  const bookFormat = (name) => (FORMATS.find(([re]) => re.test(name)) || [])[1];
  const dur = (s) => s ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : '';

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
      ...(releaseIso(b) && b.status !== 'upcoming' ? { datePublished: releaseIso(b) } : {}),
      ...(tr(b.blurb) ? { description: oneLine(tr(b.blurb), 500) } : {}),
      ...(tr(b.genre) ? { genre: tr(b.genre) } : {}),
      ...(+b.pages ? { numberOfPages: +b.pages } : {}),
      ...(seriesName(b) ? { isPartOf: { '@type': 'BookSeries', name: seriesName(b) }, ...(seriesNo(b) ? { position: seriesNo(b) } : {}) } : {}),
      ...(links.length ? { sameAs: links } : {}),
      ...(editions(b).length ? { workExample: editions(b).map((e) => ({
        '@type': 'Book', name: `${tr(b.title)} (${e.name.trim()})`, datePublished: e.release.date,
        ...(bookFormat(e.name) ? { bookFormat: `https://schema.org/${bookFormat(e.name)}` } : {}),
      })) } : {}),
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

  function albumLd(c, a, site) {
    const tracks = a.tracks.filter((t) => t.src);
    return {
      '@type': 'MusicAlbum', name: tr(a.title), url: `${site}music/${a.id}/`,
      byArtist: { '@type': 'MusicGroup', name: a.artist || c.site.name },
      ...(a.year ? { datePublished: String(a.year) } : {}),
      ...(a.cover ? { image: new URL(a.cover, site).href } : {}),
      numTracks: tracks.length,
      track: tracks.map((t) => ({ '@type': 'MusicRecording', name: t.title || tr(a.title), ...(t.duration ? { duration: `PT${Math.floor(t.duration / 60)}M${t.duration % 60}S` } : {}) })),
    };
  }

  const ldBlock = (graph) => [
    '  <!-- data:start (oppdateres automatisk av admin når du publiserer) -->',
    '  <script type="application/ld+json">',
    json({ '@context': 'https://schema.org', '@graph': graph }).replace(/^/gm, '  '),
    '  </script>',
    '  <!-- data:slutt -->',
  ].join('\n');

  // Blokken mellom <!-- data:start --> og <!-- data:slutt --> i index.html
  function indexLd(c, site) {
    return ldBlock([
      { '@type': 'WebSite', '@id': `${site}#website`, url: site, name: c.site.name },
      personLd(c, site),
      ...visibleBooks(c).map((b) => bookLd(c, b, site)),
    ]);
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
      ...albums(c).map((a) => `${site}music/${a.id}/`),
      `${site}board-game/`,
      `${site}about/`,
      `${site}contact/`,
    ];
    return '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
      urls.map((u) => `  <url><loc>${esc(u)}</loc></url>`).join('\n') + '\n</urlset>\n';
  }

  // ---------- Felles: lag en side ut fra index.html ----------

  const DATA_BLOCK = /  <!-- data:start[\s\S]*?<!-- data:slutt -->/;
  const SHARE_BLOCK = /  <!-- deling:start[\s\S]*?<!-- deling:slutt -->/;

  function page(c, site, template, { path, base, title, desc, image, type = 'website', ld, body, noindex }) {
    const url = site + path;
    const img = image || new URL(c.site.shareImage || 'bilder/deling.jpg', site).href;
    const meta = [
      '  <!-- deling:start (lages automatisk av admin når du publiserer) -->',
      `  <meta name="description" content="${esc(desc)}">`,
      noindex ? '  <meta name="robots" content="noindex">' : `  <link rel="canonical" href="${esc(url)}">`,
      `  <meta property="og:type" content="${type}">`,
      `  <meta property="og:site_name" content="${esc(c.site.name)}">`,
      `  <meta property="og:title" content="${esc(title)}">`,
      `  <meta property="og:description" content="${esc(desc)}">`,
      `  <meta property="og:url" content="${esc(url)}">`,
      `  <meta property="og:image" content="${esc(img)}">`,
      '  <meta name="twitter:card" content="summary_large_image">',
      '  <!-- deling:slutt -->',
    ].join('\n');
    // Funksjoner i replace, så $ i teksten ikke blir tolket som spesialtegn
    let html = template
      .replace(/<base href="[^"]*">/, () => `<base href="${esc(base || '../'.repeat(path.split('/').filter(Boolean).length))}">`)
      .replace(/<title>[\s\S]*?<\/title>/, () => `<title>${esc(title)}</title>`)
      .replace(SHARE_BLOCK, () => meta)
      .replace(DATA_BLOCK, () => ldBlock([...ld, personLd(c, site)]))
      .replace(/(<main id="main"[^>]*>)[\s\S]*?(<\/main>)/, (_, open, close) => `${open}\n    <div class="view">${body}\n    </div>\n  ${close}`);
    // Menypunktene som er skjult til det finnes innhold
    if (posts(c).length) html = html.replace(/(data-route="news"[^>]*?) hidden>/, '$1>');
    if (events(c).length) html = html.replace(/(data-route="events"[^>]*?) hidden>/, '$1>');
    if (albums(c).length) html = html.replace(/(data-route="music"[^>]*?) hidden>/, '$1>');
    return html;
  }

  const coverHTML = (c, b) => `<div class="book" style="--b:${safeColor(b.color)}">${b.cover
    ? `<img src="${esc(b.cover)}" alt="${esc(tr(b.title))}">`
    : `<div class="gen-cover"><span class="gc-title">${esc(tr(b.title))}</span><span class="gc-author">${esc(c.site.name)}</span></div>`}</div>`;

  // ---------- Bøker ----------

  function booksList(c, site, tpl) {
    const list = visibleBooks(c);
    const series = seriesList(c);
    const rest = list.filter((b) => !series.some((s) => s.name === seriesName(b)));
    return page(c, site, tpl, {
      path: 'books/',
      title: `Books by ${c.site.name}`,
      desc: `All books by ${c.site.name}: ${list.map((b) => tr(b.title)).join(', ')}.`,
      ld: [{ '@type': 'CollectionPage', name: `Books by ${c.site.name}`, url: `${site}books/`,
        mainEntity: { '@type': 'ItemList', itemListElement: list.map((b, i) => ({ '@type': 'ListItem', position: i + 1, url: site + bookPath(b), name: tr(b.title) })) } }],
      body: `
      <div class="page-head"><span class="pill">${esc(c.site.name)}</span><h1>The books</h1></div>
      ${series.length ? `${series.map((s) => `
      <section class="section">
        <div class="section-head"><h2>${esc(s.name)}</h2><span class="muted">Reading order</span></div>
        <div class="shelf large">${s.list.map((b) => staticCard(c, b, true)).join('')}</div>
      </section>`).join('')}
      ${rest.length ? `
      <section class="section">
        <div class="section-head"><h2>Other books</h2></div>
        <div class="shelf large">${rest.map((b) => staticCard(c, b)).join('')}</div>
      </section>` : ''}` : `
      <div class="shelf large">${list.map((b) => staticCard(c, b)).join('')}
      </div>`}`,
    });
  }

  const staticCard = (c, b, inOrder) => {
    const meta = [inOrder && seriesNo(b) ? `Book ${seriesNo(b)}` : '', releaseText(b) ? `${b.status === 'upcoming' ? 'Coming ' : ''}${releaseText(b)}` : ''].filter(Boolean).join(' · ');
    return `
        <a class="book-card" href="${bookPath(b)}">
          <div class="book-wrap">${coverHTML(c, b)}${b.status === 'upcoming' ? '<span class="badge">Coming soon</span>' : ''}</div>
          <h3>${esc(tr(b.title))}</h3>
          ${meta ? `<p class="meta">${esc(meta)}</p>` : ''}
        </a>`;
  };

  function bookPage(c, b, site, tpl) {
    const title = tr(b.title);
    const links = (b.links || []).filter((l) => safeUrl(l.url));
    const dates = editions(b).length
      ? editions(b).map((e) => [e.name.trim(), releaseText({ release: e.release })])
      : [[b.status === 'upcoming' ? 'Coming' : 'Published', releaseText(b)]];
    const order = seriesName(b) ? inSeries(c, seriesName(b)) : [];
    const facts = [['Series', [seriesName(b), seriesNo(b) ? `Book ${seriesNo(b)}` : ''].filter(Boolean).join(' · ')], ...dates, ['Genre', tr(b.genre)], ['Pages', b.pages]].filter(([, v]) => v);
    const warnings = tr(b.warnings).split(/\n|,/).map((w) => w.trim()).filter(Boolean);
    const reviews = (b.reviews || []).filter((r) => tr(r.quote));
    return page(c, site, tpl, {
      path: bookPath(b), type: 'book',
      title: `${title} by ${c.site.name}`,
      desc: oneLine(tr(b.blurb)) || `${title} by ${c.site.name}.`,
      image: b.cover ? new URL(b.cover, site).href : '',
      ld: [bookLd(c, b, site)],
      body: `
      <a class="back" href="books/">← All books</a>
      <article class="book-page">
        <div class="book-page-cover"><div class="hero-halo" style="--b:${safeColor(b.color)}"></div>${coverHTML(c, b)}</div>
        <div class="book-page-info glass">
          ${b.status === 'upcoming' ? '<span class="pill accent">Coming soon</span>' : ''}
          <h1>${esc(title)}</h1>
          <p class="byline">${esc(c.site.name)}</p>
          <div class="prose">${paragraphs(tr(b.blurb))}</div>
          ${facts.length ? `<dl class="facts">${facts.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>` : ''}
          ${warnings.length ? `
          <details class="cw">
            <summary>Content warnings</summary>
            <ul>${warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>
          </details>` : ''}
          ${links.length ? `<div class="actions">${links.map((l, i) => `<a class="btn ${i ? 'ghost' : ''}" href="${esc(safeUrl(l.url))}" target="_blank" rel="noopener">${esc(tr(l.label))}</a>`).join('')}</div>` : ''}
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
      </section>` : ''}
      ${order.length > 1 ? `
      <section class="section">
        <div class="section-head"><h2>Reading order</h2><span class="muted">${esc(seriesName(b))}</span></div>
        <div class="shelf">${order.map((x) => staticCard(c, x, true)).join('')}</div>
      </section>` : ''}`,
    });
  }

  // ---------- Nyheter ----------

  const postBook = (c, p) => p.book ? visibleBooks(c).find((b) => b.id === p.book) : null;
  const newsCard = (c, p) => `
        <a class="news-card glass" href="${postPath(p)}">
          ${postBook(c, p) ? `<div class="news-img news-book" style="--b:${safeColor(postBook(c, p).color)}">${coverHTML(c, postBook(c, p))}</div>`
            : p.image ? `<div class="news-img"><img src="${esc(p.image)}" alt="" loading="lazy"></div>` : ''}
          <div class="news-body">
            ${p.date ? `<time datetime="${esc(p.date)}">${esc(niceDate(p.date))}</time>` : ''}
            <h3>${esc(tr(p.title))}</h3>
            ${tr(p.text) ? `<p>${esc(oneLine(tr(p.text).split(/\n\s*\n/)[0], 180))}</p>` : ''}
            <span class="link">Read more →</span>
          </div>
        </a>`;

  function newsList(c, site, tpl) {
    return page(c, site, tpl, {
      path: 'news/',
      title: `News · ${c.site.name}`,
      desc: `News from ${c.site.name}: new books, sneak peeks and updates.`,
      ld: [{ '@type': 'CollectionPage', name: `News · ${c.site.name}`, url: `${site}news/` }],
      body: `
      <div class="page-head"><span class="pill">${esc(c.site.name)}</span><h1>News</h1></div>
      <div class="news-grid">${posts(c).map((p) => newsCard(c, p)).join('')}</div>`,
    });
  }

  function postPage(c, p, site, tpl) {
    const link = safeUrl(p.link?.url) ? p.link : null;
    const pb = postBook(c, p);
    const image = pb?.cover || p.image;
    return page(c, site, tpl, {
      path: postPath(p), type: 'article',
      title: `${tr(p.title)} · ${c.site.name}`,
      desc: oneLine(tr(p.text)) || tr(p.title),
      image: image ? new URL(image, site).href : '',
      ld: [postLd(c, p, site)],
      body: `
      <a class="back" href="news/">← All news</a>
      <div class="${pb ? 'post-with-book' : ''}">
      ${pb ? `<a class="book-page-cover" href="${bookPath(pb)}" data-tilt><div class="hero-halo" style="--b:${safeColor(pb.color)}"></div>${coverHTML(c, pb)}</a>` : ''}
      <article class="post glass">
        ${p.date ? `<time datetime="${esc(p.date)}">${esc(niceDate(p.date))}</time>` : ''}
        <h1>${esc(tr(p.title))}</h1>
        ${p.image && !pb ? `<img class="post-img" src="${esc(p.image)}" alt="">` : ''}
        <div class="prose">${paragraphs(tr(p.text))}</div>
        ${link ? `<div class="actions"><a class="btn" href="${esc(safeUrl(link.url))}" target="_blank" rel="noopener">${esc(tr(link.label) || 'Read more')}</a></div>` : ''}
      </article>
      </div>`,
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

  function eventsPage(c, site, tpl) {
    const now = today();
    const coming = events(c).filter((e) => e.date >= now);
    const past = events(c).filter((e) => e.date < now).reverse();
    return page(c, site, tpl, {
      path: 'events/',
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

  // ---------- Musikk ----------

  const ALBUM_COLORS = [['#7b6cff', '#3fa9ff'], ['#ff7ab0', '#7b6cff'], ['#3fd0c9', '#3f6bff'], ['#ffb86b', '#ff6b8b'], ['#9b8cff', '#2c2a5a']];
  function albumCover(c, a) {
    if (a.cover) return `<img src="${esc(a.cover)}" alt="${esc(tr(a.title))}">`;
    const [c1, c2] = ALBUM_COLORS[Math.max(0, (c.music.albums || []).indexOf(a)) % ALBUM_COLORS.length];
    return `<div class="gen-album" style="--c1:${c1};--c2:${c2}"><span class="ga-note" aria-hidden="true">♪</span><span class="ga-title">${esc(tr(a.title))}</span></div>`;
  }

  function musicPage(c, site, tpl) {
    const list = albums(c);
    return page(c, site, tpl, {
      path: 'music/',
      title: `Music · ${c.site.name}`,
      desc: `Music by ${c.site.name}: ${list.map((a) => tr(a.title)).join(', ')}.`,
      ld: list.map((a) => albumLd(c, a, site)),
      body: `
      <div class="page-head"><span class="pill">${esc(c.site.name)}</span><h1>Music</h1>
        <p class="muted">Listen while you read. The music keeps playing as you move around the site.</p></div>
      <div class="album-grid">${list.map((a) => `
        <article class="album-card">
          <a class="album-link" href="music/${a.id}/">
            <div class="cover">${albumCover(c, a)}</div>
            <h3>${esc(tr(a.title))}</h3>
          </a>
        </article>`).join('')}
      </div>`,
    });
  }

  function albumPage(c, a, site, tpl) {
    const tracks = a.tracks.filter((t) => t.src);
    return page(c, site, tpl, {
      path: `music/${a.id}/`, type: 'music.album',
      title: `${tr(a.title)} · ${c.site.name}`,
      desc: oneLine(tr(a.description)) || `${tr(a.title)} by ${a.artist || c.site.name}: ${tracks.map((t) => t.title).filter(Boolean).join(', ')}.`,
      image: a.cover ? new URL(a.cover, site).href : '',
      ld: [albumLd(c, a, site)],
      body: `
      <a class="back" href="music/">← All music</a>
      <section class="album-hero glass">
        <div class="cover big">${albumCover(c, a)}</div>
        <div>
          <h1>${esc(tr(a.title))}</h1>
          <p class="muted">${[a.artist, a.year].filter(Boolean).map(esc).join(' · ')}</p>
          ${tr(a.description) ? `<div class="prose">${paragraphs(tr(a.description))}</div>` : ''}
        </div>
      </section>
      <ol class="tracklist glass">${tracks.map((t, i) => `
        <li><span class="track"><span class="num">${i + 1}</span><span class="t"><span class="tt">${esc(t.title || tr(a.title))}</span></span><span class="d">${dur(t.duration)}</span></span></li>`).join('')}
      </ol>`,
    });
  }

  // ---------- Om, kontakt, personvern og «finnes ikke» ----------

  function aboutPage(c, site, tpl) {
    const a = c.about || {};
    const facts = (a.facts || []).filter((f) => tr(f.label) && tr(f.value));
    return page(c, site, tpl, {
      path: 'about/', type: 'profile',
      title: `About ${c.site.name}`,
      desc: oneLine(tr(a.short) || tr(a.text)) || `About ${c.site.name}.`,
      image: a.image ? new URL(a.image, site).href : '',
      ld: [{ '@type': 'ProfilePage', name: `About ${c.site.name}`, url: `${site}about/`, mainEntity: { '@id': `${site}#author` } }],
      body: `
      <section class="about">
        <div class="portrait">${a.image ? `<img src="${esc(a.image)}" alt="${esc(c.site.name)}">` : '<span>EC</span>'}</div>
        <div class="about-text">
          <span class="pill">About Ellie</span>
          <h1>${esc(c.site.name)}</h1>
          <div class="prose">${paragraphs(tr(a.text))}</div>
          ${facts.length ? `<dl class="facts">${facts.map((f) => `<div><dt>${esc(tr(f.label))}</dt><dd>${esc(tr(f.value))}</dd></div>`).join('')}</dl>` : ''}
        </div>
      </section>`,
    });
  }

  // På webhotellet: kontaktskjema i stedet for e-postadressen (samme som app.js). Bildet med koden
  // settes inn av app.js når siden lastes, så det bare lages én kode.
  const contactForm = (c) => c.contact?.form === 'server';
  const contactFormHTML = () => `
        <form class="contact-form" id="message" novalidate>
          <div class="cf-row">
            <label class="cf-field"><span>Your name</span><input name="name" required maxlength="100" autocomplete="name"></label>
            <label class="cf-field"><span>Your email</span><input type="email" name="email" required maxlength="200" autocomplete="email"></label>
          </div>
          <label class="cf-field"><span>Message</span><textarea name="message" required maxlength="5000" rows="6"></textarea></label>
          <div class="cf-hp" aria-hidden="true"><label>Website <input name="website" tabindex="-1" autocomplete="off"></label></div>
          <div class="cf-captcha">
            <img class="cf-img" alt="Security code" width="220" height="72">
            <button type="button" class="cf-new" data-new-code aria-label="New code" title="New code">↻</button>
            <label class="cf-field cf-code"><span>Type the code</span><input name="code" required maxlength="8" autocomplete="off" autocapitalize="characters" spellcheck="false"></label>
          </div>
          <div class="cf-foot">
            <button class="btn" type="submit">Send message</button>
            <p class="cf-status" role="status" aria-live="polite"></p>
          </div>
        </form>`;

  function contactSection(c) {
    const k = c.contact || {};
    const form = contactForm(c);
    const email = !form && /^[^\s@]+@[^\s@]+$/.test(k.email || '') ? k.email : '';
    const links = (k.links || []).filter((l) => safeUrl(l.url));
    return `
      <section class="contact glass" id="contact">
        <span class="pill">Contact</span>
        <h2>Say hello</h2>
        <p>${esc(tr(k.text))}</p>
        ${form ? contactFormHTML() : ''}
        <div class="actions center">
          ${email ? `<a class="btn" href="mailto:${esc(email)}">Send an email</a>` : ''}
          ${links.map((l) => `<a class="btn ghost" href="${esc(safeUrl(l.url))}" target="_blank" rel="noopener">${esc(l.label)}</a>`).join('')}
        </div>
      </section>`;
  }

  function contactPage(c, site, tpl) {
    return page(c, site, tpl, {
      path: 'contact/',
      title: `Contact ${c.site.name}`,
      desc: oneLine(tr(c.contact?.text)) || `How to get in touch with ${c.site.name}.`,
      ld: [{ '@type': 'ContactPage', name: `Contact ${c.site.name}`, url: `${site}contact/`, mainEntity: { '@id': `${site}#author` } }],
      body: contactSection(c),
    });
  }

  function privacyPage(c, site, tpl) {
    const n = c.newsletter || {};
    const form = contactForm(c);
    const email = /^[^\s@]+@[^\s@]+$/.test(c.contact?.email || '') ? c.contact.email : '';
    const parts = [
      form ? 'This website does not use ads or tracking. The contact form sets one small cookie so the security code works. It is deleted when you close the browser.' : 'This website does not use cookies, ads or tracking.',
      'Your browser remembers a few small settings, like light or dark theme and the music volume. They are stored only on your own device and are never sent anywhere.',
      newsletterOn(c) ? `If you sign up for the newsletter, your email address is stored by ${n.provider === 'buttondown' ? 'Buttondown' : 'the newsletter service'} and used only to send news about the books. Every email has a link to unsubscribe, and you can ask to have your address deleted at any time.` : '',
      form ? 'If you send a message through the contact form, your name, email address and message are stored on this website\'s server and sent to Ellie by email. They are only used to answer you, and you can ask to have them deleted at any time.' : '',
      form ? 'The fonts are loaded from Google Fonts. Like most websites, the web host and Google can see your IP address when the page loads.' : 'The fonts are loaded from Google Fonts, and the site is hosted on GitHub Pages. Like most websites, they can see your IP address when the page loads.',
      form ? 'Questions? Use the contact form.' : email ? `Questions? Send an email to ${email}.` : '',
    ].filter(Boolean);
    return page(c, site, tpl, {
      path: 'privacy/',
      title: `Privacy · ${c.site.name}`,
      desc: `How ${c.site.name}'s website handles your data.`,
      ld: [{ '@type': 'WebPage', name: `Privacy · ${c.site.name}`, url: `${site}privacy/` }],
      body: `
      <div class="page-head"><span class="pill">${esc(c.site.name)}</span><h1>Privacy</h1></div>
      <div class="prose privacy">${parts.map((x) => `<p>${esc(x)}</p>`).join('')}</div>`,
    });
  }

  // ---------- Brettspillet ----------
  // Fast innhold (ikke fra admin). Filene ligger i board-game/ i repoet.

  const GAME_FILES = [
    ['stay-awake-board-a3.pdf', 'The board · A3', '1 page. One sheet, ready to play.'],
    ['stay-awake-board-a4.pdf', 'The board · 2 × A4', '2 pages. Tape the two halves together from behind.'],
    ['stay-awake-cards.pdf', 'The cards', '14 pages: 54 Fall cards and 8 role cards. Print double-sided, flipping on the long edge.'],
    ['stay-awake-pieces.pdf', 'Figures and candle cards', '1 page: 8 figures to fold, 8 candle cards and 2 Sedation tokens.'],
    ['stay-awake-rules.pdf', 'The rules', '3 pages, with a list of every card.'],
    ['stay-awake-everything-a4.pdf', 'Everything in one file', '20 A4 pages: the board, cards, pieces and rules.'],
  ];
  const GAME_STEPS = [
    ['A secret role', 'Everyone gets a role card face down. One card only says The Collector. Everyone else is a Captive.'],
    ['Roll through the house', 'Like snakes and ladders: crawl through the vents to get ahead, and slide back if you doze off.'],
    ['Two-sided cards', 'Every card has a text for Captives and a darker one only the Collector may use. You say what you do, never what the card says.'],
    ['Night and talk', 'At night, all eyes close and everyone taps the table while the Collector sedates someone. Then you talk, accuse and vote.'],
  ];

  function gamePage(c, site, tpl) {
    const book = visibleBooks(c).find((b) => b.id === 'the-fragmented-collector');
    const bookLink = book ? `<a href="${bookPath(book)}">${esc(tr(book.title))}</a>` : 'The Fragmented Collector';
    const desc = 'Stay Awake: a free print-and-play board game for 4–8 players, set in the world of The Fragmented Collector. One of you isn\'t a captive.';
    return page(c, site, tpl, {
      path: 'board-game/',
      title: `Stay Awake · Board game · ${c.site.name}`,
      desc,
      image: `${site}board-game/board.jpg`,
      ld: [{ '@type': 'Game', name: 'Stay Awake', url: `${site}board-game/`, description: desc, numberOfPlayers: { '@type': 'QuantitativeValue', minValue: 4, maxValue: 8 }, author: { '@id': `${site}#author` }, isAccessibleForFree: true }],
      body: `
      <section class="game">
        <div class="page-head">
          <span class="pill">Board game</span>
          <h1>Stay Awake</h1>
          <p class="lead">A print-and-play board game set in the world of ${bookLink}. One of you isn't a captive. Roll through the house that doesn't breathe, crawl through the vents, and find the Collector before you are collected.</p>
          <dl class="facts">
            <div><dt>Players</dt><dd>4–8</dd></div>
            <div><dt>Time</dt><dd>30–45 min</dd></div>
            <div><dt>Ages</dt><dd>14+</dd></div>
            <div><dt>Price</dt><dd>Free</dd></div>
          </dl>
          <div class="actions"><a class="btn" href="board-game/#download">Download the game</a><a class="btn ghost" href="board-game/stay-awake-rules.pdf" download>Read the rules</a></div>
        </div>
        <figure class="game-board glass"><img src="board-game/board.webp" width="1700" height="1189" alt="The Stay Awake board: 40 spaces through five rooms of the house, from the bedroom to the front door"></figure>
        <div class="game-steps">
          ${GAME_STEPS.map(([h, p], i) => `<div class="glass"><span class="game-no">${i + 1}</span><h2>${esc(h)}</h2><p>${esc(p)}</p></div>`).join('')}
        </div>
        <div class="game-pieces">
          <img src="board-game/cards.webp" width="900" height="550" alt="Three cards: a Captive role card, the Fall card Three taps, and the Collector role card">
          <div>
            <h2>Two texts, one card</h2>
            <p>The white half is for Captives. The dark half is only for the Collector, who may also use the white half to blend in. Every text grows out of the book and the song COLLECT HER.</p>
            <img src="board-game/figures.webp" width="854" height="193" alt="The eight figures, one in each colour">
          </div>
        </div>
        <div class="game-dl" id="download">
          <div class="section-head"><h2>Download</h2></div>
          <ul>
            ${GAME_FILES.map(([f, h, p]) => `<li class="glass"><div><h3>${esc(h)}</h3><p>${esc(p)}</p></div><a class="btn small" href="board-game/${f}" download>Download PDF</a></li>`).join('')}
          </ul>
          <div class="prose game-print">
            <p><strong>Print at 100% (actual size)</strong>, not “fit to page”, or the cards come out too small. Thick paper works best for the board and the figures.</p>
            <p>You also need 1 die, scissors and glue or tape, 8 paper clips and a phone as a 1-minute timer.</p>
            <p>The game has dark themes from the book, like control and sedation. Nobody is hurt on the table: being “collected” just means you're out of the game.</p>
          </div>
        </div>
      </section>`,
    });
  }

  // GitHub viser 404.html for adresser som ikke finnes. Den vet ikke hvor dypt den står, så <base> må være fast.
  function notFoundPage(c, site, tpl) {
    return page(c, site, tpl, {
      path: '404.html', base: new URL(site).pathname, noindex: true,
      title: `Page not found · ${c.site.name}`,
      desc: `Page not found.`,
      ld: [],
      body: `
      <div class="page-head"><h1>Couldn't find that page.</h1><a class="btn" href="./">Go home</a></div>`,
    });
  }

  // ---------- Alle filene ----------

  // { sti: innhold } for alt som skal ligge i repoet. template = innholdet i index.html.
  function files(c, site, template) {
    const out = { 'sitemap.xml': sitemap(c, site) };
    if (!template || !/<main id="main"/.test(template) || !/<base href=/.test(template)) return out;
    out['404.html'] = notFoundPage(c, site, template);
    out['books/index.html'] = booksList(c, site, template);
    for (const b of visibleBooks(c)) out[`${bookPath(b)}index.html`] = bookPage(c, b, site, template);
    if (posts(c).length) {
      out['news/index.html'] = newsList(c, site, template);
      for (const p of posts(c)) out[`${postPath(p)}index.html`] = postPage(c, p, site, template);
    }
    if (events(c).length) out['events/index.html'] = eventsPage(c, site, template);
    if (albums(c).length) {
      out['music/index.html'] = musicPage(c, site, template);
      for (const a of albums(c)) out[`music/${a.id}/index.html`] = albumPage(c, a, site, template);
    }
    out['board-game/index.html'] = gamePage(c, site, template);
    out['about/index.html'] = aboutPage(c, site, template);
    out['contact/index.html'] = contactPage(c, site, template);
    out['privacy/index.html'] = privacyPage(c, site, template);
    return out;
  }

  // Sidene admin har ansvar for. Ligger det en slik side i repoet som ikke lages lenger, slettes den.
  const MANAGED = /^((books|news|music)\/([a-z0-9-]+\/)?index\.html|(events|about|contact|privacy|board-game)\/index\.html)$/;

  const SEO = { files, indexLd, MANAGED, DATA_BLOCK };
  if (typeof module === 'object' && module.exports) module.exports = SEO;
  else root.EC_SEO = SEO;
})(this);
