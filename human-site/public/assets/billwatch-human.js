/* Progressive enhancement: every sort link works without JavaScript. */
for (const table of document.querySelectorAll('[data-sort-table]')) {
  for (const link of table.querySelectorAll('[data-sort]')) {
    link.addEventListener('click', event => {
      if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0) return;
      event.preventDefault();
      const key = link.dataset.sort;
      const header = link.closest('th');
      const direction = header.getAttribute('aria-sort') === 'ascending' ? 'desc' : 'asc';
      const rows = [...table.tBodies[0].rows];
      rows.sort((a, b) => {
        const comparison = key === 'price' ? Number(a.dataset.price) - Number(b.dataset.price) : a.dataset[key].localeCompare(b.dataset[key], 'en');
        return (direction === 'desc' ? -1 : 1) * comparison;
      });
      table.tBodies[0].append(...rows);
      for (const th of table.querySelectorAll('thead th')) th.removeAttribute('aria-sort');
      header.setAttribute('aria-sort', direction === 'asc' ? 'ascending' : 'descending');
      for (const sortLink of table.querySelectorAll('[data-sort]')) sortLink.href = `?sort=${sortLink.dataset.sort}&direction=${sortLink === link && direction === 'asc' ? 'desc' : 'asc'}`;
      const current = new URL(location.href);
      current.searchParams.set('sort', key); current.searchParams.set('direction', direction);
      // Replace instead of creating a history entry for every presentation change.
      history.replaceState(null, '', current.pathname + current.search);
      const status = table.closest('.table-scroll').nextElementSibling;
      if (status?.matches('[data-sort-status]')) status.textContent = `Sorted by ${link.textContent.replace('↕', '').trim()}, ${direction === 'asc' ? 'ascending' : 'descending'}.`;
    });
  }
}
