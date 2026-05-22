/**
 * Casio SK-5 Web Audio Engine Core
 */
class SK5Engine {
    constructor() {
        this.audioCtx = null;
        this.masterGain = null;
        this.polyphonyLimit = 4;
        this.activeNotes = []; // Tracks objects: { midiNote, sourceNodes, gainNode }
        
        // Runtime State
        this.samplerActive = false;
        this.isRecording = false;
        this.sampleSlots = [null, null, null, null]; // AudioBuffers
        this.sampleTuningCents = [0, 0, 0, 0]; // Relative offsets per slot
        
        // Settings Map
        this.activeVoice = 'piano';
        this.activeSampleSlot = 0;
        this.currentFx = 'none';
        
        // Media Recorder assets
        this.mediaRecorder = null;
        this.audioChunks = [];
        this.stream = null;

        // Debounce tracking sets for keyboard & hardware pad elements
        this.pressedPads = new Set();
        this.pressedKeys = new Set();

        // ADSR Envelope Configuration Parameters
        this.adsr = { attack: 0.02, decay: 0.15, sustain: 0.6, release: 0.4 };

        this.initDOM();
    }

    initAudio() {
        if (this.audioCtx) return;
        this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        this.masterGain = this.audioCtx.createGain();
        this.masterGain.gain.setValueAtTime(parseFloat(document.getElementById('master-volume').value), this.audioCtx.currentTime);
        this.masterGain.connect(this.audioCtx.destination);
        this.loadSamplesFromStorage();
    }

    initDOM() {
        this.build32KeyBed();
        this.bindHardwareEvents();
    }

    build32KeyBed() {
        const keyboardBed = document.getElementById('keyboard-bed');
        if (!keyboardBed) return;
        
        // 32 Keys starting at F3 (MIDI 53) through C6 (MIDI 84)
        const totalKeys = 32;
        const startMidi = 53; 

        let currentMidi = startMidi;
        for (let i = 0; i < totalKeys; i++) {
            const keyElement = document.createElement('div');
            const noteInOctave = currentMidi % 12;
            const isBlack = (noteInOctave === 1 || noteInOctave === 3 || noteInOctave === 6 || noteInOctave === 8 || noteInOctave === 10);
            
            keyElement.className = isBlack ? 'key black-key' : 'key white-key';
            keyElement.dataset.midi = currentMidi;
            
            // Interaction bindings
            keyElement.addEventListener('mousedown', (e) => this.handleNoteOn(parseInt(e.target.dataset.midi)));
            keyElement.addEventListener('mouseup', (e) => this.handleNoteOff(parseInt(e.target.dataset.midi)));
            keyElement.addEventListener('mouseleave', (e) => this.handleNoteOff(parseInt(e.target.dataset.midi)));
            
            keyboardBed.appendChild(keyElement);
            currentMidi++;
        }
    }

    bindHardwareEvents() {
        // Master Volume
        document.getElementById('master-volume').addEventListener('input', (e) => {
            if (this.masterGain) {
                this.masterGain.gain.setValueAtTime(parseFloat(e.target.value), this.audioCtx?.currentTime || 0);
            }
        });

        // Sampler Mode Activation Toggle
        const samplerToggle = document.getElementById('sampler-toggle');
        const led = document.getElementById('sampler-led');
        samplerToggle.addEventListener('change', (e) => {
            this.initAudio();
            this.samplerActive = e.target.checked;
            led.classList.toggle('led-on', this.samplerActive);
        });

        // Dynamic State Selectors
        document.getElementById('voice-dropdown').addEventListener('change', (e) => this.activeVoice = e.target.value);
        document.getElementById('sample-dropdown').addEventListener('change', (e) => this.activeSampleSlot = parseInt(e.target.value));
        document.getElementById('fx-dropdown').addEventListener('change', (e) => this.currentFx = e.target.value);

        // Tuning Infrastructure Actions
        document.getElementById('tune-up-btn').addEventListener('click', () => this.offsetTuning(25));
        document.getElementById('tune-down-btn').addEventListener('click', () => this.offsetTuning(-25));
        document.getElementById('fine-tune-slider').addEventListener('input', (e) => {
            this.sampleTuningCents[this.activeSampleSlot] = parseInt(e.target.value);
        });

        // Performance Yellow Pads Interaction Logic (Strict Non-Bouncing Single Triggering)
        const pads = document.querySelectorAll('.yellow-pad');
        pads.forEach(pad => {
            pad.addEventListener('mousedown', (e) => {
                this.initAudio();
                const targetPad = e.target.dataset.pad;
                if (!this.pressedPads.has(targetPad)) {
                    this.pressedPads.add(targetPad);
                    e.target.classList.add('pad-active-glow');
                    this.triggerPadAudio(targetPad);
                }
            });
            pad.addEventListener('mouseup', (e) => {
                const targetPad = e.target.dataset.pad;
                this.pressedPads.delete(targetPad);
                e.target.classList.remove('pad-active-glow');
            });
            pad.addEventListener('mouseleave', (e) => {
                const targetPad = e.target.dataset.pad;
                this.pressedPads.delete(targetPad);
                e.target.classList.remove('pad-active-glow');
            });
        });

        // Microphone Hardware Access & Record Lifecycle Management
        const recBtn = document.getElementById('rec-button');
        recBtn.addEventListener('mousedown', () => this.startMicrophoneRecording());
        recBtn.addEventListener('mouseup', () => this.stopMicrophoneRecording());
        recBtn.addEventListener('mouseleave', () => this.stopMicrophoneRecording());

        // Mapping Physical PC Keys for performance testing
        window.addEventListener('keydown', (e) => {
            if (e.repeat) return; // Native system keyboard bounce filtering
            const keyMap = {'z':53, 's':54, 'x':55, 'd':56, 'c':57, 'v':59, 'g':60, 'b':61};
            if (keyMap[e.key]) {
                this.handleNoteOn(keyMap[e.key]);
                const keyDom = document.querySelector(`[data-midi="${keyMap[e.key]}"]`);
                keyDom?.classList.add('key-active');
            }
        });
        window.addEventListener('keyup', (e) => {
            const keyMap = {'z':53, 's':54, 'x':55, 'd':56, 'c':57, 'v':59, 'g':60, 'b':61};
            if (keyMap[e.key]) {
                this.handleNoteOff(keyMap[e.key]);
                const keyDom = document.querySelector(`[data-midi="${keyMap[e.key]}"]`);
                keyDom?.classList.remove('key-active');
            }
        });
    }

    offsetTuning(centsAmount) {
        const slider = document.getElementById('fine-tune-slider');
        let newTuning = this.sampleTuningCents[this.activeSampleSlot] + centsAmount;
        newTuning = Math.max(-100, Math.min(100, newTuning));
        this.sampleTuningCents[this.activeSampleSlot] = newTuning;
        slider.value = newTuning;
    }

    // --- Audio Logic Block ---

    triggerPadAudio(padName) {
        if (!this.audioCtx) return;
        
        if (padName.startsWith('sample-')) {
            const slotIndex = parseInt(padName.split('-')[1]) - 1;
            this.playBufferAtPitch(this.sampleSlots[slotIndex], 60, slotIndex);
            return;
        }

        this.synthesizeDrumPreset(padName);
    }

    synthesizeDrumPreset(type) {
        const osc = this.audioCtx.createOscillator();
        const gainNode = this.audioCtx.createGain();
        osc.connect(gainNode);
        gainNode.connect(this.masterGain);

        const now = this.audioCtx.currentTime;
        if (type === 'kick') {
            osc.frequency.setValueAtTime(120, now);
            osc.frequency.exponentialRampToValueAtTime(0.01, now + 0.12);
            gainNode.gain.setValueAtTime(1, now);
            gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.12);
            osc.start(now);
            osc.stop(now + 0.13);
        } else if (type === 'snare') {
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(180, now);
            gainNode.gain.setValueAtTime(0.7, now);
            gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
            osc.start(now);
            osc.stop(now + 0.11);
        } else {
            osc.frequency.setValueAtTime(type === 'hi-bongo' ? 440 : 220, now);
            gainNode.gain.setValueAtTime(0.5, now);
            gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.08);
            osc.start(now);
            osc.stop(now + 0.09);
        }
    }

    handleNoteOn(midiNote) {
        this.initAudio();
        if (this.pressedKeys.has(midiNote)) return;
        this.pressedKeys.add(midiNote);

        if (this.activeNotes.length >= this.polyphonyLimit) {
            const oldestNote = this.activeNotes.shift();
            this.killNoteNodeImmediate(oldestNote);
        }

        const voiceNodeContext = this.samplerActive 
            ? this.createSampleVoiceContext(midiNote) 
            : this.createPCMPresetVoiceContext(midiNote);

        if (voiceNodeContext) {
            this.activeNotes.push({ midiNote, ...voiceNodeContext });
        }
    }

    handleNoteOff(midiNote) {
        this.pressedKeys.delete(midiNote);
        const matchIndex = this.activeNotes.findIndex(n => n.midiNote === midiNote);
        if (matchIndex !== -1) {
            const noteObj = this.activeNotes[matchIndex];
            this.applyReleaseEnvelope(noteObj);
            this.activeNotes.splice(matchIndex, 1);
        }
    }

    createPCMPresetVoiceContext(midiNote) {
        const now = this.audioCtx.currentTime;
        const osc = this.audioCtx.createOscillator();
        const gainNode = this.audioCtx.createGain();
        
        osc.type = (this.activeVoice === 'pipe-organ' || this.activeVoice === 'synth') ? 'square' : 'sawtooth';
        
        const frequency = 440 * Math.pow(2, (midiNote - 69) / 12);
        osc.frequency.setValueAtTime(frequency, now);

        let filterNode = null;
        if (this.activeVoice === 'flute' || this.activeVoice === 'chorus') {
            filterNode = this.audioCtx.createBiquadFilter();
            filterNode.type = 'lowpass';
            filterNode.frequency.setValueAtTime(800, now);
        }

        if (filterNode) {
            osc.connect(filterNode);
            filterNode.connect(gainNode);
        } else {
            osc.connect(gainNode);
        }
        gainNode.connect(this.masterGain);

        gainNode.gain.setValueAtTime(0, now);
        gainNode.gain.linearRampToValueAtTime(0.5, now + this.adsr.attack);

        osc.start(now);
        return { sourceNodes: [osc], gainNode };
    }

    createSampleVoiceContext(midiNote) {
        const buffer = this.sampleSlots[this.activeSampleSlot];
        if (!buffer) return null;

        return this.playBufferAtPitch(buffer, midiNote, this.activeSampleSlot);
    }

    playBufferAtPitch(buffer, midiNote, slotIndex) {
        const now = this.audioCtx.currentTime;
        
        let targetBuffer = buffer;
        if (this.currentFx === 'reverse') {
            targetBuffer = this.cloneAndReverseBuffer(buffer);
        }

        const bufferSource = this.audioCtx.createBufferSource();
        bufferSource.buffer = targetBuffer;

        const rootPitch = 60;
        const totalCentsOffset = ((midiNote - rootPitch) * 100) + this.sampleTuningCents[slotIndex];
        const playbackRate = Math.pow(2, totalCentsOffset / 1200);
        bufferSource.playbackRate.setValueAtTime(playbackRate, now);

        if (this.currentFx === 'loop') {
            bufferSource.loop = true;
        }

        const gainNode = this.audioCtx.createGain();
        bufferSource.connect(gainNode);
        gainNode.connect(this.masterGain);

        if (this.currentFx === 'envelope') {
            gainNode.gain.setValueAtTime(0, now);
            gainNode.gain.linearRampToValueAtTime(0.8, now + this.adsr.attack);
            gainNode.gain.linearRampToValueAtTime(this.adsr.sustain * 0.8, now + this.adsr.attack + this.adsr.decay);
        } else {
            gainNode.gain.setValueAtTime(0.8, now);
        }

        bufferSource.start(now);
        return { sourceNodes: [bufferSource], gainNode };
    }

    applyReleaseEnvelope(noteObj) {
        const now = this.audioCtx.currentTime;
        const gainNode = noteObj.gainNode;
        
        try {
            const currentGainVal = gainNode.gain.value;
            gainNode.gain.cancelScheduledValues(now);
            gainNode.gain.setValueAtTime(currentGainVal, now);
            
            const releaseDuration = this.currentFx === 'envelope' ? this.adsr.release : 0.05;
            gainNode.gain.exponentialRampToValueAtTime(0.001, now + releaseDuration);
            
            noteObj.sourceNodes.forEach(node => {
                if (typeof node.stop === 'function') node.stop(now + releaseDuration + 0.02);
            });
        } catch(e) {
            this.killNoteNodeImmediate(noteObj);
        }
    }

    killNoteNodeImmediate(noteObj) {
        try {
            noteObj.gainNode.disconnect();
            noteObj.sourceNodes.forEach(n => { if(typeof n.stop === 'function') n.stop(); });
        } catch(e){}
    }

    cloneAndReverseBuffer(buffer) {
        const numChannels = buffer.numberOfChannels;
        const numSamples = buffer.length;
        const sampleRate = buffer.sampleRate;
        const reversedBuffer = this.audioCtx.createBuffer(numChannels, numSamples, sampleRate);
        
        for (let channel = 0; channel < numChannels; channel++) {
            const sourceData = buffer.getChannelData(channel);
            const reversedData = reversedBuffer.getChannelData(channel);
            for (let i = 0; i < numSamples; i++) {
                reversedData[i] = sourceData[numSamples - 1 - i];
            }
        }
        return reversedBuffer;
    }

    // --- Sampling Execution Layer ---

    async startMicrophoneRecording() {
        this.initAudio();
        if (this.isRecording) return;
        
        const isLongMode = document.getElementById('length-toggle').checked;
        const maxTimeLimit = isLongMode ? 1400 : 700;

        try {
            this.stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
            this.audioChunks = [];
            this.mediaRecorder = new MediaRecorder(this.stream);
            
            this.mediaRecorder.ondataavailable = (e) => {
                if (e.data.size > 0) this.audioChunks.push(e.data);
            };

            this.mediaRecorder.onstop = () => this.processRecordedAudio();

            this.isRecording = true;
            document.getElementById('rec-button').classList.add('rec-glowing-active');
            this.mediaRecorder.start();

            this.recordingTimeout = setTimeout(() => {
                this.stopMicrophoneRecording();
            }, maxTimeLimit);

        } catch (err) {
            console.error("Microphone hardware configuration access refused:", err);
            this.isRecording = false;
        }
    }

    stopMicrophoneRecording() {
        if (!this.isRecording) return;
        clearTimeout(this.recordingTimeout);
        this.isRecording = false;
        document.getElementById('rec-button').classList.remove('rec-glowing-active');
        
        if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
            this.mediaRecorder.stop();
        }
        if (this.stream) {
            this.stream.getTracks().forEach(track => track.stop());
        }
    }

    async processRecordedAudio() {
        const audioBlob = new Blob(this.audioChunks, { type: 'audio/webm' });
        const arrayBuffer = await audioBlob.arrayBuffer();
        
        this.audioCtx.decodeAudioData(arrayBuffer, (decodedBuffer) => {
            const isLowQuality = !document.getElementById('quality-toggle').checked;
            const finalBuffer = isLowQuality ? this.apply8BitCrusherDownsample(decodedBuffer) : decodedBuffer;
            
            this.sampleSlots[this.activeSampleSlot] = finalBuffer;
            this.persistSampleToStorage(this.activeSampleSlot, finalBuffer);
        });
    }

    apply8BitCrusherDownsample(buffer) {
        const numChannels = buffer.numberOfChannels;
        const sampleRate = buffer.sampleRate;
        
        const downsampleFactor = 4; 
        const targetLength = Math.floor(buffer.length / downsampleFactor);
        const crushedBuffer = this.audioCtx.createBuffer(numChannels, targetLength, sampleRate / downsampleFactor);

        for (let channel = 0; channel < numChannels; channel++) {
            const sourceData = buffer.getChannelData(channel);
            const crushedData = crushedBuffer.getChannelData(channel);
            
            for (let i = 0; i < targetLength; i++) {
                const sourceIndex = i * downsampleFactor;
                const sampleRaw = sourceData[sourceIndex];
                
                const stepQuantized = Math.round(sampleRaw * 127);
                crushedData[i] = stepQuantized / 127; 
            }
        }
        return crushedBuffer;
    }

    // --- Persistence Infrastructure Layer ---

    persistSampleToStorage(slotIndex, audioBuffer) {
        try {
            const leftChannelData = audioBuffer.getChannelData(0);
            const dataArray = Array.from(leftChannelData);
            const payload = {
                sampleRate: audioBuffer.sampleRate,
                rawData: dataArray
            };
            localStorage.setItem(`sk5_sample_slot_${slotIndex}`, JSON.stringify(payload));
        } catch (e) {
            console.warn("Storage write limit reached.", e);
        }
    }

    loadSamplesFromStorage() {
        for (let i = 0; i < 4; i++) {
            const rawDataString = localStorage.getItem(`sk5_sample_slot_${i}`);
            if (rawDataString) {
                try {
                    const payload = JSON.parse(rawDataString);
                    const bufferArray = new Float32Array(payload.rawData);
                    const audioBuffer = this.audioCtx.createBuffer(1, bufferArray.length, payload.sampleRate);
                    audioBuffer.copyToChannel(bufferArray, 0);
                    this.sampleSlots[i] = audioBuffer;
                } catch(err) {
                    console.error("Failed executing storage parsing", err);
                }
            }
        }
    }
}

window.addEventListener('DOMContentLoaded', () => {
    window.sk5AppEngineInstance = new SK5Engine();
});
