/* ==========================================================
   Image viewer for case pages.
   Click an image (or a framed mockup) in <main>: it flies from its
   place to the centre of the screen and grows, the page behind is
   blurred like under the header. Close: click outside the image,
   the × under it, or Esc.

   Size of the opened image:
   - narrow screens (< 1024px, phones and tablets): almost the whole
     screen, 16px from the edges;
   - wide screens: up to 80% of the screen width, 48px from the top
     and bottom, and never bigger than the image file itself (so small
     raster images don't get blurry). SVG and mockups have no such cap.
   Below the image, on the right: the close button.

   The opened copy is a clone laid out at the original size and scaled
   with CSS zoom, so mockups (phone frames, iPad, blueprint) keep their
   exact proportions and stay sharp.
   ========================================================== */
(function () {
  var main = document.querySelector('main');
  if (!main) return;

  /* Composite mockups open as a whole; every other image opens by itself */
  var UNITS = '.ex-phone, .wd-ipad, .wd-marked, .wd-sizes, .wd-screen';
  var SKIP = '.cs-head';                       /* case icon in the header */

  var WIDE = 1024, PAD_WIDE = 48, PAD_NARROW = 16, MAX_W_WIDE = 0.8;
  var BTN = 44, GAP = 12;
  var DUR = 450, EASE = 'cubic-bezier(.2, .7, .2, 1)';
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)');

  function targetOf(node) {
    if (!(node instanceof Element) || node.closest(SKIP)) return null;
    var unit = node.closest(UNITS);
    if (unit && main.contains(unit)) return unit;
    var img = node.closest('img');
    return img && main.contains(img) ? img : null;
  }

  main.querySelectorAll(UNITS + ', img').forEach(function (el) {
    if (targetOf(el) !== el) return;
    el.classList.add('zoomable');
    el.tabIndex = 0;
  });

  /* --- Overlay ---------------------------------------------------------- */

  var lb = document.createElement('div');
  lb.className = 'lb';
  lb.hidden = true;
  lb.setAttribute('role', 'dialog');
  lb.setAttribute('aria-modal', 'true');
  lb.setAttribute('aria-label', 'Image viewer');
  lb.innerHTML =
    '<div class="lb__backdrop"></div>' +
    '<div class="lb__stage"></div>' +
    '<button class="lb__close" type="button" aria-label="Close">' +
      '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 3.5l9 9M12.5 3.5l-9 9" ' +
      'fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>' +
    '</button>';
  document.body.appendChild(lb);
  var backdrop = lb.querySelector('.lb__backdrop');
  var stage = lb.querySelector('.lb__stage');
  var closeBtn = lb.querySelector('.lb__close');

  var cur = null;      /* { el, clone, f } while open */
  var busy = false;

  /* Largest width the file can be shown at without upscaling (CSS px) */
  function naturalCap(el) {
    if (el.tagName !== 'IMG' || /\.svg(\?|#|$)/i.test(el.currentSrc || el.src)) return Infinity;
    return el.naturalWidth || Infinity;
  }

  /* Where the opened image goes for an original of rect r */
  function frame(r, cap) {
    var vw = document.documentElement.clientWidth;
    var vh = window.innerHeight;
    var wide = vw >= WIDE;
    var pad = wide ? PAD_WIDE : PAD_NARROW;
    var maxW = wide ? vw * MAX_W_WIDE : vw - pad * 2;
    var maxH = vh - pad * 2 - GAP - BTN;
    var k = Math.min(maxW / r.width, maxH / r.height);
    if (wide) k = Math.min(k, Math.max(1, cap / r.width));
    var w = r.width * k, h = r.height * k;
    return { k: k, w: w, h: h, left: (vw - w) / 2, top: Math.max(pad, (vh - h - GAP - BTN) / 2) };
  }

  function flyFrom(r, f) {
    return 'translate(' + (r.left - f.left) + 'px,' + (r.top - f.top) + 'px) scale(' + (r.width / f.w) + ')';
  }

  /* Copy of el that looks the same outside its page context */
  var COPY = ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
    'borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomRightRadius', 'borderBottomLeftRadius',
    'boxShadow', 'backgroundColor', 'backgroundImage', 'objectFit'];

  function makeClone(el) {
    var c = el.cloneNode(true);
    var cs = getComputedStyle(el);
    COPY.forEach(function (p) { c.style[p] = cs[p]; });
    /* Images inside a mockup get their size from page rules like
       ".cs-figure img { width: 100% }", lost outside the figure: pin them. */
    var from = el.querySelectorAll('img'), to = c.querySelectorAll('img');
    for (var i = 0; i < from.length; i++) {
      var ics = getComputedStyle(from[i]);
      COPY.forEach(function (p) { to[i].style[p] = ics[p]; });
      to[i].style.width = ics.width;
      to[i].style.height = ics.height;
      to[i].style.maxWidth = 'none';
      to[i].removeAttribute('loading');
    }
    c.classList.remove('zoomable');
    c.removeAttribute('tabindex');
    c.removeAttribute('loading');
    c.style.margin = '0';
    c.style.maxWidth = 'none';
    c.style.boxSizing = 'border-box';
    c.style.visibility = 'visible';
    return c;
  }

  function place(r, f) {
    cur.clone.style.width = r.width + 'px';
    cur.clone.style.height = r.height + 'px';
    cur.clone.style.zoom = f.k;
    stage.style.left = f.left + 'px';
    stage.style.top = f.top + 'px';
    stage.style.width = f.w + 'px';
    stage.style.height = f.h + 'px';
    closeBtn.style.left = (f.left + f.w - BTN) + 'px';
    closeBtn.style.top = (f.top + f.h + GAP) + 'px';
  }

  function open(el) {
    if (cur || busy) return;
    var r = el.getBoundingClientRect();
    if (!r.width || !r.height) return;
    var f = frame(r, naturalCap(el));
    cur = { el: el, clone: makeClone(el), f: f };
    stage.appendChild(cur.clone);
    place(r, f);

    document.documentElement.classList.add('lb-lock');
    lb.hidden = false;
    el.style.visibility = 'hidden';

    var anim = !reduce.matches;
    stage.style.transition = 'none';
    stage.style.transform = anim ? flyFrom(r, f) : 'none';
    stage.style.opacity = anim ? '1' : '0';
    stage.offsetWidth;                         /* commit the start state */
    stage.style.transition = 'transform ' + DUR + 'ms ' + EASE + ', opacity ' + DUR + 'ms ' + EASE;
    stage.style.transform = 'none';
    stage.style.opacity = '1';
    lb.classList.add('is-open');
    closeBtn.focus({ preventScroll: true });
  }

  function close() {
    if (!cur || busy) return;
    busy = true;
    var el = cur.el;
    var r = el.getBoundingClientRect();
    lb.classList.remove('is-open');
    lb.classList.add('is-closing');          /* fly back under the header blur */
    if (reduce.matches) stage.style.opacity = '0';
    else stage.style.transform = flyFrom(r, cur.f);

    setTimeout(function () {
      el.style.visibility = '';
      lb.hidden = true;
      lb.classList.remove('is-closing');
      stage.textContent = '';
      stage.style.transition = 'none';
      stage.style.transform = '';
      document.documentElement.classList.remove('lb-lock');
      el.focus({ preventScroll: true });
      cur = null;
      busy = false;
    }, DUR);
  }

  /* --- Events ----------------------------------------------------------- */

  main.addEventListener('click', function (e) {
    var el = targetOf(e.target);
    if (!el || e.target.closest('a')) return;
    e.preventDefault();
    open(el);
  });
  main.addEventListener('keydown', function (e) {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.classList && e.target.classList.contains('zoomable')) {
      e.preventDefault();
      open(e.target);
    }
  });

  backdrop.addEventListener('click', close);
  closeBtn.addEventListener('click', close);
  document.addEventListener('keydown', function (e) {
    if (!cur) return;
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'Tab') { e.preventDefault(); closeBtn.focus(); }   /* only one control */
  });

  /* No page scroll under the viewer (overflow lock misses iOS rubber-band) */
  lb.addEventListener('wheel', function (e) { e.preventDefault(); }, { passive: false });
  lb.addEventListener('touchmove', function (e) { e.preventDefault(); }, { passive: false });

  window.addEventListener('resize', function () {
    if (!cur || busy) return;
    cur.el.style.visibility = 'hidden';
    var r = cur.el.getBoundingClientRect();
    cur.f = frame(r, naturalCap(cur.el));
    stage.style.transition = 'none';
    place(r, cur.f);
  });
})();
