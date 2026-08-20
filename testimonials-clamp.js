/*
 * Clamps long testimonial quotes to a few lines and reveals a "read more"
 * toggle only on the cards that actually overflow.
 *
 * Progressive enhancement: the clamp class is added here, never in the markup,
 * so with JS disabled every quote renders in full. The button labels live in
 * the HTML (data-t) and are swapped by CSS on aria-expanded, so they stay
 * translatable by static-i18n without any strings in this file.
 */
(function () {
  var cards = document.querySelectorAll('.testimonial-card');
  if (!cards.length) return;

  // Tolerance in px: sub-pixel line heights make scrollHeight and clientHeight
  // differ by a hair on quotes that fit perfectly.
  var OVERFLOW_TOLERANCE = 4;

  var items = [];

  Array.prototype.forEach.call(cards, function (card) {
    var quote = card.querySelector('.testimonial-quote p');
    var button = card.querySelector('.testimonial-readmore');
    if (!quote || !button) return;

    items.push({ quote: quote, button: button });

    button.addEventListener('click', function () {
      var clamped = quote.classList.toggle('is-clamped');
      button.setAttribute('aria-expanded', String(!clamped));
    });
  });

  function refresh() {
    items.forEach(function (item) {
      // Leave a quote the reader expanded alone.
      if (item.button.getAttribute('aria-expanded') === 'true') return;

      item.quote.classList.add('is-clamped');
      var overflows =
        item.quote.scrollHeight - item.quote.clientHeight > OVERFLOW_TOLERANCE;

      if (overflows) {
        item.button.hidden = false;
      } else {
        // Short quote: no clamp, no button.
        item.quote.classList.remove('is-clamped');
        item.button.hidden = true;
      }
    });
  }

  refresh();

  // Card width changes with the viewport, and so does what overflows.
  var resizeTimer = null;
  window.addEventListener('resize', function () {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(refresh, 150);
  });
})();
