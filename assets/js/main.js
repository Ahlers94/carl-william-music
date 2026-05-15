(function () {
  'use strict';

  const cursorGlow = document.getElementById('cursor-glow');
  if (cursorGlow) {
    document.addEventListener('mousemove', function (e) {
      cursorGlow.style.left = e.clientX + 'px';
      cursorGlow.style.top = e.clientY + 'px';
    });
  }

  const taglineWords = document.querySelectorAll('.tagline-word');
  if (taglineWords.length) {
    function randomFlicker() {
      const word = taglineWords[Math.floor(Math.random() * taglineWords.length)];
      word.classList.add('flickering');
      word.addEventListener('animationend', function () {
        word.classList.remove('flickering');
      }, { once: true });
      setTimeout(randomFlicker, 8000 + Math.random() * 2000);
    }
    setTimeout(randomFlicker, 4000);
  }

  function pauseAllVideos() {
    document.querySelectorAll('iframe').forEach(function (iframe) {
      try {
        iframe.contentWindow.postMessage(
          JSON.stringify({ event: 'command', func: 'pauseVideo', args: [] }),
          '*'
        );
      } catch (e) { /* cross-origin */ }
    });
  }

  document.addEventListener('click', function (e) {
    const facade = e.target.closest('.yt-facade');
    if (!facade) return;
    const vid = facade.dataset.vid;
    if (!vid) return;
    const iframe = document.createElement('iframe');
    iframe.src = 'https://www.youtube-nocookie.com/embed/' + vid + '?autoplay=1&enablejsapi=1';
    iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture';
    iframe.allowFullscreen = true;
    iframe.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;border:none;';
    facade.replaceWith(iframe);
  });

  document.querySelectorAll('.gear-item').forEach(function (item) {
    item.addEventListener('click', function () {
      item.classList.toggle('open');
    });
  });

  const iconMap = {
    youtube: '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 17a24.12 24.12 0 0 1 0-10 2 2 0 0 1 1.4-1.4 49.56 49.56 0 0 1 16.2 0A2 2 0 0 1 21.5 7a24.12 24.12 0 0 1 0 10 2 2 0 0 1-1.4 1.4 49.55 49.55 0 0 1-16.2 0A2 2 0 0 1 2.5 17"/><polygon points="10 15 15 12 10 9"/></svg>',
    instagram: '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="20" x="2" y="2" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" x2="17.51" y1="6.5" y2="6.5"/></svg>',
    radio: '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9"/><path d="M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5"/><circle cx="12" cy="12" r="2"/><path d="M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5"/><path d="M19.1 4.9C23 8.8 23 15.2 19.1 19.1"/></svg>',
    github: '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4"/><path d="M9 18c-4.51 2-5-2-7-2"/></svg>',
    mail: '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>',
    venmo: '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>'
  };

  document.querySelectorAll('[data-icon]').forEach(function (el) {
    const icon = el.getAttribute('data-icon');
    if (icon && iconMap[icon]) {
      el.insertAdjacentHTML('afterbegin', iconMap[icon]);
    }
  });

  const bioEl = document.getElementById('bio-decrypt');
  if (bioEl) {
    (function decryptBio() {
      const target = bioEl.textContent.trim();
      const pool = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
      const segments = Array.from(target);
      const locked = new Array(segments.length).fill(false);
      let resolved = 0;
      let lastTime = 0;
      const msPerChar = 55;

      function isSpecial(ch) {
        return ch.trim() === '' || /[^\x00-\x7F]/.test(ch);
      }
      function randChar() {
        return pool[Math.floor(Math.random() * pool.length)];
      }
      function render() {
        return segments.map(function (ch, i) {
          return (locked[i] || isSpecial(ch)) ? ch : randChar();
        }).join('');
      }
      function tick(timestamp) {
        if (resolved >= segments.length) {
          bioEl.textContent = target;
          return;
        }
        if (timestamp - lastTime >= msPerChar) {
          for (let i = 0; i < segments.length; i++) {
            if (!locked[i]) {
              locked[i] = true;
              resolved++;
              break;
            }
          }
          lastTime = timestamp;
        }
        bioEl.textContent = render();
        requestAnimationFrame(tick);
      }
      setTimeout(function () {
        requestAnimationFrame(tick);
      }, 600);
    })();
  }

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') {
      pauseAllVideos();
    }
  });
})();
