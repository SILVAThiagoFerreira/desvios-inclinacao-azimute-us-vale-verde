/* Atualização automática da página.
 *
 * O deploy (.github/workflows/pages.yml) grava o id do build em index.html (meta "build")
 * e em version.json. Esta página compara os dois: se o site publicado tiver outro id,
 * recarrega sozinha com ?build=<id novo>, que força o navegador a buscar o index.html
 * novo (o GitHub Pages guarda cópias por até 10 min).
 *
 * Rodando localmente (meta ainda com __BUILD_ID__) ou sem version.json: nada acontece.
 */
(() => {
  const meta = document.querySelector('meta[name="build"]');
  const atual = meta ? meta.getAttribute('content') : '';
  if (!atual || atual === '__BUILD_ID__') return;

  const INTERVALO_MS = 5 * 60 * 1000; // verifica a cada 5 min
  const PRIMEIRA_MS = 20 * 1000;      // e 20 s depois de abrir
  const TRAVA_MS = 2 * 60 * 1000;     // no máximo um recarregamento a cada 2 min

  async function verificar() {
    try {
      const r = await fetch(new URL('version.json?t=' + Date.now(), location.href), { cache: 'no-store' });
      if (!r.ok) return;
      const { build } = await r.json();
      if (!build || build === atual) return;

      const url = new URL(location.href);
      // já recarregou para esta versão e continua diferente: não entra em loop
      if (url.searchParams.get('build') === build) return;

      let ultimo = 0;
      try { ultimo = Number(sessionStorage.getItem('buildReloadAt') || 0); } catch (e) { /* sem sessionStorage */ }
      if (Date.now() - ultimo < TRAVA_MS) return;
      try { sessionStorage.setItem('buildReloadAt', String(Date.now())); } catch (e) { /* ignora */ }

      url.searchParams.set('build', build);
      location.replace(url.toString());
    } catch (e) {
      /* sem rede: tenta de novo no próximo ciclo */
    }
  }

  setTimeout(verificar, PRIMEIRA_MS);
  setInterval(verificar, INTERVALO_MS);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) verificar(); });
})();
