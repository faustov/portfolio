/* ==========================================================
   Playground — cursor-reactive tile grid (from cursor-grid-demo.html)

   At rest: plain flex rows, each tile's flex-grow = its aspect ratio.
   On hover (desktop only): the row under the cursor grows taller, the
   tile under the cursor grows wider, its content shifts (parallax).
   Total grid height and row widths stay constant, so the page never jumps.
   ========================================================== */

(() => {
  const rowsEl = document.getElementById('pg-rows');
  if (!rowsEl) return;

  /* ---------- Data: swap colors for real images/videos later (src) ---------- */
  // a: 1 = square tile (for square videos). keep: true = never hidden on narrow widths.
  const ROWS = [
    [{ a: 1, c: '#f2f2f4,#f2f2f4', keep: true, v: 'assets/playground/bubble-button', label: 'Bubble' }, { a: 910/512, c: '#000,#000', v: 'assets/playground/stardust-button', label: 'Stardust' },    { a: 910/512, c: '#e6e6e1,#b5b5ae' }],
    [{ a: 910/512, c: '#777,#c9c9c4' },    { a: 410/512, c: '#1d1d1d,#4a4a4a' }, { a: 910/512, c: '#ededea,#c4c4bf' }, { a: 1, c: '#3a3a3a,#8a8a85' }],
    [{ a: 910/512, c: '#f2f2ef,#a9a9a3' }, { a: 410/512, c: '#262626,#6b6b67' }, { a: 1, c: '#d8d8d3,#8f8f8a', keep: true }, { a: 910/512, c: '#151515,#3d3d3d' }],
  ].map(r => r.map(t => ({ ...t, cell: t.a })));   // cell = flex weight = real aspect ratio (w/h), so a: 1 is a true square

  const ROW_RADIUS = 380;   // cursor influence on row height (px) — wider = softer
  const TILE_RADIUS = 520;  // cursor influence on tile width (px)
  const ROW_BOOST = 0.35;   // row under cursor grows up to +35%
  const TILE_BOOST = 0.5;   // tile under cursor grows up to +50% by weight
  const PARALLAX = 1.5;     // content shift inside a tile, %
  const SMOOTH = 0.95;      // remainder per frame at 60fps: closer to 1 = slower
  const SNAP = true;        // target = center of the nearest tile, not the cursor:
                            // while the mouse stays inside one tile, the grid is still

  /* Smooth kernel: 1 at the center, 0 at the radius, no kinks */
  const falloff = d => d >= 1 ? 0 : (1 - d * d) ** 2;

  /* A row may not get shorter than this; otherwise its least important tiles are hidden.
     Scales down on narrow screens so phones still get 2 tiles per row. */
  const minRowH = W => Math.min(140, W * 0.28);

  /* ---------- Rest layout: each row is a justified line (see .pg__row in CSS) ---------- */

  const rowEls = [], tileEls = [];
  let GAP_X = 8, GAP_Y = 8;   // read from CSS (--card-gap) in measure()
  const restStyle = cell => ({
    flex: `${cell} 1 0px`, maxWidth: '', aspectRatio: cell, width: '', height: '',
  });

  ROWS.forEach((row, ri) => {
    const rEl = document.createElement('div');
    rEl.className = 'pg__row';
    row.forEach((t, ti) => {
      const el = document.createElement('div');
      el.className = 'pg__tile';
      Object.assign(el.style, restStyle(t.cell));
      // t.v = video path without extension: <v>.mp4 + <v>.jpg (poster).
      // muted + playsinline so Safari/iOS allow play() without a user gesture.
      const media = t.v
        ? `<video class="pg__media pg__media--video" style="background:${t.c.split(',')[0]}" src="${t.v}.mp4" poster="${t.v}.jpg" muted loop playsinline preload="metadata" disablepictureinpicture></video>`
        : `<div class="pg__media" style="background-image:linear-gradient(135deg,${t.c})"></div>`;
      el.innerHTML = media + `<span class="pg__label">${t.label || `Shot ${ri + 1}.${ti + 1}`}</span>`;
      const video = el.querySelector('video');
      if (video) {
        // Plays while the cursor is over the tile, pauses (keeps the frame) when it leaves
        el.addEventListener('mouseenter', () => { video.play().catch(() => {}); });
        el.addEventListener('mouseleave', () => { video.pause(); });
      }
      rEl.appendChild(el);
      tileEls.push(el);
    });
    rowsEl.appendChild(rEl);
    rowEls.push(rEl);
  });
  const flat = ROWS.flat();
  const rowStart = ROWS.map((_, ri) => ROWS.slice(0, ri).reduce((n, r) => n + r.length, 0));
  // Visible tiles per row (indices inside the row); recalculated in measure()
  let vis = ROWS.map(r => r.map((_, ti) => ti));

  /* ---------- State: target (where we want to be) and cur (smoothed) ---------- */
  const state = { target: { x: 0, y: 0, s: 0 }, cur: { x: 0, y: 0, s: 0 }, active: -1, raf: null, last: 0, snapIdx: -1 };

  /* ---------- Rest geometry: row and tile centers ---------- */
  let geo = null;
  function measure() {
    if (state.cur.s > 0.002) return;          // measure only at rest
    const W = rowsEl.clientWidth;
    const rs = getComputedStyle(rowEls[0]);
    GAP_X = parseFloat(rs.columnGap) || 0;
    GAP_Y = parseFloat(rs.marginBottom) || 0;

    // 1) Decide which tiles fit. A row of visible tiles is (W - gaps) / Σcell tall;
    //    while that is below the minimum, hide a tile: first placeholders (no video,
    //    no `keep`), from the end of the row. A row always keeps at least one tile.
    const minH = minRowH(W);
    vis = ROWS.map(row => {
      const v = row.map((_, ti) => ti);
      const height = () => (W - (v.length - 1) * GAP_X) / v.reduce((s, ti) => s + row[ti].cell, 0);
      while (v.length > 1 && height() < minH) {
        const spare = v.filter(ti => !row[ti].v && !row[ti].keep);
        const drop = spare.length ? spare[spare.length - 1] : v[v.length - 1];
        v.splice(v.indexOf(drop), 1);
      }
      return v;
    });
    ROWS.forEach((row, ri) => row.forEach((_, ti) => {
      tileEls[rowStart[ri] + ti].classList.toggle('pg__tile--hidden', !vis[ri].includes(ti));
    }));

    // 2) Rest geometry of the visible tiles
    const H = rowsEl.offsetHeight;
    const rowH = rowEls.map(r => r.offsetHeight);
    let y = 0; const rowCY = [];
    rowH.forEach(h => { rowCY.push(y + h / 2); y += h + GAP_Y; });
    const innerW = vis.map(v => W - (v.length - 1) * GAP_X);
    const tileCX = vis.map((v, ri) => {
      const sum = v.reduce((s, ti) => s + ROWS[ri][ti].cell, 0);
      let x = 0; const cx = [];
      v.forEach(ti => { const w = innerW[ri] * ROWS[ri][ti].cell / sum; cx[ti] = x + w / 2; x += w + GAP_X; });
      return cx;   // sparse: indexed by tile index inside the row
    });
    geo = { H, rowH, rowCY, tileCX, innerW, hAvail: H - (ROWS.length - 1) * GAP_Y };
  }

  function reset() {
    rowsEl.style.height = '';
    rowEls.forEach(r => { r.style.height = ''; r.style.flexWrap = ''; });
    tileEls.forEach((el, i) => {
      Object.assign(el.style, restStyle(flat[i].cell));
      el.firstElementChild.style.backgroundPosition = '';
      el.firstElementChild.style.objectPosition = '';
    });
  }

  function frame(dt) {
    const { target: T, cur: C } = state;
    // exponential smoothing, FPS-independent
    const k = 1 - Math.pow(SMOOTH, dt / (1000 / 60));
    C.x += (T.x - C.x) * k; C.y += (T.y - C.y) * k; C.s += (T.s - C.s) * k;

    if (C.s < 0.002 && T.s === 0) { C.s = 0; reset(); setActive(-1); return; }

    // 1) Row heights: the row under the cursor grows, sum normalized to a fixed height
    const want = ROWS.map((_, ri) => geo.rowH[ri] * (1 + ROW_BOOST * C.s * falloff(Math.abs(C.y - geo.rowCY[ri]) / ROW_RADIUS)));
    const wantSum = want.reduce((a, b) => a + b, 0);
    rowsEl.style.height = geo.H + 'px';   // total height never jumps

    let best = -1, bestD = Infinity;
    ROWS.forEach((row, ri) => {
      const idx = rowStart[ri], v = vis[ri];
      const h = geo.hAvail * want[ri] / wantSum;
      rowEls[ri].style.height = h + 'px';
      rowEls[ri].style.flexWrap = 'nowrap';

      // 2) Tile widths: weight grows towards the cursor, sum normalized to row width
      const ws = v.map(ti => {
        const t = row[ti];
        const d = Math.hypot(C.x - geo.tileCX[ri][ti], C.y - geo.rowCY[ri]);
        if (d < bestD) { bestD = d; best = idx + ti; }
        return t.cell * (1 + TILE_BOOST * C.s * falloff(d / TILE_RADIUS));
      });
      const wsSum = ws.reduce((a, b) => a + b, 0);

      v.forEach((ti, vi) => {
        const t = row[ti], el = tileEls[idx + ti];
        Object.assign(el.style, {
          flex: '0 0 auto', maxWidth: 'none', aspectRatio: 'auto',
          width: geo.innerW[ri] * ws[vi] / wsSum + 'px', height: h + 'px',
        });
        // 3) Content parallax: shift away from the cursor
        const dx = C.x - geo.tileCX[ri][ti], dy = C.y - geo.rowCY[ri];
        const amt = PARALLAX * C.s * falloff(Math.hypot(dx, dy) / TILE_RADIUS);
        const pos = `${50 - dx / TILE_RADIUS * amt * 10}% ${50 - dy / TILE_RADIUS * amt * 10}%`;
        if (t.v) el.firstElementChild.style.objectPosition = pos;
        else el.firstElementChild.style.backgroundPosition = pos;
      });
    });

    // 4) Nearest tile = active one (later: only it plays its video)
    if (C.s > 0.5) setActive(best);
  }

  function setActive(i) {
    if (i === state.active) return;
    state.active = i;
    // later: play() the active tile's video, pause() the others
  }

  function loop(t) {
    const dt = Math.min(t - state.last, 64);
    state.last = t;
    frame(dt);
    state.raf = (state.cur.s > 0 || state.target.s > 0) ? requestAnimationFrame(loop) : null;
  }
  function kick() {
    if (state.raf === null) { state.last = performance.now(); state.raf = requestAnimationFrame(loop); }
  }

  /* ---------- Desktop with a mouse only, and not with reduced motion ---------- */
  const enabled = () =>
    matchMedia('(hover: hover) and (pointer: fine)').matches &&
    !matchMedia('(prefers-reduced-motion: reduce)').matches &&
    !matchMedia('(max-width: 1023px)').matches;

  rowsEl.addEventListener('mousemove', e => {
    if (!enabled() || !geo) return;
    const r = rowsEl.getBoundingClientRect();
    let x = e.clientX - r.left, y = e.clientY - r.top;
    if (SNAP) {
      // Nearest tile by rest geometry. The current tile gets a 15% head start
      // (hysteresis) so it doesn't flicker on the border between two tiles.
      let bestT = null, bestD = Infinity;
      vis.forEach((v, ri) => v.forEach(ti => {
        const i = rowStart[ri] + ti;
        let d = Math.hypot(x - geo.tileCX[ri][ti], y - geo.rowCY[ri]);
        if (i === state.snapIdx) d *= 0.85;
        if (d < bestD) { bestD = d; bestT = { i, x: geo.tileCX[ri][ti], y: geo.rowCY[ri] }; }
      }));
      state.snapIdx = bestT.i; x = bestT.x; y = bestT.y;
    }
    state.target = { x, y, s: 1 };
    if (state.cur.s === 0) { state.cur.x = x; state.cur.y = y; } // no "fly-in" from the corner
    kick();
  });

  rowsEl.addEventListener('mouseleave', () => {
    state.snapIdx = -1;
    state.target = { ...state.target, s: 0 };
    kick();
  });

  let rt, lastW = 0;
  new ResizeObserver(() => {
    if (rowsEl.clientWidth === lastW) return;
    lastW = rowsEl.clientWidth;
    clearTimeout(rt);
    rt = setTimeout(measure, 260);
  }).observe(rowsEl);
  measure();
})();
