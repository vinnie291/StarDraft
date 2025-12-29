// Simple synth audio service
let audioCtx: AudioContext | null = null;
let isMuted = false;

// Shared buffers
let explosionBuffer: AudioBuffer | null = null;
let noiseBuffer: AudioBuffer | null = null;

const getCtx = () => {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
        // Create buffers once
        noiseBuffer = createNoiseBuffer(audioCtx, 2);
    }
    return audioCtx;
};

export const toggleMute = () => {
    isMuted = !isMuted;
    return isMuted;
};

export const getMuteState = () => isMuted;

const createNoiseBuffer = (ctx: AudioContext, duration: number) => {
    const bufferSize = ctx.sampleRate * duration;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
    }
    return buffer;
};

export const playSound = (type: 'shoot' | 'explosion' | 'train' | 'build' | 'error' | 'click') => {
    if (isMuted) return;
    const ctx = getCtx();
    if (ctx.state === 'suspended') ctx.resume();

    const now = ctx.currentTime;
    const masterGain = ctx.createGain();
    masterGain.connect(ctx.destination);

    // Helper for envelopes
    const ramp = (param: AudioParam, start: number, end: number, dur: number) => {
        param.setValueAtTime(start, now);
        param.exponentialRampToValueAtTime(end, now + dur);
    };

    if (type === 'shoot') {
        // 1. "Kick" - low punch
        const osc = ctx.createOscillator();
        osc.frequency.setValueAtTime(150, now);
        osc.frequency.exponentialRampToValueAtTime(50, now + 0.1);
        const oscGain = ctx.createGain();
        ramp(oscGain.gain, 0.3, 0.001, 0.1);
        osc.connect(oscGain);
        oscGain.connect(masterGain);
        osc.start(now);
        osc.stop(now + 0.1);

        // 2. "Snap" - high frequency noise
        if (noiseBuffer) {
            const noise = ctx.createBufferSource();
            noise.buffer = noiseBuffer;
            const noiseFilter = ctx.createBiquadFilter();
            noiseFilter.type = 'highpass';
            noiseFilter.frequency.value = 1000;
            const noiseGain = ctx.createGain();
            ramp(noiseGain.gain, 0.2, 0.001, 0.08);
            noise.connect(noiseFilter);
            noiseFilter.connect(noiseGain);
            noiseGain.connect(masterGain);
            noise.start(now);
            noise.stop(now + 0.1);
        }
    } 
    else if (type === 'explosion') {
        // Deep rumble
        if (noiseBuffer) {
            const noise = ctx.createBufferSource();
            noise.buffer = noiseBuffer;
            const filter = ctx.createBiquadFilter();
            filter.type = 'lowpass';
            ramp(filter.frequency, 800, 100, 0.8);
            
            const gain = ctx.createGain();
            ramp(gain.gain, 0.8, 0.001, 0.8);

            noise.connect(filter);
            filter.connect(gain);
            gain.connect(masterGain);
            noise.start(now);
            noise.stop(now + 1.0);
        }
    }
    else if (type === 'train') {
        // Sci-fi servo sound
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        ramp(osc.frequency, 200, 800, 0.4);
        
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(0.1, now + 0.1);
        gain.gain.linearRampToValueAtTime(0, now + 0.4);
        
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        ramp(filter.frequency, 400, 2000, 0.4);

        osc.connect(filter);
        filter.connect(gain);
        gain.connect(masterGain);
        osc.start(now);
        osc.stop(now + 0.4);
    }
    else if (type === 'build') {
        // Heavy metallic ratchet
        const osc = ctx.createOscillator();
        osc.type = 'square';
        osc.frequency.setValueAtTime(80, now);
        
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.15, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);

        // AM Modulation for "ratchet" texture
        const lfo = ctx.createOscillator();
        lfo.type = 'square';
        lfo.frequency.value = 25;
        const lfoGain = ctx.createGain();
        lfoGain.gain.value = 500;
        lfo.connect(lfoGain);
        lfoGain.connect(osc.frequency);
        lfo.start(now);

        osc.connect(gain);
        gain.connect(masterGain);
        osc.start(now);
        osc.stop(now + 0.2);
    }
    else if (type === 'error') {
        // Digital Buzzer
        const osc1 = ctx.createOscillator();
        const osc2 = ctx.createOscillator();
        osc1.type = 'sawtooth';
        osc2.type = 'square';
        osc1.frequency.value = 150;
        osc2.frequency.value = 155; // Detuned

        const gain = ctx.createGain();
        ramp(gain.gain, 0.1, 0.001, 0.3);

        osc1.connect(gain);
        osc2.connect(gain);
        gain.connect(masterGain);
        osc1.start(now);
        osc2.start(now);
        osc1.stop(now + 0.3);
        osc2.stop(now + 0.3);
    }
    else if (type === 'click') {
        // Crisp blip
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(2000, now);
        osc.frequency.exponentialRampToValueAtTime(1000, now + 0.05);
        
        const gain = ctx.createGain();
        ramp(gain.gain, 0.1, 0.001, 0.05);
        
        osc.connect(gain);
        gain.connect(masterGain);
        osc.start(now);
        osc.stop(now + 0.05);
    }
};