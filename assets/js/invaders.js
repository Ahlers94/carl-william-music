/**
 * AUDIO SEQUENCER ENGINE (Web Audio API)
 */
/**
 * AUDIO SEQUENCER ENGINE (Web Audio API with Master Saturation Stage)
 */
class AudioEngine {
  constructor() {
    this.ctx = null;
    this.isMuted = true;
    this.sequence = [110.00, 130.81, 146.83, 164.81]; // A2, C3, D3, E3
    this.seqIndex = 0;
    this.bpm = 55;
    this.nextTickTime = 0;
    
    // Master Nodes
    this.masterGain = null;
    this.distortion = null;
  }

  init() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      
      // Create master chain nodes
      this.distortion = this.ctx.createWaveShaper();
      this.masterGain = this.ctx.createGain();
      
      // Generate a smooth soft-clipping curve for analog warmth and brickwall protection
      this.distortion.curve = this.makeDistortionCurve(25); 
      this.distortion.oversample = '4x';
      
      // Set master headroom volume (1.40 = structural boost)
      this.masterGain.gain.setValueAtTime(1.40, this.ctx.currentTime);
      
      // Connect: Synth Voice -> Distortion (Saturation) -> Master Gain -> Output
      this.distortion.connect(this.masterGain);
      this.masterGain.connect(this.ctx.destination);
    }
  }

  // Sigmoid curve formula for soft-clipping saturation
  makeDistortionCurve(amount) {
    const k = typeof amount === 'number' ? amount : 50;
    const n_samples = 44100;
    const curve = new Float32Array(n_samples);
    const deg = Math.PI / 180;
    for (let i = 0; i < n_samples; ++i) {
      const x = (i * 2) / n_samples - 1;
      curve[i] = ((3 + k) * x * 20 * deg) / (Math.PI + k * Math.abs(x));
    }
    return curve;
  }

  getInterval() {
    return 60.0 / this.bpm;
  }

  playStepTone(index) {
    if (this.isMuted || !this.ctx) return;
    
    let osc = this.ctx.createOscillator();
    let gain = this.ctx.createGain();
    let filter = this.ctx.createBiquadFilter();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(this.sequence[index % this.sequence.length], this.ctx.currentTime);

    const dynamicCutoff = Math.min(2200, 400 + (this.bpm * 4.5));
    filter.type = 'lowpass';
    filter.Q.setValueAtTime(5, this.ctx.currentTime); // Slight punch resonance boost
    filter.frequency.setValueAtTime(dynamicCutoff, this.ctx.currentTime);
    filter.frequency.exponentialRampToValueAtTime(80, this.ctx.currentTime + 0.15);

    // Cranked engine baseline note mix (0.08 -> 0.28)
    gain.gain.setValueAtTime(0.28, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.15);

    osc.connect(filter);
    filter.connect(gain);
    
    // Route to master saturation strip instead of raw destination
    gain.connect(this.distortion);

    osc.start();
    osc.stop(this.ctx.currentTime + 0.16);
  }

  playLaser() {
    if (this.isMuted || !this.ctx) return;
    let osc = this.ctx.createOscillator();
    let gain = this.ctx.createGain();
    
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(580, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(120, this.ctx.currentTime + 0.08);

    // Laser output push (0.10 -> 0.35)
    gain.gain.setValueAtTime(0.35, this.ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.001, this.ctx.currentTime + 0.08);

    osc.connect(gain);
    gain.connect(this.distortion);
    
    osc.start();
    osc.stop(this.ctx.currentTime + 0.09);
  }

  playExplosion() {
    if (this.isMuted || !this.ctx) return;
    const bufferSize = this.ctx.sampleRate * 0.25;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    let noise = this.ctx.createBufferSource();
    noise.buffer = buffer;

    let filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(420, this.ctx.currentTime); // Slightly wider footprint

    let gain = this.ctx.createGain();
    // Heavy detonation push (0.20 -> 0.55)
    gain.gain.setValueAtTime(0.55, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.24);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.distortion);

    noise.start();
    noise.stop(this.ctx.currentTime + 0.25);
  }
}

/**
 * PRODUCTION SIMULATION STRUCTS
 */
const canvas = document.getElementById('frettris-canvas');
const ctx = canvas.getContext('2d');
const audio = new AudioEngine();

let score = 0;
let highScore = parseInt(localStorage.getItem('invaders_hi_score')) || 0;
let lives = 3;
let isRunning = false;
let isPaused = false;
let keys = {};

let player, lasers, invaders, particles, barriers, shipChunks;
let invaderDirection = 1;
let invaderTickTimer = 0;
let toneSequenceTracker = 0;

// Anti-Camping & Fire Throttling State Variables
let lastPlayerX = 0;
let playerStationaryFrames = 0;
let antiCampCooldown = 0;

class Player {
  constructor() {
    this.w = 26;
    this.h = 16;
    this.resetToBaselinePosition();
    this.speed = 4.5;
    this.isExploding = false;
    this.respawnTimer = 0;
  }

  resetToBaselinePosition() {
    this.x = 40; 
    this.y = canvas.height - 40;
  }

  update() {
    if (this.isExploding) {
      this.respawnTimer--;
      if (this.respawnTimer <= 0) {
        this.isExploding = false;
        if (lives > 0) {
          this.resetToBaselinePosition();
        } else {
          endGame("GAME OVER");
        }
      }
      return;
    }

    if (keys['ArrowLeft'] || keys['Left']) this.x = Math.max(this.w, this.x - this.speed);
    if (keys['ArrowRight'] || keys['Right']) this.x = Math.min(canvas.width - this.w, this.x + this.speed);
    
    // Track stationary position for anti-camping weapon logic
    if (Math.abs(this.x - lastPlayerX) < 0.1) {
      playerStationaryFrames++;
    } else {
      playerStationaryFrames = 0;
    }
    lastPlayerX = this.x;

    if (keys[' ']) {
      const activeFiredLaser = lasers.some(l => l.vy < 0);
      if (!activeFiredLaser) {
        lasers.push(new Laser(this.x, this.y - 12, -7.5, '#00f5ff'));
        audio.playLaser();
      }
    }
  }

  triggerFractureSequence() {
    this.isExploding = true;
    this.respawnTimer = 75; 
    shipChunks = [];
    
    const structuralLines = [
      { x1: -12, y1: 8,  x2: 12,  y2: 8 },
      { x1: 12,  y1: 8,  x2: 12,  y2: 2 },
      { x1: 12,  y1: 2,  x2: 4,   y2: 2 },
      { x1: 4,   y1: 2,  x2: 4,   y2: -6 },
      { x1: 4,   y1: -6, x2: -4,  y2: -6 },
      { x1: -4,  y1: -6, x2: -4,  y2: 2 },
      { x1: -4,  y1: 2,  x2: -12, y2: 2 },
      { x1: -12, y1: 2,  x2: -12, y2: 8 }
    ];

    for (let line of structuralLines) {
      shipChunks.push({
        x1: this.x + line.x1, y1: this.y + line.y1,
        x2: this.x + line.x2, y2: this.y + line.y2,
        vx: (Math.random() - 0.5) * 5,
        vy: (Math.random() - 0.5) * 5 - 2,
        rot: Math.random() * 0.2 - 0.1,
        angle: 0
      });
    }
  }

  draw() {
    if (this.isExploding) return;
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.strokeStyle = '#00f5ff';
    ctx.shadowBlur = 8;
    ctx.shadowColor = '#00f5ff';
    ctx.lineWidth = 2;
    
    ctx.beginPath();
    ctx.moveTo(-12, 8); ctx.lineTo(12, 8);
    ctx.lineTo(12, 2);  ctx.lineTo(4, 2);
    ctx.lineTo(4, -6);  ctx.lineTo(-4, -6);
    ctx.lineTo(-4, 2);  ctx.lineTo(-12, 2);
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }
}

class Laser {
  constructor(x, y, vy, color) {
    this.x = x;
    this.y = y;
    this.vy = vy;
    this.color = color;
    this.w = 2;
    this.h = 10;
  }
  update() { this.y += this.vy; }
  draw() {
    ctx.save();
    ctx.fillStyle = this.color;
    ctx.shadowBlur = 6;
    ctx.shadowColor = this.color;
    ctx.fillRect(this.x - this.w/2, this.y, this.w, this.h);
    ctx.restore();
  }
}

class Invader {
  constructor(x, y, type) {
    this.x = x;
    this.y = y;
    this.w = 22;
    this.h = 22;
    this.type = type; 
  }

  draw() {
    ctx.save();
    ctx.translate(this.x, this.y);
    let color = this.type === 0 ? '#ff2d78' : this.type === 1 ? '#ffd700' : '#b06aff';
    ctx.strokeStyle = color;
    ctx.shadowBlur = 8;
    ctx.shadowColor = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();

    if (this.type === 0) {
      ctx.moveTo(-3, -12); ctx.lineTo(3, -12);
      ctx.moveTo(0, -12);  ctx.lineTo(0, -2);
      ctx.moveTo(-2, -2);  ctx.bezierCurveTo(-7, -4, -7, 4, -5, 6);
      ctx.bezierCurveTo(-8, 8, -6, 12, 0, 12);
      ctx.bezierCurveTo(6, 12, 8, 8, 5, 6);
      ctx.bezierCurveTo(7, 4, 7, -4, 2, -2);
      ctx.closePath();
    } else if (this.type === 1) {
      ctx.moveTo(-1, -12); ctx.lineTo(2, -12);
      ctx.moveTo(0, -12);  ctx.lineTo(0, -2);
      ctx.moveTo(-1, -2);  ctx.lineTo(-5, -7);
      ctx.moveTo(-3, -2);  ctx.lineTo(-4, -4);
      ctx.moveTo(-5, -7);  ctx.bezierCurveTo(-9, 0, -8, 8, -4, 11);
      ctx.lineTo(4, 11);
      ctx.bezierCurveTo(8, 8, 8, -1, 3, -5);
      ctx.lineTo(2, -2);
    } else {
      ctx.moveTo(-2, -12); ctx.lineTo(2, -12);
      ctx.moveTo(0, -12);  ctx.lineTo(0, -2);
      ctx.moveTo(0, -2);   ctx.lineTo(-9, 11);
      ctx.lineTo(-4, 11);  ctx.lineTo(0, 2);
      ctx.lineTo(4, 11);   ctx.lineTo(9, 11);
      ctx.closePath();
    }
    ctx.stroke();
    ctx.restore();
  }
}

class Barrier {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.blockSize = 4;
    this.blocks = [];
    for (let r = 0; r < 5; r++) {
      for (let c = 0; c < 10; c++) {
        if (r === 4 && (c > 2 && c < 7)) continue;
        this.blocks.push({ relX: c * this.blockSize, relY: r * this.blockSize });
      }
    }
  }

  draw() {
    ctx.save();
    ctx.fillStyle = '#99cc77';
    ctx.shadowBlur = 4;
    ctx.shadowColor = '#99cc77';
    for (let b of this.blocks) {
      ctx.fillRect(this.x + b.relX, this.y + b.relY, this.blockSize, this.blockSize);
    }
    ctx.restore();
  }

  checkCollision(laser) {
    for (let i = this.blocks.length - 1; i >= 0; i--) {
      let b = this.blocks[i];
      let bx = this.x + b.relX;
      let by = this.y + b.relY;
      if (laser.x >= bx && laser.x <= bx + this.blockSize &&
          laser.y >= by && laser.y <= by + this.blockSize) {
        this.blocks.splice(i, 1);
        return true;
      }
    }
    return false;
  }

  eatBlocksFromInvaderBounds(invX, invY, invW, invH) {
    const left = invX - invW / 2;
    const right = invX + invW / 2;
    const top = invY - invH / 2;
    const bottom = invY + invH / 2;

    for (let i = this.blocks.length - 1; i >= 0; i--) {
      let b = this.blocks[i];
      let bx = this.x + b.relX;
      let by = this.y + b.relY;

      if (bx + this.blockSize >= left && bx <= right &&
          by + this.blockSize >= top && by <= bottom) {
        this.blocks.splice(i, 1);
      }
    }
  }
}

class Particle {
  constructor(x, y, color) {
    this.x = x;
    this.y = y;
    this.vx = (Math.random() - 0.5) * 5;
    this.vy = (Math.random() - 0.5) * 5;
    this.alpha = 1.0;
    this.color = color;
  }
  update() {
    this.x += this.vx;
    this.y += this.vy;
    this.alpha -= 0.04;
  }
  draw() {
    ctx.save();
    ctx.globalAlpha = this.alpha;
    ctx.fillStyle = this.color;
    ctx.fillRect(this.x, this.y, 1.5, 1.5);
    ctx.restore();
  }
}

function initGame() {
  score = 0;
  lives = 3;
  player = new Player();
  lasers = [];
  particles = [];
  shipChunks = [];
  toneSequenceTracker = 0;
  playerStationaryFrames = 0;
  antiCampCooldown = 0;
  buildInvaderGrid();
  buildBarriers();
  updateConsoleMessage("> DISCRETE SEQUENCER LOCKED IN");
}

function buildInvaderGrid() {
  invaders = [];
  invaderDirection = 1;
  for (let r = 0; r < 5; r++) {
    let type = r === 0 ? 0 : (r < 3 ? 1 : 2);
    for (let c = 0; c < 11; c++) {
      invaders.push(new Invader(45 + c * 32, 95 + r * 28, type));
    }
  }
  calculateBPM();
}

function buildBarriers() {
  barriers = [];
  const spacing = canvas.width / 5;
  for (let i = 0; i < 4; i++) {
    barriers.push(new Barrier((spacing * (i + 1)) - 20, canvas.height - 95));
  }
}

function calculateBPM() {
  const killedFactor = (55 - invaders.length) * 2.3;
  audio.bpm = Math.min(195, 60 + killedFactor);
}

function updateConsoleMessage(txt) {
  document.getElementById('frettris-msg').innerText = txt;
}

function togglePause() {
  if (!isRunning) return;
  isPaused = !isPaused;
  if (isPaused) {
    updateConsoleMessage("// SYSTEM PAUSED");
  } else {
    updateConsoleMessage("> SEQUENCER RE-ENGAGED");
  }
}

function drawHUD() {
  ctx.save();
  ctx.font = "20px 'VT323'";
  ctx.fillStyle = '#ffd700'; 
  ctx.shadowBlur = 4;
  ctx.shadowColor = '#ffd700';
  
  ctx.textAlign = "left";
  ctx.fillText(`SCORE: ${String(score).padStart(4, '0')}`, 16, 28);
  
  ctx.textAlign = "center";
  ctx.fillText(`HI-SCORE: ${String(highScore).padStart(4, '0')}`, canvas.width / 2, 28);
  
  ctx.textAlign = "right";
  ctx.fillText(`LIVES X ${lives}`, canvas.width - 16, 28);
  ctx.restore();
}

function loop() {
  if (!isRunning) return;
  
  if (isPaused) {
    ctx.fillStyle = 'rgba(5, 5, 11, 0.05)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    ctx.save();
    ctx.font = "32px 'VT323'";
    ctx.fillStyle = '#ffd700';
    ctx.textAlign = "center";
    ctx.shadowBlur = 8;
    ctx.shadowColor = '#ffd700';
    ctx.fillText("PAUSED", canvas.width / 2, canvas.height / 2);
    ctx.restore();
    
    requestAnimationFrame(loop);
    return;
  }

  ctx.fillStyle = '#05050b';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  drawHUD();
  player.update();
  player.draw();

  for (let b of barriers) b.draw();

  if (player.isExploding) {
    for (let chunk of shipChunks) {
      chunk.x1 += chunk.vx; chunk.y1 += chunk.vy;
      chunk.x2 += chunk.vx; chunk.y2 += chunk.vy;
      chunk.angle += chunk.rot;
      
      ctx.save();
      ctx.strokeStyle = '#00f5ff';
      ctx.shadowBlur = 6;
      ctx.shadowColor = '#00f5ff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(chunk.x1, chunk.y1);
      ctx.lineTo(chunk.x2, chunk.y2);
      ctx.stroke();
      ctx.restore();
    }
  }

  // ── STEP-SEQUENCER AUDIO MATRIC TICK ─────────────────────
  invaderTickTimer += 1 / 60; 
  if (invaderTickTimer >= audio.getInterval()) {
    invaderTickTimer = 0; 
    audio.playStepTone(toneSequenceTracker);
    toneSequenceTracker++;

    let shiftDown = false;
    let stepAmountX = 12 * invaderDirection;

    for (let inv of invaders) {
      inv.x += stepAmountX;
      
      for (let b of barriers) {
        b.eatBlocksFromInvaderBounds(inv.x, inv.y, inv.w, inv.h);
      }

      if (inv.x > canvas.width - inv.w/2 || inv.x < inv.w/2) {
        shiftDown = true;
      }
    }

    if (shiftDown) {
      invaderDirection *= -1;
      for (let inv of invaders) {
        inv.x += 12 * invaderDirection; 
        inv.y += 24;                    
        if (inv.y > player.y - player.h) {
          endGame("BREACHED");
        }
      }
    }
  }

  // Laser Collisions
  for (let i = lasers.length - 1; i >= 0; i--) {
    let l = lasers[i];
    l.update();
    l.draw();

    if (l.y < 40 || l.y > canvas.height) { 
      lasers.splice(i, 1);
      continue;
    }

    let hitBarrier = false;
    for (let b of barriers) {
      if (b.checkCollision(l)) {
        lasers.splice(i, 1);
        hitBarrier = true;
        break;
      }
    }
    if (hitBarrier) continue;

    if (l.vy < 0) {
      for (let j = invaders.length - 1; j >= 0; j--) {
        let inv = invaders[j];
        if (l.x > inv.x - inv.w/2 && l.x < inv.x + inv.w/2 &&
            l.y > inv.y - inv.h/2 && l.y < inv.y + inv.h/2) {
          
          let color = inv.type === 0 ? '#ff2d78' : inv.type === 1 ? '#ffd700' : '#b06aff';
          audio.playExplosion();
          for(let p=0; p<14; p++) particles.push(new Particle(inv.x, inv.y, color));
          
          score += (3 - inv.type) * 10;
          if (score > highScore) {
            highScore = score;
            localStorage.setItem('invaders_hi_score', highScore);
          }

          invaders.splice(j, 1);
          lasers.splice(i, 1);
          calculateBPM();
          break;
        }
      }
    } else {
      if (!player.isExploding && 
          l.x > player.x - player.w/2 && l.x < player.x + player.w/2 &&
          l.y > player.y - player.h/2 && l.y < player.y + player.h/2) {
        
        audio.playExplosion();
        player.triggerFractureSequence();
        lasers.splice(i, 1);
        lives--;
        updateConsoleMessage(`> IMPACT DETECTED // LIFE LOST`);
        break;
      }
    }
  }

  for (let inv of invaders) inv.draw();

  // ── FIXED: CALIBRATED ANTI-CAMPING CHOKE LOOP ───────────────
  if (antiCampCooldown > 0) antiCampCooldown--;

  if (!player.isExploding && invaders.length > 0) {
    let fireChance = 0.006 + (55 - invaders.length) * 0.0003;
    let selectedInvader = null;

    // Pinpoint static positions fairly, dropping a targeted bolt instead of a flat wall
    if (playerStationaryFrames > 50 && antiCampCooldown === 0 && Math.random() < 0.15) {
      let alignedInvaders = invaders.filter(inv => Math.abs(inv.x - player.x) < 26);
      if (alignedInvaders.length > 0) {
        selectedInvader = alignedInvaders.reduce((lowest, curr) => curr.y > lowest.y ? curr : lowest, alignedInvaders[0]);
        antiCampCooldown = 70; // Lock structural re-fire out for ~1.15 seconds
      }
    }

    // Classic random rhythm matrix fallback
    if (!selectedInvader && Math.random() < fireChance) {
      selectedInvader = invaders[Math.floor(Math.random() * invaders.length)];
    }

    if (selectedInvader) {
      let color = selectedInvader.type === 0 ? '#ff2d78' : selectedInvader.type === 1 ? '#ffd700' : '#b06aff';
      lasers.push(new Laser(selectedInvader.x, selectedInvader.y + selectedInvader.h/2, 3.8, color));
    }
  }

  if (invaders.length === 0) {
    buildInvaderGrid();
    updateConsoleMessage(`> RE-RACKING SEQUENCE ENGAGED`);
  }

  for (let i = particles.length - 1; i >= 0; i--) {
    particles[i].update();
    particles[i].draw();
    if (particles[i].alpha <= 0) particles.splice(i, 1);
  }

  requestAnimationFrame(loop);
}

function endGame(reasonText) {
  isRunning = false;
  ctx.fillStyle = 'rgba(5, 5, 11, 0.92)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  
  ctx.font = "36px 'VT323'";
  ctx.fillStyle = '#ff2d78';
  ctx.textAlign = "center";
  ctx.shadowBlur = 10;
  ctx.shadowColor = '#ff2d78';
  ctx.fillText(reasonText, canvas.width / 2, canvas.height / 2);
  
  updateConsoleMessage(`> CORE TERMINATED // INJECT COIN`);
  document.getElementById('start-btn').disabled = false;
  document.getElementById('start-btn').innerText = "Try Again";
}

// System Event Bindings
window.addEventListener('keydown', e => {
  if (['ArrowLeft', 'ArrowRight', ' '].includes(e.key)) e.preventDefault();
  if (e.key.toLowerCase() === 'p') {
    e.preventDefault();
    togglePause();
  }
  keys[e.key] = true;
});
window.addEventListener('keyup', e => { keys[e.key] = false; });

const mapTouch = (elementId, targetKey) => {
  const el = document.getElementById(elementId);
  if (!el) return;
  el.addEventListener('touchstart', (e) => { e.preventDefault(); keys[targetKey] = true; }, {passive: false});
  el.addEventListener('touchend', (e) => { e.preventDefault(); keys[targetKey] = false; }, {passive: false});
};
mapTouch('touch-left', 'ArrowLeft');
mapTouch('touch-right', 'ArrowRight');
mapTouch('touch-shoot', ' ');

document.getElementById('audio-toggle-btn').addEventListener('click', (e) => {
  const btn = e.currentTarget;
  audio.isMuted = !audio.isMuted;
  if (audio.isMuted) {
    btn.classList.add('is-muted');
  } else {
    btn.classList.remove('is-muted');
    audio.init();
  }
});

document.getElementById('start-btn').addEventListener('click', (e) => {
  e.currentTarget.disabled = true;
  isRunning = true;
  isPaused = false;
  initGame();
  audio.init();
  loop();
});
