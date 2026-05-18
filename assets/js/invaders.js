/**
 * AUDIO ENGINE: Generative Synth & Sequencer (Web Audio API)
 */
class AudioEngine {
  constructor() {
    this.ctx = null;
    this.isMuted = true;
    this.sequence = [110.00, 130.81, 146.83, 164.81]; // A2, C3, D3, E3 minor shift
    this.seqIndex = 0;
    this.nextNoteTime = 0.0;
    this.bpm = 60; // Slower starting tempo
    this.isPlaying = false;
    this.timerId = null;
  }

  init() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
  }

  startSequence() {
    if (this.isMuted || this.isPlaying) return;
    this.init();
    this.isPlaying = true;
    this.nextNoteTime = this.ctx.currentTime;
    this.scheduler();
  }

  stopSequence() {
    this.isPlaying = false;
    clearTimeout(this.timerId);
  }

  setBPM(count, lowestY) {
    // Pacing logic: starts slower, scales smoothly based on count and vertical distress
    const countFactor = (55 - count) * 2.2;
    const heightFactor = Math.max(0, (lowestY - 65) * 0.3);
    this.bpm = Math.min(190, 65 + countFactor + heightFactor); // Capped safe ceiling
  }

  scheduler() {
    if (!this.isPlaying) return;
    while (this.nextNoteTime < this.ctx.currentTime + 0.1) {
      this.scheduleNote(this.seqIndex, this.nextNoteTime);
      this.advanceNote();
    }
    this.timerId = setTimeout(() => this.scheduler(), 25);
  }

  advanceNote() {
    const secondsPerBeat = 60.0 / this.bpm;
    this.nextNoteTime += 0.25 * secondsPerBeat;
    this.seqIndex = (this.seqIndex + 1) % this.sequence.length;
  }

  scheduleNote(index, time) {
    if (this.isMuted || !this.ctx) return;

    let osc = this.ctx.createOscillator();
    let gain = this.ctx.createGain();
    let filter = this.ctx.createBiquadFilter();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(this.sequence[index], time);

    const peakCutoff = Math.min(2000, 500 + (this.bpm * 4));
    filter.type = 'lowpass';
    filter.Q.setValueAtTime(4, time);
    filter.frequency.setValueAtTime(peakCutoff, time);
    filter.frequency.exponentialRampToValueAtTime(120, time + 0.2);

    gain.gain.setValueAtTime(0.12, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.2);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(time);
    osc.stop(time + 0.22);
  }

  playLaser() {
    if (this.isMuted || !this.ctx) return;
    let osc = this.ctx.createOscillator();
    let gain = this.ctx.createGain();
    
    osc.type = 'square'; // Chiptune vintage pop
    osc.frequency.setValueAtTime(600, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(150, this.ctx.currentTime + 0.08);

    gain.gain.setValueAtTime(0.08, this.ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.001, this.ctx.currentTime + 0.08);

    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start();
    osc.stop(this.ctx.currentTime + 0.09);
  }

  playExplosion() {
    if (this.isMuted || !this.ctx) return;
    const bufferSize = this.ctx.sampleRate * 0.2;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    let noise = this.ctx.createBufferSource();
    noise.buffer = buffer;

    let filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(350, this.ctx.currentTime);

    let gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.2, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.19);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.ctx.destination);

    noise.start();
    noise.stop(this.ctx.currentTime + 0.2);
  }
}

/**
 * GAME ENGINE CONFIGURATION
 */
const canvas = document.getElementById('frettris-canvas');
const ctx = canvas.getContext('2d');
const audio = new AudioEngine();

let score = 0;
let highScore = parseInt(localStorage.getItem('invaders_hi_score')) || 0;
let lives = 3;
let isRunning = false;
let keys = {};

let player, lasers, invaders, particles, barriers;
let invaderDirection = 1;

class Player {
  constructor() {
    this.w = 26;
    this.h = 16;
    this.x = canvas.width / 2;
    this.y = canvas.height - 40;
    this.speed = 3.8;
  }

  update() {
    if (keys['ArrowLeft'] || keys['Left']) this.x = Math.max(this.w, this.x - this.speed);
    if (keys['ArrowRight'] || keys['Right']) this.x = Math.min(canvas.width - this.w, this.x + this.speed);
    
    // ONE BULLET LIMITATION RULE
    if (keys[' ']) {
      const hasPlayerLaser = lasers.some(l => l.vy < 0);
      if (!hasPlayerLaser) {
        lasers.push(new Laser(this.x, this.y - 10, -6, '#00f5ff'));
        audio.playLaser();
      }
    }
  }

  draw() {
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.strokeStyle = '#00f5ff';
    ctx.shadowBlur = 8;
    ctx.shadowColor = '#00f5ff';
    ctx.lineWidth = 2;
    
    // Clean arcade turret line outline
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
    this.w = 2.5;
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
    this.w = 24;
    this.h = 24;
    this.type = type; // 0: Hofner, 1: Strat, 2: Flying V
  }

  update(dx, dy) {
    this.x += dx;
    this.y += dy;
  }

  draw() {
    ctx.save();
    ctx.translate(this.x, this.y);
    let color = this.type === 0 ? '#ff2d78' : this.type === 1 ? '#ffd44f' : '#00ff41';
    ctx.strokeStyle = color;
    ctx.shadowBlur = 8;
    ctx.shadowColor = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();

    if (this.type === 0) {
      // Hofner Violin Bass
      ctx.moveTo(-4, -12); ctx.lineTo(4, -12); // Headstock
      ctx.moveTo(0, -12);  ctx.lineTo(0, -2);   // Neck
      // Violin Body Outlines
      ctx.moveTo(-2, -2);  ctx.bezierCurveTo(-7, -4, -7, 4, -5, 6);
      ctx.bezierCurveTo(-8, 8, -6, 12, 0, 12);
      ctx.bezierCurveTo(6, 12, 8, 8, 5, 6);
      ctx.bezierCurveTo(7, 4, 7, -4, 2, -2);
      ctx.closePath();
    } else if (this.type === 1) {
      // Stratocaster Double Cutaway
      ctx.moveTo(-1, -12); ctx.lineTo(1, -12);  // Headstock
      ctx.moveTo(0, -12);  ctx.lineTo(0, -2);   // Neck
      // Contoured Horns Body
      ctx.moveTo(-1, -2);  ctx.lineTo(-5, -6);  // Top left horn
      ctx.moveTo(-3, -2);  ctx.lineTo(-4, -4);  // Right horn definition
      ctx.moveTo(-5, -6);  ctx.bezierCurveTo(-9, 0, -8, 8, -4, 10);
      ctx.lineTo(4, 10);
      ctx.bezierCurveTo(8, 8, 8, 0, 3, -4);
      ctx.lineTo(2, -2);
    } else {
      // Symmetrical Flying V
      ctx.moveTo(-2, -12); ctx.lineTo(2, -12); // Pointy headstock
      ctx.moveTo(0, -12);  ctx.lineTo(0, -2);   // Neck
      // Sharp Body V geometric split
      ctx.moveTo(0, -2);   ctx.lineTo(-8, 10);
      ctx.lineTo(-4, 10);  ctx.lineTo(0, 2);
      ctx.lineTo(4, 10);   ctx.lineTo(8, 10);
      ctx.closePath();
    }
    
    ctx.stroke();
    ctx.restore();
  }
}

// Vector blocks structural shields components
class Barrier {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.rows = 5;
    this.cols = 9;
    this.blockSize = 4;
    this.blocks = [];
    
    // Generate standard classical arch layout matrices
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        if (r === 4 && (c > 2 && c < 6)) continue; // Bottom cut-out archway
        this.blocks.push({
          relX: c * this.blockSize,
          relY: r * this.blockSize
        });
      }
    }
  }

  draw() {
    ctx.save();
    ctx.fillStyle = '#cca239';
    ctx.shadowBlur = 4;
    ctx.shadowColor = '#cca239';
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
        this.blocks.splice(i, 1); // Disintegrate block
        return true;
      }
    }
    return false;
  }
}

class Particle {
  constructor(x, y, color) {
    this.x = x;
    this.y = y;
    this.vx = (Math.random() - 0.5) * 4;
    this.vy = (Math.random() - 0.5) * 4;
    this.alpha = 1.0;
    this.color = color;
  }
  update() {
    this.x += this.vx;
    this.y += this.vy;
    this.alpha -= 0.05;
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
  buildInvaderGrid();
  buildBarriers();
}

function buildInvaderGrid() {
  invaders = [];
  invaderDirection = 1;
  const rows = 5;
  const cols = 11;
  for (let r = 0; r < rows; r++) {
    let type = r === 0 ? 0 : (r < 3 ? 1 : 2); // 0: Hofner, 1: Strat, 2: Flying V
    for (let c = 0; c < cols; c++) {
      let x = 45 + c * 32;
      let y = 95 + r * 28; // Lower starting baseline to frame HUD clear
      invaders.push(new Invader(x, y, type));
    }
  }
  audio.setBPM(invaders.length, 95);
}

function buildBarriers() {
  barriers = [];
  const totalBunkers = 4;
  const spacing = canvas.width / (totalBunkers + 1);
  for (let i = 0; i < totalBunkers; i++) {
    barriers.push(new Barrier((spacing * (i + 1)) - 18, canvas.height - 90));
  }
}

function drawHUD() {
  ctx.save();
  ctx.font = "20px 'VT323'";
  ctx.fillStyle = '#cca239';
  ctx.textAlign = "left";
  
  // Render clean text UI directly onto canvas plane
  ctx.fillText(`SCORE: ${String(score).padStart(4, '0')}`, 20, 32);
  ctx.textAlign = "center";
  ctx.fillText(`BEST: ${String(highScore).padStart(4, '0')}`, canvas.width / 2, 32);
  
  ctx.textAlign = "right";
  ctx.fillText("LIVES: ", canvas.width - 65, 32);
  
  // Render Lives Vector Ships inline at top right corner
  for (let i = 0; i < lives; i++) {
    ctx.strokeStyle = '#00f5ff';
    ctx.lineWidth = 1.5;
    ctx.save();
    ctx.translate((canvas.width - 50) + (i * 15), 24);
    ctx.beginPath();
    ctx.moveTo(-5, 4); ctx.lineTo(5, 4); ctx.lineTo(5, 1); ctx.lineTo(1, 1);
    ctx.lineTo(1, -3); ctx.lineTo(-1, -3); ctx.lineTo(-1, 1); ctx.lineTo(-5, 1);
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
}

function loop() {
  if (!isRunning) return;

  // Render Pitch Black Void Background
  ctx.fillStyle = '#05050b';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  drawHUD();
  player.update();
  player.draw();

  // Draw Barriers
  for (let b of barriers) b.draw();

  // Get lowest invader coordinate height check context
  let lowestY = 0;
  for (let inv of invaders) {
    if (inv.y > lowestY) lowestY = inv.y;
  }

  // Projectile Loops
  for (let i = lasers.length - 1; i >= 0; i--) {
    let l = lasers[i];
    l.update();
    l.draw();

    if (l.y < 45 || l.y > canvas.height) { // Safe boundaries protection layout
      lasers.splice(i, 1);
      continue;
    }

    // Barrier damage testing
    let destroyedByBarrier = false;
    for (let b of barriers) {
      if (b.checkCollision(l)) {
        lasers.splice(i, 1);
        destroyedByBarrier = true;
        break;
      }
    }
    if (destroyedByBarrier) continue;

    // Laser hit intersections targets testing
    if (l.vy < 0) {
      for (let j = invaders.length - 1; j >= 0; j--) {
        let inv = invaders[j];
        if (l.x > inv.x - inv.w/2 && l.x < inv.x + inv.w/2 &&
            l.y > inv.y - inv.h/2 && l.y < inv.y + inv.h/2) {
          
          let color = inv.type === 0 ? '#ff2d78' : inv.type === 1 ? '#ffd44f' : '#00ff41';
          audio.playExplosion();
          for(let p=0; p<10; p++) particles.push(new Particle(inv.x, inv.y, color));
          
          score += (3 - inv.type) * 10;
          if (score > highScore) {
            highScore = score;
            localStorage.setItem('invaders_hi_score', highScore);
          }

          invaders.splice(j, 1);
          lasers.splice(i, 1);
          audio.setBPM(invaders.length, lowestY);
          break;
        }
      }
    } else {
      if (l.x > player.x - player.w/2 && l.x < player.x + player.w/2 &&
          l.y > player.y - player.h/2 && l.y < player.y + player.h/2) {
        
        audio.playExplosion();
        for(let p=0; p<10; p++) particles.push(new Particle(player.x, player.y, '#00f5ff'));
        lasers.splice(i, 1);
        lives--;
        
        if (lives <= 0) {
          gameOver("GAME OVER");
        }
        break;
      }
    }
  }

  // Grid Motion Engine logic updates
  let shiftDown = false;
  // Non-linear adaptive pacing scale calculation curves
  let speedX = (0.35 + (55 - invaders.length) * 0.032) * invaderDirection;

  for (let inv of invaders) {
    inv.update(speedX, 0);
    if (inv.x > canvas.width - inv.w/2 || inv.x < inv.w/2) {
      shiftDown = true;
    }
  }

  if (shiftDown) {
    invaderDirection *= -1;
    for (let inv of invaders) {
      inv.update(0, 10);
      if (inv.y > player.y - player.h) {
        gameOver("BREACHED");
      }
    }
    audio.setBPM(invaders.length, lowestY);
  }

  for (let inv of invaders) inv.draw();

  // Safe tuned return target calculations rate of fire parameters
  if (invaders.length > 0 && Math.random() < 0.008 + (55 - invaders.length) * 0.0003) {
    let randomInv = invaders[Math.floor(Math.random() * invaders.length)];
    let color = randomInv.type === 0 ? '#ff2d78' : randomInv.type === 1 ? '#ffd44f' : '#00ff41';
    lasers.push(new Laser(randomInv.x, randomInv.y + randomInv.h/2, 3.2, color));
  }

  if (invaders.length === 0) {
    buildInvaderGrid();
  }

  for (let i = particles.length - 1; i >= 0; i--) {
    particles[i].update();
    particles[i].draw();
    if (particles[i].alpha <= 0) particles.splice(i, 1);
  }

  requestAnimationFrame(loop);
}

function gameOver(reasonText) {
  isRunning = false;
  audio.stopSequence();
  ctx.fillStyle = 'rgba(5, 5, 11, 0.85)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  
  ctx.font = "36px 'VT323'";
  ctx.fillStyle = '#ff2d78';
  ctx.textAlign = "center";
  ctx.shadowBlur = 10;
  ctx.shadowColor = '#ff2d78';
  ctx.fillText(reasonText, canvas.width / 2, canvas.height / 2);
  
  document.getElementById('start-btn').disabled = false;
  document.getElementById('start-btn').innerText = "Try Again";
}

// Global System Input Listeners
window.addEventListener('keydown', e => {
  if (['ArrowLeft', 'ArrowRight', ' '].includes(e.key)) e.preventDefault();
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
    audio.stopSequence();
  } else {
    btn.classList.remove('is-muted');
    audio.init();
    if (isRunning) audio.startSequence();
  }
});

document.getElementById('start-btn').addEventListener('click', (e) => {
  e.currentTarget.disabled = true;
  isRunning = true;
  initGame();
  audio.startSequence();
  loop();
});
