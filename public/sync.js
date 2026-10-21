const { loadLibrary, parseDate } = window.GoodreadsData;

const elements = {
  summary: document.querySelector('#sync-summary'),
  retryButton: document.querySelector('#retry-button')
};

function addItem(label, value) {
  const item = document.createElement('div');
  item.className = 'stack-item';
  const title = document.createElement('strong');
  title.textContent = label;
  const text = document.createElement('span');
  text.textContent = value;
  item.append(title, text);
  return item;
}

async function init() {
  try {
    elements.retryButton.hidden = true;
    elements.summary.setAttribute('aria-busy', 'true');
    const payload = await loadLibrary();
    const books = payload.library.books;
    const date = parseDate(payload.library.lastSyncedAt);
    const lastSyncedAt = date
      ? date.toLocaleString('es-ES')
      : 'Todavía no sincronizado';

    if (elements.summary) {
      elements.summary.textContent = '';
      elements.summary.appendChild(
        addItem('Perfil', String(payload?.profile?.displayName || 'Mi Goodreads'))
      );
      elements.summary.appendChild(addItem('Libros', String(books.length)));
      elements.summary.appendChild(addItem('Última sincronización', lastSyncedAt));
      elements.summary.appendChild(addItem('Fichero de datos', 'public/data/library.json'));
    }
  } catch (error) {
    console.error('No se pudo cargar el estado de sincronización.', error);
    if (elements.summary) {
      elements.summary.textContent = '';
      elements.summary.appendChild(
        addItem('Estado', error.message || 'No se pudo cargar el estado de sincronización.')
      );
    }
    elements.retryButton.hidden = false;
  } finally {
    elements.summary.removeAttribute('aria-busy');
  }
}

elements.retryButton.addEventListener('click', init);
init();
