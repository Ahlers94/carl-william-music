/* /assets/js/mpc.js */
// Built using strict ES5 paradigms for legacy browser rendering safety

var BrowserDAW = {
  // ── ENGINE STATES ─────────────────────────────────────────
  audioCtx: null,
  isPlaying: false,
  currentStep: 0,
  tempo: 120,
  nextNoteTime: 0.0,
  lookahead: 25.0,      // How frequently to call scheduler (in milliseconds)
  scheduleAheadTime: 0.1, // How far ahead to schedule audio (in seconds)
  timerId: null,        // Standard setInterval fallback for legacy thread safety
  
  // ── DATA TRACKING ─────────────────────────────────────────
  activeVoices: {},    // Tracks playing notes: { noteNumber: [{ source, gain }] }
  sampleCache: {},     // AudioBuffer storage matching MIDI note keys
  sequenceGrid: null,  // 16-step grid tracking array data

  // ── CORE INITIALIZATION ───────────────────────────────────
  init: function() {
    var self = this;
    this.initSequenceGrid();
    this.bindTransportControls();
    this.bindPhysicalPads();

    // Unlock AudioContext safely across modern & vintage WebKit variants
    document.body.addEventListener('click', function() {
      self.unlockAudioContext();
    }, { once: true });
    
    document.body.addEventListener('touchstart', function() {
      self.unlockAudioContext();
    }, { once: true });
  },

  unlockAudioContext: function() {
    if (!this.audioCtx) {
      var AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) {
        this.audioCtx = new AudioContextClass();
      }
    }
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }
  },

  initSequenceGrid: function() {
    this.sequenceGrid = [];
    for (var i = 0; i < 16; i++) {
      this.sequenceGrid.push([]);
    }
    // Pre-load an iconic 4-on-the-floor test grid (Note 36 = Kick Drum)
    this.sequenceGrid[0].push(36);
    this.sequenceGrid[4].push(36);
    this.sequenceGrid[8].push(36);
    this.sequenceGrid[12].push(36);
  },

  // ── AUDIO ROUTING & GENERATION ────────────────────────────
  getBuffer: function(note) {
    if (this.sampleCache[note]) {
      return this.sampleCache[note];
    }
    return this.createClickTrackBuffer();
  },

  createClickTrackBuffer: function() {
    if (!this.audioCtx) return null;
    var rate = this.audioCtx.sampleRate;
    var buffer = this.audioCtx.createBuffer(1, rate * 0.05, rate);
    var data = buffer.getChannelData(0);
    for (var i = 0; i < data.length; i++) {
      data[i] = Math.sin(i * 0.08) * Math.exp(-i * 0.005);
    }
    return buffer;
  },

  // ── UNIFIED VOICE GENERATION PIPELINE ─────────────────────
  createVoiceNode: function(note, time, volume) {
    this.handleChoke(note); // Clear out existing voices on this pad first

    var source = this.audioCtx.createBufferSource();
    var voiceGain = this.audioCtx.createGain();
    
    source.buffer = this.getBuffer(note);
    voiceGain.gain.setValueAtTime(volume, time);
    
    source.connect(voiceGain);
    voiceGain.connect(this.audioCtx.destination);
    source.start(time);

    // Track active voices via an array stack to allow polyphonic overlapping
    if (!this.activeVoices[note]) {
      this.activeVoices[note] = [];
    }
    this.activeVoices[note].push({ source: source, gain: voiceGain });
  },

  handleChoke: function(note) {
    // Basic exclusive group emulation: Stop previous voice tail instantly 
    // to keep rapid rolls or sequence step triggers from bleeding out
    if (this.activeVoices[note] && this.activeVoices[note].length > 0) {
      while (this.activeVoices[note].length > 0) {
        var voice = this.activeVoices[note].shift();
        try {
          voice.source.stop(this.audioCtx.currentTime);
        } catch (e) {}
      }
    }
  },

  // ── TRIGGER & VOICING PARADIGMS ───────────────────────────
  triggerPad: function(note, velocity) {
    this.unlockAudioContext();
    if (!this.audioCtx) return;

    var targetVolume = velocity / 127;
    this.createVoiceNode(note, this.audioCtx.currentTime, targetVolume);
    this.visualizePad(note, true);
  },

  stopPad: function(note) {
    if (this.activeVoices[note] && this.activeVoices[note].length > 0) {
      while (this.activeVoices[note].length > 0) {
        var voice = this.activeVoices[note].shift();
        try {
          // Smoothly ramp down the gain envelope to handle clean tail fades without popping
          voice.gain.gain.setValueAtTime(voice.gain.gain.value, this.audioCtx.currentTime);
          voice.gain.gain.linearRampToValueAtTime(0.0, this.audioCtx.currentTime + 0.005);
          
          // Hard kill the source oscillator right after the fade clears
          voice.source.stop(this.audioCtx.currentTime + 0.006);
        } catch (e) {}
      }
    }
    this.visualizePad(note, false);
  },

  // ── HIGH-PRECISION SCHEDULER LOOP ─────────────────────────
  scheduler: function() {
    while (this.nextNoteTime < this.audioCtx.currentTime + this.scheduleAheadTime) {
      this.schedulePatternStep(this.currentStep, this.nextNoteTime);
      this.advanceStep();
    }
  },

  advanceStep: function() {
    var secondsPerBeat = 60.0 / this.tempo;
    // Advance internal timeline clock exactly by a 16th note parameter
    this.nextNoteTime += 0.25 * secondsPerBeat; 
    
    this.currentStep++;
    if (this.currentStep === 16) {
      this.currentStep = 0;
    }
  },

  schedulePatternStep: function(stepNumber, time) {
    var self = this;
    var notes = this.sequenceGrid[stepNumber];
    
    for (var i = 0; i < notes.length; i++) {
      var note = notes[i];
      // Fire through the exact same unified creation pipeline as raw manual taps
      this.createVoiceNode(note, time, 1.0);
    }

    // Defer visual interface updates gracefully away from the audio thread
    var delayMs = Math.max(0, (time - this.audioCtx.currentTime) * 1000);
    setTimeout(function() {
      self.drawStepProgress(stepNumber);
      for (var j = 0; j < notes.length; j++) {
        (function(n) {
          self.visualizePad(n, true);
          setTimeout(function() { self.visualizePad(n, false); }, 100);
        })(notes[j]);
      }
    }, delayMs);
  },

  // ── UI & HARDWARE BINDINGS ────────────────────────────────
  visualizePad: function(note, isActive) {
    var padElement = document.querySelector('.mpc-pad[data-note="' + note + '"]');
    if (!padElement) return;
    if (isActive) {
      padElement.classList.add('active');
    } else {
      padElement.classList.remove('active');
    }
  },

  drawStepProgress: function(stepNumber) {
    var canvas = document.getElementById('step-progress');
    if (!canvas) return;
    var ctx = canvas.getContext('2d');
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    var segmentWidth = canvas.width / 16;
    
    // Legacy-safe solid color drawing declarations
    ctx.fillStyle = 'rgba(0, 245, 255, 0.2)';
    ctx.fillRect(0, 0, segmentWidth * (stepNumber + 1), canvas.height);
    
    ctx.fillStyle = '#00f5ff';
    ctx.fillRect(segmentWidth * stepNumber, 0, segmentWidth, canvas.height);
  },

  bindTransportControls: function() {
    var self = this;
    var playBtn = document.getElementById('btn-play');
    var stopBtn = document.getElementById('btn-stop');

    if (playBtn) {
      playBtn.addEventListener('click', function() {
        self.unlockAudioContext();
        if (!self.isPlaying && self.audioCtx) {
          self.isPlaying = true;
          self.currentStep = 0;
          self.nextNoteTime = self.audioCtx.currentTime + 0.05;
          
          // Legacy-safe interval loop execution
          self.timerId = setInterval(function() {
            self.scheduler();
          }, self.lookahead);
        }
      });
    }

    if (stopBtn) {
      stopBtn.addEventListener('click', function() {
        if (self.isPlaying) {
          self.isPlaying = false;
          clearInterval(self.timerId);
          
          // Flush out any playing sounds immediately using unified array stack drainer
          for (var note in self.activeVoices) {
            if (self.activeVoices.hasOwnProperty(note)) {
              self.stopPad(parseInt(note, 10));
            }
          }
        }
      });
    }
  },

  bindPhysicalPads: function() {
    var self = this;
    var pads = document.querySelectorAll('.mpc-pad');
    
    for (var i = 0; i < pads.length; i++) {
      (function(padElement) {
        var note = parseInt(padElement.getAttribute('data-note'), 10);

        // Hardware touch routing for mobile/tablets
        padElement.addEventListener('touchstart', function(e) {
          e.preventDefault();
          self.triggerPad(note, 127);
        }, { passive: false });

        padElement.addEventListener('touchend', function(e) {
          e.preventDefault();
          self.stopPad(note);
        }, { passive: false });

        // Standard desktop mouse interactions
        padElement.addEventListener('mousedown', function(e) {
          e.preventDefault();
          self.triggerPad(note, 127);
        });

        padElement.addEventListener('mouseup', function(e) {
          e.preventDefault();
          self.stopPad(note);
        });
      })(pads[i]);
    }
  }
};

// Main Window Entry Point
document.addEventListener('DOMContentLoaded', function() {
  BrowserDAW.init();
});
