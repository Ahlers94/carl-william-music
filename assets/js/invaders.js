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
    this.bpm = 100;
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

  setBPM(count) {
    this.bpm = Math.min(260, 100 + (55 - count) * 3);
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

    const peakCutoff = Math.min(2200, 600 + (this.bpm * 4));
    filter.type = 'lowpass';
    filter.Q.setValueAtTime(4, time);
    filter.frequency.setValueAtTime(peakCutoff, time);
    filter.frequency.exponentialRampToValueAtTime(150, time + 0.18);

    gain.gain.setValueAtTime(0.12, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.18);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(time);
    osc.stop(time + 0.2);
  }

  playLaser() {
    if (this.isMuted || !this.ctx) return;
    let osc = this.ctx.createOscillator();
    let gain = this.ctx.createGain();
    
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(880, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(110, this.ctx.currentTime + 0.12);

    gain.gain.setValueAtTime(0.15, this.ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.001, this.ctx.currentTime + 0.12);

    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start();
    osc.stop(this.ctx.currentTime + 0.13);
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
    filter.frequency.setValueAtTime(400, this.ctx.currentTime);

    let gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.25, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.24);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.ctx.destination);

    noise.start();
    noise.stop(this.ctx.currentTime + 0.25);
  }
}

/**
 * CORE MODULE CONFIGURATION
 */
const canvas = document.getElementById('frettris-canvas');
const ctx = canvas.getContext('2d');
const audio = new AudioEngine();

let score = 0;
let highScore = parseInt(localStorage.getItem('invaders_hi_score')) || 0;
let lives = 3;
let isRunning = false;
let keys = {};

let player, lasers, invaders, particles;
let invaderDirection = 1;
let invaderSpeedYFactor = 0;

const shipPath = [
  {x: 0, y: -10}, {x: 8, y: 4}, {x: 4, y: 4}, 
  {x: 4, y: 10}, {x: -4, y: 10}, {x: -4, y: 4}, {x: -8, y: 4}
];

class Player {
  constructor() {
    this.w = 24;
    this.h = 20;
    this.x = canvas.width / 2;
    this.y = canvas.height - 30;
    this.speed = 4.5;
    this.cooldown = 0;
  }

  update() {
    if (keys['ArrowLeft'] || keys['Left']) this.x = Math.max(this.w, this.x - this.speed);
    if (keys['ArrowRight'] || keys['Right']) this.x = Math.min(canvas.width - this.w, this.x + this.speed);
    if ((keys[' '] || keys['Shoot']) && this.cooldown <= 0) {
      lasers.push(new Laser(this.x, this.y - 12, -7, '#00f5ff'));
      audio.playLaser();
      this.cooldown = 22;
    }
    if (this.cooldown > 0) this.cooldown--;
  }

  draw() {
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.strokeStyle = '#00f5ff';
    ctx.shadowBlur = 10;
    ctx.shadowColor = '#00f5ff';
    ctx.lineWidth = 2;
    ctx.fillStyle = '#05050b';
    
    ctx.beginPath();
    ctx.moveTo(shipPath[0].x, shipPath[0].y);
    for(let i=1; i<shipPath.length; i++) ctx.lineTo(shipPath[i].x, shipPath[i].y);
    ctx.closePath();
    ctx.fill();
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
    this.w = 3;
    this.h = 10;
  }
  update() { this.y += this.vy; }
  draw() {
    ctx.save();
    ctx.fillStyle = this.color;
    ctx.shadowBlur = 8;
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
    this.h = 18;
    this.type = type;
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
    
    ctx.strokeRect(-this.w/2, -this.h/2, this.w, this.h);
    ctx.beginPath();
    if(this.type === 0) {
      ctx.moveTo(-4, 0); ctx.lineTo(4, 0); ctx.moveTo(0, -4); ctx.lineTo(0, 4);
    } else if (this.type === 1) {
      ctx.moveTo(0, -5); ctx.lineTo(5, 0); ctx.lineTo(0, 5); ctx.lineTo(-5, 0);
    } else {
      ctx.moveTo(-6, -2); ctx.lineTo(6, 2);
    }
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
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
    ctx.shadowBlur = 5;
    ctx.shadowColor = this.color;
    ctx.fillRect(this.x, this.y, 2, 2);
    ctx.restore();
  }
}

function initGame() {
  score = 0;
  lives = 3;
  invaderSpeedYFactor = 0;
  document.getElementById('score-val').innerText = '0000';
  document.getElementById('hi-score-val').innerText = String(highScore).padStart(4, '0');
  
  player = new Player();
  lasers = [];
  particles = [];
  buildInvaderGrid();
  updateLivesDisplay();
}

function buildInvaderGrid() {
  invaders = [];
  invaderDirection = 1;
  const rows = 5;
  const cols = 11;
  for (let r = 0; r < rows; r++) {
    let type = r === 0 ? 0 : (r < 3 ? 1 : 2);
    for (let c = 0; c < cols; c++) {
      let x = 45 + c * 32;
      let y = 65 + r * 28;
      invaders.push(new Invader(x, y, type));
    }
  }
  audio.setBPM(invaders.length);
}

function updateLivesDisplay() {
  const container = document.getElementById('lives-container');
  container.innerHTML = '';
  for(let i=0; i<lives; i++) {
    container.innerHTML += `
      <svg width="14" height="14" viewBox="-10 -10 20 20" style="color: #00f5ff; filter: drop-shadow(0 0 3px #00f5ff88)">
        <path d="M0 -10 L8 4 L4 4 L4 10 L-4 10 L-4 4 L-8 4 Z" fill="none" stroke="currentColor" stroke-width="2"/>
      </svg>
    `;
  }
}

function triggerExplosion(x, y, color) {
  audio.playExplosion();
  for(let i=0; i<12; i++) particles.push(new Particle(x, y, color));
}

function loop() {
  if (!isRunning) return;

  ctx.fillStyle = 'rgba(5, 5, 11, 0.3)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  player.update();
  player.draw();

  for (let i = lasers.length - 1; i >= 0; i--) {
    let l = lasers[i];
    l.update();
    l.draw();

    if (l.y < 0 || l.y > canvas.height) {
      lasers.splice(i, 1);
      continue;
    }

    if (l.vy < 0) {
      for (let j = invaders.length - 1; j >= 0; j--) {
        let inv = invaders[j];
        if (l.x > inv.x - inv.w/2 && l.x < inv.x + inv.w/2 &&
            l.y > inv.y - inv.h/2 && l.y < inv.y + inv.h/2) {
          
          let color = inv.type === 0 ? '#ff2d78' : inv.type === 1 ? '#ffd44f' : '#00ff41';
          triggerExplosion(inv.x, inv.y, color);
          
          score += (3 - inv.type) * 10;
          document.getElementById('score-val').innerText = String(score).padStart(4, '0');
          if(score > highScore) {
            highScore = score;
            localStorage.setItem('invaders_hi_score', highScore);
            document.getElementById('hi-score-val').innerText = String(highScore).padStart(4, '0');
          }

          invaders.splice(j, 1);
          lasers.splice(i, 1);
          audio.setBPM(invaders.length);
          break;
        }
      }
    } else {
      if (l.x > player.x - player.w/2 && l.x < player.x + player.w/2 &&
          l.y > player.y - player.h/2 && l.y < player.y + player.h/2) {
        
        triggerExplosion(player.x, player.y, '#00f5ff');
        lasers.splice(i, 1);
        lives--;
        updateLivesDisplay();
        
        if(lives <= 0) {
          gameOver("GAME OVER");
        }
        break;
      }
    }
  }

  let shiftDown = false;
  let currentSpeedX = (0.6 + (55 - invaders.length) * 0.04) * invaderDirection;

  for (let inv of invaders) {
    inv.update(currentSpeedX, 0);
    if (inv.x > canvas.width - inv.w/2 || inv.x < inv.w/2) {
      shiftDown = true;
    }
  }

  if (shiftDown) {
    invaderDirection *= -1;
    let stepY = 12 + invaderSpeedYFactor;
    for (let inv of invaders) {
      inv.update(0, stepY);
      if(inv.y > player.y - player.h) {
        gameOver("BREACHED");
      }
    }
  }

  for (let inv of invaders) {
    inv.draw();
  }

  if (invaders.length > 0 && Math.random() < 0.015 + (55 - invaders.length)*0.0005) {
    let randomInv = invaders[Math.floor(Math.random() * invaders.length)];
    let color = randomInv.type === 0 ? '#ff2d78' : randomInv.type === 1 ? '#ffd44f' : '#00ff41';
    lasers.push(new Laser(randomInv.x, randomInv.y + randomInv.h/2, 4, color));
  }

  if(invaders.length === 0) {
    invaderSpeedYFactor += 3;
    buildInvaderGrid();
  }

  for (let i = particles.length - 1; i >= 0; i--) {
    particles[i].update();
    particles[i].draw();
    if(particles[i].alpha <= 0) particles.splice(i, 1);
  }

  requestAnimationFrame(loop);
}

function gameOver(reasonText) {
  isRunning = false;
  audio.stopSequence();
  ctx.fillStyle = 'rgba(5, 5, 11, 0.8)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  
  ctx.font = "34px 'VT323'";
  ctx.fillStyle = '#ff2d78';
  ctx.textAlign = "center";
  ctx.shadowBlur = 15;
  ctx.shadowColor = '#ff2d78';
  ctx.fillText(reasonText, canvas.width / 2, canvas.height / 2 - 10);
  
  document.getElementById('start-btn').disabled = false;
  document.getElementById('start-btn').innerText = "Try Again";
}

// System Input Bindings
window.addEventListener('keydown', e => {
  if(['ArrowLeft', 'ArrowRight', ' '].includes(e.key)) e.preventDefault();
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
  
  if(audio.isMuted) {
    btn.classList.add('is-muted');
    audio.stopSequence();
  } else {
    btn.classList.remove('is-muted');
    audio.init();
    if(isRunning) audio.startSequence();
  }
});

document.getElementById('start-btn').addEventListener('click', (e) => {
  e.currentTarget.disabled = true;
  isRunning = true;
  initGame();
  audio.startSequence();
  loop();
});
