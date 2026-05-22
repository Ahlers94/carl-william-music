/* /assets/js/mpc.js */
// Built using strict ES5 paradigms for legacy browser rendering safety

var BrowserDAW = {
  // ── NEW GLOBAL STATE (SP-505 Architecture) ────────────────
  masterBus: null,         // Master Gain Node
  swingAmount: 0.0,        // 0.0 to 0.75 (percentage of delay on even steps)
  currentBank: 'A',        // 'A', 'B', 'C', 'D'
  
  // ── SONG & PATTERN MEMORY ─────────────────────────────────
  patterns: {},            // Initialized dynamically in initPatterns
  currentPattern: 1,
  songSequence: [1, 1, 2, 1], // The Playlist: plays Pattern 1 twice, then 2, then 1
  songIndex: 0,               // Where we are in the songSequence
  isSongMode: false,          // Toggle between looping 1 pattern or playing the song

  // ── PAD ARCHITECTURE ──────────────────────────────────────
  padConfig: {
    // Note 36 in Bank A
    'A_36': { 
      buffer: null, 
      pitch: 1.0,         // Playback rate
      reverse: false, 
      filter: { type: 'lowpass', freq: 20000 },
      adsr: { a: 0.01, d: 0.1, s: 0.8, r: 0.5 }
    }
  },

  // ── ENGINE STATES ─────────────────────────────────────────
  audioCtx: null,
  isPlaying: false,
  isRecording: false,
  currentStep: 0,
  tempo: 120,
  nextNoteTime: 0.0,
  lookahead: 25.0,        // How frequently to call scheduler (in milliseconds)
  scheduleAheadTime: 0.1, // How far ahead to schedule audio (in seconds)
  timerWorker: null,      // Background-safe Web Worker clock
  mediaRecorder: null,
  audioChunks: [],
  
  // ── DATA TRACKING ─────────────────────────────────────────
  activeVoices: {},    // Tracks playing notes: { padId: [{ source, gain, config }] }

  // ── CORE INITIALIZATION ───────────────────────────────────
  init: function() {
    var self = this;
    this.initPatterns();
    this.bindTransportControls();
    this.bindPhysicalPads();
    this.setupWebMIDI();
    this.setupTimerWorker(); // Initializes background-safe clock

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
        this.setupMasterBus();
      }
    }
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }
  },

  initPatterns: function() {
    this.patterns = { 1: [], 2: [] };
    for (var p = 1; p <= 2; p++) {
      for (var i = 0; i < 16; i++) {
        this.patterns[p].push([]);
      }
    }
    // Pre-load an iconic 4-on-the-floor test grid on Pattern 1 (Note 36 = Kick Drum)
    this.patterns[1][0].push('A_36');
    this.patterns[1][4].push('A_36');
    this.patterns[1][8].push('A_36');
    this.patterns[1][12].push('A_36');
  },

  // ── AUDIO ROUTING & GENERATION ────────────────────────────
  setupMasterBus: function() {
    this.masterBus = this.audioCtx.createGain();
    // Add Master FX (like a bitcrusher or compressor) here later
    this.masterBus.connect(this.audioCtx.destination);
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
  createVoiceNode: function(padId, time, velocity) {
    var config = this.padConfig[padId];
    
    // Fallback click generation if pad isn't configured or lacks a sample
    if (!config || !config.buffer) {
       config = {
         buffer: this.createClickTrackBuffer(),
         pitch: 1.0,
         filter: { type: 'lowpass', freq: 20000 },
         adsr: { a: 0.01, d: 0.1, s: 0.8, r: 0.5 }
       };
    }
    if (!config.buffer) return;

    this.handleChoke(padId);

    var source = this.audioCtx.createBufferSource();
    var filter = this.audioCtx.createBiquadFilter();
    var voiceGain = this.audioCtx.createGain();

    // 1. Source & Pitch/Reverse Setup
    source.buffer = config.buffer;
    source.playbackRate.value = config.pitch;
    
    // 2. Filter Setup
    filter.type = config.filter.type;
    filter.frequency.setValueAtTime(config.filter.freq, time);

    // 3. ADSR Envelope Setup (Gain)
    var peakVolume = velocity / 127;
    var a = config.adsr.a, d = config.adsr.d, s = config.adsr.s;
    
    voiceGain.gain.setValueAtTime(0, time);
    voiceGain.gain.linearRampToValueAtTime(peakVolume, time + a); // Attack
    voiceGain.gain.linearRampToValueAtTime(peakVolume * s, time + a + d); // Decay to Sustain

    // 4. Connect the Chain
    source.connect(filter);
    filter.connect(voiceGain);
    voiceGain.connect(this.masterBus);

    source.start(time);

    if (!this.activeVoices[padId]) this.activeVoices[padId] = [];
    this.activeVoices[padId].push({ source: source, gain: voiceGain, config: config });
  },

  handleChoke: function(padId) {
    if (this.activeVoices[padId] && this.activeVoices[padId].length > 0) {
      while (this.activeVoices[padId].length > 0) {
        var voice = this.activeVoices[padId].shift();
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

    var padId = this.currentBank + '_' + note;
    var targetVolume = velocity / 127;

    if (this.isRecording && this.isPlaying) {
      var stepToRecord = this.currentStep; 
      this.patterns[this.currentPattern][stepToRecord].push(padId);
    }

    this.createVoiceNode(padId, this.audioCtx.currentTime, targetVolume);
    this.visualizePad(note, true);
  },

  stopPad: function(note) {
    var padId = this.currentBank + '_' + note;
    if (!this.activeVoices[padId] || this.activeVoices[padId].length === 0) return;

    var voicesToStop = this.activeVoices[padId];
    this.activeVoices[padId] = []; 

    var config = this.padConfig[padId];
    var releaseTime = (config && config.adsr) ? config.adsr.r : 0.005;

    for (var i = 0; i < voicesToStop.length; i++) {
      var voice = voicesToStop[i];
      try {
        var now = this.audioCtx.currentTime;
        
        voice.gain.gain.cancelScheduledValues(now);
        voice.gain.gain.setValueAtTime(voice.gain.gain.value, now);
        voice.gain.gain.linearRampToValueAtTime(0.0, now + releaseTime);
        
        voice.source.stop(now + releaseTime + 0.01);
      } catch (e) {}
    }
    this.visualizePad(note, false);
  },

  // ── BACKGROUND-SAFE TIMER ─────────────────────────────────
  setupTimerWorker: function() {
    var workerScript = `
      var timerID = null;
      var interval = 25;
      
      self.onmessage = function(e) {
        if (e.data === 'start') {
          timerID = setInterval(function() { postMessage('tick'); }, interval);
        } else if (e.data === 'stop') {
          clearInterval(timerID);
          timerID = null;
        }
      };
    `;

    var blob = new Blob([workerScript], { type: 'application/javascript' });
    this.timerWorker = new Worker(URL.createObjectURL(blob));

    var self = this;
    this.timerWorker.onmessage = function(e) {
      if (e.data === 'tick') {
        self.scheduler();
      }
    };
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
    var stepDuration = 0.25 * secondsPerBeat;
    
    this.nextNoteTime += stepDuration; 
    this.currentStep++;
    
    if (this.currentStep >= 16) {
      this.currentStep = 0;
      
      if (this.isSongMode) {
        this.songIndex++;
        if (this.songIndex >= this.songSequence.length) {
           this.songIndex = 0; 
        }
        this.currentPattern = this.songSequence[this.songIndex];
      }
    }
  },

  schedulePatternStep: function(stepNumber, time) {
    var self = this;
    var notes = this.patterns[this.currentPattern][stepNumber];
    
    var swingTime = time;
    if (stepNumber % 2 !== 0) {
       var secondsPerBeat = 60.0 / this.tempo;
       var stepDuration = 0.25 * secondsPerBeat;
       swingTime += (stepDuration * this.swingAmount); 
    }

    for (var i = 0; i < notes.length; i++) {
      var padId = notes[i]; 
      this.createVoiceNode(padId, swingTime, 127); 
    }

    var delayMs = Math.max(0, (swingTime - this.audioCtx.currentTime) * 1000);
    setTimeout(function() {
      self.drawStepProgress(stepNumber);
      for (var j = 0; j < notes.length; j++) {
        (function(nPadId) {
          // Extract visual note from padId (e.g. "A_36" -> 36)
          var n = parseInt(nPadId.split('_')[1], 10);
          self.visualizePad(n, true);
          setTimeout(function() { self.visualizePad(n, false); }, 100);
        })(notes[j]);
      }
    }, delayMs);
  },

  // ── LIVE SAMPLING (MICROPHONE) ────────────────────────────
  startSampling: function(targetPadId) {
    var self = this;
    
    // Auto-create padConfig entry if it doesn't exist
    if (!this.padConfig[targetPadId]) {
      this.padConfig[targetPadId] = {
        buffer: null, pitch: 1.0, reverse: false,
        filter: { type: 'lowpass', freq: 20000 },
        adsr: { a: 0.01, d: 0.1, s: 0.8, r: 0.5 }
      };
    }

    navigator.mediaDevices.getUserMedia({ audio: true }).then(function(stream) {
      self.mediaRecorder = new MediaRecorder(stream);
      self.audioChunks = [];

      self.mediaRecorder.ondataavailable = function(e) {
        self.audioChunks.push(e.data);
      };

      self.mediaRecorder.onstop = function() {
        var blob = new Blob(self.audioChunks, { type: 'audio/webm' });
        var reader = new FileReader();
        
        reader.onload = function() {
          self.audioCtx.decodeAudioData(reader.result, function(buffer) {
            self.padConfig[targetPadId].buffer = buffer;
            console.log("Sample loaded to " + targetPadId);
          });
        };
        reader.readAsArrayBuffer(blob);
      };

      self.mediaRecorder.start();
    }).catch(function(err) {
      console.error("Microphone access denied: ", err);
    });
  },

  stopSampling: function() {
    if (this.mediaRecorder && this.mediaRecorder.state !== "inactive") {
      this.mediaRecorder.stop();
    }
  },

  // ── DATA STORAGE ──────────────────────────────────────────
  saveProject: function() {
    var projectData = {
      tempo: this.tempo,
      swing: this.swingAmount,
      patterns: this.patterns,
      songSequence: this.songSequence
    };
    localStorage.setItem('SP505_Project', JSON.stringify(projectData));
  },

  // ── NATIVE WEB MIDI BRIDGE ────────────────────────────────
  setupWebMIDI: function() {
    var self = this;
    var midiStatusEl = document.getElementById('midi-status');
    
    if (!navigator.requestMIDIAccess) {
      if (midiStatusEl) {
        midiStatusEl.textContent = "MIDI: UNSUPPORTED";
        midiStatusEl.classList.remove('blink');
      }
      return;
    }

    navigator.requestMIDIAccess().then(
      function(midiAccess) {
        if (midiStatusEl) {
          midiStatusEl.textContent = "MIDI: READY";
          midiStatusEl.classList.remove('blink');
        }
        
        var inputs = midiAccess.inputs.values();
        for (var input = inputs.next(); input && !input.done; input = inputs.next()) {
          input.value.onmidimessage = function(msg) {
            self.handleMidiMessage(msg);
          };
        }
      },
      function(err) {
        if (midiStatusEl) {
          midiStatusEl.textContent = "MIDI: ERROR";
          midiStatusEl.classList.remove('blink');
        }
        console.error("MIDI access denied: ", err);
      }
    );
  },

  handleMidiMessage: function(message) {
    this.unlockAudioContext();
    var status = message.data[0];
    var note = message.data[1];
    var velocity = message.data[2];
    
    if (status === 144 && velocity > 0) {
      this.triggerPad(note, velocity);
    }
    if (status === 128 || (status === 144 && velocity === 0)) {
      this.stopPad(note);
    }
  },

  // ── UI & HARDWARE BINDINGS ────────────────────────────────
  visualizePad: function(note, isActive) {
    var padElement = document.querySelector('.mpc-pad[data-note="' + note + '"]');
    if (!padElement) return;
    
    if (isActive) {
      padElement.classList.add('active');
      padElement.classList.add('pad-active');
    } else {
      padElement.classList.remove('active');
      padElement.classList.remove('pad-active');
    }
  },

  drawStepProgress: function(stepNumber) {
    var canvas = document.getElementById('step-progress');
    if (!canvas) return;
    var ctx = canvas.getContext('2d');
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    var segmentWidth = canvas.width / 16;
    
    ctx.fillStyle = 'rgba(0, 245, 255, 0.2)';
    ctx.fillRect(0, 0, segmentWidth * (stepNumber + 1), canvas.height);
    
    ctx.fillStyle = '#00f5ff';
    ctx.fillRect(segmentWidth * stepNumber, 0, segmentWidth, canvas.height);
  },

  bindTransportControls: function() {
    var self = this;
    var playBtn = document.getElementById('btn-play');
    var stopBtn = document.getElementById('btn-stop');
    var recBtn = document.getElementById('btn-rec');

    if (playBtn) {
      playBtn.addEventListener('click', function() {
        self.unlockAudioContext();
        if (!self.isPlaying && self.audioCtx) {
          self.isPlaying = true;
          self.currentStep = 0;
          self.nextNoteTime = self.audioCtx.currentTime + 0.05;
          
          playBtn.classList.add('transport-active');
          if (stopBtn) stopBtn.classList.remove('transport-active');

          self.timerWorker.postMessage('start');
        }
      });
    }

    if (stopBtn) {
      stopBtn.addEventListener('click', function() {
        if (self.isPlaying) {
          self.isPlaying = false;
          
          self.timerWorker.postMessage('stop');
          
          if (playBtn) playBtn.classList.remove('transport-active');
          stopBtn.classList.add('transport-active');

          for (var padId in self.activeVoices) {
            if (self.activeVoices.hasOwnProperty(padId)) {
              var note = parseInt(padId.split('_')[1], 10);
              self.stopPad(note);
            }
          }
        }
      });
    }

    if (recBtn) {
      recBtn.addEventListener('click', function() {
        self.isRecording = !self.isRecording;
        if (self.isRecording) {
          recBtn.classList.add('recording-active');
        } else {
          recBtn.classList.remove('recording-active');
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

        padElement.addEventListener('touchstart', function(e) {
          e.preventDefault();
          self.triggerPad(note, 127);
        }, { passive: false });

        padElement.addEventListener('touchend', function(e) {
          e.preventDefault();
          self.stopPad(note);
        }, { passive: false });

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
