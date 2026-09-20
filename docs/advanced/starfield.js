(() => {
  'use strict';

  const root = document.querySelector('.scene');
  if (!root || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const nodes = {
    a: root.querySelector('.nebula-a'),
    b: root.querySelector('.nebula-b'),
    c: root.querySelector('.nebula-c'),
    aa: root.querySelector('.aurora-a'),
    ab: root.querySelector('.aurora-b')
  };

  let raf = 0;
  let t = 0;

  const tick = () => {
    t += 0.0016;

    if (nodes.a) nodes.a.style.transform = `translate3d(${Math.sin(t * 1.1) * 22}px, ${Math.cos(t) * 13}px, 0) scale(1.02)`;
    if (nodes.b) nodes.b.style.transform = `translate3d(${Math.cos(t * .82) * 18}px, ${Math.sin(t * 1.18) * 20}px, 0) scale(1.03)`;
    if (nodes.c) nodes.c.style.transform = `translate3d(${Math.sin(t * .68) * 14}px, ${Math.cos(t * 1.24) * 12}px, 0) scale(1.02)`;
    if (nodes.aa) nodes.aa.style.transform = `translate3d(${Math.sin(t * .55) * 28}px, ${Math.cos(t * .72) * 7}px, 0) rotate(${Math.sin(t * .18) * 1.8}deg)`;
    if (nodes.ab) nodes.ab.style.transform = `translate3d(${Math.cos(t * .45) * 22}px, ${Math.sin(t * .64) * 9}px, 0) rotate(${Math.cos(t * .22) * -1.4}deg)`;

    raf = requestAnimationFrame(tick);
  };

  raf = requestAnimationFrame(tick);
  window.addEventListener('pagehide', () => cancelAnimationFrame(raf), { once: true });
})();
