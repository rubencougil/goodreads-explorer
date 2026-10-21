const { loadLibrary, safeUrl, numberOrNull, parseDate } = window.GoodreadsData;

const elements = {
  heroDescription: document.querySelector('#hero-description'),
  searchInput: document.querySelector('#search-input'),
  filtersToggle: document.querySelector('#filters-toggle'),
  shelfFilter: document.querySelector('#shelf-filter'),
  statusFilter: document.querySelector('#status-filter'),
  ratingFilter: document.querySelector('#rating-filter'),
  yearFilter: document.querySelector('#year-filter'),
  readYearFilter: document.querySelector('#read-year-filter'),
  sortBy: document.querySelector('#sort-by'),
  advancedFilters: document.querySelector('#advanced-filters'),
  resultsTitle: document.querySelector('#results-title'),
  resultsMeta: document.querySelector('#results-meta'),
  results: document.querySelector('#results'),
  emptyState: document.querySelector('#empty-state'),
  errorState: document.querySelector('#error-state'),
  errorMessage: document.querySelector('#error-message'),
  retryButton: document.querySelector('#retry-button'),
  loadMore: document.querySelector('#load-more'),
  loadMoreButton: document.querySelector('#load-more-button'),
  loadStatus: document.querySelector('#load-status'),
  template: document.querySelector('#book-card-template')
};

let books = [];
let filteredBooks = [];
let renderedCount = 0;
let loadObserver = null;
const mobileFilterQuery = window.matchMedia('(max-width: 640px)');
const MOBILE_PAGE_SIZE = 12;
const DESKTOP_PAGE_SIZE = 24;

function getPageSize() {
  return mobileFilterQuery.matches ? MOBILE_PAGE_SIZE : DESKTOP_PAGE_SIZE;
}

function normalizeBook(book) {
  const rating = numberOrNull(book.rating);
  const averageRating = numberOrNull(book.averageRating);
  return {
    bookId: String(book.bookId || '').trim(),
    title: String(book.title || '').trim(),
    author: String(book.author || '').trim(),
    authorUrl: safeUrl(book.authorUrl),
    rating: rating > 0 ? rating : null,
    averageRating: averageRating > 0 ? averageRating : null,
    year: String(book.year || '').trim(),
    pages: numberOrNull(book.pages),
    bookshelves: Array.isArray(book.bookshelves) ? book.bookshelves.map(String) : [],
    exclusiveShelf: String(book.exclusiveShelf || '').trim(),
    dateRead: String(book.dateRead || '').trim(),
    dateAdded: String(book.dateAdded || '').trim(),
    myReview: String(book.myReview || '').trim(),
    url: safeUrl(book.url),
    searchUrl: safeUrl(book.searchUrl),
    coverUrl: safeUrl(book.coverUrl)
  };
}

function formatDate(value) {
  if (!value) {
    return '';
  }

  const date = parseDate(value);
  if (!date) {
    return value;
  }

  return new Intl.DateTimeFormat('es-ES', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC'
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
  return parseDate(value)?.getTime() || 0;
}

function readingYear(book) {
  const date = parseDate(book.dateRead);
  return date ? String(date.getUTCFullYear()) : '';
}

function readingOrderScore(book) {
  const readScore = dateScore(book.dateRead);
  if (readScore) {
    return readScore;
  }

  if (deriveStatus(book) === 'read' || deriveStatus(book) === 'currently-reading') {
    return dateScore(book.dateAdded);
  }

  return 0;
}

function compareReadingOrder(left, right) {
  const leftIsCurrentlyReading = deriveStatus(left) === 'currently-reading';
  const rightIsCurrentlyReading = deriveStatus(right) === 'currently-reading';

  if (leftIsCurrentlyReading !== rightIsCurrentlyReading) {
    return rightIsCurrentlyReading - leftIsCurrentlyReading;
  }

  return readingOrderScore(right) - readingOrderScore(left) || compareValues(left.title, right.title);
}

function resolveBookUrl(book) {
  return book.url || book.searchUrl || '';
}

function buildGoodreadsCoverVariant(url, size) {
  const text = safeUrl(url);
  if (!text) {
    return '';
  }
  const parsed = new URL(text);
  if (!['m.media-amazon.com', 'i.gr-assets.com'].includes(parsed.hostname)
    || !/^\/images\/S\/compressed\.photo\.goodreads\.com\/books\/.+\.jpg$/i.test(parsed.pathname)) {
    return '';
  }

  parsed.pathname = parsed.pathname.replace(/(?:\._[^/]+_)?\.jpg$/i, `._SX${size}_.jpg`);
  return parsed.href;
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
  const readYear = elements.readYearFilter.value;
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

    if (readYear !== 'all' && readingYear(book) !== readYear) {
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
        return compareReadingOrder(left, right);
    }
  });

  return filtered;
}

function setCover(node, book, eager = false) {
  const image = node.querySelector('.book-cover');
  const fallback = node.querySelector('.book-cover-fallback');
  const coverUrl = safeUrl(book.coverUrl);
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
  image.sizes = coverSrcSet
    ? '(max-width: 640px) calc((100vw - 118px) / 2), (max-width: 703px) 260px, (max-width: 917px) 240px, (max-width: 980px) 195px, (max-width: 1200px) 240px, 200px'
    : '';
  image.srcset = coverSrcSet;
  image.src = coverSrc;
  image.onerror = () => {
    if (image.srcset || image.src !== coverUrl) {
      image.removeAttribute('srcset');
      image.src = coverUrl;
    } else {
      image.hidden = true;
      fallback.hidden = false;
      image.onerror = null;
    }
  };
}

function renderBooks(records, startIndex) {
  const fragment = document.createDocumentFragment();

  records.forEach((book, index) => {
    const node = elements.template.content.firstElementChild.cloneNode(true);
    const bookUrl = resolveBookUrl(book);
    const authorUrl = safeUrl(book.authorUrl);
    const isCurrentlyReading = deriveStatus(book) === 'currently-reading';

    setCover(node, book, startIndex + index < 2);
    node.classList.toggle('is-currently-reading', isCurrentlyReading);

    const coverLink = node.querySelector('.book-cover-link');
    coverLink.setAttribute('aria-label', `Ver ${book.title || 'libro'} en Goodreads`);
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
      const link = document.createElement('a');
      link.href = bookUrl;
      link.target = '_blank';
      link.rel = 'noreferrer';
      link.textContent = book.title;
      titleNode.appendChild(link);
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
}

function loadNextBatch() {
  loadObserver?.unobserve(elements.loadMore);
  const records = filteredBooks.slice(renderedCount, renderedCount + getPageSize());
  if (records.length) {
    renderBooks(records, renderedCount);
    renderedCount += records.length;
  }

  const hasMore = renderedCount < filteredBooks.length;
  elements.loadMore.hidden = filteredBooks.length === 0;
  elements.loadMoreButton.hidden = !hasMore;
  elements.loadStatus.textContent = filteredBooks.length
    ? `${renderedCount} de ${filteredBooks.length} libros mostrados`
    : '';
  if (hasMore) {
    loadObserver?.observe(elements.loadMore);
  }
}

function render() {
  loadObserver?.disconnect();
  filteredBooks = applyFilters();
  renderedCount = 0;
  elements.results.innerHTML = '';
  elements.emptyState.hidden = filteredBooks.length > 0;
  loadNextBatch();
  elements.resultsMeta.textContent = `${filteredBooks.length} de ${books.length} libros`;
  elements.resultsTitle.textContent = filteredBooks.length === books.length ? 'Tus libros' : 'Libros filtrados';
}

function installEvents() {
  [
    elements.searchInput,
    elements.shelfFilter,
    elements.statusFilter,
    elements.ratingFilter,
    elements.yearFilter,
    elements.readYearFilter,
    elements.sortBy
  ].forEach((control) => control.addEventListener('input', render));

  elements.loadMoreButton.addEventListener('click', loadNextBatch);
}

function installInfiniteScroll() {
  if (typeof IntersectionObserver !== 'function') {
    return;
  }

  loadObserver = new IntersectionObserver((entries) => {
    if (entries.some((entry) => entry.isIntersecting)) {
      loadNextBatch();
    }
  }, { rootMargin: '400px 0px' });
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
    syncAdvancedFiltersVisibility();
    elements.errorState.hidden = true;
    elements.emptyState.hidden = true;
    elements.resultsMeta.textContent = 'Cargando...';
    renderSkeletonBooks();
    const payload = await loadLibrary();
    books = payload.library.books.map(normalizeBook);

    const shelfValues = [...new Set(books.flatMap((book) => [book.exclusiveShelf, ...book.bookshelves]).filter(Boolean))].sort(compareValues);
    const years = [...new Set(books.map((book) => String(book.year || '')).filter(Boolean))].sort(
      (left, right) => Number(right) - Number(left)
    );
    const readYears = [...new Set(books.map(readingYear).filter(Boolean))].sort(
      (left, right) => Number(right) - Number(left)
    );

    populateSelect(elements.shelfFilter, shelfValues);
    populateSelect(elements.yearFilter, years);
    populateSelect(elements.readYearFilter, readYears);

    if (elements.heroDescription) {
      elements.heroDescription.textContent = payload?.library?.lastSyncedAt
        ? `Última sincronización: ${formatDate(payload.library.lastSyncedAt)}. Busca por título, autor o estantería.`
        : 'Todavía no hay datos sincronizados. Ejecuta la sincronización manual para poblar la biblioteca.';
    }

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
    installInfiniteScroll();
    render();
    if (elements.results) {
      elements.results.removeAttribute('aria-busy');
    }
  } catch (error) {
    console.error('No se pudo cargar la biblioteca.', error);
    elements.errorMessage.textContent = error.message || 'No se pudo cargar la biblioteca.';
    elements.errorState.hidden = false;
    if (elements.resultsMeta) {
      elements.resultsMeta.textContent = 'No hay datos disponibles';
    }
    if (elements.results) {
      elements.results.removeAttribute('aria-busy');
      elements.results.innerHTML = '';
    }
    elements.emptyState.hidden = true;
    loadObserver?.disconnect();
    elements.loadMore.hidden = true;
  }
}

elements.retryButton.addEventListener('click', init);
init();
