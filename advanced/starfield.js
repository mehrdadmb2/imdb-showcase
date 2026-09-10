(() => {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const a=document.querySelector('.n1'),b=document.querySelector('.n2'),c=document.querySelector('.n3');let t=0,id;
  const tick=()=>{t+=0.002;if(a)a.style.transform=`translate3d(${Math.sin(t)*22}px,${Math.cos(t*.8)*12}px,0)`;if(b)b.style.transform=`translate3d(${Math.cos(t)*16}px,${Math.sin(t*.7)*18}px,0)`;if(c)c.style.transform=`translate3d(${Math.sin(t*1.2)*13}px,${Math.cos(t)*11}px,0)`;id=requestAnimationFrame(tick)};id=requestAnimationFrame(tick);addEventListener('pagehide',()=>cancelAnimationFrame(id),{once:true});
})();
