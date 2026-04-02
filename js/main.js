(function () {
  'use strict';

  // --- Scroll Reveal via IntersectionObserver ---
  var reveals = document.querySelectorAll('[data-reveal]');

  if ('IntersectionObserver' in window && reveals.length) {
    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.08, rootMargin: '0px 0px -40px 0px' }
    );

    reveals.forEach(function (el) {
      observer.observe(el);
    });
  } else {
    // Graceful fallback: show everything immediately
    reveals.forEach(function (el) {
      el.classList.add('is-visible');
    });
  }

  // --- Navigation scroll state ---
  var nav = document.getElementById('nav');

  if (nav) {
    var handleScroll = function () {
      if (window.scrollY > 60) {
        nav.classList.add('is-scrolled');
      } else {
        nav.classList.remove('is-scrolled');
      }
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll();
  }

  // --- Mobile nav: close on link click ---
  var toggle = document.getElementById('nav-toggle');
  var links = document.querySelectorAll('.nav__links a');

  if (toggle && links.length) {
    links.forEach(function (link) {
      link.addEventListener('click', function () {
        toggle.checked = false;
      });
    });
  }
})();
