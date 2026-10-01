(() => {
  'use strict';
  const root = document.querySelector('.stars');
  if (!root || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const frag = document.createDocumentFragment();
  for (let i = 0; i < 110; i++) {
    const star = document.createElement('i');
    star.style.left = `${Math.random() * 100}%`;
    star.style.top = `${Math.random() * 100}%`;
    star.style.setProperty('--size', `${Math.random() * 2 + .5}px`);
    star.style.setProperty('--delay', `${Math.random() * 5}s`);
    star.style.setProperty('--duration', `${Math.random() * 4 + 3}s`);
    frag.appendChild(star);
  }
  root.appendChild(frag);
})();
