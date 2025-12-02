

import React, {
	useState,
	useRef,
	useEffect,
	useCallback,
	useMemo,
} from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { FACTORY_PRESETS } from "./factoryPresets";
import { io, Socket } from "socket.io-client";

// --- Type Definitions ---
type OscillatorType = "sine" | "square" | "sawtooth" | "triangle";
type NoiseType = "white" | "pink" | "brown";
type LFO_Shape = "sine" | "square" | "triangle" | "rampDown" | "rampUp" | "random" | "noise" | "perlin" | "custom";
type FilterType = "lowpass" | "highpass" | "bandpass" | "notch";
type RandomizeMode = "chaos" | "melodic" | "rhythmic";
type EngineLayerType = "synth" | "noise" | "sampler";
type DistortionMode = "overdrive" | "soft clip" | "hard clip" | "foldback";
type FilterRouting = "series" | "parallel";
type VoicingMode = "poly" | "mono" | "legato" | "trill";

// --- Master Effects Types ---
type MasterEffectType =
	| "distortion"
	| "delay"
	| "reverb"
	| "chorus"
	| "flanger"
	| "phaser"
	| "tremolo"
	| "eq";

interface MasterEffect {
	id: string;
	type: MasterEffectType;
	enabled: boolean;
	params: {
		distortion?: { mode: DistortionMode; amount: number }; // 0 to 1
		delay?: { time: number; feedback: number; mix: number }; // s, 0-1, 0-1
		reverb?: { decay: number; mix: number }; // s, 0-1
		chorus?: { rate: number; depth: number; mix: number }; // Hz, 0-1, 0-1
		flanger?: {
			rate: number;
			depth: number;
			delay: number;
			feedback: number;
			mix: number;
		}; // Hz, 0-1, s, 0-1, 0-1
		phaser?: { rate: number; stages: number; q: number; mix: number }; // Hz, 2-12, 0-20, 0-1
		tremolo?: { rate: number; depth: number; shape: LFO_Shape; mix: number }; // Hz, 0-1, LFO_Shape, 0-1
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
	sampleId?: string;
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

	engine1Rate: boolean;
	engine2Rate: boolean;
	engine3Rate: boolean;
	lfo1Rate: boolean;
	lfo2Rate: boolean;
	lfo3Rate: boolean;
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
	melodicSequence: number[][]; // Stores frequencies for each step (polyphonic)
	useMelodicSequence: boolean; // Toggle between sequence and fixed note
	effects: EffectState;
	routing: LFORoutingState;
	adsr: ADSRState;
	filterDestination: "filter1" | "filter2" | "direct";
	randomOctaveRange: number; // 1-4
	randomBaseOctave: number; // 1-6

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
	customShape?: number[]; // Array of values -1 to 1
	smoothing?: number; // 0 to 1

	gridSize?: number; // 0 = off, >0 = number of steps
}

// --- Parameter Lock State ---
interface LockState {
	master: { volume: boolean };
	engines: {
		[id: string]: { [key: string]: boolean | { [key: string]: boolean } };
	};
	lfos: { [id: string]: { [key: string]: boolean } };
	filter1: { [key: string]: boolean };
	filter2: { [key: string]: boolean };
	masterEffects: {
		[id: string]: { [key: string]: boolean | { [key: string]: boolean } };
	};
}

// --- Tuning System Types ---
type TuningSystem =
	| "440_ET"
	| "432_ET"
	| "just_intonation_440"
	| "just_intonation_432"
	| "pythagorean_440"
	| "pythagorean_432"
	| "solfeggio"
	| "wholesome_scale"
	| "maria_renold_I"
	| "none";

// --- New Audio Node Types ---
interface MasterEffectNodes {
    id: string;
    type: MasterEffectType;
    input: AudioNode;
    output: AudioNode;
    nodes: any; // Store internal nodes like delay, feedback, etc.
}

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
	filter1: { cutoffModBus: GainNode; resonanceModBus: GainNode };
	filter2: { cutoffModBus: GainNode; resonanceModBus: GainNode };
	engineModBusses: Map<string, EngineModBusses>;
}

interface ActiveVoice {
	noteId: string;
	engineId: string;
	sourceNodes: (OscillatorNode | AudioBufferSourceNode)[];
	envelopeGain: GainNode;
	timeoutId?: number;
    granularModeEnabled?: boolean;
    nextGrainTime?: number;
	note: number; // Added for pitch tracking
}

// --- Preset Types ---
interface Preset {
	name: string;
	timestamp: number;
	data: {
		engines: EngineState[];
		lfos: LFOState[];
		filter1: any;
		filter2: any;
		filterRouting: FilterRouting;
		masterEffects: MasterEffect[];
		bpm: number;
		scale: ScaleName;
		transpose: number;
		harmonicTuningSystem: TuningSystem;
		voicingMode: VoicingMode;
		glideTime: number;
		isGlideSynced: boolean;
		glideSyncRateIndex: number;
		isGlobalAutoRandomEnabled: boolean;
		globalAutoRandomInterval: number;
		globalAutoRandomMode: RandomizeMode;
		isAutoRandomSynced: boolean;
		autoRandomSyncRateIndex: number;
		morphTime: number;
		isMorphSynced: boolean;
		morphSyncRateIndex: number;
	};
}

// --- Component Props ---
interface VisualizerProps {
	analyserNode: AnalyserNode;
	type: "waveform" | "frequency";
}

interface CircularVisualizerSequencerProps {
	analyserNode: AnalyserNode;
	steps: number;
	pulses: number;
	rotate: number;
	currentStep: number;
	isTransportPlaying: boolean;
	sequence?: number[];
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
	analyserNode?: AnalyserNode;
	currentStep: number;
	isTransportPlaying: boolean;
	audioContext: AudioContext | null;
	lockState: LockState;
	onToggleLock: (path: string) => void;
	harmonicTuningSystem: TuningSystem;
	scaleFrequencies: { value: number; label: string }[];
	onSnapToScale: (engineId: string) => void;
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
	onUpdate: (id: string, params: MasterEffect["params"]) => void;
	onRemove: (id: string) => void;
	onToggle: (id: string) => void;
	onRandomize: (mode: RandomizeMode, scope: string) => void;
	onInitialize: (scope: string) => void;
	onDragStart: (
		e: React.DragEvent<HTMLDivElement>,
		effect: MasterEffect
	) => void;
	onDragOver: (
		e: React.DragEvent<HTMLDivElement>,
		effect: MasterEffect
	) => void;
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
	onEditLfo: (lfoId: string) => void;
}

// --- Utils ---
const createPeriodicWaveFromTable = (context: AudioContext, table: number[]): PeriodicWave => {
	const n = table.length;
	const real = new Float32Array(n);
	const imag = new Float32Array(n);

	// DFT
	for (let k = 0; k < n; k++) {
		let sumReal = 0;
		let sumImag = 0;
		for (let t = 0; t < n; t++) {
			const angle = (2 * Math.PI * k * t) / n;
			sumReal += table[t] * Math.cos(angle);
			sumImag += table[t] * Math.sin(angle);
		}
		real[k] = sumReal / n;
		imag[k] = sumImag / n; 
	}
	
	return context.createPeriodicWave(real, imag, { disableNormalization: false });
};

// --- Deterministic Noise Utils ---
const PERM = new Uint8Array([151,160,137,91,90,15,
131,13,201,95,96,53,194,233,7,225,140,36,103,30,69,142,8,99,37,240,21,10,23,
190, 6,148,247,120,234,75,0,26,197,62,94,252,219,203,117,35,11,32,57,177,33,
88,237,149,56,87,174,20,125,136,171,168, 68,175,74,165,71,134,139,48,27,166,
77,146,158,231,83,111,229,122,60,211,133,230,220,105,92,41,55,46,245,40,244,
102,143,54, 65,25,63,161, 1,216,80,73,209,76,132,187,208, 89,18,169,200,196,
135,130,116,188,159,86,164,100,109,198,173,186, 3,64,52,217,226,250,124,123,
5,202,38,147,118,126,255,82,85,212,207,206,59,227,47,16,58,17,182,189,28,42,
223,183,170,213,119,248,152, 2,44,154,163, 70,221,153,101,155,167, 43,172,9,
129,22,39,253, 19,98,108,110,79,113,224,232,178,185,112,104,218,246,97,228,
251,34,242,193,238,210,144,12,191,179,162,241, 81,51,145,235,249,14,239,107,
49,192,214, 31,181,199,106,157,184, 84,204,176,115,121,50,45,127, 4,150,254,
138,236,205,93,222,114,67,29,24,72,243,141,128,195,78,66,215,61,156,180]);

function grad(hash: number, x: number) {
    const h = hash & 15;
    let grad = 1 + (h & 7); // Gradient value 1-8
    if ((h & 8) !== 0) grad = -grad; // Randomly invert
    return (grad * x); // Multiply by distance
}

// 1D Perlin Noise with wrapping
// x: position
// period: period for wrapping (e.g. 1.0)
function noise1D(x: number, period: number = 1) {
    // Scale x to period
    const X = Math.floor(x) % 256;
    const xf = x - Math.floor(x);
    
    // Wrap indices
    // We want the noise to loop every 'period' units of input?
    // Actually, usually we pass x in [0, period].
    // Let's assume input x is 0..1 for one cycle.
    // We map 0..1 to 0..N (e.g. 4 or 8 bumps).
    const freq = 4; // 4 bumps per cycle
    const scaledX = x * freq;
    
    const x0 = Math.floor(scaledX);
    const x1 = x0 + 1;
    const dx = scaledX - x0;
    
    // Wrap indices for seamless loop
    const i0 = x0 % freq;
    const i1 = x1 % freq;
    
    // Hash
    // We need a stable permutation. 
    // Extend PERM to 512? Or just use % 256.
    const n0 = grad(PERM[i0 % 256], dx);
    const n1 = grad(PERM[i1 % 256], dx - 1);
    
    const u = dx * dx * (3 - 2 * dx);
    return (n0 + u * (n1 - n0)); // Range roughly -1 to 1
}

// Pseudo-random (stepped)
function random1D(x: number) {
    const step = Math.floor(x * 8); // 8 steps per cycle
    // Deterministic random based on step
    const val = Math.sin(step * 12.9898) * 43758.5453;
    return (val - Math.floor(val)) * 2 - 1; // -1 to 1
}

// Smooth Noise (Linear interp of random)
function smoothNoise1D(x: number) {
    const freq = 8;
    const scaledX = x * freq;
    const i0 = Math.floor(scaledX);
    const i1 = i0 + 1;
    const dx = scaledX - i0;
    
    // Wrap
    const idx0 = i0 % freq;
    const idx1 = i1 % freq;
    
    // Random vals
    const r0 = (Math.sin(idx0 * 12.9898) * 43758.5453) % 1;
    const r1 = (Math.sin(idx1 * 12.9898) * 43758.5453) % 1;
    
    // Lerp
    return r0 + (r1 - r0) * dx; // 0 to 1?
    // Map to -1 to 1
    // (0..1) * 2 - 1
}

const safeSetTargetAtTime = (param: AudioParam, value: number, startTime: number, timeConstant: number) => {
	if (isFinite(value)) {
		try {
			param.setTargetAtTime(value, startTime, timeConstant);
		} catch (e) {
			console.warn("Error setting target at time:", e);
		}
	}
};

// --- Constants ---
const solfeggioFrequenciesData = [
	{ value: 174, label: "174 Hz - Foundation" },
	{ value: 285, label: "285 Hz - Restoration" },
	{ value: 396, label: "396 Hz - Liberation" },
	{ value: 417, label: "417 Hz - Transformation" },
	{ value: 528, label: "528 Hz - Miracle" },
	{ value: 639, label: "639 Hz - Connection" },
	{ value: 741, label: "741 Hz - Intuition" },
	{ value: 852, label: "852 Hz - Awakening" },
	{ value: 963, label: "963 Hz - Oneness" },
].sort((a, b) => a.value - b.value); // Ensure sorted for correct display
const solfeggioFrequencies = solfeggioFrequenciesData.map((f) => f.value);
const wholesomeScaleFrequencies = [192, 216, 240, 256, 288, 320, 360]; // G Major Diatonic with integer frequencies
const mariaRenoldFrequencies = [
	256, 271.53, 288, 305.47, 324, 341.33, 362.04, 384, 407.29, 432, 458.21, 486,
];

const musicalScales = {
	major: [0, 2, 4, 5, 7, 9, 11],
	minor: [0, 2, 3, 5, 7, 8, 10],
	dorian: [0, 2, 3, 5, 7, 9, 10],
	phrygian: [0, 1, 3, 5, 7, 8, 10],
	lydian: [0, 2, 4, 6, 7, 9, 11],
	mixolydian: [0, 2, 4, 5, 7, 9, 10],
	pentatonicMajor: [0, 2, 4, 7, 9],
	pentatonicMinor: [0, 3, 5, 7, 10],
	blues: [0, 3, 5, 6, 7, 10],
	harmonicMinor: [0, 2, 3, 5, 7, 8, 11],
	phrygianDominant: [0, 1, 4, 5, 7, 8, 10],
	inSen: [0, 1, 5, 7, 8],
	prometheus: [0, 2, 4, 6, 9, 10],
	wholeTone: [0, 2, 4, 6, 8, 10],
	chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
};
type ScaleName = keyof typeof musicalScales;

const justIntonationRatios = [1 / 1, 9 / 8, 5 / 4, 4 / 3, 3 / 2, 5 / 3, 15 / 8];
const pythagoreanRatios = [
	1 / 1,
	9 / 8,
	81 / 64,
	4 / 3,
	3 / 2,
	27 / 16,
	243 / 128,
];

const oscillatorTypes: readonly OscillatorType[] = [
	"sine",
	"square",
	"sawtooth",
	"triangle",
];
const lfoShapes: readonly LFO_Shape[] = [
	"sine",
	"square",
	"triangle",
	"rampDown",
	"rampUp",
	"random",
	"noise",
	"perlin",
	"custom",
];
const filterTypes: readonly FilterType[] = [
	"lowpass",
	"highpass",
	"bandpass",
	"notch",
];
const lfoSyncRates = ["1/32", "1/24", "1/16", "1/12", "1/8", "1/8d", "1/6", "1/4", "1/4d", "1/3", "1/2", "1", "2/1", "4/1", "8/1"];
const sequencerRates = ["1/32", "1/16", "1/8", "1/4"];
const delaySyncRates = ["1/16", "1/8", "1/8d", "1/4", "1/4d", "1/2"];
const noiseTypes: readonly NoiseType[] = ["white", "pink", "brown"];
const distortionModes: readonly DistortionMode[] = [
	"overdrive",
	"soft clip",
	"hard clip",
	"foldback",
];
const availableMasterEffects: MasterEffectType[] = [
	"distortion",
	"delay",
	"reverb",
	"chorus",
	"flanger",
	"phaser",
	"tremolo",
	"eq",
];
const eqFrequencies = [60, 150, 400, 1000, 2400, 6000, 10000, 15000];

// --- Default State & Hydration ---
const DEFAULT_LFO_ROUTING_STATE: LFORoutingState = {
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
	engine1Rate: false,
	engine2Rate: false,
	engine3Rate: false,
	lfo1Rate: false,
	lfo2Rate: false,
	lfo3Rate: false,
};

const getInitialState = () => {
	const engines = [
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
				oscillatorType: "sawtooth" as OscillatorType,
				solfeggioFrequency: "528",
			},
			noise: { enabled: false, volume: 0.2, noiseType: "white" as NoiseType },
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
			routing: { ...DEFAULT_LFO_ROUTING_STATE },
			adsr: { attack: 0.01, decay: 0.2, sustain: 0.8, release: 0.5 },
			melodicSequence: Array.from({ length: 16 }, () => []), // Initialize with empty arrays for polyphony
			useMelodicSequence: false,
			sequence: new Array(16).fill(0),
			filterDestination: "filter1" as "filter1" | "filter2" | "direct",
			randomOctaveRange: 2,
			randomBaseOctave: 3,

		},
		{
			id: "engine2",
			name: "E2",
			sequencerSteps: 12,
			sequencerPulses: 3,
			sequencerRotate: 0,
			sequencerRate: "1/16",
			sequencerEnabled: true,
			midiControlled: true,
			synth: {
				enabled: false,
				volume: 0.7,
				frequency: 440,
				oscillatorType: "sawtooth" as OscillatorType,
				solfeggioFrequency: "417",
			},
			noise: { enabled: false, volume: 0.2, noiseType: "pink" as NoiseType },
			sampler: {
				enabled: true,
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
			effects: { distortion: 0, delayTime: 0.25, delayFeedback: 0.4 },
			routing: { ...DEFAULT_LFO_ROUTING_STATE },
			adsr: { attack: 0.02, decay: 0.3, sustain: 0.7, release: 0.8 },
			sequence: new Array(12).fill(0), // Initialize sequence for engine2
			melodicSequence: Array.from({ length: 12 }, () => []), // Initialize with empty arrays for polyphony
			useMelodicSequence: false,
			filterDestination: "filter1" as "filter1" | "filter2" | "direct",
			randomOctaveRange: 2,
			randomBaseOctave: 3,

		},
		{
			id: "engine3",
			name: "E3",
			sequencerSteps: 7,
			sequencerPulses: 2,
			sequencerRotate: 0,
			sequencerRate: "1/16",
			sequencerEnabled: true,
			midiControlled: true,
			synth: {
				enabled: false,
				volume: 0.7,
				frequency: 110,
				oscillatorType: "sawtooth" as OscillatorType,
				solfeggioFrequency: "396",
			},
			noise: { enabled: false, volume: 0.2, noiseType: "brown" as NoiseType },
			sampler: {
				enabled: true,
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
			effects: { distortion: 0, delayTime: 0.75, delayFeedback: 0.2 },
			routing: { ...DEFAULT_LFO_ROUTING_STATE },
			adsr: { attack: 0.1, decay: 0.1, sustain: 0.9, release: 0.3 },
			melodicSequence: Array.from({ length: 7 }, () => []), // Initialize with empty arrays for polyphony
			useMelodicSequence: false,
			filterDestination: "filter2" as "filter1" | "filter2" | "direct",
			randomOctaveRange: 2,
			randomBaseOctave: 3,

		}
	];

	const enginesWithSequences = engines.map((engine) => {
		const pattern = generateEuclideanPattern(
			engine.sequencerSteps,
			engine.sequencerPulses
		);
		const sequence = rotatePattern(pattern, engine.sequencerRotate);
		return { ...engine, sequence };
	});

	return {
		engines: enginesWithSequences,
		lfos: [
			{
				id: "lfo1",
				name: "LFO 1",
				rate: 5,
				depth: 0.5,
				shape: "sine" as LFO_Shape,
				sync: false,
				syncRate: "1/4",
				routing: { ...DEFAULT_LFO_ROUTING_STATE },
				smoothing: 0,

				gridSize: 16,
			},
			{
				id: "lfo2",
				name: "LFO 2",
				rate: 2,
				depth: 0.6,
				shape: "square" as LFO_Shape,
				sync: false,
				syncRate: "1/8",
				routing: { ...DEFAULT_LFO_ROUTING_STATE },
				smoothing: 0,

				gridSize: 16,
			},
			{
				id: "lfo3",
				name: "LFO 3",
				rate: 0.3,
				depth: 0.7,
				shape: "sawtooth" as LFO_Shape,
				sync: true,
				syncRate: "1/16",
				routing: { ...DEFAULT_LFO_ROUTING_STATE },
				smoothing: 0,

				gridSize: 16,

			},
		],
		filter1: {
			enabled: false,
			cutoff: 20000,
			resonance: 0,
			type: "lowpass" as FilterType,
		},
		filter2: {
			enabled: false,
			cutoff: 20,
			resonance: 0,
			type: "highpass" as FilterType,
		},
		filterRouting: "series" as FilterRouting,
		masterEffects: [] as MasterEffect[],
	};
};

const getInitialLockState = (): LockState => {
	const initialState = getInitialState();
	return {
		master: { volume: true },
		engines: Object.fromEntries(
			initialState.engines.map((e) => [
				e.id,
				{
					sequencerSteps: false,
					sequencerPulses: false,
					sequencerRotate: false,
					sequencerRate: false,
					synth: {
						enabled: false,
						volume: true,
						oscillatorType: false,
						solfeggioFrequency: false,
						frequency: false,
					},
					noise: {
						enabled: false,
						volume: true,
						noiseType: false,
					},
					sampler: {
						enabled: false,
						volume: true,
						transpose: false,
						granularModeEnabled: false,
						grainSize: false,
						grainDensity: false,
						playbackPosition: false,
						positionJitter: false,
						liveInputEnabled: false,
					},
					adsr: { attack: true, decay: true, sustain: true, release: true },
					effects: { distortion: false, delayTime: false, delayFeedback: false },
				},
			])
		),
		lfos: Object.fromEntries(
			initialState.lfos.map((l) => [
				l.id,
				{
					rate: false,
					depth: false,
					shape: false,
					sync: false,
					syncRate: false,
				},
			])
		),
		filter1: { enabled: false, cutoff: false, resonance: false, type: false },
		filter2: { enabled: false, cutoff: false, resonance: false, type: false },
		masterEffects: Object.fromEntries(
			availableMasterEffects.map((type) => {
				const defaultParams = getDefaultEffectParams(type);
				const paramLocks: {
					[key: string]: boolean | { [key: string]: boolean };
				} = {};
				for (const paramGroup in defaultParams) {
					if (defaultParams.hasOwnProperty(paramGroup)) {
						const params =
							defaultParams[paramGroup as keyof typeof defaultParams];
						if (typeof params === "object" && params !== null) {
							paramLocks[paramGroup] = Object.keys(params).reduce(
								(acc, key) => ({ ...acc, [key]: false }),
								{}
							);
						} else {
							paramLocks[paramGroup] = false;
						}
					}
				}
				return [type, paramLocks];
			})
		),
	};
};

const getDefaultEffectParams = (
	type: MasterEffectType
): MasterEffect["params"] => {
	switch (type) {
		case "distortion":
			return { distortion: { mode: "overdrive", amount: 0.5 } };
		case "delay":
			return { delay: { time: 0.5, feedback: 0.4, mix: 0.5 } };
		case "reverb":
			return { reverb: { decay: 2, mix: 0.5 } };
		case "chorus":
			return { chorus: { rate: 1.5, depth: 0.5, mix: 0.7 } };
		case "flanger":
			return {
				flanger: {
					rate: 0.5,
					depth: 0.8,
					delay: 0.005,
					feedback: 0.5,
					mix: 0.5,
				},
			};
		case "phaser":
			return { phaser: { rate: 1.2, stages: 4, q: 10, mix: 0.7 } };
		case "tremolo":
			return { tremolo: { rate: 5, depth: 0.8, shape: "sine", mix: 1 } };
		case "eq":
			return { eq: { bands: Array(8).fill(0) } };
		default:
			return {};
	}
};

const createRandomizedEffectParams = (
	effect: MasterEffect,
	mode: RandomizeMode
): MasterEffect["params"] => {
	const { type, params: currentParams } = effect;

	// Helper to check if a param should be randomized
	const shouldRandomize = (paramType: "rhythmic" | "melodic") => {
		if (mode === "chaos") return true;
		if (mode === "rhythmic" && paramType === "rhythmic") return true;
		if (mode === "melodic" && paramType === "melodic") return true;
		return false;
	};

	switch (type) {
		case "distortion": {
			const p = currentParams.distortion!;
			if (!shouldRandomize("melodic")) return { distortion: p };
			return {
				distortion: {
					mode: getRandomElement(distortionModes),
					amount: getRandom(0, 1),
				},
			};
		}
		case "delay": {
			const p = currentParams.delay!;
			return {
				delay: {
					time: shouldRandomize("rhythmic") ? getRandom(0.01, 1.0) : p.time,
					feedback: shouldRandomize("melodic") ? getRandom(0.0, 0.8) : p.feedback, // Cap feedback to prevent self-oscillation
					mix: shouldRandomize("melodic") ? getRandom(0.0, 0.6) : p.mix,
				},
			};
		}
		case "reverb": {
			const p = currentParams.reverb!;
			if (!shouldRandomize("melodic")) return { reverb: p };
			return {
				reverb: {
					decay: getRandom(0.1, 5.0), // Cap decay
					mix: getRandom(0.0, 0.6),
				},
			};
		}
		case "chorus": {
			const p = currentParams.chorus!;
			return {
				chorus: {
					rate: shouldRandomize("rhythmic") ? getRandom(0.1, 8) : p.rate,
					depth: shouldRandomize("melodic") ? getRandom(0.1, 1) : p.depth,
					mix: shouldRandomize("melodic") ? getRandom(0.1, 1) : p.mix,
				},
			};
		}
		case "flanger": {
			const p = currentParams.flanger!;
			return {
				flanger: {
					rate: shouldRandomize("rhythmic") ? getRandom(0.1, 5) : p.rate,
					depth: shouldRandomize("melodic") ? getRandom(0.1, 1) : p.depth,
					delay: shouldRandomize("rhythmic")
						? getRandom(0.001, 0.02)
						: p.delay,
					feedback: shouldRandomize("melodic") ? getRandom(0, 0.8) : p.feedback,
					mix: shouldRandomize("melodic") ? getRandom(0.1, 1) : p.mix,
				},
			};
		}
		case "phaser": {
			const p = currentParams.phaser!;
			return {
				phaser: {
					rate: shouldRandomize("rhythmic") ? getRandom(0.1, 8) : p.rate,
					stages: shouldRandomize("melodic")
						? getRandomElement([2, 4, 6, 8, 10, 12])
						: p.stages,
					q: shouldRandomize("melodic") ? getRandom(1, 20) : p.q,
					mix: shouldRandomize("melodic") ? getRandom(0.1, 1) : p.mix,
				},
			};
		}
		case "tremolo": {
			const p = currentParams.tremolo!;
			return {
				tremolo: {
					rate: shouldRandomize("rhythmic") ? getRandom(2, 20) : p.rate,
					depth: shouldRandomize("melodic") ? getRandom(0.1, 1) : p.depth,
					shape: shouldRandomize("rhythmic")
						? getRandomElement(lfoShapes)
						: p.shape,
					mix: shouldRandomize("melodic") ? getRandom(0.1, 1) : p.mix,
				},
			};
		}
		case "eq": {
			const p = currentParams.eq!;
			if (!shouldRandomize("melodic")) return { eq: p };
			return {
				eq: {
					bands: Array(8)
						.fill(0)
						.map(() => getRandom(-12, 12)),
				},
			};
		}
		default:
			return currentParams;
	}
};

// --- Utility Functions ---
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

const getRandom = (min: number, max: number) =>
	Math.random() * (max - min) + min;
const getRandomInt = (min: number, max: number) =>
	Math.floor(Math.random() * (max - min + 1)) + min;
const getRandomBool = (probability = 0.5) => Math.random() < probability;
function getRandomElement<T>(arr: readonly T[] | T[]): T {
	return arr[Math.floor(Math.random() * arr.length)];
}

const lerp = (start: number, end: number, amt: number) => (1 - amt) * start + amt * end;


const calculateLFOValue = (lfo: LFOState, time: number, bpm: number): number => {
    let lfoFrequency = lfo.rate;
    if (lfo.sync) {
        const syncRate = lfo.syncRate;
        let noteValueInBeats = 1;
        const isDotted = syncRate.endsWith("d");
        const cleanRate = syncRate.replace("d", "");

        if (cleanRate.includes("/")) {
            const parts = cleanRate.split("/");
            const numerator = parseFloat(parts[0]);
            const denominator = parseFloat(parts[1]);
            if (denominator && !isNaN(numerator)) noteValueInBeats = (4 * numerator) / denominator;
        } else {
            const val = parseFloat(cleanRate);
            if (val) noteValueInBeats = 4 / val;
        }

        if (isDotted) {
            noteValueInBeats *= 1.5;
        }

        const durationInSeconds = noteValueInBeats * (60 / bpm);
        if (durationInSeconds > 0) {
            lfoFrequency = 1 / durationInSeconds;
        }
    }

    if (lfoFrequency === 0) return 0;

    const phase = (time * lfoFrequency) % 1.0;
    let y = 0;
    switch (lfo.shape) {
        case "sine":
            y = Math.sin(phase * 2 * Math.PI);
            break;
        case "square":
            y = phase < 0.5 ? 1 : -1;
            break;
        case "rampDown":
            y = 1 - 2 * phase; // Sawtooth down
            break;
        case "rampUp":
            y = 2 * phase - 1; // Sawtooth up (ramp)
            break;
        case "triangle":
            y = 2 * (1 - Math.abs(2 * phase - 1)) - 1;
            break;
        default:
            y = 0;
    }
    // Return value is from -1 to 1, which will be scaled by depth later.
    return y * lfo.depth;
};

function shuffleArray<T>(array: T[]): T[] {
	const newArray = [...array];
	for (let i = newArray.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[newArray[i], newArray[j]] = [newArray[j], newArray[i]];
	}
	return newArray;
}
const calculateTimeFromSync = (
	bpm: number,
	isSynced: boolean,
	syncRateIndex: number,
	syncRates: string[],
	defaultTimeMs: number
): number => {
	if (!isSynced || syncRateIndex < 0 || syncRateIndex >= syncRates.length) {
		return defaultTimeMs;
	}
	const rateStr = syncRates[syncRateIndex];
	if (!rateStr) return defaultTimeMs;

	const isDotted = rateStr.endsWith("d");
	const cleanRateStr = rateStr.replace("d", "");

	const beatDurationMs = (60 / bpm) * 1000;

	let multiplier = 1;
	// The sync rates are based on a whole note being 4 beats.
	// A "1/4" note is one beat.
	if (cleanRateStr.includes("/")) {
		const [numerator, denominator] = cleanRateStr.split("/").map(Number);
		if (!isNaN(numerator) && !isNaN(denominator) && denominator !== 0) {
			multiplier = (numerator / denominator) * 4;
		}
	} else {
		const val = parseFloat(cleanRateStr);
		if (!isNaN(val)) {
			multiplier = val * 4;
		}
	}

	let time = beatDurationMs * multiplier;
	if (isDotted) {
		time *= 1.5;
	}

	return time;
};

const getNoteFromScale = (
	rootFreq: number,
	ratios: number[],
	octaves: number
) => {
	const octave = getRandomInt(0, octaves - 1);
	const ratio = getRandomElement(ratios);
	return rootFreq * ratio * Math.pow(2, octave);
};

function makeDistortionCurve(
	amount: number,
	mode: DistortionMode,
	n_samples = 44100
) {
	const k = amount * 100;
	const deg = Math.PI / 180;
	const curve = new Float32Array(n_samples);
	let x;
	for (let i = 0; i < n_samples; ++i) {
		x = (i * 2) / n_samples - 1;
		switch (mode) {
			case "overdrive":
				curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
				break;
			case "soft clip":
				curve[i] = Math.tanh(x * (k / 10 + 1));
				break;
			case "hard clip":
				curve[i] = Math.max(-1, Math.min(1, x * (k / 10 + 1)));
				break;
			case "foldback":
				curve[i] = Math.abs(x) > 0.5 ? Math.sin(x * Math.PI * (k / 20 + 1)) : x;
				break;
		}
	}
	return curve;
}

function makeReverbImpulse(
	audioContext: AudioContext,
	duration: number,
	decay: number
) {
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
		case "440_ET":
			return 440 * Math.pow(2, (note - 69) / 12);
		case "432_ET":
			return 432 * Math.pow(2, (note - 69) / 12);

		case "just_intonation_440":
		case "just_intonation_432":
		case "pythagorean_440":
		case "pythagorean_432": {
			const rootA = tuning.endsWith("432") ? 432 : 440;
			const ratios = tuning.startsWith("just")
				? justIntonationRatios
				: pythagoreanRatios;
			const c4RootFreq = rootA / ratios[5]; // A4 is the 6th degree of C maj (5/3 or 27/16)

			const octave = Math.floor(note / 12) - 5; // Octave relative to C4 (MIDI note 60)
			const semi = note % 12;

			const cMajorScaleSteps = [0, 2, 4, 5, 7, 9, 11];
			let scaleDegreeIndex = -1;
			let currentSemi = semi;
			while (scaleDegreeIndex === -1 && currentSemi >= 0) {
				scaleDegreeIndex = cMajorScaleSteps.indexOf(currentSemi);
				if (scaleDegreeIndex === -1) currentSemi--;
			}
			if (scaleDegreeIndex === -1) scaleDegreeIndex = 0; // fallback

			const ratio = ratios[scaleDegreeIndex];
			return c4RootFreq * ratio * Math.pow(2, octave);
		}

		case "solfeggio": {
			const octave = Math.floor(note / 12) - 5;
			const semi = note % 12;
			const solfeggioBase = [396, 417, 528, 639, 741, 852, 963, 174, 285];
			const noteIndex = Math.floor((semi / 12) * solfeggioBase.length);
			return solfeggioBase[noteIndex] * Math.pow(2, octave);
		}
		case "wholesome_scale": {
			// G Major
			const gMajorScaleSteps = [0, 2, 4, 5, 7, 9, 11]; // relative to G
			const noteInG = note - 67; // MIDI G4
			const octave = Math.floor(noteInG / 12);
			const semi = ((noteInG % 12) + 12) % 12;

			let scaleDegreeIndex = -1;
			let currentSemi = semi;
			while (scaleDegreeIndex === -1 && currentSemi >= 0) {
				scaleDegreeIndex = gMajorScaleSteps.indexOf(currentSemi);
				if (scaleDegreeIndex === -1) currentSemi--;
			}
			if (scaleDegreeIndex === -1) scaleDegreeIndex = 0;
			return wholesomeScaleFrequencies[scaleDegreeIndex] * Math.pow(2, octave);
		}
		case "maria_renold_I": {
			const baseOctave = 4; // C4 is MIDI note 60
			const midiNoteC4 = 60;
			const octaveOffset = Math.floor((note - midiNoteC4) / 12);
			const semi = ((note - midiNoteC4) + 12) % 12;
			const frequency = mariaRenoldFrequencies[semi];
			return frequency * Math.pow(2, octaveOffset);
		}
		default:
			return 440 * Math.pow(2, (note - 69) / 12);
	}
};

const frequencyToMidiNote = (freq: number): number => {
    return Math.log2(freq / 440) * 12 + 69;
}

const noteNames = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const frequencyToNoteName = (freq: number): string => {
	if (freq <= 0) return "";
	const noteNum = 12 * Math.log2(freq / 440);
	const roundedNote = Math.round(noteNum) + 69;
	const octave = Math.floor(roundedNote / 12) - 1;
	const noteIndex = roundedNote % 12;
	return `${noteNames[noteIndex]}${octave}`;
};

interface MelodyEditorProps {
	engine: EngineState;
	scaleFrequencies: { value: number; label: string }[];
	onUpdateSequence: (engineId: string, newSequence: number[][]) => void;
	onUpdateRhythm: (engineId: string, newSequence: number[]) => void;
	onClose: () => void;
	currentStep: number;
}

const MelodyEditor: React.FC<MelodyEditorProps> = ({
	engine,
	scaleFrequencies,
	onUpdateSequence,
	onUpdateRhythm,
	onClose,
	currentStep,
}) => {
	const handleCellClick = (stepIndex: number, freqIndex: number) => {
		const targetFreq = scaleFrequencies[freqIndex].value;
		const currentStepFreqs = engine.melodicSequence[stepIndex] || [];
		
		// Toggle frequency
		let newStepFreqs: number[];
		if (currentStepFreqs.includes(targetFreq)) {
			newStepFreqs = currentStepFreqs.filter(f => f !== targetFreq);
		} else {
			newStepFreqs = [...currentStepFreqs, targetFreq];
		}

		const newMelody = [...engine.melodicSequence];
		newMelody[stepIndex] = newStepFreqs;
		onUpdateSequence(engine.id, newMelody);

		// Update rhythm based on whether any notes are active
		const newRhythm = [...engine.sequence];
		newRhythm[stepIndex] = newStepFreqs.length > 0 ? 1 : 0;
		onUpdateRhythm(engine.id, newRhythm);
	};

	const handleRandomize = () => {
		const newSequence = engine.melodicSequence.map(() => {
			const randomFreq =
				scaleFrequencies[Math.floor(Math.random() * scaleFrequencies.length)];
			return randomFreq ? [randomFreq.value] : [440];
		});
		onUpdateSequence(engine.id, newSequence);
	};

	const handleClear = () => {
		const newSequence = engine.melodicSequence.map(() => []);
		onUpdateSequence(engine.id, newSequence);
		// Also clear rhythm
		const newRhythm = engine.sequence.map(() => 0);
		onUpdateRhythm(engine.id, newRhythm);
	};

	// Helper to find the index of the current frequency in the scale
	const getFreqIndex = (freq: number) => {
		// Find closest match
		let closestIndex = 0;
		let minDiff = Infinity;
		scaleFrequencies.forEach((sf, index) => {
			const diff = Math.abs(sf.value - freq);
			if (diff < minDiff) {
				minDiff = diff;
				closestIndex = index;
			}
		});
		return closestIndex;
	};

	return (
		<div className="melody-editor-overlay">
			<div className="melody-editor-content">
				<div className="melody-editor-header">
					<h3>Melody Editor - {engine.id.toUpperCase()}</h3>
					<div className="melody-editor-controls">
						<button onClick={handleRandomize}>Randomize</button>
						<button onClick={handleClear}>Clear</button>
						<button onClick={onClose}>Close</button>
					</div>
				</div>
				<div className="melody-editor-body">
					<div className="melody-grid-labels">
						{scaleFrequencies
							.slice()
							.reverse()
							.map((f, i) => (
								<div key={i} className="grid-label">
									{f.label}
								</div>
							))}
					</div>
					<div className="melody-grid-container">
						<div className="piano-roll-grid">
							{scaleFrequencies
								.slice()
								.reverse()
								.map((sf, rowIndex) => {
									// Calculate actual index in scaleFrequencies (since we reversed)
									const freqIndex = scaleFrequencies.length - 1 - rowIndex;
									return (
										<div
											key={rowIndex}
											className="piano-roll-row"
										>
											{engine.melodicSequence.map((stepFreqs, stepIndex) => {
												const isActive =
													engine.sequence[stepIndex] === 1 &&
													stepFreqs.some(f => Math.abs(f - sf.value) < 0.1);
												const isCurrentStep = stepIndex === currentStep;

												return (
													<div
														key={stepIndex}
														className={`piano-roll-cell ${
															isActive ? "active" : ""
														} ${isCurrentStep ? "current" : ""}`}
														onClick={() =>
															handleCellClick(stepIndex, freqIndex)
														}
														title={`${sf.label} - Step ${stepIndex + 1}`}
													/>
												);
											})}
										</div>
									);
								})}
						</div>
					</div>
				</div>
			</div>
		</div>
	);
};

// --- Components ---

const Visualizer: React.FC<VisualizerProps> = ({ analyserNode, type }) => {
	const canvasRef = useRef<HTMLCanvasElement>(null);

	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;
		const canvasCtx = canvas.getContext("2d");
		if (!canvasCtx) return;
		let animationFrameId: number;

		const draw = () => {
			const { width, height } = canvas;

			canvasCtx.fillStyle = "#191924"; // --background-color
			canvasCtx.fillRect(0, 0, width, height);

			// Draw grid
			canvasCtx.strokeStyle = "rgba(0, 245, 212, 0.1)";
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

			if (type === "waveform") {
				analyserNode.fftSize = 2048;
				const bufferLength = analyserNode.frequencyBinCount;
				const dataArray = new Uint8Array(bufferLength);
				analyserNode.getByteTimeDomainData(dataArray);

				canvasCtx.lineWidth = 2;
				canvasCtx.strokeStyle = "#00f5d4"; // --secondary-color

				// Glow effect
				canvasCtx.shadowColor = "#00f5d4";
				canvasCtx.shadowBlur = 5;

				canvasCtx.beginPath();
				const sliceWidth = (width * 1.0) / bufferLength;
				let x = 0;

				for (let i = 0; i < bufferLength; i++) {
					const v = dataArray[i] / 128.0;
					const y = (v * height) / 2;
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

const CircularVisualizerSequencer: React.FC<
	CircularVisualizerSequencerProps
> = ({
	analyserNode,
	steps,
	pulses,
	rotate,
	currentStep,
	isTransportPlaying,
	sequence,
}) => {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const pattern = useMemo(
		() => {
			// If sequence is provided, it is already rotated by the engine state logic.
			if (sequence && sequence.length > 0) {
				return sequence;
			}
			// If no sequence provided (fallback), generate and rotate locally.
			const basePattern = generateEuclideanPattern(steps, pulses);
			return rotatePattern(basePattern, rotate);
		},
		[steps, pulses, rotate, sequence]
	);

	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;
		const ctx = canvas.getContext("2d");
		if (!ctx) return;
		let animationFrameId: number;

		const grad = ctx.createLinearGradient(0, 0, 200, 200);
		grad.addColorStop(0, "#a45ee5"); // --primary-color
		grad.addColorStop(1, "#00f5d4"); // --secondary-color

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
					ctx.fillStyle = "#00f5d4"; // Active step
					ctx.arc(x, y, 5, 0, 2 * Math.PI);
				} else {
					ctx.fillStyle = "#3a3a50"; // Inactive step
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
				ctx.fillStyle = "#fff";
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

	return (
		<canvas ref={canvasRef} width="200" height="200" className="visualizer" />
	);
};

const ChaosIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 5V2M5 12H2M19 12h3M12 22v-3M7.05 7.05l-2.12-2.12M17 17l2.12 2.12M7.05 17l-2.12 2.12M17 7.05l2.12-2.12"/>
        <path d="M16 8A5 5 0 0 0 8.5 4.5"/>
        <path d="M8 16a5 5 0 0 0 7.5 3.5"/>
    </svg>
);
const MelodicIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1">
        <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55c-2.21 0-4 1.79-4 4s1.79 4 4 4s4-1.79 4-4V7h4V3h-6z"/>
    </svg>
);
const RhythmicIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
        <rect x="6" y="4" width="2" height="16" />
        <rect x="11" y="9" width="2" height="6" />
        <rect x="16" y="6" width="2" height="12" />
    </svg>
);
const InitializeIcon = () => (
	<svg
		xmlns="http://www.w3.org/2000/svg"
		viewBox="0 0 24 24"
		fill="currentColor"
	>
		<path d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"></path>
	</svg>
);
const LockIcon = ({ isLocked, onClick, title }: { isLocked: boolean; onClick: (e: React.MouseEvent) => void; title?: string }) => (
	<button 
		className={`icon-button lock-button ${isLocked ? "locked" : ""}`} 
		onClick={(e) => { e.stopPropagation(); onClick(e); }}
		title={title}
	>
		{isLocked ? (
			<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none">
				<rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
				<path d="M7 11V7a5 5 0 0 1 10 0v4h-3V7a2 2 0 0 0-4 0v4H7z"></path>
			</svg>
		) : (
			<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none" style={{ opacity: 0.5 }}>
				<rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
				<path d="M7 11V7a5 5 0 0 1 9.9-1h-3a2 2 0 0 0-4 0v4H7z"></path>
			</svg>
		)}
	</button>
);

const UndoIcon = () => (
	<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
		<path d="M3 7v6h6" />
		<path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" />
	</svg>
);

const RedoIcon = () => (
	<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
		<path d="M21 7v6h-6" />
		<path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3L21 13" />
	</svg>
);

const AccordionIcon = ({ isExpanded }: { isExpanded: boolean }) => (
	<svg
		width="12"
		height="12"
		viewBox="0 0 12 12"
		style={{
			transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)",
			transition: "transform 0.2s",
			fill: "currentColor",
		}}
	>
		<path d="M4 2L8 6L4 10" />
	</svg>
);

const DragHandleIcon = () => (
	<div className="drag-handle">
		<svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
			<circle cx="4" cy="2" r="1" />
			<circle cx="8" cy="2" r="1" />
			<circle cx="4" cy="6" r="1" />
			<circle cx="8" cy="6" r="1" />
			<circle cx="4" cy="10" r="1" />
			<circle cx="8" cy="10" r="1" />
		</svg>
	</div>
);

// --- IndexedDB Utilities ---
const DB_NAME = "PolyRhythmSynthDB";
const STORE_NAME = "audioSamples";
const DB_VERSION = 2;

const generateId = () => {
	return Date.now().toString(36) + Math.random().toString(36).substr(2);
};

const initDB = (): Promise<IDBDatabase> => {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(DB_NAME, DB_VERSION);
		request.onerror = () => reject(request.error);
		request.onsuccess = () => resolve(request.result);
		request.onupgradeneeded = (event) => {
			const db = (event.target as IDBOpenDBRequest).result;
			if (!db.objectStoreNames.contains(STORE_NAME)) {
				db.createObjectStore(STORE_NAME);
			}
		};
	});
};

const saveSampleToDB = async (id: string, buffer: ArrayBuffer): Promise<void> => {
	const db = await initDB();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(STORE_NAME, "readwrite");
		const store = tx.objectStore(STORE_NAME);
		const request = store.put(buffer, id);
		request.onerror = () => reject(request.error);
		request.onsuccess = () => resolve();
	});
};

const getSampleFromDB = async (id: string): Promise<ArrayBuffer | undefined> => {
	const db = await initDB();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(STORE_NAME, "readonly");
		const store = tx.objectStore(STORE_NAME);
		const request = store.get(id);
		request.onerror = () => reject(request.error);
		request.onsuccess = () => resolve(request.result);
	});
};



// --- Preset Manager Component ---
interface PresetManagerProps {
	currentBpm: number;
	onLoadPreset: (preset: Preset) => Promise<void>;
	getCurrentState: () => Preset["data"];
}

const PresetManager: React.FC<PresetManagerProps> = ({ currentBpm, onLoadPreset, getCurrentState }) => {
	const [presets, setPresets] = useState<Preset[]>([]);
	const [isOpen, setIsOpen] = useState(false);
	const [newPresetName, setNewPresetName] = useState("");
	const fileInputRef = useRef<HTMLInputElement>(null);


	useEffect(() => {
		// Load presets from LocalStorage on mount
		const saved = localStorage.getItem("polyRhythmSynth_presets");
		let loadedPresets: Preset[] = [];
		if (saved) {
			try {
				loadedPresets = JSON.parse(saved);
			} catch (e) {
				console.error("Failed to load presets", e);
			}
		}

		// Merge Factory Presets
		// Force update factory presets: Remove old factory presets from loaded list and append new ones
		const factoryNames = new Set(FACTORY_PRESETS.map(p => p.name));
		const userPresets = loadedPresets.filter(p => !factoryNames.has(p.name));
		
		const updatedPresets = [...userPresets, ...FACTORY_PRESETS];
		setPresets(updatedPresets);
			// Optionally save back to local storage so they persist? 
			// Or keep them ephemeral? 
			// Usually factory presets should persist if the user edits them (as a copy), 
			// but here we are adding them to the main list.
			// Let's save them so they are there next time without re-merging logic running every time (though it's cheap).
			// Actually, if we save them, the user can delete them.
			// If we don't save them, they reappear on reload.
			// "Preloaded" usually implies they are part of the initial state.
			// Let's save them to ensure consistency.
			localStorage.setItem("polyRhythmSynth_presets", JSON.stringify(updatedPresets));

	}, []);

	const savePresetsToStorage = (newPresets: Preset[]) => {
		localStorage.setItem("polyRhythmSynth_presets", JSON.stringify(newPresets));
		setPresets(newPresets);
	};

	const handleSave = () => {
		if (!newPresetName.trim()) return;
		const newPreset: Preset = {
			name: newPresetName,
			timestamp: Date.now(),
			data: getCurrentState(),
		};
		const updated = [...presets, newPreset];
		savePresetsToStorage(updated);
		setNewPresetName("");
	};

	const handleDelete = (index: number) => {
		if (confirm("Are you sure you want to delete this preset?")) {
			const updated = presets.filter((_, i) => i !== index);
			savePresetsToStorage(updated);
		}
	};

	const handleLoad = async (preset: Preset) => {
		if (confirm("Load preset? Unsaved changes will be lost.")) {
			await onLoadPreset(preset);
			setIsOpen(false);
		}
	};

	const handleExport = (preset: Preset) => {
		const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(preset));
		const downloadAnchorNode = document.createElement('a');
		downloadAnchorNode.setAttribute("href", dataStr);
		downloadAnchorNode.setAttribute("download", `${preset.name.replace(/\s+/g, '_')}_preset.json`);
		document.body.appendChild(downloadAnchorNode); // required for firefox
		downloadAnchorNode.click();
		downloadAnchorNode.remove();
	};

	const handleImportClick = () => {
		fileInputRef.current?.click();
	};

	const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0];
		if (!file) return;

		const reader = new FileReader();
		reader.onload = (event) => {
			try {
				const importedPreset = JSON.parse(event.target?.result as string) as Preset;
				if (importedPreset.data && importedPreset.name) {
					// Add to presets list
					const updated = [...presets, importedPreset];
					savePresetsToStorage(updated);
					// Optionally load immediately? No, just add to list.
					alert(`Imported "${importedPreset.name}" successfully!`);
				} else {
					alert("Invalid preset file format.");
				}
			} catch (err) {
				console.error("Import error", err);
				alert("Failed to import preset.");
			}
		};
		reader.readAsText(file);
		e.target.value = ""; // Reset input
	};

	return (
		<div className="preset-manager">
			<button className="preset-toggle-btn" onClick={() => setIsOpen(!isOpen)}>
				{isOpen ? "Close Presets" : "Presets"}
			</button>

			{isOpen && (
				<div className="preset-modal">
					<div className="preset-header">
						<h3>Preset Manager</h3>
						<button className="close-btn" onClick={() => setIsOpen(false)}>×</button>
					</div>
					
					<div className="preset-save-section">
						<input 
							type="text" 
							placeholder="New Preset Name" 
							value={newPresetName}
							onChange={(e) => setNewPresetName(e.target.value)}
						/>
						<button onClick={handleSave} disabled={!newPresetName.trim()}>Save Current</button>
						<button onClick={handleImportClick} className="import-btn">Import JSON</button>
						<input 
							type="file" 
							ref={fileInputRef} 
							style={{ display: 'none' }} 
							accept=".json" 
							onChange={handleFileChange}
						/>
					</div>

					<div className="preset-list">
						{presets.length === 0 ? (
							<div className="no-presets">No saved presets</div>
						) : (
							presets.map((p, i) => (
								<div key={i} className="preset-item">
									<div className="preset-info">
										<span className="preset-name">{p.name}</span>
										<span className="preset-date">{new Date(p.timestamp).toLocaleDateString()}</span>
									</div>
									<div className="preset-actions">
										<button onClick={() => handleLoad(p)} title="Load">📂</button>
										<button onClick={() => handleExport(p)} title="Export">⬇️</button>
										<button onClick={() => handleDelete(i)} title="Delete" className="delete-btn">🗑️</button>
									</div>
								</div>
							))
						)}
					</div>
				</div>
			)}
		</div>
	);
};

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
	selectedMidiClockInputId: string | null;
	onMidiClockInputChange: (id: string) => void;
	midiActivity: boolean;
	midiClockActivity: boolean;
	lockState: LockState;
	onToggleLock: (path: string) => void;
	clockSource: "internal" | "midi" | "link";
	onClockSourceChange: (source: "internal" | "midi" | "link") => void;
	linkPhase?: number;
	children?: React.ReactNode;
	harmonicTuningSystem: TuningSystem;
	setHarmonicTuningSystem: (system: TuningSystem) => void;
	scale: ScaleName;
	setScale: (scale: ScaleName) => void;
	transpose: number;
	setTranspose: (transpose: number) => void;
	voicingMode: VoicingMode;
	setVoicingMode: (mode: VoicingMode) => void;
	glideTime: number;
	setGlideTime: (time: number) => void;
	isGlideSynced: boolean;
	setIsGlideSynced: (synced: boolean) => void;
	glideSyncRateIndex: number;
	setGlideSyncRateIndex: (index: number) => void;
	glideSyncRates: string[];
	onRandomize: (mode: RandomizeMode, scope: string) => void;
	onInitializeAll: () => void;
	linkLatency: number;
	setLinkLatency: (latency: number) => void;
	onUndo: () => void;
	onRedo: () => void;
}

const TopBar: React.FC<TopBarProps> = ({
	masterVolume,
	setMasterVolume,
	bpm,
	setBPM,
	isTransportPlaying,
	onToggleTransport,
	onPanic,
	midiInputs,
	selectedMidiInputId,
	onMidiInputChange,
	selectedMidiClockInputId,
	onMidiClockInputChange,
	midiActivity,
	midiClockActivity,
	lockState,
	onToggleLock,
	clockSource,
	onClockSourceChange,
	linkPhase,
	children,
	harmonicTuningSystem,
	setHarmonicTuningSystem,
	scale,
	setScale,
	transpose,
	setTranspose,
	voicingMode,
	setVoicingMode,
	glideTime,
	setGlideTime,
	isGlideSynced,
	setIsGlideSynced,
	glideSyncRateIndex,
	setGlideSyncRateIndex,
	glideSyncRates,
	onRandomize,
	onInitializeAll,
	linkLatency,
	setLinkLatency,
	onUndo,
	onRedo,
}) => {
	const [localBpm, setLocalBpm] = useState(bpm);
	const [isDraggingBpm, setIsDraggingBpm] = useState(false);

	useEffect(() => {
		if (!isDraggingBpm) {
			setLocalBpm(bpm);
		}
	}, [bpm, isDraggingBpm]);

	const handleDebug = () => {
		console.log("--- DEBUG STATE ---");
		console.log("AudioContext State:", new (window.AudioContext || (window as any).webkitAudioContext)().state); // Check global context state if possible, or just log
		// We can't access audioContext directly here as it's not passed to TopBar.
		// But we can log what we have.
		console.log("BPM:", bpm);
		console.log("Transport:", isTransportPlaying);
		// Trigger a custom event or callback if we really need deep inspection, 
		// but for now let's just add a button that the user can click to trigger a log in App via a prop?
		// No, let's just add it to App directly or pass a debug handler.
	};

	return (
		<div className="top-bar">
			<div className="top-bar-primary-row">
				<div className="top-bar-left">


					<div className="top-bar-group midi-group">
						<div className="midi-control">
							<label>Note</label>
							<div className="midi-input-wrapper">
								<div
									className="midi-indicator"
									style={{
										backgroundColor: midiActivity ? "var(--secondary-color)" : "#333",
										flexShrink: 0,
										zIndex: 10,
									}}
									title="MIDI Note Activity"
								/>
								<select
									value={selectedMidiInputId || ""}
									onChange={(e) => onMidiInputChange(e.target.value)}
									disabled={midiInputs.length === 0}
									style={{ maxWidth: '120px' }}
								>
									<option value="">
										{midiInputs.length > 0 ? "Select Device" : "No Devices"}
									</option>
									{midiInputs.map((input) => (
										<option key={input.id} value={input.id}>
											{input.name}
										</option>
									))}
								</select>
							</div>
						</div>

						<div className="midi-control">
							<label>Clock</label>
							<div className="midi-input-wrapper">
								<div
									className="midi-indicator"
									style={{
										backgroundColor: midiClockActivity ? "var(--secondary-color)" : "#333",
										flexShrink: 0,
										zIndex: 10,
									}}
									title="MIDI Clock Activity"
								/>
								<select
									value={selectedMidiClockInputId || ""}
									onChange={(e) => onMidiClockInputChange(e.target.value)}
									disabled={midiInputs.length === 0}
									style={{ maxWidth: '120px' }}
								>
									<option value="">
										{midiInputs.length > 0 ? "Select Device" : "No Devices"}
									</option>
									{midiInputs.map((input) => (
										<option key={input.id} value={input.id}>
											{input.name}
										</option>
									))}
								</select>
							</div>
						</div>
					</div>

					<div className="top-bar-group clock-source-group">
						<div className="control-item">
							<label>Clock</label>
							{clockSource === "link" ? (
								<div className="control-value-wrapper" style={{ width: '80px', justifyContent: 'center' }}>
									<div 
										style={{ 
											width: '100%', 
											height: '10px', 
											background: '#333', 
											position: 'relative',
											borderRadius: '2px',
											overflow: 'hidden'
										}}
										title="Cycle Position"
									>
										<div 
											style={{
												position: 'absolute',
												left: `${(linkPhase || 0) * 100}%`,
												top: 0,
												bottom: 0,
												width: '4px',
												background: 'var(--primary-color)',
												transform: 'translateX(-50%)'
											}}
										/>
									</div>
								</div>
							) : (
								<select
									value={clockSource}
									onChange={(e) => onClockSourceChange(e.target.value as "internal" | "midi" | "link")}
									className="clock-source-select"
								>
									<option value="internal">INT</option>
									<option value="midi">MIDI</option>
									<option value="link">LINK</option>
								</select>
							)}
							{clockSource === "link" && (
								<div className="control-value-wrapper" style={{ marginLeft: '0.5rem' }}>
									<label style={{ fontSize: '0.65rem', marginRight: '2px', color: '#888' }}>Offset</label>
									<input
										type="range"
										min="-200"
										max="200"
										value={linkLatency}
										onChange={(e) => setLinkLatency(parseInt(e.target.value))}
										style={{ width: '40px' }}
									/>
									<span style={{ fontSize: '0.65rem', minWidth: '25px', textAlign: 'right' }}>{linkLatency}ms</span>
								</div>
							)}
							{clockSource === "link" && (
								<button 
									className="small"
									onClick={() => onClockSourceChange("internal")}
									style={{ marginLeft: '0.25rem', fontSize: '0.65rem', padding: '1px 3px', height: 'auto', minWidth: 'auto' }}
								>
									Exit
								</button>
							)}
						</div>
					</div>

					<div className="top-bar-group transport-group">
						<div className="control-item">
							<label>BPM</label>
							<div className="control-value-wrapper">
								<input
									type="range"
									min="30"
									max="300"
									value={localBpm}
									onChange={(e) => {
										const newVal = parseInt(e.target.value);
										setLocalBpm(newVal);
										setBPM(newVal);
									}}
									onMouseDown={() => setIsDraggingBpm(true)}
									onMouseUp={() => setIsDraggingBpm(false)}
									onTouchStart={() => setIsDraggingBpm(true)}
									onTouchEnd={() => setIsDraggingBpm(false)}
									style={{ width: '80px' }}
								/>
								<span style={{ minWidth: '30px' }}>{bpm.toFixed(1)}</span>
							</div>
						</div>

						<button
							className={`icon-button ${isTransportPlaying ? "active" : ""}`}
							onClick={onToggleTransport}
							title={isTransportPlaying ? "Stop" : "Play"}
							style={{ width: 'auto', padding: '0.5rem 1rem' }}
						>
							{isTransportPlaying ? "Stop" : "Play"}
						</button>

						<button
							className="icon-button panic-button"
							onClick={onPanic}
							title="Panic (All Notes Off)"
							style={{ width: 'auto', padding: '0.5rem 1rem' }}
						>
							Panic
						</button>
					</div>
				</div>

				<div className="top-bar-center">
					<div className="control-item master-volume">
						<label>Master</label>
						<div className="control-with-lock">
							<input
								type="range"
								min="0"
								max="1"
								step="0.01"
								value={masterVolume}
								onChange={(e) => setMasterVolume(parseFloat(e.target.value))}
								disabled={lockState.master.volume}
								style={{ width: '80px' }}
							/>
							<LockIcon
								isLocked={lockState.master.volume}
								onClick={() => onToggleLock("master.volume")}
								title="Lock Master Volume"
							/>
						</div>
					</div>
				</div>

				<div className="top-bar-right">
					<div className="header-actions">
						<button
							className="icon-button init-button"
							onClick={(e) => { e.stopPropagation(); onInitializeAll(); }}
							title="Initialize Patch"
						>
							<InitializeIcon />
						</button>
						<button
							className="icon-button"
							onClick={(e) => { e.stopPropagation(); onRandomize("chaos", "global"); }}
							title="Global Chaos Morph"
						>
							<ChaosIcon />
						</button>
						<button
							className="icon-button"
							onClick={(e) => { e.stopPropagation(); onRandomize("melodic", "global"); }}
							title="Global Melodic Morph"
						>
							<MelodicIcon />
						</button>
						<button
							className="icon-button"
							onClick={(e) => { e.stopPropagation(); onRandomize("rhythmic", "global"); }}
							title="Global Rhythmic Morph"
						>
							<RhythmicIcon />
						</button>

					</div>
				</div>
			</div>

			<div className="top-bar-secondary-row">
				<div className="top-bar-group presets-group">
					{children}
				</div>
				<div className="top-bar-group harmonic-group">
					<div className="control-item">
						<label>Harmonic Mode</label>
						<select
							value={harmonicTuningSystem}
							onChange={(e) =>
								setHarmonicTuningSystem(e.target.value as TuningSystem)
							}
							style={{ maxWidth: '180px' }}
						>
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
				</div>

				{harmonicTuningSystem !== "solfeggio" &&
					harmonicTuningSystem !== "wholesome_scale" &&
					harmonicTuningSystem !== "none" && (
						<div className="top-bar-group scale-group">
							<div className="control-item">
								<label>Scale</label>
								<select
									value={scale}
									onChange={(e) => setScale(e.target.value as ScaleName)}
									style={{ width: '100px' }}
								>
									{Object.keys(musicalScales).map((s) => (
										<option key={s} value={s}>
											{s.charAt(0).toUpperCase() + s.slice(1).replace(/([A-Z])/g, ' $1').trim()}
										</option>
									))}
								</select>
							</div>
							<div className="control-item">
								<label>Transpose</label>
								<div className="control-value-wrapper">
									<input
										type="range"
										min="-24"
										max="24"
										step="1"
										value={transpose}
										onChange={(e) => setTranspose(parseInt(e.target.value))}
										style={{ width: '80px' }}
									/>
									<span style={{ minWidth: '30px' }}>{transpose}</span>
								</div>
							</div>
						</div>
					)}

				<div className="top-bar-group voicing-group">
					<div className="control-group-row">
						<div className="toggle-group compact">
						<button 
							className={voicingMode === 'poly' ? 'active' : ''} 
							onClick={() => setVoicingMode('poly')}
							title="Polyphonic"
						>
							Poly
						</button>
						<button 
							className={voicingMode === 'mono' ? 'active' : ''} 
							onClick={() => setVoicingMode('mono')}
							title="Monophonic (Retrigger)"
						>
							Mono
						</button>
						<button 
							className={voicingMode === 'legato' ? 'active' : ''} 
							onClick={() => setVoicingMode('legato')}
							title="Legato (No Retrigger)"
						>
							Legato
						</button>
						<button 
							className={voicingMode === 'trill' ? 'active' : ''} 
							onClick={() => setVoicingMode('trill')}
							title="Trill (Mono with History)"
						>
							Trill
						</button>
					</div>
						<div className="control-value-wrapper">
							<input
								type="range"
								min="0"
								max="2000"
								step="1"
								value={glideTime}
								onChange={(e) => setGlideTime(parseFloat(e.target.value))}
								disabled={isGlideSynced}
								style={{ width: '60px' }}
								onClick={(e) => e.stopPropagation()}
							/>
							<span>{glideTime.toFixed(0)}ms</span>
						</div>
						<div className="sync-wrapper">
							<button
								className={`small ${isGlideSynced ? "active" : ""}`}
								onClick={(e) => { e.stopPropagation(); setIsGlideSynced(!isGlideSynced); }}
							>
								Sync
							</button>
							{isGlideSynced && (
								<select
									value={glideSyncRateIndex}
									onChange={(e) => setGlideSyncRateIndex(parseInt(e.target.value))}
									className="sync-select"
									onClick={(e) => e.stopPropagation()}
								>
									{glideSyncRates.map((rate, i) => (
										<option key={i} value={i}>
											{rate}
										</option>
									))}
								</select>
							)}
						</div>
					</div>
				</div>
				<div className="top-bar-group undo-redo-group" style={{ marginLeft: 'auto' }}>
					<button
						className="icon-button"
						onClick={(e) => { e.stopPropagation(); onUndo(); }}
						title="Undo"
					>
						<UndoIcon />
					</button>
					<button
						className="icon-button"
						onClick={(e) => { e.stopPropagation(); onRedo(); }}
						title="Redo"
					>
						<RedoIcon />
					</button>
				</div>
			</div>
		</div>
	);
};

interface MainControlPanelProps extends EngineControlsProps {
	children?: React.ReactNode;
}

const MainControlPanel: React.FC<MainControlPanelProps> = ({
	onRandomize,
	onInitializeAll,
	isMorphing,
	morphTime,
	setMorphTime,
	isMorphSynced,
	setIsMorphSynced,
	morphSyncRateIndex,
	setMorphSyncRateIndex,
	voicingMode,
	setVoicingMode,
	glideTime,
	setGlideTime,
	isGlideSynced,
	setIsGlideSynced,
	glideSyncRateIndex,
	setGlideSyncRateIndex,
	glideSyncRates,
	syncRates,
	isGlobalAutoRandomEnabled,
	setIsGlobalAutoRandomEnabled,
	globalAutoRandomInterval,
	setGlobalAutoRandomInterval,
	globalAutoRandomMode,
	setGlobalAutoRandomMode,
	isAutoRandomSynced,
	setIsAutoRandomSynced,
	autoRandomSyncRateIndex,
	setAutoRandomSyncRateIndex,
}) => {
	return (
		<div className="main-control-panel toolbar-mode">
			<div className="panel-header">
				<div className="header-controls-left">
					<div className="compact-header-section auto-random-section">
						<label>Auto-Random</label>
						<div className="control-group-row">
							<button
								className={`small ${isGlobalAutoRandomEnabled ? "active" : ""}`}
								onClick={(e) => {
									e.stopPropagation();
									setIsGlobalAutoRandomEnabled(!isGlobalAutoRandomEnabled);
								}}
							>
								{isGlobalAutoRandomEnabled ? "On" : "Off"}
							</button>
							<div className="control-value-wrapper">
								<input
									type="range"
									min="1"
									max="60"
									step="1"
									value={globalAutoRandomInterval / 1000}
									onChange={(e) => {
										const val = parseInt(e.target.value);
										if (!isNaN(val)) {
											setGlobalAutoRandomInterval(val * 1000);
										}
									}}
									disabled={isAutoRandomSynced}
									style={{ width: '60px' }}
									onClick={(e) => e.stopPropagation()}
								/>
								<span>{isNaN(globalAutoRandomInterval) ? 0 : globalAutoRandomInterval / 1000}s</span>
							</div>
							<div className="sync-wrapper">
								<button
									className={`small ${isAutoRandomSynced ? "active" : ""}`}
									onClick={(e) => { e.stopPropagation(); setIsAutoRandomSynced(!isAutoRandomSynced); }}
								>
									Sync
								</button>
								{isAutoRandomSynced && (
									<select
										value={autoRandomSyncRateIndex}
										onChange={(e) =>
											setAutoRandomSyncRateIndex(parseInt(e.target.value))
										}
										className="sync-select"
										onClick={(e) => e.stopPropagation()}
									>
										{syncRates.map((rate, i) => (
											<option key={i} value={i}>
												{rate}
											</option>
										))}
									</select>
								)}
							</div>
							<select
								value={globalAutoRandomMode}
								onChange={(e) =>
									setGlobalAutoRandomMode(e.target.value as RandomizeMode)
								}
								style={{ width: '80px' }}
								onClick={(e) => e.stopPropagation()}
							>
								<option value="chaos">Chaos</option>
								<option value="melodic">Melodic</option>
								<option value="rhythmic">Rhythmic</option>
							</select>
						</div>
					</div>

					{/* Morph Time */}
					<div className="morph-section compact-header-section">
						<label>Morph Time</label>
						<div className="control-group-row">
							<div className="control-value-wrapper">
								<input
									type="range"
									min="0"
									max="8000"
									step="10"
									value={morphTime}
									onChange={(e) => setMorphTime(parseFloat(e.target.value))}
									disabled={isMorphing || isMorphSynced}
									style={{ width: '80px' }}
									onClick={(e) => e.stopPropagation()}
								/>
								<span>{morphTime.toFixed(0)}ms</span>
							</div>
							<div className="sync-wrapper">
								<button
									className={`small ${isMorphSynced ? "active" : ""}`}
									onClick={(e) => { e.stopPropagation(); setIsMorphSynced(!isMorphSynced); }}
								>
									Sync
								</button>
								{isMorphSynced && (
									<select
										value={morphSyncRateIndex}
										onChange={(e) => setMorphSyncRateIndex(parseInt(e.target.value))}
										className="sync-select"
										onClick={(e) => e.stopPropagation()}
									>
										{syncRates.map((rate, i) => (
											<option key={i} value={i}>
												{rate}
											</option>
										))}
									</select>
								)}
							</div>
						</div>
					</div>
				</div>


			</div>
		</div>
	);
};

const EngineControls: React.FC<EngineControlsProps> = ({
	engine,
	onUpdate,
	onLayerUpdate,
	onLoadSample,
	onRecordSampleRequest,
	onRecordSample,
	onToggleLiveInput,
	onRandomize,
	onInitialize,
	analyserNode,
	currentStep,
	isTransportPlaying,
	audioContext,
	lockState,
	onToggleLock,
	harmonicTuningSystem,
	scaleFrequencies,
	onSnapToScale,
	onOpenMelodyEditor,
}) => {
	const [activeTab, setActiveTab] = useState<EngineLayerType>("synth");
	const dropZoneRef = useRef<HTMLDivElement>(null);

	const [isRecording, setIsRecording] = useState(false);
	const mediaRecorderRef = useRef<MediaRecorder | null>(null);
	const recordedChunksRef = useRef<Blob[]>([]);

	const getLock = (path: string): boolean => {
		const parts = path.split(".");
		let current: any = lockState;
		for (const part of parts) {
			if (current === undefined) return false;
			current = current[part];
		}
		return !!current;
	};

	const isFrequencyOverridden = useMemo(() => {
		if (!scaleFrequencies || scaleFrequencies.length === 0) return false;
		// Use a small tolerance for floating point comparison
		const tolerance = 0.1; // in Hz
		return !scaleFrequencies.some(
			(f) => Math.abs(f.value - engine.synth.frequency) < tolerance
		);
	}, [engine.synth.frequency, scaleFrequencies]);

	const handleDragOver = (e: React.DragEvent) => {
		e.preventDefault();
		e.stopPropagation();
		e.dataTransfer.dropEffect = "copy";
		dropZoneRef.current?.classList.add("drop-zone-active");
	};
	const handleDragLeave = (e: React.DragEvent) => {
		e.preventDefault();
		e.stopPropagation();
		dropZoneRef.current?.classList.remove("drop-zone-active");
	};
	const handleDrop = (e: React.DragEvent) => {
		e.preventDefault();
		e.stopPropagation();
		dropZoneRef.current?.classList.remove("drop-zone-active");
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
				const blob = new Blob(recordedChunksRef.current, {
					type: "audio/webm",
				});
				const arrayBuffer = await blob.arrayBuffer();
				if (audioContext) {
					const audioBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));
					onRecordSample(engine.id, audioBuffer);
					
					// Save to DB
					const sampleId = generateId();
					await saveSampleToDB(sampleId, arrayBuffer);
					
					// Update engine state with sampleId
					onUpdate(engine.id, {
						sampler: {
							...engine.sampler,
							sampleId: sampleId,
							sampleName: "Recorded Sample"
						}
					});
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
					<div className="engine-title-group" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '0.5rem' }}>
						<input
							type="text"
							className="engine-name-input"
							value={engine.name}
							onChange={(e) => onUpdate(engine.id, { name: e.target.value })}
							style={{
								background: "transparent",
								border: "1px solid rgba(255,255,255,0.1)",
								borderRadius: "4px",
								color: "inherit",
								fontSize: "1.2rem",
								fontWeight: "bold",
								width: "100px",
								padding: "0.2rem",
							}}
						/>
						<div className="toggle-group compact">
							<button
								className={`seq-toggle ${
									engine.sequencerEnabled ? "active" : ""
								}`}
								onClick={() =>
									onUpdate(engine.id, {
										sequencerEnabled: !engine.sequencerEnabled,
									})
								}
								title="Toggle Sequencer"
							>
								SEQ
							</button>
							<button
								className={`midi-toggle ${
									engine.midiControlled ? "active" : ""
								}`}
								onClick={() =>
									onUpdate(engine.id, {
										midiControlled: !engine.midiControlled,
									})
								}
								title="Toggle MIDI Control"
							>
								MIDI
							</button>
						</div>
					</div>
					<div className="randomizer-buttons-group">
						<button
							className="icon-button init-button"
							onClick={() => onInitialize(engine.id)}
							title="Initialize"
						>
							<InitializeIcon />
						</button>
						<button
							className="icon-button"
							onClick={() => onRandomize("chaos", engine.id)}
							title="Chaos"
						>
							<ChaosIcon />
						</button>
						<button
							className="icon-button"
							onClick={() => onRandomize("melodic", engine.id)}
							title="Melodic"
						>
							<MelodicIcon />
						</button>
						<button
							className="icon-button"
							onClick={() => onRandomize("rhythmic", engine.id)}
							title="Rhythmic"
						>
							<RhythmicIcon />
						</button>
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
							sequence={engine.sequence}
						/>
					</div>
				)}
			</div>


			<div className="control-row">
				<label>Seq Melody</label>
				<div className="toggle-group">
					<button
						className={engine.useMelodicSequence ? "active" : ""}
						onClick={() =>
							onUpdate(engine.id, {
								useMelodicSequence: !engine.useMelodicSequence,
							})
						}
						title="Toggle between sequenced melody and fixed note"
					>
						{engine.useMelodicSequence ? "SEQ" : "FIXED"}
					</button>
					{engine.useMelodicSequence && (
						<button
							className="small"
							onClick={() => onOpenMelodyEditor(engine.id)}
							title="Edit Melodic Sequence"
						>
							Edit
						</button>
					)}
				</div>
			</div>
			

			
			<div className="control-row">
				<label>Rnd Range</label>
				<div className="control-value-wrapper">
					<input
						type="range"
						min="1"
						max="4"
						step="1"
						value={engine.randomOctaveRange}
						onChange={(e) =>
							onUpdate(engine.id, { randomOctaveRange: parseInt(e.target.value) })
						}
					/>
					<span>{engine.randomOctaveRange} Oct</span>
				</div>
			</div>
			<div className="control-row">
				<label>Rnd Base</label>
				<div className="control-value-wrapper">
					<input
						type="range"
						min="1"
						max="6"
						step="1"
						value={engine.randomBaseOctave}
						onChange={(e) =>
							onUpdate(engine.id, { randomBaseOctave: parseInt(e.target.value) })
						}
					/>
					<span>C{engine.randomBaseOctave}</span>
				</div>
			</div>

			<div className="control-row">
				<label>Rate</label>
				<div className="control-value-wrapper control-with-lock">
					<select
						value={engine.sequencerRate}
						onChange={(e) => onUpdate(engine.id, { sequencerRate: e.target.value })}
					>
						{sequencerRates.map((r) => (
							<option key={r} value={r}>
								{r}
							</option>
						))}
					</select>
					<LockIcon
						isLocked={getLock("sequencerRate")}
						onClick={() => onToggleLock(`engines.${engine.id}.sequencerRate`)}
						title="Lock Sequencer Rate"
					/>
				</div>
			</div>
			<div className="control-row">
				<label>Steps</label>
				<div className="control-value-wrapper control-with-lock">
					<input
						type="range"
						min="2"
						max="32"
						step="1"
						value={engine.sequencerSteps}
						onChange={(e) =>
							onUpdate(engine.id, { sequencerSteps: parseInt(e.target.value) })
						}
					/>
					<span>{engine.sequencerSteps}</span>
					<LockIcon
						isLocked={getLock(`engines.${engine.id}.sequencerSteps`)}
						onClick={() => onToggleLock(`engines.${engine.id}.sequencerSteps`)}
						title="Lock Steps"
					/>
				</div>
			</div>
			<div className="control-row">
				<label>Pulses</label>
				<div className="control-value-wrapper control-with-lock">
					<input
						type="range"
						min="1"
						max={engine.sequencerSteps}
						step="1"
						value={engine.sequencerPulses}
						onChange={(e) =>
							onUpdate(engine.id, { sequencerPulses: parseInt(e.target.value) })
						}
					/>
					<span>{engine.sequencerPulses}</span>
					<LockIcon
						isLocked={getLock(`engines.${engine.id}.sequencerPulses`)}
						onClick={() => onToggleLock(`engines.${engine.id}.sequencerPulses`)}
						title="Lock Pulses"
					/>
				</div>
			</div>
			<div className="control-row">
				<label>Rotate</label>
				<div className="control-value-wrapper control-with-lock">
					<input
						type="range"
						min="0"
						max={engine.sequencerSteps - 1}
						step="1"
						value={engine.sequencerRotate}
						onChange={(e) =>
							onUpdate(engine.id, { sequencerRotate: parseInt(e.target.value) })
						}
					/>
					<span>{engine.sequencerRotate}</span>
					<LockIcon
						isLocked={getLock(`engines.${engine.id}.sequencerRotate`)}
						onClick={() => onToggleLock(`engines.${engine.id}.sequencerRotate`)}
						title="Lock Rotate"
					/>
				</div>
			</div>

			<div className="tab-nav">
				{(["synth", "noise", "sampler"] as EngineLayerType[]).map((layer) => (
					<button
						key={layer}
						onClick={() => setActiveTab(layer)}
						className={`tab-button-wrapper ${
							activeTab === layer ? "active" : ""
						}`}
					>
						<span className="tab-button-label">
							{layer.charAt(0).toUpperCase() + layer.slice(1)}
						</span>
						<div
							className={`tab-power-button ${
								engine[layer].enabled ? "active" : ""
							}`}
							onClick={(e) => {
								e.stopPropagation();
								onLayerUpdate(engine.id, layer, {
									enabled: !engine[layer].enabled,
								});
							}}
						/>
					</button>
				))}
			</div>

			<div className="tab-content">
				{activeTab === "synth" && (
					<>
						<div className="control-row">
							<label>Volume</label>
							<div className="control-with-lock full-width">
								<input
									type="range"
									min="0"
									max="1"
									step="0.01"
									value={engine.synth.volume}
									onChange={(e) =>
										onLayerUpdate(engine.id, "synth", {
											volume: parseFloat(e.target.value),
										})
									}
								/>
								<span>{Math.round(engine.synth.volume * 100)}%</span>
								<LockIcon
									isLocked={getLock(`engines.${engine.id}.synth.volume`)}
									onClick={() =>
										onToggleLock(`engines.${engine.id}.synth.volume`)
									}
									title="Lock Synth Volume"
								/>
							</div>
						</div>
						<div className="control-row">
							<label>Shape</label>
							<div className="control-with-lock">
								<select
									value={engine.synth.oscillatorType}
									onChange={(e) =>
										onLayerUpdate(engine.id, "synth", {
											oscillatorType: e.target.value as OscillatorType,
										})
									}
								>
									{oscillatorTypes.map((type) => (
										<option key={type} value={type}>
											{type}
										</option>
									))}
								</select>
								<LockIcon
									isLocked={getLock(
										`engines.${engine.id}.synth.oscillatorType`
									)}
									onClick={() =>
										onToggleLock(`engines.${engine.id}.synth.oscillatorType`)
									}
									title="Lock Synth Shape"
								/>
							</div>
						</div>

						<div className="control-row">
							<label>Frequency</label>
							<div className="control-value-wrapper control-with-lock">
								<input
									type="range"
									min="20"
									max="20000"
									step="1"
									value={engine.synth.frequency}
									onChange={(e) =>
										onLayerUpdate(engine.id, "synth", {
											frequency: parseFloat(e.target.value),
										})
									}
								/>
								<span>{engine.synth.frequency.toFixed(0)} Hz</span>
								<LockIcon
									isLocked={getLock(`engines.${engine.id}.synth.frequency`)}
									onClick={() =>
										onToggleLock(`engines.${engine.id}.synth.frequency`)
									}
									title="Lock Synth Frequency"
								/>
							</div>
						</div>
						<div className="control-row">
							<label>Scale Note</label>
							<div className="control-with-lock">
								<select
									value={
										isFrequencyOverridden ? "custom" : engine.synth.frequency
									}
									onChange={(e) =>
										onLayerUpdate(engine.id, "synth", {
											frequency: parseFloat(e.target.value),
										})
									}
								>
									{isFrequencyOverridden && (
										<option value="custom" disabled>
											Custom Freq
										</option>
									)}
									{scaleFrequencies.map((f) => (
										<option key={f.value} value={f.value}>
											{f.label}
										</option>
									))}
								</select>
								<LockIcon
									isLocked={getLock(
										`engines.${engine.id}.synth.solfeggioFrequency`
									)}
									onClick={() =>
										onToggleLock(
											`engines.${engine.id}.synth.solfeggioFrequency`
										)
									}
									title="Lock Preset Note"
								/>
							</div>
							<div className="snap-control">
								<div
									className="snap-indicator"
									style={{ opacity: isFrequencyOverridden ? 1 : 0 }}
									title="Frequency is off-scale"
								/>
								<button
									className="small"
									onClick={() => onSnapToScale(engine.id)}
									title="Snap to nearest scale note"
								>
									Snap
								</button>
							</div>
						</div>

					</>
				)}
				{activeTab === "noise" && (
					<>
						<div className="control-row">
							<label>Volume</label>
							<div className="control-with-lock full-width">
								<input
									type="range"
									min="0"
									max="1"
									step="0.01"
									value={engine.noise.volume}
									onChange={(e) =>
										onLayerUpdate(engine.id, "noise", {
											volume: parseFloat(e.target.value),
										})
									}
								/>
								<span>{Math.round(engine.noise.volume * 100)}%</span>
								<LockIcon
									isLocked={getLock(`engines.${engine.id}.noise.volume`)}
									onClick={() =>
										onToggleLock(`engines.${engine.id}.noise.volume`)
									}
									title="Lock Noise Volume"
								/>
							</div>
						</div>
						<div className="control-row">
							<label>Type</label>
							<div className="control-with-lock">
								<select
									value={engine.noise.noiseType}
									onChange={(e) =>
										onLayerUpdate(engine.id, "noise", {
											noiseType: e.target.value as NoiseType,
										})
									}
								>
									{noiseTypes.map((type) => (
										<option key={type} value={type}>
											{type}
										</option>
									))}
								</select>
								<LockIcon
									isLocked={getLock(`engines.${engine.id}.noise.noiseType`)}
									onClick={() =>
										onToggleLock(`engines.${engine.id}.noise.noiseType`)
									}
									title="Lock Noise Type"
								/>
							</div>
						</div>
					</>
				)}
				{activeTab === "sampler" && (
					<>
						<div
							ref={dropZoneRef}
							className="drop-zone"
							onDragOver={handleDragOver}
							onDragLeave={handleDragLeave}
							onDrop={handleDrop}
						>
							<div className="sampler-info">
								{engine.sampler.sampleName ? (
									<>
										<span>Loaded: {engine.sampler.sampleName}</span>
									</>
								) : (
									"Drag & drop audio file or record"
								)}
							</div>
							<input
								type="file"
								accept="audio/*"
								onChange={(e) =>
									e.target.files && onLoadSample(engine.id, e.target.files[0])
								}
								style={{ display: "none" }}
								id={`file-input-${engine.id}`}
							/>
							<div className="sampler-actions">
								<button
									className="small"
									onClick={() =>
										document.getElementById(`file-input-${engine.id}`)?.click()
									}
								>
									{engine.sampler.sampleName ? "Replace" : "Load File"}
								</button>
								<button
									className={`small record-btn ${isRecording ? "active" : ""}`}
									onClick={handleRecordClick}
									disabled={engine.sampler.liveInputEnabled}
								>
									{isRecording ? "Stop" : "Record"}
								</button>
								<button
									className={`small ${
										engine.sampler.liveInputEnabled ? "active" : ""
									}`}
									onClick={() =>
										onToggleLiveInput(
											engine.id,
											!engine.sampler.liveInputEnabled
										)
									}
								>
									Live Input
								</button>
							</div>
						</div>
						<div className="control-row">
							<label>Volume</label>
							<div className="control-with-lock full-width">
								<input
									type="range"
									min="0"
									max="1"
									step="0.01"
									value={engine.sampler.volume}
									onChange={(e) =>
										onLayerUpdate(engine.id, "sampler", {
											volume: parseFloat(e.target.value),
										})
									}
								/>
								<span>{Math.round(engine.sampler.volume * 100)}%</span>
								<LockIcon
									isLocked={getLock(`engines.${engine.id}.sampler.volume`)}
									onClick={() =>
										onToggleLock(`engines.${engine.id}.sampler.volume`)
									}
									title="Lock Sampler Volume"
								/>
							</div>
						</div>
						<div className="control-row">
							<label>Transpose</label>
							<div className="control-value-wrapper control-with-lock">
								<input
									type="range"
									min="-24"
									max="24"
									step="1"
									value={engine.sampler.transpose}
									onChange={(e) =>
										onLayerUpdate(engine.id, "sampler", {
											transpose: parseInt(e.target.value),
										})
									}
									disabled={engine.sampler.liveInputEnabled}
								/>
								<span>{engine.sampler.transpose} st</span>
								<LockIcon
									isLocked={getLock(`engines.${engine.id}.sampler.transpose`)}
									onClick={() =>
										onToggleLock(`engines.${engine.id}.sampler.transpose`)
									}
									title="Lock Transpose"
								/>
							</div>
						</div>
						<div className="control-row">
							<label>Granular Mode</label>
							<button
								className={`small ${
									engine.sampler.granularModeEnabled ? "active" : ""
								}`}
								onClick={() =>
									onLayerUpdate(engine.id, "sampler", {
										granularModeEnabled: !engine.sampler.granularModeEnabled,
									})
								}
								disabled={engine.sampler.liveInputEnabled}
							>
								{engine.sampler.granularModeEnabled ? "On" : "Off"}
							</button>
						</div>
						{engine.sampler.granularModeEnabled && (
							<>
								<div className="control-row">
									<label>Grain Size</label>
									<div className="control-value-wrapper control-with-lock">
										<input
											type="range"
											min="0.01"
											max="0.5"
											step="0.001"
											value={engine.sampler.grainSize}
											onChange={(e) =>
												onLayerUpdate(engine.id, "sampler", {
													grainSize: parseFloat(e.target.value),
												})
											}
										/>
										<span>
											{(engine.sampler.grainSize * 1000).toFixed(0)} ms
										</span>
										<LockIcon
											isLocked={getLock(
												`engines.${engine.id}.sampler.grainSize`
											)}
											onClick={() =>
												onToggleLock(`engines.${engine.id}.sampler.grainSize`)
											}
											title="Lock Grain Size"
										/>
									</div>
								</div>
								<div className="control-row">
									<label>Density</label>
									<div className="control-value-wrapper control-with-lock">
										<input
											type="range"
											min="1"
											max="100"
											step="1"
											value={engine.sampler.grainDensity}
											onChange={(e) =>
												onLayerUpdate(engine.id, "sampler", {
													grainDensity: parseInt(e.target.value),
												})
											}
										/>
										<span>{engine.sampler.grainDensity.toFixed(1)} /s</span>
										<LockIcon
											isLocked={getLock(
												`engines.${engine.id}.sampler.grainDensity`
											)}
											onClick={() =>
												onToggleLock(
													`engines.${engine.id}.sampler.grainDensity`
												)
											}
											title="Lock Grain Density"
										/>
									</div>
								</div>
								<div className="control-row">
									<label>Position</label>
									<div className="control-with-lock full-width">
										<input
											type="range"
											min="0"
											max="1"
											step="0.001"
											value={engine.sampler.playbackPosition}
											onChange={(e) =>
												onLayerUpdate(engine.id, "sampler", {
													playbackPosition: parseFloat(e.target.value),
												})
											}
										/>
										<span>{engine.sampler.playbackPosition.toFixed(2)}</span>
										<LockIcon
											isLocked={getLock(
												`engines.${engine.id}.sampler.playbackPosition`
											)}
											onClick={() =>
												onToggleLock(
													`engines.${engine.id}.sampler.playbackPosition`
												)
											}
											title="Lock Grain Position"
										/>
									</div>
								</div>
								<div className="control-row">
									<label>Jitter</label>
									<div className="control-with-lock full-width">
										<input
											type="range"
											min="0"
											max="1"
											step="0.01"
											value={engine.sampler.positionJitter}
											onChange={(e) =>
												onLayerUpdate(engine.id, "sampler", {
													positionJitter: parseFloat(e.target.value),
												})
											}
										/>
										<span>{engine.sampler.positionJitter.toFixed(2)}</span>
										<LockIcon
											isLocked={getLock(
												`engines.${engine.id}.sampler.positionJitter`
											)}
											onClick={() =>
												onToggleLock(
													`engines.${engine.id}.sampler.positionJitter`
												)
											}
											title="Lock Position Jitter"
										/>
									</div>
								</div>
							</>
						)}
					</>
				)}
			</div>
			<div className="adsr-container">
				<h4>Amplitude Envelope</h4>
				<div className="control-row">
					<label>Attack</label>
					<div className="control-value-wrapper control-with-lock">
						<input
							type="range"
							min="0.001"
							max="3"
							step="0.001"
							value={engine.adsr.attack}
							onChange={(e) =>
								handleAdsrUpdate("attack", parseFloat(e.target.value))
							}
						/>
						<span>{engine.adsr.attack.toFixed(3)} s</span>
						<LockIcon
							isLocked={getLock(`engines.${engine.id}.adsr.attack`)}
							onClick={() => onToggleLock(`engines.${engine.id}.adsr.attack`)}
							title="Lock Attack"
						/>
					</div>
				</div>
				<div className="control-row">
					<label>Decay</label>
					<div className="control-value-wrapper control-with-lock">
						<input
							type="range"
							min="0.001"
							max="3"
							step="0.001"
							value={engine.adsr.decay}
							onChange={(e) =>
								handleAdsrUpdate("decay", parseFloat(e.target.value))
							}
						/>
						<span>{engine.adsr.decay.toFixed(3)} s</span>
						<LockIcon
							isLocked={getLock(`engines.${engine.id}.adsr.decay`)}
							onClick={() => onToggleLock(`engines.${engine.id}.adsr.decay`)}
							title="Lock Decay"
						/>
					</div>
				</div>
				<div className="control-row">
					<label>Sustain</label>
					<div className="control-value-wrapper control-with-lock">
						<input
							type="range"
							min="0"
							max="1"
							step="0.01"
							value={engine.adsr.sustain}
							onChange={(e) =>
								handleAdsrUpdate("sustain", parseFloat(e.target.value))
							}
						/>
						<span>{engine.adsr.sustain.toFixed(2)}</span>
						<LockIcon
							isLocked={getLock(`engines.${engine.id}.adsr.sustain`)}
							onClick={() => onToggleLock(`engines.${engine.id}.adsr.sustain`)}
							title="Lock Sustain"
						/>
					</div>
				</div>
				<div className="control-row">
					<label>Release</label>
					<div className="control-value-wrapper control-with-lock">
						<input
							type="range"
							min="0.001"
							max="5"
							step="0.001"
							value={engine.adsr.release}
							onChange={(e) =>
								handleAdsrUpdate("release", parseFloat(e.target.value))
							}
						/>
						<span>{engine.adsr.release.toFixed(3)} s</span>
						<LockIcon
							isLocked={getLock(`engines.${engine.id}.adsr.release`)}
							onClick={() => onToggleLock(`engines.${engine.id}.adsr.release`)}
							title="Lock Release"
						/>
					</div>
				</div>
			</div>

			<div className="engine-routing-control-bottom">
				<label>Output Routing:</label>
				<select
					value={engine.filterDestination || "filter1"}
					onChange={(e) =>
						onUpdate(engine.id, {
							filterDestination: e.target.value as "filter1" | "filter2" | "direct",
						})
					}
				>
					<option value="filter1">Filter 1</option>
					<option value="filter2">Filter 2</option>
					<option value="direct">Direct</option>
				</select>
			</div>
		</div>
	);
};

const MasterFilterControls: React.FC<MasterFilterControlsProps> = ({
	title,
	filterState,
	onUpdate,
	onRandomize,
	onInitialize,
	lockState,
	onToggleLock,
}) => {
	const scope = title === "Filter 1" ? "filter1" : "filter2";
	const getLock = (path: string) =>
		lockState[scope as "filter1" | "filter2"][path];
	return (
		<div className="control-group">
			<div
				className="control-group-header"
				style={{ border: "none", padding: 0, marginBottom: "1rem" }}
			>
				<div className="engine-title-group">
					<h2>{title}</h2>
					<button
						className={`small ${filterState.enabled ? "active" : ""}`}
						onClick={() => onUpdate({ enabled: !filterState.enabled })}
					>
						{filterState.enabled ? "On" : "Off"}
					</button>
				</div>
				<div className="randomizer-buttons-group">
					<button
						className="icon-button init-button"
						onClick={() => onInitialize(scope)}
						title="Initialize"
					>
						<InitializeIcon />
					</button>
					<button
						className="icon-button"
						onClick={() => onRandomize("chaos", scope)}
						title="Chaos"
					>
						<ChaosIcon />
					</button>
					<button
						className="icon-button"
						onClick={() => onRandomize("melodic", scope)}
						title="Melodic"
					>
						<MelodicIcon />
					</button>
					<button
						className="icon-button"
						onClick={() => onRandomize("rhythmic", scope)}
						title="Rhythmic"
					>
						<RhythmicIcon />
					</button>
				</div>
			</div>
			<div className="control-row">
				<label>Type</label>
				<div className="control-with-lock">
					<select
						value={filterState.type}
						onChange={(e) => onUpdate({ type: e.target.value as FilterType })}
						disabled={!filterState.enabled}
					>
						{filterTypes.map((type) => (
							<option key={type} value={type}>
								{type}
							</option>
						))}
					</select>
					<LockIcon
						isLocked={getLock("type")}
						onClick={() => onToggleLock(`${scope}.type`)}
						title="Lock Filter Type"
					/>
				</div>
			</div>
			<div className="control-row">
				<label>Cutoff</label>
				<div className="control-value-wrapper control-with-lock">
					<input
						type="range"
						min="20"
						max="20000"
						step="1"
						value={filterState.cutoff ?? 2000}
						onChange={(e) => onUpdate({ cutoff: parseFloat(e.target.value) })}
						disabled={!filterState.enabled}
					/>
					<span>{(filterState.cutoff ?? 2000).toFixed(0)} Hz</span>
					<LockIcon
						isLocked={getLock("cutoff")}
						onClick={() => onToggleLock(`${scope}.cutoff`)}
						title="Lock Cutoff"
					/>
				</div>
			</div>
			<div className="control-row">
				<label>Resonance</label>
				<div className="control-value-wrapper control-with-lock">
					<input
						type="range"
						min="0"
						max="30"
						step="0.1"
						value={filterState.resonance ?? 1}
						onChange={(e) =>
							onUpdate({ resonance: parseFloat(e.target.value) })
						}
						disabled={!filterState.enabled}
					/>
					<span>{(filterState.resonance ?? 1).toFixed(1)}</span>
					<LockIcon
						isLocked={getLock("resonance")}
						onClick={() => onToggleLock(`${scope}.resonance`)}
						title="Lock Resonance"
					/>
				</div>
			</div>
		</div>
	);
};

const LfoVisualizer: React.FC<{
	shape: LFO_Shape;
	rate: number;
	isSynced: boolean;
	bpm: number;
	syncRate: string;
	depth: number;
	customShape?: number[];
	smoothing?: number;
}> = React.memo(({ shape, rate, isSynced, bpm, syncRate, depth, customShape, smoothing }) => {
	const canvasRef = useRef<HTMLCanvasElement>(null);

	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;
		const ctx = canvas.getContext("2d");
		if (!ctx) return;
		let animationFrameId: number;

		let lfoFrequency = rate;
		if (isSynced) {
			let noteValueInBeats = 1;
			const cleanRate = syncRate; // LFO rates are not dotted
			if (cleanRate.includes("/")) {
				const parts = cleanRate.split("/");
				const numerator = parseFloat(parts[0]);
				const denominator = parseFloat(parts[1]);
				if (denominator && !isNaN(numerator)) noteValueInBeats = (4 * numerator) / denominator;
			} else {
				const val = parseFloat(cleanRate);
				if (val) noteValueInBeats = 4 / val;
			}
			const durationInSeconds = noteValueInBeats * (60 / bpm);
			if (durationInSeconds > 0) lfoFrequency = 1 / durationInSeconds;
		}

		const getRawValue = (phase: number) => {
			switch (shape) {
				case "sine":
					return Math.sin(phase * 2 * Math.PI);
				case "square":
					return phase < 0.5 ? 1 : -1;
				case "rampDown":
					return 1 - 2 * phase;
				case "rampUp":
					return 2 * phase - 1;
				case "triangle":
					return 2 * Math.abs(2 * (phase - Math.floor(phase + 0.5))) - 1;
				case "random":
					return random1D(phase);
				case "noise":
					return smoothNoise1D(phase) * 2 - 1;
				case "perlin":
					return noise1D(phase);
				case "custom":
					if (customShape && customShape.length > 0) {
						const idx = Math.floor(phase * customShape.length);
						return customShape[idx % customShape.length];
					}
					return 0;
				default:
					return 0;
			}
		};

		const draw = (time: number) => {
			const { width, height } = canvas;
			ctx.clearRect(0, 0, width, height);
			ctx.strokeStyle = "#a45ee5"; // --primary-color
			ctx.lineWidth = 2;

			ctx.beginPath();

			const lfoRate = lfoFrequency;
			
			// Smoothing Logic (1-pole Lowpass Simulation)
			const maxHarmonic = 1 + (1 - (smoothing || 0)) * 100;
			const cutoff = Math.max(0.1, lfoRate * maxHarmonic);
			const tau = 1 / (2 * Math.PI * cutoff);
			// dt corresponds to the time duration of one pixel width
			const dt = 1 / (lfoRate * width); 
			const alpha = dt / (tau + dt);

			// Pre-roll to settle filter
			const padding = width; 
			let val = 0;

			// Initialize val
			const startPhaseRaw = ((time / 1000) * lfoRate + (-padding / width)) % 1;
			const startPhase = startPhaseRaw < 0 ? 1 + startPhaseRaw : startPhaseRaw;
			val = getRawValue(startPhase);

			for (let x = -padding; x < width; x++) {
				const normalizedX = x / width;
				const phaseRaw = ((time / 1000) * lfoRate + normalizedX) % 1;
				const phase = phaseRaw < 0 ? 1 + phaseRaw : phaseRaw;

				const target = getRawValue(phase);
				
				// Apply smoothing
				val += alpha * (target - val);

				if (x >= 0) {
					const scaledY = val * depth;
					const canvasY = (1 - (scaledY + 1) / 2) * height;
					if (x === 0) ctx.moveTo(x, canvasY);
					else ctx.lineTo(x, canvasY);
				}
			}
			ctx.stroke();

			animationFrameId = requestAnimationFrame(draw);
		};

		animationFrameId = requestAnimationFrame(draw);

		return () => cancelAnimationFrame(animationFrameId);
	}, [shape, rate, isSynced, bpm, syncRate, depth, customShape, smoothing]);

	return <canvas ref={canvasRef} width={200} height={100} className="lfo-visualizer" />;
});

interface LfoEditorModalProps {
	lfoState: LFOState;
	onUpdate: (updates: Partial<LFOState>) => void;
	onClose: () => void;
}

const LfoEditorModal: React.FC<LfoEditorModalProps> = ({ lfoState, onUpdate, onClose }) => {
	const canvasRef = useRef<HTMLCanvasElement>(null);

	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;
		const ctx = canvas.getContext("2d");
		if (!ctx) return;

		const draw = () => {
			const { width, height } = canvas;
			ctx.clearRect(0, 0, width, height);
			
			// Draw Grid
			const gridSize = lfoState.gridSize || 0;
			if (gridSize > 0) {
				ctx.strokeStyle = "#333";
				ctx.lineWidth = 1;
				const stepX = width / gridSize;
				const stepY = height / gridSize;
				
				ctx.beginPath();
				for (let i = 1; i < gridSize; i++) {
					ctx.moveTo(i * stepX, 0);
					ctx.lineTo(i * stepX, height);
					ctx.moveTo(0, i * stepY);
					ctx.lineTo(width, i * stepY);
				}
				ctx.stroke();
			}

			// Draw Shape
			ctx.strokeStyle = "#a45ee5";
			ctx.lineWidth = 2;
			ctx.beginPath();
			
			const shape = lfoState.customShape || new Array(256).fill(0);
			const len = shape.length;
			
			for (let i = 0; i < len; i++) {
				const x = (i / (len - 1)) * width;
				// Invert Y because canvas Y is down, and map -1..1 to height..0
				const y = (1 - (shape[i] + 1) / 2) * height;
				if (i === 0) ctx.moveTo(x, y);
				else ctx.lineTo(x, y);
			}
			ctx.stroke();
		};

		draw();
	}, [lfoState.customShape, lfoState.gridSize]);

	return (
		<div className="modal-overlay" style={{
			position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
			backgroundColor: 'rgba(0,0,0,0.8)', zIndex: 1000,
			display: 'flex', justifyContent: 'center', alignItems: 'center'
		}}>
			<div className="modal-content" style={{
				backgroundColor: '#1a1a1a', padding: '20px', borderRadius: '8px',
				width: '800px', maxWidth: '90%', border: '1px solid #444'
			}} onClick={e => e.stopPropagation()}>
				<div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
					<h2>Edit LFO Shape: {lfoState.name}</h2>
					<button className="icon-button" onClick={onClose}>✕</button>
				</div>

				<div style={{ marginBottom: '1rem', display: 'flex', gap: '1rem', alignItems: 'center' }}>
					<label>Grid Size:</label>
					<div
						className="value-display"
						style={{ 
							width: '40px', textAlign: 'center', cursor: 'ns-resize',
							background: '#333', padding: '4px 8px', borderRadius: '4px', userSelect: 'none'
						}}
						onMouseDown={(e) => {
							const startY = e.clientY;
							const startVal = lfoState.gridSize || 0;
							const handleMove = (moveEvent: MouseEvent) => {
								const delta = Math.floor((startY - moveEvent.clientY) / 5);
								const newVal = Math.max(0, Math.min(64, startVal + delta));
								if (newVal !== lfoState.gridSize) onUpdate({ gridSize: newVal });
							};
							const handleUp = () => {
								window.removeEventListener('mousemove', handleMove);
								window.removeEventListener('mouseup', handleUp);
							};
							window.addEventListener('mousemove', handleMove);
							window.addEventListener('mouseup', handleUp);
						}}
					>
						{lfoState.gridSize || "Off"}
					</div>
					<div style={{ fontSize: '0.8rem', color: '#888' }}>
						Hold Shift: Even steps | Hold Alt: Odd steps | Shift+Alt: Fibonacci
					</div>
				</div>

				<canvas
					ref={canvasRef}
					width={760}
					height={400}
					style={{ 
						border: '1px solid #444', background: '#222', 
						cursor: 'crosshair', borderRadius: '4px', width: '100%'
					}}
					onMouseDown={(e) => {
						const canvas = e.currentTarget;
						const rect = canvas.getBoundingClientRect();
						const len = 256;
						const currentShape = [...(lfoState.customShape || new Array(len).fill(0))];
						if (currentShape.length !== len) {
							while(currentShape.length < len) currentShape.push(0);
							currentShape.length = len;
						}

						let lastIndex: number | null = null;
						let lastVal: number | null = null;
						const gridSize = lfoState.gridSize || 0;

						const handleMove = (moveEvent: MouseEvent) => {
							const clientX = moveEvent.clientX;
							const clientY = moveEvent.clientY;
							let x = Math.max(0, Math.min(canvas.width, clientX - rect.left));
							let y = Math.max(0, Math.min(canvas.height, clientY - rect.top));
							
							if (gridSize > 0) {
								const stepX = canvas.width / gridSize;
								const stepY = canvas.height / gridSize;
								x = Math.round(x / stepX) * stepX;
								y = Math.round(y / stepY) * stepY;
								x = Math.max(0, Math.min(canvas.width, x));
								y = Math.max(0, Math.min(canvas.height, y));
							}

							const normalizedY = 1 - (y / canvas.height) * 2;
							const index = Math.min(len - 1, Math.floor((x / canvas.width) * len));
							
							if (index >= 0 && index < len) {
								const updateRange = (startIdx: number, endIdx: number, val: number) => {
									for (let i = startIdx; i < endIdx; i++) currentShape[i] = val;
								};

								if (gridSize > 0) {
									const stepWidth = len / gridSize;
									const currentStep = Math.floor(index / stepWidth);
									const getFibonacciSteps = (max: number) => {
										const steps = new Set<number>();
										let a = 0, b = 1;
										while (a < max) { steps.add(a); const next = a + b; a = b; b = next; }
										return steps;
									};

									let shouldUpdate = true;
									if (moveEvent.shiftKey && moveEvent.altKey) {
										if (!getFibonacciSteps(gridSize).has(currentStep)) shouldUpdate = false;
									} else if (moveEvent.shiftKey) {
										if (currentStep % 2 !== 0) shouldUpdate = false;
									} else if (moveEvent.altKey) {
										if (currentStep % 2 === 0) shouldUpdate = false;
									}

									if (shouldUpdate) {
										const start = Math.floor(currentStep * stepWidth);
										const end = Math.floor((currentStep + 1) * stepWidth);
										updateRange(start, Math.min(len, end), normalizedY);
									}
								} else {
									currentShape[index] = normalizedY;
									if (lastIndex !== null && Math.abs(index - lastIndex) > 1) {
										const start = Math.min(lastIndex, index);
										const end = Math.max(lastIndex, index);
										const startVal = lastIndex < index ? lastVal! : normalizedY;
										const endVal = lastIndex < index ? normalizedY : lastVal!;
										for (let i = start + 1; i < end; i++) {
											const t = (i - start) / (end - start);
											currentShape[i] = startVal + (endVal - startVal) * t;
										}
									}
								}
								onUpdate({ customShape: [...currentShape] });
								lastIndex = index;
								lastVal = normalizedY;
							}
						};

						const handleUp = () => {
							window.removeEventListener('mousemove', handleMove);
							window.removeEventListener('mouseup', handleUp);
						};

						window.addEventListener('mousemove', handleMove);
						window.addEventListener('mouseup', handleUp);
						handleMove(e.nativeEvent); // Trigger initial draw
					}}
				/>
			</div>
		</div>
	);
};

const LFOControls: React.FC<LFOControlsProps> = ({
	lfoState,
	onUpdate,
	onRandomize,
	onInitialize,
	bpm,
	lockState,
	onToggleLock,
	onEdit,
}) => {
	const getLock = (path: string) =>
		lockState.lfos[lfoState.id]?.[path] ?? false;
	return (
		<div className="control-group lfo-controls">
			<div
				className="control-group-header"
				style={{ border: "none", padding: 0, marginBottom: "0.5rem" }}
			>
				<h2>{lfoState.name}</h2>
				<div className="randomizer-buttons-group">
					<button
						className="icon-button init-button"
						onClick={() => onInitialize(lfoState.id)}
						title="Initialize"
					>
						<InitializeIcon />
					</button>
					<button
						className="icon-button"
						onClick={() => onRandomize("chaos", lfoState.id)}
						title="Chaos"
					>
						<ChaosIcon />
					</button>
					<button
						className="icon-button"
						onClick={() => onRandomize("melodic", lfoState.id)}
						title="Melodic"
					>
						<MelodicIcon />
					</button>
					<button
						className="icon-button"
						onClick={() => onRandomize("rhythmic", lfoState.id)}
						title="Rhythmic"
					>
						<RhythmicIcon />
					</button>
				</div>
			</div>
			<LfoVisualizer
				shape={lfoState.shape}
				rate={lfoState.rate}
				isSynced={lfoState.sync}
				bpm={bpm}
				syncRate={lfoState.syncRate}
				depth={lfoState.depth}
				customShape={lfoState.customShape}
				smoothing={lfoState.smoothing}
			/>

			<div className="control-row">
				<label>Shape</label>
				<div className="control-with-lock">
					<select
						value={lfoState.shape}
						onChange={(e) => onUpdate({ shape: e.target.value as LFO_Shape })}
					>
						{lfoShapes.map((s) => (
							<option key={s} value={s}>
								{s}
							</option>
						))}
					</select>
					<LockIcon
						isLocked={getLock("shape")}
						onClick={() => onToggleLock(`lfos.${lfoState.id}.shape`)}
						title="Lock LFO Shape"
					/>
					{lfoState.shape === 'custom' && (
						<button 
							className="small"
							onClick={() => onEdit(lfoState.id)}
							style={{ marginLeft: '0.5rem' }}
						>
							Edit
						</button>
					)}
				</div>
			</div>
			<div className="control-row">
				<label>Rate</label>
				<div className="control-value-wrapper control-with-lock">
					<input
						type="range"
						min="0.1"
						max="50"
						step="0.1"
						value={lfoState.rate}
						onChange={(e) => onUpdate({ rate: parseFloat(e.target.value) })}
						disabled={lfoState.sync}
					/>
					<span>{lfoState.rate.toFixed(1)} Hz</span>
					<LockIcon
						isLocked={getLock("rate")}
						onClick={() => onToggleLock(`lfos.${lfoState.id}.rate`)}
						title="Lock LFO Rate"
					/>
				</div>
			</div>
			<div className="control-row">
				<label>Depth</label>
				<div className="control-with-lock full-width">
					<input
						type="range"
						min="0"
						max="1"
						step="0.01"
						value={lfoState.depth}
						onChange={(e) => onUpdate({ depth: parseFloat(e.target.value) })}
					/>
					<LockIcon
						isLocked={getLock("depth")}
						onClick={() => onToggleLock(`lfos.${lfoState.id}.depth`)}
						title="Lock LFO Depth"
					/>
				</div>
			</div>
			<div className="control-row">
				<label>Sync</label>
				<div className="control-with-lock">
					<button
						className={`small ${lfoState.sync ? "active" : ""}`}
						onClick={() => onUpdate({ sync: !lfoState.sync })}
					>
						{lfoState.sync ? "On" : "Off"}
					</button>
					{lfoState.sync && (
						<select
							value={lfoState.syncRate}
							onChange={(e) => onUpdate({ syncRate: e.target.value })}
						>
							{lfoSyncRates.map((r) => (
								<option key={r} value={r}>
									{r}
								</option>
							))}
						</select>
					)}
					<LockIcon
						isLocked={getLock("sync")}
						onClick={() => onToggleLock(`lfos.${lfoState.id}.sync`)}
						title="Lock LFO Sync"
					/>
				</div>
			</div>
			<div className="control-row">
				<label>Smooth</label>
				<div className="control-with-lock full-width">
					<input
						type="range"
						min="0"
						max="1"
						step="0.01"
						value={lfoState.smoothing || 0}
						onChange={(e) => onUpdate({ smoothing: parseFloat(e.target.value) })}
					/>
					<LockIcon
						isLocked={getLock("smoothing")}
						onClick={() => onToggleLock(`lfos.${lfoState.id}.smoothing`)}
						title="Lock Smoothing"
					/>
				</div>
			</div>
			
			
		</div>
	);
};

const EffectModule: React.FC<EffectModuleProps> = ({
	effect,
	onUpdate,
	onRemove,
	onToggle,
	onRandomize,
	onInitialize,
	onDragStart,
	onDragOver,
	onDragEnd,
	isDragging,
	isExpanded,
	onToggleExpand,
	lockState,
	onToggleLock,
}) => {
	const p = effect.params;
	const type = effect.type;

	const getLock = (param: string) => {
		return lockState.masterEffects[effect.id]?.[effect.type]?.[param] === true;
	};

	const toggleLock = (param: string) => {
		onToggleLock(`masterEffects.${effect.id}.${effect.type}.${param}`);
	};

	const moduleStyle: React.CSSProperties = {
		boxShadow: isDragging ? "0 5px 15px rgba(0,0,0,0.5)" : "none",
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
					<DragHandleIcon />
					<AccordionIcon isExpanded={isExpanded} />
					<h3>{type.charAt(0).toUpperCase() + type.slice(1)}</h3>
				</div>
				<div
					className="effect-header-buttons"
					onClick={(e) => e.stopPropagation()}
				>
					<button
						className={`small ${effect.enabled ? "active" : ""}`}
						onClick={() => onToggle(effect.id)}
					>
						{effect.enabled ? "On" : "Off"}
					</button>
					<button
						className="small remove-effect-btn"
						onClick={() => onRemove(effect.id)}
					>
						X
					</button>
				</div>
			</div>
			{isExpanded && (
				<div className="effect-controls">
					<div className="control-row">
						<label>Randomize</label>
						<div className="randomizer-buttons-group">
							<button
								className="icon-button init-button"
								onClick={() => onInitialize(effect.id)}
								title="Initialize"
							>
								<InitializeIcon />
							</button>
							<button
								className="icon-button"
								onClick={() => onRandomize("chaos", effect.id)}
								title="Chaos"
							>
								<ChaosIcon />
							</button>
							<button
								className="icon-button"
								onClick={() => onRandomize("melodic", effect.id)}
								title="Melodic"
							>
								<MelodicIcon />
							</button>
							<button
								className="icon-button"
								onClick={() => onRandomize("rhythmic", effect.id)}
								title="Rhythmic"
							>
								<RhythmicIcon />
							</button>
						</div>
					</div>
					{type === "distortion" && p.distortion && (
						<>
							<div className="control-row">
								<label>Mode</label>
								<div className="control-with-lock">
									<select
										value={p.distortion.mode}
										onChange={(e) =>
											onUpdate(effect.id, {
												distortion: {
													...p.distortion!,
													mode: e.target.value as DistortionMode,
												},
											})
										}
									>
										{distortionModes.map((m) => (
											<option key={m} value={m}>
												{m}
											</option>
										))}
									</select>
									<LockIcon
										isLocked={getLock("mode")}
										onClick={() => toggleLock("mode")}
										title="Lock Mode"
									/>
								</div>
							</div>
							<div className="control-row">
								<label>Amount</label>
								<div className="control-value-wrapper control-with-lock">
									<input
										type="range"
										min="0"
										max="1"
										step="0.01"
										value={p.distortion.amount}
										onChange={(e) =>
											onUpdate(effect.id, {
												distortion: {
													...p.distortion!,
													amount: parseFloat(e.target.value),
												},
											})
										}
									/>
									<span>{p.distortion.amount.toFixed(2)}</span>
									<LockIcon
										isLocked={getLock("amount")}
										onClick={() => toggleLock("amount")}
										title="Lock Amount"
									/>
								</div>
							</div>
						</>
					)}
					{type === "delay" && p.delay && (
						<>
							<div className="control-row">
								<label>Time</label>
								<div className="control-value-wrapper control-with-lock">
									<input
										type="range"
										min="0.01"
										max="1.0"
										step="0.01"
										value={p.delay.time}
										onChange={(e) =>
											onUpdate(effect.id, {
												delay: { ...p.delay!, time: parseFloat(e.target.value) },
											})
										}
									/>
									<span>{p.delay.time.toFixed(2)}s</span>
									<LockIcon
										isLocked={getLock("time")}
										onClick={() => toggleLock("time")}
										title="Lock Time"
									/>
								</div>
							</div>
							<div className="control-row">
								<label>Feedback</label>
								<div className="control-value-wrapper control-with-lock">
									<input
										type="range"
										min="0"
										max="0.9"
										step="0.01"
										value={p.delay.feedback}
										onChange={(e) =>
											onUpdate(effect.id, {
												delay: {
													...p.delay!,
													feedback: parseFloat(e.target.value),
												},
											})
										}
									/>
									<span>{p.delay.feedback.toFixed(2)}</span>
									<LockIcon
										isLocked={getLock("feedback")}
										onClick={() => toggleLock("feedback")}
										title="Lock Feedback"
									/>
								</div>
							</div>
							<div className="control-row">
								<label>Mix</label>
								<div className="control-value-wrapper control-with-lock">
									<input
										type="range"
										min="0"
										max="1"
										step="0.01"
										value={p.delay.mix}
										onChange={(e) =>
											onUpdate(effect.id, {
												delay: { ...p.delay!, mix: parseFloat(e.target.value) },
											})
										}
									/>
									<span>{p.delay.mix.toFixed(2)}</span>
									<LockIcon
										isLocked={getLock("mix")}
										onClick={() => toggleLock("mix")}
										title="Lock Mix"
									/>
								</div>
							</div>
						</>
					)}
					{type === "reverb" && p.reverb && (
						<>
							<div className="control-row">
								<label>Decay</label>
								<div className="control-value-wrapper control-with-lock">
									<input
										type="range"
										min="0.1"
										max="10"
										step="0.1"
										value={p.reverb.decay}
										onChange={(e) =>
											onUpdate(effect.id, {
												reverb: {
													...p.reverb!,
													decay: parseFloat(e.target.value),
												},
											})
										}
									/>
									<span>{p.reverb.decay.toFixed(1)}s</span>
									<LockIcon
										isLocked={getLock("decay")}
										onClick={() => toggleLock("decay")}
										title="Lock Decay"
									/>
								</div>
							</div>
							<div className="control-row">
								<label>Mix</label>
								<div className="control-value-wrapper control-with-lock">
									<input
										type="range"
										min="0"
										max="1"
										step="0.01"
										value={p.reverb.mix}
										onChange={(e) =>
											onUpdate(effect.id, {
												reverb: { ...p.reverb!, mix: parseFloat(e.target.value) },
											})
										}
									/>
									<span>{p.reverb.mix.toFixed(2)}</span>
									<LockIcon
										isLocked={getLock("mix")}
										onClick={() => toggleLock("mix")}
										title="Lock Mix"
									/>
								</div>
							</div>
						</>
					)}
					{type === "chorus" && p.chorus && (
						<>
							<div className="control-row">
								<label>Rate</label>
								<div className="control-value-wrapper control-with-lock">
									<input
										type="range"
										min="0.1"
										max="10"
										step="0.1"
										value={p.chorus.rate}
										onChange={(e) =>
											onUpdate(effect.id, {
												chorus: {
													...p.chorus!,
													rate: parseFloat(e.target.value),
												},
											})
										}
									/>
									<span>{p.chorus.rate.toFixed(1)} Hz</span>
									<LockIcon
										isLocked={getLock("rate")}
										onClick={() => toggleLock("rate")}
										title="Lock Rate"
									/>
								</div>
							</div>
							<div className="control-row">
								<label>Depth</label>
								<div className="control-value-wrapper control-with-lock">
									<input
										type="range"
										min="0"
										max="1"
										step="0.01"
										value={p.chorus.depth}
										onChange={(e) =>
											onUpdate(effect.id, {
												chorus: {
													...p.chorus!,
													depth: parseFloat(e.target.value),
												},
											})
										}
									/>
									<span>{p.chorus.depth.toFixed(2)}</span>
									<LockIcon
										isLocked={getLock("depth")}
										onClick={() => toggleLock("depth")}
										title="Lock Depth"
									/>
								</div>
							</div>
							<div className="control-row">
								<label>Mix</label>
								<div className="control-value-wrapper control-with-lock">
									<input
										type="range"
										min="0"
										max="1"
										step="0.01"
										value={p.chorus.mix}
										onChange={(e) =>
											onUpdate(effect.id, {
												chorus: { ...p.chorus!, mix: parseFloat(e.target.value) },
											})
										}
									/>
									<span>{p.chorus.mix.toFixed(2)}</span>
									<LockIcon
										isLocked={getLock("mix")}
										onClick={() => toggleLock("mix")}
										title="Lock Mix"
									/>
								</div>
							</div>
						</>
					)}
					{type === "flanger" && p.flanger && (
						<>
							<div className="control-row">
								<label>Rate</label>
								<div className="control-value-wrapper control-with-lock">
									<input
										type="range"
										min="0.1"
										max="5"
										step="0.1"
										value={p.flanger.rate}
										onChange={(e) =>
											onUpdate(effect.id, {
												flanger: {
													...p.flanger!,
													rate: parseFloat(e.target.value),
												},
											})
										}
									/>
									<span>{p.flanger.rate.toFixed(1)} Hz</span>
									<LockIcon
										isLocked={getLock("rate")}
										onClick={() => toggleLock("rate")}
										title="Lock Rate"
									/>
								</div>
							</div>
							<div className="control-row">
								<label>Depth</label>
								<div className="control-value-wrapper control-with-lock">
									<input
										type="range"
										min="0"
										max="1"
										step="0.01"
										value={p.flanger.depth}
										onChange={(e) =>
											onUpdate(effect.id, {
												flanger: {
													...p.flanger!,
													depth: parseFloat(e.target.value),
												},
											})
										}
									/>
									<span>{p.flanger.depth.toFixed(2)}</span>
									<LockIcon
										isLocked={getLock("depth")}
										onClick={() => toggleLock("depth")}
										title="Lock Depth"
									/>
								</div>
							</div>
							<div className="control-row">
								<label>Feedback</label>
								<div className="control-value-wrapper control-with-lock">
									<input
										type="range"
										min="0"
										max="0.9"
										step="0.01"
										value={p.flanger.feedback}
										onChange={(e) =>
											onUpdate(effect.id, {
												flanger: {
													...p.flanger!,
													feedback: parseFloat(e.target.value),
												},
											})
										}
									/>
									<span>{p.flanger.feedback.toFixed(2)}</span>
									<LockIcon
										isLocked={getLock("feedback")}
										onClick={() => toggleLock("feedback")}
										title="Lock Feedback"
									/>
								</div>
							</div>
							<div className="control-row">
								<label>Mix</label>
								<div className="control-value-wrapper control-with-lock">
									<input
										type="range"
										min="0"
										max="1"
										step="0.01"
										value={p.flanger.mix}
										onChange={(e) =>
											onUpdate(effect.id, {
												flanger: {
													...p.flanger!,
													mix: parseFloat(e.target.value),
												},
											})
										}
									/>
									<span>{p.flanger.mix.toFixed(2)}</span>
									<LockIcon
										isLocked={getLock("mix")}
										onClick={() => toggleLock("mix")}
										title="Lock Mix"
									/>
								</div>
							</div>
						</>
					)}
					{type === "phaser" && p.phaser && (
						<>
							<div className="control-row">
								<label>Rate</label>
								<div className="control-value-wrapper control-with-lock">
									<input
										type="range"
										min="0.1"
										max="10"
										step="0.1"
										value={p.phaser.rate}
										onChange={(e) =>
											onUpdate(effect.id, {
												phaser: {
													...p.phaser!,
													rate: parseFloat(e.target.value),
												},
											})
										}
									/>
									<span>{p.phaser.rate.toFixed(1)} Hz</span>
									<LockIcon
										isLocked={getLock("rate")}
										onClick={() => toggleLock("rate")}
										title="Lock Rate"
									/>
								</div>
							</div>
							<div className="control-row">
								<label>Stages</label>
								<div className="control-with-lock">
									<select
										value={p.phaser.stages}
										onChange={(e) =>
											onUpdate(effect.id, {
												phaser: {
													...p.phaser!,
													stages: parseInt(e.target.value),
												},
											})
										}
									>
										{[2, 4, 6, 8, 10, 12].map((s) => (
											<option key={s} value={s}>
												{s}
											</option>
										))}
									</select>
									<LockIcon
										isLocked={getLock("stages")}
										onClick={() => toggleLock("stages")}
										title="Lock Stages"
									/>
								</div>
							</div>
							<div className="control-row">
								<label>Q</label>
								<div className="control-value-wrapper control-with-lock">
									<input
										type="range"
										min="1"
										max="20"
										step="0.1"
										value={p.phaser.q}
										onChange={(e) =>
											onUpdate(effect.id, {
												phaser: { ...p.phaser!, q: parseFloat(e.target.value) },
											})
										}
									/>
									<span>{p.phaser.q.toFixed(1)}</span>
									<LockIcon
										isLocked={getLock("q")}
										onClick={() => toggleLock("q")}
										title="Lock Q"
									/>
								</div>
							</div>
							<div className="control-row">
								<label>Mix</label>
								<div className="control-value-wrapper control-with-lock">
									<input
										type="range"
										min="0"
										max="1"
										step="0.01"
										value={p.phaser.mix}
										onChange={(e) =>
											onUpdate(effect.id, {
												phaser: { ...p.phaser!, mix: parseFloat(e.target.value) },
											})
										}
									/>
									<span>{p.phaser.mix.toFixed(2)}</span>
									<LockIcon
										isLocked={getLock("mix")}
										onClick={() => toggleLock("mix")}
										title="Lock Mix"
									/>
								</div>
							</div>
						</>
					)}
					{type === "tremolo" && p.tremolo && (
						<>
							<div className="control-row">
								<label>Rate</label>
								<div className="control-value-wrapper control-with-lock">
									<input
										type="range"
										min="0.1"
										max="20"
										step="0.1"
										value={p.tremolo.rate}
										onChange={(e) =>
											onUpdate(effect.id, {
												tremolo: {
													...p.tremolo!,
													rate: parseFloat(e.target.value),
												},
											})
										}
									/>
									<span>{p.tremolo.rate.toFixed(1)} Hz</span>
									<LockIcon
										isLocked={getLock("rate")}
										onClick={() => toggleLock("rate")}
										title="Lock Rate"
									/>
								</div>
							</div>
							<div className="control-row">
								<label>Depth</label>
								<div className="control-value-wrapper control-with-lock">
									<input
										type="range"
										min="0"
										max="1"
										step="0.01"
										value={p.tremolo.depth}
										onChange={(e) =>
											onUpdate(effect.id, {
												tremolo: {
													...p.tremolo!,
													depth: parseFloat(e.target.value),
												},
											})
										}
									/>
									<span>{p.tremolo.depth.toFixed(2)}</span>
									<LockIcon
										isLocked={getLock("depth")}
										onClick={() => toggleLock("depth")}
										title="Lock Depth"
									/>
								</div>
							</div>
							<div className="control-row">
								<label>Shape</label>
								<div className="control-with-lock">
									<select
										value={p.tremolo.shape}
										onChange={(e) =>
											onUpdate(effect.id, {
												tremolo: {
													...p.tremolo!,
													shape: e.target.value as LFO_Shape,
												},
											})
										}
									>
										{lfoShapes.map((s) => (
											<option key={s} value={s}>
												{s}
											</option>
										))}
									</select>
									<LockIcon
										isLocked={getLock("shape")}
										onClick={() => toggleLock("shape")}
										title="Lock Shape"
									/>
								</div>
							</div>
							<div className="control-row">
								<label>Mix</label>
								<div className="control-value-wrapper control-with-lock">
									<input
										type="range"
										min="0"
										max="1"
										step="0.01"
										value={p.tremolo.mix}
										onChange={(e) =>
											onUpdate(effect.id, {
												tremolo: {
													...p.tremolo!,
													mix: parseFloat(e.target.value),
												},
											})
										}
									/>
									<span>{p.tremolo.mix.toFixed(2)}</span>
									<LockIcon
										isLocked={getLock("mix")}
										onClick={() => toggleLock("mix")}
										title="Lock Mix"
									/>
								</div>
							</div>
						</>
					)}
					{type === "eq" && p.eq && (
						<div className="eq-container">
							{p.eq.bands.map((gain, i) => (
								<div key={i} className="eq-band">
									<label>
										{eqFrequencies[i] < 1000
											? eqFrequencies[i]
											: `${eqFrequencies[i] / 1000}k`}
									</label>
									<input
										type="range"
										min="-12"
										max="12"
										step="0.1"
										value={gain}
										onChange={(e) => {
											const newBands = [...p.eq!.bands];
											newBands[i] = parseFloat(e.target.value);
											onUpdate(effect.id, { eq: { bands: newBands } });
										}}
									/>
								</div>
							))}
						</div>
					)}
				</div>
			)}
		</div>
	);
};

const MasterEffects: React.FC<MasterEffectsProps> = ({
	effects,
	setEffects,
	onRandomize,
	onInitialize,
	lockState,
	onToggleLock,
}) => {
	const [draggedEffect, setDraggedEffect] = useState<MasterEffect | null>(null);
	const [expandedEffects, setExpandedEffects] = useState<string[]>([]);
	const [dropIndex, setDropIndex] = useState<number | null>(null);

	const handleToggleExpand = (id: string) => {
		setExpandedEffects((prev) =>
			prev.includes(id) ? prev.filter((eId) => eId !== id) : [...prev, id]
		);
	};

	const handleAddEffect = (type: MasterEffectType) => {
		const newEffect: MasterEffect = {
			id: self.crypto.randomUUID(),
			type,
			enabled: true,
			params: getDefaultEffectParams(type),
		};
		setEffects((prev) => [...prev, newEffect]);
		setExpandedEffects((prev) => [...prev, newEffect.id]); // Auto-expand new effects
	};
	const handleRemoveEffect = (id: string) =>
		setEffects((prev) => prev.filter((e) => e.id !== id));
	const handleToggleEffect = (id: string) =>
		setEffects((prev) =>
			prev.map((e) => (e.id === id ? { ...e, enabled: !e.enabled } : e))
		);
	const handleUpdateEffect = (id: string, params: MasterEffect["params"]) => {
		setEffects((prev) => prev.map((e) => (e.id === id ? { ...e, params } : e)));
	};

	const handleDragStart = (
		e: React.DragEvent<HTMLDivElement>,
		effect: MasterEffect
	) => {
		setDraggedEffect(effect);
	};

	const handleDragOver = (
		e: React.DragEvent<HTMLDivElement>,
		hoverEffect: MasterEffect
	) => {
		e.preventDefault();
		if (!draggedEffect || draggedEffect.id === hoverEffect.id) return;

		const hoverIndex = effects.findIndex((e) => e.id === hoverEffect.id);

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
			const fromIndex = items.findIndex((e) => (e as MasterEffect).id === (draggedEffect as MasterEffect).id);
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
					<select
						onChange={(e) => {
							handleAddEffect(e.target.value as MasterEffectType);
							e.target.value = "";
						}}
						value=""
					>
						<option value="" disabled>
							Add Effect...
						</option>
						{availableMasterEffects.map((type) => (
							<option key={type} value={type}>
								{type.charAt(0).toUpperCase() + type.slice(1)}
							</option>
						))}
					</select>
				</div>
			</div>
			<div
				className="effects-chain"
				onDragEnd={handleDragEnd}
			>
				{effects.length === 0 ? (
					<div className="effects-chain-empty">
						Effect chain is empty. Add an effect to start.
					</div>
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

const RoutingMatrix: React.FC<RoutingMatrixProps> = ({
	lfoStates,
	onLfoUpdate,
	engineStates,
	onEngineUpdate,
}) => {
	const destinations = [
		{ label: "Filter 1 Cutoff", key: "filter1Cutoff" },
		{ label: "Filter 1 Res", key: "filter1Resonance" },
		{ label: "Filter 2 Cutoff", key: "filter2Cutoff" },
		{ label: "Filter 2 Res", key: "filter2Resonance" },
		...engineStates.flatMap((engine) => [
			{
				label: `${engine.name} Volume`,
				key: `engine${engine.id.slice(-1)}Vol`,
			},
			{
				label: `${engine.name} Synth Freq`,
				key: `engine${engine.id.slice(-1)}SynthFreq`,
			},
			{
				label: `${engine.name} Sampler/Grain Pitch`,
				key: `engine${engine.id.slice(-1)}SamplerTranspose`,
			},
			{
				label: `${engine.name} Grain Size`,
				key: `engine${engine.id.slice(-1)}GrainSize`,
			},
			{
				label: `${engine.name} Grain Density`,
				key: `engine${engine.id.slice(-1)}GrainDensity`,
			},
			{
				label: `${engine.name} Grain Position`,
				key: `engine${engine.id.slice(-1)}GrainPosition`,
			},
			{
				label: `${engine.name} Grain Jitter`,
				key: `engine${engine.id.slice(-1)}GrainJitter`,
			},
			{
				label: `${engine.name} Rate`,
				key: `engine${engine.id.slice(-1)}Rate`,
			},
		]),
		{ label: "LFO 1 Rate", key: "lfo1Rate" },
		{ label: "LFO 2 Rate", key: "lfo2Rate" },
		{ label: "LFO 3 Rate", key: "lfo3Rate" },
	];

	const handleLfoCheckboxChange = (
		lfoId: string,
		destKey: keyof LFORoutingState,
		isChecked: boolean
	) => {
		const lfo = lfoStates.find((l) => l.id === lfoId);
		if (lfo) {
			onLfoUpdate(lfoId, { routing: { ...lfo.routing, [destKey]: isChecked } });
		}
	};

	const handleSequencerCheckboxChange = (
		engineId: string,
		destKey: keyof LFORoutingState,
		isChecked: boolean
	) => {
		const engine = engineStates.find((e) => e.id === engineId);
		if (engine) {
			onEngineUpdate(engineId, {
				routing: { ...engine.routing, [destKey]: isChecked },
			});
		}
	};

	return (
		<table className="routing-matrix">
			<thead>
				<tr>
					<th>Destination</th>
					{lfoStates.map((lfo) => (
						<th key={lfo.id} className="rotated-header">
							<div>{lfo.name}</div>
						</th>
					))}
					{engineStates.map((engine) => (
						<th key={engine.id} className="rotated-header">
							<div>SEQ {engine.id.slice(-1)}</div>
						</th>
					))}
				</tr>
			</thead>
			<tbody>
				{destinations.map((dest) => (
					<tr key={dest.key}>
						<td>{dest.label}</td>
						{lfoStates.map((lfo) => (
							<td key={`${lfo.id}-${dest.key}`}>
								<input
									type="checkbox"
									checked={lfo.routing[dest.key as keyof LFORoutingState]}
									onChange={(e) =>
										handleLfoCheckboxChange(
											lfo.id,
											dest.key as keyof LFORoutingState,
											e.target.checked
										)
									}
								/>
							</td>
						))}
						{engineStates.map((engine) => (
							<td key={`${engine.id}-${dest.key}`}>
								<input
									type="checkbox"
									checked={engine.routing[dest.key as keyof LFORoutingState]}
									onChange={(e) =>
										handleSequencerCheckboxChange(
											engine.id,
											dest.key as keyof LFORoutingState,
											e.target.checked
										)
									}
								/>
							</td>
						))}
					</tr>
				))}
			</tbody>
		</table>
	);
};

const BottomTabs: React.FC<BottomTabsProps> = ({
	lfoStates,
	handleLfoUpdate,
	engineStates,
	handleEngineUpdate,
	onRandomize,
	onInitialize,
	bpm,
	lockState,
	onToggleLock,
	onEditLfo,
}) => {
	const [activeTab, setActiveTab] = useState<"lfos" | "routing">("lfos");

	return (
		<div className="bottom-module-container">
			<div className="bottom-module-header">
				<div className="bottom-tab-nav">
					<button
						className={`bottom-tab-button ${
							activeTab === "lfos" ? "active" : ""
						}`}
						onClick={() => setActiveTab("lfos")}
					>
						LFOs
					</button>
					<button
						className={`bottom-tab-button ${
							activeTab === "routing" ? "active" : ""
						}`}
						onClick={() => setActiveTab("routing")}
					>
						Routing Matrix
					</button>
				</div>
				{activeTab === "routing" && (
					<div className="randomizer-buttons-group">
						<label>Randomize Routing</label>
						<button
							className="icon-button"
							onClick={() => onRandomize("chaos", "routing")}
							title="Chaos"
						>
							<ChaosIcon />
						</button>
						<button
							className="icon-button"
							onClick={() => onRandomize("melodic", "routing")}
							title="Melodic"
						>
							<MelodicIcon />
						</button>
						<button
							className="icon-button"
							onClick={() => onRandomize("rhythmic", "routing")}
							title="Rhythmic"
						>
							<RhythmicIcon />
						</button>
					</div>
				)}
			</div>

			{activeTab === "lfos" && (
				<div className="lfo-grid-container">
					{lfoStates.map((lfo) => (
						<LFOControls
							key={lfo.id}
							lfoState={lfo}
							onUpdate={(updates) => handleLfoUpdate(lfo.id, updates)}
							onRandomize={onRandomize}
							onInitialize={onInitialize}
							bpm={bpm}
							lockState={lockState}
							onToggleLock={onToggleLock}
							onEdit={onEditLfo}
						/>
					))}
				</div>
			)}
			{activeTab === "routing" && (
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
	const [linkLatency, setLinkLatency] = useState(0);
	
	// Refs
	const lastLocalStartRef = useRef<number>(0);
	const audioNodesRef = useRef<Map<string, EngineAudioNodes>>(new Map());
	const filterNodesRef = useRef<{
		filter1: FilterNodes;
		filter2: FilterNodes;
	} | null>(null);
	const masterVolumeNodeRef = useRef<GainNode | null>(null);
	const masterAnalyserNodeRef = useRef<AnalyserNode | null>(null);
	const masterBusRef = useRef<GainNode | null>(null);
	const lfoNodesRef = useRef<
		Map<
			string,
			{
				lfoNode: OscillatorNode;
				depthGain: GainNode;
				smoothingFilter: BiquadFilterNode;
				rateModGain: GainNode;
				fmSends: Map<string, GainNode>; // Map<targetLfoId, GainNode>
				cachedShape: PeriodicWave | null;
			}
		>
	>(new Map());
	const lfoRoutingBussesRef = useRef<LfoRoutingBusses | null>(null);
	const samplesRef = useRef<Map<string, AudioBuffer>>(new Map());
	const activeVoicesRef = useRef<Map<string, ActiveVoice>>(new Map());
	const activeMonoNotePerEngineRef = useRef<Map<string, {note: number, freq: number, noteId: string}>>(new Map());
	const lastPlayedNotePerEngineRef = useRef<Map<string, number>>(new Map());
	const heldNotesPerEngineRef = useRef<Map<string, string[]>>(new Map());
	const effectNodesRef = useRef<Map<string, MasterEffectNodes>>(new Map());
    const noiseBuffersRef = useRef<Map<NoiseType, AudioBuffer>>(new Map());
	const reverbImpulseCache = useRef<Map<string, AudioBuffer>>(new Map());
	const dummyGainRef = useRef<GainNode | null>(null);
	const sequencerModEventsRef = useRef<Map<string, {start: number, end: number, value?: number}[]>>(new Map());
	const historyStack = useRef<Preset["data"][]>([]);
	const futureStack = useRef<Preset["data"][]>([]);

	// --- State Management ---
	const initialAppState = useMemo(() => getInitialState(), []);
	const [engines, setEngines] = useState<EngineState[]>(
		initialAppState.engines
	);
	const [lfos, setLfos] = useState<LFOState[]>(initialAppState.lfos);
	const [filter1State, setFilter1State] = useState<FilterState>(
		initialAppState.filter1
	);
	const [filter2State, setFilter2State] = useState<FilterState>(
		initialAppState.filter2
	);
	const [filterRouting, setFilterRouting] = useState<FilterRouting>(
		initialAppState.filterRouting
	);
	const [masterEffects, setMasterEffects] = useState<MasterEffect[]>(
		initialAppState.masterEffects
	);
	// Fix: Declare bpm before it is used in latestStateRef to avoid block-scoped variable error.
	const [bpm, setBPM] = useState(120);
	const [voicingMode, setVoicingMode] = useState<VoicingMode>("poly");
	const [glideTime, setGlideTime] = useState(50); // ms
	const [isGlideSynced, setIsGlideSynced] = useState(false);
	const [glideSyncRateIndex, setGlideSyncRateIndex] = useState(3); // 1/8

	// Use a ref to get the latest state in audio callbacks



	const [masterVolume, setMasterVolume] = useState(0.7);
	const [clockSource, setClockSource] = useState<"internal" | "midi" | "link">("internal");
	const [linkPhase, setLinkPhase] = useState(0);
	const linkSocketRef = useRef<Socket | null>(null);

	const [isTransportPlaying, setIsTransportPlaying] = useState(false);
	const [sequencerCurrentSteps, setSequencerCurrentSteps] = useState<Map<string, number>>(new Map());
	const [harmonicTuningSystem, setHarmonicTuningSystem] =
		useState<TuningSystem>("440_ET");
	const [isMorphing, setIsMorphing] = useState(false);
	const [scale, setScale] = useState<ScaleName>("major");
	const [transpose, setTranspose] = useState(0);

	const [morphTime, setMorphTime] = useState(500); // ms
	const [isMorphSynced, setIsMorphSynced] = useState(false);
	const [morphSyncRateIndex, setMorphSyncRateIndex] = useState(3);

	// Keep latestStateRef in sync with state
	// Removed misplaced useEffect
	
	const morphTargetRef = useRef<any>(null);
	const morphStartRef = useRef<any>(null);
	const morphStartTimeRef = useRef<number | null>(null);
	const [midiInputs, setMidiInputs] = useState<MIDIInput[]>([]);
	const [selectedMidiInputId, setSelectedMidiInputId] = useState<string | null>(
		null
	);
	const [selectedMidiClockInputId, setSelectedMidiClockInputId] = useState<string | null>(null);
	const [midiActivity, setMidiActivity] = useState(false);
	const midiActivityTimeoutRef = useRef<number | null>(null);
	const [midiClockActivity, setMidiClockActivity] = useState(false);
	const midiClockActivityTimeoutRef = useRef<number | null>(null);
	const midiClockCounterRef = useRef(0);
	const isRandomizingRef = useRef(false);
	const [audioInputStream, setAudioInputStream] = useState<MediaStream | null>(
		null
	);
	const [editingMelodyEngineId, setEditingMelodyEngineId] = useState<string | null>(null);
	const [editingLfoId, setEditingLfoId] = useState<string | null>(null);

	const syncRates = useMemo(
		() => ["1/64", "1/32", "1/16", "1/8", "1/8d", "1/4", "1/4d", "1/2", "1/1", "2/1", "4/1"],
		[]
	);

	const [lockState, setLockState] = useState<LockState>(getInitialLockState());

	// Global Auto-Random State
	const [isGlobalAutoRandomEnabled, setIsGlobalAutoRandomEnabled] =
		useState(false);
	const [globalAutoRandomInterval, setGlobalAutoRandomInterval] =
		useState(5000); // 5 seconds
	const [globalAutoRandomMode, setGlobalAutoRandomMode] =
		useState<RandomizeMode>("chaos");
	const [isAutoRandomSynced, setIsAutoRandomSynced] = useState(false);
	const [autoRandomSyncRateIndex, setAutoRandomSyncRateIndex] = useState(3); // Default to 1/8

	// Use a ref to get the latest state in audio callbacks
	const latestStateRef = useRef({ 
		engines, 
		lfos, 
		filter1State, 
		filter2State, 
		filterRouting, 
		masterEffects, 
		bpm, 
		scale, 
		transpose, 
		voicingMode, 
		glideTime, 
		isGlideSynced, 
		glideSyncRateIndex, 
		isGlobalAutoRandomEnabled, 
		globalAutoRandomInterval, 
		globalAutoRandomMode, 
		isAutoRandomSynced, 
		autoRandomSyncRateIndex, 
		clockSource,
		morphTime, 
		isMorphSynced, 
		morphSyncRateIndex,
		linkLatency: 0,
	});

	useEffect(() => {
		latestStateRef.current = {
			engines,
			lfos,
			filter1State,
			filter2State,
			filterRouting,
			masterEffects,
			bpm,
			scale,
			transpose,
			voicingMode,
			glideTime,
			isGlideSynced,
			glideSyncRateIndex,
			isGlobalAutoRandomEnabled,
			globalAutoRandomInterval,
			globalAutoRandomMode,
			isAutoRandomSynced,
			autoRandomSyncRateIndex,
			clockSource,
			morphTime,
			isMorphSynced,
			morphSyncRateIndex,
			linkLatency,
		};
	}, [
		engines,
		lfos,
		filter1State,
		filter2State,
		filterRouting,
		masterEffects,
		bpm,
		scale,
		transpose,
		voicingMode,
		glideTime,
		isGlideSynced,
		glideSyncRateIndex,
		isGlobalAutoRandomEnabled,
		globalAutoRandomInterval,
		globalAutoRandomMode,
		isAutoRandomSynced,
		autoRandomSyncRateIndex,
		clockSource,
		morphTime,
		isMorphSynced,
		morphSyncRateIndex,
		linkLatency,
	]);

	const scaleFrequencies = useMemo(() => {
		if (harmonicTuningSystem === "none") return [];
		if (harmonicTuningSystem === "solfeggio")
			return solfeggioFrequenciesData.map((f) => ({
				value: f.value,
				label: f.label,
			}));
		if (harmonicTuningSystem === "wholesome_scale")
			return wholesomeScaleFrequencies.map((f) => ({
				value: f,
				label: frequencyToNoteName(f),
			}));
		if (harmonicTuningSystem === "maria_renold_I")
			return mariaRenoldFrequencies.map((f) => ({
				value: f,
				label: frequencyToNoteName(f),
			}));

		const notes: { value: number; label: string }[] = [];
		// Handle case-insensitivity for scale lookup
		// @ts-ignore - allow string indexing for fallback
		let scaleSteps = musicalScales[scale] || musicalScales[scale.toLowerCase()];
		if (!scaleSteps) {
			console.warn(`Invalid scale: ${scale}, falling back to chromatic`);
			scaleSteps = musicalScales["chromatic"];
		}
		const rootMidiNote = 60 + transpose; // C4 + transpose

		// Generate notes for a few octaves
		for (let octave = -2; octave <= 3; octave++) {
			for (const step of scaleSteps) {
				const midiNote = rootMidiNote + octave * 12 + step;
				if (midiNote >= 0 && midiNote <= 127) {
					const freq = midiNoteToFrequency(midiNote, harmonicTuningSystem);
					notes.push({ value: freq, label: frequencyToNoteName(freq) });
				}
			}
		}
		return notes;
	}, [harmonicTuningSystem, scale, transpose]);


	const allNotesOff = useCallback(() => {
		if (!audioContext) return;
		const now = audioContext.currentTime;
		
		// 1. Stop all active voices
		activeVoicesRef.current.forEach(voice => {
			try {
				voice.envelopeGain.gain.cancelScheduledValues(now);
				voice.envelopeGain.gain.setValueAtTime(voice.envelopeGain.gain.value, now);
				voice.envelopeGain.gain.linearRampToValueAtTime(0, now + 0.01);
				
				voice.sourceNodes.forEach(node => {
					try {
						node.stop(now + 0.1);
					} catch (e) { /* ignore */ }
				});
				
				setTimeout(() => {
					voice.envelopeGain.disconnect();
				}, 200);
			} catch (e) {
				console.error("Error stopping voice:", e);
			}
		});
		activeVoicesRef.current.clear();

		// 2. Clear sequencer modulation events
		sequencerModEventsRef.current.clear();
		
		// 3. Reset sequencer visual state
		setSequencerCurrentSteps(new Map());
		
		// 4. Reset engine scheduler states
		engineSchedulerStates.current.forEach((val) => {
			val.currentStep = 0;
			val.nextNoteTime = now;
		});

		// 5. Force disconnect all engine audio nodes as a failsafe
		audioNodesRef.current.forEach((nodes, engineId) => {
			try {
				// Cancel any scheduled values on volume gains AND set to 0
				nodes.synth.volumeGain.gain.cancelScheduledValues(now);
				nodes.synth.volumeGain.gain.setValueAtTime(0, now);
				
				nodes.noise.volumeGain.gain.cancelScheduledValues(now);
				nodes.noise.volumeGain.gain.setValueAtTime(0, now);
				
				nodes.sampler.volumeGain.gain.cancelScheduledValues(now);
				nodes.sampler.volumeGain.gain.setValueAtTime(0, now);
				
				// If we can track source nodes directly attached to the engine, stop them here too.
				// But we don't store them on the engine node structure, only in activeVoices.
				// So we rely on activeVoicesRef being accurate.
				
				// However, we can force the engine mixer to 0 temporarily to kill any sound
				nodes.engineMixer.gain.cancelScheduledValues(now);
				nodes.engineMixer.gain.setValueAtTime(0, now);
				// nodes.engineMixer.gain.linearRampToValueAtTime(1, now + 0.1); // REMOVED: Don't ramp back up immediately, wait for next note
				// Actually, we shouldn't mute the mixer because it might affect future notes.
				// But we can mute the individual layer volumes if they are stuck open?
				// No, those are controlled by envelopes.
				
				// Let's just ensure the sequencer gate is closed.
				nodes.sequencerModGate.gain.cancelScheduledValues(now);
				nodes.sequencerModGate.gain.setValueAtTime(0, now);
			} catch(e) {
				console.error(`Error cleaning up engine ${engineId}:`, e);
			}
		});

	}, [audioContext]);

	const saveToHistory = useCallback(() => {
		const currentState: Preset["data"] = {
			engines,
			lfos,
			filter1: filter1State,
			filter2: filter2State,
			filterRouting,
			masterEffects,
			bpm,
			scale,
			transpose,
			harmonicTuningSystem,
			voicingMode,
			glideTime,
			isGlideSynced,
			glideSyncRateIndex,
			isGlobalAutoRandomEnabled,
			globalAutoRandomInterval,
			globalAutoRandomMode,
			isAutoRandomSynced,
			autoRandomSyncRateIndex,
			morphTime,
			isMorphSynced,
			morphSyncRateIndex,
		};
		historyStack.current.push(JSON.parse(JSON.stringify(currentState)));
		if (historyStack.current.length > 50) {
			historyStack.current.shift();
		}
		futureStack.current = [];
	}, [
		engines, lfos, filter1State, filter2State, filterRouting, masterEffects,
		bpm, scale, transpose, harmonicTuningSystem, voicingMode, glideTime,
		isGlideSynced, glideSyncRateIndex, isGlobalAutoRandomEnabled,
		globalAutoRandomInterval, globalAutoRandomMode, isAutoRandomSynced,
		autoRandomSyncRateIndex, morphTime, isMorphSynced, morphSyncRateIndex
	]);

	const handleUndo = useCallback(() => {
		if (historyStack.current.length === 0) return;
		
		const currentState: Preset["data"] = {
			engines,
			lfos,
			filter1: filter1State,
			filter2: filter2State,
			filterRouting,
			masterEffects,
			bpm,
			scale,
			transpose,
			harmonicTuningSystem,
			voicingMode,
			glideTime,
			isGlideSynced,
			glideSyncRateIndex,
			isGlobalAutoRandomEnabled,
			globalAutoRandomInterval,
			globalAutoRandomMode,
			isAutoRandomSynced,
			autoRandomSyncRateIndex,
			morphTime,
			isMorphSynced,
			morphSyncRateIndex,
		};
		futureStack.current.push(JSON.parse(JSON.stringify(currentState)));

		const previousState = historyStack.current.pop();
		if (previousState) {
			setEngines(previousState.engines);
			setLfos(previousState.lfos);
			setFilter1State(previousState.filter1);
			setFilter2State(previousState.filter2);
			setFilterRouting(previousState.filterRouting);
			setMasterEffects(previousState.masterEffects);
			setBPM(previousState.bpm);
			setScale(previousState.scale);
			setTranspose(previousState.transpose);
			setHarmonicTuningSystem(previousState.harmonicTuningSystem);
			setVoicingMode(previousState.voicingMode);
			setGlideTime(previousState.glideTime);
			setIsGlideSynced(previousState.isGlideSynced);
			setGlideSyncRateIndex(previousState.glideSyncRateIndex);
			setIsGlobalAutoRandomEnabled(previousState.isGlobalAutoRandomEnabled);
			setGlobalAutoRandomInterval(previousState.globalAutoRandomInterval);
			setGlobalAutoRandomMode(previousState.globalAutoRandomMode);
			setIsAutoRandomSynced(previousState.isAutoRandomSynced);
			setAutoRandomSyncRateIndex(previousState.autoRandomSyncRateIndex);
			setMorphTime(previousState.morphTime);
			setIsMorphSynced(previousState.isMorphSynced);
			setMorphSyncRateIndex(previousState.morphSyncRateIndex);
		}
	}, [
		engines, lfos, filter1State, filter2State, filterRouting, masterEffects,
		bpm, scale, transpose, harmonicTuningSystem, voicingMode, glideTime,
		isGlideSynced, glideSyncRateIndex, isGlobalAutoRandomEnabled,
		globalAutoRandomInterval, globalAutoRandomMode, isAutoRandomSynced,
		autoRandomSyncRateIndex, morphTime, isMorphSynced, morphSyncRateIndex
	]);

	const handleRedo = useCallback(() => {
		if (futureStack.current.length === 0) return;

		const currentState: Preset["data"] = {
			engines,
			lfos,
			filter1: filter1State,
			filter2: filter2State,
			filterRouting,
			masterEffects,
			bpm,
			scale,
			transpose,
			harmonicTuningSystem,
			voicingMode,
			glideTime,
			isGlideSynced,
			glideSyncRateIndex,
			isGlobalAutoRandomEnabled,
			globalAutoRandomInterval,
			globalAutoRandomMode,
			isAutoRandomSynced,
			autoRandomSyncRateIndex,
			morphTime,
			isMorphSynced,
			morphSyncRateIndex,
		};
		historyStack.current.push(JSON.parse(JSON.stringify(currentState)));

		const nextState = futureStack.current.pop();
		if (nextState) {
			setEngines(nextState.engines);
			setLfos(nextState.lfos);
			setFilter1State(nextState.filter1);
			setFilter2State(nextState.filter2);
			setFilterRouting(nextState.filterRouting);
			setMasterEffects(nextState.masterEffects);
			setBPM(nextState.bpm);
			setScale(nextState.scale);
			setTranspose(nextState.transpose);
			setHarmonicTuningSystem(nextState.harmonicTuningSystem);
			setVoicingMode(nextState.voicingMode);
			setGlideTime(nextState.glideTime);
			setIsGlideSynced(nextState.isGlideSynced);
			setGlideSyncRateIndex(nextState.glideSyncRateIndex);
			setIsGlobalAutoRandomEnabled(nextState.isGlobalAutoRandomEnabled);
			setGlobalAutoRandomInterval(nextState.globalAutoRandomInterval);
			setGlobalAutoRandomMode(nextState.globalAutoRandomMode);
			setIsAutoRandomSynced(nextState.isAutoRandomSynced);
			setAutoRandomSyncRateIndex(nextState.autoRandomSyncRateIndex);
			setMorphTime(nextState.morphTime);
			setIsMorphSynced(nextState.isMorphSynced);
			setMorphSyncRateIndex(nextState.morphSyncRateIndex);
		}
	}, [
		engines, lfos, filter1State, filter2State, filterRouting, masterEffects,
		bpm, scale, transpose, harmonicTuningSystem, voicingMode, glideTime,
		isGlideSynced, glideSyncRateIndex, isGlobalAutoRandomEnabled,
		globalAutoRandomInterval, globalAutoRandomMode, isAutoRandomSynced,
		autoRandomSyncRateIndex, morphTime, isMorphSynced, morphSyncRateIndex
	]);

	const handleRandomize = useCallback(
		(mode: RandomizeMode, scope: string) => {
			saveToHistory();
			console.log(`handleRandomize called with mode: ${mode}, scope: ${scope}`);
			// Block MIDI and stop notes
			isRandomizingRef.current = true;
			allNotesOff();

			// Release lock after a short delay to allow state to settle
			setTimeout(() => {
				isRandomizingRef.current = false;
			}, 100);

			const randomizeRouting = () => {
				const newState = { ...DEFAULT_LFO_ROUTING_STATE };
				const keys = Object.keys(newState) as (keyof LFORoutingState)[];
				const numRoutings = getRandomInt(2, 8);
				for (let i = 0; i < numRoutings; i++) {
					newState[getRandomElement(keys)] = getRandomBool();
				}
				return newState;
			};

			if (scope === "routing") {
				setLfos((prev) =>
					prev.map((lfo) => ({ ...lfo, routing: randomizeRouting() }))
				);
				setEngines((prev) =>
					prev.map((engine) => ({ ...engine, routing: randomizeRouting() }))
				);
				return;
			}

			const createRandomizedState = () => {
				const newEngines = engines.map((engine): EngineState => {
					if (scope !== "global" && scope !== engine.id) return engine;

					const locks = lockState.engines[
						engine.id
					] as LockState["engines"]["engine1"];
					const synthLocks = locks.synth as { [key: string]: boolean };
					const noiseLocks = locks.noise as { [key: string]: boolean };
					const samplerLocks = locks.sampler as { [key: string]: boolean };
					const adsrLocks = locks.adsr as { [key: string]: boolean };

					const shouldChangeRhythm = mode === "rhythmic" || mode === "chaos";
					const shouldChangeMelody = mode === "melodic" || mode === "chaos";

					// --- Rhythmic params ---
					let newSteps = engine.sequencerSteps;
					if (shouldChangeRhythm && !locks.sequencerSteps) {
						newSteps = getRandomElement([8, 12, 16, 24, 32]);
					}
					let newPulses = engine.sequencerPulses;
					if (shouldChangeRhythm && !locks.sequencerPulses) {
						newPulses = getRandomInt(1, newSteps);
					}
					let newRotate = engine.sequencerRotate;
					if (shouldChangeRhythm && !locks.sequencerRotate) {
						newRotate = getRandomInt(0, newSteps - 1);
					}
					let newRate = engine.sequencerRate;
					if (shouldChangeRhythm && !locks.sequencerRate) {
						newRate = getRandomElement(sequencerRates);
					}

					// --- IMPORTANT: Regenerate sequence if rhythmic params changed ---
					const newSequence = rotatePattern(
						generateEuclideanPattern(newSteps, newPulses),
						newRotate
					);

					// --- Melodic & Timbre params ---
					let newMelodicSequence = [...engine.melodicSequence];
					if (newSteps !== engine.sequencerSteps) {
						// Resize if steps changed
						const oldSequence = newMelodicSequence;
						newMelodicSequence = Array.from({ length: newSteps }, (_, i) => {
							const oldVal = oldSequence[i % oldSequence.length];
							return Array.isArray(oldVal) ? oldVal : [];
						});
					}

					const newSynthState: Partial<SynthLayerState> = {};
					const newNoiseState: Partial<NoiseLayerState> = {};
					const newSamplerState: Partial<SamplerLayerState> = {};

					if (shouldChangeMelody) {
						let possibleNotes = scaleFrequencies.map((f) => f.value);
						
						// Filter by Octave Range
						if (harmonicTuningSystem !== "none" && possibleNotes.length > 0) {
							const baseOctave = engine.randomBaseOctave || 3;
							const range = engine.randomOctaveRange || 2;
							
							// Calculate min and max frequencies based on C(base) to B(base + range - 1)
							// C0 is approx 16.35Hz. C3 is approx 130.8Hz. C4 is 261.63Hz.
							// Formula: f = 440 * 2^((n-69)/12). C4 is 60.
							// C(octave) note number = (octave + 1) * 12
							
							const minNote = (baseOctave + 1) * 12;
							const maxNote = (baseOctave + 1 + range) * 12 - 1;
							
							const minFreq = 440 * Math.pow(2, (minNote - 69) / 12);
							const maxFreq = 440 * Math.pow(2, (maxNote - 69) / 12);
							
							possibleNotes = possibleNotes.filter(f => f >= minFreq && f <= maxFreq);
							
							// Fallback if filter removes all notes (shouldn't happen with correct logic but safety first)
							if (possibleNotes.length === 0) {
								possibleNotes = scaleFrequencies.map((f) => f.value);
							}
						}

						// console.log(`[Randomize] Mode: ${mode}, Tuning: ${harmonicTuningSystem}, Scale: ${scale}, PossibleNotes: ${possibleNotes.length}`);
						
						if (possibleNotes.length === 0) {
							if (harmonicTuningSystem === "none") {
								// Total chaos: random frequencies
								possibleNotes = Array(24)
									.fill(0)
									.map(() => getRandom(40, 2000));
							} else {
								// Fallback if no scale is active
								const rootFreq = midiNoteToFrequency(60 + transpose, "440_ET");
								const currentScaleRatios = musicalScales[scale].map((semitone) =>
									Math.pow(2, semitone / 12)
								);
								possibleNotes = Array(12)
									.fill(0)
									.map(() => getNoteFromScale(rootFreq, currentScaleRatios, 3));
							}
						}

						newMelodicSequence = newMelodicSequence.map(() =>
							[getRandomElement(possibleNotes)]
						);

						if (!synthLocks.frequency)
							newSynthState.frequency = getRandomElement(possibleNotes);
						if (!synthLocks.oscillatorType)
							newSynthState.oscillatorType = getRandomElement(oscillatorTypes);
						if (!synthLocks.volume) newSynthState.volume = getRandom(0.3, 0.8);
						if (!noiseLocks.noiseType)
							newNoiseState.noiseType = getRandomElement(noiseTypes);
						if (!noiseLocks.volume) newNoiseState.volume = getRandom(0.1, 0.5);
						if (!samplerLocks.transpose) newSamplerState.transpose = getRandomInt(-12, 12);
						if (!samplerLocks.grainSize) newSamplerState.grainSize = getRandom(0.01, 0.4);
						if (!samplerLocks.playbackPosition) newSamplerState.playbackPosition = getRandom(0, 1);
						if (!samplerLocks.positionJitter) newSamplerState.positionJitter = getRandom(0, 1);
					}

					if (shouldChangeRhythm) {
						if (!samplerLocks.grainDensity) newSamplerState.grainDensity = getRandomInt(5, 80);
					}

					// Chaos mode specific changes
					if (mode === "chaos") {
						if (!synthLocks.enabled) newSynthState.enabled = getRandomBool(0.8);
						if (!noiseLocks.enabled) newNoiseState.enabled = getRandomBool(0.3);
						if (!samplerLocks.enabled) newSamplerState.enabled = getRandomBool(0.3);
						if (!samplerLocks.enabled) newSamplerState.enabled = getRandomBool(0.3);
						if (!samplerLocks.granularModeEnabled) newSamplerState.granularModeEnabled = getRandomBool();
						
						// Randomize Routing
						if (!locks.filterDestination) {
							const destinations = ["filter1", "filter2", "direct"] as const;
							// Bias towards filter1 for general use
							const roll = Math.random();
							if (roll < 0.5) {
								(engine as any).filterDestination = "filter1";
							} else if (roll < 0.75) {
								(engine as any).filterDestination = "filter2";
							} else {
								(engine as any).filterDestination = "direct";
							}
						}
					}

					// --- ADSR ---
					const newAdsrState: Partial<ADSRState> = {};
					const setAdsr = (a: number[], d: number[], s: number[], r: number[]) => {
						if (!adsrLocks.attack) newAdsrState.attack = getRandom(a[0], a[1]);
						if (!adsrLocks.decay) newAdsrState.decay = getRandom(d[0], d[1]);
						if (!adsrLocks.sustain) newAdsrState.sustain = getRandom(s[0], s[1]);
						if (!adsrLocks.release) newAdsrState.release = getRandom(r[0], r[1]);
					};
					if (mode === "rhythmic")
						setAdsr([0.001, 0.1], [0.05, 0.3], [0.0, 0.5], [0.05, 0.4]);
					else if (mode === "melodic")
						setAdsr([0.1, 2.0], [0.2, 2.0], [0.4, 1.0], [0.2, 1.5]);
					else if (mode === "chaos")
						setAdsr([0.001, 3.0], [0.05, 3.0], [0.0, 1.0], [0.05, 2.0]);

					return {
						...engine,
						sequencerSteps: newSteps,
						sequencerPulses: newPulses,
						sequencerRotate: newRotate,
						sequencerRate: newRate,
						sequence: newSequence,
						synth: { ...engine.synth, ...newSynthState },
						noise: { ...engine.noise, ...newNoiseState },
						sampler: { ...engine.sampler, ...newSamplerState },
						adsr: { ...engine.adsr, ...newAdsrState },
						routing: (mode === "chaos" && scope === "global") ? randomizeRouting() : engine.routing,
						melodicSequence: newMelodicSequence,
					};
				});

				const newLfos = lfos.map((lfo): LFOState => {
					if (scope !== "global" && scope !== lfo.id) return lfo;
					const locks = lockState.lfos[lfo.id];
					const shouldChangeRhythm = mode === "rhythmic" || mode === "chaos";
					const shouldChangeMelody = mode === "melodic" || mode === "chaos";

					const newState: Partial<LFOState> = {};
					if (shouldChangeRhythm && !locks.rate) newState.rate = getRandom(0.1, 20);
					if (shouldChangeRhythm && !locks.sync) newState.sync = getRandomBool();
					if (shouldChangeRhythm && !locks.syncRate)
						newState.syncRate = getRandomElement(lfoSyncRates);
					if (shouldChangeMelody && !locks.depth)
						newState.depth = getRandom(0.1, 1.0);
					if (shouldChangeMelody && !locks.shape) {
						newState.shape = getRandomElement(lfoShapes);
						if (newState.shape === 'custom') {
							newState.customShape = Array.from({ length: 256 }, () => Math.random() * 2 - 1);
						}
					}
					if (mode === "chaos" && !locks.smoothing) newState.smoothing = getRandom(0, 1);
					if (mode === "chaos" && scope === "global") newState.routing = randomizeRouting();

					return { ...lfo, ...newState };
				});

				const shouldChangeMelodyGlobal = mode === "melodic" || mode === "chaos";

				const newFilter1 =
					(scope === "global" || scope === "filter1") && shouldChangeMelodyGlobal
						? {
								enabled: lockState.filter1.enabled
									? filter1State.enabled
									: true,
								type: lockState.filter1.type
									? filter1State.type
									: getRandomElement(filterTypes),
								cutoff: lockState.filter1.cutoff
									? filter1State.cutoff
									: getRandom(100, 10000),
								resonance: lockState.filter1.resonance
									? filter1State.resonance
									: getRandom(0, 20),
						  }
						: filter1State;

				const newFilter2 =
					(scope === "global" || scope === "filter2") && shouldChangeMelodyGlobal
						? {
								enabled: lockState.filter2.enabled
									? filter2State.enabled
									: getRandomBool(0.5),
								type: lockState.filter2.type
									? filter2State.type
									: getRandomElement(filterTypes),
								cutoff: lockState.filter2.cutoff
									? filter2State.cutoff
									: getRandom(100, 10000),
								resonance: lockState.filter2.resonance
									? filter2State.resonance
									: getRandom(0, 20),
						  }
						: filter2State;

				const newMasterEffects = masterEffects.map((effect) => {
					if (scope !== "global" && scope !== effect.id) {
						return effect;
					}
					// Don't add/remove effects, just morph params
					const newParams = createRandomizedEffectParams(effect, mode);
					
					// Merge with locks
					const currentEffectLocks = lockState.masterEffects[effect.id]?.[effect.type];
					if (!currentEffectLocks) return { ...effect, params: newParams };

					// If we have locks, we need to merge
					const type = effect.type;
					const mergedParams = { ...newParams };
					
					// We need to cast to any to iterate keys dynamically because of the union type
					const currentTypeParams = effect.params[type] as any;
					const newTypeParams = newParams[type] as any;
					const locks = currentEffectLocks as any;
					
					if (currentTypeParams && newTypeParams && locks) {
						const mergedTypeParams = { ...newTypeParams };
						Object.keys(newTypeParams).forEach(key => {
							if (locks[key] === true) {
								mergedTypeParams[key] = currentTypeParams[key];
							}
						});
						(mergedParams as any)[type] = mergedTypeParams;
					}

					return { ...effect, params: mergedParams };
				});


				return {
					engines: newEngines,
					lfos: newLfos,
					filter1State: newFilter1,
					filter2State: newFilter2,
					masterEffects: newMasterEffects,
				};
			};

			const randomState = createRandomizedState();

			console.log(`[Randomize] morphTime: ${morphTime}, isMorphSynced: ${isMorphSynced}`);

			// If morph time is very short, just set state immediately
			if (morphTime < 50) {
				console.log("[Randomize] Instant update");
				setEngines(randomState.engines);
				setLfos(randomState.lfos);
				setFilter1State(randomState.filter1State);
				setFilter2State(randomState.filter2State);
				setMasterEffects(randomState.masterEffects);
				return;
			}

			morphStartRef.current = {
				engines,
				filter1State,
				filter2State,
				lfos,
				masterEffects,
			};
			morphTargetRef.current = randomState;
			morphStartTimeRef.current = Date.now();
			setIsMorphing(true);
		},
		[
			engines,
			lfos,
			filter1State,
			filter2State,
			masterEffects,
			lockState,
			scale,
			transpose,
			scaleFrequencies,
			allNotesOff,
			morphTime, // Added missing dependency
			harmonicTuningSystem, // Added dependency
		]
	);

	// Auto-randomization effect
	useEffect(() => {
		let intervalId: ReturnType<typeof setInterval> | undefined;
		if (isGlobalAutoRandomEnabled && isTransportPlaying) {
			const effectiveInterval = calculateTimeFromSync(
				bpm,
				isAutoRandomSynced,
				autoRandomSyncRateIndex,
				syncRates,
				globalAutoRandomInterval
			);
			intervalId = setInterval(() => {
				handleRandomize(globalAutoRandomMode, "global");
			}, effectiveInterval);
		}
		return () => {
			if (intervalId) {
				clearInterval(intervalId);
			}
		};
	}, [
		isGlobalAutoRandomEnabled,
		isTransportPlaying,
		bpm,
		isAutoRandomSynced,
		autoRandomSyncRateIndex,
		syncRates,
		globalAutoRandomInterval,
		globalAutoRandomMode,
		handleRandomize,
	]);

	// Ref to track if transport change came from Link
	const isRemoteTransportUpdate = useRef(false);
	const hasAlignedToLinkRef = useRef(false);
	const linkStartBeatRef = useRef<number | null>(null);
	const shouldQuantizeStart = useRef(false);
	const isWaitingForLinkStart = useRef(false);
	const isRemoteBpmUpdate = useRef(false);

	// Ableton Link Integration
	useEffect(() => {
		if (clockSource === "link") {
			const socket = io("http://localhost:3001");
			linkSocketRef.current = socket;

			socket.on("connect", () => {
				console.log("Connected to Ableton Link server");
				socket.emit("request-sync");
			});

			socket.on("link-state", (state: { bpm: number; phase: number; beat: number; isPlaying: boolean }) => {
				isRemoteBpmUpdate.current = true;
				setBPM(state.bpm);
				if (state.isPlaying !== isTransportPlaying) {
					isRemoteTransportUpdate.current = true;
					setIsTransportPlaying(state.isPlaying);
				}
				setLinkPhase(state.phase / 4); 
			});

			socket.on("bpm-changed", (newBpm: number) => {
				isRemoteBpmUpdate.current = true;
				setBPM(newBpm);
			});

			socket.on("transport-changed", (isPlaying: boolean) => {
				if (isPlaying !== latestStateRef.current.isTransportPlaying) {
					isRemoteTransportUpdate.current = true;
					setIsTransportPlaying(isPlaying);
					
					if (isPlaying) {
						shouldQuantizeStart.current = true;
						isWaitingForLinkStart.current = true;
					} else {
						linkStartBeatRef.current = null; // Reset start beat
						isWaitingForLinkStart.current = false;
						shouldQuantizeStart.current = false;
					}
				}
			});

			socket.on("link-update", (state: { bpm: number; phase: number; beat: number; isPlaying: boolean }) => {
				// Update phase for visualization
				setLinkPhase((state.phase % 4) / 4); 
				
				// Sync BPM if changed externally
				if (Math.abs(state.bpm - latestStateRef.current.bpm) > 0.01) {
					isRemoteBpmUpdate.current = true;
					setBPM(state.bpm);
				}
				
				// Sync Transport if changed externally
				if (state.isPlaying !== latestStateRef.current.isTransportPlaying && !isRandomizingRef.current) {
					// Prevent race condition: If we just started locally, ignore remote "stop" for a short time
					const timeSinceLocalStart = Date.now() - (lastLocalStartRef.current || 0);
					if (latestStateRef.current.isTransportPlaying && !state.isPlaying && timeSinceLocalStart < 500) {
						console.log("[Link] Ignoring remote stop (race condition protection)");
					} else {
						isRemoteTransportUpdate.current = true;
						setIsTransportPlaying(state.isPlaying); 
					}
				}

				// Phase Alignment for Sequencer
				if (state.isPlaying && latestStateRef.current.clockSource === "link") {
					// Handle Start Quantization
					if (shouldQuantizeStart.current) {
						shouldQuantizeStart.current = false;
						const quantum = 4; // Assume 4/4 grid
						const currentBeat = state.beat;
						
						// If we are very close to the start of a bar (phase is small), start immediately at the current bar.
						// Otherwise, wait for the next bar.
						const phase = state.phase; // 0 to quantum
						if (phase < 0.1) {
							// Snap to current bar start
							linkStartBeatRef.current = currentBeat - phase;
						} else {
							// Wait for next bar
							linkStartBeatRef.current = Math.ceil((currentBeat + 0.01) / quantum) * quantum;
						}
						console.log(`[Link] Quantized Start Target: ${linkStartBeatRef.current} (Current: ${currentBeat.toFixed(2)}, Phase: ${phase.toFixed(2)})`);
					}

					// Check if we are waiting for the start beat
					if (linkStartBeatRef.current !== null && state.beat < linkStartBeatRef.current) {
						if (!isWaitingForLinkStart.current) {
							console.log(`[Link] Waiting... Current: ${state.beat.toFixed(2)}, Target: ${linkStartBeatRef.current}`);
							isWaitingForLinkStart.current = true;
						}
						return; // Wait
					}

					// If we were waiting and now we are not, reset the scheduler time
					if (isWaitingForLinkStart.current) {
						console.log(`[Link] Start beat reached! Resuming scheduler.`);
						const now = audioContext?.currentTime || 0;
						engineSchedulerStates.current.forEach((sch) => {
							sch.nextNoteTime = now + 0.005; // Start immediately (5ms buffer)
						});
					}
					
					isWaitingForLinkStart.current = false;

					latestStateRef.current.engines.forEach(engine => {
						const sch = engineSchedulerStates.current.get(engine.id);
						if (sch) {
							// Calculate beats per step for this engine
							let beatsPerStep = 0.25; // Default 1/16
							const rateStr = engine.sequencerRate;
							
							if (rateStr.endsWith("d")) {
								// Dotted
								const baseDenom = parseInt(rateStr.replace("d", "").split("/")[1]);
								beatsPerStep = (4 / baseDenom) * 1.5;
							} else {
								const denom = parseInt(rateStr.split("/")[1]);
								beatsPerStep = 4 / denom;
							}

							// Calculate target step using Local Beat (relative to start)
							// We must project the Link beat to the time of the *next scheduled note* 
							// to compare accurately with the scheduler's current step (which is for that future time).
							const now = audioContext?.currentTime || 0;
							const timeDelta = sch.nextNoteTime - now;
							const beatsPerSecond = state.bpm / 60;
							
							// Apply manual latency offset (in seconds)
							// If we are late, we add latency to "advance" the Link time, forcing the sequencer to catch up.
							const latencySeconds = (latestStateRef.current.linkLatency || 0) / 1000;
							
							// If nextNoteTime is in the past (lag), timeDelta is negative.
							const projectedLinkBeat = state.beat + ((timeDelta + latencySeconds) * beatsPerSecond);

							// This ensures we always start at Step 0 when transport starts.
							const localBeat = projectedLinkBeat - (linkStartBeatRef.current || 0);
							const targetStep = Math.floor(Math.max(0, localBeat) / beatsPerStep) % engine.sequencerSteps;

							const current = sch.currentStep;
							const steps = engine.sequencerSteps;

							// Calculate drift in beats
							// currentStep corresponds to the BEGINNING of the step.
							// So expected beat is currentStep * beatsPerStep.
							const expectedBeat = current * beatsPerStep;
							
							// We compare localBeat (where Link says we are) with expectedBeat (where Sequencer is).
							// We need to handle the wrap-around of the sequencer steps.
							// But localBeat grows indefinitely.
							// So we should compare (localBeat % (steps * beatsPerStep)) with expectedBeat.
							
							const loopDurationBeats = steps * beatsPerStep;
							const localBeatInLoop = localBeat % loopDurationBeats;
							
							const beatDiff = Math.abs(localBeatInLoop - expectedBeat);
							// Handle wrap-around diff (e.g. at end of loop)
							const shortestDiff = Math.min(beatDiff, loopDurationBeats - beatDiff);
							
							// Sync if off by more than 0.1 beats (approx 12ms at 120bpm)
							// This is much tighter than the previous "1 step" (0.25 beats) threshold.
							const isSync = shortestDiff <= 0.1;
							
							// Only force sync if we are significantly off
							if (!isSync) {
								console.log(`[Link] Syncing ${engine.id}: Seq=${current} (Beat ${expectedBeat.toFixed(2)}) -> Link=${targetStep} (Beat ${localBeatInLoop.toFixed(2)}) Diff=${shortestDiff.toFixed(3)}`);
								sch.currentStep = targetStep;
								setSequencerCurrentSteps(prev => new Map(prev).set(engine.id, targetStep));
							}
						}
					});
				} else if (!state.isPlaying && latestStateRef.current.clockSource === "link") {
					// Reset Link state when stopped
					if (linkStartBeatRef.current !== null) {
						console.log("[Link] Remote stop detected. Resetting quantization state.");
						linkStartBeatRef.current = null;
						isWaitingForLinkStart.current = false;
						shouldQuantizeStart.current = false;
					}
				}
			});

			return () => {
				socket.disconnect();
				linkSocketRef.current = null;
			};
		}
	}, [clockSource]);

	// Emit Transport Changes to Link
	useEffect(() => {
		if (clockSource === "link" && linkSocketRef.current) {
			if (isRemoteTransportUpdate.current) {
				isRemoteTransportUpdate.current = false;
				return;
			}
			linkSocketRef.current.emit("start-stop", isTransportPlaying);
		}
	}, [isTransportPlaying, clockSource]);

	// Emit BPM Changes to Link
	useEffect(() => {
		if (clockSource === "link" && linkSocketRef.current) {
			if (isRemoteBpmUpdate.current) {
				isRemoteBpmUpdate.current = false;
				return;
			}
			linkSocketRef.current.emit("set-bpm", bpm);
		}
	}, [bpm, clockSource]);

	const handleToggleLock = useCallback((path: string) => {
		setLockState(prev => {
			const parts = path.split('.');
			const updateRecursively = (currentValue: any, pathParts: string[]): any => {
				if (!pathParts.length) {
					return currentValue;
				}
				const [currentKey, ...restKeys] = pathParts;
				
				if (restKeys.length === 0) {
					// Leaf node: Toggle boolean or initialize to true
					const val = currentValue?.[currentKey];
					return {
						...(currentValue || {}),
						[currentKey]: val === undefined ? true : !val,
					};
				}

				// Intermediate node: Traverse or create object
				const nextValue = currentValue?.[currentKey] || {};
				return {
					...(currentValue || {}),
					[currentKey]: updateRecursively(nextValue, restKeys),
				};
			};
			return updateRecursively(prev, parts);
		});
	}, []);
	
	const initializeAudio = useCallback(() => {
		if (isInitialized || !initialAppState) return;
		try {
			const context = new (window.AudioContext ||
				(window as any).webkitAudioContext)();
			const masterGain = context.createGain();
			const analyser = context.createAnalyser();
			// The final connection to destination is handled in the effects chain connection logic
			
			masterVolumeNodeRef.current = masterGain;
			masterAnalyserNodeRef.current = analyser;

			// Create a dummy gain to prevent LFOs from being garbage collected
			const dummyGain = context.createGain();
			dummyGain.gain.value = 0;
			dummyGain.connect(context.destination);
			dummyGainRef.current = dummyGain;


			// Create Filters
			const f1 = context.createBiquadFilter();
			const f2 = context.createBiquadFilter();
            const f1CutoffBus = context.createGain();
            const f1ResoBus = context.createGain();
            const f2CutoffBus = context.createGain();
            const f2ResoBus = context.createGain();
            f1CutoffBus.gain.value = 5000; // range for modulation
            f1ResoBus.gain.value = 15; // range for modulation
            f2CutoffBus.gain.value = 5000;
            f2ResoBus.gain.value = 15;
            f1CutoffBus.connect(f1.frequency);
            f1ResoBus.connect(f1.Q);
            f2CutoffBus.connect(f2.frequency);
            f2ResoBus.connect(f2.Q);

			filterNodesRef.current = {
				filter1: { node: f1, cutoffModBus: f1CutoffBus, resonanceModBus: f1ResoBus },
				filter2: { node: f2, cutoffModBus: f2CutoffBus, resonanceModBus: f2ResoBus },
			};
            
			// Create LFOs and Busses
			const engineModBussesMap = new Map<string, EngineModBusses>();
            const lfoRoutingBusses: LfoRoutingBusses = {
                filter1: { cutoffModBus: f1CutoffBus, resonanceModBus: f1ResoBus },
                filter2: { cutoffModBus: f2CutoffBus, resonanceModBus: f2ResoBus },
                engineModBusses: engineModBussesMap,
            };
            lfoRoutingBussesRef.current = lfoRoutingBusses;

			// Create engine nodes
			initialAppState.engines.forEach((engine) => {
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

				engineNodes.sequencerModSource.offset.value = 1.0;
				engineNodes.sequencerModSource.connect(engineNodes.sequencerModGate);
				engineNodes.sequencerModSource.start();
				engineNodes.sequencerModGate.gain.value = 0; // Gated by sequencer
				
				engineNodes.synth.volumeGain.connect(engineNodes.engineMixer);
				engineNodes.noise.volumeGain.connect(engineNodes.engineMixer);
				engineNodes.sampler.volumeGain.connect(engineNodes.engineMixer);

				// Each engine's output goes to its own analyser, then to the final output gain
				engineNodes.engineMixer.connect(engineNodes.analyser);
				engineNodes.analyser.connect(engineNodes.finalOutput);
				
				audioNodesRef.current.set(engine.id, engineNodes);
                
                const modBusses: EngineModBusses = {
                    vol: context.createGain(),
                    synthFreq: context.createGain(),
                    samplerTranspose: context.createGain(),
                    grainSize: context.createGain(),
                    grainDensity: context.createGain(),
                    grainPosition: context.createGain(),
                    grainJitter: context.createGain(),
                };
				// Scale modulation busses for audible range
				modBusses.synthFreq.gain.value = 1000; 
				modBusses.grainDensity.gain.value = 50;

                modBusses.vol.connect(engineNodes.finalOutput.gain);
                // The other busses will be connected to specific AudioParams as needed
                engineModBussesMap.set(engine.id, modBusses);
			});

            // Create LFO nodes
			// FIX: Explicitly type `lfo` as `LFOState` to resolve type inference issue.
            initialAppState.lfos.forEach((lfo: LFOState) => {
                const lfoNode = context.createOscillator();
                const depthGain = context.createGain(); // Define depthGain here
                const rateModGain = context.createGain(); // For FM
                
                // Create Smoothing Filter
                const smoothingFilter = context.createBiquadFilter();
                smoothingFilter.type = "lowpass";
                smoothingFilter.frequency.value = 20000; // Default open
                
                lfoNode.connect(smoothingFilter);
                smoothingFilter.connect(depthGain);
                
                // Connect rate mod gain to frequency
                rateModGain.connect(lfoNode.frequency);
                
                // Create FM Sends (Matrix Mixer)
                // For each potential target LFO (including self if we want feedback, but let's stick to others for now? No, matrix allows all)
                const fmSends = new Map<string, GainNode>();
                initialAppState.lfos.forEach(targetLfo => {
                    const sendGain = context.createGain();
                    sendGain.gain.value = 0; // Default off
                    depthGain.connect(sendGain);
                    fmSends.set(targetLfo.id, sendGain);
                });

                lfoNode.start();
                lfoNodesRef.current.set(lfo.id, { lfoNode, depthGain, smoothingFilter, rateModGain, fmSends, cachedShape: null });
            });

            // Second pass: Connect FM Sends to Targets
            initialAppState.lfos.forEach(sourceLfo => {
                const sourceNodes = lfoNodesRef.current.get(sourceLfo.id);
                if (!sourceNodes) return;
                
                sourceNodes.fmSends.forEach((sendGain, targetId) => {
                    const targetNodes = lfoNodesRef.current.get(targetId);
                    if (targetNodes) {
                        sendGain.connect(targetNodes.rateModGain);
                    }
                });
            });


			// Create Noise Buffers
			noiseTypes.forEach(type => {
				const bufferSize = context.sampleRate * 2; // 2 seconds of noise
				const buffer = context.createBuffer(1, bufferSize, context.sampleRate);
				const output = buffer.getChannelData(0);
				let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
				for (let i = 0; i < bufferSize; i++) {
					switch(type) {
						case 'white':
							output[i] = Math.random() * 2 - 1;
							break;
						case 'pink':
							const white = Math.random() * 2 - 1;
							b0 = 0.99886 * b0 + white * 0.0555179;
							b1 = 0.99332 * b1 + white * 0.0750759;
							b2 = 0.96900 * b2 + white * 0.1538520;
							b3 = 0.86650 * b3 + white * 0.3104856;
							b4 = 0.55000 * b4 + white * 0.5329522;
							b5 = -0.7616 * b5 - white * 0.0168980;
							output[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
							output[i] *= 0.11; 
							b6 = white * 0.115926;
							break;
						case 'brown':
							const lastOutput = i > 0 ? output[i-1] : 0.0;
							const brownWhite = Math.random() * 2 - 1;
							output[i] = (lastOutput + (0.02 * brownWhite)) / 1.02;
							break;
					}
				}
				noiseBuffersRef.current.set(type, buffer);
			});


			setAudioContext(context);
			context.resume();
			setIsInitialized(true);
		} catch (e) {
			console.error("Web Audio API is not supported in this browser", e);
			alert(
				"This synthesizer requires a modern browser with Web Audio API support."
			);
		}
	}, [isInitialized, initialAppState]);

    // Master Volume Update
    useEffect(() => {
        if (masterVolumeNodeRef.current && audioContext) {
            masterVolumeNodeRef.current.gain.setTargetAtTime(masterVolume, audioContext.currentTime, 0.01);
        }
    }, [masterVolume, audioContext]);
	


	const noteOff = useCallback((noteId: string, time: number, isStealing: boolean = false) => {
		if (!audioContext) return;
		
		// Handle Trill/Mono Logic
		// Only process stack logic if this is a genuine Note Off event (not stealing)
		if (!isStealing) {
			// Extract engineId and note from noteId (format: midi_engineId_channel_note)
			const parts = noteId.split('_');
			if (parts.length >= 4 && parts[0] === 'midi') {
				const engineId = parts[1];
				const note = parseInt(parts[3]);
				const { voicingMode } = latestStateRef.current;

				if (voicingMode !== 'poly') {
					const heldStack = heldNotesPerEngineRef.current.get(engineId);
					if (heldStack) {
						const index = heldStack.indexOf(noteId);
						if (index !== -1) {
							heldStack.splice(index, 1);
							
							// If we are in Trill mode and we just released the currently playing note,
							// we should go back to the previous note in the stack.
							if (voicingMode === 'trill' && heldStack.length > 0) {
								const activeMono = activeMonoNotePerEngineRef.current.get(engineId);
								
								// Only re-trigger if the released note was the one currently playing
								if (activeMono && activeMono.noteId === noteId) {
									const prevNoteId = heldStack[heldStack.length - 1];
									const prevParts = prevNoteId.split('_');
									if (prevParts.length >= 4) {
										const prevNote = parseInt(prevParts[3]);
										// Re-trigger previous note
										noteOn(engineId, prevNoteId, prevNote, time);
										return; // noteOn will handle the rest
									}
								}
							}
						}
					}
				}
			}
		}

		// If noteId is "all", kill everything
		if (noteId === "all") {
			allNotesOff();
			return;
		}

		const voice = activeVoicesRef.current.get(noteId);
		if (!voice) return;
		
		const engine = latestStateRef.current.engines.find(e => e.id === voice.engineId);
		if(!engine) return;

		if(voice.timeoutId) clearTimeout(voice.timeoutId);

		const { release } = engine.adsr;
		const { envelopeGain, sourceNodes } = voice;
		
		const now = audioContext.currentTime;
		const scheduledTime = time > now ? time : now;
		
		envelopeGain.gain.cancelScheduledValues(scheduledTime);
		envelopeGain.gain.setTargetAtTime(0.0001, scheduledTime, release / 5 + 0.001);

		const stopTime = scheduledTime + release * 5; 
		sourceNodes.forEach(node => {
            try {
                node.stop(stopTime)
            } catch (e) {
                // Ignore errors if node is already stopped
            }
        });
		
		const timeoutId = window.setTimeout(() => {
			envelopeGain.disconnect();
			// Fix: Only delete if the voice in the map is STILL this specific voice object.
			// This prevents deleting a NEW voice that might have reused the same ID (race condition).
			if (activeVoicesRef.current.get(noteId) === voice) {
				activeVoicesRef.current.delete(noteId);
			}
		}, (stopTime - audioContext.currentTime) * 1000 + 100);
        
        activeVoicesRef.current.set(noteId, {...voice, timeoutId});

	}, [audioContext]);
	
	const noteOn = useCallback((engineId: string, noteId: string, midiNote: number, time: number, explicitFrequency?: number) => {
		if (!audioContext) return;

		const now = audioContext.currentTime;
    	const scheduledTime = time > now ? time : now;
		
		const { engines, voicingMode, glideTime, isGlideSynced, glideSyncRateIndex, lfos, bpm, transpose } = latestStateRef.current;
		// console.log(`[NoteOn] Engine: ${engineId}, Note: ${midiNote}, Mode: ${voicingMode}`);
		const engine = engines.find(e => e.id === engineId);
		
		if (!engine) return;
		const engineNodes = audioNodesRef.current.get(engine.id);
		if (!engineNodes) return;

		// Check if voice already exists and stop it (stealing)
		if (activeVoicesRef.current.has(noteId)) {
			noteOff(noteId, now);
		}

		// Unmute engine mixer (in case it was muted by Panic)
		engineNodes.engineMixer.gain.cancelScheduledValues(now);
		engineNodes.engineMixer.gain.setValueAtTime(1, now);
	
		// --- Voicing and Glide Logic ---
		let startFrequency: number | undefined;
		// Use explicit frequency if provided (e.g. for Solfeggio), otherwise calculate from MIDI note + transpose
		const targetFrequency = explicitFrequency ?? midiNoteToFrequency(midiNote + transpose, harmonicTuningSystem);
		
		if (voicingMode !== 'poly') {
			// Track held notes for Trill mode
			if (!heldNotesPerEngineRef.current.has(engineId)) {
				heldNotesPerEngineRef.current.set(engineId, []);
			}
			const heldStack = heldNotesPerEngineRef.current.get(engineId)!;
			// Remove if already exists (re-press) to move to top
			const existingIndex = heldStack.indexOf(noteId);
			if (existingIndex !== -1) {
				heldStack.splice(existingIndex, 1);
			}
			heldStack.push(noteId);

			const activeMono = activeMonoNotePerEngineRef.current.get(engineId);
			// Update active mono note BEFORE stopping the old one to prevent recursion in Trill mode
			// But we need to capture the old one to stop it
			const prevActiveMono = activeMono;
			activeMonoNotePerEngineRef.current.set(engineId, { note: midiNote, freq: targetFrequency, noteId });

			if (prevActiveMono) {
				noteOff(prevActiveMono.noteId, scheduledTime, true);
			}

			const lastNote = lastPlayedNotePerEngineRef.current.get(engineId);
			if (lastNote && (voicingMode === 'legato' || voicingMode === 'trill') && activeVoicesRef.current.size > 0) {
				startFrequency = midiNoteToFrequency(lastNote, harmonicTuningSystem);
			}
		}
		lastPlayedNotePerEngineRef.current.set(engineId, midiNote);
	
		// Clean up any previous voice with the same ID
		noteOff(noteId, scheduledTime, true);
	
		const { attack, decay, sustain } = engine.adsr;
		const envelopeGain = audioContext.createGain();
		envelopeGain.connect(engineNodes.engineMixer);
		
		const sourceNodes: (AudioBufferSourceNode | OscillatorNode)[] = [];
		let newVoice: ActiveVoice = { noteId, engineId, sourceNodes, envelopeGain, note: midiNote }; // Save the midiNote
		
		// --- Layer Logic ---
		if (engine.synth.enabled && engine.synth.volume > 0) {
			const osc = audioContext.createOscillator();
			osc.type = engine.synth.oscillatorType;
			const modBus = lfoRoutingBussesRef.current?.engineModBusses.get(engineId)?.synthFreq;
			if (modBus) modBus.connect(osc.frequency);
	
			const glideTimeSec = calculateTimeFromSync(bpm, isGlideSynced, glideSyncRateIndex, syncRates, glideTime) / 1000;
	
			if (startFrequency && glideTimeSec > 0) {
				osc.frequency.setValueAtTime(startFrequency, scheduledTime);
				osc.frequency.linearRampToValueAtTime(targetFrequency, scheduledTime + glideTimeSec);
			} else {
				osc.frequency.setValueAtTime(targetFrequency, scheduledTime);
			}
	
			const synthGain = audioContext.createGain();
			synthGain.gain.value = engine.synth.volume;
			osc.connect(synthGain).connect(envelopeGain);
			osc.start(scheduledTime);
			sourceNodes.push(osc);
		}
	
		if (engine.noise.enabled && engine.noise.volume > 0 && noiseBuffersRef.current.has(engine.noise.noiseType)) {
			 const noiseSource = audioContext.createBufferSource();
			 noiseSource.buffer = noiseBuffersRef.current.get(engine.noise.noiseType)!;
			 noiseSource.loop = true;
			 const noiseGain = audioContext.createGain();
			 noiseGain.gain.value = engine.noise.volume;
			 noiseSource.connect(noiseGain).connect(envelopeGain);
			 noiseSource.start(scheduledTime);
			 sourceNodes.push(noiseSource);
		}
	
		if(engine.sampler.enabled && engine.sampler.volume > 0) {
			const hasSample = samplesRef.current.has(engine.id);
			const isLive = engine.sampler.liveInputEnabled;
			// console.log(`[NoteOn] Sampler check - Engine: ${engine.id}, HasSample: ${hasSample}, Live: ${isLive}, Granular: ${engine.sampler.granularModeEnabled}`);

			if (hasSample || isLive) {
				const samplerGain = audioContext.createGain();
				samplerGain.gain.value = engine.sampler.volume;
				samplerGain.connect(envelopeGain);
		
				if (engine.sampler.granularModeEnabled && !isLive && hasSample) {
					// console.log(`[NoteOn] Starting Granular Voice for ${engine.id}`);
					// Set up the voice for the central granular scheduler
					newVoice.granularModeEnabled = true;
					newVoice.nextGrainTime = scheduledTime;
				} else if (!engine.sampler.granularModeEnabled && hasSample) {
					// console.log(`[NoteOn] Starting Normal Sampler Voice for ${engine.id}`);
					 const sampleSource = audioContext.createBufferSource();
					 sampleSource.buffer = samplesRef.current.get(engine.id)!;
					 // Assuming original pitch of sample is C4 (MIDI note 60)
					 const playbackRate = Math.pow(2, (midiNote - 60 + engine.sampler.transpose) / 12);
					 sampleSource.playbackRate.setValueAtTime(playbackRate, scheduledTime);
					 sampleSource.connect(samplerGain);
					 sampleSource.start(scheduledTime);
					 sourceNodes.push(sampleSource);
				}
			} else {
				// console.warn(`[NoteOn] Sampler enabled but no sample/live input for ${engine.id}`);
			}
		}

		envelopeGain.gain.cancelScheduledValues(scheduledTime);
		envelopeGain.gain.setValueAtTime(0.0001, scheduledTime);
		envelopeGain.gain.linearRampToValueAtTime(1, scheduledTime + attack);
		envelopeGain.gain.setTargetAtTime(sustain, scheduledTime + attack, decay / 3 + 0.001); // decay to sustain level

		activeVoicesRef.current.set(noteId, newVoice);

	}, [audioContext, noteOff, harmonicTuningSystem, syncRates]);

    // High-Precision Web Audio Sequencer
	const advanceSequencer = useCallback((time: number) => {
		if (isRandomizingRef.current) return;

		latestStateRef.current.engines.forEach(engine => {
			// if (!engine.sequencerEnabled) return; // REMOVED: Allow running in background
			const engineSch = engineSchedulerStates.current.get(engine.id)!;
			const engineNodes = audioNodesRef.current.get(engine.id);
			if (!engineNodes) return;

			const currentStepForNote = engineSch.currentStep;
			
			// console.log(`[Seq] ${engine.id} Step: ${currentStepForNote} Rotate: ${engine.sequencerRotate}`);

			// The sequence is already rotated in the state (handleEngineUpdate rotates it).
			// So we just read directly from the current step.
			const stepIndexToRead = currentStepForNote % engine.sequencerSteps;
			
			if (engine.sequence[stepIndexToRead] === 1) {
				const noteIdBase = `seq_${engine.id}_${currentStepForNote}_${time}`;
				
				// Only trigger notes if sequencer is enabled
				if (engine.sequencerEnabled) {
					if (engine.useMelodicSequence) {
						const freqs = engine.melodicSequence[stepIndexToRead];
						if (Array.isArray(freqs)) {
							freqs.forEach((freq, i) => {
								const noteId = `${noteIdBase}_${i}`;
								const midiNote = frequencyToMidiNote(freq);
								noteOn(engine.id, noteId, midiNote, time, freq);
							});
						}
					} else {
						const freq = engine.synth.frequency;
						const midiNote = frequencyToMidiNote(freq);
						noteOn(engine.id, noteIdBase, midiNote, time, freq);
					}
				}
				
				const secondsPerStep = (60 / latestStateRef.current.bpm) / (parseInt(engine.sequencerRate.split('/')[1]) / 4);
				const noteDuration = secondsPerStep * 0.8; 
				const modGateDuration = secondsPerStep * 0.95;

				if (engine.sequencerEnabled) {
					if (!engine.useMelodicSequence) {
						noteOff(noteIdBase, time + noteDuration);
					} else {
						const freqs = engine.melodicSequence[stepIndexToRead];
						if (Array.isArray(freqs)) {
							freqs.forEach((_, i) => {
								noteOff(`${noteIdBase}_${i}`, time + noteDuration);
							});
						}
					}
				}

				// Calculate modulation value based on pitch if melodic
				let modValue = 1.0;
				if (engine.useMelodicSequence) {
					const freqs = engine.melodicSequence[stepIndexToRead];
					if (Array.isArray(freqs) && freqs.length > 0) {
						// Use the first note's pitch for modulation
						const midiNote = frequencyToMidiNote(freqs[0]);
						// Normalize MIDI note (0-127) to 0-1 range
						modValue = Math.max(0, Math.min(1, midiNote / 127));
					}
				}

				// Modulation events happen regardless of sequencerEnabled
				// Set the modulation source offset (value) for this step
				engineNodes.sequencerModSource.offset.setValueAtTime(modValue, time);
				
				// Open the gate
				engineNodes.sequencerModGate.gain.setValueAtTime(1.0, time);
				engineNodes.sequencerModGate.gain.setValueAtTime(0.0, time + modGateDuration);
				
				const modEvents = sequencerModEventsRef.current.get(engine.id) || [];
				modEvents.push({ start: time, end: time + modGateDuration, value: modValue });
				sequencerModEventsRef.current.set(engine.id, modEvents);
			}

			const now = audioContext?.currentTime || 0;
			setTimeout(() => {
				if (isTransportPlaying) {
					setSequencerCurrentSteps(prev => new Map(prev).set(engine.id, currentStepForNote));
				}
			}, Math.max(0, (time - now) * 1000));

			engineSch.currentStep = (engineSch.currentStep + 1) % engine.sequencerSteps;
			
			if (latestStateRef.current.clockSource === "internal" || latestStateRef.current.clockSource === "link") {
				let secondsPerStep = (60 / latestStateRef.current.bpm) / (parseInt(engine.sequencerRate.split('/')[1]) / 4);
				
				// Apply Rate Modulation from Mod Matrix
				let totalRateMod = 0;
				latestStateRef.current.lfos.forEach(lfo => {
					// Check routing
					// engine.id is "engine1", "engine2", etc.
					// routing key is "engine1Rate", etc.
					const routingKey = `${engine.id}Rate` as keyof LFORoutingState;
					if (lfo.routing[routingKey]) {
						// Calculate LFO value
						const time = audioContext?.currentTime || performance.now() / 1000;
						const rate = lfo.sync ? (latestStateRef.current.bpm / 60) * (4 / parseInt(lfo.syncRate.split('/')[1])) : lfo.rate;

						// Calculate phase based on time and rate
						const phaseRaw = (time * rate) % 1;
						const phase = phaseRaw < 0 ? 1 + phaseRaw : phaseRaw;
						
						let modValue = 0;
						switch (lfo.shape) {
							case "sine":
								modValue = Math.sin(phase * 2 * Math.PI);
								break;
							case "square":
								modValue = phase < 0.5 ? 1 : -1;
								break;
							case "rampDown":
								modValue = 1 - 2 * phase;
								break;
							case "rampUp":
								modValue = 2 * phase - 1;
								break;
							case "triangle":
								modValue = 2 * Math.abs(2 * (phase - Math.floor(phase + 0.5))) - 1;
								break;
							case "random":
								modValue = random1D(phase);
								break;
							case "noise":
								modValue = smoothNoise1D(phase) * 2 - 1;
								break;
							case "perlin":
								modValue = noise1D(phase);
								break;
							case "custom":
								if (lfo.customShape && lfo.customShape.length > 0) {
									const idx = Math.floor(phase * lfo.customShape.length);
									modValue = lfo.customShape[idx % lfo.customShape.length];
								}
								break;
							default:
								modValue = 0;
						}
						
						// Add to total modulation, scaled by LFO depth
						totalRateMod += modValue * lfo.depth;
						if (Math.random() < 0.01) {
							console.log(`[RateMod] LFO ${lfo.id} -> ${engine.id}: mod=${modValue.toFixed(2)} depth=${lfo.depth} total=${totalRateMod.toFixed(2)}`);
						}
					}
				});

				// Apply Engine Pitch Modulation from Mod Matrix
				latestStateRef.current.engines.forEach(sourceEngine => {
					const routingKey = `${engine.id}Rate` as keyof LFORoutingState;
					if (sourceEngine.routing[routingKey]) {
						// Get source engine's current step
						const sourceSch = engineSchedulerStates.current.get(sourceEngine.id);
						if (sourceSch) {
							let pitchValue = 0; // 0 to 1
							
							if (sourceEngine.useMelodicSequence) {
								// Use the pitch at the CURRENT step of the source engine
								const freqs = sourceEngine.melodicSequence[sourceSch.currentStep];
								if (Array.isArray(freqs) && freqs.length > 0) {
									const midi = frequencyToMidiNote(freqs[0]);
									pitchValue = Math.max(0, Math.min(1, midi / 127));
								} else {
									// Fallback to base frequency if sequence is empty
									const midi = frequencyToMidiNote(sourceEngine.synth.frequency);
									pitchValue = Math.max(0, Math.min(1, midi / 127));
								}
							} else {
								// Fixed pitch
								const midi = frequencyToMidiNote(sourceEngine.synth.frequency);
								pitchValue = Math.max(0, Math.min(1, midi / 127));
							}
							
							// Center around Middle C (approx 0.5) -> +/- 0.5 range
							// This allows pitch to both speed up and slow down the rate
							const centeredMod = (pitchValue - 0.5) * 2; // -1 to 1
							
							// Add to total modulation
							// We don't have a specific depth control for Engine->Engine routing yet,
							// so we'll use a fixed depth or maybe 0.5?
							// Let's use 1.0 for now (full range).
							totalRateMod += centeredMod;
							if (Math.random() < 0.01) {
								console.log(`[RateMod] Engine ${sourceEngine.id} -> ${engine.id}: pitch=${pitchValue.toFixed(2)} mod=${centeredMod.toFixed(2)} total=${totalRateMod.toFixed(2)}`);
							}
						}
					}
				});

				if (totalRateMod !== 0) {
					// rateMultiplier = 2 ^ (totalMod * 2) (up to +/- 2 octaves for full depth)
					const rateMultiplier = Math.pow(2, totalRateMod * 2);
					if (Math.random() < 0.01) {
						console.log(`[RateMod] Final ${engine.id}: totalMod=${totalRateMod.toFixed(2)} mult=${rateMultiplier.toFixed(2)} oldSec=${secondsPerStep.toFixed(3)} newSec=${(secondsPerStep / rateMultiplier).toFixed(3)}`);
					}
					secondsPerStep /= rateMultiplier;
				}

				engineSch.nextNoteTime += secondsPerStep;
			}
		});
	}, [isTransportPlaying, audioContext, noteOn, noteOff]);

    const schedulerState = useRef<{ timerId?: number; lookaheadTime: number; scheduleAheadTime: number }>({
        lookaheadTime: 25.0, // How often we wake up to schedule, in ms
        scheduleAheadTime: 0.1, // How far ahead to schedule audio, in seconds
    });
    const engineSchedulerStates = useRef<Map<string, { nextNoteTime: number; currentStep: number }>>(new Map());

    useEffect(() => {
        if (!isTransportPlaying) {
            if (schedulerState.current.timerId) {
                clearTimeout(schedulerState.current.timerId);
                schedulerState.current.timerId = undefined;
            }
            // Reset sequencers
            engineSchedulerStates.current.clear();
			sequencerModEventsRef.current.clear();
            setSequencerCurrentSteps(new Map());
			activeVoicesRef.current.forEach(voice => noteOff(voice.noteId, 0));
            return;
        }

        if (isTransportPlaying && audioContext) {
            // Initialize all engines for scheduling
            latestStateRef.current.engines.forEach(engine => {
                if (!engineSchedulerStates.current.has(engine.id)) {
                    engineSchedulerStates.current.set(engine.id, {
                        nextNoteTime: audioContext.currentTime + 0.1, // Start scheduling shortly after play
                        currentStep: 0,
                    });
                }
            });


            
            const scheduler = () => {
                if (!audioContext) return;
				if (isRandomizingRef.current) {
					schedulerState.current.timerId = window.setTimeout(scheduler, 100);
					return;
				}
				// REMOVED: if (latestStateRef.current.clockSource === "midi") return; 

                const now = audioContext.currentTime;
                const scheduleUntil = now + schedulerState.current.scheduleAheadTime;


				// Cleanup old sequencer modulation events
				const cleanupTime = now - 2.0; // Clean up events older than 2s
				sequencerModEventsRef.current.forEach((events, engineId) => {
					const filteredEvents = events.filter(e => e.end > cleanupTime);
					sequencerModEventsRef.current.set(engineId, filteredEvents);
				});

                // --- Schedule Sequencer Notes (Internal & Link Clock) ---
				if (latestStateRef.current.clockSource === "internal" || latestStateRef.current.clockSource === "link") {
					if (isWaitingForLinkStart.current) {
						// Wait for Link start beat
						schedulerState.current.timerId = window.setTimeout(scheduler, schedulerState.current.lookaheadTime);
						return;
					}

					latestStateRef.current.engines.forEach(engine => {
						// if (!engine.sequencerEnabled) return; // REMOVED: Allow running in background
						const engineSch = engineSchedulerStates.current.get(engine.id)!;
						const engineNodes = audioNodesRef.current.get(engine.id);
						if (!engineNodes) return;
						
						const secondsPerStep = (60 / latestStateRef.current.bpm) / (parseInt(engine.sequencerRate.split('/')[1]) / 4);

						while (engineSch.nextNoteTime < scheduleUntil) {
							advanceSequencer(engineSch.nextNoteTime);
						}
					});
				}
                activeVoicesRef.current.forEach((voice) => {
                    if (!voice.granularModeEnabled || !voice.nextGrainTime) return;

                    const engine = latestStateRef.current.engines.find(e => e.id === voice.engineId);
                    if (!engine || !engine.sampler.granularModeEnabled) {
                        voice.granularModeEnabled = false; 
                        return;
                    }

                    const sampleBuffer = samplesRef.current.get(voice.engineId);
                    const engineNodes = audioNodesRef.current.get(voice.engineId);
                    if (!sampleBuffer) {
						// console.warn(`[Scheduler] No sample buffer for granular voice ${voice.noteId}`);
						return;
					}
					if (!engineNodes) return;

					// Unmute engine mixer (in case it was muted by Panic)
					engineNodes.engineMixer.gain.cancelScheduledValues(audioContext.currentTime);
					engineNodes.engineMixer.gain.setValueAtTime(1, audioContext.currentTime);
                    
                    const density = engine.sampler.grainDensity;
                    if (density <= 0) return;

                    let nextGrainTime = voice.nextGrainTime;
                    
                    while (nextGrainTime < scheduleUntil) {
						// --- Calculate JS-based modulation for this grain ---
						let positionMod = 0, sizeMod = 0, densityMod = 0, jitterMod = 0;
						const voiceEngineNum = voice.engineId.slice(-1);

						const granularDestKeys = {
							pos: `engine${voiceEngineNum}GrainPosition` as keyof LFORoutingState,
							size: `engine${voiceEngineNum}GrainSize` as keyof LFORoutingState,
							density: `engine${voiceEngineNum}GrainDensity` as keyof LFORoutingState,
							jitter: `engine${voiceEngineNum}GrainJitter` as keyof LFORoutingState,
						};
						
						// LFO Modulation
						latestStateRef.current.lfos.forEach(lfo => {
							const lfoVal = calculateLFOValue(lfo, nextGrainTime, latestStateRef.current.bpm);
							if (lfo.routing[granularDestKeys.pos]) positionMod += lfoVal * 0.5; // Scale to +/- 0.5
							if (lfo.routing[granularDestKeys.size]) sizeMod += lfoVal * 0.1; // Scale to +/- 100ms
							if (lfo.routing[granularDestKeys.density]) densityMod += lfoVal * 50; // Scale to +/- 50
							if (lfo.routing[granularDestKeys.jitter]) jitterMod += lfoVal * 0.5; // Scale to +/- 0.5
						});

						// Sequencer Modulation
						latestStateRef.current.engines.forEach(sourceEngine => {
							const modEvents = sequencerModEventsRef.current.get(sourceEngine.id);
							let activeModValue = 0;
							let isGateOn = false;
							
							if (modEvents) {
								for (const event of modEvents) {
									if (nextGrainTime >= event.start && nextGrainTime < event.end) {
										isGateOn = true;
										// Use the stored value if available, otherwise default to 1.0 (backward compatibility)
										activeModValue = (event as any).value !== undefined ? (event as any).value : 1.0;
										break;
									}
								}
							}
							if(isGateOn) {
								if(sourceEngine.routing[granularDestKeys.pos]) positionMod += 0.5 * activeModValue;
								if(sourceEngine.routing[granularDestKeys.size]) sizeMod += 0.1 * activeModValue;
								if(sourceEngine.routing[granularDestKeys.density]) densityMod += 20 * activeModValue;
								if(sourceEngine.routing[granularDestKeys.jitter]) jitterMod += 0.5 * activeModValue;
							}
						});



                        const grainSource = audioContext.createBufferSource();
                        grainSource.buffer = sampleBuffer;
                        
                        const basePosition = engine.sampler.playbackPosition;
                        const jitter = (Math.random() - 0.5) * (engine.sampler.positionJitter + jitterMod);
                        let finalPosition = basePosition + positionMod + jitter;
                        finalPosition = Math.max(0, Math.min(1, finalPosition));

						const grainSize = Math.max(0.005, engine.sampler.grainSize + sizeMod);

                        const startOffset = Math.max(0, finalPosition * sampleBuffer.duration);
                        
						const finalDensity = Math.max(1, density + densityMod);
                        


                        const grainEnvelope = audioContext.createGain();
                        
                        // FIX: Connect directly to voice envelope to prevent crosstalk through shared samplerGain
                        grainEnvelope.connect(voice.envelopeGain);
                        grainSource.connect(grainEnvelope);
        
                        // Calculate pitch playback rate
						// Base rate is 1.0 (C4/60). Calculate ratio based on note difference from C4 + Transpose
						const rootNote = 60; // C4
						const globalTranspose = latestStateRef.current.transpose;
						const engineTranspose = engine.transpose; // Semitones
						const engineDetune = engine.detune; // Cents
						
						// For now, let's just implement basic pitch tracking for granular (which was missing).
						// Rate = 2 ^ ((note - 60) / 12)
						const playbackRate = Math.pow(2, (voice.note - 60) / 12);
						grainSource.playbackRate.value = playbackRate;

                        grainSource.start(nextGrainTime, startOffset, grainSize * 2); 
                        
                        const attackTime = grainSize * 0.4;
                        const releaseTime = grainSize * 0.4;
        
                        grainEnvelope.gain.setValueAtTime(0, nextGrainTime);
                        // Apply sampler volume here since we bypassed the shared node
                        grainEnvelope.gain.linearRampToValueAtTime(engine.sampler.volume, nextGrainTime + attackTime);
                        grainEnvelope.gain.linearRampToValueAtTime(0, nextGrainTime + attackTime + releaseTime);
        
                        grainSource.stop(nextGrainTime + grainSize * 2);
                        
                        nextGrainTime += 1.0 / finalDensity;
                    }
                    
                    voice.nextGrainTime = nextGrainTime;
                });


                schedulerState.current.timerId = window.setTimeout(scheduler, schedulerState.current.lookaheadTime);
            };
            
            scheduler(); // Start the loop

            return () => {
                if (schedulerState.current.timerId) {
                    clearTimeout(schedulerState.current.timerId);
                }
            };
        }
    }, [isTransportPlaying, audioContext, noteOn, noteOff]);

	// Keep track of midiAccess to prevent garbage collection
	const midiAccessRef = useRef<any>(null);

	// MIDI Setup
	useEffect(() => {
		const setupMidi = async () => {
			if (navigator.requestMIDIAccess) {
				try {
					const midiAccess = await navigator.requestMIDIAccess();
					midiAccessRef.current = midiAccess; // Store in ref
					
					const getConnectedInputs = () => {
						return Array.from(midiAccess.inputs.values()).filter(input => input.state !== "disconnected");
					};

					setMidiInputs(getConnectedInputs());

					midiAccess.onstatechange = (e: any) => {
						console.log("MIDI State Change:", e.port.name, e.port.state, e.port.connection);
						setMidiInputs(getConnectedInputs());
					};
				} catch (error) {
					console.error("MIDI access denied or not available.", error);
				}
			}
		};
		setupMidi();
	}, []);
	
	// MIDI Message Handler
	const lastClockTimeRef = useRef(0);
	const bpmHistoryRef = useRef<number[]>([]);

	useEffect(() => {
		const handleMidiMessage = (event: MIDIMessageEvent) => {
			const inputId = (event.target as MIDIInput).id;
			const isNoteInput = inputId === selectedMidiInputId;
			const isClockInput = inputId === selectedMidiClockInputId;
			
			// Debug MIDI Input
			if (event.data[0] !== 0xF8) { // Ignore clock ticks for log
				console.log(`[MIDI] Msg: ${event.data[0]}, Input: "${inputId}", Selected: "${selectedMidiInputId}"`);
			}

			if ((!isNoteInput && !isClockInput) || isRandomizingRef.current) return;

			const command = event.data[0] >> 4;
			const channel = event.data[0] & 0xf;
			const note = event.data[1];
			const velocity = event.data[2];
			
			// Only show activity for non-clock messages to avoid constant light
			if (isNoteInput && event.data[0] !== 0xF8) {
				setMidiActivity(true);
				if(midiActivityTimeoutRef.current) clearTimeout(midiActivityTimeoutRef.current);
				midiActivityTimeoutRef.current = window.setTimeout(() => setMidiActivity(false), 100);
			}

			const now = audioContext?.currentTime || 0;

			// Note Handling (Only if matches Note Input)
			if (isNoteInput) {
				if(command === 9 && velocity > 0) { // Note On
					latestStateRef.current.engines.forEach(engine => {
						if(engine.midiControlled) {
							noteOn(engine.id, `midi_${engine.id}_${channel}_${note}`, note, now);
						}
					})
				} else if (command === 8 || (command === 9 && velocity === 0)) { // Note Off
					latestStateRef.current.engines.forEach(engine => {
						if(engine.midiControlled) {
							noteOff(`midi_${engine.id}_${channel}_${note}`, now);
						}
					})
				} else if (command === 0xB) { // Control Change
					// Check for All Sound Off (120) or All Notes Off (123)
					if (note === 120 || note === 123) {
						allNotesOff();
					}
				} else if (event.data[0] === 0xFC) { // Stop (Realtime Message)
					// Always handle Stop from the Note Input device, even if Sync is Internal
					allNotesOff();
				}
			}
			
			// Clock Handling (Only if matches Clock Input)
			if (isClockInput && latestStateRef.current.clockSource === "midi") {
				// Flash clock activity light
				if (event.data[0] === 0xF8) { // Clock
					setMidiClockActivity(true);
					if (midiClockActivityTimeoutRef.current) {
						window.clearTimeout(midiClockActivityTimeoutRef.current);
					}
					midiClockActivityTimeoutRef.current = window.setTimeout(() => {
						setMidiClockActivity(false);
					}, 50); // Short flash for clock
				}

				// MIDI Clock Handling
				if (event.data[0] === 0xF8) { // Clock
					midiClockCounterRef.current++;
					
					// BPM Detection
					if (midiClockCounterRef.current % 24 === 0) {
						const lastTime = lastClockTimeRef.current;
						if (lastTime > 0) {
							const elapsed = now - lastTime;
							if (elapsed > 0) {
								// 24 pulses per beat. elapsed is time for 1 beat.
								const instantBpm = 60 / elapsed;
								
								// Simple smoothing
								const history = bpmHistoryRef.current;
								history.push(instantBpm);
								if (history.length > 4) history.shift(); // Keep last 4 beats
								
								const avgBpm = history.reduce((a, b) => a + b, 0) / history.length;
								
								// Only update if difference is significant to avoid jitter
								if (Math.abs(avgBpm - latestStateRef.current.bpm) > 1) {
									setBPM(Math.round(avgBpm));
								}
							}
						}
						lastClockTimeRef.current = now;
					}

					if (midiClockCounterRef.current % 6 === 0) {
						// Advance step every 6 pulses (16th note)
						// Only advance if transport is playing!
						if (isTransportPlaying) {
							advanceSequencer(now);
						}
					}
				} else if (event.data[0] === 0xFA) { // Start
					setIsTransportPlaying(true);
					midiClockCounterRef.current = 0;
					lastClockTimeRef.current = 0;
					bpmHistoryRef.current = [];
					// Reset sequencers
					engineSchedulerStates.current.forEach((val) => {
						val.currentStep = -1; // Will become 0 on next advance
						val.nextNoteTime = now;
					});
					sequencerCurrentSteps.forEach((_, key) => {
						setSequencerCurrentSteps(prev => new Map(prev).set(key, 0));
					});
				} else if (event.data[0] === 0xFC) { // Stop
					setIsTransportPlaying(false);
					allNotesOff();
				} else if (event.data[0] === 0xFB) { // Continue
					setIsTransportPlaying(true);
				}
			}
		}

		midiInputs.forEach(input => {
			input.onmidimessage = handleMidiMessage;
		});

		return () => { 
			midiInputs.forEach(input => {
				input.onmidimessage = null; 
			});
		}
	}, [selectedMidiInputId, selectedMidiClockInputId, midiInputs, audioContext, noteOn, noteOff, harmonicTuningSystem, isTransportPlaying]);

	// Memoize a string representing the structure of the effects chain.
    // This will only change if effects are added, removed, reordered, enabled/disabled,
    // or if a phaser's number of stages changes.
    		const masterEffectsChain = useMemo(() => {
    			return masterEffects.map(e => `${e.id}:${e.enabled}`).join(',');
    		}, [masterEffects]);
    		// This useEffect handles STRUCTURAL changes to the audio graph:
    		// creating/deleting nodes and connecting the final audio chain.
    		useEffect(() => {
    	        if (!audioContext || !masterVolumeNodeRef.current || !filterNodesRef.current || !masterAnalyserNodeRef.current) return;
    	    
				masterVolumeNodeRef.current.disconnect();
				if (!masterBusRef.current) {
					masterBusRef.current = audioContext.createGain();
				}
				const masterBus = masterBusRef.current;

    	        // 1. Create/Delete effect nodes based on structural changes
    	        const currentEffectIds = masterEffects.map(e => e.id);
    	        
    	        effectNodesRef.current.forEach((_, id) => {
    	            if (!currentEffectIds.includes(id)) {
    	                effectNodesRef.current.get(id)?.input.disconnect();
    	                effectNodesRef.current.delete(id);
    	            }
    	        });
    	
    	        masterEffects.forEach(effect => {
    	            let effectNodes = effectNodesRef.current.get(effect.id);
    	
    	            // If phaser stages change, we must rebuild the node. This is a structural change.
    	            if (effect.type === 'phaser' && effectNodes && effectNodes.nodes.filters.length !== effect.params.phaser?.stages) {
    	                effectNodes.input.disconnect();
    	                effectNodesRef.current.delete(effect.id);
    	                effectNodes = undefined; // Force recreation
    	            }
    	
    	            if (!effectNodes) {
    	                const input = audioContext.createGain();
    	                const output = audioContext.createGain();
						if (dummyGainRef.current) {
							output.connect(dummyGainRef.current);
						}
    	                let nodes: any = {};
    	                 switch (effect.type) {
    	                    case 'distortion':
    	                        nodes.shaper = audioContext.createWaveShaper();
    	                        input.connect(nodes.shaper).connect(output);
    	                        break;
    	                    case 'delay':
    	                        nodes.delay = audioContext.createDelay(5.0);
    	                        nodes.feedback = audioContext.createGain();
    	                        nodes.wet = audioContext.createGain();
    	                        nodes.dry = audioContext.createGain();
    	                        input.connect(nodes.dry).connect(output);
    	                        input.connect(nodes.delay).connect(nodes.feedback).connect(nodes.delay);
    	                        nodes.delay.connect(nodes.wet).connect(output);
    	                        break;
    	                    case 'reverb':
    	                        nodes.convolver = audioContext.createConvolver();
    							nodes.wet = audioContext.createGain();
    	                        nodes.dry = audioContext.createGain();
    							input.connect(nodes.dry).connect(output);
    							input.connect(nodes.convolver).connect(nodes.wet).connect(output);
    	                        break;
    						case 'chorus':
    						case 'flanger':
    							nodes.delay = audioContext.createDelay(1.0);
    							nodes.lfo = audioContext.createOscillator();
    							nodes.lfoGain = audioContext.createGain();
    							nodes.feedback = audioContext.createGain();
    							nodes.wet = audioContext.createGain();
    	                        nodes.dry = audioContext.createGain();
    							input.connect(nodes.dry).connect(output);
    							input.connect(nodes.delay).connect(nodes.wet).connect(output);
    							if(effect.type === 'flanger') {
    								nodes.delay.connect(nodes.feedback).connect(nodes.delay);
    							}
    							nodes.lfo.connect(nodes.lfoGain).connect(nodes.delay.delayTime);
    							nodes.lfo.start();
    							if (dummyGainRef.current) {
    								nodes.lfo.connect(dummyGainRef.current);
    							}
    							break;
    						case 'phaser':
    							nodes.filters = [];
    							let lastPhaserNode: AudioNode = input;
    							for(let i=0; i < (effect.params.phaser?.stages || 4); i++) {
    								const filter = audioContext.createBiquadFilter();
    								filter.type = 'allpass';
    								nodes.filters.push(filter);
    								lastPhaserNode.connect(filter);
    								lastPhaserNode = filter;
    							}
    							nodes.lfo = audioContext.createOscillator();
    							nodes.lfoGain = audioContext.createGain();
    							nodes.filters.forEach(f => nodes.lfoGain.connect(f.frequency));
    							nodes.lfo.connect(nodes.lfoGain);
    							nodes.lfo.start();
    							if (dummyGainRef.current) {
    								nodes.lfo.connect(dummyGainRef.current);
    							}
    							nodes.wet = audioContext.createGain();
    	                        nodes.dry = audioContext.createGain();
    							input.connect(nodes.dry).connect(output);
    							lastPhaserNode.connect(nodes.wet).connect(output);
    							break;
    						case 'tremolo':
    							nodes.lfo = audioContext.createOscillator();
    							nodes.lfoGain = audioContext.createGain();
    							nodes.lfo.connect(nodes.lfoGain).connect(output.gain);
    							nodes.lfo.start();
    							if (dummyGainRef.current) {
    								nodes.lfo.connect(dummyGainRef.current);
    							}
    							input.connect(output);
    							break;
    						case 'eq':
    							nodes.bands = [];
    							let lastEQNode: AudioNode = input;
    							eqFrequencies.forEach((freq, i) => {
    								const filter = audioContext.createBiquadFilter();
    								if (i === 0) filter.type = 'lowshelf';
    								else if (i === eqFrequencies.length - 1) filter.type = 'highshelf';
    								else filter.type = 'peaking';
    								filter.frequency.value = freq;
    								nodes.bands.push(filter);
    								lastEQNode.connect(filter);
    								lastEQNode = filter;
    							});
    							lastEQNode.connect(output);
    							break;
    	                }
    	                effectNodesRef.current.set(effect.id, { id: effect.id, type: effect.type, input, output, nodes });
    	            }
    	        });
    	        
    	        // 2. Connect the entire audio graph
	        const f1 = filterNodesRef.current.filter1.node;
	        const f2 = filterNodesRef.current.filter2.node;
	    
			// Disconnect everything first to be safe
			masterBus.disconnect();
			f1.disconnect();
			f2.disconnect();
			audioNodesRef.current.forEach(nodes => nodes.finalOutput.disconnect());
	
			// Create Input Busses for routing
			const filter1InputBus = audioContext.createGain();
			const filter2InputBus = audioContext.createGain();
			const directInputBus = audioContext.createGain();

	        audioNodesRef.current.forEach((nodes, engineId) => {
				const currentEngine = engines.find(e => e.id === engineId);
				const dest = currentEngine?.filterDestination || "filter1";

				if (dest === "filter1") {
					nodes.finalOutput.connect(filter1InputBus);
				} else if (dest === "filter2") {
					nodes.finalOutput.connect(filter2InputBus);
				} else {
					nodes.finalOutput.connect(directInputBus);
				}
			});
	    
	        const lastFilterNode = (() => {
				// console.log("[AudioGraph] Updating. Filter1:", filter1State.enabled, "Filter2:", filter2State.enabled, "Routing:", filterRouting);
	            if (filterRouting === 'series') {
					// Serial: F1 Input -> F1 -> F2 -> Master
					//         F2 Input -> F2 -> Master
					//         Direct Input -> Master
					
					let f1Output: AudioNode = filter1InputBus;
	                if (filter1State.enabled) {
	                    filter1InputBus.connect(f1);
						f1Output = f1;
	                }
					
					// F1 Output goes to F2 Input
					f1Output.connect(filter2InputBus);

					let f2Output: AudioNode = filter2InputBus;
					if (filter2State.enabled) {
						filter2InputBus.connect(f2);
						f2Output = f2;
					}

					// Mix F2 output and Direct Input
					const mixBus = audioContext.createGain();
					f2Output.connect(mixBus);
					directInputBus.connect(mixBus);
					
	                return mixBus;
	            } else { // Parallel
					// Parallel: F1 Input -> F1 -> Master
					//           F2 Input -> F2 -> Master
					//           Direct Input -> Master

	                const parallelOutput = audioContext.createGain();
	                
	                if (filter1State.enabled) {
	                    filter1InputBus.connect(f1);
	                    f1.connect(parallelOutput);
	                } else {
						filter1InputBus.connect(parallelOutput);
					}

	                if (filter2State.enabled) {
	                    filter2InputBus.connect(f2);
	                    f2.connect(parallelOutput);
	                } else {
						filter2InputBus.connect(parallelOutput);
					}
					
					directInputBus.connect(parallelOutput);

	                return parallelOutput;
	            }
	        })();
    	
    	        const enabledEffects = masterEffects.filter(effect => effect.enabled);
    	        const finalEffectNode = enabledEffects.reduce((currentNode, effect) => {
    	            const effectNodes = effectNodesRef.current.get(effect.id);
    	            if (effectNodes) {
    	                currentNode.connect(effectNodes.input);
    	                return effectNodes.output;
    	            }
    	            return currentNode;
    	        }, lastFilterNode);
    	
    	        finalEffectNode.connect(masterVolumeNodeRef.current);
    	        masterVolumeNodeRef.current.connect(masterAnalyserNodeRef.current);
    	        masterAnalyserNodeRef.current.connect(audioContext.destination);
    	    
    	        return () => { // Cleanup on unmount or re-run
    	            masterBus.disconnect();
    	            f1.disconnect();
    	            f2.disconnect();
    	            effectNodesRef.current.forEach(fx => {
						fx.output.disconnect();
    	            });
    	            masterVolumeNodeRef.current?.disconnect();
    	            masterAnalyserNodeRef.current?.disconnect();
    	        };
    	    
    	    
	    }, [audioContext, filter1State.enabled, filter2State.enabled, filterRouting, masterEffectsChain, engines]);
	// This useEffect handles PARAMETER changes for existing effect nodes,
    // which does not require disconnecting the audio graph.
    useEffect(() => {
        if (!audioContext || !effectNodesRef.current.size) return;
        const now = audioContext.currentTime;

        masterEffects.forEach(effect => {
            const effectNodes = effectNodesRef.current.get(effect.id);
            if (!effectNodes) return;
            
            const { params } = effect;
            const { nodes } = effectNodes;
            switch(effect.type) {
				case 'distortion':
					nodes.shaper.curve = makeDistortionCurve(params.distortion!.amount, params.distortion!.mode);
					break;
				case 'delay':
					nodes.delay.delayTime.setTargetAtTime(params.delay!.time, now, 0.01);
					nodes.feedback.gain.setTargetAtTime(params.delay!.feedback, now, 0.01);
					nodes.wet.gain.setTargetAtTime(params.delay!.mix, now, 0.01);
					nodes.dry.gain.setTargetAtTime(1 - params.delay!.mix, now, 0.01);
					break;
				case 'reverb': {
					const decay = Math.max(0.1, params.reverb!.decay);
					const cacheKey = `${decay.toFixed(2)}`;
					if (reverbImpulseCache.current.has(cacheKey)) {
						nodes.convolver.buffer = reverbImpulseCache.current.get(cacheKey)!;
					} else {
						const newImpulse = makeReverbImpulse(audioContext, decay, decay);
						nodes.convolver.buffer = newImpulse;
						reverbImpulseCache.current.set(cacheKey, newImpulse);
					}
					nodes.wet.gain.setTargetAtTime(params.reverb!.mix, now, 0.01);
					nodes.dry.gain.setTargetAtTime(1 - params.reverb!.mix, now, 0.01);
					break;
				}
				case 'chorus':
					nodes.lfo.frequency.setTargetAtTime(params.chorus!.rate, now, 0.01);
					nodes.lfoGain.gain.setTargetAtTime(0.005 * params.chorus!.depth, now, 0.01); // 5ms depth
					nodes.delay.delayTime.setTargetAtTime(0.02, now, 0.01); // 20ms delay
					nodes.wet.gain.setTargetAtTime(params.chorus!.mix, now, 0.01);
					nodes.dry.gain.setTargetAtTime(1 - params.chorus!.mix, now, 0.01);
					break;
				case 'flanger':
					nodes.lfo.frequency.setTargetAtTime(params.flanger!.rate, now, 0.01);
					nodes.lfoGain.gain.setTargetAtTime(params.flanger!.delay * params.flanger!.depth, now, 0.01);
					nodes.delay.delayTime.setTargetAtTime(params.flanger!.delay, now, 0.01);
					nodes.feedback.gain.setTargetAtTime(params.flanger!.feedback, now, 0.01);
					nodes.wet.gain.setTargetAtTime(params.flanger!.mix, now, 0.01);
					nodes.dry.gain.setTargetAtTime(1 - params.flanger!.mix, now, 0.01);
					break;
				case 'phaser':
					nodes.lfo.frequency.setTargetAtTime(params.phaser!.rate, now, 0.01);
					nodes.lfoGain.gain.setTargetAtTime(1000, now, 0.01); // Modulate over 1000Hz range
					nodes.filters.forEach((f: BiquadFilterNode) => f.Q.setTargetAtTime(params.phaser!.q, now, 0.01));
					nodes.wet.gain.setTargetAtTime(params.phaser!.mix, now, 0.01);
					nodes.dry.gain.setTargetAtTime(1 - params.phaser!.mix, now, 0.01);
					break;
				case 'tremolo':
					// Map LFO_Shape to valid OscillatorType
					let oscType: OscillatorType = 'sine';
					const shape = params.tremolo!.shape;
					if (shape === 'sine' || shape === 'square' || shape === 'triangle' || shape === 'sawtooth') {
						oscType = shape as OscillatorType;
					} else if (shape === 'rampDown') {
						oscType = 'sawtooth';
					} else if (shape === 'rampUp') {
						oscType = 'sawtooth'; // Approximation
					}
					// 'random', 'noise', 'perlin', 'custom' fallback to 'sine' to prevent crash
					nodes.lfo.type = oscType;
					nodes.lfo.frequency.setTargetAtTime(params.tremolo!.rate, now, 0.01);
					nodes.lfoGain.gain.setTargetAtTime(params.tremolo!.depth, now, 0.01);
					// Tremolo mix is handled by depth
					break;
				case 'eq':
					nodes.bands.forEach((band: BiquadFilterNode, i: number) => {
						band.gain.setTargetAtTime(params.eq!.bands[i], now, 0.01);
					});
					break;
			}
        });
    }, [audioContext, masterEffects]);

    // Update Filter Params
    useEffect(() => {
        if (!audioContext || !filterNodesRef.current) return;
        const { node: f1 } = filterNodesRef.current.filter1;
        const { node: f2 } = filterNodesRef.current.filter2;
        
        const now = audioContext.currentTime;
        f1.type = filter1State.type;
        // Clamp frequency to safe range (20Hz - 20kHz)
        const f1Freq = Math.max(20, Math.min(20000, filter1State.cutoff ?? 2000));
        f1.frequency.setTargetAtTime(f1Freq, now, 0.01);
        // Clamp Q to safe range (avoid 0 or negative)
        const f1Q = Math.max(0.0001, Math.min(1000, filter1State.resonance ?? 1));
        f1.Q.setTargetAtTime(f1Q, now, 0.01);

        f2.type = filter2State.type;
        const f2Freq = Math.max(20, Math.min(20000, filter2State.cutoff ?? 200));
        f2.frequency.setTargetAtTime(f2Freq, now, 0.01);
        const f2Q = Math.max(0.0001, Math.min(1000, filter2State.resonance ?? 1));
        f2.Q.setTargetAtTime(f2Q, now, 0.01);

    }, [audioContext, filter1State, filter2State]);

    // LFO Parameter and Routing Update
    useEffect(() => {
        if (!audioContext || !lfoNodesRef.current || !lfoRoutingBussesRef.current) return;
		const now = audioContext.currentTime;

        lfos.forEach(lfo => {
            const lfoNodes = lfoNodesRef.current.get(lfo.id);
            if (!lfoNodes) return;

            const { lfoNode, depthGain, rateModGain } = lfoNodes;
            const cached = lfoNodes as any; // Cast to access cachedShape

			// Handle Waveform Shape
			// Check if we need to update the waveform
			if (lfo.shape !== cached.cachedShape || lfo.shape === 'custom') {
				// For custom, we always update if customShape changes? 
				// Ideally check customShape equality too, but for now update custom always.
				// For others, only update if shape changed.
				
				if (lfo.shape === 'custom') {
					if (lfo.customShape && lfo.customShape.length > 0) {
						const wave = createPeriodicWaveFromTable(audioContext, lfo.customShape);
						lfoNode.setPeriodicWave(wave);
					}
				} else if (lfo.shape === 'random') {
					const len = 256;
					const table = new Float32Array(len);
					for(let i=0; i<len; i++) table[i] = random1D(i/len);
					const wave = createPeriodicWaveFromTable(audioContext, Array.from(table));
					lfoNode.setPeriodicWave(wave);
				} else if (lfo.shape === 'noise') {
					const len = 256;
					const table = new Float32Array(len);
					for(let i=0; i<len; i++) table[i] = smoothNoise1D(i/len) * 2 - 1;
					const wave = createPeriodicWaveFromTable(audioContext, Array.from(table));
					lfoNode.setPeriodicWave(wave);
				} else if (lfo.shape === 'perlin') {
					const len = 256;
					const table = new Float32Array(len);
					for(let i=0; i<len; i++) table[i] = noise1D(i/len);
					const wave = createPeriodicWaveFromTable(audioContext, Array.from(table));
					lfoNode.setPeriodicWave(wave);
				} else if (lfo.shape === 'rampUp') {
					const len = 256;
					const table = new Float32Array(len);
					for(let i=0; i<len; i++) table[i] = -1 + 2 * (i / len); 
					const wave = createPeriodicWaveFromTable(audioContext, Array.from(table));
					lfoNode.setPeriodicWave(wave);
				} else if (lfo.shape === 'rampDown') {
					lfoNode.type = 'sawtooth';
				} else {
					if (['sine', 'square', 'triangle'].includes(lfo.shape)) {
						lfoNode.type = lfo.shape as OscillatorType;
					}
				}
				cached.cachedShape = lfo.shape;
			}

            depthGain.gain.setTargetAtTime(lfo.depth, now, 0.01);
            
            // Update Smoothing Filter
            // Cutoff relative to rate:
            // Smoothing 0 -> High cutoff (pass all)
            // Smoothing 1 -> Low cutoff (fundamental)
            // Formula: cutoff = rate * (1 + (1-smoothing) * 50)
            // If rate is 1Hz:
            // S=0 -> 51Hz (passes up to 50th harmonic - pretty sharp)
            // S=1 -> 1Hz (sine wave)
            // S=0.5 -> 26Hz
            
            // Calculate effective rate (Hz)
            let currentRate = lfo.rate;
            if (lfo.sync) {
                 // Calculate synced rate
                 const cleanRate = lfo.syncRate;
                 let noteValueInBeats = 1;
                 if (cleanRate.includes("/")) {
                     const parts = cleanRate.split("/");
                     const numerator = parseFloat(parts[0]);
                     const denominator = parseFloat(parts[1]);
                     if (denominator && !isNaN(numerator)) noteValueInBeats = (4 * numerator) / denominator;
                 } else {
                     const val = parseFloat(cleanRate);
                     if (val) noteValueInBeats = 4 / val;
                 }
                 const durationInSeconds = noteValueInBeats * (60 / Math.max(1, bpm));
                 if (durationInSeconds > 0) currentRate = 1 / durationInSeconds;
            }
            
            const maxHarmonic = 1 + (1 - (lfo.smoothing || 0)) * 100;
            const cutoff = Math.max(0.1, currentRate * maxHarmonic);
            
            const { smoothingFilter } = lfoNodes as any;
            if (smoothingFilter) {
                 safeSetTargetAtTime(smoothingFilter.frequency, cutoff, now, 0.1);
            }

            lfoNode.frequency.setTargetAtTime(currentRate, now, 0.01);

			// Set Rate Mod Sensitivity (Proportional FM)
			// rateModGain.gain = currentRate. This means if input is 1.0 (full depth), we modulate by +/- 100% of rate.
			rateModGain.gain.setTargetAtTime(currentRate, now, 0.01);

			// Update FM Routing (Matrix Mixer)
			if (lfoNodes.fmSends) {
				lfoNodes.fmSends.forEach((sendGain, targetId) => {
					const routingKey = `${targetId}Rate` as keyof LFORoutingState;
					const isConnected = lfo.routing[routingKey];
					// If connected, set gain to 1 (pass signal). If not, 0.
					// The signal is already scaled by source LFO depth (via depthGain).
					sendGain.gain.setTargetAtTime(isConnected ? 1 : 0, now, 0.01);
				});
			}

            // Update routing
            Object.entries(lfo.routing).forEach(([dest, isConnected]) => {
				const destKey = dest as keyof LFORoutingState;
				let targetBus: GainNode | undefined;
				if (destKey.startsWith('filter')) {
					const filterNum = destKey.includes('1') ? 'filter1' : 'filter2';
					const param = destKey.includes('Cutoff') ? 'cutoffModBus' : 'resonanceModBus';
					targetBus = lfoRoutingBussesRef.current![filterNum][param];
				} else if (destKey.startsWith('engine')) {
					const engineId = `engine${destKey.charAt(6)}`;
					const paramKey = destKey.substring(7) as keyof EngineModBusses;
					// lowercase first letter
					const busKey = paramKey.charAt(0).toLowerCase() + paramKey.slice(1);
					targetBus = lfoRoutingBussesRef.current!.engineModBusses.get(engineId)?.[busKey as keyof EngineModBusses];
				}

                if (targetBus) {
					try { depthGain.disconnect(targetBus); } catch(e) {}
                    if (isConnected) {
						depthGain.connect(targetBus);
					}
                }
            });
        });
    }, [audioContext, lfos, bpm]);

	// Sequencer Modulation Routing Update
	useEffect(() => {
		if (!audioContext || !lfoRoutingBussesRef.current) return;
	
		engines.forEach(engine => {
			const engineNodes = audioNodesRef.current.get(engine.id);
			if (!engineNodes) return;
	
			const { sequencerModGate } = engineNodes;
	
			Object.entries(engine.routing).forEach(([dest, isConnected]) => {
				const destKey = dest as keyof LFORoutingState;
				let targetBus: GainNode | undefined;
	
				if (destKey.startsWith('filter')) {
					const filterNum = destKey.includes('1') ? 'filter1' : 'filter2';
					const param = destKey.includes('Cutoff') ? 'cutoffModBus' : 'resonanceModBus';
					targetBus = lfoRoutingBussesRef.current![filterNum][param];
				} else if (destKey.startsWith('engine')) {
					const engineId = `engine${destKey.charAt(6)}`;
					const paramKey = destKey.substring(7) as keyof EngineModBusses;
					const busKey = paramKey.charAt(0).toLowerCase() + paramKey.slice(1);
					targetBus = lfoRoutingBussesRef.current!.engineModBusses.get(engineId)?.[busKey as keyof EngineModBusses];
				}
	
				if (targetBus) {
					try {
						sequencerModGate.disconnect(targetBus);
					} catch (e) {
						// Ignore disconnection errors
					}
					if (isConnected) {
						sequencerModGate.connect(targetBus);
					}
				}
			});
		});
	}, [audioContext, engines]);

	// Real-time Frequency Update (for manual slider/dropdown changes)
	useEffect(() => {
		if (!audioContext) return;
		const now = audioContext.currentTime;

		engines.forEach(engine => {
			if (engine.synth.enabled) {
				activeVoicesRef.current.forEach(voice => {
					if (voice.engineId === engine.id) {
						voice.sourceNodes.forEach(node => {
							if (node instanceof OscillatorNode) {
								// Only update if the frequency is significantly different to avoid overriding glides/envelopes unnecessarily
								// However, for manual slider control, we want immediate response.
								// We check if the current frequency is "close" to the target to avoid fighting with glides/envelopes?
								// No, if the user moves the slider, they want to override.
								// But if a sequence is playing, this will override the sequence pitch!
								// We only want to update if the user *manually* changed the frequency.
								// But we don't know that here.
								// Strategy: If harmonicTuningSystem is 'solfeggio' OR we are in a manual mode, we force it.
								// For now, let's assume if the user changes the slider, they want to hear it.
								// But we must NOT override if the note was just triggered by the sequencer with a specific pitch.
								// This is tricky.
								// If we simply setTargetAtTime, it overrides everything.
								// Maybe we only do this if the engine is NOT playing a sequence?
								// But the user might want to tune the sequence.
								// Let's rely on the fact that this useEffect runs when 'engines' changes.
								// 'engines' changes when the slider moves.
								// So this will only fire when the user interacts with the UI (or automation).
								node.frequency.setTargetAtTime(engine.synth.frequency, now, 0.01);
							}
						});
					}
				});
			}
		});
	}, [engines, audioContext]);

	// Morphing Animation Loop
	useEffect(() => {
		if (!isMorphing || !audioContext) return;
		let animationFrameId: number;

		const animate = () => {
			const now = Date.now();
			const startTime = morphStartTimeRef.current!;
			const duration = calculateTimeFromSync(
				latestStateRef.current.bpm,
				isMorphSynced,
				morphSyncRateIndex,
				syncRates,
				morphTime
			);
			
			


			// Safety check for invalid duration
			if (!duration || duration <= 0 || isNaN(duration)) {
				console.warn("[Morph] Invalid duration, stopping");
				setIsMorphing(false);
				return;
			}

			const progress = Math.min((now - startTime) / duration, 1);
			
			// Safety check for invalid progress
			if (isNaN(progress)) {
				setIsMorphing(false);
				return;
			}

			const startState = morphStartRef.current;
			const targetState = morphTargetRef.current;
			const audioNow = audioContext.currentTime;
			const rampTime = 0.01;

			// Interpolate discrete parameters (Steps, Pulses, Rotate)
			// We only update React state if the rounded integer values change to avoid thrashing.
			if (startState && targetState) {
				let enginesChanged = false;
				const currentEngines = latestStateRef.current.engines;
				
				const newEngines = currentEngines.map((engine) => {
					const start = startState.engines.find(e => e.id === engine.id);
					const target = targetState.engines.find(e => e.id === engine.id);
					if (!start || !target) return engine;

					// Interpolate and round to nearest integer
					const newSteps = Math.round(lerp(start.sequencerSteps, target.sequencerSteps, progress));
					const newPulses = Math.round(lerp(start.sequencerPulses, target.sequencerPulses, progress));
					const newRotate = Math.round(lerp(start.sequencerRotate, target.sequencerRotate, progress));

					// Check if anything changed from the CURRENT state
					if (newSteps !== engine.sequencerSteps || 
						newPulses !== engine.sequencerPulses || 
						newRotate !== engine.sequencerRotate) {
						
						enginesChanged = true;
						return {
							...engine,
							sequencerSteps: newSteps,
							sequencerPulses: newPulses,
							sequencerRotate: newRotate,
							// Regenerate sequence based on new values
							sequence: rotatePattern(generateEuclideanPattern(newSteps, newPulses), newRotate)
						};
					}
					return engine;
				});

				if (enginesChanged) {
					setEngines(newEngines);
				}
			}



			// Direct AudioParam manipulation (for performance)
			if (startState && targetState) {
				audioNodesRef.current.forEach((nodes, id) => {
					const start = startState.engines.find((e: EngineState) => e.id === id);
					const target = targetState.engines.find((e: EngineState) => e.id === id);
					if (!start || !target) return;

					safeSetTargetAtTime(nodes.synth.volumeGain.gain, lerp(start.synth.volume, target.synth.volume, progress), audioNow, rampTime);
					safeSetTargetAtTime(nodes.noise.volumeGain.gain, lerp(start.noise.volume, target.noise.volume, progress), audioNow, rampTime);
					safeSetTargetAtTime(nodes.sampler.volumeGain.gain, lerp(start.sampler.volume, target.sampler.volume, progress), audioNow, rampTime);
				});
				
				if (filterNodesRef.current) {
					safeSetTargetAtTime(filterNodesRef.current.filter1.node.frequency, lerp(startState.filter1State.cutoff, targetState.filter1State.cutoff, progress), audioNow, rampTime);
					safeSetTargetAtTime(filterNodesRef.current.filter1.node.Q, lerp(startState.filter1State.resonance, targetState.filter1State.resonance, progress), audioNow, rampTime);
					safeSetTargetAtTime(filterNodesRef.current.filter2.node.frequency, lerp(startState.filter2State.cutoff, targetState.filter2State.cutoff, progress), audioNow, rampTime);
					safeSetTargetAtTime(filterNodesRef.current.filter2.node.Q, lerp(startState.filter2State.resonance, targetState.filter2State.resonance, progress), audioNow, rampTime);
				}

				lfoNodesRef.current.forEach((nodes, id) => {
					const start = startState.lfos.find((l: LFOState) => l.id === id);
					const target = targetState.lfos.find((l: LFOState) => l.id === id);
					if (!start || !target) return;
					safeSetTargetAtTime(nodes.lfoNode.frequency, lerp(start.rate, target.rate, progress), audioNow, rampTime);
					safeSetTargetAtTime(nodes.depthGain.gain, lerp(start.depth, target.depth, progress), audioNow, rampTime);
				});

				effectNodesRef.current.forEach((fxNodes, id) => {
					const start = startState.masterEffects.find((e: MasterEffect) => e.id === id);
					const target = targetState.masterEffects.find((e: MasterEffect) => e.id === id);
					if (!start || !target || start.type !== target.type) return;

					const startParams = start.params;
					const targetParams = target.params;
					
					switch (fxNodes.type) {
						case "delay":
							safeSetTargetAtTime(fxNodes.nodes.delay.delayTime, lerp(startParams.delay!.time, targetParams.delay!.time, progress), audioNow, rampTime);
							safeSetTargetAtTime(fxNodes.nodes.feedback.gain, lerp(startParams.delay!.feedback, targetParams.delay!.feedback, progress), audioNow, rampTime);
							safeSetTargetAtTime(fxNodes.nodes.wet.gain, lerp(startParams.delay!.mix, targetParams.delay!.mix, progress), audioNow, rampTime);
							safeSetTargetAtTime(fxNodes.nodes.dry.gain, 1 - lerp(startParams.delay!.mix, targetParams.delay!.mix, progress), audioNow, rampTime);
							break;
						case "reverb":
							safeSetTargetAtTime(fxNodes.nodes.wet.gain, lerp(startParams.reverb!.mix, targetParams.reverb!.mix, progress), audioNow, rampTime);
							safeSetTargetAtTime(fxNodes.nodes.dry.gain, 1 - lerp(startParams.reverb!.mix, targetParams.reverb!.mix, progress), audioNow, rampTime);
							break;
						case "chorus":
							safeSetTargetAtTime(fxNodes.nodes.lfo.frequency, lerp(startParams.chorus!.rate, targetParams.chorus!.rate, progress), audioNow, rampTime);
							safeSetTargetAtTime(fxNodes.nodes.lfoGain.gain, 0.005 * lerp(startParams.chorus!.depth, targetParams.chorus!.depth, progress), audioNow, rampTime);
							safeSetTargetAtTime(fxNodes.nodes.wet.gain, lerp(startParams.chorus!.mix, targetParams.chorus!.mix, progress), audioNow, rampTime);
							safeSetTargetAtTime(fxNodes.nodes.dry.gain, 1 - lerp(startParams.chorus!.mix, targetParams.chorus!.mix, progress), audioNow, rampTime);
							break;
						case "flanger":
							safeSetTargetAtTime(fxNodes.nodes.lfo.frequency, lerp(startParams.flanger!.rate, targetParams.flanger!.rate, progress), audioNow, rampTime);
							const flangerLfoGain = lerp(startParams.flanger!.delay, targetParams.flanger!.delay, progress) * lerp(startParams.flanger!.depth, targetParams.flanger!.depth, progress);
							safeSetTargetAtTime(fxNodes.nodes.lfoGain.gain, flangerLfoGain, audioNow, rampTime);
							safeSetTargetAtTime(fxNodes.nodes.delay.delayTime, lerp(startParams.flanger!.delay, targetParams.flanger!.delay, progress), audioNow, rampTime);
							safeSetTargetAtTime(fxNodes.nodes.feedback.gain, lerp(startParams.flanger!.feedback, targetParams.flanger!.feedback, progress), audioNow, rampTime);
							safeSetTargetAtTime(fxNodes.nodes.wet.gain, lerp(startParams.flanger!.mix, targetParams.flanger!.mix, progress), audioNow, rampTime);
							safeSetTargetAtTime(fxNodes.nodes.dry.gain, 1 - lerp(startParams.flanger!.mix, targetParams.flanger!.mix, progress), audioNow, rampTime);
							break;
						case "phaser":
							safeSetTargetAtTime(fxNodes.nodes.lfo.frequency, lerp(startParams.phaser!.rate, targetParams.phaser!.rate, progress), audioNow, rampTime);
							fxNodes.nodes.filters.forEach((f: BiquadFilterNode) => safeSetTargetAtTime(f.Q, lerp(startParams.phaser!.q, targetParams.phaser!.q, progress), audioNow, rampTime));
							safeSetTargetAtTime(fxNodes.nodes.wet.gain, lerp(startParams.phaser!.mix, targetParams.phaser!.mix, progress), audioNow, rampTime);
							safeSetTargetAtTime(fxNodes.nodes.dry.gain, 1 - lerp(startParams.phaser!.mix, targetParams.phaser!.mix, progress), audioNow, rampTime);
							break;
						case "tremolo":
							safeSetTargetAtTime(fxNodes.nodes.lfo.frequency, lerp(startParams.tremolo!.rate, targetParams.tremolo!.rate, progress), audioNow, rampTime);
							safeSetTargetAtTime(fxNodes.nodes.lfoGain.gain, lerp(startParams.tremolo!.depth, targetParams.tremolo!.depth, progress), audioNow, rampTime);
							break;
						case "eq":
							fxNodes.nodes.bands.forEach((band: BiquadFilterNode, i: number) => {
								safeSetTargetAtTime(band.gain, lerp(startParams.eq!.bands[i], targetParams.eq!.bands[i], progress), audioNow, rampTime);
							});
							break;
					}
				});

				// React State manipulation for non-AudioParam values (like granular)
				setEngines(currentEngines => currentEngines.map((engine, i) => {
					const start = startState.engines[i];
					const target = targetState.engines[i];
					if (!start || !target) return engine;

					return {
						...engine,
						sequencerPulses: Math.round(lerp(start.sequencerPulses, target.sequencerPulses, progress)),
						sequencerRotate: Math.round(lerp(start.sequencerRotate, target.sequencerRotate, progress)),
						sampler: {
							...engine.sampler,
							grainSize: lerp(start.sampler.grainSize, target.sampler.grainSize, progress),
							grainDensity: lerp(start.sampler.grainDensity, target.sampler.grainDensity, progress),
							playbackPosition: lerp(start.sampler.playbackPosition, target.sampler.playbackPosition, progress),
							positionJitter: lerp(start.sampler.positionJitter, target.sampler.positionJitter, progress),
						},
						 adsr: {
							attack: lerp(start.adsr.attack, target.adsr.attack, progress),
							decay: lerp(start.adsr.decay, target.adsr.decay, progress),
							sustain: lerp(start.adsr.sustain, target.adsr.sustain, progress),
							release: lerp(start.adsr.release, target.adsr.release, progress),
						}
					}
				}));

				setLfos((currentLfos) =>
					currentLfos.map((lfo, i) => {
						const start = startState.lfos[i];
						const target = targetState.lfos[i];
						if (!start || !target) return lfo;

						return {
							...lfo,
							rate: lerp(start.rate, target.rate, progress),
							depth: lerp(start.depth, target.depth, progress),
						};
					})
				);

				if (startState.filter1State && targetState.filter1State) {
					setFilter1State((prev) => ({
						...prev,
						cutoff: lerp(
							startState.filter1State.cutoff,
							targetState.filter1State.cutoff,
							progress
						),
						resonance: lerp(
							startState.filter1State.resonance,
							targetState.filter1State.resonance,
							progress
						),
					}));
				}

				if (startState.filter2State && targetState.filter2State) {
					setFilter2State((prev) => ({
						...prev,
						cutoff: lerp(
							startState.filter2State.cutoff,
							targetState.filter2State.cutoff,
							progress
						),
						resonance: lerp(
							startState.filter2State.resonance,
							targetState.filter2State.resonance,
							progress
						),
					}));
				}

				setMasterEffects((currentEffects) =>
					currentEffects.map((effect) => {
						const start = startState.masterEffects.find(
							(e: MasterEffect) => e.id === effect.id
						);
						const target = targetState.masterEffects.find(
							(e: MasterEffect) => e.id === effect.id
						);

						if (!start || !target || start.type !== target.type) return effect;

						const startParams = start.params;
						const targetParams = target.params;
						const newParams = { ...effect.params };

						switch (effect.type) {
							case "distortion":
								if (startParams.distortion && targetParams.distortion) {
									newParams.distortion = {
										...newParams.distortion!,
										amount: lerp(
											startParams.distortion.amount,
											targetParams.distortion.amount,
											progress
										),
									};
								}
								break;
							case "delay":
								if (startParams.delay && targetParams.delay) {
									newParams.delay = {
										...newParams.delay!,
										time: lerp(
											startParams.delay.time,
											targetParams.delay.time,
											progress
										),
										feedback: lerp(
											startParams.delay.feedback,
											targetParams.delay.feedback,
											progress
										),
										mix: lerp(
											startParams.delay.mix,
											targetParams.delay.mix,
											progress
										),
									};
								}
								break;
							case "reverb":
								if (startParams.reverb && targetParams.reverb) {
									newParams.reverb = {
										...newParams.reverb!,
										decay: lerp(
											startParams.reverb.decay,
											targetParams.reverb.decay,
											progress
										),
										mix: lerp(
											startParams.reverb.mix,
											targetParams.reverb.mix,
											progress
										),
									};
								}
								break;
							case "chorus":
								if (startParams.chorus && targetParams.chorus) {
									newParams.chorus = {
										...newParams.chorus!,
										rate: lerp(
											startParams.chorus.rate,
											targetParams.chorus.rate,
											progress
										),
										depth: lerp(
											startParams.chorus.depth,
											targetParams.chorus.depth,
											progress
										),
										mix: lerp(
											startParams.chorus.mix,
											targetParams.chorus.mix,
											progress
										),
									};
								}
								break;
							case "flanger":
								if (startParams.flanger && targetParams.flanger) {
									newParams.flanger = {
										...newParams.flanger!,
										rate: lerp(
											startParams.flanger.rate,
											targetParams.flanger.rate,
											progress
										),
										depth: lerp(
											startParams.flanger.depth,
											targetParams.flanger.depth,
											progress
										),
										feedback: lerp(
											startParams.flanger.feedback,
											targetParams.flanger.feedback,
											progress
										),
										mix: lerp(
											startParams.flanger.mix,
											targetParams.flanger.mix,
											progress
										),
										delay: lerp(
											startParams.flanger.delay,
											targetParams.flanger.delay,
											progress
										),
									};
								}
								break;
							case "phaser":
								if (startParams.phaser && targetParams.phaser) {
									newParams.phaser = {
										...newParams.phaser!,
										rate: lerp(
											startParams.phaser.rate,
											targetParams.phaser.rate,
											progress
										),
										q: lerp(
											startParams.phaser.q,
											targetParams.phaser.q,
											progress
										),
										mix: lerp(
											startParams.phaser.mix,
											targetParams.phaser.mix,
											progress
										),
									};
								}
								break;
							case "tremolo":
								if (startParams.tremolo && targetParams.tremolo) {
									newParams.tremolo = {
										...newParams.tremolo!,
										rate: lerp(
											startParams.tremolo.rate,
											targetParams.tremolo.rate,
											progress
										),
										depth: lerp(
											startParams.tremolo.depth,
											targetParams.tremolo.depth,
											progress
										),
										mix: lerp(
											startParams.tremolo.mix,
											targetParams.tremolo.mix,
											progress
										),
									};
								}
								break;
							case "eq":
								if (startParams.eq && targetParams.eq) {
									newParams.eq = {
										...newParams.eq!,
										bands: startParams.eq.bands.map((startBand, i) =>
											lerp(startBand, targetParams.eq!.bands[i], progress)
										),
									};
								}
								break;
						}

						return { ...effect, params: newParams };
					})
				);
			}

			if (progress < 1) {
				animationFrameId = requestAnimationFrame(animate);
			} else {
				// The morph is done. Set the final state, but be careful not to overwrite
				// structural changes the user might have made during the animation (e.g., adding/removing effects).
				const finalTargetState = morphTargetRef.current;

				if (finalTargetState) {
					// For master effects, we only update the PARAMS of effects that existed
					// at the start of the morph. This preserves any user additions/removals to the LIST.
					setMasterEffects(currentEffects => {
						// Create a map of target parameters for easy lookup.
						const targetParamsMap = new Map(
							finalTargetState.masterEffects.map((e: MasterEffect) => [e.id, e.params])
						);
						
						// Iterate over the CURRENT effects list.
						return currentEffects.map(effect => {
							// If the current effect was part of the morph...
							if (targetParamsMap.has(effect.id)) {
								// ...update its parameters to the final target state.
								return { ...effect, params: targetParamsMap.get(effect.id)! };
							}
							// Otherwise, this effect was added mid-morph, so we keep it as is.
							return effect;
						});
					});

					// For other states, we can set them directly from the target.
					setEngines(finalTargetState.engines);
					setLfos(finalTargetState.lfos);
					setFilter1State(finalTargetState.filter1State);
					setFilter2State(finalTargetState.filter2State);
				}
				
				setIsMorphing(false);
				// Clear refs for safety
				morphStartRef.current = null;
				morphTargetRef.current = null;
			}
		};

		animationFrameId = requestAnimationFrame(animate);
		return () => cancelAnimationFrame(animationFrameId);
	}, [isMorphing, audioContext, morphTime, isMorphSynced, morphSyncRateIndex, syncRates]);


	// Initialize functions
	const handleInitialize = useCallback((scope: string) => {
		const initial = getInitialState();
		if (scope.startsWith("engine")) {
			const targetEngine = initial.engines.find((e: EngineState) => e.id === scope);
			if (targetEngine) setEngines(prev => prev.map((e: EngineState) => e.id === scope ? targetEngine : e));
		}
		if (scope.startsWith("filter")) {
			if (scope === 'filter1') setFilter1State(initial.filter1);
			if (scope === 'filter2') setFilter2State(initial.filter2);
		}
		if (scope.startsWith("lfo")) {
			const targetLfo = initial.lfos.find((l: LFOState) => l.id === scope);
			if (targetLfo) setLfos(prev => prev.map((l: LFOState) => l.id === scope ? targetLfo : l));
		}
		if (scope.startsWith("masterEffect")) {
			// This would require more specific logic
		}
	}, []);
	
	const handleInitializeAll = useCallback(() => {
		saveToHistory();
		if (window.confirm("Are you sure you want to initialize the entire patch?")) {
			const initial = getInitialState();
			setEngines(initial.engines);
			setLfos(initial.lfos);
			setFilter1State(initial.filter1);
			setFilter2State(initial.filter2);
			setMasterEffects(initial.masterEffects);
		}
	}, []);

	const handlePanic = useCallback(() => {
		if (!audioContext || !masterVolumeNodeRef.current) return;
		setIsTransportPlaying(false); // Stop sequencers

		// Use the robust allNotesOff function
		allNotesOff();
		
		// Flush effect tails by quickly ramping master volume
		const now = audioContext.currentTime;
		masterVolumeNodeRef.current.gain.cancelScheduledValues(now);
		masterVolumeNodeRef.current.gain.setValueAtTime(masterVolumeNodeRef.current.gain.value, now);
		masterVolumeNodeRef.current.gain.linearRampToValueAtTime(0.0, now + 0.05);
		masterVolumeNodeRef.current.gain.linearRampToValueAtTime(masterVolume, now + 0.3);

	}, [audioContext, masterVolume, allNotesOff]);

	const handleRecordSampleRequest = useCallback(async () => {
		if (!audioContext) return null;
		if (audioInputStream) {
			audioInputStream.getTracks().forEach(track => track.stop());
		}
		try {
			const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
			setAudioInputStream(stream);
			return stream;
		} catch (err) {
			console.error("Microphone access denied:", err);
			alert("Microphone access is required for recording.");
			return null;
		}
	}, [audioContext, audioInputStream]);

	const handleRecordSample = useCallback((engineId: string, buffer: AudioBuffer) => {
		samplesRef.current.set(engineId, buffer);
		setEngines(prev => prev.map(e => e.id === engineId ? {...e, sampler: {...e.sampler, sampleName: `Rec-${new Date().toLocaleTimeString()}`}} : e));
	}, []);

	const handleToggleLiveInput = useCallback(async (engineId: string, enabled: boolean) => {
		if (!audioContext) return;
		const engineNodes = audioNodesRef.current.get(engineId);
		if (!engineNodes) return;

		if (enabled) {
			try {
				const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
				const source = audioContext.createMediaStreamSource(stream);
				// Connect live input to sampler's gain, which then goes to the main engine mixer
				source.connect(engineNodes.sampler.volumeGain);
				engineNodes.sampler.liveInputSource = source; // Store for later disconnection
				setAudioInputStream(stream);
				setEngines(prev => prev.map(e => e.id === engineId ? {...e, sampler: {...e.sampler, liveInputEnabled: true}} : e));
			} catch (err) {
				console.error("Could not get live audio input", err);
				 alert("Microphone access is required for live input.");
			}
		} else {
			if (engineNodes.sampler.liveInputSource) {
				engineNodes.sampler.liveInputSource.disconnect();
				engineNodes.sampler.liveInputSource = undefined;
			}
			if (audioInputStream) {
				audioInputStream.getTracks().forEach(track => track.stop());
				setAudioInputStream(null);
			}
			setEngines(prev => prev.map(e => e.id === engineId ? {...e, sampler: {...e.sampler, liveInputEnabled: false}} : e));
		}
	}, [audioContext, audioInputStream]);

	// Sample Loading
	const handleLoadSample = useCallback(async (engineId: string, file: File) => {
		if (!audioContext) return;
		try {
			const arrayBuffer = await file.arrayBuffer();
			const audioBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0)); // Decode copy
			
			// Save original buffer to DB
			const sampleId = generateId();
			await saveSampleToDB(sampleId, arrayBuffer);

			samplesRef.current.set(engineId, audioBuffer);
			setEngines(prev => prev.map(e => e.id === engineId ? {
				...e, 
				sampler: {
					...e.sampler, 
					sampleName: file.name,
					sampleId: sampleId
				}
			} : e));
		} catch (error) {
			console.error("Error decoding audio file:", error);
			alert("Failed to load audio file. Please try a different format.");
		}
	}, [audioContext]);
	
	const handleSnapToScale = useCallback((engineId: string) => {
		const engine = engines.find(e => e.id === engineId);
		if (!engine || scaleFrequencies.length === 0) return;
		
		const currentFreq = engine.synth.frequency;
		const closest = scaleFrequencies.reduce((prev, curr) => 
			Math.abs(curr.value - currentFreq) < Math.abs(prev.value - currentFreq) ? curr : prev
		);
		
		setEngines(prev => prev.map(e => e.id === engineId ? {...e, synth: {...e.synth, frequency: closest.value}} : e));

	}, [engines, scaleFrequencies]);

	const handleEngineUpdate = useCallback((engineId: string, updates: Partial<EngineState>) => {
		setEngines(prevEngines =>
			prevEngines.map(engine => {
				if (engine.id === engineId) {
					const oldEngine = engine;
					const newEngineState = { ...oldEngine, ...updates };

					const stepsChanged = updates.sequencerSteps !== undefined && updates.sequencerSteps !== oldEngine.sequencerSteps;
					const pulsesChanged = updates.sequencerPulses !== undefined && updates.sequencerPulses !== oldEngine.sequencerPulses;
                    const rotateChanged = updates.sequencerRotate !== undefined && updates.sequencerRotate !== oldEngine.sequencerRotate;

					if (stepsChanged) {
						const newSteps = newEngineState.sequencerSteps;
						// Clamp pulses to be within the new valid range.
						if (newEngineState.sequencerPulses > newSteps) {
							newEngineState.sequencerPulses = newSteps;
						}
						// Clamp rotate
						if (newEngineState.sequencerRotate >= newSteps) {
							newEngineState.sequencerRotate = newSteps > 0 ? newSteps - 1 : 0;
						}

						// Resize melodic sequence
						const oldMelodic = oldEngine.melodicSequence;
						const newMelodic = Array(newSteps).fill(oldMelodic[0] || 220);
						for (let i = 0; i < newSteps; i++) {
							newMelodic[i] = oldMelodic[i % oldMelodic.length];
						}
						newEngineState.melodicSequence = newMelodic;
					}

					// Regenerate euclidean sequence if any rhythmic parameter changed
					if (stepsChanged || pulsesChanged || rotateChanged) {
						const pattern = generateEuclideanPattern(newEngineState.sequencerSteps, newEngineState.sequencerPulses);
						newEngineState.sequence = rotatePattern(pattern, newEngineState.sequencerRotate);
					}

					return newEngineState;
				}
				return engine;
			})
		);
	}, []);

	const handleToggleTransport = useCallback(() => {
		const newState = !isTransportPlaying;
		setIsTransportPlaying(newState);

		if (newState) {
			lastLocalStartRef.current = Date.now();
		}

		if (clockSource === "link") {
			// Emit to server to start/stop Ableton
			linkSocketRef.current?.emit("start-stop", newState);

			if (newState) {
				// If starting, enable quantized launch
				shouldQuantizeStart.current = true;
				isWaitingForLinkStart.current = true;
			} else {
				// If stopping, reset
				isWaitingForLinkStart.current = false;
				shouldQuantizeStart.current = false;
				linkStartBeatRef.current = null;
			}
		}
	}, [isTransportPlaying, clockSource]);

	return (
		<div className="app">
			{!isInitialized && (
				<div className="init-overlay">
					<button onClick={initializeAudio}>Initialize Synthesizer</button>
				</div>
			)}
			{isInitialized && masterAnalyserNodeRef.current && (
				<div className="app-container">
					<TopBar
						masterVolume={masterVolume}
						setMasterVolume={setMasterVolume}
						bpm={bpm}
						setBPM={setBPM}
						isTransportPlaying={isTransportPlaying}
						onToggleTransport={handleToggleTransport}
						onPanic={allNotesOff}
						midiInputs={midiInputs}
						selectedMidiInputId={selectedMidiInputId}
						onMidiInputChange={setSelectedMidiInputId}
						selectedMidiClockInputId={selectedMidiClockInputId}
						onMidiClockInputChange={setSelectedMidiClockInputId}
						midiActivity={midiActivity}
						midiClockActivity={midiClockActivity}
						lockState={lockState}
						onToggleLock={handleToggleLock}
						clockSource={clockSource}
						onClockSourceChange={setClockSource}
						linkPhase={linkPhase}
						harmonicTuningSystem={harmonicTuningSystem}
						setHarmonicTuningSystem={setHarmonicTuningSystem}
						scale={scale}
						setScale={setScale}
						transpose={transpose}
						setTranspose={setTranspose}
						voicingMode={voicingMode}
						setVoicingMode={setVoicingMode}
						glideTime={glideTime}
						setGlideTime={setGlideTime}
						isGlideSynced={isGlideSynced}
						setIsGlideSynced={setIsGlideSynced}
						glideSyncRateIndex={glideSyncRateIndex}
						setGlideSyncRateIndex={setGlideSyncRateIndex}
						glideSyncRates={syncRates}
						onRandomize={handleRandomize}
						onInitializeAll={handleInitializeAll}
						linkLatency={linkLatency}
						setLinkLatency={setLinkLatency}
						onUndo={handleUndo}
						onRedo={handleRedo}
					>
						<PresetManager
							currentBpm={bpm}
							onLoadPreset={async (preset) => {
								saveToHistory();
								// Stop everything first
								allNotesOff();
								setIsTransportPlaying(false);
								
								// Load state
								const d = preset.data;
								setEngines(d.engines);
								setLfos(d.lfos);
								setFilter1State(d.filter1);
								setFilter2State(d.filter2);
								setFilterRouting(d.filterRouting);
								setMasterEffects(d.masterEffects);
								setBPM(d.bpm);
								setScale(d.scale);
								setTranspose(d.transpose);
								setHarmonicTuningSystem(d.harmonicTuningSystem);
								setVoicingMode(d.voicingMode);
								setGlideTime(d.glideTime);
								setIsGlideSynced(d.isGlideSynced);
								setGlideSyncRateIndex(d.glideSyncRateIndex);
								setIsGlobalAutoRandomEnabled(d.isGlobalAutoRandomEnabled);
								setGlobalAutoRandomInterval(d.globalAutoRandomInterval);
								setGlobalAutoRandomMode(d.globalAutoRandomMode);
								setIsAutoRandomSynced(d.isAutoRandomSynced);
								setAutoRandomSyncRateIndex(d.autoRandomSyncRateIndex);
								setMorphTime(d.morphTime ?? 1000);
								setIsMorphSynced(d.isMorphSynced);
								setMorphSyncRateIndex(d.morphSyncRateIndex);

								// Load samples from DB
								// Load samples from DB
								samplesRef.current.clear(); // Clear old samples first
								const sampleLoadPromises = d.engines.map(async (engine) => {
									if (engine.sampler.sampleId) {
										console.log(`[Preset] Loading sample for engine ${engine.id} with ID ${engine.sampler.sampleId}`);
										try {
											const buffer = await getSampleFromDB(engine.sampler.sampleId);
											if (buffer) {
												console.log(`[Preset] Got buffer from DB, size: ${buffer.byteLength}`);
												if (audioContext) {
													// Slice the buffer to ensure we pass a fresh copy to decodeAudioData
													// This prevents issues if the DB buffer is somehow treated as detached or shared
													const audioBuffer = await audioContext.decodeAudioData(buffer.slice(0));
													console.log(`[Preset] Decoded audio buffer: ${audioBuffer.duration}s`);
													samplesRef.current.set(engine.id, audioBuffer);
												} else {
													console.error("[Preset] AudioContext is missing during sample load");
												}
											} else {
												console.warn(`[Preset] Sample not found in DB for ID ${engine.sampler.sampleId}`);
												alert(`Sample for ${engine.name} not found in database.`);
											}
										} catch (e) {
											console.error(`[Preset] Failed to load sample for engine ${engine.id}`, e);
											alert(`Failed to load sample for ${engine.name}.`);
										}
									} else {
										console.log(`[Preset] No sample ID for engine ${engine.id}`);
									}
								});
								
								await Promise.all(sampleLoadPromises);
								console.log("[Preset] All samples loaded");
								

								// Force a state update to ensure everything is synced
								setEngines(prev => [...prev]);
								
								if (audioContext?.state === 'suspended') {
									audioContext.resume();
								}
							}}
							getCurrentState={() => ({
								engines: latestStateRef.current.engines,
								lfos: latestStateRef.current.lfos,
								filter1: filter1State,
								filter2: filter2State,
								filterRouting: filterRouting,
								masterEffects: masterEffects,
								bpm: bpm,
								scale: scale,
								transpose: transpose,
								harmonicTuningSystem: harmonicTuningSystem,
								voicingMode: voicingMode,
								glideTime: glideTime,
								isGlideSynced: isGlideSynced,
								glideSyncRateIndex: glideSyncRateIndex,
								isGlobalAutoRandomEnabled: isGlobalAutoRandomEnabled,
								globalAutoRandomInterval: globalAutoRandomInterval,
								globalAutoRandomMode: globalAutoRandomMode,
								isAutoRandomSynced: isAutoRandomSynced,
								autoRandomSyncRateIndex: autoRandomSyncRateIndex,
								morphTime: morphTime,
								isMorphSynced: isMorphSynced,
								morphSyncRateIndex: morphSyncRateIndex,
							})}
						/>
					</TopBar>
	
					<MainControlPanel
						onRandomize={handleRandomize}
						onInitializeAll={handleInitializeAll}
						isMorphing={isMorphing}
						morphTime={morphTime}
						setMorphTime={setMorphTime}
						isMorphSynced={isMorphSynced}
						setIsMorphSynced={setIsMorphSynced}
						morphSyncRateIndex={morphSyncRateIndex}
						setMorphSyncRateIndex={setMorphSyncRateIndex}
						voicingMode={voicingMode}
						setVoicingMode={setVoicingMode}
						glideTime={glideTime}
						setGlideTime={setGlideTime}
						isGlideSynced={isGlideSynced}
						setIsGlideSynced={setIsGlideSynced}
						glideSyncRateIndex={glideSyncRateIndex}
						setGlideSyncRateIndex={setGlideSyncRateIndex}
						glideSyncRates={syncRates}
						isGlobalAutoRandomEnabled={isGlobalAutoRandomEnabled}
						setIsGlobalAutoRandomEnabled={setIsGlobalAutoRandomEnabled}
						globalAutoRandomInterval={globalAutoRandomInterval}
						setGlobalAutoRandomInterval={setGlobalAutoRandomInterval}
						globalAutoRandomMode={globalAutoRandomMode}
						setGlobalAutoRandomMode={setGlobalAutoRandomMode}
						isAutoRandomSynced={isAutoRandomSynced}
						setIsAutoRandomSynced={setIsAutoRandomSynced}
						autoRandomSyncRateIndex={autoRandomSyncRateIndex}
						setAutoRandomSyncRateIndex={setAutoRandomSyncRateIndex}
						syncRates={syncRates}
					/>

					<div className="master-visualizer-container">
						<div className="visualizer-wrapper">
							<div className="visualizer-label">MASTER</div>
							<Visualizer analyserNode={masterAnalyserNodeRef.current} type="waveform" />
						</div>
					</div>
	
					<div className="channels-container">
						{engines.map((engine) => (
							<EngineControls
								key={engine.id}
								engine={engine}
								onUpdate={handleEngineUpdate}
								onLayerUpdate={(engineId, layer, updates) =>
									setEngines(prev => prev.map(e => e.id === engineId ? {...e, [layer]: {...e[layer], ...updates}} : e))
								}
								onLoadSample={handleLoadSample}
								onRecordSampleRequest={handleRecordSampleRequest}
								onRecordSample={handleRecordSample}
								onToggleLiveInput={handleToggleLiveInput}
								onRandomize={handleRandomize}
								onInitialize={handleInitialize}
								analyserNode={audioNodesRef.current.get(engine.id)?.analyser}
								currentStep={sequencerCurrentSteps.get(engine.id) ?? 0}
								isTransportPlaying={isTransportPlaying}
								audioContext={audioContext}
								lockState={lockState}
								onToggleLock={handleToggleLock}
								harmonicTuningSystem={harmonicTuningSystem}
								scaleFrequencies={scaleFrequencies}
								onSnapToScale={handleSnapToScale}
								onOpenMelodyEditor={setEditingMelodyEngineId}
							/>
						))}
					</div>
			
					{editingMelodyEngineId && (
						<MelodyEditor
							engine={engines.find((e) => e.id === editingMelodyEngineId)!}
							scaleFrequencies={scaleFrequencies}
							onUpdateSequence={(id, seq) =>
								handleEngineUpdate(id, { melodicSequence: seq })
							}
							onUpdateRhythm={(id, seq) =>
								handleEngineUpdate(id, { sequence: seq })
							}
							onClose={() => setEditingMelodyEngineId(null)}
							currentStep={engineSchedulerStates.current.get(editingMelodyEngineId)?.currentStep || 0}
						/>
					)}
					
					{editingLfoId && (
						<LfoEditorModal
							lfoState={lfos.find(l => l.id === editingLfoId)!}
							onUpdate={(updates) => setLfos(prev => prev.map(l => l.id === editingLfoId ? {...l, ...updates} : l))}
							onClose={() => setEditingLfoId(null)}
						/>
					)}
					<div className="processing-container">
						<div className="filters-container">
							 <div className="filters-container-header">
								<h2>Filters</h2>
								<div className="filter-routing-switch">
									<button className={filterRouting === 'series' ? 'active' : ''} onClick={() => setFilterRouting('series')}>Series</button>
									<button className={filterRouting === 'parallel' ? 'active' : ''} onClick={() => setFilterRouting('parallel')}>Parallel</button>
								</div>
							</div>
							<div className="filters-grid">
								<MasterFilterControls
									title="Filter 1"
									filterState={filter1State}
									onUpdate={(updates) => setFilter1State(s => ({...s, ...updates}))}
									onRandomize={handleRandomize}
									onInitialize={handleInitialize}
									lockState={lockState}
									onToggleLock={handleToggleLock}
								/>
								{/* FIX: Corrected missing props for MasterFilterControls and fixed malformed onRandomize prop */}
								<MasterFilterControls
									title="Filter 2"
									filterState={filter2State}
									onUpdate={(updates) => setFilter2State(s => ({...s, ...updates}))}
									onRandomize={handleRandomize}
									onInitialize={handleInitialize}
									lockState={lockState}
									onToggleLock={handleToggleLock}
								/>
							</div>
						</div>
						<MasterEffects
							effects={masterEffects}
							setEffects={setMasterEffects}
							onRandomize={handleRandomize}
							onInitialize={handleInitialize}
							lockState={lockState}
							onToggleLock={handleToggleLock}
						/>
					</div>

					<BottomTabs 
						lfoStates={lfos}
						handleLfoUpdate={(lfoId, updates) => setLfos(prev => prev.map(l => l.id === lfoId ? {...l, ...updates} : l))}
						engineStates={engines}
						handleEngineUpdate={handleEngineUpdate}
						onRandomize={handleRandomize}
						onInitialize={handleInitialize}
						bpm={bpm}
						lockState={lockState}
						onToggleLock={handleToggleLock}
						onEditLfo={setEditingLfoId}
					/>
				</div>
			)}
		</div>
	);
};

const container = document.getElementById("root");
if (container) {
	const root = createRoot(container);
	root.render(<App />);
}