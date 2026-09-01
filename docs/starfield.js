// docs/starfield.js - تولید آسمان پرستاره
(function() {
    const starfield = document.getElementById('starfield');
    if (!starfield) return;

    const starCount = 500;

    for (let i = 0; i < starCount; i++) {
        const star = document.createElement('div');
        star.className = 'star';
        
        const size = Math.random() * 2.5 + 0.5;
        star.style.width = size + 'px';
        star.style.height = size + 'px';
        
        star.style.left = Math.random() * 100 + '%';
        star.style.top = Math.random() * 100 + '%';
        
        const duration = (Math.random() * 4 + 2).toFixed(2);
        const delay = (Math.random() * 6).toFixed(2);
        star.style.setProperty('--duration', duration + 's');
        star.style.animationDelay = delay + 's';
        
        star.style.opacity = Math.random() * 0.8 + 0.2;
        
        starfield.appendChild(star);
    }
})();
