// Taarifa za papo hapo kutoka server ya NAYA (Server-Sent Events).
// Tiketi ya sekunde 60 inaombwa kwanza (token haipiti kwenye URL); muunganisho ukikatika,
// tunaomba tiketi mpya na kuunganisha tena (sekunde 1 → 2 → 4 … hadi 30).
const TYPES = ['ride', 'offer', 'driver', 'account', 'admin'];

export function connectRealtime(api, { onEvent, onStatus }) {
  let source = null;
  let stopped = false;
  let delay = 1000;
  let timer = null;

  const setStatus = (up) => onStatus?.(up);

  async function open() {
    if (stopped || !api.token) return;
    try {
      const { ticket } = await api.post('/api/stream/ticket');
      if (stopped) return;
      source = new EventSource(`/api/stream?ticket=${encodeURIComponent(ticket)}`);
      source.addEventListener('ready', () => {
        delay = 1000;
        setStatus(true);
      });
      for (const type of TYPES) {
        source.addEventListener(type, (event) => {
          let data = {};
          try {
            data = JSON.parse(event.data);
          } catch {
            // tukio bila data
          }
          onEvent(type, data);
        });
      }
      source.onerror = () => {
        setStatus(false);
        source?.close();
        source = null;
        retry();
      };
    } catch (err) {
      setStatus(false);
      if (err.status === 401 || err.status === 403) return; // umetoka — app itashughulikia
      retry();
    }
  }

  function retry() {
    if (stopped) return;
    clearTimeout(timer);
    timer = setTimeout(open, delay);
    delay = Math.min(delay * 2, 30_000);
  }

  // Simu ikirudi mtandaoni au app ikifunguliwa tena, unganisha mara moja.
  const wake = () => {
    if (!source && !stopped && document.visibilityState === 'visible') {
      delay = 1000;
      clearTimeout(timer);
      open();
    }
  };
  window.addEventListener('online', wake);
  document.addEventListener('visibilitychange', wake);

  open();
  return {
    close() {
      stopped = true;
      clearTimeout(timer);
      source?.close();
      source = null;
      window.removeEventListener('online', wake);
      document.removeEventListener('visibilitychange', wake);
      setStatus(false);
    },
  };
}
