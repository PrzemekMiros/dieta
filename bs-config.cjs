module.exports = {
  proxy: { target: 'http://127.0.0.1:4321', ws: true },
  port: 3000,
  ui: { port: 3001 },
  open: false,
  notify: false,
  online: false,
  ghostMode: { clicks: true, scroll: true, forms: false },
  // Astro/Vite obsługuje HMR. Drugi watcher powodowałby podwójne odświeżenia.
  files: [],
};
