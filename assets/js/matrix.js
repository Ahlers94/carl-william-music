(function () {
  'use strict';

  const matrixEl = document.getElementById('matrix-section');
  const matrixMsg = document.getElementById('matrix-msg');
  const matrixHint = document.getElementById('matrix-hint');
  if (!matrixEl || !matrixMsg || !matrixHint) return;

  const homeUrl = document.body.getAttribute('data-home-url') || '/';

  let matrixRunning = false;
  let animFrame;

  function exitMatrix() {
    if (!matrixEl.classList.contains('active')) return;
    matrixRunning = false;
    if (animFrame) cancelAnimationFrame(animFrame);
    window.location.href = homeUrl;
  }

  matrixEl.addEventListener('click', exitMatrix);
  document.addEventListener('keydown', exitMatrix);

  function startMatrix() {
    matrixRunning = true;
    const canvas = document.getElementById('matrix-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const chars = 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const fontSize = 16;
    let cols;
    let drops;

    function resize() {
      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
      cols = Math.floor(canvas.width / fontSize);
      drops = Array(cols).fill(1);
    }
    resize();
    window.addEventListener('resize', resize);

    function draw() {
      if (!matrixRunning) return;
      ctx.fillStyle = 'rgba(0, 0, 0, 0.05)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.font = fontSize + 'px VT323, monospace';
      drops.forEach(function (y, i) {
        ctx.fillStyle = Math.random() > 0.95 ? '#ccffcc' : '#00ff41';
        ctx.fillText(chars[Math.floor(Math.random() * chars.length)], i * fontSize, y * fontSize);
        if (y * fontSize > canvas.height && Math.random() > 0.975) drops[i] = 0;
        drops[i]++;
      });
      animFrame = requestAnimationFrame(draw);
    }
    draw();
  }

  matrixEl.classList.add('active');
  startMatrix();
  setTimeout(function () {
    matrixMsg.classList.add('show');
    matrixHint.classList.add('show');
  }, 1800);
})();
