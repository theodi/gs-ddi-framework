import { marked } from './vendor/marked.esm.js';
import DOMPurify from './vendor/purify.es.mjs';

marked.setOptions({
  gfm: true,
  breaks: true,
});

export function renderMarkdown(md) {
  const raw = marked.parse(String(md || ''), { async: false });
  return DOMPurify.sanitize(raw, {
    USE_PROFILES: { html: true },
  });
}
