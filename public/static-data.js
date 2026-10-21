window.GoodreadsData = (() => {
  function safeUrl(value) {
    try {
      const url = new URL(String(value || '').trim());
      return ['https:', 'http:'].includes(url.protocol) ? url.href : '';
    } catch {
      return '';
    }
  }

  function numberOrNull(value) {
    if (value === null || value === undefined || String(value).trim() === '') {
      return null;
    }
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function parseDate(value) {
    const text = String(value || '').trim();
    if (!text) {
      return null;
    }
    const date = new Date(text);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  async function loadLibrary() {
    let payload = window.__GOODREADS_LIBRARY__;
    if (!payload) {
      let response;
      try {
        response = await fetch('data/library.json', { signal: AbortSignal.timeout(15000) });
      } catch (error) {
        if (error.name === 'TimeoutError') {
          throw new Error('La carga de la biblioteca ha tardado demasiado. Vuelve a intentarlo.', { cause: error });
        }
        throw error;
      }
      if (!response.ok) {
        throw new Error('No se pudo cargar data/library.json. Vuelve a intentarlo.');
      }
      payload = await response.json();
    }
    if (!payload?.library || !Array.isArray(payload.library.books)
      || payload.library.books.some((book) => !book || typeof book !== 'object' || Array.isArray(book))) {
      throw new Error('Los datos de la biblioteca no son válidos. Vuelve a sincronizar.');
    }
    return payload;
  }

  return { loadLibrary, safeUrl, numberOrNull, parseDate };
})();
