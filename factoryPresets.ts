
// Factory Presets for Poly Rhythm Synth

// Helper to generate Euclidean pattern
const generateEuclideanPattern = (steps: number, pulses: number): number[] => {
	pulses = Math.min(steps, pulses);
	if (pulses <= 0 || steps <= 0) {
		return new Array(steps).fill(0);
	}

	const pattern = new Array(steps).fill(0);
	let accumulator = 0;
	for (let i = 0; i < steps; i++) {
		accumulator += pulses;
		if (accumulator >= steps) {
			accumulator -= steps;
			pattern[i] = 1;
		}
	}
	return pattern;
};

const rotatePattern = (pattern: number[], rotation: number): number[] => {
	const len = pattern.length;
	if (len === 0) return [];
	const offset = ((rotation % len) + len) % len;
	return [...pattern.slice(len - offset), ...pattern.slice(0, len - offset)];
};

// Helper to create a default routing state
const DEFAULT_ROUTING = {
	filter1Cutoff: false,
	filter1Resonance: false,
	filter2Cutoff: false,
	filter2Resonance: false,
	engine1Vol: false,
	engine1SynthFreq: false,
	engine1SamplerTranspose: false,
	engine1GrainSize: false,
	engine1GrainDensity: false,
	engine1GrainPosition: false,
	engine1GrainJitter: false,
	engine2Vol: false,
	engine2SynthFreq: false,
	engine2SamplerTranspose: false,
	engine2GrainSize: false,
	engine2GrainDensity: false,
	engine2GrainPosition: false,
	engine2GrainJitter: false,
	engine3Vol: false,
	engine3SynthFreq: false,
	engine3SamplerTranspose: false,
	engine3GrainSize: false,
	engine3GrainDensity: false,
	engine3GrainPosition: false,
	engine3GrainJitter: false,
	// Rate Modulation
	engine1Rate: false,
	engine2Rate: false,
	engine3Rate: false,
	lfo1Rate: false,
	lfo2Rate: false,
	lfo3Rate: false,
};

// Helper to create a default state to avoid repetition
const createDefaultState = () => ({
    engines: [
        {
            id: "engine1",
            name: "E1",
            sequencerSteps: 16,
            sequencerPulses: 4,
            sequencerRotate: 0,
            sequencerRate: "1/16",
            sequencerEnabled: true,
            midiControlled: true,
            synth: {
                enabled: true,
                volume: 0.7,
                frequency: 220,
                oscillatorType: "sawtooth",
                solfeggioFrequency: "528",
            },
            noise: { enabled: false, volume: 0.2, noiseType: "white" },
            sampler: {
                enabled: false,
                volume: 0.8,
                sampleName: null,
                transpose: 0,
                granularModeEnabled: true,
                grainSize: 0.1,
                grainDensity: 10,
                playbackPosition: 0,
                positionJitter: 0,
                liveInputEnabled: false,
            },
            effects: { distortion: 0, delayTime: 0.5, delayFeedback: 0.3 },
            routing: { ...DEFAULT_ROUTING },
            adsr: { attack: 0.01, decay: 0.2, sustain: 0.8, release: 0.5 },
            melodicSequence: Array.from({ length: 16 }, () => []),
            useMelodicSequence: false,
            sequence: new Array(16).fill(0),
            filterDestination: "filter1" as "filter1" | "filter2" | "direct",
            randomOctaveRange: 2,
            randomBaseOctave: 3,
        },
        {
            id: "engine2",
            name: "E2",
            sequencerSteps: 16,
            sequencerPulses: 4,
            sequencerRotate: 0,
            sequencerRate: "1/16",
            sequencerEnabled: true,
            midiControlled: true,
            synth: {
                enabled: true,
                volume: 0.7,
                frequency: 440,
                oscillatorType: "sine",
                solfeggioFrequency: "417",
            },
            noise: { enabled: false, volume: 0.2, noiseType: "pink" },
            sampler: {
                enabled: false,
                volume: 0.8,
                sampleName: null,
                transpose: 0,
                granularModeEnabled: true,
                grainSize: 0.1,
                grainDensity: 10,
                playbackPosition: 0,
                positionJitter: 0,
                liveInputEnabled: false,
            },
            effects: { distortion: 0, delayTime: 0.5, delayFeedback: 0.3 },
            routing: { ...DEFAULT_ROUTING },
            adsr: { attack: 0.01, decay: 0.2, sustain: 0.8, release: 0.5 },
            melodicSequence: Array.from({ length: 16 }, () => []),
            useMelodicSequence: false,
            sequence: new Array(16).fill(0),
            filterDestination: "filter1" as "filter1" | "filter2" | "direct",
            randomOctaveRange: 2,
            randomBaseOctave: 3,
        },
        {
            id: "engine3",
            name: "E3",
            sequencerSteps: 16,
            sequencerPulses: 4,
            sequencerRotate: 0,
            sequencerRate: "1/16",
            sequencerEnabled: true,
            midiControlled: true,
            synth: {
                enabled: true,
                volume: 0.7,
                frequency: 880,
                oscillatorType: "triangle",
                solfeggioFrequency: "396",
            },
            noise: { enabled: false, volume: 0.2, noiseType: "brown" },
            sampler: {
                enabled: false,
                volume: 0.8,
                sampleName: null,
                transpose: 0,
                granularModeEnabled: true,
                grainSize: 0.1,
                grainDensity: 10,
                playbackPosition: 0,
                positionJitter: 0,
                liveInputEnabled: false,
            },
            effects: { distortion: 0, delayTime: 0.5, delayFeedback: 0.3 },
            routing: { ...DEFAULT_ROUTING },
            adsr: { attack: 0.01, decay: 0.2, sustain: 0.8, release: 0.5 },
            melodicSequence: Array.from({ length: 16 }, () => []),
            useMelodicSequence: false,
            sequence: new Array(16).fill(0),
            filterDestination: "filter1" as "filter1" | "filter2" | "direct",
            randomOctaveRange: 2,
            randomBaseOctave: 3,
        },
    ],
    lfos: [
        { id: "lfo1", name: "LFO 1", rate: 1, depth: 0.5, shape: "sine", sync: true, syncRate: "1/4", routing: { ...DEFAULT_ROUTING }, smoothing: 0 },
        { id: "lfo2", name: "LFO 2", rate: 0.5, depth: 0.5, shape: "triangle", sync: true, syncRate: "1/2", routing: { ...DEFAULT_ROUTING }, smoothing: 0 },
        { id: "lfo3", name: "LFO 3", rate: 0.25, depth: 0.5, shape: "rampDown", sync: true, syncRate: "1/1", routing: { ...DEFAULT_ROUTING }, smoothing: 0 },
    ],
    filter1: { enabled: true, type: "lowpass", cutoff: 2000, resonance: 1 },
    filter2: { enabled: true, type: "highpass", cutoff: 200, resonance: 1 },
    filterRouting: {
        engine1: { filter1: true, filter2: false },
        engine2: { filter1: true, filter2: false },
        engine3: { filter1: true, filter2: false },
        serial: false,
    },
    masterEffects: [],
    bpm: 120,
    scale: "chromatic",
    transpose: 0,
    harmonicTuningSystem: "440_ET",
    voicingMode: "poly",
    glideTime: 0,
    isGlideSynced: false,
    glideSyncRateIndex: 0,
    isGlobalAutoRandomEnabled: false,
    globalAutoRandomInterval: 5000,
    globalAutoRandomMode: "chaos",
    isAutoRandomSynced: false,
    autoRandomSyncRateIndex: 0,
    morphTime: 1000,
    isMorphSynced: false,
    morphSyncRateIndex: 0,
});

export const FACTORY_PRESETS = [
    // --- DRUMS / BASS ---
    {
        name: "Factory: DnB Breaker",
        timestamp: Date.now(),
        data: (() => {
            const s = createDefaultState();
            s.bpm = 174;
            // Kick (Engine 1)
            s.engines[0].name = "Kick";
            s.engines[0].synth.oscillatorType = "sine";
            s.engines[0].synth.frequency = 50;
            s.engines[0].adsr = { attack: 0.001, decay: 0.1, sustain: 0, release: 0.1 };
            s.engines[0].sequencerRate = "1/16";
            s.engines[0].sequencerSteps = 16;
            s.engines[0].sequencerPulses = 0;
            s.engines[0].sequencerRotate = 0;
            // Classic Breakbeat Kick Pattern
            s.engines[0].sequence = [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0];
            s.engines[0].filterDestination = "direct";
            s.engines[0].effects = { distortion: 0.1, delayTime: 0, delayFeedback: 0 };

            // Snare (Engine 2)
            s.engines[1].name = "Snare";
            s.engines[1].synth.enabled = true;
            s.engines[1].synth.oscillatorType = "triangle";
            s.engines[1].synth.frequency = 180;
            s.engines[1].noise.enabled = true;
            s.engines[1].noise.noiseType = "white";
            s.engines[1].noise.volume = 0.3;
            s.engines[1].adsr = { attack: 0.001, decay: 0.12, sustain: 0, release: 0.05 };
            s.engines[1].sequencerRate = "1/16";
            s.engines[1].sequencerSteps = 16;
            s.engines[1].sequencerPulses = 0;
            s.engines[1].sequencerRotate = 0;
            // Classic Backbeat Snare (5 and 13)
            s.engines[1].sequence = [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0];
            s.engines[1].filterDestination = "direct";

            // Bass (Engine 3) - Reese Style
            s.engines[2].name = "Reese";
            s.engines[2].synth.enabled = true;
            s.engines[2].synth.oscillatorType = "sawtooth";
            s.engines[2].synth.frequency = 55;
            s.engines[2].adsr = { attack: 0.05, decay: 0.2, sustain: 0.8, release: 0.3 };
            s.engines[2].sequencerRate = "1/16";
            s.engines[2].sequencerSteps = 16;
            s.engines[2].sequencerPulses = 0;
            s.engines[2].sequence = [1, 1, 1, 1, 0, 0, 1, 1, 1, 1, 0, 0, 1, 1, 1, 0];
            s.engines[2].filterDestination = "filter1";
            
            s.filter1.type = "lowpass";
            s.filter1.cutoff = 800;
            s.filter1.resonance = 2;

            // LFO 1 for Bass Wobble
            s.lfos[0].rate = 1.5;
            s.lfos[0].sync = true;
            s.lfos[0].syncRate = "3/8";
            s.lfos[0].shape = "sine";
            s.lfos[0].depth = 0.4;
            s.lfos[0].routing = { ...DEFAULT_ROUTING, filter1Cutoff: true };

            // Master Effects
            s.masterEffects = [
                { id: "comp", type: "distortion", enabled: true, params: { distortion: { mode: "soft clip", amount: 0.15 } } },
                { id: "verb", type: "reverb", enabled: true, params: { reverb: { decay: 1.2, mix: 0.15 } } }
            ];

            return s;
        })()
    },
    {
        name: "Factory: Psytrance Loop",
        timestamp: Date.now(),
        data: (() => {
            const s = createDefaultState();
            s.bpm = 145;
            // Kick
            s.engines[0].name = "PsyKick";
            s.engines[0].synth.oscillatorType = "sine";
            s.engines[0].synth.frequency = 60;
            s.engines[0].adsr = { attack: 0.001, decay: 0.1, sustain: 0, release: 0.05 };
            s.engines[0].sequence = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
            s.engines[0].filterDestination = "direct";

            // Bass (Offbeat)
            s.engines[1].name = "PsyBass";
            s.engines[1].synth.oscillatorType = "sawtooth";
            s.engines[1].synth.frequency = 60;
            s.engines[1].adsr = { attack: 0.01, decay: 0.1, sustain: 0.4, release: 0.1 };
            s.engines[1].sequence = [0, 1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1];
            s.engines[1].filterDestination = "filter1";
            
            s.filter1.cutoff = 600;
            s.filter1.resonance = 8;
            s.filter1.type = "lowpass";

            // LFO for Filter Pluck
            s.lfos[0].rate = 0; // Not used, using envelope? No, let's use LFO synced to 1/16 for extra movement
            s.lfos[0].shape = "rampDown";
            s.lfos[0].sync = true;
            s.lfos[0].syncRate = "1/16";
            s.lfos[0].depth = 0.4;
            s.lfos[0].routing = { ...DEFAULT_ROUTING, filter1Cutoff: true };

            // Zap
            s.engines[2].name = "Zap";
            s.engines[2].synth.oscillatorType = "triangle";
            s.engines[2].synth.frequency = 1200;
            s.engines[2].adsr = { attack: 0.001, decay: 0.1, sustain: 0, release: 0.1 };
            s.engines[2].sequence = [0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0];
            s.engines[2].effects = { distortion: 0, delayTime: 0.25, delayFeedback: 0.4 };
            s.engines[2].filterDestination = "filter2";

            s.masterEffects = [
                { id: "delay", type: "delay", enabled: true, params: { delay: { time: 0.3, feedback: 0.4, mix: 0.2 } } }
            ];

            return s;
        })()
    },
    {
        name: "Factory: Dubstep Wobble",
        timestamp: Date.now(),
        data: (() => {
            const s = createDefaultState();
            s.bpm = 140;
            // Wobble Bass (Engine 1)
            s.engines[0].name = "Wobble";
            s.engines[0].synth.oscillatorType = "sawtooth";
            s.engines[0].synth.frequency = 55;
            s.engines[0].adsr = { attack: 0.01, decay: 0.5, sustain: 1, release: 0.5 };
            s.engines[0].sequence = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
            s.engines[0].filterDestination = "filter1";
            
            s.filter1.cutoff = 1500;
            s.filter1.resonance = 12;
            s.filter1.type = "lowpass";

            // LFO 1: The Wobble (Filter Cutoff)
            s.lfos[0].name = "Wobble LFO";
            s.lfos[0].shape = "sine";
            s.lfos[0].sync = true;
            s.lfos[0].syncRate = "1/4"; // Base speed
            s.lfos[0].depth = 0.8;
            s.lfos[0].routing = { ...DEFAULT_ROUTING, filter1Cutoff: true };

            // LFO 2: The Modulator (Modulates LFO 1 Rate)
            s.lfos[1].name = "Rate Mod";
            s.lfos[1].shape = "triangle";
            s.lfos[1].sync = true;
            s.lfos[1].syncRate = "1/1"; // Slow cycle
            s.lfos[1].depth = 0.8; // High depth to sweep the rate
            // Route LFO 2 to LFO 1 Rate
            s.lfos[1].routing = { ...DEFAULT_ROUTING, lfo1Rate: true };

            // Sub (Engine 2)
            s.engines[1].name = "Sub";
            s.engines[1].synth.oscillatorType = "sine";
            s.engines[1].synth.frequency = 55;
            s.engines[1].sequence = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
            s.engines[1].filterDestination = "direct";

            // Drums (Engine 3)
            s.engines[2].name = "Drums";
            s.engines[2].synth.enabled = false;
            s.engines[2].noise.enabled = true;
            s.engines[2].noise.noiseType = "white";
            s.engines[2].adsr = { attack: 0.001, decay: 0.2, sustain: 0, release: 0.1 };
            s.engines[2].sequence = [1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0]; // Half time kick/snare
            s.engines[2].filterDestination = "direct";

            s.masterEffects = [
                { id: "dist", type: "distortion", enabled: true, params: { distortion: { mode: "hard clip", amount: 0.3 } } },
                { id: "verb", type: "reverb", enabled: true, params: { reverb: { decay: 1.0, mix: 0.1 } } }
            ];

            return s;
        })()
    },

    {
        name: "Factory: Acid House Bass",
        timestamp: Date.now(),
        data: (() => {
            const s = createDefaultState();
            s.bpm = 124;
            s.engines[0].name = "Acid";
            s.engines[0].synth.oscillatorType = "sawtooth";
            s.engines[0].synth.frequency = 110;
            s.engines[0].adsr = { attack: 0.01, decay: 0.3, sustain: 0.2, release: 0.1 };
            s.engines[0].sequence = [1, 0, 1, 0, 1, 1, 0, 1, 1, 0, 1, 0, 1, 1, 1, 0];
            s.engines[0].filterDestination = "filter1";
            s.engines[0].effects = { distortion: 0.4, delayTime: 0.3, delayFeedback: 0.3 };

            s.filter1.type = "lowpass";
            s.filter1.cutoff = 1000;
            s.filter1.resonance = 18; // High resonance

            // Slow LFO modulation for evolving acid line
            s.lfos[0].rate = 0.1;
            s.lfos[0].depth = 0.5;
            s.lfos[0].shape = "sine";
            s.lfos[0].routing = { ...DEFAULT_ROUTING, filter1Cutoff: true };

            // Kick
            s.engines[1].name = "Kick";
            s.engines[1].synth.oscillatorType = "sine";
            s.engines[1].synth.frequency = 55;
            s.engines[1].adsr = { attack: 0.001, decay: 0.15, sustain: 0, release: 0.1 };
            s.engines[1].sequence = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
            s.engines[1].filterDestination = "direct";

            // Hats
            s.engines[2].name = "Hats";
            s.engines[2].synth.enabled = false;
            s.engines[2].noise.enabled = true;
            s.engines[2].noise.noiseType = "white";
            s.engines[2].sequence = [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0];
            s.engines[2].filterDestination = "filter2";
            s.filter2.type = "highpass";
            s.filter2.cutoff = 5000;

            return s;
        })()
    },

    // --- MELODIC / AMBIENT ---
    {
        name: "Factory: Ethereal Pad",
        timestamp: Date.now(),
        data: (() => {
            const s = createDefaultState();
            s.bpm = 80;
            s.harmonicTuningSystem = "solfeggio";
            
            // Pad Layer 1 (528 Hz)
            s.engines[0].name = "Miracle";
            s.engines[0].synth.oscillatorType = "triangle";
            s.engines[0].synth.solfeggioFrequency = "528";
            s.engines[0].synth.frequency = 528;
            s.engines[0].adsr = { attack: 0.1, decay: 0.5, sustain: 0.8, release: 1.0 };
            s.engines[0].sequence = [1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0];
            s.engines[0].filterDestination = "filter1";
            
            // Pad Layer 2 (639 Hz)
            s.engines[1].name = "Connect";
            s.engines[1].synth.oscillatorType = "sine";
            s.engines[1].synth.solfeggioFrequency = "639";
            s.engines[1].synth.frequency = 639;
            s.engines[1].adsr = { attack: 0.1, decay: 0.5, sustain: 0.7, release: 1.0 };
            s.engines[1].sequence = [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0];
            s.engines[1].filterDestination = "filter1";

            // Texture
            s.engines[2].name = "Texture";
            s.engines[2].synth.enabled = false;
            s.engines[2].noise.enabled = true;
            s.engines[2].noise.noiseType = "pink";
            s.engines[2].noise.volume = 0.1;
            s.engines[2].adsr = { attack: 1.0, decay: 0.5, sustain: 0.5, release: 2.0 };
            s.engines[2].sequence = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
            s.engines[2].filterDestination = "filter2";

            s.filter1.cutoff = 800;
            s.filter1.type = "lowpass";
            s.filter2.cutoff = 2000;
            s.filter2.type = "bandpass";

            // Slow LFO for filter movement
            s.lfos[0].rate = 0.1;
            s.lfos[0].shape = "sine";
            s.lfos[0].depth = 0.3;
            s.lfos[0].routing = { ...DEFAULT_ROUTING, filter1Cutoff: true };

            s.masterEffects = [
                { id: "chorus", type: "chorus", enabled: true, params: { chorus: { rate: 0.5, depth: 0.5, mix: 0.5 } } },
                { id: "verb", type: "reverb", enabled: true, params: { reverb: { decay: 4.0, mix: 0.4 } } }
            ];

            return s;
        })()
    },
    {
        name: "Factory: Polyrhythmic Chaos",
        timestamp: Date.now(),
        data: (() => {
            const s = createDefaultState();
            s.bpm = 110;
            s.scale = "prometheus";
            
            // Engine 1: 5 steps
            s.engines[0].name = "Poly 5";
            s.engines[0].sequencerSteps = 5;
            s.engines[0].sequencerPulses = 2;
            s.engines[0].synth.oscillatorType = "square";
            s.engines[0].synth.frequency = 220;
            s.engines[0].adsr = { attack: 0.01, decay: 0.1, sustain: 0.1, release: 0.1 };
            s.engines[0].useMelodicSequence = true;
            s.engines[0].melodicSequence = [[220], [246.94], [277.18], [329.63], [392]]; // Prometheus scale approx
            s.engines[0].sequence = generateEuclideanPattern(5, 2);
            s.engines[0].filterDestination = "filter1";

            // Engine 2: 7 steps
            s.engines[1].name = "Poly 7";
            s.engines[1].sequencerSteps = 7;
            s.engines[1].sequencerPulses = 3;
            s.engines[1].synth.oscillatorType = "triangle";
            s.engines[1].synth.frequency = 440;
            s.engines[1].adsr = { attack: 0.01, decay: 0.1, sustain: 0.1, release: 0.1 };
            s.engines[1].sequence = generateEuclideanPattern(7, 3);
            s.engines[1].filterDestination = "filter1";

            // Engine 3: 11 steps
            s.engines[2].name = "Poly 11";
            s.engines[2].sequencerSteps = 11;
            s.engines[2].sequencerPulses = 4;
            s.engines[2].synth.oscillatorType = "sine";
            s.engines[2].synth.frequency = 880;
            s.engines[2].adsr = { attack: 0.01, decay: 0.1, sustain: 0.1, release: 0.1 };
            s.engines[2].sequence = generateEuclideanPattern(11, 4);
            s.engines[2].filterDestination = "filter2";

            s.masterEffects = [
                { id: "delay", type: "delay", enabled: true, params: { delay: { time: 0.33, feedback: 0.5, mix: 0.3 } } }
            ];

            return s;
        })()
    },
    {
        name: "Factory: Chiptune Arcade",
        timestamp: Date.now(),
        data: (() => {
            const s = createDefaultState();
            s.bpm = 160;
            s.scale = "pentatonicMajor";
            
            // Lead
            s.engines[0].name = "Lead";
            s.engines[0].synth.oscillatorType = "square";
            s.engines[0].synth.frequency = 440;
            s.engines[0].adsr = { attack: 0.001, decay: 0.1, sustain: 0.1, release: 0.05 };
            s.engines[0].sequence = [1, 0, 1, 1, 0, 1, 0, 1, 1, 0, 1, 1, 0, 1, 0, 1];
            s.engines[0].useMelodicSequence = true;
            // Simple Arp
            s.engines[0].melodicSequence = [[440], [523], [659], [523], [440], [523], [659], [880], [440], [523], [659], [523], [440], [523], [659], [880]];
            s.engines[0].filterDestination = "direct";

            // Bass
            s.engines[1].name = "Bass";
            s.engines[1].synth.oscillatorType = "triangle";
            s.engines[1].synth.frequency = 110;
            s.engines[1].adsr = { attack: 0.001, decay: 0.2, sustain: 0.5, release: 0.1 };
            s.engines[1].sequence = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
            s.engines[1].filterDestination = "direct";

            // Noise Perc
            s.engines[2].name = "Noise";
            s.engines[2].synth.enabled = false;
            s.engines[2].noise.enabled = true;
            s.engines[2].noise.noiseType = "white";
            s.engines[2].adsr = { attack: 0.001, decay: 0.05, sustain: 0, release: 0.01 };
            s.engines[2].sequence = [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0];
            s.engines[2].filterDestination = "direct";

            s.masterEffects = [
                { id: "bitcrush", type: "distortion", enabled: true, params: { distortion: { mode: "foldback", amount: 0.2 } } }
            ];

            return s;
        })()
    },
    {
        name: "Factory: Industrial Noise",
        timestamp: Date.now(),
        data: (() => {
            const s = createDefaultState();
            s.bpm = 130;
            
            // Metallic Drone
            s.engines[0].name = "Drone";
            s.engines[0].synth.oscillatorType = "sawtooth";
            s.engines[0].synth.frequency = 110;
            s.engines[0].adsr = { attack: 0.1, decay: 0.5, sustain: 1, release: 0.5 };
            s.engines[0].sequence = [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
            s.engines[0].filterDestination = "filter1";
            
            // Fast LFO for FM-like texture
            s.lfos[0].rate = 20;
            s.lfos[0].depth = 0.6;
            s.lfos[0].shape = "square";
            s.lfos[0].routing = { ...DEFAULT_ROUTING, engine1SynthFreq: true };

            // Noise Rhythms
            s.engines[1].name = "Static";
            s.engines[1].synth.enabled = false;
            s.engines[1].noise.enabled = true;
            s.engines[1].noise.noiseType = "white";
            s.engines[1].adsr = { attack: 0.01, decay: 0.1, sustain: 0, release: 0.1 };
            s.engines[1].sequence = [1, 1, 0, 1, 1, 0, 1, 1, 0, 1, 1, 0, 1, 1, 0, 1];
            s.engines[1].filterDestination = "filter2";
            
            s.filter1.type = "bandpass";
            s.filter1.cutoff = 500;
            s.filter1.resonance = 10;
            
            s.filter2.type = "highpass";
            s.filter2.cutoff = 4000;

            // Heavy Distortion
            s.masterEffects = [
                { id: "dist", type: "distortion", enabled: true, params: { distortion: { mode: "hard clip", amount: 0.8 } } },
                { id: "verb", type: "reverb", enabled: true, params: { reverb: { decay: 0.5, mix: 0.3 } } }
            ];

            return s;
        })()
    }
];
