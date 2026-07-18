/* BFS web crawler — runs in the browser via CORS proxies.
   Uses a chain of 3 different proxies with automatic fallback. */

const PROXIES = [
  (u) => `https://corsproxy.io/?${encodeURIComponent(u)}`,
  (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
  (u) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,
];

async function proxyFetch(url, timeoutMs = 12_000) {
  for (const makeUrl of PROXIES) {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(makeUrl(url), { signal: controller.signal });
      clearTimeout(tid);
      if (res.ok) return res;
    } catch {
      clearTimeout(tid);
      /* try next proxy */
    }
  }
  return null; // all proxies exhausted
}

function resolveLinks(html, pageUrl) {
  const parser = new DOMParser();
  const doc    = parser.parseFromString(html, 'text/html');
  const origin = new URL(pageUrl).origin;

  const pdfs     = new Set();
  const internal = new Set();

  doc.querySelectorAll('a[href]').forEach((a) => {
    const raw = a.getAttribute('href');
    if (!raw || raw.startsWith('#') || raw.startsWith('mailto:') || raw.startsWith('tel:') || raw.startsWith('javascript:')) return;
    try {
      const resolved = new URL(raw, pageUrl).href.split('#')[0];
      if (/\.pdf(\?.*)?$/i.test(resolved)) {
        pdfs.add(resolved);
      } else if (new URL(resolved).origin === origin) {
        internal.add(resolved);
      }
    } catch {}
  });

  return { pdfs: [...pdfs], internal: [...internal] };
}

/**
 * Crawl a site starting from rootUrl.
 * @param {string} rootUrl
 * @param {{ maxPages?: number, onProgress?: Function }} opts
 * @returns {{ pagesScanned: number, pdfs: string[] }}
 */
export async function crawlSite(rootUrl, { maxPages = 40, onProgress } = {}) {
  const visited = new Set();
  const queue   = [rootUrl];
  const allPdfs = new Set();

  while (queue.length > 0 && visited.size < maxPages) {
    const url = queue.shift();
    if (visited.has(url)) continue;
    visited.add(url);

    const res = await proxyFetch(url);
    if (!res) continue;

    const html = await res.text().catch(() => null);
    if (!html) continue;

    const { pdfs, internal } = resolveLinks(html, url);
    pdfs.forEach((p) => allPdfs.add(p));
    internal.forEach((u) => { if (!visited.has(u) && queue.length < 300) queue.push(u); });

    onProgress?.({ pagesScanned: visited.size, pdfsFound: allPdfs.size, currentUrl: url });
  }

  return { pagesScanned: visited.size, pdfs: [...allPdfs] };
}
