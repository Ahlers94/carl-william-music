(function () {
  'use strict';

  // ── AUDIO PIPELINE ──────────────────────────────────────────
  const bgm = new Audio('/assets/audio/frettris-theme.mp3');
  bgm.loop   = true;
  bgm.volume = 0.4;

  let isMuted = false;

  function initAudio() {
    const muteBtn = document.getElementById('frettris-mute-btn');
    if (!muteBtn) return;

    muteBtn.addEventListener('click', (e) => {
      e.preventDefault();
      isMuted = !isMuted;
      bgm.muted = isMuted;

      muteBtn.classList.toggle('is-muted', isMuted);

      // If they unmute while game is live, resume playback
      if (!isMuted && !isPaused && !gameOver && bgm.paused) {
        bgm.play().catch(err => console.log('Audio unblock:', err));
      }
    });
  }
  // ────────────────────────────────────────────────────────────

  // ── CORE ENVIRONMENT CONFIGURATION ─────────────────────────
  const COLS = 10;
  const ROWS = 20;
  let BLOCK_SIZE = 24;

  const CANVAS      = document.getElementById('frettris-canvas');
  const CTX         = CANVAS ? CANVAS.getContext('2d') : null;
  const NEXT_CANVAS = document.getElementById('next-canvas');
  const NEXT_CTX    = NEXT_CANVAS ? NEXT_CANVAS.getContext('2d') : null;

  const COLORS = [
    null,
    '#ff2d78',
    '#00f5ff',
    '#ffd700',
    '#99cc77',
    '#b06aff',
    '#ff7700',
    '#008a44'
  ];

  const PIECES = [
    [],
    [[1,1,0],[0,1,1],[0,0,0]],
    [[0,0,0,0],[2,2,2,2],[0,0,0,0],[0,0,0,0]],
    [[3,3],[3,3]],
    [[0,4,4],[4,4,0],[0,0,0]],
    [[0,5,0],[5,5,5],[0,0,0]],
    [[0,0,6],[6,6,6],[0,0,0]],
    [[7,0,0],[7,7,7],[0,0,0]]
  ];

  // ── ENGINE STATE ────────────────────────────────────────────
  let grid        = createGrid();
  let score       = 0;
  let lines       = 0;
  let level       = 1;
  let hiScore     = 0;

  let activePiece  = null;
  let nextPiece    = null;
  let gameOver     = false;
  let isPaused     = false;
  let gameInterval = null;
  let dropCounter  = 0;
  let lastTime     = 0;

  const msgEl     = document.getElementById('frettris-msg');
  const scoreEl   = document.getElementById('tet-score');
  const linesEl   = document.getElementById('tet-lines');
  const levelEl   = document.getElementById('tet-level');
  const hiScoreEl = document.getElementById('tet-hiscore');

  const startBtn  = document.getElementById('tet-start-btn');
  const pauseBtn  = document.getElementById('tet-pause-btn');
  const resetBtn  = document.getElementById('tet-reset-btn');

  // ── PERSISTENCE ─────────────────────────────────────────────
  const STORAGE_KEY = 'frettris_hi';

  function loadHighScore() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved ? parseInt(saved, 10) : 0;
    } catch (e) {
      return 0;
    }
  }

  function checkAndUpdateHighScore(currentScore) {
    if (currentScore > hiScore) {
      hiScore = currentScore;
      try { localStorage.setItem(STORAGE_KEY, hiScore); } catch (e) {}
    }
  }

  // ── GRID ────────────────────────────────────────────────────
  function createGrid() {
    return Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
  }

  function resizeGameCanvas() {
    if (!CANVAS) return;
    if (window.innerWidth <= 480) {
      BLOCK_SIZE     = 16;
      CANVAS.width   = 160;
      CANVAS.height  = 320;
    } else {
      BLOCK_SIZE     = 24;
      CANVAS.width   = 240;
      CANVAS.height  = 480;
    }
    renderGridAndPiece();
  }

  // ── GAME MECHANICS ──────────────────────────────────────────
  function generateRandomPiece() {
    const id     = Math.floor(Math.random() * 7) + 1;
    const matrix = PIECES[id];
    return {
      id,
      matrix: JSON.parse(JSON.stringify(matrix)),
      x: Math.floor((COLS - matrix[0].length) / 2),
      y: id === 2 ? -1 : 0
    };
  }

  function checkCollision(piece, offsetGrid) {
    const matrix = piece.matrix;
    for (let r = 0; r < matrix.length; r++) {
      for (let c = 0; c < matrix[r].length; c++) {
        if (matrix[r][c] !== 0) {
          let nextX = piece.x + c;
          let nextY = piece.y + r;
          if (offsetGrid) { nextX += offsetGrid.x || 0; nextY += offsetGrid.y || 0; }
          if (nextX < 0 || nextX >= COLS || nextY >= ROWS) return true;
          if (nextY >= 0 && grid[nextY][nextX] !== 0) return true;
        }
      }
    }
    return false;
  }

  function mergeActivePieceToGrid() {
    activePiece.matrix.forEach((row, r) => {
      row.forEach((value, c) => {
        if (value !== 0) {
          const targetY = activePiece.y + r;
          if (targetY >= 0) grid[targetY][activePiece.x + c] = activePiece.id;
        }
      });
    });
  }

  function rotateMatrix(piece) {
    const matrix = piece.matrix;
    const n      = matrix.length;
    let rotated  = Array.from({ length: n }, () => new Array(n).fill(0));
    for (let r = 0; r < n; r++)
      for (let c = 0; c < n; c++)
        rotated[c][n - 1 - r] = matrix[r][c];

    const origin = piece.matrix;
    piece.matrix = rotated;
    if (checkCollision(piece)) {
      piece.x += 1;
      if (checkCollision(piece)) {
        piece.x -= 2;
        if (checkCollision(piece)) { piece.x += 1; piece.matrix = origin; }
      }
    }
  }

  function clearLines() {
    let clearedCount = 0;
    outer: for (let r = ROWS - 1; r >= 0; r--) {
      for (let c = 0; c < COLS; c++) { if (grid[r][c] === 0) continue outer; }
      grid.splice(r, 1);
      grid.unshift(new Array(COLS).fill(0));
      clearedCount++;
      r++;
    }
    if (clearedCount > 0) {
      const table = [0, 100, 300, 500, 800];
      score += (table[clearedCount] || 800) * level;
      lines += clearedCount;
      level  = Math.floor(lines / 10) + 1;
      checkAndUpdateHighScore(score);
      updateStateDOM();
    }
  }

  function handleDrop() {
    activePiece.y++;
    if (checkCollision(activePiece)) {
      activePiece.y--;
      mergeActivePieceToGrid();
      clearLines();
      activePiece = nextPiece;
      nextPiece   = generateRandomPiece();
      if (checkCollision(activePiece)) {
        gameOver = true;
        endGameLoop();
      }
      renderNextPiece();
    }
    dropCounter = 0;
  }

  function hardDrop() {
    if (gameOver || isPaused || !activePiece) return;
    while (!checkCollision(activePiece, { x: 0, y: 1 })) activePiece.y++;
    handleDrop();
    renderGridAndPiece();
  }

  // ── RENDERING ───────────────────────────────────────────────
  function drawBlock(ctx, x, y, colorId, targetSize) {
    ctx.fillStyle   = COLORS[colorId];
    ctx.fillRect(x * targetSize, y * targetSize, targetSize, targetSize);
    ctx.strokeStyle = '#0a0a12';
    ctx.lineWidth   = 1;
    ctx.strokeRect(x * targetSize, y * targetSize, targetSize, targetSize);
  }

  function renderGridAndPiece() {
    if (!CTX) return;
    CTX.clearRect(0, 0, CANVAS.width, CANVAS.height);
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++)
        if (grid[r][c] !== 0) drawBlock(CTX, c, r, grid[r][c], BLOCK_SIZE);

    if (activePiece) {
      activePiece.matrix.forEach((row, r) => {
        row.forEach((value, c) => {
          if (value !== 0 && activePiece.y + r >= 0)
            drawBlock(CTX, activePiece.x + c, activePiece.y + r, activePiece.id, BLOCK_SIZE);
        });
      });
    }
  }

  function renderNextPiece() {
    if (!NEXT_CTX || !nextPiece) return;
    NEXT_CTX.clearRect(0, 0, NEXT_CANVAS.width, NEXT_CANVAS.height);
    const m       = nextPiece.matrix;
    const nSize   = 16;
    const offsetX = (NEXT_CANVAS.width  - m[0].length * nSize) / 2;
    const offsetY = (NEXT_CANVAS.height - m.length    * nSize) / 2;
    m.forEach((row, r) => {
      row.forEach((value, c) => {
        if (value !== 0) {
          NEXT_CTX.fillStyle   = COLORS[nextPiece.id];
          NEXT_CTX.fillRect(offsetX + c * nSize, offsetY + r * nSize, nSize, nSize);
          NEXT_CTX.strokeStyle = '#0a0a12';
          NEXT_CTX.strokeRect(offsetX + c * nSize, offsetY + r * nSize, nSize, nSize);
        }
      });
    });
  }

  function updateStateDOM() {
    if (scoreEl)   scoreEl.textContent                    = score;
    if (linesEl)   linesEl.textContent                    = lines;
    if (levelEl)   levelEl.querySelector('span').textContent = level;
    if (hiScoreEl) hiScoreEl.textContent                  = hiScore;
  }

  // ── GAME LIFECYCLE ──────────────────────────────────────────
  function gameTick(timestamp) {
    if (gameOver || isPaused) return;
    const delta = timestamp - lastTime;
    lastTime    = timestamp;
    dropCounter += delta;

    const speed = Math.max(50, 600 - (level - 1) * 55);
    if (dropCounter > speed) handleDrop();
    renderGridAndPiece();
    gameInterval = requestAnimationFrame(gameTick);
  }

  function startNewGame() {
    grid    = createGrid();
    score   = 0;
    lines   = 0;
    level   = 1;
    gameOver  = false;
    isPaused  = false;
    activePiece = generateRandomPiece();
    nextPiece   = generateRandomPiece();

    updateStateDOM();
    renderNextPiece();

    if (msgEl) msgEl.innerHTML = `STATUS: <span class="hi">LIVE_SYSTEM</span>`;
    startBtn.disabled = true;
    pauseBtn.disabled = false;
    resetBtn.disabled = false;

    lastTime    = performance.now();
    dropCounter = 0;
    gameInterval = requestAnimationFrame(gameTick);

    // ── AUDIO: kick off music on user-initiated start
    if (!isMuted) {
      bgm.currentTime = 0;
      bgm.play().catch(err => console.log('Playback blocked:', err));
    }
  }

  function togglePause() {
    if (gameOver) return;
    isPaused = !isPaused;
    if (isPaused) {
      if (msgEl) msgEl.innerHTML = `STATUS: <span class="hi">PAUSED</span>`;
      pauseBtn.textContent = 'Resume';
      cancelAnimationFrame(gameInterval);
      bgm.pause(); // ── AUDIO
    } else {
      if (msgEl) msgEl.innerHTML = `STATUS: <span class="hi">LIVE_SYSTEM</span>`;
      pauseBtn.textContent = 'Resume';
      lastTime     = performance.now();
      gameInterval = requestAnimationFrame(gameTick);
      // ── AUDIO: resume only if not muted
      if (!isMuted) bgm.play().catch(err => console.log(err));
    }
  }

  function endGameLoop() {
    cancelAnimationFrame(gameInterval);
    bgm.pause(); // ── AUDIO
    if (msgEl) msgEl.innerHTML = `&gt; ERROR: <span class="hi" style="color:#ff2d78">GAME OVER</span>`;
    startBtn.disabled = false;
    pauseBtn.disabled = true;
    pauseBtn.textContent = 'Pause';
  }

  // ── INPUT ───────────────────────────────────────────────────
  function setupControlListeners() {
    window.addEventListener('keydown', (e) => {
      if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight',' '].includes(e.key) && !isPaused && !gameOver)
        if (document.activeElement.tagName !== 'INPUT') e.preventDefault();

      if (gameOver || isPaused || !activePiece) {
        if (e.key.toLowerCase() === 'p') togglePause();
        return;
      }

      switch (e.key) {
        case 'ArrowLeft':  case 'a': case 'A':
          activePiece.x--; if (checkCollision(activePiece)) activePiece.x++; break;
        case 'ArrowRight': case 'd': case 'D':
          activePiece.x++; if (checkCollision(activePiece)) activePiece.x--; break;
        case 'ArrowDown':  case 's': case 'S':
          handleDrop(); break;
        case 'ArrowUp': case 'w': case 'W': case 'z': case 'Z':
          rotateMatrix(activePiece); break;
        case ' ':
          hardDrop(); break;
        case 'p': case 'P':
          togglePause(); break;
      }
      renderGridAndPiece();
    });

    if (startBtn) startBtn.addEventListener('click', startNewGame);
    if (pauseBtn) pauseBtn.addEventListener('click', togglePause);
    if (resetBtn) resetBtn.addEventListener('click', () => {
      cancelAnimationFrame(gameInterval);
      bgm.pause(); // ── AUDIO: clean slate on reset
      startNewGame();
    });

    const mapping = [
      { id: 'tb-left',  action: () => { activePiece.x--; if (checkCollision(activePiece)) activePiece.x++; } },
      { id: 'tb-right', action: () => { activePiece.x++; if (checkCollision(activePiece)) activePiece.x--; } },
      { id: 'tb-rot',   action: () => rotateMatrix(activePiece) },
      { id: 'tb-down',  action: () => handleDrop() },
      { id: 'tb-drop',  action: () => hardDrop() }
    ];

    mapping.forEach(bind => {
      const btn = document.getElementById(bind.id);
      if (btn) btn.addEventListener('click', (e) => {
        e.preventDefault();
        if (gameOver || isPaused || !activePiece) return;
        bind.action();
        renderGridAndPiece();
      });
    });

    window.addEventListener('resize', resizeGameCanvas);
  }

  // ── BOOT ────────────────────────────────────────────────────
  if (CANVAS) {
    hiScore = loadHighScore();
    if (hiScoreEl) hiScoreEl.textContent = hiScore;
    resizeGameCanvas();
    setupControlListeners();
    initAudio(); // ── AUDIO: register mute button listener
  }
})();