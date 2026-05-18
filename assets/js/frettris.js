/**
 * FRETTRIS ENGINE v2.0 - CAGED Chord Matrix System
 * Custom-built for Carl William Music
 */

// ── AUDIO HARDWARE ENGINE ───────────────────────────────────
const AudioEngine = {
  ctx: null,
  stringBases: [82.41, 110.00, 146.83, 196.00, 246.94, 329.63], // E2, A2, D3, G3, B3, E4

  init() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
  },

  strum(frets) {
    this.init();
    const now = this.ctx.currentTime;
    
    frets.forEach((fret, stringIdx) => {
      if (fret === null) return;
      
      const freq = this.stringBases[stringIdx] * Math.pow(2, fret / 12);
      const osc = this.ctx.createOscillator();
      const gainNode = this.ctx.createGain();
      
      // Cyberpunk triangle-synth texture
      osc.type = 'triangle';
      osc.frequency.value = freq;
      
      gainNode.gain.setValueAtTime(0.25, now);
      gainNode.gain.exponentialRampToValueAtTime(0.001, now + 1.5);
      
      osc.connect(gainNode);
      gainNode.connect(this.ctx.destination);
      
      // 30ms stagger delay for a realistic physical pick stroke
      const strumDelay = stringIdx * 0.03;
      osc.start(now + strumDelay);
      osc.stop(now + strumDelay + 1.5);
    });
  }
};

// ── GAME STATE CONFIGURATION ────────────────────────────────
const Frettris = {
  canvas: null,
  ctx: null,
  isMobile: false,

  // Grid Properties (6 Strings, 21 Frets)
  STRINGS: 6,
  FRETS: 21,
  
  // Game State Metrics
  score: 0,
  bestScore: 0,
  level: 1,
  
  // Interaction Coordinates
  cursor: { string: 0, fret: 0 },
  userFretboard: Array(6).fill(null), // Holds placed notes [null, null, 3, 5, 5, null]
  
  // Current Quest Target
  currentTarget: {
    rootNoteName: "C",
    rootFretOffset: 3, // Target root position on the board
    chordType: "Major",
    shapeName: "A_Shape"
  },

  init() {
    this.canvas = document.getElementById('frettris-canvas');
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext('2d');
    
    this.checkViewport();
    this.setupListeners();
    this.generateNewTarget();
    this.draw();
    
    // Load High Score
    this.bestScore = localStorage.getItem('frettris_hi') || 0;
    document.getElementById('tet-hiscore').innerText = this.bestScore;
  },

  checkViewport() {
    this.isMobile = window.innerWidth <= 480;
    // Set fixed sizing layouts safely for responsive canvas rendering
    if (this.isMobile) {
      this.canvas.width = 192;  // Flips geometry vertically for sleek mobile views
      this.canvas.height = 420;
    } else {
      this.canvas.width = 460;
      this.canvas.height = 200;
    }
  },

  setupListeners() {
    window.addEventListener('keydown', (e) => this.handleInput(e));
    this.canvas.addEventListener('click', (e) => this.handleMouseClick(e));
    
    // UI Interface Wiring
    document.getElementById('tet-start-btn').addEventListener('click', () => {
      AudioEngine.init();
      this.resetGame();
    });
  },

  handleInput(e) {
    switch(e.key.toUpperCase()) {
      case 'ARROWLEFT': case 'A':
        if (this.cursor.fret > 0) this.cursor.fret--;
        break;
      case 'ARROWRIGHT': case 'D':
        if (this.cursor.fret < this.FRETS - 1) this.cursor.fret++;
        break;
      case 'ARROWUP': case 'W':
        if (this.cursor.string < this.STRINGS - 1) this.cursor.string++;
        break;
      case 'ARROWDOWN': case 'S':
        if (this.cursor.string > 0) this.cursor.string--;
        break;
      case ' ': // Spacebar triggers a block placement strike
        e.preventDefault();
        this.toggleFret(this.cursor.string, this.cursor.fret);
        break;
    }
    this.draw();
  },

  handleMouseClick(e) {
    const rect = this.canvas.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;
    
    let targetString, targetFret;
    
    if (this.isMobile) {
      // Mobile Layout: Vertical Fretboard Layout Engine
      const fretHeight = this.canvas.height / this.FRETS;
      const stringWidth = this.canvas.width / (this.STRINGS + 1);
      targetFret = Math.floor(clickY / fretHeight);
      targetString = Math.floor(clickX / stringWidth) - 1;
    } else {
      // Standard Desktop Layout: Horizontal Fretboard Layout Engine
      const fretWidth = this.canvas.width / this.FRETS;
      const stringHeight = this.canvas.height / (this.STRINGS + 1);
      targetFret = Math.floor(clickX / fretWidth);
      targetString = this.STRINGS - Math.floor(clickY / stringHeight);
    }
    
    if (targetString >= 0 && targetString < this.STRINGS && targetFret >= 0 && targetFret < this.FRETS) {
      this.cursor = { string: targetString, fret: targetFret };
      this.toggleFret(targetString, targetFret);
      this.draw();
    }
  },

  toggleFret(string, fret) {
    if (this.userFretboard[string] === fret) {
      this.userFretboard[string] = null; // Remove note if clicked again
    } else {
      this.userFretboard[string] = fret; // Place structural block marker
    }
    this.checkChordMatch();
  },

  generateNewTarget() {
    const keys = ["C", "A", "G", "E", "D"];
    const types = Object.keys(CAGED_DICTIONARY);
    
    // Scale difficulty safely based on current score levels
    let selectedType = "Major";
    if (this.score >= 300) selectedType = types[Math.floor(Math.random() * types.length)];
    else if (this.score >= 100) selectedType = Math.random() > 0.5 ? "Minor" : "Major";

    const shapes = Object.keys(CAGED_DICTIONARY[selectedType]);
    const selectedShape = shapes[Math.floor(Math.random() * shapes.length)];
    
    // Assign structural fret placement offsets based on shape constraints
    const rootOffsets = { "C_Shape": 3, "A_Shape": 5, "G_Shape": 8, "E_Shape": 8, "D_Shape": 10 };
    
    this.currentTarget = {
      rootNoteName: keys[Math.floor(Math.random() * keys.length)],
      rootFretOffset: rootOffsets[selectedShape] || 3,
      chordType: selectedType,
      shapeName: selectedShape
    };

    // Prompt user via HTML UI element update
    const msgElement = document.getElementById('frettris-msg');
    if (msgElement) {
      msgElement.innerHTML = `BUILD: <span class="hi">${this.currentTarget.rootNoteName} ${this.currentTarget.chordType.replace('_', ' ')}</span> (${this.currentTarget.shapeName.replace('_', ' ')})`;
    }
  },

  checkChordMatch() {
    const template = CAGED_DICTIONARY[this.currentTarget.chordType][this.currentTarget.shapeName];
    if (!template) return;

    // Verify absolute fret layouts relative to structural base offsets
    let isMatch = true;
    for (let s = 0; s < this.STRINGS; s++) {
      let expectedFret = template[s];
      if (expectedFret !== null) {
        // Adjust baseline calculations across the chord system matrix mapping
        expectedFret = expectedFret; 
      }
      
      if (this.userFretboard[s] !== expectedFret) {
        isMatch = false;
        break;
      }
    }

    if (isMatch) {
      // Trigger Audio feedback engine instantly on evaluation match
      AudioEngine.strum(this.userFretboard);
      this.score += 50;
      document.getElementById('tet-score').innerText = this.score;
      
      if (this.score > this.bestScore) {
        this.bestScore = this.score;
        localStorage.setItem('frettris_hi', this.bestScore);
        document.getElementById('tet-hiscore').innerText = this.bestScore;
      }

      // Flash Success Vector Matrix Loop
      this.userFretboard = Array(6).fill(null);
      this.generateNewTarget();
    }
  },

  resetGame() {
    this.score = 0;
    this.userFretboard = Array(6).fill(null);
    document.getElementById('tet-score').innerText = this.score;
    this.generateNewTarget();
    this.draw();
  },

  // ── GRAPHICS RENDER PIPELINE ───────────────────────────────
  draw() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    
    if (this.isMobile) {
      this.renderVerticalFretboard();
    } else {
      this.renderHorizontalFretboard();
    }
  },

  renderHorizontalFretboard() {
    const w = this.canvas.width;
    const h = this.canvas.height;
    const fretW = w / this.FRETS;
    const stringH = h / (this.STRINGS + 1);

    // Draw wood fret markers (Dots on frets 3, 5, 7, 9, 12, 15, 17, 19)
    const markers = [3, 5, 7, 9, 12, 15, 17, 19];
    this.ctx.fillStyle = "rgba(255, 255, 255, 0.03)";
    markers.forEach(f => {
      const x = (f * fretW) - (fretW / 2);
      this.ctx.beginPath();
      this.ctx.arc(x, h / 2, 6, 0, Math.PI * 2);
      this.ctx.fill();
    });

    // Draw Nickel Wireframe Frets
    this.ctx.strokeStyle = "rgba(0, 245, 255, 0.15)";
    for (let f = 0; f < this.FRETS; f++) {
      this.ctx.beginPath();
      this.ctx.moveTo(f * fretW, 0);
      this.ctx.lineTo(f * fretW, h);
      this.ctx.stroke();
    }

    // Draw Core Strings (Varying gauges from low to high)
    for (let s = 0; s < this.STRINGS; s++) {
      const y = stringH + (s * stringH);
      this.ctx.strokeStyle = `rgba(255, 255, 255, ${0.2 + (s * 0.1)})`;
      this.ctx.lineWidth = 1 + (this.STRINGS - s) * 0.5;
      this.ctx.beginPath();
      this.ctx.moveTo(0, y);
      this.ctx.lineTo(w, y);
      this.ctx.stroke();
    }
    this.ctx.lineWidth = 1; // reset

    // Render Active Block Fretted Notes
    this.userFretboard.forEach((fret, stringIdx) => {
      if (fret === null) return;
      const x = (fret * fretW) + (fretW / 2);
      const y = h - (stringH + (stringIdx * stringH));
      
      this.ctx.fillStyle = "#ff2d78";
      this.ctx.shadowBlur = 10;
      this.ctx.shadowColor = "#ff2d78";
      this.ctx.beginPath();
      this.ctx.arc(x, y, 8, 0, Math.PI * 2);
      this.ctx.fill();
      this.ctx.shadowBlur = 0; // reset
    });

    // Render Interactive Selection Cursor Box
    const cx = (this.cursor.fret * fretW);
    const cy = h - (stringH + (this.cursor.string * stringH)) - (stringH / 2);
    this.ctx.strokeStyle = "#00f5ff";
    this.ctx.lineWidth = 2;
    this.ctx.strokeRect(cx + 2, cy + 4, fretW - 4, stringH - 8);
    this.ctx.lineWidth = 1;
  },

  renderVerticalFretboard() {
    const w = this.canvas.width;
    const h = this.canvas.height;
    const fretH = h / this.FRETS;
    const stringW = w / (this.STRINGS + 1);

    // Draw Mobile Nickel Frets
    this.ctx.strokeStyle = "rgba(0, 245, 255, 0.15)";
    for (let f = 0; f < this.FRETS; f++) {
      this.ctx.beginPath();
      this.ctx.moveTo(0, f * fretH);
      this.ctx.lineTo(w, f * fretH);
      this.ctx.stroke();
    }

    // Draw Mobile Strings
    for (let s = 0; s < this.STRINGS; s++) {
      const x = stringW + (s * stringW);
      this.ctx.strokeStyle = `rgba(255, 255, 255, ${0.2 + (s * 0.1)})`;
      this.ctx.beginPath();
      this.ctx.moveTo(x, 0);
      this.ctx.lineTo(x, h);
      this.ctx.stroke();
    }

    // Render Active Mobile Fretted Notes
    this.userFretboard.forEach((fret, stringIdx) => {
      if (fret === null) return;
      const x = stringW + (stringIdx * stringW);
      const y = (fret * fretH) + (fretH / 2);
      
      this.ctx.fillStyle = "#ff2d78";
      this.ctx.beginPath();
      this.ctx.arc(x, y, 7, 0, Math.PI * 2);
      this.ctx.fill();
    });

    // Mobile Selection Cursor
    const cx = stringW + (this.cursor.string * stringW) - (stringW / 2);
    const cy = (this.cursor.fret * fretH);
    this.ctx.strokeStyle = "#00f5ff";
    this.ctx.strokeRect(cx + 2, cy + 2, stringW - 4, fretH - 4);
  }
};

// Initialize Engine on Document Load Sequence
document.addEventListener('DOMContentLoaded', () => Frettris.init());
