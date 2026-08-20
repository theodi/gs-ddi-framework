function hashTargetId() {
  return (window.location.hash || '').replace(/^#/, '').split('&')[0];
}

export function scrollPageToTop() {
  window.scrollTo(0, 0);
  document.documentElement.scrollTop = 0;
  document.body.scrollTop = 0;
  document.querySelector('.assess-main-pane')?.scrollTo(0, 0);
  document.querySelector('.assess-wizard-scroll')?.scrollTo(0, 0);
}

function shouldKeepHashScroll() {
  const id = hashTargetId();
  if (!id || id === 'start') return false;
  return Boolean(document.getElementById(id));
}

function sameDocumentHref(href) {
  let url;
  try {
    url = new URL(href, window.location.href);
  } catch {
    return false;
  }
  if (url.origin !== window.location.origin) return false;
  if (url.search !== window.location.search) return false;
  if (url.hash) return false;
  const norm = (p) => p.replace(/\/index\.html$/i, '/').replace(/\/$/, '') || '/';
  return norm(url.pathname) === norm(window.location.pathname);
}

export function installScrollOnNavigate() {
  if (window.__ddiAiScrollNavInstalled) return;
  window.__ddiAiScrollNavInstalled = true;
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';

  const reset = () => {
    if (shouldKeepHashScroll()) return;
    scrollPageToTop();
  };

  window.addEventListener('pageshow', reset);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', reset);
  } else {
    reset();
  }

  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href]');
    if (!a || e.defaultPrevented || e.button !== 0) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (a.hasAttribute('download') || (a.target && a.target !== '_self')) return;
    if (!sameDocumentHref(a.getAttribute('href'))) return;
    e.preventDefault();
    scrollPageToTop();
  });
}
