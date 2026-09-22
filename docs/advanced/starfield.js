(() => {
  'use strict';
  const body = document.body;
  if (!body || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  let raf = 0;
  let t = 0;
  const tick = () => {
    t += 0.0016;
    document.documentElement.style.setProperty('--mx', `${Math.sin(t) * 12}px`);
    document.documentElement.style.setProperty('--my', `${Math.cos(t * .9) * 9}px`);
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  window.addEventListener('pagehide', () => cancelAnimationFrame(raf), { once: true });
})();
