const DATA_PATH = 'data/library.json';

const elements = {
  title: document.querySelector('#stats-title'),
  subtitle: document.querySelector('#stats-subtitle'),
  books: document.querySelector('#stats-books'),
  rated: document.querySelector('#stats-rated'),
  average: document.querySelector('#stats-average'),
  pages: document.querySelector('#stats-pages'),
  secondary: document.querySelector('#stats-secondary'),
  summaryChips: document.querySelector('#summary-chips'),
  ratingDistribution: document.querySelector('#rating-distribution'),
  shelfDistribution: document.querySelector('#shelf-distribution'),
  authorList: document.querySelector('#author-list'),
  yearList: document.querySelector('#year-list'),
  longestList: document.querySelector('#longest-list'),
  gapList: document.querySelector('#gap-list')
};

const mobileQuery = window.matchMedia('(max-width: 640px)');

function groupCount(items, keyFn) {
  const counts = new Map();
  items.forEach((item) => {
    const key = keyFn(item);
    if (!key) {
      return;
    }
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  return counts;
}

function createBarRow(label, value, max) {
  const row = document.createElement('div');
  row.className = 'bar-row';
  const width = max > 0 ? Math.max(6, (value / max) * 100) : 0;
  row.innerHTML = `
    <div class="bar-row-topline">
      <span>${label}</span>
      <strong>${value}</strong>
    </div>
    <div class="bar-track"><div class="bar-fill" style="width:${width}%"></div></div>
  `;
  return row;
}

function createStackItem(title, meta, href = '') {
  const item = document.createElement('div');
  item.className = 'stack-item';

  const label = href
    ? `<a class="stack-link" href="${href}" target="_blank" rel="noreferrer">${title}</a>`
    : `<span class="stack-title">${title}</span>`;

  item.innerHTML = `<strong>${label}</strong><span class="stack-meta">${meta}</span>`;
  return item;
}

function renderBarList(target, entries) {
  target.innerHTML = '';
  if (!entries.length) {
    target.textContent = 'Todavía no hay datos.';
    return;
  }

  const max = Math.max(...entries.map((entry) => entry.value));
  entries.forEach((entry) => {
    target.appendChild(createBarRow(entry.label, entry.value, max));
  });
}

function renderStackList(target, entries, emptyMessage, createItem) {
  target.innerHTML = '';
  if (!entries.length) {
    target.textContent = emptyMessage;
    return;
  }

  entries.forEach((entry) => {
    target.appendChild(createItem(entry));
  });
}

function renderSummaryChips(target, entries) {
  target.innerHTML = '';
  if (!entries.length) {
    target.textContent = 'Todavía no hay suficientes datos.';
    return;
  }

  entries.forEach((entry) => {
    const chip = document.createElement('article');
    chip.className = 'summary-chip';
    chip.innerHTML = `<span>${entry.label}</span><strong>${entry.value}</strong>`;
    target.appendChild(chip);
  });
}

function parseDate(value) {
  const text = String(value || '').trim();
  if (!text) {
    return null;
  }

  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toYear(value) {
  const date = parseDate(value);
  return date ? date.getFullYear() : null;
}

function formatCount(value, noun) {
  return `${value} ${noun}${value === 1 ? '' : 's'}`;
}

function aggregateAuthors(books) {
  const authors = new Map();

  books.forEach((book) => {
    const label = String(book.author || '').trim();
    if (!label) {
      return;
    }

    const current = authors.get(label) || {
      label,
      value: 0,
      href: ''
    };

    current.value += 1;
    if (!current.href) {
      current.href = String(book.authorUrl || '').trim();
    }

    authors.set(label, current);
  });

  return [...authors.values()]
    .sort((left, right) => right.value - left.value || left.label.localeCompare(right.label, 'es'))
    .slice(0, 10);
}

function syncSecondarySection() {
  if (!elements.secondary) {
    return;
  }

  elements.secondary.open = !mobileQuery.matches;
}

async function init() {
  try {
    const payload = window.__GOODREADS_LIBRARY__
      ? window.__GOODREADS_LIBRARY__
      : await fetch(DATA_PATH).then((response) => {
          if (!response.ok) {
            throw new Error('No se pudo cargar data/library.json');
          }
          return response.json();
        });
    const books = Array.isArray(payload?.library?.books) ? payload.library.books : [];
    const displayName = String(payload?.profile?.displayName || 'Mi Goodreads').trim() || 'Mi Goodreads';
    const ratedBooks = books.filter((book) => Number.isFinite(Number(book.rating)) && Number(book.rating) > 0);
    const pageBooks = books.filter((book) => Number(book.pages) > 0);
    const averageRating = ratedBooks.reduce((sum, book) => sum + Number(book.rating), 0) / (ratedBooks.length || 1);
    const totalPages = books.reduce((sum, book) => sum + (Number(book.pages) || 0), 0);

    if (elements.title) {
      elements.title.textContent = `Resumen lector de ${displayName}.`;
    }
    if (elements.subtitle) {
      elements.subtitle.textContent = payload?.library?.lastSyncedAt
        ? `Basado en una exportación local de Goodreads del ${new Date(payload.library.lastSyncedAt).toLocaleDateString('es-ES')}.`
        : 'Ejecuta la sincronización manual para generar el resumen estático.';
    }
    if (elements.books) {
      elements.books.textContent = String(books.length);
    }
    if (elements.rated) {
      elements.rated.textContent = String(ratedBooks.length);
    }
    if (elements.average) {
      elements.average.textContent = ratedBooks.length ? averageRating.toFixed(2) : '-';
    }
    if (elements.pages) {
      elements.pages.textContent = totalPages ? totalPages.toLocaleString('es-ES') : '-';
    }

    const ratingEntries = [1, 2, 3, 4, 5].map((value) => ({
      label: `${value} estrella${value === 1 ? '' : 's'}`,
      value: ratedBooks.filter((book) => Number(book.rating) === value).length
    }));

    const shelfCounts = [...groupCount(
      books.flatMap((book) => [...new Set([book.exclusiveShelf, ...(Array.isArray(book.bookshelves) ? book.bookshelves : [])].filter(Boolean))]),
      (shelf) => String(shelf || '').trim()
    ).entries()]
      .map(([label, value]) => ({ label, value }))
      .sort((left, right) => right.value - left.value)
      .slice(0, 8);

    const authorCounts = aggregateAuthors(books);

    const yearCounts = [...groupCount(
      books.filter((book) => toYear(book.dateRead)),
      (book) => String(toYear(book.dateRead) || '')
    ).entries()]
      .map(([label, value]) => ({ label, value }))
      .sort((left, right) => Number(right.label) - Number(left.label))
      .slice(0, 12);

    const longestBooks = books
      .filter((book) => Number(book.pages) > 0)
      .sort((left, right) => Number(right.pages) - Number(left.pages))
      .slice(0, 10);

    const biggestGaps = books
      .filter((book) => Number.isFinite(Number(book.rating)) && Number(book.rating) > 0 && Number.isFinite(Number(book.averageRating)) && Number(book.averageRating) > 0)
      .map((book) => ({
        ...book,
        gap: Math.abs(Number(book.rating) - Number(book.averageRating))
      }))
      .sort((left, right) => right.gap - left.gap || String(left.title || '').localeCompare(String(right.title || ''), 'es'))
      .slice(0, 10);

    const currentlyReading = books.filter((book) => String(book.exclusiveShelf || '').trim() === 'currently-reading').length;
    const bestYearEntry = yearCounts.reduce((best, entry) => {
      if (!best || entry.value > best.value) {
        return entry;
      }
      if (entry.value === best.value && Number(entry.label) > Number(best.label)) {
        return entry;
      }
      return best;
    }, null);
    const longestBook = longestBooks[0] || null;
    const topShelf = shelfCounts[0] || null;
    const topAuthor = authorCounts[0] || null;
    const averagePages = pageBooks.length
      ? `${Math.round(pageBooks.reduce((sum, book) => sum + Number(book.pages), 0) / pageBooks.length).toLocaleString('es-ES')} p.`
      : '-';

    renderSummaryChips(elements.summaryChips, [
      currentlyReading ? { label: 'Leyendo ahora', value: formatCount(currentlyReading, 'libro') } : null,
      bestYearEntry ? { label: 'Año más lector', value: `${bestYearEntry.label} · ${bestYearEntry.value}` } : null,
      topShelf ? { label: 'Estantería principal', value: `${topShelf.label} · ${topShelf.value}` } : null,
      topAuthor ? { label: 'Autor más repetido', value: `${topAuthor.label} · ${topAuthor.value}` } : null,
      averagePages !== '-' ? { label: 'Longitud media', value: averagePages } : null,
      longestBook ? { label: 'Libro más largo', value: `${Number(longestBook.pages).toLocaleString('es-ES')} p.` } : null
    ].filter(Boolean));

    renderBarList(elements.ratingDistribution, ratingEntries);
    renderBarList(elements.shelfDistribution, shelfCounts);
    renderBarList(elements.yearList, yearCounts);

    renderStackList(elements.authorList, authorCounts, 'Todavía no hay datos de autores.', (entry) =>
      createStackItem(entry.label, formatCount(entry.value, 'libro'), entry.href)
    );
    renderStackList(elements.longestList, longestBooks, 'Todavía no hay datos de páginas.', (book) =>
      createStackItem(
        book.title,
        `${Number(book.pages).toLocaleString('es-ES')} páginas`,
        String(book.url || '')
      )
    );
    renderStackList(elements.gapList, biggestGaps, 'Todavía no hay suficientes notas para comparar.', (book) =>
      createStackItem(
        book.title,
        `Tu nota ${Number(book.rating).toFixed(0)} • Goodreads ${Number(book.averageRating).toFixed(2)}`,
        String(book.url || '')
      )
    );

    syncSecondarySection();
    if (typeof mobileQuery.addEventListener === 'function') {
      mobileQuery.addEventListener('change', syncSecondarySection);
    } else if (typeof mobileQuery.addListener === 'function') {
      mobileQuery.addListener(syncSecondarySection);
    }
    document.body.classList.remove('is-loading');
  } catch (error) {
    if (elements.subtitle) {
      elements.subtitle.textContent = error.message || 'No se pudieron cargar las estadísticas.';
    }
    document.body.classList.remove('is-loading');
  }
}

init();
