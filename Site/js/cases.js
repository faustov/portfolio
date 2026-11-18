/* Case rows: arrows for rows with more than two cards.
   CSS shows two cards at a time; the arrows scroll by one card. */
(function () {
  /* Animated covers: SVGs marked data-inline are swapped for the SVG itself,
     so the page CSS can run their motion while the card is hovered
     (see "Animated case covers" in style.css). The <img> stays as the
     fallback if the fetch fails. */
  document.querySelectorAll('img.case__img[data-inline]').forEach(function (img) {
    fetch(img.src)
      .then(function (res) { return res.ok ? res.text() : Promise.reject(); })
      .then(function (text) {
        var svg = new DOMParser().parseFromString(text, 'image/svg+xml').documentElement;
        if (svg.nodeName !== 'svg') return;
        svg.classList.add('case__img');
        svg.setAttribute('role', 'img');
        svg.setAttribute('aria-label', img.alt);
        img.replaceWith(document.importNode(svg, true));
      })
      .catch(function () {});
  });

  /* Empty cards get one of three grey phone-skeleton placeholders.
     Random start, then in turn, so neighbouring cards differ. */
  var n = Math.floor(Math.random() * 3);
  document.querySelectorAll('.case__img.ph').forEach(function (ph) {
    var img = document.createElement('img');
    img.className = 'case__img';
    img.src = 'assets/placeholders/case-' + (n++ % 3 + 1) + '.svg';
    img.width = 800;
    img.height = 600;
    img.alt = '';
    ph.replaceWith(img);
  });

  document.querySelectorAll('.job__cases').forEach(function (track) {
    if (track.children.length <= 2) return;

    var nav = document.createElement('div');
    nav.className = 'cases-nav';
    nav.innerHTML =
      '<button class="cases-nav__btn cases-nav__btn--prev" type="button" aria-label="Previous cases">←</button>' +
      '<button class="cases-nav__btn cases-nav__btn--next" type="button" aria-label="Next cases">→</button>';
    track.after(nav);

    var prev = nav.firstChild, next = nav.lastChild;

    function step() {
      var gap = parseFloat(getComputedStyle(track).columnGap) || 0;
      return track.children[0].getBoundingClientRect().width + gap;
    }
    function update() {
      var max = track.scrollWidth - track.clientWidth;
      prev.hidden = track.scrollLeft <= 1;
      next.hidden = track.scrollLeft >= max - 1;
    }

    prev.addEventListener('click', function () { track.scrollBy({ left: -step() }); });
    next.addEventListener('click', function () { track.scrollBy({ left: step() }); });
    track.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    update();
  });
})();
