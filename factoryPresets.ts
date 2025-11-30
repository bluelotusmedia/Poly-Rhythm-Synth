
// Factory Presets for Poly Rhythm Synth

// Helper to create a default state to avoid repetition
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
        }
    ],
    lfos: [
        { id: "lfo1", name: "LFO 1", rate: 1, depth: 0.5, shape: "sine", sync: true, syncRate: "1/4", routing: { ...DEFAULT_ROUTING } },
        { id: "lfo2", name: "LFO 2", rate: 0.5, depth: 0.5, shape: "triangle", sync: true, syncRate: "1/2", routing: { ...DEFAULT_ROUTING } },
        { id: "lfo3", name: "LFO 3", rate: 0.25, depth: 0.5, shape: "sawtooth", sync: true, syncRate: "1/1", routing: { ...DEFAULT_ROUTING } },
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
    harmonicTuningSystem: "12-TET",
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
    // --- DRUMS ---
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
            s.engines[0].sequencerSteps = 16;
            s.engines[0].sequence = [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0]; // Classic DnB Kick
            s.engines[0].filterDestination = "direct"; // Clean kick

            // Snare (Engine 2)
            s.engines[1].name = "Snare";
            s.engines[1].synth.enabled = false;
            s.engines[1].noise.enabled = true;
            s.engines[1].noise.noiseType = "pink";
            s.engines[1].adsr = { attack: 0.001, decay: 0.15, sustain: 0, release: 0.1 };
            s.engines[1].sequencerSteps = 16;
            s.engines[1].sequence = [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0]; // DnB Snare
            s.engines[1].filterDestination = "direct"; // Clean snare

            // HiHats (Engine 3)
            s.engines[2].name = "Hats";
            s.engines[2].synth.enabled = false;
            s.engines[2].noise.enabled = true;
            s.engines[2].noise.noiseType = "white";
            s.engines[2].adsr = { attack: 0.001, decay: 0.05, sustain: 0, release: 0.05 };
            s.engines[2].sequencerSteps = 16;
            s.engines[2].sequence = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1];
            s.engines[2].filterDestination = "filter2"; // Highpass hats
            
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
            s.engines[0].sequence = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]; // 4/4
            s.engines[0].filterDestination = "direct"; // Clean kick

            // Bass (Offbeat)
            s.engines[1].name = "PsyBass";
            s.engines[1].synth.oscillatorType = "sawtooth";
            s.engines[1].synth.frequency = 60; // Same as kick but saw
            s.engines[1].adsr = { attack: 0.01, decay: 0.1, sustain: 0.4, release: 0.1 };
            s.engines[1].sequence = [0, 1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1]; // KBBB KBBB
            s.engines[1].routing = { ...DEFAULT_ROUTING, filter1Cutoff: true }; // Filter pluck
            s.engines[1].filterDestination = "filter1"; // Filtered bass
            s.filter1.cutoff = 800;
            s.filter1.resonance = 5;
            
            // Perc
            s.engines[2].name = "Zap";
            s.engines[2].synth.oscillatorType = "triangle";
            s.engines[2].synth.frequency = 800;
            s.engines[2].adsr = { attack: 0.001, decay: 0.05, sustain: 0, release: 0.05 };
            s.engines[2].sequence = [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0];
            s.engines[2].filterDestination = "filter2"; // Highpass zap
            
            return s;
        })()
    },
    
    // --- BASS ---
    {
        name: "Factory: Dubstep Wobble",
        timestamp: Date.now(),
        data: (() => {
            const s = createDefaultState();
            s.bpm = 140;
            s.engines[0].name = "Wobble";
            s.engines[0].synth.oscillatorType = "sawtooth";
            s.engines[0].synth.frequency = 55; // Low F
            s.engines[0].adsr = { attack: 0.01, decay: 0.5, sustain: 1, release: 0.5 };
            s.engines[0].routing = { ...DEFAULT_ROUTING, filter1Cutoff: true }; // LFO to Filter
            s.engines[0].sequence = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]; // Simple wobble beat
            s.engines[0].effects = { distortion: 0.4, delayTime: 0.2, delayFeedback: 0.3 }; // Add grit
            s.engines[0].filterDestination = "filter1"; // Route to Filter 1
            
            s.lfos[0].rate = 4; // Faster wobble
            s.lfos[0].depth = 0.8; // Deep modulation
            s.lfos[0].sync = true;
            s.lfos[0].syncRate = "1/8";
            s.lfos[0].shape = "triangle"; // Sharper than sine
            s.lfos[0].routing = { ...DEFAULT_ROUTING, filter1Cutoff: true };
            
            s.filter1.cutoff = 3000; // Higher base to allow for LFO swing
            s.filter1.resonance = 8; // More resonance for bite
            
            // Sub
            s.engines[1].name = "Sub";
            s.engines[1].synth.oscillatorType = "sine";
            s.engines[1].synth.frequency = 55;
            s.engines[1].adsr = { attack: 0.01, decay: 0.1, sustain: 1, release: 0.5 };
            s.engines[1].sequence = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]; // Sub follows kick
            s.engines[1].filterDestination = "direct"; // Clean sub
            
            // Kick
            s.engines[2].name = "Kick";
            s.engines[2].synth.oscillatorType = "sine";
            s.engines[2].synth.frequency = 50;
            s.engines[2].adsr = { attack: 0.001, decay: 0.1, sustain: 0, release: 0.1 };
            s.engines[2].sequence = [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0];
            s.engines[2].filterDestination = "direct"; // Clean kick
            
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
            s.engines[0].sequence = [1, 0, 1, 0, 1, 1, 0, 1, 1, 0, 1, 0, 1, 1, 1, 0]; // Acid line
            s.engines[0].filterDestination = "filter1"; // Acid filter
            
            s.filter1.type = "lowpass";
            s.filter1.cutoff = 2000; // Good base for acid
            s.filter1.resonance = 15; // High resonance is key for Acid
            s.filter1.type = "lowpass";
            
            // Acid usually uses envelope mod, but we'll use LFO for movement
            s.lfos[0].routing = { ...DEFAULT_ROUTING, filter1Cutoff: true };
            s.lfos[0].rate = 0.2; // Slow evolution
            s.lfos[0].depth = 0.6;
            
            // Envelope modulation via LFO (simulated) or just static
            // Let's use LFO 1 as a slow filter sweep
            s.lfos[0].rate = 0.1;
            s.lfos[0].routing = { ...DEFAULT_ROUTING, filter1Cutoff: true };
            
            return s;
        })()
    },

    // --- MELODIC ---
    {
        name: "Factory: Trance Pluck",
        timestamp: Date.now(),
        data: (() => {
            const s = createDefaultState();
            s.bpm = 138;
            s.engines[0].name = "Pluck";
            s.engines[0].synth.oscillatorType = "sawtooth";
            s.engines[0].synth.frequency = 440;
            s.engines[0].adsr = { attack: 0.001, decay: 0.4, sustain: 0, release: 0.4 };
            s.engines[0].effects = { distortion: 0, delayTime: 0.33, delayFeedback: 0.5 }; // Delay
            s.engines[0].filterDestination = "filter1"; // Filtered pluck
            
            s.filter1.cutoff = 600;
            s.filter1.resonance = 2;
            // No envelope to filter modulation directly available in this simple model, 
            // but we can use LFO as envelope if we sync it to note? 
            // Or just rely on volume envelope + static filter.
            
            // Arp pattern
            s.engines[0].sequencerSteps = 16;
            s.engines[0].sequencerSteps = 16;
            s.engines[0].sequence = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1];
            s.engines[0].useMelodicSequence = true;
            // Simple arp
            const root = 440;
            const third = 523.25;
            const fifth = 659.25;
            s.engines[0].melodicSequence = [
                [root], [third], [fifth], [third], [root], [third], [fifth], [third],
                [root], [third], [fifth], [third], [root], [third], [fifth], [third]
            ];
            
            return s;
        })()
    },
    {
        name: "Factory: Lo-Fi Keys",
        timestamp: Date.now(),
        data: (() => {
            const s = createDefaultState();
            s.bpm = 85;
            s.engines[0].name = "Keys";
            s.engines[0].adsr = { attack: 0.01, decay: 0.5, sustain: 0.6, release: 1.5 }; // Crisp attack, long release
            s.engines[0].synth.oscillatorType = "triangle";
            // Add subtle detune via LFO
            s.lfos[0].rate = 0.5;
            s.lfos[0].depth = 0.05; // Subtle pitch wobble
            s.lfos[0].routing = { ...DEFAULT_ROUTING, engine1SynthFreq: true };
            s.engines[0].sequence = [1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]; // Slow keys
            s.engines[0].useMelodicSequence = true;
            s.engines[0].melodicSequence = Array.from({ length: 16 }, () => [261.63]); // C4 drone for now
            s.engines[0].filterDestination = "filter1"; // Filtered keys
            
            // Pitch wobble
            s.lfos[0].rate = 2;
            s.lfos[0].depth = 0.1;
            s.lfos[0].shape = "sine";
            s.lfos[0].routing = { ...DEFAULT_ROUTING, engine1SynthFreq: true };
            
            s.filter1.cutoff = 800;
            s.filter1.type = "lowpass";
            
            return s;
        })()
    },

    // --- SFX ---
    {
        name: "Factory: Space Riser",
        timestamp: Date.now(),
        data: (() => {
            const s = createDefaultState();
            s.bpm = 128;
            s.engines[0].name = "Riser";
            s.engines[0].adsr = { attack: 0.1, decay: 0.5, sustain: 1, release: 2 }; 
            s.engines[0].synth.oscillatorType = "sawtooth";
            s.engines[0].synth.frequency = 110; // Explicit base frequency
            s.engines[0].synth.volume = 0.6;
            // Add some noise for texture
            s.engines[0].noise.enabled = true;
            s.engines[0].noise.volume = 0.1;
            s.engines[0].noise.noiseType = "pink";
            s.engines[0].sequence = [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]; // One long note
            s.engines[0].sequencerSteps = 16;
            s.engines[0].filterDestination = "filter1"; // Filtered riser
            
            // Pitch rising LFO
            s.lfos[0].rate = 0.05; // Very Slow rise
            s.lfos[0].shape = "ramp";
            s.lfos[0].depth = 0.8; // Significant pitch rise (now scaled by 1000 in engine)
            s.lfos[0].routing = { ...DEFAULT_ROUTING, engine1SynthFreq: true };
            
            s.engines[0].effects = { distortion: 0.2, delayTime: 0.2, delayFeedback: 0.6 };
            
            return s;
        })()
    },
    {
        name: "Factory: Glitch Storm",
        timestamp: Date.now(),
        data: (() => {
            const s = createDefaultState();
            s.bpm = 110;
            s.engines[0].name = "Glitch";
            s.engines[0].synth.enabled = true; // Use synth instead of sampler
            s.engines[0].synth.oscillatorType = "square";
            s.engines[0].synth.frequency = 220;
            s.engines[0].adsr = { attack: 0.01, decay: 0.1, sustain: 0.1, release: 0.1 }; // Short blips
            
            // Random LFOs on pitch for computer noise
            s.lfos[0].shape = "sine"; 
            s.lfos[0].rate = 20; // Audio rate FM
            s.lfos[0].depth = 0.5;
            s.lfos[0].routing = { ...DEFAULT_ROUTING, engine1SynthFreq: true };
            
            s.engines[0].sequencerSteps = 16;
            // Random-ish pattern
            s.engines[0].sequence = [1, 0, 1, 1, 0, 1, 0, 1, 1, 0, 1, 0, 1, 1, 0, 1];
            s.engines[0].effects = { distortion: 0.5, delayTime: 0.1, delayFeedback: 0.4 };
            s.engines[0].filterDestination = "filter2"; // Highpass glitch
            
            return s;
        })()
    }
];
