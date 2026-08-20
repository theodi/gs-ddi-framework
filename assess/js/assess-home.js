import { mountAssessHeader } from './app-header.js';

const $ = (id) => document.getElementById(id);

function scrollToHowItWorks(e) {
  const target = $('how-it-works');
  if (!target) return;
  e.preventDefault();
  target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  target.focus({ preventScroll: true });
}

async function init() {
  await mountAssessHeader();
  $('btn-see-demo')?.addEventListener('click', scrollToHowItWorks);
}

init();
