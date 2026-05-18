(function () {
  'use strict';

  // ── GUITAR FRETBOARD ARCHITECTURE CONFIGURATION ────────────
  const COLS = 12; // 12 Chromatic Notes in an Octave
  const ROWS = 21; // 21 Frets on a Fender Stratocaster
  let BLOCK_SIZE = 24;

  const CANVAS = document.getElementById('frettris-canvas');
  const CTX = CANVAS ? CANVAS.getContext('2d') : null;
  const NEXT_CANVAS = document.getElementById('next-canvas');
  const NEXT_CTX = NEXT_CANVAS ? NEXT_CANVAS.getContext('2d') : null;

  // Real-Time Frequency Palette Mapping (Low Registers -> High Registers)
  const COLORS = [
    null,
    '#ff2d78', // Bass Note E
    '#ff5e00', // Note F
    '#ffd700', // Note G
    '#99cc77', // Note A
    '#00f5ff', // Note B
    '#b06aff', // Note C
    '#3344ff'  // Note D
  ];

  // Modified Geometric Block Wireframes (Decoupled from standard Tetrominos)
  const PIECES = [
    [],
    [[1, 1, 0], [0, 1, 1], [0, 0, 0]], 
    [[0, 0, 0, 0], [2, 2, 2, 2], [0, 0, 0, 0], [0, 0, 0, 0]], 
    [[3, 3], [3, 3]], 
    [[0, 4, 4], [4, 4, 0], [0, 0, 0]], 
    [[0, 5, 0], [5, 5, 5], [0, 0, 0]], 
    [[0, 0, 6], [6, 6, 6], [0, 0, 0]], 
    [[7, 0, 0], [7, 7, 7], [0, 0, 0]]  
  ];

  // Base frequencies mapping to columns for the polyphonic synthesizer engine
  const BASE_NOTES = [130.81, 138.59, 146.83, 155.56, 164.81, 174.61, 185.00, 196.00, 207.65, 220.00, 233.08, 246.94];

  // ── POLYPHONIC AUDIO SYNTHESIS ENGINE ──────────────────────
  class LiveSynthEngine {
    constructor() {
      this.ctx = null;
      this.masterGain = null;
    }

    init() {
      if (!this.ctx) {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.setValueAtTime(0.4, this.ctx.currentTime);
        this.masterGain.connect(this.ctx.destination);
      }
    }

    // Play a dynamically generated chord cascade based on row clearing variables
    playChord(columnsCleared, multiplier) {
      if (isMuted || !this.ctx) return;
      this.init();

      const baseTime = this.ctx.currentTime;
      columnsCleared.forEach((colIndex, idx) => {
        let osc = this.ctx.createOscillator();
        let gainNode = this.ctx.createGain();
        let panner = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : null;

        // Calculate frequency scaled by row clearing depth
        const baseFreq = BASE_NOTES[colIndex % 12];
        osc.type = idx % 2 === 0 ? 'triangle' : 'sine';
        osc.frequency.setValueAtTime(baseFreq * (multiplier === 4 ? 2.0 : 1.0), baseTime);
        
        // Add progressive pitch modulation
        osc.frequency.exponentialRampToValueAtTime(baseFreq * 1.5, baseTime + 0.4);

        gainNode.gain.setValueAtTime(0.18, baseTime);
        gainNode.gain.exponentialRampToValueAtTime(0.001, baseTime + 0.5);

        if (panner) {
          // Pan notes left-to-right based on fret matrix index positioning
          panner.pan.setValueAtTime((colIndex / 6) - 1, baseTime);
          osc.connect(panner);
          panner.connect(gainNode);
        } else {
          osc.connect(gainNode);
        }

        gainNode.connect(this.masterGain);
        osc.start(baseTime);
        osc.stop(baseTime + 0.52);
      });
    }
  }

  const audio = new LiveSynthEngine();
  let isMuted = false;

  // ── ENGINE STATE VARIABLES ─────────────────────────────────
  let grid = createGrid();
  let score = 0;
  let lines = 0;
  let level = 1;
  let hiScore = localStorage.getItem('frettris_hi') ? parseInt(localStorage.getItem('frettris_hi'), 10) : 0;

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
  const muteBtn = document.getElementById('frettris-mute-btn');

  // ── GRID CREATION AND SCALE LOGIC ──────────────────────────
  function createGrid() {
    return Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
  }

  function resizeGameCanvas() {
    if (!CANVAS) return;
    if (window.innerWidth <= 480) {
      BLOCK_SIZE = 16;
      CANVAS.width = COLS * BLOCK_SIZE; // 192px
      CANVAS.height = ROWS * BLOCK_SIZE; // 336px
    } else {
      BLOCK_SIZE = 24;
      CANVAS.width = COLS * BLOCK_SIZE; // 288px
      CANVAS.height = ROWS * BLOCK_SIZE; // 504px
    }
    renderGridAndPiece();
  }

  // ── AUDIO CONTROL LIFECYCLE ────────────────────────────────
  function initAudioPipeline() {
    if (!muteBtn) return;
    muteBtn.addEventListener('click', (e) => {
      e.preventDefault();
      isMuted = !isMuted;
      if (isMuted) {
        muteBtn.classList.add('is-muted');
      } else {
        muteBtn.classList.remove('is-muted');
        audio.init();
      }
    });
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
    if (checkCollision(piece)) {
      piece.x += 1;
      if (checkCollision(piece)) {
        piece.x -= 2;
        if (checkCollision(piece)) {
          piece.x += 1;
          piece.matrix = originMatrix;
        }
      }
    }
  }

  function clearLines() {
    let clearedCount = 0;
    let columnsCaptured = [];

    outer: for (let r = ROWS - 1; r >= 0; r--) {
      for (let c = 0; c < COLS; c++) {
        if (grid[r][c] === 0) continue outer;
      }
      // Track row active structural column layout index bounds before slicing out
      for (let c = 0; c < COLS; c++) {
        if (!columnsCaptured.includes(c)) columnsCaptured.push(c);
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

      if (score > hiScore) {
        hiScore = score;
        localStorage.setItem('frettris_hi', hiScore);
      }
      
      // Fire live localized dynamic poly-synth instead of a raw mp3 asset trigger
      audio.playChord(columnsCaptured, clearedCount);
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

  // ── GHOST PIECE ────────────────────────────────────────────
  function getGhostY() {
    if (!activePiece) return null;
    let ghostY = activePiece.y;
    const ghost = { matrix: activePiece.matrix, x: activePiece.x, y: ghostY };
    while (!checkCollision({ ...ghost, y: ghost.y + 1 })) {
      ghost.y++;
    }
    return ghost.y;
  }

  // ── VECTORS RENDERING INTERFACES ───────────────────────────

  // Render a clean neon hollow wireframe structure rather than a dense brick tile
  function drawBlock(ctx, x, y, colorId, targetSize, glowColor) {
    ctx.save();
    if (glowColor) {
      ctx.shadowColor = glowColor;
      ctx.shadowBlur = 10;
    }
    ctx.strokeStyle = COLORS[colorId];
    ctx.lineWidth = 1.5;
    
    // Draw hollow guitar scale block node frame
    ctx.strokeRect(x * targetSize + 1.5, y * targetSize + 1.5, targetSize - 3, targetSize - 3);
    
    // Tiny structural center point core element
    ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.fillRect(x * targetSize + (targetSize/2) - 2, y * targetSize + (targetSize/2) - 2, 4, 4);
    
    ctx.restore();
  }

  // Render the structural fretboard guidelines (Strategic fret positions highlighted)
  function drawGrid(ctx, width, height) {
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
    ctx.lineWidth = 0.5;
    for (let c = 0; c <= COLS; c++) {
      ctx.beginPath();
      ctx.moveTo(c * BLOCK_SIZE, 0);
      ctx.lineTo(c * BLOCK_SIZE, height);
      ctx.stroke();
    }
    for (let r = 0; r <= ROWS; r++) {
      ctx.beginPath();
      ctx.moveTo(0, r * BLOCK_SIZE);
      ctx.lineTo(width, r * BLOCK_SIZE);
      
      // Highlight classic guitar fretboard marker line locations (Fret 3, 5, 7, 9, 12, 15, 17, 19, 21)
      if ([3, 5, 7, 9, 12, 15, 17, 19, 21].includes(r)) {
        ctx.strokeStyle = 'rgba(255, 215, 0, 0.14)';
        ctx.lineWidth = 1.5;
      } else {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
        ctx.lineWidth = 0.5;
      }
      ctx.stroke();
    }
  }

  function renderGridAndPiece() {
    if (!CTX) return;
    CTX.clearRect(0, 0, CANVAS.width, CANVAS.height);

    drawGrid(CTX, CANVAS.width, CANVAS.height);

    // Render Static Board Field Grid
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (grid[r][c] !== 0) {
          const color = COLORS[grid[r][c]];
          drawBlock(CTX, c, r, grid[r][c], BLOCK_SIZE, color);
        }
      }
    }

    // Render Neon Ghost String Tracker Outline
    if (activePiece) {
      const ghostY = getGhostY();
      if (ghostY !== null && ghostY > activePiece.y) {
        activePiece.matrix.forEach((row, r) => {
          row.forEach((value, c) => {
            if (value !== 0 && ghostY + r >= 0) {
              CTX.save();
              CTX.strokeStyle = 'rgba(255, 255, 255, 0.08)';
              CTX.setLineDash([2, 2]);
              CTX.lineWidth = 1;
              CTX.strokeRect(
                (activePiece.x + c) * BLOCK_SIZE + 2,
                (ghostY + r) * BLOCK_SIZE + 2,
                BLOCK_SIZE - 4,
                BLOCK_SIZE - 4
              );
              CTX.restore();
            }
          });
        });
      }
    }

    // Render Falling Structural Piece Matrix
    if (activePiece) {
      const color = COLORS[activePiece.id];
      activePiece.matrix.forEach((row, r) => {
        row.forEach((value, c) => {
          if (value !== 0 && activePiece.y + r >= 0) {
            drawBlock(CTX, activePiece.x + c, activePiece.y + r, activePiece.id, BLOCK_SIZE, color);
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
    const color = COLORS[nextPiece.id];

    m.forEach((row, r) => {
      row.forEach((value, c) => {
        if (value !== 0) {
          NEXT_CTX.save();
          NEXT_CTX.shadowColor = color;
          NEXT_CTX.shadowBlur = 6;
          NEXT_CTX.strokeStyle = color;
          NEXT_CTX.lineWidth = 1;
          NEXT_CTX.strokeRect(offsetX + c * nSize + 1, offsetY + r * nSize + 1, nSize - 2, nSize - 2);
          NEXT_CTX.restore();
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
    audio.init();
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
    if (msgEl) msgEl.innerHTML = `&gt; ERROR: <span class="hi" style="color:#ff2d78">SYSTEM OVERFLOW</span>`;
    startBtn.disabled = false;
    pauseBtn.disabled = true;
    pauseBtn.textContent = 'Pause';
  }

  // ── SYSTEM LISTENERS & ROUTING INTERFACES ───────────────────
  function setupControlListeners() {
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

    if (startBtn) startBtn.addEventListener('click', startNewGame);
    if (pauseBtn) pauseBtn.addEventListener('click', togglePause);
    if (resetBtn) resetBtn.addEventListener('click', () => {
      cancelAnimationFrame(gameInterval);
      startNewGame();
    });

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

  if (CANVAS) {
    if (hiScoreEl) hiScoreEl.textContent = hiScore;
    resizeGameCanvas();
    setupControlListeners();
    initAudioPipeline();
  }
})();
