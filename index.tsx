
import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI } from '@google/genai';

// --- Type Definitions ---
type OscillatorType = 'sine' | 'square' | 'sawtooth' | 'triangle';
type NoiseType = 'white' | 'pink' | 'brown';
type LFO_Shape = 'sine' | 'square' | 'sawtooth' | 'triangle' | 'ramp';
type FilterType = 'lowpass' | 'highpass' | 'bandpass' | 'notch';
type RandomizeMode = 'chaos' | 'harmonic' | 'rhythmic';
type EngineLayerType = 'synth' | 'noise' | 'sampler';
type DistortionMode = 'overdrive' | 'soft clip' | 'hard clip' | 'foldback';
type FilterRouting = 'series' | 'parallel';
type VoicingMode = 'poly' | 'mono' | 'legato';


// --- Master Effects Types ---
type MasterEffectType = 'distortion' | 'delay' | 'reverb' | 'chorus' | 'flanger' | 'phaser' | 'tremolo' | 'eq';

interface MasterEffect {
  id: string;
  type: MasterEffectType;
  enabled: boolean;
  params: {
    distortion?: { mode: DistortionMode; amount: number }; // 0 to 1
    delay?: { time: number; feedback: number; mix: number }; // s, 0-1, 0-1
    reverb?: { decay: number; mix: number }; // s, 0-1
    chorus?: { rate: number; depth: number; mix: number }; // Hz, 0-1, 0-1
    flanger?: { rate: number; depth: number; delay: number; feedback: number; mix: number }; // Hz, 0-1, s, 0-1, 0-1
    phaser?: { rate: number; stages: number; q: number; mix: number }; // Hz, 2-12, 0-20, 0-1
    tremolo?: { rate: number; depth: number; shape: LFO_Shape, mix: number }; // Hz, 0-1, LFO_Shape, 0-1
    eq?: { bands: number[] }; // Array of gains in dB
  };
}


// --- New Layered Architecture Types ---
interface SynthLayerState {
    enabled: boolean;
    volume: number;
    frequency: number;
    oscillatorType: OscillatorType;
    solfeggioFrequency: string;
    frequencyOverride: boolean;
}
interface NoiseLayerState {
    enabled: boolean;
    volume: number;
    noiseType: NoiseType;
}
interface SamplerLayerState {
    enabled: boolean;
    volume: number;
    sampleName: string | null;
    transpose: number; // in semitones
    // New Granular Params
    granularModeEnabled: boolean;
    grainSize: number; // in seconds
    grainDensity: number; // grains per second
    playbackPosition: number; // 0 to 1
    positionJitter: number; // 0 to 1
    liveInputEnabled: boolean;
}
interface EffectState {
  distortion: number; // 0 to 1
  delayTime: number; // in seconds
  delayFeedback: number; // 0 to 1
}

interface ADSRState {
    attack: number; // in seconds
    decay: number; // in seconds
    sustain: number; // 0 to 1
    release: number; // in seconds
}

interface LFORoutingState {
    filter1Cutoff: boolean;
    filter1Resonance: boolean;
    filter2Cutoff: boolean;
    filter2Resonance: boolean;
    engine1Vol: boolean;
    engine1SynthFreq: boolean;
    engine1SamplerTranspose: boolean;
    engine1GrainSize: boolean;
    engine1GrainDensity: boolean;
    engine1GrainPosition: boolean;
    engine1GrainJitter: boolean;
    engine2Vol: boolean;
    engine2SynthFreq: boolean;
    engine2SamplerTranspose: boolean;
    engine2GrainSize: boolean;
    engine2GrainDensity: boolean;
    engine2GrainPosition: boolean;
    engine2GrainJitter: boolean;
    engine3Vol: boolean;
    engine3SynthFreq: boolean;
    engine3SamplerTranspose: boolean;
    engine3GrainSize: boolean;
    engine3GrainDensity: boolean;
    engine3GrainPosition: boolean;
    engine3GrainJitter: boolean;
}

interface EngineState {
  id: string;
  name: string;
  synth: SynthLayerState;
  noise: NoiseLayerState;
  sampler: SamplerLayerState;
  midiControlled: boolean;
  sequencerEnabled: boolean;
  sequencerSteps: number;
  sequencerPulses: number;
  sequencerRotate: number;
  sequencerRate: string;
  sequence: number[]; // 0=off, 1=on, 2=tie
  melodicSequence: number[]; // Stores frequencies for each step
  effects: EffectState;
  routing: LFORoutingState;
  adsr: ADSRState;
}

interface LFOState {
    id: string;
    name: string;
    rate: number;
    depth: number;
    shape: LFO_Shape;
    sync: boolean;
    syncRate: string; // e.g. '1/4', '1/8'
    routing: LFORoutingState;
}

// --- Parameter Lock State ---
interface LockState {
    master: { volume: boolean };
    engines: { [id: string]: { [key: string]: boolean | { [key: string]: boolean } } };
    lfos: { [id: string]: { [key: string]: boolean } };
    filter1: { [key: string]: boolean };
    filter2: { [key: string]: boolean };
    masterEffects: { [id: string]: { [key: string]: boolean | { [key: string]: boolean } } };
}

// --- Tuning System Types ---
type TuningSystem = '440_ET' | '432_ET' | 'just_intonation_440' | 'just_intonation_432' | 'pythagorean_440' | 'pythagorean_432' | 'solfeggio' | 'wholesome_scale' | 'maria_renold_I' | 'none';


// --- New Audio Node Types ---
interface LayerAudioNodes {
    sourceNode?: OscillatorNode | AudioBufferSourceNode;
    volumeGain: GainNode;
    // For granular
    granularSchedulerId?: number;
    granularMidiNote?: number;
    liveInputSource?: MediaStreamAudioSourceNode;
}
interface EngineAudioNodes {
    synth: LayerAudioNodes;
    noise: LayerAudioNodes;
    sampler: LayerAudioNodes;
    engineMixer: GainNode;
    sequencerGain: GainNode;
    midiInputGain: GainNode;
    sequencerModSource: ConstantSourceNode; // For modulation routing
    sequencerModGate: GainNode;
    finalOutput: GainNode;
    analyser: AnalyserNode;
    distortion?: WaveShaperNode;
    delay?: DelayNode;
    feedback?: GainNode;
}

interface EngineModBusses {
    vol: GainNode;
    synthFreq: GainNode;
    samplerTranspose: GainNode;
    grainSize: GainNode;
    grainDensity: GainNode;
    grainPosition: GainNode;
    grainJitter: GainNode;
}

interface FilterNodes {
    node: BiquadFilterNode;
    cutoffModBus: GainNode;
    resonanceModBus: GainNode;
}

interface LfoRoutingBusses {
    filter1: { cutoffModBus: GainNode; resonanceModBus: GainNode; };
    filter2: { cutoffModBus: GainNode; resonanceModBus: GainNode; };
    engineModBusses: Map<string, EngineModBusses>;
}

interface ActiveVoice {
    sourceNodes: (OscillatorNode | AudioBufferSourceNode)[];
    envelopeGain: GainNode;
    noiseNodes?: (AudioBufferSourceNode | GainNode)[];
    timeoutId?: number;
}

// --- Component Props ---
interface VisualizerProps {
  analyserNode: AnalyserNode;
  type: 'waveform' | 'frequency';
}

interface CircularVisualizerSequencerProps {
    analyserNode: AnalyserNode;
    steps: number;
    pulses: number;
    rotate: number;
    currentStep: number;
    isTransportPlaying: boolean;
}

interface EngineControlsProps {
  engine: EngineState;
  onUpdate: (engineId: string, updates: Partial<EngineState>) => void;
  onLayerUpdate: <K extends EngineLayerType>(
    engineId: string,
    layer: K,
    updates: Partial<EngineState[K]>
  ) => void;
  onLoadSample: (engineId: string, file: File) => void;
  onRecordSampleRequest: () => Promise<MediaStream | null>;
  onRecordSample: (engineId: string, buffer: AudioBuffer) => void;
  onToggleLiveInput: (engineId: string, enabled: boolean) => void;
  onRandomize: (mode: RandomizeMode, scope: string) => void;
  onInitialize: (scope: string) => void;
  onGenerateSequence: (engineId: string) => void;
  isGenerating: boolean;
  analyserNode?: AnalyserNode;
  currentStep: number;
  isTransportPlaying: boolean;
  audioContext: AudioContext | null;
  lockState: LockState;
  onToggleLock: (path: string) => void;
  harmonicTuningSystem: TuningSystem;
}

interface TopBarProps {
    masterVolume: number;
    setMasterVolume: (volume: number) => void;
    bpm: number;
    setBPM: (bpm: number) => void;
    isTransportPlaying: boolean;
    onToggleTransport: () => void;
    onPanic: () => void;
    midiInputs: MIDIInput[];
    selectedMidiInputId: string | null;
    onMidiInputChange: (id: string) => void;
    midiActivity: boolean;
    lockState: LockState;
    onToggleLock: (path: string) => void;
}

interface MainControlPanelProps {
    onRandomize: (mode: RandomizeMode, scope: 'global' | 'routing') => void;
    isMorphing: boolean;
    morphTime: number;
    setMorphTime: (duration: number) => void;
    isMorphSynced: boolean;
    setIsMorphSynced: (synced: boolean) => void;
    morphSyncRateIndex: number;
    setMorphSyncRateIndex: (index: number) => void;
    syncRates: string[];
    harmonicTuningSystem: TuningSystem;
    setHarmonicTuningSystem: (system: TuningSystem) => void;
    voicingMode: VoicingMode;
    setVoicingMode: (mode: VoicingMode) => void;
    glideTime: number;
    setGlideTime: (time: number) => void;
    isGlideSynced: boolean;
    setIsGlideSynced: (synced: boolean) => void;
    glideSyncRateIndex: number;
    setGlideSyncRateIndex: (index: number) => void;
    glideSyncRates: string[];
    scale: ScaleName;
    setScale: (scale: ScaleName) => void;
    transpose: number;
    setTranspose: (transpose: number) => void;
}


interface FilterState {
    enabled: boolean;
    cutoff: number;
    resonance: number;
    type: FilterType;
}

interface MasterFilterControlsProps {
    title: string;
    filterState: FilterState;
    onUpdate: (updates: Partial<FilterState>) => void;
    onRandomize: (mode: RandomizeMode, scope: string) => void;
    onInitialize: (scope: string) => void;
    lockState: LockState;
    onToggleLock: (path: string) => void;
}

interface LFOControlsProps {
    lfoState: LFOState;
    onUpdate: (updates: Partial<LFOState>) => void;
    onRandomize: (mode: RandomizeMode, scope: string) => void;
    onInitialize: (scope: string) => void;
    bpm: number;
    lockState: LockState;
    onToggleLock: (path: string) => void;
}

interface MasterEffectsProps {
    effects: MasterEffect[];
    setEffects: React.Dispatch<React.SetStateAction<MasterEffect[]>>;
    onRandomize: (mode: RandomizeMode, scope: string) => void;
    onInitialize: (scope: string) => void;
    lockState: LockState;
    onToggleLock: (path: string) => void;
}

interface EffectModuleProps {
    effect: MasterEffect;
    onUpdate: (id: string, params: MasterEffect['params']) => void;
    onRemove: (id: string) => void;
    onToggle: (id: string) => void;
    onRandomize: (mode: RandomizeMode, scope: string) => void;
    onInitialize: (scope: string) => void;
    onDragStart: (e: React.DragEvent<HTMLDivElement>, effect: MasterEffect) => void;
    onDragOver: (e: React.DragEvent<HTMLDivElement>, effect: MasterEffect) => void;
    onDragEnd: (e: React.DragEvent<HTMLDivElement>) => void;
    isDragging: boolean;
    isExpanded: boolean;
    onToggleExpand: (id: string) => void;
    lockState: LockState;
    onToggleLock: (path: string) => void;
}

interface RoutingMatrixProps {
    lfoStates: LFOState[];
    onLfoUpdate: (lfoId: string, updates: Partial<LFOState>) => void;
    engineStates: EngineState[];
    onEngineUpdate: (engineId: string, updates: Partial<EngineState>) => void;
}

interface BottomTabsProps {
    lfoStates: LFOState[];
    handleLfoUpdate: (lfoId: string, updates: Partial<LFOState>) => void;
    engineStates: EngineState[];
    handleEngineUpdate: (engineId: string, updates: Partial<EngineState>) => void;
    onRandomize: (mode: RandomizeMode, scope: string) => void;
    onInitialize: (scope: string) => void;
    bpm: number;
    lockState: LockState;
    onToggleLock: (path: string) => void;
}


// --- Constants ---
const solfeggioFrequenciesData = [
  { value: 174, label: '174 Hz - Foundation' }, { value: 285, label: '285 Hz - Restoration' },
  { value: 396, label: '396 Hz - Liberation' }, { value: 417, label: '417 Hz - Transformation' },
  { value: 528, label: '528 Hz - Miracle' }, { value: 639, label: '639 Hz - Connection' },
  { value: 741, label: '741 Hz - Intuition' }, { value: 852, label: '852 Hz - Awakening' },
  { value: 963, label: '963 Hz - Oneness' },
];
const solfeggioFrequencies = solfeggioFrequenciesData.map(f => f.value);
const wholesomeScaleFrequencies = [192, 216, 240, 256, 288, 320, 360]; // G Major Diatonic with integer frequencies
const mariaRenoldFrequencies = [256, 271.53, 288, 305.47, 324, 341.33, 362.04, 384, 407.29, 432, 458.21, 486];

const musicalScales = {
    major: [0, 2, 4, 5, 7, 9, 11],
    minor: [0, 2, 3, 5, 7, 8, 10],
    pentatonicMajor: [0, 2, 4, 7, 9],
    pentatonicMinor: [0, 3, 5, 7, 10],
    chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
};
type ScaleName = keyof typeof musicalScales;

const justIntonationRatios = [1/1, 9/8, 5/4, 4/3, 3/2, 5/3, 15/8];
const pythagoreanRatios = [1/1, 9/8, 81/64, 4/3, 3/2, 27/16, 243/128];

const oscillatorTypes: readonly OscillatorType[] = ['sine', 'square', 'sawtooth', 'triangle'];
const lfoShapes: readonly LFO_Shape[] = ['sine', 'square', 'sawtooth', 'ramp', 'triangle'];
const filterTypes: readonly FilterType[] = ['lowpass', 'highpass', 'bandpass', 'notch'];
const lfoSyncRates = ['1/16', '1/8', '1/4', '1/2', '1'];
const sequencerRates = ['1/32', '1/16', '1/8', '1/4'];
const delaySyncRates = ['1/16', '1/8', '1/8d', '1/4', '1/4d', '1/2'];
const noiseTypes: readonly NoiseType[] = ['white', 'pink', 'brown'];
const distortionModes: readonly DistortionMode[] = ['overdrive', 'soft clip', 'hard clip', 'foldback'];
const availableMasterEffects: MasterEffectType[] = ['distortion', 'delay', 'reverb', 'chorus', 'flanger', 'phaser', 'tremolo', 'eq'];
const eqFrequencies = [60, 150, 400, 1000, 2400, 6000, 10000, 15000];

// --- Default State & Hydration ---
const DEFAULT_LFO_ROUTING_STATE: LFORoutingState = {
    filter1Cutoff: false, filter1Resonance: false, filter2Cutoff: false, filter2Resonance: false,
    engine1Vol: false, engine1SynthFreq: false, engine1SamplerTranspose: false, engine1GrainSize: false, engine1GrainDensity: false, engine1GrainPosition: false, engine1GrainJitter: false,
    engine2Vol: false, engine2SynthFreq: false, engine2SamplerTranspose: false, engine2GrainSize: false, engine2GrainDensity: false, engine2GrainPosition: false, engine2GrainJitter: false,
    engine3Vol: false, engine3SynthFreq: false, engine3SamplerTranspose: false, engine3GrainSize: false, engine3GrainDensity: false, engine3GrainPosition: false, engine3GrainJitter: false,
};

const getInitialState = () => {
    const engines = [
        { id: 'engine1', name: 'E1', sequencerSteps: 16, sequencerPulses: 4, sequencerRotate: 0, sequencerRate: '1/16', sequencerEnabled: true, midiControlled: true,
          synth: { enabled: true, volume: 0.7, frequency: 220, oscillatorType: 'sine' as OscillatorType, solfeggioFrequency: '528', frequencyOverride: false },
          noise: { enabled: false, volume: 0.2, noiseType: 'white' as NoiseType },
          sampler: { enabled: false, volume: 0.8, sampleName: null, transpose: 0, granularModeEnabled: false, grainSize: 0.1, grainDensity: 10, playbackPosition: 0, positionJitter: 0, liveInputEnabled: false },
          effects: { distortion: 0, delayTime: 0.5, delayFeedback: 0.3 },
          routing: { ...DEFAULT_LFO_ROUTING_STATE },
          adsr: { attack: 0.01, decay: 0.2, sustain: 0.8, release: 0.5 },
          melodicSequence: Array(16).fill(220), // Default melodic sequence
        },
        { id: 'engine2', name: 'E2', sequencerSteps: 12, sequencerPulses: 3, sequencerRotate: 0, sequencerRate: '1/16', sequencerEnabled: true, midiControlled: true,
          synth: { enabled: true, volume: 0.7, frequency: 440, oscillatorType: 'sawtooth' as OscillatorType, solfeggioFrequency: '417', frequencyOverride: false },
          noise: { enabled: false, volume: 0.2, noiseType: 'pink' as NoiseType },
          sampler: { enabled: false, volume: 0.8, sampleName: null, transpose: 0, granularModeEnabled: false, grainSize: 0.1, grainDensity: 10, playbackPosition: 0, positionJitter: 0, liveInputEnabled: false },
          effects: { distortion: 0, delayTime: 0.25, delayFeedback: 0.4 },
          routing: { ...DEFAULT_LFO_ROUTING_STATE },
          adsr: { attack: 0.02, decay: 0.3, sustain: 0.7, release: 0.8 },
          melodicSequence: Array(12).fill(440), // Default melodic sequence
        },
        { id: 'engine3', name: 'E3', sequencerSteps: 7, sequencerPulses: 2, sequencerRotate: 0, sequencerRate: '1/16', sequencerEnabled: true, midiControlled: true,
          synth: { enabled: true, volume: 0.7, frequency: 110, oscillatorType: 'square' as OscillatorType, solfeggioFrequency: '396', frequencyOverride: false },
          noise: { enabled: false, volume: 0.2, noiseType: 'brown' as NoiseType },
          sampler: { enabled: false, volume: 0.8, sampleName: null, transpose: 0, granularModeEnabled: false, grainSize: 0.1, grainDensity: 10, playbackPosition: 0, positionJitter: 0, liveInputEnabled: false },
          effects: { distortion: 0, delayTime: 0.75, delayFeedback: 0.2 },
          routing: { ...DEFAULT_LFO_ROUTING_STATE },
          adsr: { attack: 0.1, decay: 0.1, sustain: 0.9, release: 0.3 },
          melodicSequence: Array(7).fill(110), // Default melodic sequence
        },
    ];

    const enginesWithSequences = engines.map(engine => {
        const pattern = generateEuclideanPattern(engine.sequencerSteps, engine.sequencerPulses);
        const sequence = rotatePattern(pattern, engine.sequencerRotate);
        return { ...engine, sequence };
    });

    return {
        engines: enginesWithSequences,
        lfos: [
            { id: 'lfo1', name: 'LFO 1', rate: 5, depth: 0.5, shape: 'sine' as LFO_Shape, sync: false, syncRate: '1/4', routing: { ...DEFAULT_LFO_ROUTING_STATE } },
            { id: 'lfo2', name: 'LFO 2', rate: 2, depth: 0.6, shape: 'square' as LFO_Shape, sync: false, syncRate: '1/8', routing: { ...DEFAULT_LFO_ROUTING_STATE } },
            { id: 'lfo3', name: 'LFO 3', rate: 0.3, depth: 0.7, shape: 'sawtooth' as LFO_Shape, sync: true, syncRate: '1/2', routing: { ...DEFAULT_LFO_ROUTING_STATE } },
        ],
        filter1: { enabled: false, cutoff: 20000, resonance: 0, type: 'lowpass' as FilterType },
        filter2: { enabled: false, cutoff: 20, resonance: 0, type: 'highpass' as FilterType },
        filterRouting: 'series' as FilterRouting,
        masterEffects: [] as MasterEffect[],
    };
};

const getInitialLockState = (): LockState => {
    const initialState = getInitialState();
    return {
        master: { volume: true },
        engines: Object.fromEntries(initialState.engines.map(e => [e.id, {
            sequencerSteps: false, sequencerPulses: false, sequencerRotate: false, sequencerRate: false,
            synth: { volume: true, oscillatorType: false, solfeggioFrequency: false, frequency: false },
            noise: { volume: true, noiseType: false },
            sampler: { volume: true, transpose: false, grainSize: false, grainDensity: false, playbackPosition: false, positionJitter: false },
            adsr: { attack: true, decay: true, sustain: true, release: true }
        }])),
        lfos: Object.fromEntries(initialState.lfos.map(l => [l.id, {
            rate: false, depth: false, shape: false, sync: false, syncRate: false
        }])),
        filter1: { cutoff: false, resonance: false, type: false },
        filter2: { cutoff: false, resonance: false, type: false },
        masterEffects: {} // Populated dynamically
    };
};

const getDefaultEffectParams = (type: MasterEffectType): MasterEffect['params'] => {
    switch(type) {
        case 'distortion': return { distortion: { mode: 'overdrive', amount: 0.5 } };
        case 'delay': return { delay: { time: 0.5, feedback: 0.4, mix: 0.5 } };
        case 'reverb': return { reverb: { decay: 2, mix: 0.5 } };
        case 'chorus': return { chorus: { rate: 1.5, depth: 0.5, mix: 0.7 } };
        case 'flanger': return { flanger: { rate: 0.5, depth: 0.8, delay: 0.005, feedback: 0.5, mix: 0.5 } };
        case 'phaser': return { phaser: { rate: 1.2, stages: 4, q: 10, mix: 0.7 } };
        case 'tremolo': return { tremolo: { rate: 5, depth: 0.8, shape: 'sine', mix: 1 } };
        case 'eq': return { eq: { bands: Array(8).fill(0) } };
        default: return {};
    }
};

// --- Utility Functions ---
const generateEuclideanPattern = (steps: number, pulses: number): number[] => {
    if (pulses > steps || pulses <= 0 || steps <= 0) {
        return new Array(steps).fill(0);
    }
    const pattern: number[][] = [];
    for (let i = 0; i < steps; i++) {
        pattern.push(i < pulses ? [1] : [0]);
    }
    while (true) {
        let q = Math.floor((pattern.length - pulses) / pulses);
        if (q === 0) break;
        let elementsToMove = pattern.splice(pulses);
        for (let i = 0; i < elementsToMove.length; i++) {
            pattern[i % pulses].push(...elementsToMove[i]);
        }
    }
    return pattern.flat();
};

const rotatePattern = (pattern: number[], rotation: number): number[] => {
    const len = pattern.length;
    if (len === 0) return [];
    const offset = ((rotation % len) + len) % len;
    return [...pattern.slice(len - offset), ...pattern.slice(0, len - offset)];
};

const getRandom = (min: number, max: number) => Math.random() * (max - min) + min;
const getRandomInt = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;
const getRandomBool = (probability = 0.5) => Math.random() < probability;
function getRandomElement<T>(arr: readonly T[] | T[]): T {
    return arr[Math.floor(Math.random() * arr.length)];
}

function shuffleArray<T>(array: T[]): T[] {
    const newArray = [...array];
    for (let i = newArray.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
    }
    return newArray;
}

const getNoteFromScale = (rootFreq: number, ratios: number[], octaves: number) => {
    const octave = getRandomInt(0, octaves - 1);
    const ratio = getRandomElement(ratios);
    return rootFreq * ratio * Math.pow(2, octave);
};

function makeDistortionCurve(amount: number, mode: DistortionMode, n_samples = 44100) {
    const k = amount * 100;
    const deg = Math.PI / 180;
    const curve = new Float32Array(n_samples);
    let x;
    for (let i = 0; i < n_samples; ++i) {
        x = i * 2 / n_samples - 1;
        switch (mode) {
            case 'overdrive':
                curve[i] = (1 + k) * x / (1 + k * Math.abs(x));
                break;
            case 'soft clip':
                curve[i] = Math.tanh(x * (k / 10 + 1));
                break;
            case 'hard clip':
                curve[i] = Math.max(-1, Math.min(1, x * (k / 10 + 1)));
                break;
            case 'foldback':
                curve[i] = Math.abs(x) > 0.5 ? Math.sin(x * Math.PI * (k/20 + 1)) : x;
                break;
        }
    }
    return curve;
}

function makeReverbImpulse(audioContext: AudioContext, duration: number, decay: number) {
    const sampleRate = audioContext.sampleRate;
    const length = sampleRate * duration;
    const impulse = audioContext.createBuffer(2, length, sampleRate);
    const impulseL = impulse.getChannelData(0);
    const impulseR = impulse.getChannelData(1);

    for (let i = 0; i < length; i++) {
        impulseL[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
        impulseR[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
    }
    return impulse;
}

const midiNoteToFrequency = (note: number, tuning: TuningSystem): number => {
    switch (tuning) {
        case '440_ET':
            return 440 * Math.pow(2, (note - 69) / 12);
        case '432_ET':
            return 432 * Math.pow(2, (note - 69) / 12);
        
        case 'just_intonation_440':
        case 'just_intonation_432':
        case 'pythagorean_440':
        case 'pythagorean_432': {
            const rootA = tuning.endsWith('432') ? 432 : 440;
            const ratios = tuning.startsWith('just') ? justIntonationRatios : pythagoreanRatios;
            const c4RootFreq = rootA / ratios[5]; // A4 is the 6th degree of C maj (5/3 or 27/16)
            
            const octave = Math.floor(note / 12) - 5; // Octave relative to C4 (MIDI note 60)
            const semi = note % 12;
            
            const cMajorScaleSteps = [0, 2, 4, 5, 7, 9, 11];
            let scaleDegreeIndex = -1;
            let currentSemi = semi;
            while(scaleDegreeIndex === -1 && currentSemi >= 0) {
                scaleDegreeIndex = cMajorScaleSteps.indexOf(currentSemi);
                if (scaleDegreeIndex === -1) currentSemi--;
            }
            if (scaleDegreeIndex === -1) scaleDegreeIndex = 0; // fallback
            
            const ratio = ratios[scaleDegreeIndex];
            return c4RootFreq * ratio * Math.pow(2, octave);
        }

        case 'solfeggio': {
             const octave = Math.floor(note / 12) - 4; 
             const semi = note % 12;
             const solfeggioBase = [396, 417, 528, 639, 741, 852, 963, 174, 285];
             const noteIndex = Math.floor(semi / 12 * solfeggioBase.length);
             return solfeggioBase[noteIndex] * Math.pow(2, octave);
        }
        case 'wholesome_scale': { // G Major
            const gMajorScaleSteps = [0, 2, 4, 5, 7, 9, 11]; // relative to G
            const noteInG = note - 67; // MIDI G4
            const octave = Math.floor(noteInG / 12);
            const semi = (noteInG % 12 + 12) % 12;

            let scaleDegreeIndex = -1;
            let currentSemi = semi;
            while(scaleDegreeIndex === -1 && currentSemi >= 0) {
                scaleDegreeIndex = gMajorScaleSteps.indexOf(currentSemi);
                 if (scaleDegreeIndex === -1) currentSemi--;
            }
            if (scaleDegreeIndex === -1) scaleDegreeIndex = 0;
            return wholesomeScaleFrequencies[scaleDegreeIndex] * Math.pow(2, octave);
        }
        case 'maria_renold_I': {
            const baseOctave = 4; // C4 is MIDI note 60
            const midiNoteC4 = 60;
            const octaveOffset = Math.floor((note - midiNoteC4) / 12);
            const semi = (note - midiNoteC4) % 12;
            const frequency = mariaRenoldFrequencies[semi];
            return frequency * Math.pow(2, octaveOffset);
        }
        default:
             return 440 * Math.pow(2, (note - 69) / 12);
    }
};

// --- Components ---

const Visualizer: React.FC<VisualizerProps> = ({ analyserNode, type }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const canvasCtx = canvas.getContext('2d');
    if (!canvasCtx) return;
    let animationFrameId: number;

    const draw = () => {
      const { width, height } = canvas;
      
      canvasCtx.fillStyle = '#191924'; // --background-color
      canvasCtx.fillRect(0, 0, width, height);

      // Draw grid
      canvasCtx.strokeStyle = 'rgba(0, 245, 212, 0.1)';
      canvasCtx.lineWidth = 1;
      const gridSize = 20;
      for (let i = gridSize; i < width; i += gridSize) {
        canvasCtx.beginPath();
        canvasCtx.moveTo(i, 0);
        canvasCtx.lineTo(i, height);
        canvasCtx.stroke();
      }
      for (let i = gridSize; i < height; i += gridSize) {
        canvasCtx.beginPath();
        canvasCtx.moveTo(0, i);
        canvasCtx.lineTo(width, i);
        canvasCtx.stroke();
      }
      
      if (type === 'waveform') {
        analyserNode.fftSize = 2048;
        const bufferLength = analyserNode.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        analyserNode.getByteTimeDomainData(dataArray);

        canvasCtx.lineWidth = 2;
        canvasCtx.strokeStyle = '#00f5d4'; // --secondary-color
        
        // Glow effect
        canvasCtx.shadowColor = '#00f5d4';
        canvasCtx.shadowBlur = 5;

        canvasCtx.beginPath();
        const sliceWidth = width * 1.0 / bufferLength;
        let x = 0;

        for (let i = 0; i < bufferLength; i++) {
            const v = dataArray[i] / 128.0;
            const y = v * height / 2;
            if (i === 0) {
                canvasCtx.moveTo(x, y);
            } else {
                canvasCtx.lineTo(x, y);
            }
            x += sliceWidth;
        }
        canvasCtx.lineTo(canvas.width, canvas.height / 2);
        canvasCtx.stroke();
        
        // Reset shadow for next draw cycle
        canvasCtx.shadowBlur = 0;
      }
      animationFrameId = requestAnimationFrame(draw);
    };

    draw();

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [analyserNode, type]);

  return <canvas ref={canvasRef} className="visualizer" />;
};


const CircularVisualizerSequencer: React.FC<CircularVisualizerSequencerProps> = ({
    analyserNode, steps, pulses, rotate, currentStep, isTransportPlaying
}) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const pattern = useMemo(() => rotatePattern(generateEuclideanPattern(steps, pulses), rotate), [steps, pulses, rotate]);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        let animationFrameId: number;

        const grad = ctx.createLinearGradient(0, 0, 200, 200);
        grad.addColorStop(0, '#a45ee5'); // --primary-color
        grad.addColorStop(1, '#00f5d4'); // --secondary-color

        const draw = () => {
            const { width, height } = canvas;
            const centerX = width / 2;
            const centerY = height / 2;
            const radius = Math.min(width, height) / 2 - 10;

            ctx.clearRect(0, 0, width, height);

            // Draw sequencer ring
            for (let i = 0; i < steps; i++) {
                const angle = (i / steps) * 2 * Math.PI - Math.PI / 2;
                const x = centerX + radius * Math.cos(angle);
                const y = centerY + radius * Math.sin(angle);
                ctx.beginPath();
                if (pattern[i]) {
                    ctx.fillStyle = '#00f5d4'; // Active step
                    ctx.arc(x, y, 5, 0, 2 * Math.PI);
                } else {
                    ctx.fillStyle = '#3a3a50'; // Inactive step
                    ctx.arc(x, y, 3, 0, 2 * Math.PI);
                }
                ctx.fill();
            }

            if (isTransportPlaying) {
                const stepInPattern = currentStep;
                const angle = (stepInPattern / steps) * 2 * Math.PI - Math.PI / 2;
                const x = centerX + radius * Math.cos(angle);
                const y = centerY + radius * Math.sin(angle);
                ctx.beginPath();
                ctx.fillStyle = '#fff';
                ctx.arc(x, y, 7, 0, 2 * Math.PI);
                ctx.fill();
            }
            
            analyserNode.fftSize = 256;
            const bufferLength = analyserNode.frequencyBinCount;
            const dataArray = new Uint8Array(bufferLength);
            analyserNode.getByteFrequencyData(dataArray);
            
            const innerRadius = radius * 0.6;
            for (let i = 0; i < bufferLength; i++) {
                const barHeight = (dataArray[i] / 255) * (radius - innerRadius);
                const angle = (i / bufferLength) * 2 * Math.PI;
                const x1 = centerX + innerRadius * Math.cos(angle);
                const y1 = centerY + innerRadius * Math.sin(angle);
                const x2 = centerX + (innerRadius + barHeight) * Math.cos(angle);
                const y2 = centerY + (innerRadius + barHeight) * Math.sin(angle);
                
                ctx.strokeStyle = grad;
                ctx.lineWidth = 3;
                ctx.beginPath();
                ctx.moveTo(x1, y1);
                ctx.lineTo(x2, y2);
                ctx.stroke();
            }

            animationFrameId = requestAnimationFrame(draw);
        };
        draw();
        return () => cancelAnimationFrame(animationFrameId);

    }, [analyserNode, pattern, currentStep, isTransportPlaying, steps]);

    return <canvas ref={canvasRef} width="200" height="200" className="visualizer" />;
};

const ChaosIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
      <path d="M20.5 3.4A1.5 1.5 0 0 0 19 2H5a1.5 1.5 0 0 0-1.5 1.5v14a1.5 1.5 0 0 0 1.5 1.5h14a1.5 1.5 0 0 0 1.5-1.5zM8 12a1.5 1.5 0 1 1-1.5-1.5A1.5 1.5 0 0 1 8 12zm4-4a1.5 1.5 0 1 1-1.5-1.5A1.5 1.5 0 0 1 12 8zm0 8a1.5 1.5 0 1 1-1.5-1.5A1.5 1.5 0 0 1 12 16zm4-4a1.5 1.5 0 1 1-1.5-1.5A1.5 1.5 0 0 1 16 12z"></path>
    </svg>
);
const HarmonicIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
      <path d="M15.75,7.5a1.5,1.5,0,0,1-3,0A1.5,1.5,0,0,1,15.75,7.5Zm-6,0a1.5,1.5,0,0,1-3,0A1.5,1.5,0,0,1,9.75,7.5Zm-6,0a1.5,1.5,0,0,1-3,0A1.5,1.5,0,0,1,3.75,7.5ZM21.75,12a1.5,1.5,0,0,0,0-3H2.25a1.5,1.5,0,0,0,0,3ZM15.75,16.5a1.5,1.5,0,0,1-3,0A1.5,1.5,0,0,1,15.75,16.5Zm-6,0a1.5,1.5,0,0,1-3,0A1.5,1.5,0,0,1,9.75,16.5Zm-6,0a1.5,1.5,0,0,1-3,0A1.5,1.5,0,0,1,3.75,16.5Z"></path>
    </svg>
);
const RhythmicIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
      <path d="M2.25,12a1.5,1.5,0,0,0,3,0H2.25Zm16.5,0a1.5,1.5,0,0,0,3,0H18.75ZM10.5,12a1.5,1.5,0,0,0,3,0H10.5ZM12,21.75a1.5,1.5,0,0,0,0-3v3Zm0-16.5a1.5,1.5,0,0,0,0-3v3ZM12,6h0a1.5,1.5,0,0,0-3,0H12Zm0,12h0a1.5,1.5,0,0,0-3,0H12ZM6,12h0a1.5,1.5,0,0,0-3,0H6Zm12,0h0a1.5,1.5,0,0,0-3,0H18Z"></path>
    </svg>
);
const InitializeIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2.5A9.5 9.5 0 0 0 2.5 12a1.5 1.5 0 0 0 3 0A6.5 6.5 0 0 1 12 5.5a1.5 1.5 0 0 0 0-3Zm0 19A9.5 9.5 0 0 0 21.5 12a1.5 1.5 0 0 0-3 0A6.5 6.5 0 0 1 12 18.5a1.5 1.5 0 0 0 0 3Z"></path>
    </svg>
);
const LockIcon = ({ isLocked, onClick, title }: { isLocked: boolean; onClick: () => void; title: string }) => (
    <button className={`lock-icon ${isLocked ? 'locked' : ''}`} onClick={onClick} title={title}>
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
            {isLocked ? (
                <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"></path>
            ) : (
                <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6h2c0-1.65 1.35-3 3-3s3 1.35 3 3v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z"></path>
            )}
        </svg>
    </button>
);


const AccordionIcon = ({ isExpanded }: { isExpanded: boolean }) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" style={{ width: '16px', height: '16px', transition: 'transform 0.2s', transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)' }}>
      <path d="M10 17l5-5-5-5v10z" />
    </svg>
);


const TopBar: React.FC<TopBarProps> = ({
    masterVolume, setMasterVolume, bpm, setBPM, isTransportPlaying, onToggleTransport, onPanic,
    midiInputs, selectedMidiInputId, onMidiInputChange, midiActivity, lockState, onToggleLock
}) => {
    return (
        <div className="top-bar">
            <div className="top-bar-group">
                <h2>Poly-Rhythm Synth</h2>
            </div>
             <div className="top-bar-group">
                <label>MIDI Input</label>
                <div className="midi-indicator" style={{ backgroundColor: midiActivity ? 'var(--secondary-color)' : '#333' }} />
                <select value={selectedMidiInputId || ''} onChange={(e) => onMidiInputChange(e.target.value)} disabled={midiInputs.length === 0}>
                    <option value="">{midiInputs.length > 0 ? 'Select Device' : 'No MIDI Devices'}</option>
                    {midiInputs.map(input => (
                        <option key={input.id} value={input.id}>{input.name}</option>
                    ))}
                </select>
            </div>
            <div className="top-bar-group">
                 <label>Master</label>
                 <div className="control-with-lock">
                    <input type="range" min="0" max="1" step="0.01" value={masterVolume} onChange={e => setMasterVolume(parseFloat(e.target.value))} disabled={lockState.master.volume} />
                    <LockIcon isLocked={lockState.master.volume} onClick={() => onToggleLock('master.volume')} title="Lock Master Volume" />
                 </div>
            </div>
            <div className="top-bar-group">
                <label>BPM</label>
                <input type="range" min="30" max="240" step="1" value={bpm} onChange={e => setBPM(parseInt(e.target.value))} />
                <span>{bpm}</span>
            </div>
            <div className="top-bar-group">
                <button onClick={onToggleTransport} className={isTransportPlaying ? 'active' : ''}>
                    {isTransportPlaying ? 'Stop' : 'Play'}
                </button>
                <button onClick={onPanic} className="panic-button">Panic</button>
            </div>
        </div>
    );
};

const MainControlPanel: React.FC<MainControlPanelProps> = ({
    onRandomize, isMorphing, morphTime, setMorphTime,
    isMorphSynced, setIsMorphSynced, morphSyncRateIndex, setMorphSyncRateIndex,
    harmonicTuningSystem, setHarmonicTuningSystem, voicingMode, setVoicingMode, glideTime, setGlideTime,
    isGlideSynced, setIsGlideSynced, glideSyncRateIndex, setGlideSyncRateIndex, glideSyncRates, syncRates,
    scale, setScale, transpose, setTranspose
}) => {
    return (
        <div className="main-control-panel">
            <div className="sub-control-group">
                <h2>Generative Tools</h2>
                <div className="control-row">
                    <label>Harmonic Mode</label>
                    <select value={harmonicTuningSystem} onChange={e => setHarmonicTuningSystem(e.target.value as TuningSystem)}>
                        <option value="440_ET">440Hz Equal Temperament</option>
                        <option value="432_ET">432Hz Equal Temperament</option>
                        <option value="just_intonation_440">Just Intonation (A=440)</option>
                        <option value="just_intonation_432">Just Intonation (A=432)</option>
                        <option value="pythagorean_440">Pythagorean (A=440)</option>
                        <option value="pythagorean_432">Pythagorean (A=432)</option>
                        <option value="solfeggio">Solfeggio Frequencies</option>
                        <option value="wholesome_scale">Wholesome Scale (G Maj)</option>
                        <option value="maria_renold_I">Maria Renold I</option>
                        <option value="none">None</option>
                    </select>
                </div>
                <div className="control-row">
                    <label>Random Morph</label>
                    <div className="randomizer-buttons-group">
                        <button className="icon-button" onClick={() => onRandomize('chaos', 'global')} title="Chaos Morph"><ChaosIcon /></button>
                        <button className="icon-button" onClick={() => onRandomize('harmonic', 'global')} title="Harmonic Morph"><HarmonicIcon /></button>
                        <button className="icon-button" onClick={() => onRandomize('rhythmic', 'global')} title="Rhythmic Morph"><RhythmicIcon /></button>
                    </div>
                </div>
                 <div className="control-row">
                    <label>Morph Time</label>
                    <div className="control-value-wrapper">
                         <input type="range" min="100" max="8000" step="10" value={morphTime} onChange={e => setMorphTime(parseFloat(e.target.value))} disabled={isMorphing || isMorphSynced} />
                         <span>{morphTime.toFixed(0)}ms</span>
                    </div>
                     <button className={`small ${isMorphSynced ? 'active' : ''}`} onClick={() => setIsMorphSynced(!isMorphSynced)}>Sync</button>
                     {isMorphSynced && (
                         <select value={morphSyncRateIndex} onChange={e => setMorphSyncRateIndex(parseInt(e.target.value))}>
                             {syncRates.map((rate, i) => <option key={i} value={i}>{rate}</option>)}
                         </select>
                     )}
                </div>
            </div>
            <div className="sub-control-group">
                 <h2>Voicing & Glide</h2>
                 <div className="voicing-switch">
                    <button className={voicingMode === 'poly' ? 'active' : ''} onClick={() => setVoicingMode('poly')}>Poly</button>
                    <button className={voicingMode === 'mono' ? 'active' : ''} onClick={() => setVoicingMode('mono')}>Mono</button>
                    <button className={voicingMode === 'legato' ? 'active' : ''} onClick={() => setVoicingMode('legato')}>Legato</button>
                </div>
                 <div className="control-value-wrapper">
                    <input type="range" min="0" max="2000" step="1" value={glideTime} onChange={e => setGlideTime(parseFloat(e.target.value))} disabled={isGlideSynced} />
                    <span>{glideTime.toFixed(0)}ms</span>
                </div>
                <button className={`small ${isGlideSynced ? 'active' : ''}`} onClick={() => setIsGlideSynced(!isGlideSynced)}>Sync</button>
                 {isGlideSynced && (
                     <select value={glideSyncRateIndex} onChange={e => setGlideSyncRateIndex(parseInt(e.target.value))}>
                         {glideSyncRates.map((rate, i) => <option key={i} value={i}>{rate}</option>)}
                     </select>
                 )}
            </div>
            <div className="sub-control-group">
                <h2>Global Settings</h2>
                {harmonicTuningSystem !== 'solfeggio' && harmonicTuningSystem !== 'wholesome_scale' && (
                    <div className="control-row">
                        <label>Scale</label>
                        <select value={scale} onChange={e => setScale(e.target.value as ScaleName)}>
                            {Object.keys(musicalScales).map(scaleName => (
                                <option key={scaleName} value={scaleName}>{scaleName}</option>
                            ))}
                        </select>
                    </div>
                )}
                <div className="control-row">
                    <label>Transpose</label>
                    <div className="control-value-wrapper">
                        <input type="range" min="-24" max="24" step="1" value={transpose} onChange={e => setTranspose(parseInt(e.target.value))} />
                        <span>{transpose} st</span>
                    </div>
                </div>
            </div>
        </div>
    );
};


const EngineControls: React.FC<EngineControlsProps> = ({
    engine, onUpdate, onLayerUpdate, onLoadSample, onRecordSampleRequest, onRecordSample, onToggleLiveInput, onRandomize, onInitialize, onGenerateSequence, isGenerating,
    analyserNode, currentStep, isTransportPlaying, audioContext, lockState, onToggleLock, harmonicTuningSystem
}) => {
    const [activeTab, setActiveTab] = useState<EngineLayerType>('synth');
    const dropZoneRef = useRef<HTMLDivElement>(null);

    const [isRecording, setIsRecording] = useState(false);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const recordedChunksRef = useRef<Blob[]>([]);
    
    const getLock = (path: string): boolean => {
        const parts = path.split('.');
        let current: any = lockState;
        for (const part of parts) {
            if (current === undefined) return false;
            current = current[part];
        }
        return !!current;
    };

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'copy';
        dropZoneRef.current?.classList.add('drop-zone-active');
    };
    const handleDragLeave = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        dropZoneRef.current?.classList.remove('drop-zone-active');
    };
    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        dropZoneRef.current?.classList.remove('drop-zone-active');
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            onLoadSample(engine.id, e.dataTransfer.files[0]);
            e.dataTransfer.clearData();
        }
    };

    const handleRecordClick = async () => {
        if (isRecording) {
            mediaRecorderRef.current?.stop();
            setIsRecording(false);
        } else {
            const stream = await onRecordSampleRequest();
            if (!stream) return; // Permission denied or failed

            mediaRecorderRef.current = new MediaRecorder(stream);
            recordedChunksRef.current = [];

            mediaRecorderRef.current.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    recordedChunksRef.current.push(event.data);
                }
            };
            mediaRecorderRef.current.onstop = async () => {
                const blob = new Blob(recordedChunksRef.current, { type: 'audio/webm' });
                const arrayBuffer = await blob.arrayBuffer();
                if (audioContext) {
                    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
                    onRecordSample(engine.id, audioBuffer);
                }
            };
            mediaRecorderRef.current.start();
            setIsRecording(true);
        }
    };

    const handleAdsrUpdate = (param: keyof ADSRState, value: number) => {
        onUpdate(engine.id, { adsr: { ...engine.adsr, [param]: value } });
    };

    return (
        <div className="control-group">
            <div className="control-group-header">
                <div className="engine-header-top-bar">
                    <div className="engine-title-group">
                        <h2>{engine.name}</h2>
                        <button
                            className={`small seq-toggle ${engine.sequencerEnabled ? 'active' : ''}`}
                            onClick={() => onUpdate(engine.id, { sequencerEnabled: !engine.sequencerEnabled })}
                        >
                            SEQ
                        </button>
                        <button
                            className={`small midi-toggle ${engine.midiControlled ? 'active' : ''}`}
                            onClick={() => onUpdate(engine.id, { midiControlled: !engine.midiControlled })}
                        >
                            MIDI
                        </button>
                    </div>
                    <div className="randomizer-buttons-group">
                        <button className="icon-button init-button" onClick={() => onInitialize(engine.id)} title="Initialize"><InitializeIcon /></button>
                        <button className="icon-button" onClick={() => onRandomize('chaos', engine.id)} title="Chaos"><ChaosIcon /></button>
                        <button className="icon-button" onClick={() => onRandomize('harmonic', engine.id)} title="Harmonic"><HarmonicIcon /></button>
                        <button className="icon-button" onClick={() => onRandomize('rhythmic', engine.id)} title="Rhythmic"><RhythmicIcon /></button>
                    </div>
                </div>
                 {analyserNode && (
                     <div className="channel-visualizer-container">
                        <CircularVisualizerSequencer
                            analyserNode={analyserNode}
                            steps={engine.sequencerSteps}
                            pulses={engine.sequencerPulses}
                            rotate={engine.sequencerRotate}
                            currentStep={currentStep}
                            isTransportPlaying={isTransportPlaying}
                        />
                     </div>
                 )}
            </div>
            
            <div className="control-row">
                <label>Rate</label>
                 <div className="control-with-lock">
                    <select value={engine.sequencerRate} onChange={e => onUpdate(engine.id, { sequencerRate: e.target.value })}>
                        {sequencerRates.map(rate => <option key={rate} value={rate}>{rate}</option>)}
                    </select>
                    <LockIcon isLocked={getLock(`engines.${engine.id}.sequencerRate`)} onClick={() => onToggleLock(`engines.${engine.id}.sequencerRate`)} title="Lock Sequencer Rate" />
                </div>
            </div>
            <div className="control-row">
                <label>Steps</label>
                <div className="control-value-wrapper control-with-lock">
                    <input type="range" min="2" max="32" step="1" value={engine.sequencerSteps} onChange={e => onUpdate(engine.id, { sequencerSteps: parseInt(e.target.value) })} />
                    <span>{engine.sequencerSteps}</span>
                    <LockIcon isLocked={getLock(`engines.${engine.id}.sequencerSteps`)} onClick={() => onToggleLock(`engines.${engine.id}.sequencerSteps`)} title="Lock Steps" />
                </div>
            </div>
            <div className="control-row">
                <label>Pulses</label>
                <div className="control-value-wrapper control-with-lock">
                    <input type="range" min="1" max={engine.sequencerSteps} step="1" value={engine.sequencerPulses} onChange={e => onUpdate(engine.id, { sequencerPulses: parseInt(e.target.value) })} />
                    <span>{engine.sequencerPulses}</span>
                    <LockIcon isLocked={getLock(`engines.${engine.id}.sequencerPulses`)} onClick={() => onToggleLock(`engines.${engine.id}.sequencerPulses`)} title="Lock Pulses" />
                </div>
            </div>
            <div className="control-row">
                <label>Rotate</label>
                <div className="control-value-wrapper control-with-lock">
                    <input type="range" min="0" max={engine.sequencerSteps - 1} step="1" value={engine.sequencerRotate} onChange={e => onUpdate(engine.id, { sequencerRotate: parseInt(e.target.value) })} />
                    <span>{engine.sequencerRotate}</span>
                     <LockIcon isLocked={getLock(`engines.${engine.id}.sequencerRotate`)} onClick={() => onToggleLock(`engines.${engine.id}.sequencerRotate`)} title="Lock Rotate" />
                </div>
            </div>
            <div className="control-row">
                <label>Generative Sequencer</label>
                <button onClick={() => onGenerateSequence(engine.id)} disabled={isGenerating}>
                    {isGenerating ? 'Generating...' : '✨ Generate'}
                </button>
            </div>

            <div className="tab-nav">
                {(['synth', 'noise', 'sampler'] as EngineLayerType[]).map(layer => (
                    <button key={layer} onClick={() => setActiveTab(layer)} className={`tab-button-wrapper ${activeTab === layer ? 'active' : ''}`}>
                         <span className="tab-button-label">{layer.charAt(0).toUpperCase() + layer.slice(1)}</span>
                         <div
                            className={`tab-power-button ${engine[layer].enabled ? 'active' : ''}`}
                            onClick={(e) => {
                                e.stopPropagation();
                                onLayerUpdate(engine.id, layer, { enabled: !engine[layer].enabled });
                            }}
                         />
                    </button>
                ))}
            </div>

            <div className="tab-content">
                {activeTab === 'synth' && (
                    <>
                        <div className="control-row">
                            <label>Volume</label>
                            <div className="control-with-lock full-width">
                                <input type="range" min="0" max="1" step="0.01" value={engine.synth.volume} onChange={e => onLayerUpdate(engine.id, 'synth', { volume: parseFloat(e.target.value) })} />
                                <LockIcon isLocked={getLock(`engines.${engine.id}.synth.volume`)} onClick={() => onToggleLock(`engines.${engine.id}.synth.volume`)} title="Lock Synth Volume" />
                            </div>
                        </div>
                        <div className="control-row">
                            <label>Shape</label>
                            <div className="control-with-lock">
                                <select value={engine.synth.oscillatorType} onChange={e => onLayerUpdate(engine.id, 'synth', { oscillatorType: e.target.value as OscillatorType })}>
                                    {oscillatorTypes.map(type => <option key={type} value={type}>{type}</option>)}
                                </select>
                                <LockIcon isLocked={getLock(`engines.${engine.id}.synth.oscillatorType`)} onClick={() => onToggleLock(`engines.${engine.id}.synth.oscillatorType`)} title="Lock Synth Shape" />
                            </div>
                        </div>
                        <div className="control-row">
                            <label>Frequency Override</label>
                            <button className={`small ${engine.synth.frequencyOverride ? 'active' : ''}`} onClick={() => onLayerUpdate(engine.id, 'synth', { frequencyOverride: !engine.synth.frequencyOverride })}>
                                {engine.synth.frequencyOverride ? 'On' : 'Off'}
                            </button>
                        </div>
                        <div className="control-row">
                            <label>Frequency</label>
                            <div className="control-value-wrapper control-with-lock">
                                <input type="range" min="20" max="20000" step="1" value={engine.synth.frequency} onChange={e => onLayerUpdate(engine.id, 'synth', { frequency: parseFloat(e.target.value) })} disabled={!engine.synth.frequencyOverride} />
                                <span>{engine.synth.frequency.toFixed(0)} Hz</span>
                                <LockIcon isLocked={getLock(`engines.${engine.id}.synth.frequency`)} onClick={() => onToggleLock(`engines.${engine.id}.synth.frequency`)} title="Lock Synth Frequency" />
                            </div>
                        </div>
                         <div className="control-row">
                            <label>{harmonicTuningSystem === 'solfeggio' ? 'Solfeggio Freq' : 'Note'}</label>
                            <div className="control-with-lock">
                                <select value={engine.synth.solfeggioFrequency} onChange={e => onLayerUpdate(engine.id, 'synth', { solfeggioFrequency: e.target.value })} disabled={engine.synth.frequencyOverride || harmonicTuningSystem !== 'solfeggio'}>
                                   {solfeggioFrequenciesData.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                                </select>
                                <LockIcon isLocked={getLock(`engines.${engine.id}.synth.solfeggioFrequency`)} onClick={() => onToggleLock(`engines.${engine.id}.synth.solfeggioFrequency`)} title="Lock Solfeggio Frequency" />
                            </div>
                        </div>
                    </>
                )}
                 {activeTab === 'noise' && (
                    <>
                        <div className="control-row">
                            <label>Volume</label>
                             <div className="control-with-lock full-width">
                                <input type="range" min="0" max="1" step="0.01" value={engine.noise.volume} onChange={e => onLayerUpdate(engine.id, 'noise', { volume: parseFloat(e.target.value) })} />
                                <LockIcon isLocked={getLock(`engines.${engine.id}.noise.volume`)} onClick={() => onToggleLock(`engines.${engine.id}.noise.volume`)} title="Lock Noise Volume" />
                            </div>
                        </div>
                        <div className="control-row">
                            <label>Type</label>
                            <div className="control-with-lock">
                                <select value={engine.noise.noiseType} onChange={e => onLayerUpdate(engine.id, 'noise', { noiseType: e.target.value as NoiseType })}>
                                    {noiseTypes.map(type => <option key={type} value={type}>{type}</option>)}
                                </select>
                                <LockIcon isLocked={getLock(`engines.${engine.id}.noise.noiseType`)} onClick={() => onToggleLock(`engines.${engine.id}.noise.noiseType`)} title="Lock Noise Type" />
                            </div>
                        </div>
                    </>
                )}
                {activeTab === 'sampler' && (
                    <>
                        <div ref={dropZoneRef} className="drop-zone" onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}>
                            <div className="sampler-info">
                                {engine.sampler.sampleName ?
                                    <>
                                        <span>Loaded: {engine.sampler.sampleName}</span>
                                    </>
                                    : "Drag & drop audio file or record"
                                }
                            </div>
                            <input type="file" accept="audio/*" onChange={e => e.target.files && onLoadSample(engine.id, e.target.files[0])} style={{ display: 'none' }} id={`file-input-${engine.id}`} />
                             <div className="sampler-actions">
                                <button className="small" onClick={() => document.getElementById(`file-input-${engine.id}`)?.click()}>
                                    {engine.sampler.sampleName ? 'Replace' : 'Load File'}
                                </button>
                                <button className={`small record-btn ${isRecording ? 'active' : ''}`} onClick={handleRecordClick} disabled={engine.sampler.liveInputEnabled}>
                                    {isRecording ? 'Stop' : 'Record'}
                                </button>
                                <button className={`small ${engine.sampler.liveInputEnabled ? 'active' : ''}`} onClick={() => onToggleLiveInput(engine.id, !engine.sampler.liveInputEnabled)}>
                                    Live Input
                                </button>
                             </div>
                        </div>
                         <div className="control-row">
                            <label>Volume</label>
                            <div className="control-with-lock full-width">
                                <input type="range" min="0" max="1" step="0.01" value={engine.sampler.volume} onChange={e => onLayerUpdate(engine.id, 'sampler', { volume: parseFloat(e.target.value) })} />
                                <LockIcon isLocked={getLock(`engines.${engine.id}.sampler.volume`)} onClick={() => onToggleLock(`engines.${engine.id}.sampler.volume`)} title="Lock Sampler Volume" />
                            </div>
                        </div>
                         <div className="control-row">
                            <label>Transpose</label>
                            <div className="control-value-wrapper control-with-lock">
                                 <input type="range" min="-24" max="24" step="1" value={engine.sampler.transpose} onChange={e => onLayerUpdate(engine.id, 'sampler', { transpose: parseInt(e.target.value) })} disabled={engine.sampler.liveInputEnabled} />
                                <span>{engine.sampler.transpose} st</span>
                                <LockIcon isLocked={getLock(`engines.${engine.id}.sampler.transpose`)} onClick={() => onToggleLock(`engines.${engine.id}.sampler.transpose`)} title="Lock Transpose" />
                            </div>
                        </div>
                         <div className="control-row">
                             <label>Granular Mode</label>
                             <button className={`small ${engine.sampler.granularModeEnabled ? 'active' : ''}`} onClick={() => onLayerUpdate(engine.id, 'sampler', { granularModeEnabled: !engine.sampler.granularModeEnabled })} disabled={engine.sampler.liveInputEnabled}>
                                 {engine.sampler.granularModeEnabled ? 'On' : 'Off'}
                             </button>
                         </div>
                         {engine.sampler.granularModeEnabled && <>
                            <div className="control-row">
                                <label>Grain Size</label>
                                <div className="control-value-wrapper control-with-lock">
                                     <input type="range" min="0.01" max="0.5" step="0.001" value={engine.sampler.grainSize} onChange={e => onLayerUpdate(engine.id, 'sampler', { grainSize: parseFloat(e.target.value) })} />
                                     <span>{(engine.sampler.grainSize * 1000).toFixed(0)} ms</span>
                                     <LockIcon isLocked={getLock(`engines.${engine.id}.sampler.grainSize`)} onClick={() => onToggleLock(`engines.${engine.id}.sampler.grainSize`)} title="Lock Grain Size" />
                                </div>
                            </div>
                             <div className="control-row">
                                <label>Density</label>
                                <div className="control-value-wrapper control-with-lock">
                                     <input type="range" min="1" max="100" step="1" value={engine.sampler.grainDensity} onChange={e => onLayerUpdate(engine.id, 'sampler', { grainDensity: parseInt(e.target.value) })} />
                                     <span>{engine.sampler.grainDensity} /s</span>
                                     <LockIcon isLocked={getLock(`engines.${engine.id}.sampler.grainDensity`)} onClick={() => onToggleLock(`engines.${engine.id}.sampler.grainDensity`)} title="Lock Grain Density" />
                                </div>
                            </div>
                             <div className="control-row">
                                <label>Position</label>
                                <div className="control-with-lock full-width">
                                    <input type="range" min="0" max="1" step="0.001" value={engine.sampler.playbackPosition} onChange={e => onLayerUpdate(engine.id, 'sampler', { playbackPosition: parseFloat(e.target.value) })} />
                                    <LockIcon isLocked={getLock(`engines.${engine.id}.sampler.playbackPosition`)} onClick={() => onToggleLock(`engines.${engine.id}.sampler.playbackPosition`)} title="Lock Grain Position" />
                                </div>
                            </div>
                             <div className="control-row">
                                <label>Jitter</label>
                                <div className="control-with-lock full-width">
                                    <input type="range" min="0" max="1" step="0.01" value={engine.sampler.positionJitter} onChange={e => onLayerUpdate(engine.id, 'sampler', { positionJitter: parseFloat(e.target.value) })} />
                                    <LockIcon isLocked={getLock(`engines.${engine.id}.sampler.positionJitter`)} onClick={() => onToggleLock(`engines.${engine.id}.sampler.positionJitter`)} title="Lock Position Jitter" />
                                </div>
                            </div>
                         </>}
                    </>
                )}
            </div>
            <div className="adsr-container">
                <h4>Amplitude Envelope</h4>
                <div className="control-row">
                    <label>Attack</label>
                    <div className="control-value-wrapper control-with-lock">
                        <input type="range" min="0.001" max="3" step="0.001" value={engine.adsr.attack} onChange={e => handleAdsrUpdate('attack', parseFloat(e.target.value))} />
                        <span>{engine.adsr.attack.toFixed(3)} s</span>
                        <LockIcon isLocked={getLock(`engines.${engine.id}.adsr.attack`)} onClick={() => onToggleLock(`engines.${engine.id}.adsr.attack`)} title="Lock Attack" />
                    </div>
                </div>
                <div className="control-row">
                    <label>Decay</label>
                    <div className="control-value-wrapper control-with-lock">
                        <input type="range" min="0.001" max="3" step="0.001" value={engine.adsr.decay} onChange={e => handleAdsrUpdate('decay', parseFloat(e.target.value))} />
                        <span>{engine.adsr.decay.toFixed(3)} s</span>
                        <LockIcon isLocked={getLock(`engines.${engine.id}.adsr.decay`)} onClick={() => onToggleLock(`engines.${engine.id}.adsr.decay`)} title="Lock Decay" />
                    </div>
                </div>
                <div className="control-row">
                    <label>Sustain</label>
                    <div className="control-value-wrapper control-with-lock">
                        <input type="range" min="0" max="1" step="0.01" value={engine.adsr.sustain} onChange={e => handleAdsrUpdate('sustain', parseFloat(e.target.value))} />
                        <span>{engine.adsr.sustain.toFixed(2)}</span>
                        <LockIcon isLocked={getLock(`engines.${engine.id}.adsr.sustain`)} onClick={() => onToggleLock(`engines.${engine.id}.adsr.sustain`)} title="Lock Sustain" />
                    </div>
                </div>
                <div className="control-row">
                    <label>Release</label>
                    <div className="control-value-wrapper control-with-lock">
                        <input type="range" min="0.001" max="5" step="0.001" value={engine.adsr.release} onChange={e => handleAdsrUpdate('release', parseFloat(e.target.value))} />
                        <span>{engine.adsr.release.toFixed(3)} s</span>
                        <LockIcon isLocked={getLock(`engines.${engine.id}.adsr.release`)} onClick={() => onToggleLock(`engines.${engine.id}.adsr.release`)} title="Lock Release" />
                    </div>
                </div>
            </div>
        </div>
    );
};


const MasterFilterControls: React.FC<MasterFilterControlsProps> = ({ title, filterState, onUpdate, onRandomize, onInitialize, lockState, onToggleLock }) => {
    const scope = title === 'Filter 1' ? 'filter1' : 'filter2';
    const getLock = (path: string) => lockState[scope as 'filter1' | 'filter2'][path];
    return (
        <div className="control-group">
             <div className="control-group-header" style={{ border: 'none', padding: 0, marginBottom: '1rem'}}>
                <div className="engine-title-group">
                    <h2>{title}</h2>
                    <button className={`small ${filterState.enabled ? 'active' : ''}`} onClick={() => onUpdate({ enabled: !filterState.enabled })}>
                        {filterState.enabled ? 'On' : 'Off'}
                    </button>
                </div>
                <div className="randomizer-buttons-group">
                    <button className="icon-button init-button" onClick={() => onInitialize(scope)} title="Initialize"><InitializeIcon /></button>
                    <button className="icon-button" onClick={() => onRandomize('chaos', scope)} title="Chaos"><ChaosIcon /></button>
                    <button className="icon-button" onClick={() => onRandomize('harmonic', scope)} title="Harmonic"><HarmonicIcon /></button>
                    <button className="icon-button" onClick={() => onRandomize('rhythmic', scope)} title="Rhythmic"><RhythmicIcon /></button>
                </div>
             </div>
             <div className="control-row">
                <label>Type</label>
                <div className="control-with-lock">
                    <select value={filterState.type} onChange={e => onUpdate({ type: e.target.value as FilterType })} disabled={!filterState.enabled}>
                        {filterTypes.map(type => <option key={type} value={type}>{type}</option>)}
                    </select>
                    <LockIcon isLocked={getLock('type')} onClick={() => onToggleLock(`${scope}.type`)} title="Lock Filter Type" />
                </div>
            </div>
            <div className="control-row">
                <label>Cutoff</label>
                <div className="control-value-wrapper control-with-lock">
                    <input type="range" min="20" max="20000" step="1" value={filterState.cutoff} onChange={e => onUpdate({ cutoff: parseFloat(e.target.value) })} disabled={!filterState.enabled} />
                    <span>{filterState.cutoff.toFixed(0)} Hz</span>
                    <LockIcon isLocked={getLock('cutoff')} onClick={() => onToggleLock(`${scope}.cutoff`)} title="Lock Cutoff" />
                </div>
            </div>
            <div className="control-row">
                <label>Resonance</label>
                 <div className="control-value-wrapper control-with-lock">
                    <input type="range" min="0" max="30" step="0.1" value={filterState.resonance} onChange={e => onUpdate({ resonance: parseFloat(e.target.value) })} disabled={!filterState.enabled} />
                    <span>{filterState.resonance.toFixed(1)}</span>
                    <LockIcon isLocked={getLock('resonance')} onClick={() => onToggleLock(`${scope}.resonance`)} title="Lock Resonance" />
                </div>
            </div>
        </div>
    );
};

const LfoVisualizer: React.FC<{ shape: LFO_Shape; rate: number; isSynced: boolean; bpm: number; syncRate: string; depth: number; }> = React.memo(({ shape, rate, isSynced, bpm, syncRate, depth }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        let animationFrameId: number;

        const draw = (time: number) => {
            const { width, height } = canvas;
            ctx.clearRect(0, 0, width, height);
            ctx.strokeStyle = '#a45ee5'; // --primary-color
            ctx.lineWidth = 2;
            
            ctx.beginPath();
            
            const lfoRate = isSynced
                ? bpm / 60 / (lfoSyncRates.indexOf(syncRate) === 4 ? 1 : parseFloat(syncRate) * 4) // Simplified conversion
                : rate;

            for (let x = 0; x < width; x++) {
                const normalizedX = x / width;
                const phase = (time / 1000 * lfoRate + normalizedX) % 1;
                
                let y;
                switch (shape) {
                    case 'sine': y = Math.sin(phase * 2 * Math.PI); break;
                    case 'square': y = phase < 0.5 ? 1 : -1; break;
                    case 'sawtooth': y = 2 * (phase - Math.floor(0.5 + phase)); break; // Inverted saw
                    case 'ramp': y = 2 * phase - 1; break;
                    case 'triangle': y = 2 * Math.abs(2 * (phase - Math.floor(phase + 0.5))) - 1; break;
                    default: y = 0;
                }
                const scaledY = y * depth;
                const canvasY = (1 - (scaledY + 1) / 2) * height;
                if (x === 0) ctx.moveTo(x, canvasY);
                else ctx.lineTo(x, canvasY);
            }
            ctx.stroke();
            animationFrameId = requestAnimationFrame(draw);
        };
        animationFrameId = requestAnimationFrame(draw);
        return () => cancelAnimationFrame(animationFrameId);
    }, [shape, rate, isSynced, bpm, syncRate, depth]);

    return <canvas ref={canvasRef} className="lfo-visualizer-container" />;
});


const LFOControls: React.FC<LFOControlsProps> = ({ lfoState, onUpdate, onRandomize, onInitialize, bpm, lockState, onToggleLock }) => {
    const getLock = (path: string) => lockState.lfos[lfoState.id]?.[path] ?? false;
    return (
         <div className="control-group lfo-controls">
            <div className="control-group-header" style={{ border: 'none', padding: 0, marginBottom: '0.5rem'}}>
                <h2>{lfoState.name}</h2>
                 <div className="randomizer-buttons-group">
                    <button className="icon-button init-button" onClick={() => onInitialize(lfoState.id)} title="Initialize"><InitializeIcon /></button>
                    <button className="icon-button" onClick={() => onRandomize('chaos', lfoState.id)} title="Chaos"><ChaosIcon /></button>
                    <button className="icon-button" onClick={() => onRandomize('harmonic', lfoState.id)} title="Harmonic"><HarmonicIcon /></button>
                    <button className="icon-button" onClick={() => onRandomize('rhythmic', lfoState.id)} title="Rhythmic"><RhythmicIcon /></button>
                </div>
            </div>
             <LfoVisualizer shape={lfoState.shape} rate={lfoState.rate} isSynced={lfoState.sync} bpm={bpm} syncRate={lfoState.syncRate} depth={lfoState.depth} />

             <div className="control-row">
                <label>Shape</label>
                <div className="control-with-lock">
                    <select value={lfoState.shape} onChange={e => onUpdate({ shape: e.target.value as LFO_Shape })}>
                        {lfoShapes.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                    <LockIcon isLocked={getLock('shape')} onClick={() => onToggleLock(`lfos.${lfoState.id}.shape`)} title="Lock LFO Shape" />
                </div>
            </div>
            <div className="control-row">
                <label>Rate</label>
                 <div className="control-value-wrapper control-with-lock">
                    <input type="range" min="0.1" max="50" step="0.1" value={lfoState.rate} onChange={e => onUpdate({ rate: parseFloat(e.target.value) })} disabled={lfoState.sync} />
                     <span>{lfoState.rate.toFixed(1)} Hz</span>
                    <LockIcon isLocked={getLock('rate')} onClick={() => onToggleLock(`lfos.${lfoState.id}.rate`)} title="Lock LFO Rate" />
                </div>
            </div>
            <div className="control-row">
                <label>Depth</label>
                <div className="control-with-lock full-width">
                    <input type="range" min="0" max="1" step="0.01" value={lfoState.depth} onChange={e => onUpdate({ depth: parseFloat(e.target.value) })} />
                    <LockIcon isLocked={getLock('depth')} onClick={() => onToggleLock(`lfos.${lfoState.id}.depth`)} title="Lock LFO Depth" />
                </div>
            </div>
            <div className="control-row">
                <label>Sync</label>
                <div className="control-with-lock">
                    <button className={`small ${lfoState.sync ? 'active' : ''}`} onClick={() => onUpdate({ sync: !lfoState.sync })}>
                        {lfoState.sync ? 'On' : 'Off'}
                    </button>
                    {lfoState.sync && (
                        <select value={lfoState.syncRate} onChange={e => onUpdate({ syncRate: e.target.value })}>
                            {lfoSyncRates.map(r => <option key={r} value={r}>{r}</option>)}
                        </select>
                    )}
                    <LockIcon isLocked={getLock('sync')} onClick={() => onToggleLock(`lfos.${lfoState.id}.sync`)} title="Lock LFO Sync" />
                </div>
            </div>
         </div>
    );
};

const EffectModule: React.FC<EffectModuleProps> = ({
    effect, onUpdate, onRemove, onToggle, onRandomize, onInitialize, onDragStart, onDragOver, onDragEnd, isDragging, isExpanded, onToggleExpand,
    lockState, onToggleLock
}) => {
    const p = effect.params;
    const type = effect.type;

    const moduleStyle: React.CSSProperties = {
        boxShadow: isDragging ? '0 5px 15px rgba(0,0,0,0.5)' : 'none',
        opacity: isDragging ? 0.5 : 1,
    };

    return (
        <div
            className="effect-module"
            style={moduleStyle}
            onDragOver={(e) => onDragOver(e, effect)}
        >
            <div 
                className="effect-header" 
                onClick={() => onToggleExpand(effect.id)}
                draggable
                onDragStart={(e) => onDragStart(e, effect)}
                onDragEnd={onDragEnd}
            >
                 <div className="effect-header-title-group">
                    <AccordionIcon isExpanded={isExpanded} />
                    <h3>{type.charAt(0).toUpperCase() + type.slice(1)}</h3>
                 </div>
                 <div className="effect-header-buttons" onClick={e => e.stopPropagation()}>
                    <button className={`small ${effect.enabled ? 'active' : ''}`} onClick={() => onToggle(effect.id)}>{effect.enabled ? 'On' : 'Off'}</button>
                    <button className="small remove-effect-btn" onClick={() => onRemove(effect.id)}>X</button>
                 </div>
            </div>
            {isExpanded && <div className="effect-controls">
                <div className="control-row">
                    <label>Randomize</label>
                    <div className="randomizer-buttons-group">
                        <button className="icon-button init-button" onClick={() => onInitialize(effect.id)} title="Initialize"><InitializeIcon /></button>
                        <button className="icon-button" onClick={() => onRandomize('chaos', effect.id)} title="Chaos"><ChaosIcon /></button>
                        <button className="icon-button" onClick={() => onRandomize('harmonic', effect.id)} title="Harmonic"><HarmonicIcon /></button>
                        <button className="icon-button" onClick={() => onRandomize('rhythmic', effect.id)} title="Rhythmic"><RhythmicIcon /></button>
                    </div>
                </div>
                {type === 'distortion' && p.distortion && (
                     <>
                        <div className="control-row">
                            <label>Mode</label>
                            <select value={p.distortion.mode} onChange={e => onUpdate(effect.id, { distortion: { ...p.distortion!, mode: e.target.value as DistortionMode } })}>
                                {distortionModes.map(mode => <option key={mode} value={mode}>{mode}</option>)}
                            </select>
                        </div>
                        <div className="control-row">
                            <label>Amount</label>
                            <input type="range" min="0" max="1" step="0.01" value={p.distortion.amount} onChange={e => onUpdate(effect.id, { distortion: { ...p.distortion!, amount: parseFloat(e.target.value) } })} />
                        </div>
                     </>
                )}
                 {type === 'delay' && p.delay && (
                     <>
                        <div className="control-row">
                            <label>Time</label>
                            <input type="range" min="0" max="2" step="0.01" value={p.delay.time} onChange={e => onUpdate(effect.id, { delay: { ...p.delay!, time: parseFloat(e.target.value) } })} />
                        </div>
                         <div className="control-row">
                            <label>Feedback</label>
                            <input type="range" min="0" max="0.95" step="0.01" value={p.delay.feedback} onChange={e => onUpdate(effect.id, { delay: { ...p.delay!, feedback: parseFloat(e.target.value) } })} />
                        </div>
                         <div className="control-row">
                            <label>Mix</label>
                            <input type="range" min="0" max="1" step="0.01" value={p.delay.mix} onChange={e => onUpdate(effect.id, { delay: { ...p.delay!, mix: parseFloat(e.target.value) } })} />
                        </div>
                     </>
                )}
                {type === 'reverb' && p.reverb && (
                     <>
                        <div className="control-row">
                            <label>Decay</label>
                            <input type="range" min="0.1" max="10" step="0.1" value={p.reverb.decay} onChange={e => onUpdate(effect.id, { reverb: { ...p.reverb!, decay: parseFloat(e.target.value) } })} />
                        </div>
                         <div className="control-row">
                            <label>Mix</label>
                            <input type="range" min="0" max="1" step="0.01" value={p.reverb.mix} onChange={e => onUpdate(effect.id, { reverb: { ...p.reverb!, mix: parseFloat(e.target.value) } })} />
                        </div>
                     </>
                )}
                 {type === 'chorus' && p.chorus && (
                     <>
                        <div className="control-row"><label>Rate</label><input type="range" min="0.1" max="10" step="0.1" value={p.chorus.rate} onChange={e => onUpdate(effect.id, { chorus: { ...p.chorus!, rate: parseFloat(e.target.value) } })} /></div>
                        <div className="control-row"><label>Depth</label><input type="range" min="0" max="1" step="0.01" value={p.chorus.depth} onChange={e => onUpdate(effect.id, { chorus: { ...p.chorus!, depth: parseFloat(e.target.value) } })} /></div>
                        <div className="control-row"><label>Mix</label><input type="range" min="0" max="1" step="0.01" value={p.chorus.mix} onChange={e => onUpdate(effect.id, { chorus: { ...p.chorus!, mix: parseFloat(e.target.value) } })} /></div>
                     </>
                )}
                {type === 'flanger' && p.flanger && (
                     <>
                        <div className="control-row"><label>Rate</label><input type="range" min="0.1" max="5" step="0.1" value={p.flanger.rate} onChange={e => onUpdate(effect.id, { flanger: { ...p.flanger!, rate: parseFloat(e.target.value) } })} /></div>
                        <div className="control-row"><label>Depth</label><input type="range" min="0" max="1" step="0.01" value={p.flanger.depth} onChange={e => onUpdate(effect.id, { flanger: { ...p.flanger!, depth: parseFloat(e.target.value) } })} /></div>
                        <div className="control-row"><label>Feedback</label><input type="range" min="0" max="0.95" step="0.01" value={p.flanger.feedback} onChange={e => onUpdate(effect.id, { flanger: { ...p.flanger!, feedback: parseFloat(e.target.value) } })} /></div>
                        <div className="control-row"><label>Mix</label><input type="range" min="0" max="1" step="0.01" value={p.flanger.mix} onChange={e => onUpdate(effect.id, { flanger: { ...p.flanger!, mix: parseFloat(e.target.value) } })} /></div>
                     </>
                )}
                {type === 'phaser' && p.phaser && (
                     <>
                        <div className="control-row"><label>Rate</label><input type="range" min="0.1" max="8" step="0.1" value={p.phaser.rate} onChange={e => onUpdate(effect.id, { phaser: { ...p.phaser!, rate: parseFloat(e.target.value) } })} /></div>
                        <div className="control-row"><label>Stages</label><input type="range" min="2" max="12" step="2" value={p.phaser.stages} onChange={e => onUpdate(effect.id, { phaser: { ...p.phaser!, stages: parseInt(e.target.value) } })} /></div>
                        <div className="control-row"><label>Q</label><input type="range" min="0" max="20" step="0.1" value={p.phaser.q} onChange={e => onUpdate(effect.id, { phaser: { ...p.phaser!, q: parseFloat(e.target.value) } })} /></div>
                        <div className="control-row"><label>Mix</label><input type="range" min="0" max="1" step="0.01" value={p.phaser.mix} onChange={e => onUpdate(effect.id, { phaser: { ...p.phaser!, mix: parseFloat(e.target.value) } })} /></div>
                     </>
                )}
                {type === 'tremolo' && p.tremolo && (
                     <>
                        <div className="control-row"><label>Rate</label><input type="range" min="0.1" max="20" step="0.1" value={p.tremolo.rate} onChange={e => onUpdate(effect.id, { tremolo: { ...p.tremolo!, rate: parseFloat(e.target.value) } })} /></div>
                        <div className="control-row"><label>Depth</label><input type="range" min="0" max="1" step="0.01" value={p.tremolo.depth} onChange={e => onUpdate(effect.id, { tremolo: { ...p.tremolo!, depth: parseFloat(e.target.value) } })} /></div>
                         <div className="control-row">
                            <label>Shape</label>
                            <select value={p.tremolo.shape} onChange={e => onUpdate(effect.id, { tremolo: { ...p.tremolo!, shape: e.target.value as LFO_Shape }})}>
                                 {lfoShapes.map(s => <option key={s} value={s}>{s}</option>)}
                            </select>
                        </div>
                        <div className="control-row"><label>Mix</label><input type="range" min="0" max="1" step="0.01" value={p.tremolo.mix} onChange={e => onUpdate(effect.id, { tremolo: { ...p.tremolo!, mix: parseFloat(e.target.value) } })} /></div>
                     </>
                )}
                {type === 'eq' && p.eq && (
                    <div className="eq-container">
                        {p.eq.bands.map((gain, i) => (
                            <div key={i} className="eq-band">
                                <label>{eqFrequencies[i] < 1000 ? eqFrequencies[i] : `${eqFrequencies[i]/1000}k`}</label>
                                <input type="range" min="-12" max="12" step="0.1" value={gain} onChange={e => {
                                    const newBands = [...p.eq!.bands];
                                    newBands[i] = parseFloat(e.target.value);
                                    onUpdate(effect.id, { eq: { bands: newBands } });
                                }} />
                            </div>
                        ))}
                    </div>
                )}
            </div>}
        </div>
    );
};


const MasterEffects: React.FC<MasterEffectsProps> = ({ effects, setEffects, onRandomize, onInitialize, lockState, onToggleLock }) => {
    const [draggedEffect, setDraggedEffect] = useState<MasterEffect | null>(null);
    const [expandedEffects, setExpandedEffects] = useState<string[]>([]);
    const [dropIndex, setDropIndex] = useState<number | null>(null);

    const handleToggleExpand = (id: string) => {
        setExpandedEffects(prev => 
            prev.includes(id) ? prev.filter(eId => eId !== id) : [...prev, id]
        );
    };

    const handleAddEffect = (type: MasterEffectType) => {
        const newEffect: MasterEffect = {
            id: self.crypto.randomUUID(),
            type,
            enabled: true,
            params: getDefaultEffectParams(type)
        };
        setEffects(prev => [...prev, newEffect]);
        setExpandedEffects(prev => [...prev, newEffect.id]); // Auto-expand new effects
    };
    const handleRemoveEffect = (id: string) => setEffects(prev => prev.filter(e => e.id !== id));
    const handleToggleEffect = (id: string) => setEffects(prev => prev.map(e => e.id === id ? { ...e, enabled: !e.enabled } : e));
    const handleUpdateEffect = (id: string, params: MasterEffect['params']) => {
        setEffects(prev => prev.map(e => e.id === id ? { ...e, params } : e));
    };

    const handleDragStart = (e: React.DragEvent<HTMLDivElement>, effect: MasterEffect) => {
        setDraggedEffect(effect);
    };

    const handleDragOver = (e: React.DragEvent<HTMLDivElement>, hoverEffect: MasterEffect) => {
        e.preventDefault();
        if (!draggedEffect || draggedEffect.id === hoverEffect.id) return;
        
        const hoverIndex = effects.findIndex(e => e.id === hoverEffect.id);
        
        const target = e.currentTarget;
        const rect = target.getBoundingClientRect();
        const isOverTopHalf = e.clientY < rect.top + rect.height / 2;
        const newDropIndex = isOverTopHalf ? hoverIndex : hoverIndex + 1;
        
        if (newDropIndex !== dropIndex) {
            setDropIndex(newDropIndex);
        }
    };
    
    const handleDragEnd = () => {
        if (draggedEffect && dropIndex !== null) {
            const items = Array.from(effects);
            const fromIndex = items.findIndex(e => e.id === draggedEffect.id);
            const [removed] = items.splice(fromIndex, 1);
            items.splice(dropIndex, 0, removed);
            setEffects(items);
        }
        setDraggedEffect(null);
        setDropIndex(null);
    };


    return (
        <div className="master-effects-container">
            <div className="filters-container-header">
                <h2>Master Effects</h2>
                <div>
                     <select onChange={(e) => { handleAddEffect(e.target.value as MasterEffectType); e.target.value = ''; }} value="">
                         <option value="" disabled>Add Effect...</option>
                        {availableMasterEffects.map(type => (
                            <option key={type} value={type}>{type.charAt(0).toUpperCase() + type.slice(1)}</option>
                        ))}
                     </select>
                </div>
            </div>
            <div className="effects-chain" onDragEnd={handleDragEnd} onDragLeave={() => setDropIndex(null)}>
                {effects.length === 0 ? (
                    <div className="effects-chain-empty">Effect chain is empty. Add an effect to start.</div>
                ) : (
                    effects.map((effect, index) => (
                        <React.Fragment key={effect.id}>
                            {dropIndex === index && <div className="drop-indicator" />}
                            <EffectModule
                                effect={effect}
                                onUpdate={handleUpdateEffect}
                                onRemove={handleRemoveEffect}
                                onToggle={handleToggleEffect}
                                onRandomize={onRandomize}
                                onInitialize={onInitialize}
                                onDragStart={handleDragStart}
                                onDragOver={(e) => handleDragOver(e, effect)}
                                onDragEnd={handleDragEnd}
                                isDragging={draggedEffect?.id === effect.id}
                                isExpanded={expandedEffects.includes(effect.id)}
                                onToggleExpand={handleToggleExpand}
                                lockState={lockState}
                                onToggleLock={onToggleLock}
                            />
                        </React.Fragment>
                    ))
                )}
                 {dropIndex === effects.length && <div className="drop-indicator" />}
            </div>
        </div>
    );
};

const RoutingMatrix: React.FC<RoutingMatrixProps> = ({ lfoStates, onLfoUpdate, engineStates, onEngineUpdate }) => {
    const destinations = [
        { label: "Filter 1 Cutoff", key: "filter1Cutoff" }, { label: "Filter 1 Res", key: "filter1Resonance" },
        { label: "Filter 2 Cutoff", key: "filter2Cutoff" }, { label: "Filter 2 Res", key: "filter2Resonance" },
        ...engineStates.flatMap(engine => [
             { label: `${engine.name} Volume`, key: `engine${engine.id.slice(-1)}Vol`},
             { label: `${engine.name} Synth Freq`, key: `engine${engine.id.slice(-1)}SynthFreq`},
             { label: `${engine.name} Sampler/Grain Pitch`, key: `engine${engine.id.slice(-1)}SamplerTranspose`},
             { label: `${engine.name} Grain Size`, key: `engine${engine.id.slice(-1)}GrainSize` },
             { label: `${engine.name} Grain Density`, key: `engine${engine.id.slice(-1)}GrainDensity` },
             { label: `${engine.name} Grain Position`, key: `engine${engine.id.slice(-1)}GrainPosition` },
             { label: `${engine.name} Grain Jitter`, key: `engine${engine.id.slice(-1)}GrainJitter` },
        ])
    ];

    const handleLfoCheckboxChange = (lfoId: string, destKey: keyof LFORoutingState, isChecked: boolean) => {
        const lfo = lfoStates.find(l => l.id === lfoId);
        if (lfo) {
            onLfoUpdate(lfoId, { routing: { ...lfo.routing, [destKey]: isChecked } });
        }
    };
    
    const handleSequencerCheckboxChange = (engineId: string, destKey: keyof LFORoutingState, isChecked: boolean) => {
        const engine = engineStates.find(e => e.id === engineId);
        if(engine) {
            onEngineUpdate(engineId, { routing: { ...engine.routing, [destKey]: isChecked } });
        }
    };

    return (
        <table className="routing-matrix">
            <thead>
                <tr>
                    <th>Destination</th>
                    {lfoStates.map(lfo => <th key={lfo.id} className="rotated-header"><div>{lfo.name}</div></th>)}
                    {engineStates.map(engine => <th key={engine.id} className="rotated-header"><div>SEQ {engine.id.slice(-1)}</div></th>)}
                </tr>
            </thead>
            <tbody>
                {destinations.map(dest => (
                    <tr key={dest.key}>
                        <td>{dest.label}</td>
                        {lfoStates.map(lfo => (
                            <td key={`${lfo.id}-${dest.key}`}>
                                <input
                                    type="checkbox"
                                    checked={lfo.routing[dest.key as keyof LFORoutingState]}
                                    onChange={(e) => handleLfoCheckboxChange(lfo.id, dest.key as keyof LFORoutingState, e.target.checked)}
                                />
                            </td>
                        ))}
                         {engineStates.map(engine => (
                            <td key={`${engine.id}-${dest.key}`}>
                                <input
                                    type="checkbox"
                                    checked={engine.routing[dest.key as keyof LFORoutingState]}
                                    onChange={(e) => handleSequencerCheckboxChange(engine.id, dest.key as keyof LFORoutingState, e.target.checked)}
                                />
                            </td>
                        ))}
                    </tr>
                ))}
            </tbody>
        </table>
    );
};

const BottomTabs: React.FC<BottomTabsProps> = ({ lfoStates, handleLfoUpdate, engineStates, handleEngineUpdate, onRandomize, onInitialize, bpm, lockState, onToggleLock }) => {
    const [activeTab, setActiveTab] = useState<'lfos' | 'routing'>('lfos');

    return (
        <div className="bottom-module-container">
            <div className="bottom-module-header">
                <div className="bottom-tab-nav">
                    <button className={`bottom-tab-button ${activeTab === 'lfos' ? 'active' : ''}`} onClick={() => setActiveTab('lfos')}>
                        LFOs
                    </button>
                     <button className={`bottom-tab-button ${activeTab === 'routing' ? 'active' : ''}`} onClick={() => setActiveTab('routing')}>
                        Routing Matrix
                    </button>
                </div>
                 {activeTab === 'routing' && (
                    <div className="randomizer-buttons-group">
                        <label>Randomize Routing</label>
                        <button className="icon-button" onClick={() => onRandomize('chaos', 'routing')} title="Chaos"><ChaosIcon /></button>
                        <button className="icon-button" onClick={() => onRandomize('harmonic', 'routing')} title="Harmonic"><HarmonicIcon /></button>
                        <button className="icon-button" onClick={() => onRandomize('rhythmic', 'routing')} title="Rhythmic"><RhythmicIcon /></button>
                    </div>
                 )}
            </div>
            
             {activeTab === 'lfos' && (
                <div className="lfo-grid-container">
                    {lfoStates.map(lfo => (
                         <LFOControls key={lfo.id} lfoState={lfo} onUpdate={(updates) => handleLfoUpdate(lfo.id, updates)} onRandomize={onRandomize} onInitialize={onInitialize} bpm={bpm} lockState={lockState} onToggleLock={onToggleLock} />
                    ))}
                </div>
            )}
            {activeTab === 'routing' && (
                <RoutingMatrix
                    lfoStates={lfoStates}
                    onLfoUpdate={handleLfoUpdate}
                    engineStates={engineStates}
                    onEngineUpdate={handleEngineUpdate}
                />
            )}
        </div>
    );
};

// --- Main App Component ---
const App: React.FC = () => {
    const [isInitialized, setIsInitialized] = useState(false);
    const [audioContext, setAudioContext] = useState<AudioContext | null>(null);
    const audioNodesRef = useRef<Map<string, EngineAudioNodes>>(new Map());
    const filterNodesRef = useRef<{ filter1: FilterNodes, filter2: FilterNodes } | null>(null);
    const masterVolumeNodeRef = useRef<GainNode | null>(null);
    const masterAnalyserNodeRef = useRef<AnalyserNode | null>(null);
    const lfoNodesRef = useRef<Map<string, { lfoNode: OscillatorNode; depthGain: GainNode }>>(new Map());
    const lfoRoutingBussesRef = useRef<LfoRoutingBusses | null>(null);
    const samplesRef = useRef<Map<string, AudioBuffer>>(new Map());
    const activeVoicesRef = useRef<Map<string, ActiveVoice>>(new Map());
    const activeMonoNotePerEngineRef = useRef<Map<string, number>>(new Map());
    const lastPlayedNotePerEngineRef = useRef<Map<string, number>>(new Map());
    const effectNodesRef = useRef<Map<string, any>>(new Map());
    
    // --- State Management ---
    const initialAppState = useMemo(() => getInitialState(), []);
    const [engines, setEngines] = useState<EngineState[]>(initialAppState.engines);
    const enginesRef = useRef(initialAppState.engines); // Corrected initialization
    const [lfos, setLfos] = useState<LFOState[]>(initialAppState.lfos);
    const [filter1State, setFilter1State] = useState<FilterState>(initialAppState.filter1);
    const [filter2State, setFilter2State] = useState<FilterState>(initialAppState.filter2);
    const [filterRouting, setFilterRouting] = useState<FilterRouting>(initialAppState.filterRouting);
    const [masterEffects, setMasterEffects] = useState<MasterEffect[]>(initialAppState.masterEffects);
    
    // Add this useEffect to keep enginesRef updated
    useEffect(() => {
        enginesRef.current = engines;
    }, [engines]);
    
    const [masterVolume, setMasterVolume] = useState(0.7);
    const [bpm, setBPM] = useState(120);
    const [isTransportPlaying, setIsTransportPlaying] = useState(false);
    const [currentStep, setCurrentStep] = useState(0);
    const [harmonicTuningSystem, setHarmonicTuningSystem] = useState<TuningSystem>('440_ET');
    const [isMorphing, setIsMorphing] = useState(false);
    const [isGenerating, setIsGenerating] = useState(false);
    const [scale, setScale] = useState<ScaleName>('major');
    const [transpose, setTranspose] = useState(0);
    
    const [morphTime, setMorphTime] = useState(500); // ms
    const [isMorphSynced, setIsMorphSynced] = useState(false);
    const [morphSyncRateIndex, setMorphSyncRateIndex] = useState(3);

    const morphTargetRef = useRef<any>(null);
    const morphStartRef = useRef<any>(null);
    const morphStartTimeRef = useRef<number | null>(null);
    const [midiInputs, setMidiInputs] = useState<MIDIInput[]>([]);
    const [selectedMidiInputId, setSelectedMidiInputId] = useState<string | null>(null);
    const [midiActivity, setMidiActivity] = useState(false);
    const midiActivityTimeoutRef = useRef<number | null>(null);
    const [audioInputStream, setAudioInputStream] = useState<MediaStream | null>(null);


    const [voicingMode, setVoicingMode] = useState<VoicingMode>('poly');
    const [glideTime, setGlideTime] = useState(50); // ms
    const [isGlideSynced, setIsGlideSynced] = useState(false);
    const [glideSyncRateIndex, setGlideSyncRateIndex] = useState(3); // 1/8
    const syncRates = useMemo(() => ['1/64', '1/32', '1/16', '1/8', '1/8d', '1/4', '1/4d', '1/2'], []);
    
    const [lockState, setLockState] = useState<LockState>(getInitialLockState());

    const handleToggleLock = useCallback((path: string) => {
        setLockState(prev => {
            const newState = JSON.parse(JSON.stringify(prev)); // Deep copy
            const parts = path.split('.');
            let current = newState;
            for (let i = 0; i < parts.length - 1; i++) {
                current = current[parts[i]];
            }
            const key = parts[parts.length - 1];
            current[key] = !current[key];
            return newState;
        });
    }, []);

    const handleEngineUpdate = useCallback((engineId: string, updates: Partial<EngineState>) => {
      setEngines(prevEngines => prevEngines.map(e => e.id === engineId ? { ...e, ...updates } : e));
    }, []);
    const handleLayerUpdate = useCallback(<K extends EngineLayerType>(
        engineId: string, layer: K, updates: Partial<EngineState[K]>
    ) => {
        setEngines(prevEngines => prevEngines.map(e =>
            e.id === engineId ? { ...e, [layer]: { ...e[layer], ...updates } } : e
        ));
    }, []);
    const handleLfoUpdate = useCallback((lfoId: string, updates: Partial<LFOState>) => {
      setLfos(prevLfos => prevLfos.map(l => l.id === lfoId ? { ...l, ...updates } : l));
    }, []);

    const handleGenerateSequence = useCallback(async (engineId: string) => {
        const engine = engines.find(e => e.id === engineId);
        if (!engine) return;

        setIsGenerating(true);
        try {
            const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
            const model = genAI.getGenerativeModel({ model: "gemini-pro" });

            const prompt = `You are a creative music assistant for a polyrhythmic synthesizer.
Create a compelling and interesting musical sequence.
The sequence must have exactly ${engine.sequencerSteps} steps.
Each step is a number: 0 for OFF, 1 for NOTE ON, or 2 for TIE (to continue the previous note).
A tied note (2) must always be preceded by a note-on (1) or another tied note (2).
Do not start the sequence with a 2.
The pattern should be rhythmically interesting.

Return the result as a single, flat JSON array of numbers. For example: [1, 2, 2, 0, 1, 0, 1, 0]`;

            const result = await model.generateContent(prompt);
            const response = await result.response;
            const text = response.text();
            
            // Clean the response
            const cleanedText = text.replace(/```json/g, '').replace(/```/g, '').trim();
            let newSequence = JSON.parse(cleanedText);

            // --- Validation ---
            if (!Array.isArray(newSequence) || newSequence.length !== engine.sequencerSteps) {
                throw new Error(`Sequence is not an array of length ${engine.sequencerSteps}.`);
            }
            if (newSequence.some(n => ![0, 1, 2].includes(n))) {
                throw new Error('Sequence contains invalid numbers.');
            }
            if (newSequence[0] === 2) {
                 throw new Error('Sequence cannot start with a tie.');
            }
            for (let i = 1; i < newSequence.length; i++) {
                if (newSequence[i] === 2 && ![1, 2].includes(newSequence[i - 1])) {
                    // Attempt to self-correct
                    newSequence[i] = 0;
                }
            }

            handleEngineUpdate(engineId, { sequence: newSequence });

        } catch (error) {
            console.error("Error generating sequence:", error);
            // Optionally, show an error to the user
        } finally {
            setIsGenerating(false);
        }
    }, [engines, handleEngineUpdate]);

    const handleLoadSample = useCallback(async (engineId: string, file: File) => {
        if (!audioContext) return;
        try {
            const arrayBuffer = await file.arrayBuffer();
            const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
            samplesRef.current.set(engineId, audioBuffer);
            handleLayerUpdate(engineId, 'sampler', { sampleName: file.name });
            console.log(`Sample "${file.name}" loaded for ${engineId}`);
        } catch (error) {
            console.error('Error loading sample:', error);
        }
    }, [audioContext, handleLayerUpdate]);

    const handleRecordSample = useCallback(async (engineId: string, buffer: AudioBuffer) => {
        samplesRef.current.set(engineId, buffer);
        handleLayerUpdate(engineId, 'sampler', { sampleName: `Recording-${new Date().toLocaleTimeString()}` });
        console.log(`Recorded sample loaded for ${engineId}`);
    }, [handleLayerUpdate]);
    
    const requestMicrophone = async (): Promise<MediaStream | null> => {
        if (audioInputStream) return audioInputStream;
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
            setAudioInputStream(stream);
            return stream;
        } catch (err) {
            console.error("Microphone access denied:", err);
            alert("Microphone access is required for this feature. Please grant permission in your browser settings.");
            return null;
        }
    };

    const handleToggleLiveInput = useCallback(async (engineId: string, enabled: boolean) => {
        if (enabled) {
            const stream = await requestMicrophone();
            if (!stream) return; // Permission denied or failed
        }
        handleLayerUpdate(engineId, 'sampler', { liveInputEnabled: enabled });
    }, [audioInputStream, handleLayerUpdate]);

    const initAudio = useCallback(async () => {
        const context = new (window.AudioContext || (window as any).webkitAudioContext)();
        
        // Master Volume, Analyser, and Safety Limiter
        const masterGain = context.createGain();
        masterGain.gain.value = masterVolume;
        const masterAnalyser = context.createAnalyser();
        masterAnalyser.fftSize = 2048;
        const masterLimiter = context.createDynamicsCompressor();
        
        // Configure as a brickwall limiter
        masterLimiter.threshold.setValueAtTime(-0.1, context.currentTime);
        masterLimiter.knee.setValueAtTime(0, context.currentTime);
        masterLimiter.ratio.setValueAtTime(20, context.currentTime);
        masterLimiter.attack.setValueAtTime(0.001, context.currentTime);
        masterLimiter.release.setValueAtTime(0.05, context.currentTime);

        masterGain.connect(masterAnalyser);
        masterAnalyser.connect(masterLimiter);
        masterLimiter.connect(context.destination);
        
        masterVolumeNodeRef.current = masterGain;
        masterAnalyserNodeRef.current = masterAnalyser;
        
        // --- Setup Master Filters ---
        const createFilter = (): FilterNodes => {
            const node = context.createBiquadFilter();
            const cutoffModBus = context.createGain();
            cutoffModBus.gain.value = 1; // Start with no modulation
            cutoffModBus.connect(node.frequency);
            const resonanceModBus = context.createGain();
            resonanceModBus.gain.value = 1;
            resonanceModBus.connect(node.Q);
            return { node, cutoffModBus, resonanceModBus };
        };
        filterNodesRef.current = { filter1: createFilter(), filter2: createFilter() };
        
        // --- Setup LFOs and Routing Busses ---
        const engineModBussesMap = new Map<string, EngineModBusses>();
        engines.forEach(engine => {
            const busses: EngineModBusses = {
                vol: context.createGain(),
                synthFreq: context.createGain(),
                samplerTranspose: context.createGain(),
                grainSize: context.createGain(),
                grainDensity: context.createGain(),
                grainPosition: context.createGain(),
                grainJitter: context.createGain(),
            };
            Object.values(busses).forEach(bus => bus.gain.value = 0);
            engineModBussesMap.set(engine.id, busses);
        });
        lfoRoutingBussesRef.current = {
            filter1: { cutoffModBus: context.createGain(), resonanceModBus: context.createGain() },
            filter2: { cutoffModBus: context.createGain(), resonanceModBus: context.createGain() },
            engineModBusses: engineModBussesMap,
        };
        // Connect LFO routing busses to filter mod inputs
        lfoRoutingBussesRef.current.filter1.cutoffModBus.connect(filterNodesRef.current.filter1.node.frequency);
        lfoRoutingBussesRef.current.filter1.resonanceModBus.connect(filterNodesRef.current.filter1.node.Q);
        lfoRoutingBussesRef.current.filter2.cutoffModBus.connect(filterNodesRef.current.filter2.node.frequency);
        lfoRoutingBussesRef.current.filter2.resonanceModBus.connect(filterNodesRef.current.filter2.node.Q);
        

        lfos.forEach(lfo => {
            const lfoNode = context.createOscillator();
            const depthGain = context.createGain();
            lfoNode.connect(depthGain);
            lfoNode.start();
            lfoNodesRef.current.set(lfo.id, { lfoNode, depthGain });
        });

        // --- Setup Engines ---
        engines.forEach(engine => {
            const engineNodes: EngineAudioNodes = {
                synth: { volumeGain: context.createGain() },
                noise: { volumeGain: context.createGain() },
                sampler: { volumeGain: context.createGain() },
                engineMixer: context.createGain(),
                sequencerGain: context.createGain(),
                midiInputGain: context.createGain(),
                sequencerModSource: context.createConstantSource(),
                sequencerModGate: context.createGain(),
                finalOutput: context.createGain(),
                analyser: context.createAnalyser(),
            };
            engineNodes.analyser.fftSize = 256;
            
            const engineModBusses = lfoRoutingBussesRef.current!.engineModBusses.get(engine.id)!;
            engineModBusses.vol.connect(engineNodes.finalOutput.gain); // Volume mod affects the final output gain of the engine
            
            // Connect layers to engine mixer
            engineNodes.synth.volumeGain.connect(engineNodes.engineMixer);
            engineNodes.noise.volumeGain.connect(engineNodes.engineMixer);
            engineNodes.sampler.volumeGain.connect(engineNodes.engineMixer);
            
            // Sequencer and MIDI gain paths
            engineNodes.sequencerGain.connect(engineNodes.engineMixer);
            engineNodes.midiInputGain.connect(engineNodes.engineMixer);
            
            // The combined output of seq+midi goes to the main engine mixer
            engineNodes.engineMixer.connect(engineNodes.finalOutput);
            
            // Connect final output to analyser and then to filters
            engineNodes.finalOutput.connect(engineNodes.analyser);
            engineNodes.finalOutput.connect(filterNodesRef.current!.filter1.node); // Start of filter chain
            
            // Sequencer modulation source setup
            engineNodes.sequencerModSource.offset.value = 1;
            engineNodes.sequencerModSource.start();
            engineNodes.sequencerModSource.connect(engineNodes.sequencerModGate);
            
            audioNodesRef.current.set(engine.id, engineNodes);
        });

        // Connect filter chain
        filterNodesRef.current.filter1.node.connect(filterNodesRef.current.filter2.node);
        // The end of the filter chain will connect to the master effects chain start
        
        setAudioContext(context);
        setIsInitialized(true);

        // --- MIDI Setup ---
        try {
            const midiAccess = await navigator.requestMIDIAccess();
            const inputs = Array.from(midiAccess.inputs.values());
            setMidiInputs(inputs);
            if (inputs.length > 0) {
                setSelectedMidiInputId(inputs[0].id);
            }
        } catch (error) {
            console.error("MIDI access denied or not supported.", error);
        }

    }, [engines, lfos, masterVolume]);
    
    // --- Audio Logic Hook ---
    useAudio({
        audioContext, enginesRef, lfos, masterVolume, bpm, isTransportPlaying,
        currentStep, setCurrentStep, samples: samplesRef.current,
        audioNodes: audioNodesRef.current, filterNodes: filterNodesRef.current,
        masterVolumeNode: masterVolumeNodeRef.current, lfoNodes: lfoNodesRef.current,
        lfoRoutingBusses: lfoRoutingBussesRef.current,
        filter1State, filter2State, filterRouting,
        activeVoices: activeVoicesRef.current,
        harmonicTuningSystem,
        voicingMode, glideTime, isGlideSynced, glideSyncRateIndex, glideSyncRates: syncRates,
        activeMonoNotePerEngineRef, lastPlayedNotePerEngineRef,
        masterEffects,
        audioInputStream,
        effectNodes: effectNodesRef.current,
        scale,
        transpose
    });
    
    // --- Note Handlers ---
    const handleNoteOff = useCallback((note: number, specificEngineId?: string) => {
        if (!audioContext) return;
        const now = audioContext.currentTime;

        const enginesToProcess = specificEngineId ? engines.filter(e => e.id === specificEngineId) : engines;

        enginesToProcess.forEach(engine => {
            const voiceKey = `${note}-${engine.id}`;
            const voice = activeVoicesRef.current.get(voiceKey);

            if (voice) {
                const adsr = engine.adsr;
                const currentGain = voice.envelopeGain.gain.value;
                voice.envelopeGain.gain.cancelScheduledValues(now);
                voice.envelopeGain.gain.setValueAtTime(currentGain, now);
                voice.envelopeGain.gain.setTargetAtTime(0, now, adsr.release / 4);
                
                const stopTime = now + adsr.release + 0.5;
                voice.sourceNodes.forEach(node => {
                    try {
                        node.stop(stopTime);
                    } catch (e) { /* ignore */ }
                });
                
                voice.timeoutId = window.setTimeout(() => {
                    activeVoicesRef.current.delete(voiceKey);
                }, (adsr.release + 0.6) * 1000);
            }
        });

        if (voicingMode !== 'poly') {
            if (specificEngineId) {
                if (activeMonoNotePerEngineRef.current.get(specificEngineId) === note) {
                    activeMonoNotePerEngineRef.current.delete(specificEngineId);
                }
            } else {
                engines.forEach(engine => {
                    if (activeMonoNotePerEngineRef.current.get(engine.id) === note) {
                        activeMonoNotePerEngineRef.current.delete(engine.id);
                    }
                });
            }
        }
        
        enginesToProcess.forEach(engine => {
            const engineNodes = audioNodesRef.current.get(engine.id);
            if (engineNodes && engineNodes.sampler.granularMidiNote === note) {
                 if (engineNodes.sampler.granularSchedulerId) {
                    clearTimeout(engineNodes.sampler.granularSchedulerId);
                    engineNodes.sampler.granularSchedulerId = undefined;
                }
                engineNodes.sampler.granularMidiNote = undefined;
            }
        });

    }, [audioContext, voicingMode, engines]);

    const handleNoteOn = useCallback((note: number, velocity: number) => {
        if (!audioContext) return;
        const now = audioContext.currentTime;

        engines.forEach(engine => {
            if (!engine.midiControlled) return;

            const voiceKey = `${note}-${engine.id}`;
            const existingVoice = activeVoicesRef.current.get(voiceKey);
            if (existingVoice && existingVoice.timeoutId) {
                clearTimeout(existingVoice.timeoutId);
            }
            
            if (voicingMode === 'mono' || voicingMode === 'legato') {
                const existingNote = activeMonoNotePerEngineRef.current.get(engine.id);
                if (existingNote) {
                    handleNoteOff(existingNote, engine.id); // Stop previous note for this engine
                }
            }
            
            const isLegatoTransition = voicingMode === 'legato' && activeMonoNotePerEngineRef.current.has(engine.id);
            const glideDuration = calculateTimeFromSync(bpm, isGlideSynced, glideSyncRateIndex, syncRates, glideTime) / 1000;
            const targetFreq = midiNoteToFrequency(note + transpose, harmonicTuningSystem);
            const startFreq = isLegatoTransition ? midiNoteToFrequency(activeMonoNotePerEngineRef.current.get(engine.id)! + transpose, harmonicTuningSystem) : targetFreq;
            
            const adsr = engine.adsr;
            const envelopeGain = audioContext.createGain();
            envelopeGain.connect(audioNodesRef.current.get(engine.id)!.midiInputGain);
            
            const peakAmp = velocity; // Volume is controlled at the layer level now
            envelopeGain.gain.cancelScheduledValues(now);

            if (isLegatoTransition) {
                 envelopeGain.gain.setValueAtTime(envelopeGain.gain.value, now); // Maintain current gain
            } else {
                envelopeGain.gain.setValueAtTime(0, now);
                envelopeGain.gain.linearRampToValueAtTime(peakAmp, now + adsr.attack);
                envelopeGain.gain.setTargetAtTime(peakAmp * adsr.sustain, now + adsr.attack, adsr.decay / 4); // Exponential decay
            }


            const activeVoice: ActiveVoice = { sourceNodes: [], envelopeGain };

            // --- Synth Layer ---
            if (engine.synth.enabled) {
                const osc = audioContext.createOscillator();
                osc.type = engine.synth.oscillatorType;
                
                // Connect modulation
                const modBus = lfoRoutingBussesRef.current!.engineModBusses.get(engine.id)!.synthFreq;
                modBus.connect(osc.detune); // Modulate detune, not frequency directly

                if (engine.synth.frequencyOverride) {
                    osc.frequency.value = engine.synth.frequency;
                } else {
                    osc.frequency.setValueAtTime(startFreq, now);
                    osc.frequency.linearRampToValueAtTime(targetFreq, now + glideDuration);
                }
                
                const vol = audioContext.createGain();
                vol.gain.value = engine.synth.volume;
                osc.connect(vol);
                vol.connect(envelopeGain);
                
                osc.start(now);
                activeVoice.sourceNodes.push(osc);
                lastPlayedNotePerEngineRef.current.set(`${engine.id}-synth`, note);
            }
            // --- Noise Layer ---
            if (engine.noise.enabled) {
                 const noiseSource = createNoiseNode(audioContext, engine.noise.noiseType);
                 const vol = audioContext.createGain();
                 vol.gain.value = engine.noise.volume;
                 noiseSource.connect(vol);
                 vol.connect(envelopeGain);
                 noiseSource.start(now);
                 activeVoice.sourceNodes.push(noiseSource);
            }
            // --- Sampler Layer ---
            const sampleBuffer = samplesRef.current.get(engine.id);
            if (engine.sampler.enabled && sampleBuffer && !engine.sampler.granularModeEnabled && !engine.sampler.liveInputEnabled) {
                const source = audioContext.createBufferSource();
                source.buffer = sampleBuffer;
                
                 // Connect modulation
                const modBus = lfoRoutingBussesRef.current!.engineModBusses.get(engine.id)!.samplerTranspose;
                modBus.connect(source.detune); // Modulate detune in cents
                
                const basePlaybackRate = Math.pow(2, engine.sampler.transpose / 12);
                const targetPlaybackRate = basePlaybackRate * Math.pow(2, (note - 60) / 12); // Relative to C4
                const startPlaybackRate = isLegatoTransition
                    ? basePlaybackRate * Math.pow(2, (activeMonoNotePerEngineRef.current.get(engine.id)! - 60) / 12)
                    : targetPlaybackRate;

                source.playbackRate.setValueAtTime(startPlaybackRate, now);
                source.playbackRate.linearRampToValueAtTime(targetPlaybackRate, now + glideDuration);
                
                source.loop = true;
                
                const vol = audioContext.createGain();
                vol.gain.value = engine.sampler.volume;
                source.connect(vol);
                vol.connect(envelopeGain);

                source.start(now);
                activeVoice.sourceNodes.push(source);
                lastPlayedNotePerEngineRef.current.set(`${engine.id}-sampler`, note);
            }
            
            // --- Granular Layer (MIDI Triggered) ---
            if (engine.sampler.enabled && sampleBuffer && engine.sampler.granularModeEnabled) {
                const engineNodes = audioNodesRef.current.get(engine.id);
                if(engineNodes) {
                    if (engineNodes.sampler.granularSchedulerId) {
                        clearTimeout(engineNodes.sampler.granularSchedulerId);
                    }
                    engineNodes.sampler.granularMidiNote = note;
                    lastPlayedNotePerEngineRef.current.set(`${engine.id}-sampler`, note);
                }
            }

            if(activeVoice.sourceNodes.length > 0) {
                 activeVoicesRef.current.set(voiceKey, activeVoice);
                 if(voicingMode !== 'poly') {
                    activeMonoNotePerEngineRef.current.set(engine.id, note);
                 }
            }
        });

    }, [audioContext, engines, voicingMode, harmonicTuningSystem, bpm, isGlideSynced, glideSyncRateIndex, syncRates, glideTime, handleNoteOff, transpose]);

    // --- MIDI Input Handling ---
    useEffect(() => {
        const currentInput = selectedMidiInputId ? midiInputs.find(i => i.id === selectedMidiInputId) : null;

        const handleMidiMessage = (event: MIDIMessageEvent) => {
            const [command, note, velocity] = event.data;
            // command 144: noteOn, command 128: noteOff
            if (command >= 144 && command < 160 && velocity > 0) { // Note On on any channel
                handleNoteOn(note, velocity / 127);
                 setMidiActivity(true);
                 if(midiActivityTimeoutRef.current) clearTimeout(midiActivityTimeoutRef.current);
                 midiActivityTimeoutRef.current = window.setTimeout(() => setMidiActivity(false), 100);

            } else if (command >= 128 && command < 144 || (command >= 144 && command < 160 && velocity === 0)) { // Note Off on any channel
                handleNoteOff(note);
            }
        };

        if (currentInput) {
            currentInput.addEventListener('midimessage', handleMidiMessage);
            console.log(`Listening to MIDI device: ${currentInput.name}`);
        }

        return () => {
            if (currentInput) {
                currentInput.removeEventListener('midimessage', handleMidiMessage);
                console.log(`Stopped listening to MIDI device: ${currentInput.name}`);
            }
        };
    }, [selectedMidiInputId, midiInputs, handleNoteOn, handleNoteOff]);


     const handleToggleTransport = () => {
        if (audioContext && audioContext.state === 'suspended') {
            audioContext.resume();
        }
        setIsTransportPlaying(prev => !prev);
        if (isTransportPlaying) {
             setCurrentStep(0); // Reset on stop
        }
    };
    
    // Morphing Logic
    useEffect(() => {
        let animationFrameId: number;
        
        const effectiveMorphTime = calculateTimeFromSync(bpm, isMorphSynced, morphSyncRateIndex, syncRates, morphTime);

        if (isMorphing && morphStartRef.current && morphTargetRef.current && morphStartTimeRef.current) {
            const morphDurationInSeconds = effectiveMorphTime / 1000;
            const update = () => {
                const elapsedTime = (Date.now() - morphStartTimeRef.current!) / 1000;
                const progress = Math.min(elapsedTime / morphDurationInSeconds, 1);

                const lerp = (start: number, end: number, t: number) => start * (1 - t) + end * t;
                const newState = { ...morphStartRef.current };
                
                // Lerp engines
                newState.engines = morphStartRef.current.engines.map((startEngine: EngineState, i: number) => {
                    const targetEngine = morphTargetRef.current.engines[i];
                    return {
                        ...startEngine,
                        sequencerSteps: lockState.engines[startEngine.id].sequencerSteps ? startEngine.sequencerSteps : Math.round(lerp(startEngine.sequencerSteps, targetEngine.sequencerSteps, progress)),
                        sequencerPulses: lockState.engines[startEngine.id].sequencerPulses ? startEngine.sequencerPulses : Math.round(lerp(startEngine.sequencerPulses, targetEngine.sequencerPulses, progress)),
                        sequencerRotate: lockState.engines[startEngine.id].sequencerRotate ? startEngine.sequencerRotate : Math.round(lerp(startEngine.sequencerRotate, targetEngine.sequencerRotate, progress)),
                        synth: { ...startEngine.synth, volume: lerp(startEngine.synth.volume, targetEngine.synth.volume, progress) },
                        noise: { ...startEngine.noise, volume: lerp(startEngine.noise.volume, targetEngine.noise.volume, progress) },
                        sampler: {
                            ...startEngine.sampler,
                            volume: lerp(startEngine.sampler.volume, targetEngine.sampler.volume, progress),
                            transpose: lerp(startEngine.sampler.transpose, targetEngine.sampler.transpose, progress),
                            grainSize: lerp(startEngine.sampler.grainSize, targetEngine.sampler.grainSize, progress),
                            grainDensity: lerp(startEngine.sampler.grainDensity, targetEngine.sampler.grainDensity, progress),
                            playbackPosition: lerp(startEngine.sampler.playbackPosition, targetEngine.sampler.playbackPosition, progress),
                            positionJitter: lerp(startEngine.sampler.positionJitter, targetEngine.sampler.positionJitter, progress),
                        },
                        adsr: {
                            ...startEngine.adsr,
                            attack: lerp(startEngine.adsr.attack, targetEngine.adsr.attack, progress),
                            decay: lerp(startEngine.adsr.decay, targetEngine.adsr.decay, progress),
                            sustain: lerp(startEngine.adsr.sustain, targetEngine.adsr.sustain, progress),
                            release: lerp(startEngine.adsr.release, targetEngine.adsr.release, progress),
                        }
                    };
                });
                
                // Lerp Filters
                newState.filter1State = {
                    ...morphStartRef.current.filter1State,
                    cutoff: lockState.filter1.cutoff ? morphStartRef.current.filter1State.cutoff : lerp(morphStartRef.current.filter1State.cutoff, morphTargetRef.current.filter1State.cutoff, progress),
                    resonance: lockState.filter1.resonance ? morphStartRef.current.filter1State.resonance : lerp(morphStartRef.current.filter1State.resonance, morphTargetRef.current.filter1State.resonance, progress),
                };
                newState.filter2State = {
                     ...morphStartRef.current.filter2State,
                    cutoff: lockState.filter2.cutoff ? morphStartRef.current.filter2State.cutoff : lerp(morphStartRef.current.filter2State.cutoff, morphTargetRef.current.filter2State.cutoff, progress),
                    resonance: lockState.filter2.resonance ? morphStartRef.current.filter2State.resonance : lerp(morphStartRef.current.filter2State.resonance, morphTargetRef.current.filter2State.resonance, progress),
                };
                
                 newState.lfos = morphStartRef.current.lfos.map((startLfo: LFOState, i: number) => {
                    const targetLfo = morphTargetRef.current.lfos[i];
                    return { ...startLfo, rate: lerp(startLfo.rate, targetLfo.rate, progress), depth: lerp(startLfo.depth, targetLfo.depth, progress) }
                 });

                 newState.masterEffects = morphStartRef.current.masterEffects.map((startEffect: MasterEffect) => {
                     const targetEffect = morphTargetRef.current.masterEffects.find((e: MasterEffect) => e.id === startEffect.id);
                     if(!targetEffect) return startEffect;
                     const newParams = {...startEffect.params};
                     if(newParams.delay && targetEffect.params.delay) {
                        newParams.delay.time = lerp(startEffect.params.delay!.time, targetEffect.params.delay.time, progress);
                        newParams.delay.feedback = lerp(startEffect.params.delay!.feedback, targetEffect.params.delay.feedback, progress);
                        newParams.delay.mix = lerp(startEffect.params.delay!.mix, targetEffect.params.delay.mix, progress);
                     }
                      if(newParams.reverb && targetEffect.params.reverb) {
                        newParams.reverb.decay = lerp(startEffect.params.reverb!.decay, targetEffect.params.reverb.decay, progress);
                        newParams.reverb.mix = lerp(startEffect.params.reverb!.mix, targetEffect.params.reverb.mix, progress);
                     }
                     //... etc for other effects
                     return {...startEffect, params: newParams};
                 });

                setEngines(newState.engines);
                setFilter1State(newState.filter1State);
                setFilter2State(newState.filter2State);
                setLfos(newState.lfos);
                setMasterEffects(newState.masterEffects);

                if (progress < 1) {
                    animationFrameId = requestAnimationFrame(update);
                } else {
                    setIsMorphing(false);
                    morphStartTimeRef.current = null;
                }
            };
            animationFrameId = requestAnimationFrame(update);
        }
        return () => cancelAnimationFrame(animationFrameId);
    }, [isMorphing, morphTime, isMorphSynced, morphSyncRateIndex, bpm, syncRates, lockState]);


    // Randomization Logic
    const handleRandomize = (mode: RandomizeMode, scope: string) => {
        const randomizeRouting = () => {
            const newState = { ...DEFAULT_LFO_ROUTING_STATE };
            const keys = Object.keys(newState) as (keyof LFORoutingState)[];
            const numRoutings = getRandomInt(2, 6);
            for(let i=0; i<numRoutings; i++) {
                newState[getRandomElement(keys)] = true;
            }
            return newState;
        };

        if(scope === 'routing') {
            setLfos(prev => prev.map(lfo => ({ ...lfo, routing: randomizeRouting() })));
            setEngines(prev => prev.map(engine => ({ ...engine, routing: randomizeRouting() })));
            return;
        }

        const createRandomizedState = () => {
            const newEngines = engines.map((engine): EngineState => {
                 if (scope !== 'global' && scope !== engine.id) return engine;
                 const locks = lockState.engines[engine.id];
                 
                 let sequencerParams: Partial<EngineState> = {};
                 if (mode === 'rhythmic' || mode === 'chaos') {
                    sequencerParams = {
                        sequencerSteps: locks.sequencerSteps ? engine.sequencerSteps : getRandomElement([8,12,16,24,32]),
                        sequencerPulses: locks.sequencerPulses ? engine.sequencerPulses : getRandomInt(1, engine.sequencerSteps),
                        sequencerRotate: locks.sequencerRotate ? engine.sequencerRotate : getRandomInt(0, engine.sequencerSteps - 1),
                        sequencerRate: locks.sequencerRate ? engine.sequencerRate : getRandomElement(sequencerRates),
                    }
                 }

                                  let newMelodicSequence: number[] = [];
                                  let newSynthState: Partial<SynthLayerState> = { ...engine.synth }; // Start with current synth state
                 
                                  console.log("handleRandomize called. Mode:", mode, "Scope:", scope, "Harmonic Tuning System:", harmonicTuningSystem);
                 
                                  if (mode === 'harmonic' || mode === 'chaos') {
                                     if (mode === 'harmonic') {
                                         if (harmonicTuningSystem === 'maria_renold_I') {
                                             const shuffledFrequencies = shuffleArray([...mariaRenoldFrequencies]);
                                             for (let i = 0; i < engine.sequencerSteps; i++) {
                                                 newMelodicSequence.push(shuffledFrequencies[i % shuffledFrequencies.length]);
                                             }
                                             console.log("Maria Renold I melodicSequence:", newMelodicSequence);
                                         } else if (harmonicTuningSystem === 'none') {
                                             for (let i = 0; i < engine.sequencerSteps; i++) {
                                                 newMelodicSequence.push(getRandom(20, 20000));
                                             }
                                             console.log("None melodicSequence (random freqs):", newMelodicSequence);
                                         } else {
                                             // For other harmonic tuning systems, randomize a note within the scale
                                             for (let i = 0; i < engine.sequencerSteps; i++) {
                                                 const randomMidiNote = getRandomInt(40, 90); // A reasonable range for notes
                                                 newMelodicSequence.push(midiNoteToFrequency(randomMidiNote, harmonicTuningSystem));
                                             }
                                             console.log("Other harmonic melodicSequence:", newMelodicSequence);
                                         }
                                         // For harmonic mode, ensure frequencyOverride is true and set a base frequency (e.g., the first note of the generated sequence)
                                         newSynthState.frequencyOverride = true;
                                         if (newMelodicSequence.length > 0) {
                                             newSynthState.frequency = newMelodicSequence[0]; // Set base frequency to the first note of the sequence
                                         }
                                     } else if (mode === 'chaos') {
                                         newSynthState.frequency = getRandom(20, 20000);
                                         newSynthState.frequencyOverride = true;
                                         console.log("Chaos mode synth frequency:", newSynthState.frequency);
                                     }
                 
                                     newSynthState.enabled = getRandomBool(0.8);
                                     newSynthState.volume = (locks.synth as any).volume ? engine.synth.volume : getRandom(0.4, 0.9);
                                     newSynthState.oscillatorType = (locks.synth as any).oscillatorType ? engine.synth.oscillatorType : getRandomElement(oscillatorTypes);
                                     newSynthState.solfeggioFrequency = (locks.synth as any).solfeggioFrequency || harmonicTuningSystem === 'solfeggio'
                                         ? getRandomElement(solfeggioFrequenciesData).value.toString()
                                         : engine.synth.solfeggioFrequency;
                                  }
                 
                                  return {
                                      ...engine,
                                      ...sequencerParams,
                                      synth: newSynthState, // Use the newSynthState
                                      melodicSequence: newMelodicSequence.length > 0 ? newMelodicSequence : engine.melodicSequence, // Update melodic sequence
                                      routing: randomizeRouting(),
                                      adsr: {
                                         attack: (locks.adsr as any).attack ? engine.adsr.attack : getRandom(0.001, 1.5),
                                         decay: (locks.adsr as any).decay ? engine.adsr.decay : getRandom(0.01, 2.0),
                                         sustain: (locks.adsr as any).sustain ? engine.adsr.sustain : getRandom(0.1, 1.0),
                                         release: (locks.adsr as any).release ? engine.adsr.release : getRandom(0.01, 3.0),
                                      }
                                  };            });
            
            const newLfos = lfos.map((lfo): LFOState => {
                 if (scope !== 'global' && scope !== lfo.id) return lfo;
                 const locks = lockState.lfos[lfo.id];
                 return {
                     ...lfo,
                     routing: randomizeRouting(),
                     rate: locks.rate ? lfo.rate : (mode === 'harmonic' ? getRandom(4, 12) : getRandom(0.1, 20)),
                     depth: locks.depth ? lfo.depth : getRandom(0, 1),
                     shape: locks.shape ? lfo.shape : getRandomElement(lfoShapes),
                     sync: locks.sync ? lfo.sync : (mode === 'rhythmic' ? true : getRandomBool()),
                     syncRate: locks.syncRate ? lfo.syncRate : getRandomElement(lfoSyncRates),
                 }
            });
            
            const newFilter1 = (scope === 'global' || scope === 'filter1') ? { 
                ...filter1State,
                cutoff: lockState.filter1.cutoff ? filter1State.cutoff : (mode === 'harmonic' ? midiNoteToFrequency(getRandomInt(40, 90), harmonicTuningSystem) : getRandom(100, 10000)), 
                resonance: lockState.filter1.resonance ? filter1State.resonance : getRandom(0, 20), 
                type: lockState.filter1.type ? filter1State.type : getRandomElement(filterTypes) 
            } : filter1State;
            const newFilter2 = (scope === 'global' || scope === 'filter2') ? { 
                ...filter2State,
                cutoff: lockState.filter2.cutoff ? filter2State.cutoff : (mode === 'harmonic' ? midiNoteToFrequency(getRandomInt(40, 90), harmonicTuningSystem) : getRandom(100, 15000)), 
                resonance: lockState.filter2.resonance ? filter2State.resonance : getRandom(0, 15), 
                type: lockState.filter2.type ? filter2State.type : getRandomElement(filterTypes) 
            } : filter2State;
            
            const newMasterEffects = masterEffects.map(effect => {
                 if (scope !== 'global' && scope !== effect.id) return effect;
                 const newParams = { ...effect.params };
                 switch(effect.type) {
                    case 'delay': newParams.delay = { time: getRandom(0.01, 2), feedback: getRandom(0, 0.9), mix: getRandom(0, 1) }; break;
                    case 'reverb': newParams.reverb = { decay: getRandom(0.1, 8), mix: getRandom(0, 1) }; break;
                    case 'chorus': newParams.chorus = { rate: getRandom(0.1, 5), depth: getRandom(0.1, 0.9), mix: getRandom(0, 1) }; break;
                    case 'distortion': newParams.distortion = { mode: getRandomElement(distortionModes), amount: getRandom(0, 1) }; break;
                    case 'flanger': newParams.flanger = { rate: getRandom(0.1, 5), depth: getRandom(0.1, 0.9), delay: 0.005, feedback: getRandom(0, 0.9), mix: getRandom(0, 1) }; break;
                    case 'phaser': newParams.phaser = { rate: getRandom(0.1, 8), stages: getRandomElement([2,4,6,8,10,12]), q: getRandom(1, 20), mix: getRandom(0, 1) }; break;
                    case 'tremolo': newParams.tremolo = { rate: getRandom(0.1, 20), depth: getRandom(0, 1), shape: getRandomElement(lfoShapes), mix: getRandom(0, 1) }; break;
                    case 'eq': newParams.eq = { bands: Array(8).fill(0).map(() => getRandom(-12, 12)) }; break;
                 }
                 return { ...effect, params: newParams };
            });

            return { engines: newEngines, filter1State: newFilter1, filter2State: newFilter2, lfos: newLfos, masterEffects: newMasterEffects };
        };

        const randomState = createRandomizedState();

        if (scope === 'global') {
            morphStartRef.current = { engines, filter1State, filter2State, lfos, masterEffects };
            morphTargetRef.current = randomState;
            morphStartTimeRef.current = Date.now();
            setIsMorphing(true);
        } else {
             setEngines(randomState.engines);
             setFilter1State(randomState.filter1State);
             setFilter2State(randomState.filter2State);
             setLfos(randomState.lfos);
             setMasterEffects(randomState.masterEffects);
        }
    };
    
    const handleInitialize = (scope: string) => {
        if (scope.startsWith('engine')) {
            const defaultEngine = initialAppState.engines.find(e => e.id === scope);
            if(defaultEngine) setEngines(prev => prev.map(e => e.id === scope ? defaultEngine : e));
        } else if (scope.startsWith('filter')) {
            if(scope === 'filter1') setFilter1State(initialAppState.filter1);
            else setFilter2State(initialAppState.filter2);
        } else if (scope.startsWith('lfo')) {
            const defaultLfo = initialAppState.lfos.find(l => l.id === scope);
            if(defaultLfo) setLfos(prev => prev.map(l => l.id === scope ? defaultLfo : l));
        } else { // Must be a master effect by its ID
            setMasterEffects(prev => prev.map(effect => {
                if (effect.id === scope) {
                    return { ...effect, params: getDefaultEffectParams(effect.type) };
                }
                return effect;
            }));
        }
    };
    
    const handlePanic = useCallback(() => {
        console.log("PANIC button clicked!");
        if (audioContext) {
            audioContext.close().then(() => {
                console.log("Audio context closed. Re-initializing.");
                initAudio();
            });
        } else {
            initAudio();
        }
        
        activeVoicesRef.current.clear();
        activeMonoNotePerEngineRef.current.clear();
        setIsTransportPlaying(false);
        setCurrentStep(0);
        
    }, [audioContext, initAudio]);

    if (!isInitialized) {
      return (
        <div className="init-overlay">
          <button onClick={initAudio}>Initialize Audio Engine</button>
        </div>
      );
    }
    
    return (
        <div className="app-container">
            <TopBar
                masterVolume={masterVolume} setMasterVolume={setMasterVolume}
                bpm={bpm} setBPM={setBPM}
                isTransportPlaying={isTransportPlaying} onToggleTransport={handleToggleTransport}
                onPanic={handlePanic}
                midiInputs={midiInputs} selectedMidiInputId={selectedMidiInputId}
                onMidiInputChange={setSelectedMidiInputId} midiActivity={midiActivity}
                lockState={lockState} onToggleLock={handleToggleLock}
            />

             <MainControlPanel
                onRandomize={handleRandomize}
                isMorphing={isMorphing}
                morphTime={morphTime} setMorphTime={setMorphTime}
                isMorphSynced={isMorphSynced} setIsMorphSynced={setIsMorphSynced}
                morphSyncRateIndex={morphSyncRateIndex} setMorphSyncRateIndex={setMorphSyncRateIndex}
                syncRates={syncRates}
                harmonicTuningSystem={harmonicTuningSystem} setHarmonicTuningSystem={setHarmonicTuningSystem}
                voicingMode={voicingMode} setVoicingMode={setVoicingMode}
                glideTime={glideTime} setGlideTime={setGlideTime}
                isGlideSynced={isGlideSynced} setIsGlideSynced={setIsGlideSynced}
                glideSyncRateIndex={glideSyncRateIndex} setGlideSyncRateIndex={setGlideSyncRateIndex}
                glideSyncRates={syncRates}
                scale={scale}
                setScale={setScale}
                transpose={transpose}
                setTranspose={setTranspose}
            />
            
            <div className="master-visualizer-container">
                <div className="visualizer-wrapper">
                    <span className="visualizer-label">MASTER</span>
                     {masterAnalyserNodeRef.current && <Visualizer analyserNode={masterAnalyserNodeRef.current} type="waveform" />}
                </div>
            </div>

            <div className="channels-container">
                {engines.map((engine, index) => (
                    <EngineControls
                        key={engine.id}
                        engine={engine}
                        onUpdate={handleEngineUpdate}
                        onLayerUpdate={handleLayerUpdate}
                        onLoadSample={handleLoadSample}
                        onRecordSampleRequest={requestMicrophone}
                        onRecordSample={handleRecordSample}
                        onToggleLiveInput={handleToggleLiveInput}
                        onRandomize={handleRandomize}
                        onInitialize={handleInitialize}
                        analyserNode={audioNodesRef.current.get(engine.id)?.analyser}
                        currentStep={currentStep}
                        isTransportPlaying={isTransportPlaying}
                        audioContext={audioContext}
                        lockState={lockState}
                        onToggleLock={handleToggleLock}
                        harmonicTuningSystem={harmonicTuningSystem}
                    />
                ))}
            </div>
            
            <div className="processing-container">
                 <div className="filters-container">
                    <div className="filters-container-header">
                        <h2>Master Filters</h2>
                        <div className="filter-routing-switch">
                            <button className={filterRouting === 'series' ? 'active' : ''} onClick={() => setFilterRouting('series')}>Series</button>
                            <button className={filterRouting === 'parallel' ? 'active' : ''} onClick={() => setFilterRouting('parallel')}>Parallel</button>
                        </div>
                    </div>
                    <div className="filters-grid">
                        <MasterFilterControls title="Filter 1" filterState={filter1State} onUpdate={(updates) => setFilter1State(s => ({...s, ...updates}))} onRandomize={handleRandomize} onInitialize={handleInitialize} lockState={lockState} onToggleLock={handleToggleLock} />
                        <MasterFilterControls title="Filter 2" filterState={filter2State} onUpdate={(updates) => setFilter2State(s => ({...s, ...updates}))} onRandomize={handleRandomize} onInitialize={handleInitialize} lockState={lockState} onToggleLock={handleToggleLock} />
                    </div>
                </div>
                 <MasterEffects effects={masterEffects} setEffects={setMasterEffects} onRandomize={handleRandomize} onInitialize={handleInitialize} lockState={lockState} onToggleLock={handleToggleLock} />
            </div>

            <BottomTabs
                lfoStates={lfos} handleLfoUpdate={handleLfoUpdate}
                engineStates={engines} handleEngineUpdate={handleEngineUpdate}
                onRandomize={handleRandomize}
                onInitialize={handleInitialize}
                bpm={bpm}
                lockState={lockState}
                onToggleLock={handleToggleLock}
            />

        </div>
    );
};


// --- Helper Functions for Audio Logic ---
const calculateTimeFromSync = (bpm: number, isSynced: boolean, syncIndex: number, syncRates: string[], timeMs: number) => {
    if (!isSynced) return timeMs;
    const rate = syncRates[syncIndex];
    const beatDuration = 60 / bpm;
    switch(rate) {
        case '1/64': return beatDuration / 16 * 1000;
        case '1/32': return beatDuration / 8 * 1000;
        case '1/16': return beatDuration / 4 * 1000;
        case '1/8': return beatDuration / 2 * 1000;
        case '1/8d': return (beatDuration / 2) * 1.5 * 1000;
        case '1/4': return beatDuration * 1000;
        case '1/4d': return beatDuration * 1.5 * 1000;
        case '1/2': return beatDuration * 2 * 1000;
        default: return timeMs;
    }
}

const createNoiseNode = (ctx: AudioContext, type: NoiseType): AudioBufferSourceNode => {
    const bufferSize = ctx.sampleRate * 2; // 2 seconds of noise
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const output = buffer.getChannelData(0);
    let lastOut = 0;
    for (let i = 0; i < bufferSize; i++) {
        switch (type) {
            case 'white':
                output[i] = Math.random() * 2 - 1;
                break;
            case 'pink':
                const b0 = 0.99886 * lastOut + (Math.random() * 2 - 1) * 0.0555179;
                const b1 = 0.99332 * lastOut + (Math.random() * 2 - 1) * 0.0750759;
                const b2 = 0.96900 * lastOut + (Math.random() * 2 - 1) * 0.1538520;
                lastOut = b0 + b1 + b2 + (Math.random() * 2 - 1) * 0.01;
                output[i] = lastOut * 0.11;
                break;
            case 'brown':
                const white = Math.random() * 2 - 1;
                output[i] = (lastOut + (0.02 * white)) / 1.02;
                lastOut = output[i];
                output[i] *= 3.5;
                break;
        }
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    noise.loop = true;
    return noise;
};

// --- Main Audio Processing Hook ---
const useAudio = ({
  audioContext, enginesRef, lfos, masterVolume, bpm, isTransportPlaying,
  currentStep, setCurrentStep, samples, audioNodes, filterNodes, masterVolumeNode,
  lfoNodes, lfoRoutingBusses, filter1State, filter2State, filterRouting,
  activeVoices, harmonicTuningSystem, voicingMode, glideTime, isGlideSynced, glideSyncRateIndex, glideSyncRates,
  activeMonoNotePerEngineRef, lastPlayedNotePerEngineRef, masterEffects, audioInputStream, effectNodes,
  scale, transpose
}: {
  audioContext: AudioContext | null;
  enginesRef: React.MutableRefObject<EngineState[]>;
  lfos: LFOState[];
  masterVolume: number;
  bpm: number;
  isTransportPlaying: boolean;
  currentStep: number;
  setCurrentStep: React.Dispatch<React.SetStateAction<number>>;
  samples: Map<string, AudioBuffer>;
  audioNodes: Map<string, EngineAudioNodes>;
  filterNodes: { filter1: FilterNodes, filter2: FilterNodes } | null;
  masterVolumeNode: GainNode | null;
  lfoNodes: Map<string, { lfoNode: OscillatorNode; depthGain: GainNode }>;
  lfoRoutingBusses: LfoRoutingBusses | null;
  filter1State: FilterState;
  filter2State: FilterState;
  filterRouting: FilterRouting;
  activeVoices: Map<string, ActiveVoice>;
  harmonicTuningSystem: TuningSystem;
  voicingMode: VoicingMode;
  glideTime: number;
  isGlideSynced: boolean;
  glideSyncRateIndex: number;
  glideSyncRates: string[];
  activeMonoNotePerEngineRef: React.MutableRefObject<Map<string, number>>;
  lastPlayedNotePerEngineRef: React.MutableRefObject<Map<string, number>>;
  masterEffects: MasterEffect[];
  audioInputStream: MediaStream | null;
  effectNodes: Map<string, any>;
  scale: ScaleName;
  transpose: number;
}) => {
    
    const nextNoteTimeRef = useRef(0);
    const currentStepRef = useRef(0);
    const schedulerTimeoutIdRef = useRef<number | null>(null);
    const currentVisualStepRef = useRef(0);
    const uiUpdateIdRef = useRef<number | null>(null);

    // Update master volume
    useEffect(() => {
        if (masterVolumeNode?.gain) {
            masterVolumeNode.gain.value = masterVolume;
        }
    }, [masterVolume, masterVolumeNode]);
    
     // Update filter settings
    useEffect(() => {
        if (filterNodes && audioContext) {
            const now = audioContext.currentTime;
            filterNodes.filter1.node.type = filter1State.enabled ? filter1State.type : 'allpass';
            filterNodes.filter1.node.frequency.setTargetAtTime(filter1State.enabled ? filter1State.cutoff : audioContext.sampleRate / 2, now, 0.01);
            filterNodes.filter1.node.Q.setTargetAtTime(filter1State.enabled ? filter1State.resonance : 0, now, 0.01);
            
            filterNodes.filter2.node.type = filter2State.enabled ? filter2State.type : 'allpass';
            filterNodes.filter2.node.frequency.setTargetAtTime(filter2State.enabled ? filter2State.cutoff : audioContext.sampleRate / 2, now, 0.01);
            filterNodes.filter2.node.Q.setTargetAtTime(filter2State.enabled ? filter2State.resonance : 0, now, 0.01);
        }
    }, [filter1State, filter2State, filterNodes, audioContext]);
    
    // Update LFO settings
    useEffect(() => {
        if (!audioContext) return;
        const now = audioContext.currentTime;
        lfos.forEach(lfoState => {
            const lfo = lfoNodes.get(lfoState.id);
            if (lfo) {
                lfo.lfoNode.type = lfoState.shape === 'ramp' ? 'sawtooth' : lfoState.shape; // Ramp is just inverted saw visually
                const rate = lfoState.sync ? bpm / 60 / (lfoSyncRates.indexOf(lfoState.syncRate) === 4 ? 1 : parseFloat(lfoState.syncRate) * 4) : lfoState.rate;
                lfo.lfoNode.frequency.setTargetAtTime(rate, now, 0.01);
                lfo.depthGain.gain.setTargetAtTime(lfoState.depth, now, 0.01);
            }
        });
    }, [lfos, lfoNodes, bpm, audioContext]);

    // Update modulation routing
    useEffect(() => {
        if (!lfoRoutingBusses || !audioContext) return;
        
        // Disconnect all LFOs and Sequencers first to clear old routings
        lfoNodes.forEach(({ depthGain }) => depthGain.disconnect());
        audioNodes.forEach(engineNode => engineNode.sequencerModGate.disconnect());
        
        // Reconnect LFOs based on current state
        lfos.forEach(lfoState => {
            const lfo = lfoNodes.get(lfoState.id);
            if (!lfo) return;
            const routing = lfoState.routing;
            if (routing.filter1Cutoff) lfo.depthGain.connect(lfoRoutingBusses.filter1.cutoffModBus);
            if (routing.filter1Resonance) lfo.depthGain.connect(lfoRoutingBusses.filter1.resonanceModBus);
            if (routing.filter2Cutoff) lfo.depthGain.connect(lfoRoutingBusses.filter2.cutoffModBus);
            if (routing.filter2Resonance) lfo.depthGain.connect(lfoRoutingBusses.filter2.resonanceModBus);
            enginesRef.current.forEach(engine => {
                const bus = lfoRoutingBusses.engineModBusses.get(engine.id);
                if (bus) {
                    const engineKeyPrefix = `engine${engine.id.slice(-1)}`;
                    if (routing[`${engineKeyPrefix}Vol` as keyof LFORoutingState]) lfo.depthGain.connect(bus.vol);
                    if (routing[`${engineKeyPrefix}SynthFreq` as keyof LFORoutingState]) lfo.depthGain.connect(bus.synthFreq);
                    if (routing[`${engineKeyPrefix}SamplerTranspose` as keyof LFORoutingState]) lfo.depthGain.connect(bus.samplerTranspose);
                    if (routing[`${engineKeyPrefix}GrainSize` as keyof LFORoutingState]) lfo.depthGain.connect(bus.grainSize);
                    if (routing[`${engineKeyPrefix}GrainDensity` as keyof LFORoutingState]) lfo.depthGain.connect(bus.grainDensity);
                    if (routing[`${engineKeyPrefix}GrainPosition` as keyof LFORoutingState]) lfo.depthGain.connect(bus.grainPosition);
                    if (routing[`${engineKeyPrefix}GrainJitter` as keyof LFORoutingState]) lfo.depthGain.connect(bus.grainJitter);
                }
            });
        });
        
        // Reconnect Sequencer mods based on current state
         enginesRef.current.forEach(engineState => {
            const engineNodes = audioNodes.get(engineState.id);
            if(!engineNodes) return;
            const routing = engineState.routing;
             if (routing.filter1Cutoff) engineNodes.sequencerModGate.connect(lfoRoutingBusses.filter1.cutoffModBus);
             if (routing.filter1Resonance) engineNodes.sequencerModGate.connect(lfoRoutingBusses.filter1.resonanceModBus);
             if (routing.filter2Cutoff) engineNodes.sequencerModGate.connect(lfoRoutingBusses.filter2.cutoffModBus);
             if (routing.filter2Resonance) engineNodes.sequencerModGate.connect(lfoRoutingBusses.filter2.resonanceModBus);
             enginesRef.current.forEach(targetEngine => {
                const bus = lfoRoutingBusses.engineModBusses.get(targetEngine.id);
                if (bus) {
                    const engineKeyPrefix = `engine${targetEngine.id.slice(-1)}`;
                    if (routing[`${engineKeyPrefix}Vol` as keyof LFORoutingState]) engineNodes.sequencerModGate.connect(bus.vol);
                    if (routing[`${engineKeyPrefix}SynthFreq` as keyof LFORoutingState]) engineNodes.sequencerModGate.connect(bus.synthFreq);
                    if (routing[`${engineKeyPrefix}SamplerTranspose` as keyof LFORoutingState]) engineNodes.sequencerModGate.connect(bus.samplerTranspose);
                }
            });
         });
         
        // Set modulation scaling
        const now = audioContext.currentTime;
        lfoRoutingBusses.filter1.cutoffModBus.gain.setTargetAtTime(10000, now, 0.01); // Mod range in Hz
        lfoRoutingBusses.filter1.resonanceModBus.gain.setTargetAtTime(15, now, 0.01); // Mod range for Q
        lfoRoutingBusses.filter2.cutoffModBus.gain.setTargetAtTime(10000, now, 0.01);
        lfoRoutingBusses.filter2.resonanceModBus.gain.setTargetAtTime(15, now, 0.01);
        enginesRef.current.forEach(engine => {
            const bus = lfoRoutingBusses.engineModBusses.get(engine.id);
            if (bus) {
                bus.vol.gain.setTargetAtTime(1.0, now, 0.01); // Full gain range
                bus.synthFreq.gain.setTargetAtTime(1200, now, 0.01); // 12 semitones in cents
                bus.samplerTranspose.gain.setTargetAtTime(2400, now, 0.01); // 24 semitones in cents for sampler/grain
                bus.grainSize.gain.setTargetAtTime(0.49, now, 0.01); // a range of ~0.5s
                bus.grainDensity.gain.setTargetAtTime(99, now, 0.01); // a range of ~100/s
                bus.grainPosition.gain.setTargetAtTime(1.0, now, 0.01); // full sample length
                bus.grainJitter.gain.setTargetAtTime(1.0, now, 0.01); // full jitter
            }
        });

    }, [lfos, enginesRef, lfoNodes, lfoRoutingBusses, audioNodes, audioContext]);

     // Handle Live Audio Input
    useEffect(() => {
        if (!audioContext) return;
        enginesRef.current.forEach(engine => {
            const engineNodes = audioNodes.get(engine.id);
            if (!engineNodes) return;
            
            const liveSource = engineNodes.sampler.liveInputSource;

            if (engine.sampler.liveInputEnabled && !liveSource && audioInputStream) {
                const source = audioContext.createMediaStreamSource(audioInputStream);
                source.connect(engineNodes.sampler.volumeGain);
                engineNodes.sampler.liveInputSource = source;
            } else if (!engine.sampler.liveInputEnabled && liveSource) {
                liveSource.disconnect();
                engineNodes.sampler.liveInputSource = undefined;
            }
        });
    }, [enginesRef, audioContext, audioInputStream, audioNodes]);

    // --- Master Effects Chain Rebuilding ---
    const masterEffectsChainStartRef = useRef<AudioNode | null>(null);

    useEffect(() => {
        if (!audioContext || !filterNodes || !masterVolumeNode) return;
        
        // 1. Disconnect everything from the master volume to rebuild the chain
        filterNodes.filter1.node.disconnect();
        filterNodes.filter2.node.disconnect();

        // 2. Route engine outputs to the start of the filter/effect chain
        let filterChainInput: AudioNode;
        let parallelOutput: GainNode | null = null;
        if (filterRouting === 'series') {
            filterChainInput = filterNodes.filter1.node;
            filterNodes.filter1.node.connect(filterNodes.filter2.node);
            masterEffectsChainStartRef.current = filterNodes.filter2.node;
        } else { // Parallel
            filterChainInput = audioContext.createGain();
            parallelOutput = audioContext.createGain();
            (filterChainInput as GainNode).connect(filterNodes.filter1.node);
            (filterChainInput as GainNode).connect(filterNodes.filter2.node);
            filterNodes.filter1.node.connect(parallelOutput);
            filterNodes.filter2.node.connect(parallelOutput);
            masterEffectsChainStartRef.current = parallelOutput;
        }
        audioNodes.forEach(node => {
            node.finalOutput.disconnect(); // Disconnect from old path
            node.finalOutput.connect(filterChainInput);
        });

        let lastNode: AudioNode = masterEffectsChainStartRef.current;

        // 3. Clear old effect nodes
        effectNodes.forEach(nodes => {
            Object.values(nodes).forEach((node: any) => {
                if (node instanceof AudioNode) node.disconnect();
                if (node instanceof OscillatorNode) node.stop();
            });
        });
        effectNodes.clear();
        
        // 4. Build the new chain
        masterEffects.forEach(effect => {
            if (!effect.enabled) return;
            const p = effect.params;
            let effectNode: any = {};

            switch (effect.type) {
                case 'distortion':
                     effectNode.input = audioContext.createWaveShaper();
                     // Create curve...
                     effectNode.output = effectNode.input;
                     break;
                case 'delay':
                     effectNode.input = audioContext.createGain();
                     effectNode.delay = audioContext.createDelay(2.0);
                     effectNode.feedback = audioContext.createGain();
                     effectNode.wet = audioContext.createGain();
                     effectNode.dry = audioContext.createGain();
                     effectNode.output = audioContext.createGain();
                     
                     effectNode.input.connect(effectNode.dry);
                     effectNode.input.connect(effectNode.delay);
                     effectNode.delay.connect(effectNode.feedback);
                     effectNode.feedback.connect(effectNode.delay);
                     effectNode.delay.connect(effectNode.wet);
                     effectNode.dry.connect(effectNode.output);
                     effectNode.wet.connect(effectNode.output);
                     break;
                case 'reverb':
                     effectNode.input = audioContext.createGain();
                     effectNode.convolver = audioContext.createConvolver();
                     effectNode.wet = audioContext.createGain();
                     effectNode.dry = audioContext.createGain();
                     effectNode.output = audioContext.createGain();
                     
                     effectNode.input.connect(effectNode.dry);
                     effectNode.input.connect(effectNode.convolver);
                     effectNode.convolver.connect(effectNode.wet);
                     
                     effectNode.dry.connect(effectNode.output);
                     effectNode.wet.connect(effectNode.output);
                     break;
                 case 'chorus':
                 case 'flanger':
                    effectNode.input = audioContext.createGain();
                    effectNode.output = audioContext.createGain();
                    effectNode.dry = audioContext.createGain();
                    effectNode.wet = audioContext.createGain();
                    effectNode.delay = audioContext.createDelay(1.0);
                    effectNode.lfo = audioContext.createOscillator();
                    effectNode.lfoGain = audioContext.createGain();
                    effectNode.feedback = audioContext.createGain();
                    
                    effectNode.input.connect(effectNode.dry);
                    effectNode.input.connect(effectNode.delay);
                    effectNode.lfo.connect(effectNode.lfoGain);
                    effectNode.lfoGain.connect(effectNode.delay.delayTime);
                    
                    if (effect.type === 'flanger') {
                        effectNode.delay.connect(effectNode.feedback);
                        effectNode.feedback.connect(effectNode.delay);
                    }
                    
                    effectNode.delay.connect(effectNode.wet);
                    effectNode.dry.connect(effectNode.output);
                    effectNode.wet.connect(effectNode.output);
                    effectNode.lfo.start();
                    break;
                 case 'phaser':
                    effectNode.input = audioContext.createGain();
                    effectNode.output = audioContext.createGain();
                    effectNode.dry = audioContext.createGain();
                    effectNode.wet = audioContext.createGain();
                    effectNode.stages = [];
                    const stages = p.phaser?.stages || 4;
                    for (let i = 0; i < stages; i++) {
                        const stage = audioContext.createBiquadFilter();
                        stage.type = 'allpass';
                        effectNode.stages.push(stage);
                    }
                    effectNode.lfo = audioContext.createOscillator();
                    effectNode.lfoGain = audioContext.createGain();
                    effectNode.lfo.connect(effectNode.lfoGain);
                    effectNode.stages.forEach(stage => effectNode.lfoGain.connect(stage.frequency));
                    
                    effectNode.input.connect(effectNode.dry);
                    let lastStage: AudioNode = effectNode.input;
                    effectNode.stages.forEach(stage => {
                        lastStage.connect(stage);
                        lastStage = stage;
                    });
                    lastStage.connect(effectNode.wet);
                    effectNode.dry.connect(effectNode.output);
                    effectNode.wet.connect(effectNode.output);
                    effectNode.lfo.start();
                    break;
                case 'tremolo':
                    effectNode.input = audioContext.createGain();
                    effectNode.output = audioContext.createGain();
                    effectNode.wet = audioContext.createGain();
                    effectNode.dry = audioContext.createGain();
                    effectNode.lfo = audioContext.createOscillator();
                    effectNode.depth = audioContext.createGain();

                    // Unipolar LFO
                    const shaper = audioContext.createWaveShaper();
                    shaper.curve = new Float32Array([0.5, 0.5]); // DC offset
                    const shaperGain = audioContext.createGain();
                    shaperGain.gain.value = 0.5;
                    effectNode.lfo.connect(shaperGain);
                    effectNode.lfo.connect(shaper);
                    shaper.connect(effectNode.depth);
                    shaperGain.connect(effectNode.depth);

                    effectNode.input.connect(effectNode.wet);
                    effectNode.wet.connect(effectNode.depth);
                    effectNode.input.connect(effectNode.dry);
                    effectNode.dry.connect(effectNode.output);
                    effectNode.depth.connect(effectNode.output);
                    
                    effectNode.lfo.start();
                    break;
                case 'eq':
                    effectNode.input = audioContext.createGain();
                    effectNode.bands = [];
                    let lastBand: AudioNode = effectNode.input;
                    eqFrequencies.forEach((freq, i) => {
                        const band = audioContext.createBiquadFilter();
                        band.type = 'peaking';
                        band.frequency.value = freq;
                        band.Q.value = 1.41;
                        lastBand.connect(band);
                        lastBand = band;
                        effectNode.bands.push(band);
                    });
                    effectNode.output = lastBand;
                    break;
            }

            if(effectNode.input && effectNode.output) {
                lastNode.connect(effectNode.input);
                lastNode = effectNode.output;
                effectNodes.set(effect.id, effectNode);
            }
        });

        // 5. Connect the end of the chain to the master output
        lastNode.connect(masterVolumeNode);

    }, [masterEffects, audioContext, filterNodes, masterVolumeNode, filterRouting, effectNodes]);

     // Update master effect parameters
    useEffect(() => {
        if (!audioContext) return;
        const now = audioContext.currentTime;
        masterEffects.forEach(effect => {
            const nodes = effectNodes.get(effect.id);
            if (!nodes || !effect.enabled) return;
            const p = effect.params;
            
            switch (effect.type) {
                case 'distortion':
                    if (p.distortion && nodes.input) {
                        (nodes.input as WaveShaperNode).curve = makeDistortionCurve(p.distortion.amount, p.distortion.mode);
                    }
                    break;
                case 'delay':
                    if (p.delay && nodes.delay) {
                        nodes.delay.delayTime.setTargetAtTime(p.delay.time, now, 0.01);
                        nodes.feedback.gain.setTargetAtTime(p.delay.feedback, now, 0.01);
                        nodes.wet.gain.setTargetAtTime(p.delay.mix, now, 0.01);
                        nodes.dry.gain.setTargetAtTime(1.0 - p.delay.mix, now, 0.01);
                    }
                    break;
                case 'reverb':
                    if (p.reverb && nodes.convolver) {
                        nodes.convolver.buffer = makeReverbImpulse(audioContext, p.reverb.decay, p.reverb.decay);
                        nodes.wet.gain.value = p.reverb.mix;
                        nodes.dry.gain.value = 1 - p.reverb.mix;
                    }
                    break;
                case 'chorus':
                     if (p.chorus && nodes.lfo) {
                         nodes.lfo.frequency.setTargetAtTime(p.chorus.rate, now, 0.01);
                         nodes.lfoGain.gain.setTargetAtTime(0.005 * p.chorus.depth, now, 0.01);
                         nodes.wet.gain.setTargetAtTime(p.chorus.mix, now, 0.01);
                         nodes.dry.gain.setTargetAtTime(1.0 - p.chorus.mix, now, 0.01);
                     }
                    break;
                case 'flanger':
                     if (p.flanger && nodes.lfo) {
                          nodes.lfo.frequency.setTargetAtTime(p.flanger.rate, now, 0.01);
                          nodes.lfoGain.gain.setTargetAtTime(0.002 * p.flanger.depth, now, 0.01);
                          nodes.feedback.gain.setTargetAtTime(p.flanger.feedback, now, 0.01);
                          nodes.wet.gain.setTargetAtTime(p.flanger.mix, now, 0.01);
                          nodes.dry.gain.setTargetAtTime(1.0 - p.flanger.mix, now, 0.01);
                     }
                    break;
                 case 'phaser':
                     if(p.phaser && nodes.lfo) {
                         nodes.lfo.frequency.setTargetAtTime(p.phaser.rate, now, 0.01);
                         nodes.lfoGain.gain.setTargetAtTime(1000, now, 0.01); // Center freq sweep
                         nodes.stages.forEach((stage: BiquadFilterNode) => stage.Q.setTargetAtTime(p.phaser!.q, now, 0.01));
                         nodes.wet.gain.setTargetAtTime(p.phaser.mix, now, 0.01);
                         nodes.dry.gain.setTargetAtTime(1.0 - p.phaser.mix, now, 0.01);
                     }
                     break;
                 case 'tremolo':
                     if(p.tremolo && nodes.lfo) {
                        nodes.lfo.type = p.tremolo.shape === 'ramp' ? 'sawtooth' : p.tremolo.shape;
                        nodes.lfo.frequency.setTargetAtTime(p.tremolo.rate, now, 0.01);
                        nodes.depth.gain.setTargetAtTime(p.tremolo.depth, now, 0.01);
                        // Tremolo mix is complex, better handled with gain nodes in chain
                     }
                     break;
                 case 'eq':
                     if(p.eq && nodes.bands) {
                         p.eq.bands.forEach((gain, i) => {
                             if(nodes.bands[i]) {
                                 nodes.bands[i].gain.setTargetAtTime(gain, now, 0.01);
                             }
                         });
                     }
                     break;
            }
        });
    }, [masterEffects, audioContext, effectNodes]);

    // Sequencer and Audio Engine Logic
    useEffect(() => {
        if (!audioContext) return;

        const currentEngines = enginesRef.current; // Add this line

        const scheduleNotesForStep = (step: number, time: number) => {
             currentEngines.forEach((engine) => {
                const engineNodes = audioNodes.get(engine.id);
                if (!engineNodes) return;
                
                const rateDivisor = { '1/32': 1, '1/16': 2, '1/8': 4, '1/4': 8 }[engine.sequencerRate] || 2;
                if (step % rateDivisor !== 0) {
                    engineNodes.sequencerModGate.gain.setTargetAtTime(0, time, 0.005);
                    return;
                }
                
                const engineStep = Math.floor(step / rateDivisor);
                const pattern = rotatePattern(generateEuclideanPattern(engine.sequencerSteps, engine.sequencerPulses), engine.sequencerRotate);
                const currentStepInPattern = engineStep % engine.sequencerSteps;
                const isStepActive = pattern[currentStepInPattern] === 1;

                engineNodes.sequencerModGate.gain.setTargetAtTime(isStepActive ? 1 : 0, time, 0.005);
                
                if (!isStepActive || !engine.sequencerEnabled) {
                    return;
                }
                
                const secondsPerBeat = 60.0 / bpm;
                const rateDenominator = parseInt(engine.sequencerRate.split('/')[1]);
                const stepDuration = (secondsPerBeat * 4) / rateDenominator;
                const gateDuration = stepDuration * 0.9; 
                
                const adsr = engine.adsr;
                const gateOnTime = time;
                const gateOffTime = gateOnTime + gateDuration;
                const noteEndTime = gateOffTime + adsr.release + 0.5; // Extra time for release tail

                const baseNote = lastPlayedNotePerEngineRef.current.get(`${engine.id}-synth`) || 60;
                const currentScale = musicalScales[scale];
                const noteInScale = baseNote + currentScale[currentStepInPattern % currentScale.length] + transpose;

                // --- Play Synth ---
                if (engine.synth.enabled) {
                    const osc = audioContext.createOscillator();
                    osc.type = engine.synth.oscillatorType;
                    
                    let frequencyToPlay = engine.synth.frequency; // Default to engine's base frequency

                    if (engine.sequencerEnabled && engine.melodicSequence && engine.melodicSequence.length > currentStepInPattern) {
                        frequencyToPlay = engine.melodicSequence[currentStepInPattern];
                    }
                    
                    if (engine.synth.frequencyOverride) {
                        frequencyToPlay = engine.synth.frequency;
                    }
                    
                    osc.frequency.value = frequencyToPlay;
                    console.log(`Engine ${engine.id}, Step ${currentStepInPattern}: Playing frequency ${frequencyToPlay.toFixed(2)} Hz`);
                    lfoRoutingBusses!.engineModBusses.get(engine.id)!.synthFreq.connect(osc.detune);

                    const gain = audioContext.createGain();
                    const peakVolume = engine.synth.volume;
                    const sustainVolume = peakVolume * adsr.sustain;
                    
                    gain.gain.cancelScheduledValues(gateOnTime);
                    gain.gain.setValueAtTime(0, gateOnTime);
                    gain.gain.linearRampToValueAtTime(peakVolume, gateOnTime + adsr.attack);
                    gain.gain.setTargetAtTime(sustainVolume, gateOnTime + adsr.attack, adsr.decay / 4);
                    gain.gain.setValueAtTime(sustainVolume, gateOffTime);
                    gain.gain.setTargetAtTime(0, gateOffTime, adsr.release / 4);

                    osc.connect(gain);
                    gain.connect(engineNodes.sequencerGain);
                    osc.start(gateOnTime);
                    osc.stop(noteEndTime);
                }
                 // --- Play Noise ---
                if (engine.noise.enabled) {
                     const noiseSource = createNoiseNode(audioContext, engine.noise.noiseType);
                     const gain = audioContext.createGain();
                     const noiseDuration = Math.min(stepDuration, 0.2);
                     gain.gain.cancelScheduledValues(time);
                     gain.gain.setValueAtTime(0, time);
                     gain.gain.linearRampToValueAtTime(engine.noise.volume, time + 0.005);
                     gain.gain.exponentialRampToValueAtTime(0.0001, time + noiseDuration);
                     noiseSource.connect(gain);
                     gain.connect(engineNodes.sequencerGain);
                     noiseSource.start(time);
                     noiseSource.stop(time + noiseDuration + 0.01);
                }
                // --- Play Sampler ---
                const sampleBuffer = samples.get(engine.id);
                if (engine.sampler.enabled && sampleBuffer && !engine.sampler.granularModeEnabled && !engine.sampler.liveInputEnabled) {
                     const source = audioContext.createBufferSource();
                     source.buffer = sampleBuffer;
                     const basePlaybackRate = Math.pow(2, engine.sampler.transpose / 12);
                     const targetPlaybackRate = basePlaybackRate * Math.pow(2, (noteInScale - 60) / 12); // Relative to C4
                     source.playbackRate.value = targetPlaybackRate;
                     
                     const gain = audioContext.createGain();
                     const peakVolume = engine.sampler.volume;
                     const sustainVolume = peakVolume * adsr.sustain;
                     
                     gain.gain.cancelScheduledValues(gateOnTime);
                     gain.gain.setValueAtTime(0, gateOnTime);
                     gain.gain.linearRampToValueAtTime(peakVolume, gateOnTime + adsr.attack);
                     gain.gain.setTargetAtTime(sustainVolume, gateOnTime + adsr.attack, adsr.decay / 4);
                     gain.gain.setValueAtTime(sustainVolume, gateOffTime);
                     gain.gain.setTargetAtTime(0, gateOffTime, adsr.release / 4);

                     source.connect(gain);
                     gain.connect(engineNodes.sequencerGain);
                     source.start(gateOnTime);
                     source.stop(noteEndTime);
                }
            });
        };
        
        const scheduler = () => {
            const lookahead = 0.1; // seconds
            const scheduleAheadTime = 0.025; // 25ms
            const secondsPerBeat = 60.0 / bpm;
            const secondsPer32ndNote = secondsPerBeat / 8;

            while (isTransportPlaying && nextNoteTimeRef.current < audioContext.currentTime + lookahead) {
                scheduleNotesForStep(currentStepRef.current, nextNoteTimeRef.current);
                nextNoteTimeRef.current += secondsPer32ndNote;
                currentStepRef.current += 1;
            }
            if (isTransportPlaying) {
                 schedulerTimeoutIdRef.current = window.setTimeout(scheduler, scheduleAheadTime * 1000);
            }
        };
        
        const updateUI = () => {
             if (isTransportPlaying) {
                // Heuristic to keep UI step roughly in sync with audio step
                const engine1 = enginesRef.current[0];
                const rateDivisor = { '1/32': 1, '1/16': 2, '1/8': 4, '1/4': 8 }[engine1.sequencerRate] || 2;
                const engineStep = Math.floor(currentStepRef.current / rateDivisor);
                const currentStepInPattern = engineStep % engine1.sequencerSteps;

                if(currentVisualStepRef.current !== currentStepInPattern) {
                    setCurrentStep(currentStepInPattern);
                    currentVisualStepRef.current = currentStepInPattern;
                }
             }
             uiUpdateIdRef.current = requestAnimationFrame(updateUI);
        };
        

        if (isTransportPlaying) {
             if (audioContext.state === 'suspended') audioContext.resume();
             nextNoteTimeRef.current = audioContext.currentTime + 0.1;
             currentStepRef.current = 0;
             currentVisualStepRef.current = 0;
             setCurrentStep(0);
             scheduler();
             uiUpdateIdRef.current = requestAnimationFrame(updateUI);
        } else {
             if (schedulerTimeoutIdRef.current) clearTimeout(schedulerTimeoutIdRef.current);
             if (uiUpdateIdRef.current) cancelAnimationFrame(uiUpdateIdRef.current);
             setCurrentStep(0);
        }

        // Granular scheduler
        currentEngines.forEach(engine => {
            const engineNodes = audioNodes.get(engine.id);
            const sampleBuffer = samples.get(engine.id);
            if (audioContext && engineNodes && sampleBuffer && engine.sampler.granularModeEnabled) {
                
                const isGranularActive = (engine.sequencerEnabled && isTransportPlaying) || engineNodes.sampler.granularMidiNote !== undefined;

                if (!isGranularActive && engineNodes.sampler.granularSchedulerId) {
                     clearTimeout(engineNodes.sampler.granularSchedulerId);
                     engineNodes.sampler.granularSchedulerId = undefined;
                } else if (isGranularActive && !engineNodes.sampler.granularSchedulerId) {
                    
                    const playGrain = () => {
                        const now = audioContext.currentTime;
                        
                        const note = engineNodes.sampler.granularMidiNote ?? lastPlayedNotePerEngineRef.current.get(`${engine.id}-sampler`) ?? 60;
                        
                        const modBus = lfoRoutingBusses!.engineModBusses.get(engine.id)!.samplerTranspose;
                        // For simplicity, we can't easily get the live LFO value here. We will connect the modBus to detune.
                        
                        const basePlaybackRate = Math.pow(2, engine.sampler.transpose / 12);
                        const finalPlaybackRate = basePlaybackRate * Math.pow(2, (note - 60) / 12);

                        const grain = audioContext.createBufferSource();
                        grain.buffer = sampleBuffer;
                        grain.playbackRate.value = finalPlaybackRate;
                        modBus.connect(grain.detune);

                        const grainGain = audioContext.createGain();
                        const attack = engine.sampler.grainSize * 0.1;
                        const release = engine.sampler.grainSize * 0.9;
                        grainGain.gain.setValueAtTime(0, now);
                        grainGain.gain.linearRampToValueAtTime(engine.sampler.volume, now + attack);
                        grainGain.gain.linearRampToValueAtTime(0, now + attack + release);

                        grain.connect(grainGain);
                        grainGain.connect(engineNodes.midiInputGain); // Use MIDI path for granular

                        const startOffset = engine.sampler.playbackPosition + (Math.random() - 0.5) * engine.sampler.positionJitter;
                        const boundedOffset = Math.max(0, Math.min(startOffset, 1)) * sampleBuffer.duration;
                        
                        grain.start(now, boundedOffset, engine.sampler.grainSize * 2);
                        grain.onended = () => {
                            modBus.disconnect(grain.detune);
                        };
                        
                        const interval = 1000 / engine.sampler.grainDensity;
                        engineNodes.sampler.granularSchedulerId = window.setTimeout(playGrain, interval);
                    };
                    playGrain();
                }
            }
        });


        return () => {
            if (schedulerTimeoutIdRef.current) clearTimeout(schedulerTimeoutIdRef.current);
            if (uiUpdateIdRef.current) cancelAnimationFrame(uiUpdateIdRef.current);
             enginesRef.current.forEach(engine => {
                const engineNodes = audioNodes.get(engine.id);
                if (engineNodes && engineNodes.sampler.granularSchedulerId) {
                    clearTimeout(engineNodes.sampler.granularSchedulerId);
                    engineNodes.sampler.granularSchedulerId = undefined;
                }
            });
        };
    }, [isTransportPlaying, bpm, audioContext, samples, lfos, lastPlayedNotePerEngineRef, enginesRef]);

};

const root = createRoot(document.getElementById('root')!);
root.render(<App />);
