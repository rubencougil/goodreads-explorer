const DATA_PATH = 'data/library.json';

const elements = {
  summary: document.querySelector('#sync-summary')
};

function addItem(label, value) {
  const item = document.createElement('div');
  item.className = 'stack-item';
  item.innerHTML = `<strong>${label}</strong><span>${value}</span>`;
  return item;
}

async function init() {
  try {
    const response = await fetch(DATA_PATH);
    if (!response.ok) {
      throw new Error('Todavía no existe una biblioteca sincronizada.');
    }

    const payload = await response.json();
    const books = Array.isArray(payload?.library?.books) ? payload.library.books : [];
    const lastSyncedAt = payload?.library?.lastSyncedAt
      ? new Date(payload.library.lastSyncedAt).toLocaleString('es-ES')
      : 'Todavía no sincronizado';

    elements.summary.appendChild(
      addItem('Perfil', String(payload?.profile?.displayName || 'Mi Goodreads'))
    );
    elements.summary.appendChild(addItem('Libros', String(books.length)));
    elements.summary.appendChild(addItem('Última sincronización', lastSyncedAt));
    elements.summary.appendChild(addItem('Fichero de datos', 'public/data/library.json'));
  } catch (error) {
    elements.summary.appendChild(
      addItem('Estado', error.message || 'No se pudo cargar el estado de sincronización.')
    );
  }
}

init();
