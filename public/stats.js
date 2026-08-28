const DATA_PATH = 'data/library.json';

const elements = {
  title: document.querySelector('#stats-title'),
  subtitle: document.querySelector('#stats-subtitle'),
  books: document.querySelector('#stats-books'),
  rated: document.querySelector('#stats-rated'),
  average: document.querySelector('#stats-average'),
  pages: document.querySelector('#stats-pages'),
  summaryChips: document.querySelector('#summary-chips'),
  ratingDistribution: document.querySelector('#rating-distribution'),
  shelfDistribution: document.querySelector('#shelf-distribution'),
  yearList: document.querySelector('#year-list'),
  monthlyPaceValue: document.querySelector('#monthly-pace-value'),
  monthlyPaceMeta: document.querySelector('#monthly-pace-meta'),
  monthlyPaceList: document.querySelector('#monthly-pace-list'),
  gapList: document.querySelector('#gap-list')
};

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
  if (!target) {
    return;
  }
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

function renderTimelineChart(target, entries) {
  if (!target) {
    return;
  }
  target.innerHTML = '';
  if (!entries.length) {
    target.textContent = 'Todavía no hay datos.';
    return;
  }

  const width = 840;
  const height = 300;
  const paddingLeft = 98;
  const paddingRight = 18;
  const paddingTop = 28;
  const paddingBottom = 60;
  const plotWidth = width - paddingLeft - paddingRight;
  const plotHeight = height - paddingTop - paddingBottom;
  const max = Math.max(...entries.map((entry) => entry.value), 1);
  const step = entries.length > 1 ? plotWidth / (entries.length - 1) : 0;
  const barWidth = Math.min(48, Math.max(24, plotWidth / Math.max(entries.length, 6) * 0.55));
  const points = entries.map((entry, index) => {
    const x = paddingLeft + (step * index);
    const barHeight = Math.max(12, (entry.value / max) * plotHeight);
    const y = paddingTop + (plotHeight - barHeight);
    return {
      ...entry,
      x,
      y,
      barHeight,
      index
    };
  });

  const areaPath = points.length
    ? [
        `M ${points[0].x} ${paddingTop + plotHeight}`,
        `L ${points[0].x} ${points[0].y}`,
        ...points.slice(1).map((point) => `L ${point.x} ${point.y}`),
        `L ${points[points.length - 1].x} ${paddingTop + plotHeight}`,
        'Z'
      ].join(' ')
    : '';

  const linePath = points
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`)
    .join(' ');

  const labels = points.map((point) => {
    const tickY = paddingTop + plotHeight + 22;
    return `
      <text x="${point.x}" y="${tickY}" text-anchor="middle" class="timeline-axis-label">${point.label}</text>
    `;
  }).join('');

  const tickValues = [max, Math.ceil(max / 2), 0]
    .filter((value, index, values) => values.indexOf(value) === index)
    .sort((left, right) => right - left);
  const tickLabelX = 50;
  const tickSpacing = tickValues.length > 1 ? plotHeight / (tickValues.length - 1) : 0;
  const tickMarks = tickValues.map((value, index) => {
    const y = paddingTop + (tickSpacing * index);
    return `
      <line x1="${paddingLeft}" y1="${y}" x2="${width - paddingRight}" y2="${y}" class="timeline-grid-line"></line>
      <text x="${tickLabelX}" y="${y + 4}" text-anchor="end" class="timeline-axis-value">${value}</text>
    `;
  }).join('');

  target.innerHTML = `
    <div class="timeline-chart-shell">
      <svg class="timeline-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Serie mensual de lecturas">
        <g class="timeline-grid">
          ${tickMarks}
          <line x1="${paddingLeft}" y1="${paddingTop}" x2="${paddingLeft}" y2="${paddingTop + plotHeight}" class="timeline-axis-line"></line>
        </g>
        <path class="timeline-area" d="${areaPath}"></path>
        <path class="timeline-line" d="${linePath}"></path>
        ${points.map((point) => `
          <rect class="timeline-hitbox" tabindex="0" x="${point.x - (barWidth / 2)}" y="${paddingTop}" width="${barWidth}" height="${plotHeight}" rx="14" ry="14" data-label="${point.label}" data-value="${point.value}"></rect>
          <rect class="timeline-bar" x="${point.x - (barWidth / 2)}" y="${point.y}" width="${barWidth}" height="${point.barHeight}" rx="14" ry="14"></rect>
          <circle class="timeline-point" tabindex="0" cx="${point.x}" cy="${point.y}" r="6" data-label="${point.label}" data-value="${point.value}"></circle>
        `).join('')}
        ${labels}
      </svg>
      <div class="timeline-tooltip" aria-live="polite" hidden>
        <strong id="timeline-tooltip-value">${points[points.length - 1].value}</strong>
        <span id="timeline-tooltip-label">${points[points.length - 1].label}</span>
      </div>
    </div>
  `;

  const svg = target.querySelector('.timeline-chart');
  const shell = target.querySelector('.timeline-chart-shell');
  const tooltipValue = target.querySelector('#timeline-tooltip-value');
  const tooltipLabel = target.querySelector('#timeline-tooltip-label');
  const hitboxes = [...target.querySelectorAll('.timeline-hitbox, .timeline-point')];
  const tooltip = target.querySelector('.timeline-tooltip');
  let activePoint = points[points.length - 1] || null;

  const setActive = (label, value) => {
    if (tooltipValue) {
      tooltipValue.textContent = String(value);
    }
    if (tooltipLabel) {
      tooltipLabel.textContent = label;
    }
  };

  const positionTooltip = (clientX, clientY) => {
    if (!shell || !tooltip) {
      return;
    }

    const shellRect = shell.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();
    const offset = 14;
    let left = clientX - shellRect.left + offset;
    let top = clientY - shellRect.top - tooltipRect.height - offset;

    if (left + tooltipRect.width > shellRect.width - 8) {
      left = clientX - shellRect.left - tooltipRect.width - offset;
    }
    if (top < 8) {
      top = clientY - shellRect.top + offset;
    }

    tooltip.style.left = `${Math.max(8, left)}px`;
    tooltip.style.top = `${Math.max(8, top)}px`;
  };

  const showTooltip = (node, event) => {
    if (!tooltip || !node) {
      return;
    }

    activePoint = {
      label: node.dataset.label || '',
      value: node.dataset.value || ''
    };
    setActive(activePoint.label, activePoint.value);
    tooltip.hidden = false;
    const rect = node.getBoundingClientRect();
    const clientX = Number.isFinite(event?.clientX) && event.clientX > 0 ? event.clientX : rect.left + (rect.width / 2);
    const clientY = Number.isFinite(event?.clientY) && event.clientY > 0 ? event.clientY : rect.top + (rect.height / 2);
    positionTooltip(clientX, clientY);
  };

  const moveTooltip = (event) => {
    if (!tooltip || tooltip.hidden || !activePoint) {
      return;
    }
    positionTooltip(event.clientX, event.clientY);
  };

  const hideTooltip = () => {
    if (tooltip) {
      tooltip.hidden = true;
    }
  };

  const resolvePoint = (event) => {
    const directMatch = event.target?.closest?.('.timeline-hitbox, .timeline-point');
    if (directMatch) {
      return directMatch;
    }

    const targetNode = document.elementFromPoint(event.clientX, event.clientY);
    const fallbackMatch = targetNode?.closest?.('.timeline-hitbox, .timeline-point');
    return fallbackMatch || null;
  };

  const handlePointerMove = (event) => {
    const pointNode = resolvePoint(event);
    if (!pointNode) {
      hideTooltip();
      return;
    }
    if (pointNode.dataset) {
      showTooltip(pointNode, event);
    }
  };

  hitboxes.forEach((node) => {
    node.addEventListener('mouseenter', (event) => showTooltip(node, event));
    node.addEventListener('mousemove', moveTooltip);
    node.addEventListener('focus', (event) => showTooltip(node, event));
    node.addEventListener('click', (event) => showTooltip(node, event));
  });

  if (svg) {
    svg.addEventListener('pointermove', handlePointerMove);
    svg.addEventListener('mousemove', handlePointerMove);
    svg.addEventListener('mouseleave', hideTooltip);
  }
}

function renderStackList(target, entries, emptyMessage, createItem) {
  if (!target) {
    return;
  }
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

function toMonthKey(value) {
  const date = parseDate(value);
  if (!date) {
    return null;
  }

  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(monthKey) {
  const [year, month] = String(monthKey || '').split('-').map((value) => Number(value));
  if (!year || !month) {
    return String(monthKey || '');
  }

  return new Intl.DateTimeFormat('es-ES', { month: 'short', year: 'numeric' })
    .format(new Date(year, month - 1, 1))
    .replace('.', '');
}

function monthsBetweenInclusive(startKey, endKey) {
  const [startYear, startMonth] = String(startKey || '').split('-').map((value) => Number(value));
  const [endYear, endMonth] = String(endKey || '').split('-').map((value) => Number(value));

  if (!startYear || !startMonth || !endYear || !endMonth) {
    return 0;
  }

  return ((endYear - startYear) * 12) + (endMonth - startMonth) + 1;
}

function formatCount(value, noun) {
  return `${value} ${noun}${value === 1 ? '' : 's'}`;
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

    const yearCounts = [...groupCount(
      books.filter((book) => toYear(book.dateRead)),
      (book) => String(toYear(book.dateRead) || '')
    ).entries()]
      .map(([label, value]) => ({ label, value }))
      .sort((left, right) => Number(right.label) - Number(left.label))
      .slice(0, 12);

    const monthCountsMap = groupCount(
      books.filter((book) => toMonthKey(book.dateRead)),
      (book) => toMonthKey(book.dateRead)
    );
    const monthCounts = [...monthCountsMap.entries()]
      .sort((left, right) => left[0].localeCompare(right[0]))
      .slice(-12)
      .map(([label, value]) => ({ label: monthLabel(label), value }))
      ;
    const totalReadMonths = [...monthCountsMap.values()].reduce((sum, value) => sum + value, 0);
    const readMonthKeys = [...monthCountsMap.keys()].sort();
    const firstReadMonth = readMonthKeys[0] || null;
    const lastReadMonth = readMonthKeys[readMonthKeys.length - 1] || null;
    const monthSpan = monthsBetweenInclusive(firstReadMonth, lastReadMonth);
    const averageMonthlyReads = monthSpan > 0 ? totalReadMonths / monthSpan : 0;

    if (elements.monthlyPaceValue) {
      elements.monthlyPaceValue.textContent = monthSpan > 0 ? averageMonthlyReads.toFixed(1) : '-';
    }
    if (elements.monthlyPaceMeta) {
      elements.monthlyPaceMeta.textContent = monthSpan > 0
        ? `Basado en ${totalReadMonths} lecturas repartidas en ${monthSpan} meses, desde ${monthLabel(firstReadMonth)} hasta ${monthLabel(lastReadMonth)}.`
        : 'Todavía no hay fechas de lectura suficientes para calcular un ritmo medio.';
    }

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
    const topShelf = shelfCounts[0] || null;
    const averagePages = pageBooks.length
      ? `${Math.round(pageBooks.reduce((sum, book) => sum + Number(book.pages), 0) / pageBooks.length).toLocaleString('es-ES')} p.`
      : '-';

    renderSummaryChips(elements.summaryChips, [
      currentlyReading ? { label: 'Leyendo ahora', value: formatCount(currentlyReading, 'libro') } : null,
      bestYearEntry ? { label: 'Año más lector', value: `${bestYearEntry.label} · ${bestYearEntry.value}` } : null,
      topShelf ? { label: 'Estantería principal', value: `${topShelf.label} · ${topShelf.value}` } : null,
      averagePages !== '-' ? { label: 'Longitud media', value: averagePages } : null
    ].filter(Boolean));

    renderBarList(elements.ratingDistribution, ratingEntries);
    renderBarList(elements.shelfDistribution, shelfCounts);
    renderBarList(elements.yearList, yearCounts);
    renderTimelineChart(elements.monthlyPaceList, monthCounts);

    renderStackList(elements.gapList, biggestGaps, 'Todavía no hay suficientes notas para comparar.', (book) =>
      createStackItem(
        book.title,
        `Tu nota ${Number(book.rating).toFixed(0)} • Goodreads ${Number(book.averageRating).toFixed(2)}`,
        String(book.url || '')
      )
    );

    document.body.classList.remove('is-loading');
  } catch (error) {
    if (elements.subtitle) {
      elements.subtitle.textContent = error.message || 'No se pudieron cargar las estadísticas.';
    }
    document.body.classList.remove('is-loading');
  }
}

init();
