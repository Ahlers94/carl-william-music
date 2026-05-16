(function () {
  'use strict';

  // ── CORE ENVIRONMENT CONFIGURATION ─────────────────────────
  const COLS = 10;
  const ROWS = 20;
  let BLOCK_SIZE = 24;

  const CANVAS = document.getElementById('frettris-canvas');
  const CTX = CANVAS ? CANVAS.getContext('2d') : null;
  const NEXT_CANVAS = document.getElementById('next-canvas');
  const NEXT_CTX = NEXT_CANVAS ? NEXT_CANVAS.getContext('2d') : null;

  // Retro Color Assignment Palette
  const COLORS = [
    null,
    '#ff2d78', // Z - Pink
    '#00f5ff', // I - Cyan
    '#ffd700', // O - Gold
    '#99cc77', // S - Green
    '#b06aff', // T - Purple
    '#ff7700', // L - Orange
    '#008a44'  // J - Emerald
  ];

  const PIECES = [
    [],
    [[1, 1, 0], [0, 1, 1], [0, 0, 0]], // Z
    [[0, 0, 0, 0], [2, 2, 2, 2], [0, 0, 0, 0], [0, 0, 0, 0]], // I
    [[3, 3], [3, 3]], // O
    [[0, 4, 4], [4, 4, 0], [0, 0, 0]], // S
    [[0, 5, 0], [5, 5, 5], [0, 0, 0]], // T
    [[0, 0, 6], [6, 6, 6], [0, 0, 0]], // L
    [[7, 0, 0], [7, 7, 7], [0, 0, 0]]  // J
  ];

  // ── ENGINE STATE VARIABLES ─────────────────────────────────
  let grid = createGrid();
  let score = 0;
  let lines = 0;
  let level = 1;
  let hiScore = 0; // Initialized via loadHighScore() down below

  let activePiece = null;
  let nextPiece = null;
  let gameOver = false;
  let isPaused = false;
  let gameInterval = null;
  let dropCounter = 0;
  let lastTime = 0;

  // UI Targets
  const msgEl = document.getElementById('frettris-msg');
  const scoreEl = document.getElementById('tet-score');
  const linesEl = document.getElementById('tet-lines');
  const levelEl = document.getElementById('tet-level');
  const hiScoreEl = document.getElementById('tet-hiscore');

  const startBtn = document.getElementById('tet-start-btn');
  const pauseBtn = document.getElementById('tet-pause-btn');
  const resetBtn = document.getElementById('tet-reset-btn');

  // ── PERSISTENCE LIFECYCLE FUNCTIONS ────────────────────────
  const STORAGE_KEY = 'frettris_hi';

  function loadHighScore() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved ? parseInt(saved, 10) : 0;
    } catch (e) {
      console.error("Storage Matrix Link Failure:", e);
      return 0;
    }
  }

  function checkAndUpdateHighScore(currentScore) {
    if (currentScore > hiScore) {
      hiScore = currentScore;
      try {
        localStorage.setItem(STORAGE_KEY, hiScore);
      } catch (e) {
        console.error("Failed to commit High Score to system memory:", e);
      }
    }
  }

  // ── GRID CREATION AND SCALE LOGIC ──────────────────────────
  function createGrid() {
    return Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
  }

  function resizeGameCanvas() {
    if (!CANVAS) return;
    if (window.innerWidth <= 480) {
      BLOCK_SIZE = 16;
      CANVAS.width = 160;
      CANVAS.height = 320;
    } else {
      BLOCK_SIZE = 24;
      CANVAS.width = 240;
      CANVAS.height = 480;
    }
    renderGridAndPiece();
  }

  // ── CORE GAME MECHANICS ────────────────────────────────────
  function generateRandomPiece() {
    const id = Math.floor(Math.random() * 7) + 1;
    const matrix = PIECES[id];
    return {
      id: id,
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
          if (offsetGrid) {
            nextX += offsetGrid.x || 0;
            nextY += offsetGrid.y || 0;
          }
          if (nextX < 0 || nextX >= COLS || nextY >= ROWS) {
            return true;
          }
          if (nextY >= 0 && grid[nextY][nextX] !== 0) {
            return true;
          }
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
          if (targetY >= 0) {
            grid[targetY][activePiece.x + c] = activePiece.id;
          }
        }
      });
    });
  }

  function rotateMatrix(piece) {
    const matrix = piece.matrix;
    const n = matrix.length;
    let rotated = Array.from({ length: n }, () => new Array(n).fill(0));
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        rotated[c][n - 1 - r] = matrix[r][c];
      }
    }
    const originMatrix = piece.matrix;
    piece.matrix = rotated;
    // Wall kick checking sequence logic
    if (checkCollision(piece)) {
      piece.x += 1;
      if (checkCollision(piece)) {
        piece.x -= 2;
        if (checkCollision(piece)) {
          piece.x += 1;
          piece.matrix = originMatrix; // Revert
        }
      }
    }
  }

  function clearLines() {
    let clearedCount = 0;
    outer: for (let r = ROWS - 1; r >= 0; r--) {
      for (let c = 0; c < COLS; c++) {
        if (grid[r][c] === 0) continue outer;
      }
      grid.splice(r, 1);
      grid.unshift(new Array(COLS).fill(0));
      clearedCount++;
      r++;
    }

    if (clearedCount > 0) {
      const scoringTable = [0, 100, 300, 500, 800];
      score += (scoringTable[clearedCount] || 800) * level;
      lines += clearedCount;
      level = Math.floor(lines / 10) + 1;

      // Check storage thresholds during line updates
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
      nextPiece = generateRandomPiece();
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
    while (!checkCollision(activePiece, { x: 0, y: 1 })) {
      activePiece.y++;
    }
    handleDrop();
    renderGridAndPiece();
  }

  // ── RENDERING LOOPS ────────────────────────────────────────
  function drawBlock(ctx, x, y, colorId, targetSize) {
    ctx.fillStyle = COLORS[colorId];
    ctx.fillRect(x * targetSize, y * targetSize, targetSize, targetSize);
    ctx.strokeStyle = '#0a0a12';
    ctx.lineWidth = 1;
    ctx.strokeRect(x * targetSize, y * targetSize, targetSize, targetSize);
  }

  function renderGridAndPiece() {
    if (!CTX) return;
    CTX.clearRect(0, 0, CANVAS.width, CANVAS.height);

    // Draw Static Grid
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (grid[r][c] !== 0) {
          drawBlock(CTX, c, r, grid[r][c], BLOCK_SIZE);
        }
      }
    }
    // Draw Current Falling Piece
    if (activePiece) {
      activePiece.matrix.forEach((row, r) => {
        row.forEach((value, c) => {
          if (value !== 0 && activePiece.y + r >= 0) {
            drawBlock(CTX, activePiece.x + c, activePiece.y + r, activePiece.id, BLOCK_SIZE);
          }
        });
      });
    }
  }

  function renderNextPiece() {
    if (!NEXT_CTX || !nextPiece) return;
    NEXT_CTX.clearRect(0, 0, NEXT_CANVAS.width, NEXT_CANVAS.height);
    const m = nextPiece.matrix;
    const nSize = 16;
    const offsetX = (NEXT_CANVAS.width - m[0].length * nSize) / 2;
    const offsetY = (NEXT_CANVAS.height - m.length * nSize) / 2;

    m.forEach((row, r) => {
      row.forEach((value, c) => {
        if (value !== 0) {
          NEXT_CTX.fillStyle = COLORS[nextPiece.id];
          NEXT_CTX.fillRect(offsetX + c * nSize, offsetY + r * nSize, nSize, nSize);
          NEXT_CTX.strokeStyle = '#0a0a12';
          NEXT_CTX.strokeRect(offsetX + c * nSize, offsetY + r * nSize, nSize, nSize);
        }
      });
    });
  }

  function updateStateDOM() {
    if (scoreEl) scoreEl.textContent = score;
    if (linesEl) linesEl.textContent = lines;
    if (levelEl) levelEl.querySelector('span').textContent = level;
    if (hiScoreEl) hiScoreEl.textContent = hiScore;
  }

  // ── RUNTIME ENGINE GAME LIFECYCLE ──────────────────────────
  function gameTick(timestamp) {
    if (gameOver || isPaused) return;
    const delta = timestamp - lastTime;
    lastTime = timestamp;
    dropCounter += delta;

    const speed = Math.max(50, 600 - (level - 1) * 55);
    if (dropCounter > speed) {
      handleDrop();
    }
    renderGridAndPiece();
    gameInterval = requestAnimationFrame(gameTick);
  }

  function startNewGame() {
    grid = createGrid();
    score = 0;
    lines = 0;
    level = 1;
    gameOver = false;
    isPaused = false;
    activePiece = generateRandomPiece();
    nextPiece = generateRandomPiece();
    
    updateStateDOM();
    renderNextPiece();
    
    if (msgEl) msgEl.innerHTML = `STATUS: <span class="hi">LIVE_SYSTEM</span>`;
    startBtn.disabled = true;
    pauseBtn.disabled = false;
    resetBtn.disabled = false;

    lastTime = performance.now();
    dropCounter = 0;
    gameInterval = requestAnimationFrame(gameTick);
  }

  function togglePause() {
    if (gameOver) return;
    isPaused = !isPaused;
    if (isPaused) {
      if (msgEl) msgEl.innerHTML = `STATUS: <span class="hi">PAUSED</span>`;
      pauseBtn.textContent = 'Resume';
      cancelAnimationFrame(gameInterval);
    } else {
      if (msgEl) msgEl.innerHTML = `STATUS: <span class="hi">LIVE_SYSTEM</span>`;
      pauseBtn.textContent = 'Pause';
      lastTime = performance.now();
      gameInterval = requestAnimationFrame(gameTick);
    }
  }

  function endGameLoop() {
    cancelAnimationFrame(gameInterval);
    if (msgEl) msgEl.innerHTML = `&gt; ERROR: <span class="hi" style="color:#ff2d78">GAME OVER</span>`;
    startBtn.disabled = false;
    pauseBtn.disabled = true;
    pauseBtn.textContent = 'Pause';
  }

  // ── SYSTEM LISTENERS & ROUTING INTERFACES ───────────────────
  function setupControlListeners() {
    // Keyboard Matrix Actions
    window.addEventListener('keydown', (e) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key) && !isPaused && !gameOver) {
        if (document.activeElement.tagName !== 'INPUT') e.preventDefault();
      }
      if (gameOver || isPaused || !activePiece) {
        if (e.key.toLowerCase() === 'p') togglePause();
        return;
      }

      switch (e.key) {
        case 'ArrowLeft':
        case 'a':
        case 'A':
          activePiece.x--;
          if (checkCollision(activePiece)) activePiece.x++;
          break;
        case 'ArrowRight':
        case 'd':
        case 'D':
          activePiece.x++;
          if (checkCollision(activePiece)) activePiece.x--;
          break;
        case 'ArrowDown':
        case 's':
        case 'S':
          handleDrop();
          break;
        case 'ArrowUp':
        case 'w':
        case 'W':
        case 'z':
        case 'Z':
          rotateMatrix(activePiece);
          break;
        case ' ':
          hardDrop();
          break;
        case 'p':
        case 'P':
          togglePause();
          break;
      }
      renderGridAndPiece();
    });

    // Explicit Lifecycle Trigger Buttons
    if (startBtn) startBtn.addEventListener('click', startNewGame);
    if (pauseBtn) pauseBtn.addEventListener('click', togglePause);
    if (resetBtn) resetBtn.addEventListener('click', () => {
      cancelAnimationFrame(gameInterval);
      startNewGame();
    });

    // Mobile Virtual Deck Buttons Mapping
    const mapping = [
      { id: 'tb-left', action: () => { activePiece.x--; if (checkCollision(activePiece)) activePiece.x++; } },
      { id: 'tb-right', action: () => { activePiece.x++; if (checkCollision(activePiece)) activePiece.x--; } },
      { id: 'tb-rot', action: () => rotateMatrix(activePiece) },
      { id: 'tb-down', action: () => handleDrop() },
      { id: 'tb-drop', action: () => hardDrop() }
    ];

    mapping.forEach(bind => {
      const btn = document.getElementById(bind.id);
      if (btn) {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          if (gameOver || isPaused || !activePiece) return;
          bind.action();
          renderGridAndPiece();
        });
      }
    });

    window.addEventListener('resize', resizeGameCanvas);
  }

  // Execution Gateway entry confirmation
  if (CANVAS) {
    hiScore = loadHighScore(); // Fetch data safely before UI updates
    if (hiScoreEl) hiScoreEl.textContent = hiScore;
    resizeGameCanvas();
    setupControlListeners();
  }
})();
