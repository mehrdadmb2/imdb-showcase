(() => {
'use strict';
const root=document.documentElement;const bg=document.querySelector('.space-bg');
if(!bg||matchMedia('(prefers-reduced-motion: reduce)').matches)return;
let tx=0,ty=0,cx=0,cy=0,raf=0;
addEventListener('pointermove',e=>{tx=(e.clientX/innerWidth-.5)*10;ty=(e.clientY/innerHeight-.5)*8;if(!raf)raf=requestAnimationFrame(()=>{cx+=(tx-cx)*.08;cy+=(ty-cy)*.08;root.style.setProperty('--mx',`${cx}px`);root.style.setProperty('--my',`${cy}px`);raf=0})},{passive:true});
const nebula=[...document.querySelectorAll('.nebula')];let t=0;function loop(){t+=.003;nebula.forEach((n,i)=>{const x=Math.sin(t*(i+1)*.8)*10,y=Math.cos(t*(i+1))*8;n.style.transform=`translate3d(calc(var(--mx,0px) * ${(i+1)/3}),calc(var(--my,0px) * ${(i+1)/3}),0) translate(${x}px,${y}px)`});requestAnimationFrame(loop)}loop();
})();
