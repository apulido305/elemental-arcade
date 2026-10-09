// Layout checks a teacher would notice on a phone: sideways scroll, tiny tap targets, text spilling out of its box.
// Covers the VS overlay when it is open, otherwise the main app (#app).

/** Returns a list of problems (empty when the screen is fine). */
export async function layoutProblems(page) {
  return page.evaluate(() => {
    const out = [], vs = document.getElementById('vs');
    const overlay = vs && !vs.hidden;
    const scope = overlay ? vs : document.getElementById('app');
    if (document.documentElement.scrollWidth > innerWidth + 1) out.push('page scrolls sideways: ' + document.documentElement.scrollWidth + ' > ' + innerWidth);
    if (overlay && vs.scrollWidth > vs.clientWidth + 1) out.push('overlay scrolls sideways: ' + vs.scrollWidth + ' > ' + vs.clientWidth);
    const vis = e => { const r = e.getBoundingClientRect(), cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
    scope.querySelectorAll('button, select, input:not([type=checkbox]):not([type=hidden]), label.vs-chk, a[href], summary').forEach(e => {
      if (!vis(e)) return;
      const r = e.getBoundingClientRect();
      if (r.height < 43.5) out.push('tap target ' + Math.round(r.height) + 'px: ' + (e.dataset.vs || e.dataset.act || e.className || e.tagName) + ' "' + (e.textContent || '').trim().slice(0, 20) + '"');
    });
    scope.querySelectorAll('.icell').forEach(e => { const r = e.getBoundingClientRect(); if (vis(e) && (r.width < 43.5 || r.height < 43.5)) out.push('picker cell ' + Math.round(r.width) + 'x' + Math.round(r.height)); });
    scope.querySelectorAll('h1, h2, h3, .vs-plate, .vs-pod .nm, .vs-lobbyrow b, .vs-bigcode, .vs-rankchip, .vs-lrow .nm, .vs-plist li, .playnow b, .room .nm').forEach(e => {
      if (!vis(e)) return;
      const cs = getComputedStyle(e);
      // ellipsis on names is intended; anything else that overflows its box is clipped text
      if (cs.textOverflow === 'ellipsis') return;
      if (e.scrollWidth > e.clientWidth + 2 && cs.overflowX !== 'visible') out.push('clipped text: ' + e.textContent.trim().slice(0, 30));
      const r = e.getBoundingClientRect(); if (r.right > innerWidth + 1 || r.left < -1) out.push('off screen: ' + e.textContent.trim().slice(0, 30));
    });
    return out;
  });
}

/** Computed animation-duration (ms) of every element matching sel. */
export async function animationDurations(page, sel) {
  return page.evaluate(s => [...document.querySelectorAll(s)].map(e => {
    const d = getComputedStyle(e).animationDuration.split(',')[0].trim();
    return d.endsWith('ms') ? parseFloat(d) : parseFloat(d) * 1000;
  }), sel);
}
