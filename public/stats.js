const { loadLibrary, parseDate } = window.GoodreadsData;

const elements = {
  title: document.querySelector('#stats-title'),
  subtitle: document.querySelector('#stats-subtitle'),
  books: document.querySelector('#stats-books'),
  rated: document.querySelector('#stats-rated'),
  average: document.querySelector('#stats-average'),
  pages: document.querySelector('#stats-pages'),
  summaryChips: document.querySelector('#summary-chips'),
  ratingDistribution: document.querySelector('#rating-distribution'),
  yearList: document.querySelector('#year-list'),
  monthlyPaceValue: document.querySelector('#monthly-pace-value'),
  monthlyPaceMeta: document.querySelector('#monthly-pace-meta'),
  monthlyPaceList: document.querySelector('#monthly-pace-list'),
  retryButton: document.querySelector('#retry-button')
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
  const width = max > 0 ? (value / max) * 100 : 0;
  row.innerHTML = `
    <div class="bar-row-topline">
      <span></span>
      <strong>${value}</strong>
    </div>
    <div class="bar-track"><div class="bar-fill" style="width:${width}%"></div></div>
  `;
  row.querySelector('span').textContent = label;
  return row;
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
  const paddingRight = 36;
  const paddingTop = 28;
  const paddingBottom = 60;
  const plotWidth = width - paddingLeft - paddingRight;
  const plotHeight = height - paddingTop - paddingBottom;
  const max = Math.max(...entries.map((entry) => entry.value), 1);
  const step = entries.length > 1 ? plotWidth / (entries.length - 1) : 0;
  const barWidth = Math.min(48, Math.max(24, plotWidth / Math.max(entries.length, 6) * 0.55));
  const points = entries.map((entry, index) => {
    const x = paddingLeft + (step * index);
    const barHeight = (entry.value / max) * plotHeight;
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
  const tickMarks = tickValues.map((value) => {
    const y = paddingTop + ((1 - value / max) * plotHeight);
    return `
      <line x1="${paddingLeft}" y1="${y}" x2="${width - paddingRight}" y2="${y}" class="timeline-grid-line"></line>
      <text x="${tickLabelX}" y="${y + 4}" text-anchor="end" class="timeline-axis-value">${value}</text>
    `;
  }).join('');

  target.innerHTML = `
    <div class="timeline-chart-shell">
      <svg class="timeline-chart" viewBox="0 0 ${width} ${height}" role="group" aria-label="Serie mensual de lecturas">
        <g class="timeline-grid">
          ${tickMarks}
          <line x1="${paddingLeft}" y1="${paddingTop}" x2="${paddingLeft}" y2="${paddingTop + plotHeight}" class="timeline-axis-line"></line>
        </g>
        <path class="timeline-area" d="${areaPath}"></path>
        <path class="timeline-line" d="${linePath}"></path>
        ${points.map((point) => `
          <rect class="timeline-hitbox" role="img" aria-label="${point.label}: ${point.value} libros" tabindex="0" x="${point.x - (barWidth / 2)}" y="${paddingTop}" width="${barWidth}" height="${plotHeight}" rx="14" ry="14" data-label="${point.label}" data-value="${point.value}"></rect>
          <rect class="timeline-bar" x="${point.x - (barWidth / 2)}" y="${point.y}" width="${barWidth}" height="${point.barHeight}" rx="14" ry="14"></rect>
          <circle class="timeline-point" aria-hidden="true" cx="${point.x}" cy="${point.y}" r="6" data-label="${point.label}" data-value="${point.value}"></circle>
        `).join('')}
        ${labels}
      </svg>
      <div class="timeline-tooltip" aria-live="polite" hidden>
        <strong id="timeline-tooltip-value">${points[points.length - 1].value}</strong>
        <span id="timeline-tooltip-label">${points[points.length - 1].label}</span>
      </div>
    </div>
  `;

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

  hitboxes.forEach((node) => {
    node.addEventListener('pointerenter', (event) => showTooltip(node, event));
    node.addEventListener('pointermove', moveTooltip);
    node.addEventListener('pointerleave', hideTooltip);
    node.addEventListener('focus', (event) => showTooltip(node, event));
    node.addEventListener('blur', hideTooltip);
    node.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        hideTooltip();
      }
    });
    node.addEventListener('click', (event) => showTooltip(node, event));
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
    const label = document.createElement('span');
    label.textContent = entry.label;
    const value = document.createElement('strong');
    value.textContent = entry.value;
    chip.append(label, value);
    target.appendChild(chip);
  });
}

function toYear(value) {
  const date = parseDate(value);
  return date ? date.getUTCFullYear() : null;
}

function toMonthKey(value) {
  const date = parseDate(value);
  if (!date) {
    return null;
  }

  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(monthKey) {
  const [year, month] = String(monthKey || '').split('-').map((value) => Number(value));
  if (!year || !month) {
    return String(monthKey || '');
  }

  return new Intl.DateTimeFormat('es-ES', { month: 'short', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(Date.UTC(year, month - 1, 1)))
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

function recentMonths(counts) {
  const keys = [...counts.keys()].sort();
  if (!keys.length) {
    return [];
  }
  const last = parseDate(`${keys[keys.length - 1]}-01`);
  const span = Math.min(12, monthsBetweenInclusive(keys[0], keys[keys.length - 1]));
  return Array.from({ length: span }, (_, index) => {
    const date = new Date(Date.UTC(last.getUTCFullYear(), last.getUTCMonth() - span + index + 1, 1));
    const key = toMonthKey(date.toISOString());
    return { label: monthLabel(key), value: counts.get(key) || 0 };
  });
}

async function init() {
  try {
    elements.retryButton.hidden = true;
    elements.summaryChips.setAttribute('aria-busy', 'true');
    const payload = await loadLibrary();
    const books = payload.library.books;
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
      .sort((left, right) => Number(right.label) - Number(left.label));

    const monthCountsMap = groupCount(
      books.filter((book) => toMonthKey(book.dateRead)),
      (book) => toMonthKey(book.dateRead)
    );
    const monthCounts = recentMonths(monthCountsMap);
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
        ? `Basado en ${formatCount(totalReadMonths, 'lectura')} en ${monthSpan} ${monthSpan === 1 ? 'mes' : 'meses'}, desde ${monthLabel(firstReadMonth)} hasta ${monthLabel(lastReadMonth)}.`
        : 'Todavía no hay fechas de lectura suficientes para calcular un ritmo medio.';
    }

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
    renderBarList(elements.yearList, yearCounts.slice(0, 12));
    renderTimelineChart(elements.monthlyPaceList, monthCounts);

  } catch (error) {
    console.error('No se pudieron cargar las estadísticas.', error);
    if (elements.subtitle) {
      elements.subtitle.textContent = error.message || 'No se pudieron cargar las estadísticas.';
    }
    elements.retryButton.hidden = false;
    elements.summaryChips.textContent = 'No hay datos disponibles.';
  } finally {
    elements.summaryChips.removeAttribute('aria-busy');
  }
}

elements.retryButton.addEventListener('click', init);
init();
