const DATA_PATH = 'data/library.json';
const PAGE_SIZE = 24;

const elements = {
  heroDescription: document.querySelector('#hero-description'),
  metricBooks: document.querySelector('#metric-books'),
  metricRating: document.querySelector('#metric-rating'),
  metricShelves: document.querySelector('#metric-shelves'),
  searchInput: document.querySelector('#search-input'),
  filtersToggle: document.querySelector('#filters-toggle'),
  shelfFilter: document.querySelector('#shelf-filter'),
  statusFilter: document.querySelector('#status-filter'),
  ratingFilter: document.querySelector('#rating-filter'),
  yearFilter: document.querySelector('#year-filter'),
  sortBy: document.querySelector('#sort-by'),
  advancedFilters: document.querySelector('#advanced-filters'),
  resultsTitle: document.querySelector('#results-title'),
  resultsMeta: document.querySelector('#results-meta'),
  results: document.querySelector('#results'),
  emptyState: document.querySelector('#empty-state'),
  pagination: document.querySelector('#pagination'),
  prevPage: document.querySelector('#prev-page'),
  nextPage: document.querySelector('#next-page'),
  pageInfo: document.querySelector('#page-info'),
  template: document.querySelector('#book-card-template')
};

let books = [];
let currentPage = 1;
const mobileFilterQuery = window.matchMedia('(max-width: 640px)');
const MOBILE_PAGE_SIZE = 12;
const DESKTOP_PAGE_SIZE = 24;

function getPageSize() {
  return mobileFilterQuery.matches ? MOBILE_PAGE_SIZE : DESKTOP_PAGE_SIZE;
}

function normalizeBook(book) {
  return {
    bookId: String(book.bookId || '').trim(),
    title: String(book.title || '').trim(),
    author: String(book.author || '').trim(),
    authorUrl: String(book.authorUrl || '').trim(),
    sortTitle: String(book.sortTitle || book.title || '').trim().toLowerCase(),
    rating: Number.isFinite(Number(book.rating)) ? Number(book.rating) : null,
    averageRating: Number.isFinite(Number(book.averageRating)) ? Number(book.averageRating) : null,
    year: String(book.year || '').trim(),
    pages: Number.isFinite(Number(book.pages)) ? Number(book.pages) : null,
    bookshelves: Array.isArray(book.bookshelves) ? book.bookshelves : [],
    exclusiveShelf: String(book.exclusiveShelf || '').trim(),
    dateRead: String(book.dateRead || '').trim(),
    dateAdded: String(book.dateAdded || '').trim(),
    myReview: String(book.myReview || '').trim(),
    url: String(book.url || '').trim(),
    searchUrl: String(book.searchUrl || '').trim(),
    coverUrl: String(book.coverUrl || '').trim()
  };
}

function loadJson() {
  if (window.__GOODREADS_LIBRARY__) {
    return Promise.resolve(window.__GOODREADS_LIBRARY__);
  }

  return fetch(DATA_PATH).then((response) => {
    if (!response.ok) {
      throw new Error('No se pudo cargar data/library.json');
    }
    return response.json();
  });
}

function formatDate(value) {
  if (!value) {
    return '';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat('es-ES', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  }).format(date);
}

function formatRating(value, fallback = 'Sin nota') {
  return Number.isFinite(value) ? value.toFixed(value % 1 === 0 ? 0 : 2) : fallback;
}

function toneClass(rating) {
  if (!Number.isFinite(rating)) {
    return 'tone-neutral';
  }
  if (rating <= 2) {
    return 'tone-low';
  }
  if (rating === 3) {
    return 'tone-mid';
  }
  return 'tone-high';
}

function populateSelect(select, values) {
  const fragment = document.createDocumentFragment();

  values.forEach((value) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = value;
    fragment.appendChild(option);
  });

  select.appendChild(fragment);
}

function deriveStatus(book) {
  return book.exclusiveShelf || 'unshelved';
}

function deriveSearchText(book) {
  return [
    book.title,
    book.author,
    book.exclusiveShelf,
    book.bookshelves.join(' ')
  ]
    .join(' ')
    .toLowerCase();
}

function compareValues(a, b) {
  return String(a || '').localeCompare(String(b || ''), 'es', {
    sensitivity: 'base'
  });
}

function dateScore(value) {
  if (!value) {
    return 0;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function resolveBookUrl(book) {
  return book.url || book.searchUrl || '';
}

function buildGoodreadsCoverVariant(url, size) {
  const text = String(url || '').trim();
  if (!text || !/gr-assets\.com|goodreads\.com/i.test(text)) {
    return '';
  }

  if (/_SX\d+_SY\d+_/i.test(text)) {
    return text.replace(/_SX\d+_SY\d+_/i, `_SX${size}_SY${Math.round(size * 1.5)}_`);
  }

  if (/_SY\d+_/i.test(text)) {
    return text.replace(/_SY\d+_/i, `_SY${size}_`);
  }

  if (/_SX\d+_/i.test(text)) {
    return text.replace(/_SX\d+_/i, `_SX${size}_`);
  }

  return '';
}

function buildGoodreadsCoverSrcSet(url) {
  const variants = [200, 318, 475]
    .map((size) => {
      const variant = buildGoodreadsCoverVariant(url, size);
      return variant ? `${variant} ${size}w` : '';
    })
    .filter(Boolean);

  return [...new Set(variants)].join(', ');
}

function renderSkeletonBooks() {
  if (!elements.results) {
    return;
  }

  const pageSize = getPageSize();
  const fragment = document.createDocumentFragment();

  for (let index = 0; index < pageSize; index += 1) {
    const item = document.createElement('article');
    item.className = 'book-card is-skeleton';
    item.setAttribute('aria-hidden', 'true');
    item.innerHTML = `
      <div class="book-cover-link">
        <div class="book-cover-frame skeleton-cover"></div>
      </div>
      <div class="book-card-body">
        <div class="book-card-topline">
          <span class="skeleton-pill"></span>
          <span class="skeleton-pill"></span>
        </div>
        <div class="skeleton-line skeleton-title"></div>
        <div class="skeleton-line skeleton-author"></div>
        <div class="skeleton-line skeleton-meta"></div>
        <div class="skeleton-line skeleton-dates"></div>
        <div class="skeleton-shelves">
          <span class="skeleton-chip"></span>
          <span class="skeleton-chip"></span>
        </div>
        <div class="skeleton-line skeleton-review"></div>
      </div>
    `;
    fragment.appendChild(item);
  }

  elements.results.innerHTML = '';
  elements.results.appendChild(fragment);
  elements.results.setAttribute('aria-busy', 'true');
}

function applyFilters() {
  const query = elements.searchInput.value.trim().toLowerCase();
  const shelf = elements.shelfFilter.value;
  const status = elements.statusFilter.value;
  const minRating = Number(elements.ratingFilter.value);
  const year = elements.yearFilter.value;
  const sortBy = elements.sortBy.value;

  const filtered = books.filter((book) => {
    if (query && !deriveSearchText(book).includes(query)) {
      return false;
    }

    if (shelf !== 'all' && !book.bookshelves.includes(shelf) && book.exclusiveShelf !== shelf) {
      return false;
    }

    if (status !== 'all' && deriveStatus(book) !== status) {
      return false;
    }

    if (Number.isFinite(minRating) && minRating > 0) {
      if (!Number.isFinite(book.rating) || book.rating < minRating) {
        return false;
      }
    }

    if (year !== 'all' && String(book.year || '') !== year) {
      return false;
    }

    return true;
  });

  filtered.sort((left, right) => {
    switch (sortBy) {
      case 'rating-desc':
        return (right.rating || 0) - (left.rating || 0) || compareValues(left.title, right.title);
      case 'average-rating-desc':
        return (right.averageRating || 0) - (left.averageRating || 0) || compareValues(left.title, right.title);
      case 'title-asc':
        return compareValues(left.title, right.title);
      case 'author-asc':
        return compareValues(left.author, right.author) || compareValues(left.title, right.title);
      case 'year-desc':
        return Number(right.year || 0) - Number(left.year || 0) || compareValues(left.title, right.title);
      case 'date-added-desc':
        return dateScore(right.dateAdded) - dateScore(left.dateAdded) || compareValues(left.title, right.title);
      case 'date-read-desc':
      default:
        return dateScore(right.dateRead) - dateScore(left.dateRead) || compareValues(left.title, right.title);
    }
  });

  return filtered;
}

function setCover(node, book, eager = false) {
  const image = node.querySelector('.book-cover');
  const fallback = node.querySelector('.book-cover-fallback');
  const coverUrl = String(book.coverUrl || '').trim();
  const label = book.title ? `Portada de ${book.title}` : 'Portada del libro';
  const coverSrcSet = buildGoodreadsCoverSrcSet(coverUrl);
  const coverSrc = buildGoodreadsCoverVariant(coverUrl, 318) || coverUrl;

  image.alt = label;
  image.decoding = 'async';
  image.width = 147;
  image.height = 219;

  if (!coverUrl) {
    image.hidden = true;
    fallback.hidden = false;
    return;
  }

  image.hidden = false;
  fallback.hidden = true;
  image.loading = eager ? 'eager' : 'lazy';
  image.fetchPriority = eager ? 'high' : 'low';
  image.sizes = coverSrcSet ? '(max-width: 640px) 50vw, 198px' : '';
  image.srcset = coverSrcSet;
  image.src = coverSrc;
  image.onerror = () => {
    image.hidden = true;
    fallback.hidden = false;
    image.onerror = null;
  };
}

function renderBooks(filtered) {
  elements.results.innerHTML = '';

  if (!filtered.length) {
    elements.emptyState.hidden = false;
    elements.pagination.hidden = true;
    return;
  }

  elements.emptyState.hidden = true;

  const pageSize = getPageSize();
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  currentPage = Math.min(Math.max(1, currentPage), totalPages);
  const startIndex = (currentPage - 1) * pageSize;
  const pageRecords = filtered.slice(startIndex, startIndex + pageSize);
  const fragment = document.createDocumentFragment();

  pageRecords.forEach((book, index) => {
    const node = elements.template.content.firstElementChild.cloneNode(true);
    const bookUrl = resolveBookUrl(book);
    const authorUrl = String(book.authorUrl || '').trim();
    const isCurrentlyReading = deriveStatus(book) === 'currently-reading';

    setCover(node, book, index < 2);
    node.classList.toggle('is-currently-reading', isCurrentlyReading);

    const coverLink = node.querySelector('.book-cover-link');
    if (bookUrl) {
      coverLink.href = bookUrl;
    } else {
      coverLink.removeAttribute('href');
    }

    node.querySelector('.your-rating').textContent = `Tu nota: ${formatRating(book.rating)}`;
    node.querySelector('.your-rating').classList.add(toneClass(book.rating));
    node.querySelector('.community-rating').textContent = `GR: ${formatRating(book.averageRating, '-')}`;
    node.querySelector('.community-rating').classList.add(toneClass(book.averageRating));

    if (isCurrentlyReading) {
      const readingBadge = document.createElement('span');
      readingBadge.className = 'status-pill status-pill-reading';
      readingBadge.textContent = 'Leyendo ahora';
      node.querySelector('.book-card-topline').appendChild(readingBadge);
    }

    const titleNode = node.querySelector('.book-title');
    if (bookUrl) {
      titleNode.innerHTML = `<a href="${bookUrl}" target="_blank" rel="noreferrer">${book.title}</a>`;
    } else {
      titleNode.textContent = book.title;
    }

    const authorNode = node.querySelector('.book-author');
    authorNode.textContent = book.author || 'Autor desconocido';
    if (authorUrl) {
      authorNode.href = authorUrl;
    } else {
      authorNode.removeAttribute('href');
      authorNode.removeAttribute('target');
      authorNode.removeAttribute('rel');
    }

    const metaBits = [book.year, book.pages ? `${book.pages} páginas` : '', book.exclusiveShelf]
      .filter(Boolean)
      .join(' • ');
    node.querySelector('.book-meta').textContent = metaBits || 'Sin metadatos extra';

    const dateBits = [
      book.dateRead ? `Leído ${formatDate(book.dateRead)}` : '',
      book.dateAdded ? `Añadido ${formatDate(book.dateAdded)}` : ''
    ]
      .filter(Boolean)
      .join(' • ');
    node.querySelector('.book-dates').textContent = dateBits || 'Sin fechas disponibles';

    const shelvesWrap = node.querySelector('.book-shelves');
    const shelves = [...new Set([book.exclusiveShelf, ...book.bookshelves].filter(Boolean))].slice(0, 6);
    shelves.forEach((entry) => {
      const pill = document.createElement('span');
      pill.className = 'shelf-pill';
      pill.textContent = entry;
      shelvesWrap.appendChild(pill);
    });

    const review = node.querySelector('.book-review');
    if (book.myReview) {
      review.textContent = book.myReview.slice(0, 180);
    } else {
      review.hidden = true;
    }

    fragment.appendChild(node);
  });

  elements.results.appendChild(fragment);

  elements.pagination.hidden = totalPages <= 1;
  elements.pageInfo.textContent = `Página ${currentPage} de ${totalPages}`;
  elements.prevPage.disabled = currentPage === 1;
  elements.nextPage.disabled = currentPage === totalPages;
}

function render() {
  const filtered = applyFilters();
  renderBooks(filtered);
  elements.resultsMeta.textContent = `${filtered.length} de ${books.length} libros`;
  elements.resultsTitle.textContent = filtered.length === books.length ? 'Tus libros' : 'Libros filtrados';
}

function resetAndRender() {
  currentPage = 1;
  render();
}

function installEvents() {
  [
    elements.searchInput,
    elements.shelfFilter,
    elements.statusFilter,
    elements.ratingFilter,
    elements.yearFilter,
    elements.sortBy
  ].forEach((control) => control.addEventListener('input', resetAndRender));

  elements.prevPage.addEventListener('click', () => {
    currentPage -= 1;
    render();
  });

  elements.nextPage.addEventListener('click', () => {
    currentPage += 1;
    render();
  });
}

function syncAdvancedFiltersVisibility() {
  if (!elements.advancedFilters) {
    return;
  }

  elements.advancedFilters.open = !mobileFilterQuery.matches;
  syncFiltersToggleLabel();
}

function syncFiltersToggleLabel() {
  if (!elements.filtersToggle || !elements.advancedFilters) {
    return;
  }

  const expanded = elements.advancedFilters.open;
  elements.filtersToggle.textContent = expanded ? 'Ocultar filtros' : 'Mostrar filtros';
  elements.filtersToggle.setAttribute('aria-expanded', String(expanded));
}

async function init() {
  try {
    renderSkeletonBooks();
    const payload = await loadJson();
    books = Array.isArray(payload?.library?.books) ? payload.library.books.map(normalizeBook) : [];

    const displayName = String(payload?.profile?.displayName || 'Mi Goodreads').trim() || 'Mi Goodreads';
    const shelfValues = [...new Set(books.flatMap((book) => [book.exclusiveShelf, ...book.bookshelves]).filter(Boolean))].sort(compareValues);
    const years = [...new Set(books.map((book) => String(book.year || '')).filter(Boolean))].sort(
      (left, right) => Number(right) - Number(left)
    );

    populateSelect(elements.shelfFilter, shelfValues);
    populateSelect(elements.yearFilter, years);

    const ratedBooks = books.filter((book) => Number.isFinite(book.rating) && book.rating > 0);
    const averageRating = ratedBooks.reduce((sum, book) => sum + book.rating, 0) / (ratedBooks.length || 1);

    if (elements.heroDescription) {
      elements.heroDescription.textContent = payload?.library?.lastSyncedAt
        ? `Última sincronización: ${formatDate(payload.library.lastSyncedAt)}. Busca por título, autor o estantería.`
        : 'Todavía no hay datos sincronizados. Ejecuta la sincronización manual para poblar la biblioteca.';
    }
    if (elements.metricBooks) {
      elements.metricBooks.textContent = String(books.length);
    }
    if (elements.metricRating) {
      elements.metricRating.textContent = ratedBooks.length ? averageRating.toFixed(2) : '-';
    }
    if (elements.metricShelves) {
      elements.metricShelves.textContent = String(shelfValues.length);
    }

    syncAdvancedFiltersVisibility();
    if (elements.filtersToggle && elements.advancedFilters) {
      elements.filtersToggle.addEventListener('click', () => {
        elements.advancedFilters.open = !elements.advancedFilters.open;
        syncFiltersToggleLabel();
      });
      elements.advancedFilters.addEventListener('toggle', syncFiltersToggleLabel);
      syncFiltersToggleLabel();
    }
    if (typeof mobileFilterQuery.addEventListener === 'function') {
      mobileFilterQuery.addEventListener('change', syncAdvancedFiltersVisibility);
    } else if (typeof mobileFilterQuery.addListener === 'function') {
      mobileFilterQuery.addListener(syncAdvancedFiltersVisibility);
    }
    installEvents();
    render();
    if (elements.results) {
      elements.results.removeAttribute('aria-busy');
    }
  } catch (error) {
    if (elements.heroDescription) {
      elements.heroDescription.textContent = error.message || 'No se pudo cargar la biblioteca.';
    }
    if (elements.resultsMeta) {
      elements.resultsMeta.textContent = 'No hay datos disponibles';
    }
    if (elements.results) {
      elements.results.removeAttribute('aria-busy');
      elements.results.innerHTML = '';
    }
    elements.emptyState.hidden = false;
    elements.pagination.hidden = true;
  }
}

init();
