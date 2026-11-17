/* This script is embedded verbatim in exported documents. No app dependencies. */
(() => {
  'use strict';
  document.documentElement.classList.add('js');
  const article = document.querySelector('article');
  const sections = [...article.querySelectorAll('details.section')];
  const headings = [...article.querySelectorAll('summary > :is(h1,h2,h3,h4,h5,h6)')];
  const links = [...document.querySelectorAll('nav a')];
  const search = document.getElementById('document-search');
  const status = document.getElementById('search-status');
  const previous = document.getElementById('search-prev');
  const next = document.getElementById('search-next');
  let matches = [];
  let current = -1;
  let debounce;
  let anchorTarget = null;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

  function reveal(element) {
    let parent = element.closest('details');
    while (parent) { parent.open = true; parent = parent.parentElement.closest('details'); }
  }
  function scrollTo(element) {
    reveal(element);
    element.scrollIntoView({ block: 'center', behavior: reducedMotion.matches ? 'auto' : 'smooth' });
  }
  function updateActive() {
    let active = headings.find((heading) => heading.getClientRects().length);
    for (const heading of headings) {
      if (heading.getClientRects().length && heading.getBoundingClientRect().top <= 130) active = heading;
    }
    if (anchorTarget?.getClientRects().length) {
      const top = anchorTarget.getBoundingClientRect().top;
      if (top >= 0 && top < innerHeight) active = anchorTarget;
      else anchorTarget = null;
    }
    for (const link of links) {
      if (active && link.getAttribute('href').slice(1) === active.id) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    }
  }
  let scheduled = false;
  addEventListener('scroll', () => {
    if (!scheduled) requestAnimationFrame(() => { scheduled = false; updateActive(); });
    scheduled = true;
  }, { passive: true });
  article.addEventListener('toggle', updateActive, true);
  function followHash() {
    let id;
    try { id = decodeURIComponent(location.hash.slice(1)); } catch { return; }
    const target = document.getElementById(id);
    anchorTarget = headings.includes(target) ? target : null;
    if (target) { reveal(target); target.scrollIntoView({ block: 'start' }); target.focus({ preventScroll: true }); }
    updateActive();
  }
  document.addEventListener('click', (event) => {
    const link = event.target.closest('a[href^="#"]');
    if (!link || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    try { history.pushState(null, '', link.getAttribute('href')); } catch { location.hash = link.hash; }
    followHash();
  });
  addEventListener('hashchange', followHash);
  addEventListener('popstate', followHash);
  requestAnimationFrame(followHash);
  document.getElementById('expand-all').onclick = () => sections.forEach((section) => { section.open = true; });
  document.getElementById('collapse-all').onclick = () => sections.forEach((section) => { section.open = false; });
  document.getElementById('theme-toggle').onclick = (event) => {
    const dark = document.documentElement.dataset.theme !== 'dark';
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    event.currentTarget.textContent = dark ? 'Light mode' : 'Dark mode';
    event.currentTarget.setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme');
  };
  function showMatch(index) {
    if (!matches.length) return;
    matches[current]?.forEach(mark => mark.classList.remove('current'));
    current = (index + matches.length) % matches.length;
    matches[current].forEach(mark => mark.classList.add('current'));
    scrollTo(matches[current][0]);
    status.textContent = `${current + 1} / ${matches.length}`;
  }
  function runSearch() {
    clearTimeout(debounce);
    debounce = undefined;
    for (const mark of matches.flat()) mark.replaceWith(document.createTextNode(mark.textContent));
    article.normalize();
    matches = []; current = -1;
    const query = search.value.trim();
    if (query) {
      const regex = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu');
      const walker = document.createTreeWalker(article, NodeFilter.SHOW_TEXT, {
        acceptNode: (node) => node.parentElement.closest('button,.code-toolbar,.katex,script,style') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
      });
      const blocks = new Map();
      while (walker.nextNode()) {
        const node = walker.currentNode;
        const block = node.parentElement.closest('p,h1,h2,h3,h4,h5,h6,pre,td,th,li') || node.parentElement;
        if (!blocks.has(block)) blocks.set(block, []);
        blocks.get(block).push(node);
      }
      for (const nodes of blocks.values()) {
        const text = nodes.map(node => node.textContent).join('');
        regex.lastIndex = 0;
        const ranges = new Map();
        for (const match of text.matchAll(regex)) {
          const group = []; matches.push(group);
          let offset = 0;
          for (const node of nodes) {
            const end = offset + node.textContent.length;
            if (match.index < end && match.index + match[0].length > offset) {
              if (!ranges.has(node)) ranges.set(node, []);
              ranges.get(node).push({ start: Math.max(0, match.index - offset), end: Math.min(node.textContent.length, match.index + match[0].length - offset), group });
            }
            offset = end;
          }
        }
        for (const [node, parts] of ranges) {
          const fragment = document.createDocumentFragment();
          let offset = 0;
          for (const part of parts) {
            fragment.append(document.createTextNode(node.textContent.slice(offset, part.start)));
            const mark = document.createElement('mark');
            mark.className = 'search-hit'; mark.textContent = node.textContent.slice(part.start, part.end);
            part.group.push(mark); fragment.append(mark); offset = part.end;
          }
          fragment.append(document.createTextNode(node.textContent.slice(offset))); node.replaceWith(fragment);
        }
      }
    }
    previous.disabled = next.disabled = !matches.length;
    status.textContent = query ? 'No matches' : '';
    if (matches.length) showMatch(0);
  }
  search.addEventListener('input', () => { clearTimeout(debounce); debounce = setTimeout(runSearch, 150); });
  search.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); if (debounce) { clearTimeout(debounce); debounce = null; runSearch(); } else showMatch(current + (event.shiftKey ? -1 : 1)); }
    if (event.key === 'Escape') { search.value = ''; runSearch(); }
  });
  previous.onclick = () => showMatch(current - 1);
  next.onclick = () => showMatch(current + 1);
  article.addEventListener('click', async (event) => {
    const button = event.target.closest('.copy-code');
    if (!button) return;
    const code = button.closest('.code-block').querySelector('code');
    let copied = false;
    try { await navigator.clipboard.writeText(code.textContent); copied = true; } catch {
      const area = document.createElement('textarea'); area.value = code.textContent;
      area.style.cssText = 'position:fixed;left:-9999px'; document.body.append(area); area.select();
      try { copied = document.execCommand('copy'); } catch { /* select code below */ }
      area.remove(); button.focus();
    }
    if (!copied) { const range = document.createRange(); range.selectNodeContents(code); getSelection().removeAllRanges(); getSelection().addRange(range); }
    button.textContent = copied ? 'Copied' : 'Code selected';
    document.getElementById('reader-status').textContent = copied ? 'Code copied to clipboard' : 'Code selected. Use your browser copy command.';
    setTimeout(() => { button.textContent = 'Copy code'; }, 1800);
  });
  let closedBeforePrint = [];
  addEventListener('beforeprint', () => { closedBeforePrint = sections.filter((section) => !section.open); sections.forEach((section) => { section.open = true; }); });
  addEventListener('afterprint', () => { closedBeforePrint.forEach((section) => { section.open = false; }); });
  updateActive();
})();
