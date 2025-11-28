

import React, {
	useState,
	useRef,
	useEffect,
	useCallback,
	useMemo,
} from "react";
import { createRoot } from "react-dom/client";

// --- Type Definitions ---
type OscillatorType = "sine" | "square" | "sawtooth" | "triangle";
type NoiseType = "white" | "pink" | "brown";
type LFO_Shape = "sine" | "square" | "sawtooth" | "triangle" | "ramp";
type FilterType = "lowpass" | "highpass" | "bandpass" | "notch";
type RandomizeMode = "chaos" | "melodic" | "rhythmic";
type EngineLayerType = "synth" | "noise" | "sampler";
type DistortionMode = "overdrive" | "soft clip" | "hard clip" | "foldback";
type FilterRouting = "series" | "parallel";
type VoicingMode = "poly" | "mono" | "legato";

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
	onRandomize: (mode: RandomizeMode, scope: string) => void;
	onInitializeAll: () => void;
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
	// New Auto-Random Props
	isGlobalAutoRandomEnabled: boolean;
	setIsGlobalAutoRandomEnabled: (enabled: boolean) => void;
	globalAutoRandomInterval: number;
	setGlobalAutoRandomInterval: (interval: number) => void;
	globalAutoRandomMode: RandomizeMode;
	setGlobalAutoRandomMode: (mode: RandomizeMode) => void;
	isAutoRandomSynced: boolean;
	setIsAutoRandomSynced: (synced: boolean) => void;
	autoRandomSyncRateIndex: number;
	setAutoRandomSyncRateIndex: (index: number) => void;
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
}

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
];
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
	"sawtooth",
	"ramp",
	"triangle",
];
const filterTypes: readonly FilterType[] = [
	"lowpass",
	"highpass",
	"bandpass",
	"notch",
];
const lfoSyncRates = ["1/16", "1/8", "1/4", "1/2", "1"];
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
			melodicSequence: Array(16).fill(220), // Default melodic sequence
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
			melodicSequence: Array(12).fill(440), // Default melodic sequence
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
			melodicSequence: Array(7).fill(110), // Default melodic sequence
		},
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
			},
			{
				id: "lfo3",
				name: "LFO 3",
				rate: 0.3,
				depth: 0.7,
				shape: "sawtooth" as LFO_Shape,
				sync: true,
				syncRate: "1/2",
				routing: { ...DEFAULT_LFO_ROUTING_STATE },
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
					time: shouldRandomize("rhythmic") ? getRandom(0.01, 2) : p.time,
					feedback: shouldRandomize("melodic") ? getRandom(0, 0.95) : p.feedback,
					mix: shouldRandomize("melodic") ? getRandom(0.1, 1) : p.mix,
				},
			};
		}
		case "reverb": {
			const p = currentParams.reverb!;
			if (!shouldRandomize("melodic")) return { reverb: p };
			return {
				reverb: {
					decay: getRandom(0.5, 8),
					mix: getRandom(0.1, 1),
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
					feedback: shouldRandomize("melodic") ? getRandom(0, 0.95) : p.feedback,
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
            const denominator = parseFloat(parts[1]);
            if (denominator) noteValueInBeats = 4 / denominator;
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
        case "sawtooth":
            y = 1 - 2 * phase; // Correct sawtooth
            break;
        case "ramp":
            y = 2 * phase - 1;
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
			const octave = Math.floor(note / 12) - 4;
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
}) => {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const pattern = useMemo(
		() => rotatePattern(generateEuclideanPattern(steps, pulses), rotate),
		[steps, pulses, rotate]
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
const LockIcon = ({
	isLocked,
	onClick,
	title,
}: {
	isLocked: boolean;
	onClick: () => void;
	title: string;
}) => (
	<button
		className={`lock-icon ${isLocked ? "locked" : ""}`}
		onClick={onClick}
		title={title}
	>
		<svg
			xmlns="http://www.w3.org/2000/svg"
			viewBox="0 0 24 24"
			fill="currentColor"
		>
			{isLocked ? (
				<path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"></path>
			) : (
				<path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6h2c0-1.65 1.35-3 3-3s3 1.35 3 3v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z"></path>
			)}
		</svg>
	</button>
);

const AccordionIcon = ({ isExpanded }: { isExpanded: boolean }) => (
	<svg
		xmlns="http://www.w3.org/2000/svg"
		viewBox="0 0 24 24"
		fill="currentColor"
		style={{
			width: "16px",
			height: "16px",
			transition: "transform 0.2s",
			transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)",
		}}
	>
		<path d="M10 17l5-5-5-5v10z" />
	</svg>
);

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
	midiActivity,
	lockState,
	onToggleLock,
}) => {
	return (
		<div className="top-bar">
			<div className="top-bar-group">
				<h2>Poly-Rhythm Synth</h2>
			</div>
			<div className="top-bar-group">
				<label>MIDI Input</label>
				<div
					className="midi-indicator"
					style={{
						backgroundColor: midiActivity ? "var(--secondary-color)" : "#333",
					}}
				/>
				<select
					value={selectedMidiInputId || ""}
					onChange={(e) => onMidiInputChange(e.target.value)}
					disabled={midiInputs.length === 0}
				>
					<option value="">
						{midiInputs.length > 0 ? "Select Device" : "No MIDI Devices"}
					</option>
					{midiInputs.map((input) => (
						<option key={input.id} value={input.id}>
							{input.name}
						</option>
					))}
				</select>
			</div>
			<div className="top-bar-group">
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
					/>
					<span>{Math.round(masterVolume * 100)}%</span>
					<LockIcon
						isLocked={lockState.master.volume}
						onClick={() => onToggleLock("master.volume")}
						title="Lock Master Volume"
					/>
				</div>
			</div>
			<div className="top-bar-group">
				<label>BPM</label>
				<input
					type="range"
					min="30"
					max="240"
					step="1"
					value={bpm}
					onChange={(e) => setBPM(parseInt(e.target.value))}
				/>
				<span>{bpm}</span>
			</div>
			<div className="top-bar-group">
				<button
					onClick={onToggleTransport}
					className={isTransportPlaying ? "active" : ""}
				>
					{isTransportPlaying ? "Stop" : "Play"}
				</button>
				<button onClick={onPanic} className="panic-button">
					Panic
				</button>
			</div>
		</div>
	);
};

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
	harmonicTuningSystem,
	setHarmonicTuningSystem,
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
	scale,
	setScale,
	transpose,
	setTranspose,
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
		<div className="main-control-panel">
			<div className="sub-control-group">
				<h2>Randomorph</h2>
				<div className="control-row">
					<label>Harmonic Mode</label>
					<select
						value={harmonicTuningSystem}
						onChange={(e) =>
							setHarmonicTuningSystem(e.target.value as TuningSystem)
						}
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
				<div className="control-row">
					<label>Actions</label>
					<div className="randomizer-buttons-group">
						<button
							className="icon-button init-button"
							onClick={onInitializeAll}
							title="Initialize Patch"
						>
							<InitializeIcon />
						</button>
						<button
							className="icon-button"
							onClick={() => onRandomize("chaos", "global")}
							title="Global Chaos Morph"
						>
							<ChaosIcon />
						</button>
						<button
							className="icon-button"
							onClick={() => onRandomize("melodic", "global")}
							title="Global Melodic Morph"
						>
							<MelodicIcon />
						</button>
						<button
							className="icon-button"
							onClick={() => onRandomize("rhythmic", "global")}
							title="Global Rhythmic Morph"
						>
							<RhythmicIcon />
						</button>
					</div>
				</div>
				<div className="control-row">
					<label>Morph Time</label>
					<div className="control-value-wrapper">
						<input
							type="range"
							min="100"
							max="8000"
							step="10"
							value={morphTime}
							onChange={(e) => setMorphTime(parseFloat(e.target.value))}
							disabled={isMorphing || isMorphSynced}
						/>
						<span>{morphTime.toFixed(0)}ms</span>
					</div>
					<button
						className={`small ${isMorphSynced ? "active" : ""}`}
						onClick={() => setIsMorphSynced(!isMorphSynced)}
					>
						Sync
					</button>
					{isMorphSynced && (
						<select
							value={morphSyncRateIndex}
							onChange={(e) => setMorphSyncRateIndex(parseInt(e.target.value))}
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
			<div className="sub-control-group">
				<h2>Voicing & Glide</h2>
				<div className="voicing-switch">
					<button
						className={voicingMode === "poly" ? "active" : ""}
						onClick={() => setVoicingMode("poly")}
					>
						Poly
					</button>
					<button
						className={voicingMode === "mono" ? "active" : ""}
						onClick={() => setVoicingMode("mono")}
					>
						Mono
					</button>
					<button
						className={voicingMode === "legato" ? "active" : ""}
						onClick={() => setVoicingMode("legato")}
					>
						Legato
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
					/>
					<span>{glideTime.toFixed(0)}ms</span>
				</div>
				<button
					className={`small ${isGlideSynced ? "active" : ""}`}
					onClick={() => setIsGlideSynced(!isGlideSynced)}
				>
					Sync
				</button>
				{isGlideSynced && (
					<select
						value={glideSyncRateIndex}
						onChange={(e) => setGlideSyncRateIndex(parseInt(e.target.value))}
					>
						{glideSyncRates.map((rate, i) => (
							<option key={i} value={i}>
								{rate}
							</option>
						))}
					</select>
				)}
			</div>
			<div className="sub-control-group">
				<h2>Global Settings</h2>
				{harmonicTuningSystem !== "solfeggio" &&
					harmonicTuningSystem !== "wholesome_scale" && (
						<div className="control-row">
							<label>Scale</label>
							<select
								value={scale}
								onChange={(e) => setScale(e.target.value as ScaleName)}
							>
								{Object.keys(musicalScales).map((scaleName) => (
									<option key={scaleName} value={scaleName}>
										{scaleName.charAt(0).toUpperCase() + scaleName.slice(1).replace(/([A-Z])/g, ' $1').trim()}
									</option>
								))}
							</select>
						</div>
					)}
				<div className="control-row">
					<label>Transpose</label>
					<div className="control-value-wrapper">
						<input
							type="range"
							min="-24"
							max="24"
							step="1"
							value={transpose}
							onChange={(e) => setTranspose(parseInt(e.target.value))}
						/>
						<span>{transpose} st</span>
					</div>
				</div>
			</div>
			<div className="sub-control-group">
				<h2>Auto-Random</h2>
				<div className="control-row">
					<label>Enable</label>
					<button
						className={`small ${isGlobalAutoRandomEnabled ? "active" : ""}`}
						onClick={() =>
							setIsGlobalAutoRandomEnabled(!isGlobalAutoRandomEnabled)
						}
					>
						{isGlobalAutoRandomEnabled ? "On" : "Off"}
					</button>
				</div>
				<div className="control-row">
					<label>Interval</label>
					<div className="control-value-wrapper">
						<input
							type="range"
							min="1000"
							max="60000"
							step="1000"
							value={globalAutoRandomInterval}
							onChange={(e) =>
								setGlobalAutoRandomInterval(parseInt(e.target.value))
							}
							disabled={!isGlobalAutoRandomEnabled || isAutoRandomSynced}
						/>
						<span>{globalAutoRandomInterval / 1000} s</span>
					</div>
					<button
						className={`small ${isAutoRandomSynced ? "active" : ""}`}
						onClick={() => setIsAutoRandomSynced(!isAutoRandomSynced)}
					>
						Sync
					</button>
					{isAutoRandomSynced && (
						<select
							value={autoRandomSyncRateIndex}
							onChange={(e) =>
								setAutoRandomSyncRateIndex(parseInt(e.target.value))
							}
						>
							{syncRates.map((rate, i) => (
								<option key={i} value={i}>
									{rate}
								</option>
							))}
						</select>
					)}
				</div>
				<div className="control-row">
					<label>Mode</label>
					<select
						value={globalAutoRandomMode}
						onChange={(e) =>
							setGlobalAutoRandomMode(e.target.value as RandomizeMode)
						}
						disabled={!isGlobalAutoRandomEnabled}
					>
						<option value="chaos">Chaos</option>
						<option value="melodic">Melodic</option>
						<option value="rhythmic">Rhythmic</option>
					</select>
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
}) => {
	const [activeTab, setActiveTab] = useState<EngineLayerType>("sampler");
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
							className={`small seq-toggle ${
								engine.sequencerEnabled ? "active" : ""
							}`}
							onClick={() =>
								onUpdate(engine.id, {
									sequencerEnabled: !engine.sequencerEnabled,
								})
							}
						>
							SEQ
						</button>
						<button
							className={`small midi-toggle ${
								engine.midiControlled ? "active" : ""
							}`}
							onClick={() =>
								onUpdate(engine.id, { midiControlled: !engine.midiControlled })
							}
						>
							MIDI
						</button>
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
						/>
					</div>
				)}
			</div>

			<div className="control-row">
				<label>Rate</label>
				<div className="control-with-lock">
					<select
						value={engine.sequencerRate}
						onChange={(e) =>
							onUpdate(engine.id, { sequencerRate: e.target.value })
						}
					>
						{sequencerRates.map((rate) => (
							<option key={rate} value={rate}>
								{rate}
							</option>
						))}
					</select>
					<LockIcon
						isLocked={getLock(`engines.${engine.id}.sequencerRate`)}
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
						value={filterState.cutoff}
						onChange={(e) => onUpdate({ cutoff: parseFloat(e.target.value) })}
						disabled={!filterState.enabled}
					/>
					<span>{filterState.cutoff.toFixed(0)} Hz</span>
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
						value={filterState.resonance}
						onChange={(e) =>
							onUpdate({ resonance: parseFloat(e.target.value) })
						}
						disabled={!filterState.enabled}
					/>
					<span>{filterState.resonance.toFixed(1)}</span>
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
}> = React.memo(({ shape, rate, isSynced, bpm, syncRate, depth }) => {
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
				const denominator = parseFloat(parts[1]);
				if (denominator) noteValueInBeats = 4 / denominator;
			} else {
				const val = parseFloat(cleanRate);
				if (val) noteValueInBeats = 4 / val;
			}
			const durationInSeconds = noteValueInBeats * (60 / bpm);
			if (durationInSeconds > 0) lfoFrequency = 1 / durationInSeconds;
		}

		const draw = (time: number) => {
			const { width, height } = canvas;
			ctx.clearRect(0, 0, width, height);
			ctx.strokeStyle = "#a45ee5"; // --primary-color
			ctx.lineWidth = 2;

			ctx.beginPath();

			const lfoRate = lfoFrequency;

			for (let x = 0; x < width; x++) {
				const normalizedX = x / width;
				const phase = ((time / 1000) * lfoRate + normalizedX) % 1;

				let y;
				switch (shape) {
					case "sine":
						y = Math.sin(phase * 2 * Math.PI);
						break;
					case "square":
						y = phase < 0.5 ? 1 : -1;
						break;
					case "sawtooth":
						y = 2 * (phase - Math.floor(0.5 + phase));
						break; // Inverted saw
					case "ramp":
						y = 2 * phase - 1;
						break;
					case "triangle":
						y = 2 * Math.abs(2 * (phase - Math.floor(phase + 0.5))) - 1;
						break;
					default:
						y = 0;
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

const LFOControls: React.FC<LFOControlsProps> = ({
	lfoState,
	onUpdate,
	onRandomize,
	onInitialize,
	bpm,
	lockState,
	onToggleLock,
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
									{distortionModes.map((mode) => (
										<option key={mode} value={mode}>
											{mode}
										</option>
									))}
								</select>
							</div>
							<div className="control-row">
								<label>Amount</label>
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
							</div>
						</>
					)}
					{type === "delay" && p.delay && (
						<>
							<div className="control-row">
								<label>Time</label>
								<input
									type="range"
									min="0"
									max="2"
									step="0.01"
									value={p.delay.time}
									onChange={(e) =>
										onUpdate(effect.id, {
											delay: { ...p.delay!, time: parseFloat(e.target.value) },
										})
									}
								/>
								<span>{p.delay.time.toFixed(2)}s</span>
							</div>
							<div className="control-row">
								<label>Feedback</label>
								<input
									type="range"
									min="0"
									max="0.95"
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
							</div>
							<div className="control-row">
								<label>Mix</label>
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
							</div>
						</>
					)}
					{type === "reverb" && p.reverb && (
						<>
							<div className="control-row">
								<label>Decay</label>
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
							</div>
							<div className="control-row">
								<label>Mix</label>
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
							</div>
						</>
					)}
					{type === "chorus" && p.chorus && (
						<>
							<div className="control-row">
								<label>Rate</label>
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
							</div>
							<div className="control-row">
								<label>Depth</label>
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
							</div>
							<div className="control-row">
								<label>Mix</label>
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
							</div>
						</>
					)}
					{type === "flanger" && p.flanger && (
						<>
							<div className="control-row">
								<label>Rate</label>
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
							</div>
							<div className="control-row">
								<label>Depth</label>
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
							</div>
							<div className="control-row">
								<label>Feedback</label>
								<input
									type="range"
									min="0"
									max="0.95"
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
							</div>
							<div className="control-row">
								<label>Mix</label>
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
							</div>
						</>
					)}
					{type === "phaser" && p.phaser && (
						<>
							<div className="control-row">
								<label>Rate</label>
								<input
									type="range"
									min="0.1"
									max="8"
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
							</div>
							<div className="control-row">
								<label>Stages</label>
								<input
									type="range"
									min="2"
									max="12"
									step="2"
									value={p.phaser.stages}
									onChange={(e) =>
										onUpdate(effect.id, {
											phaser: {
												...p.phaser!,
												stages: parseInt(e.target.value),
											},
										})
									}
								/>
							</div>
							<div className="control-row">
								<label>Q</label>
								<input
									type="range"
									min="0"
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
							</div>
							<div className="control-row">
								<label>Mix</label>
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
							</div>
						</>
					)}
					{type === "tremolo" && p.tremolo && (
						<>
							<div className="control-row">
								<label>Rate</label>
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
							</div>
							<div className="control-row">
								<label>Depth</label>
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
							</div>
							<div className="control-row">
								<label>Shape</label>
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
							</div>
							<div className="control-row">
								<label>Mix</label>
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
			const fromIndex = items.findIndex((e) => e.id === draggedEffect.id);
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
				onDragLeave={() => setDropIndex(null)}
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
		]),
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
	const audioNodesRef = useRef<Map<string, EngineAudioNodes>>(new Map());
	const filterNodesRef = useRef<{
		filter1: FilterNodes;
		filter2: FilterNodes;
	} | null>(null);
	const masterVolumeNodeRef = useRef<GainNode | null>(null);
	const masterAnalyserNodeRef = useRef<AnalyserNode | null>(null);
	const masterBusRef = useRef<GainNode | null>(null);
	const lfoNodesRef = useRef<
		Map<string, { lfoNode: OscillatorNode; depthGain: GainNode }>
	>(new Map());
	const lfoRoutingBussesRef = useRef<LfoRoutingBusses | null>(null);
	const samplesRef = useRef<Map<string, AudioBuffer>>(new Map());
	const activeVoicesRef = useRef<Map<string, ActiveVoice>>(new Map());
	const activeMonoNotePerEngineRef = useRef<Map<string, {note: number, freq: number}>>(new Map());
	const lastPlayedNotePerEngineRef = useRef<Map<string, number>>(new Map());
	const effectNodesRef = useRef<Map<string, MasterEffectNodes>>(new Map());
    const noiseBuffersRef = useRef<Map<NoiseType, AudioBuffer>>(new Map());
	const reverbImpulseCache = useRef<Map<string, AudioBuffer>>(new Map());
	const dummyGainRef = useRef<GainNode | null>(null);
	const sequencerModEventsRef = useRef<Map<string, {start: number, end: number}[]>>(new Map());

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
	const latestStateRef = useRef({ engines, lfos, filter1State, filter2State, masterEffects, bpm, voicingMode, glideTime, isGlideSynced, glideSyncRateIndex });
	useEffect(() => {
		latestStateRef.current = { engines, lfos, filter1State, filter2State, masterEffects, bpm, voicingMode, glideTime, isGlideSynced, glideSyncRateIndex };
	}, [engines, lfos, filter1State, filter2State, masterEffects, bpm, voicingMode, glideTime, isGlideSynced, glideSyncRateIndex]);


	const [masterVolume, setMasterVolume] = useState(0.7);
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

	const morphTargetRef = useRef<any>(null);
	const morphStartRef = useRef<any>(null);
	const morphStartTimeRef = useRef<number | null>(null);
	const [midiInputs, setMidiInputs] = useState<MIDIInput[]>([]);
	const [selectedMidiInputId, setSelectedMidiInputId] = useState<string | null>(
		null
	);
	const [midiActivity, setMidiActivity] = useState(false);
	const midiActivityTimeoutRef = useRef<number | null>(null);
	const [audioInputStream, setAudioInputStream] = useState<MediaStream | null>(
		null
	);

	const syncRates = useMemo(
		() => ["1/64", "1/32", "1/16", "1/8", "1/8d", "1/4", "1/4d", "1/2"],
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
		const scaleSteps = musicalScales[scale];
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
		// Remove duplicates and sort
		return [...new Map(notes.map((item) => [item.value, item])).values()].sort(
			(a, b) => a.value - b.value
		);
	}, [harmonicTuningSystem, scale, transpose]);

	const handleRandomize = useCallback(
		(mode: RandomizeMode, scope: string) => {
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
						newMelodicSequence = Array(newSteps).fill(oldSequence[0] || 220);
						for (let i = 0; i < newSteps; i++) {
							newMelodicSequence[i] = oldSequence[i % oldSequence.length];
						}
					}

					const newSynthState: Partial<SynthLayerState> = {};
					const newNoiseState: Partial<NoiseLayerState> = {};
					const newSamplerState: Partial<SamplerLayerState> = {};

					if (shouldChangeMelody) {
						let possibleNotes = scaleFrequencies.map((f) => f.value);
						if (possibleNotes.length === 0) {
							// Fallback if no scale is active
							const rootFreq = midiNoteToFrequency(60 + transpose, "440_ET");
							const currentScaleRatios = musicalScales[scale].map((semitone) =>
								Math.pow(2, semitone / 12)
							);
							possibleNotes = Array(12)
								.fill(0)
								.map(() => getNoteFromScale(rootFreq, currentScaleRatios, 3));
						}

						newMelodicSequence = newMelodicSequence.map(() =>
							getRandomElement(possibleNotes)
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
						if (!samplerLocks.granularModeEnabled) newSamplerState.granularModeEnabled = getRandomBool();
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
						setAdsr([0.1, 2.0], [0.2, 2.0], [0.4, 1.0], [0.2, 3.0]);
					else if (mode === "chaos")
						setAdsr([0.001, 3.0], [0.05, 3.0], [0.0, 1.0], [0.05, 5.0]);

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
						routing: mode === "chaos" ? randomizeRouting() : engine.routing,
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
					if (shouldChangeMelody && !locks.shape)
						newState.shape = getRandomElement(lfoShapes);
					if (mode === "chaos") newState.routing = randomizeRouting();

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
					return { ...effect, params: newParams };
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

	const handleToggleLock = useCallback((path: string) => {
		setLockState(prev => {
			const parts = path.split('.');
			const updateRecursively = (currentValue: any, pathParts: string[]): any => {
				if (!pathParts.length) {
					return currentValue;
				}
				const [currentKey, ...restKeys] = pathParts;
				if (restKeys.length === 0) {
					if (typeof currentValue[currentKey] === 'boolean') {
						return {
							...currentValue,
							[currentKey]: !currentValue[currentKey],
						};
					}
					return currentValue;
				}
				if (typeof currentValue[currentKey] === 'object' && currentValue[currentKey] !== null) {
					return {
						...currentValue,
						[currentKey]: updateRecursively(currentValue[currentKey], restKeys),
					};
				}
				return currentValue;
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
                modBusses.vol.connect(engineNodes.finalOutput.gain);
                // The other busses will be connected to specific AudioParams as needed
                engineModBussesMap.set(engine.id, modBusses);
			});

            // Create LFO nodes
			// FIX: Explicitly type `lfo` as `LFOState` to resolve type inference issue.
            initialAppState.lfos.forEach((lfo: LFOState) => {
                const lfoNode = context.createOscillator();
                const depthGain = context.createGain();
                lfoNode.connect(depthGain);
                lfoNode.start();
                lfoNodesRef.current.set(lfo.id, { lfoNode, depthGain });
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
	
	const noteOff = useCallback((noteId: string, time: number) => {
		if (!audioContext) return;
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
			activeVoicesRef.current.delete(noteId);
		}, (stopTime - audioContext.currentTime) * 1000 + 100);
        
        activeVoicesRef.current.set(noteId, {...voice, timeoutId});

	}, [audioContext]);
	
	const noteOn = useCallback((engineId: string, noteId: string, midiNote: number, time: number) => {
		if (!audioContext) return;

		const now = audioContext.currentTime;
    	const scheduledTime = time > now ? time : now;
		
		const { engines, voicingMode, glideTime, isGlideSynced, glideSyncRateIndex, lfos, bpm } = latestStateRef.current;
		const engine = engines.find(e => e.id === engineId);
		
		if (!engine) return;
		const engineNodes = audioNodesRef.current.get(engine.id);
		if (!engineNodes) return;
	
		// --- Voicing and Glide Logic ---
		let startFrequency: number | undefined;
		const targetFrequency = midiNoteToFrequency(midiNote, harmonicTuningSystem);
		
		if (voicingMode !== 'poly') {
			noteOff(activeMonoNotePerEngineRef.current.get(engineId)?.note.toString()!, scheduledTime);

			const lastNote = lastPlayedNotePerEngineRef.current.get(engineId);
			if (lastNote && voicingMode === 'legato' && activeVoicesRef.current.size > 0) {
				startFrequency = midiNoteToFrequency(lastNote, harmonicTuningSystem);
			}
			activeMonoNotePerEngineRef.current.set(engineId, { note: midiNote, freq: targetFrequency });
		}
		lastPlayedNotePerEngineRef.current.set(engineId, midiNote);
	
		// Clean up any previous voice with the same ID
		noteOff(noteId, scheduledTime);
	
		const { attack, decay, sustain } = engine.adsr;
		const envelopeGain = audioContext.createGain();
		envelopeGain.connect(engineNodes.engineMixer);
		
		const sourceNodes: (AudioBufferSourceNode | OscillatorNode)[] = [];
		let newVoice: ActiveVoice = { noteId, engineId, sourceNodes, envelopeGain };

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
	
		if(engine.sampler.enabled && engine.sampler.volume > 0 && (samplesRef.current.has(engine.id) || engine.sampler.liveInputEnabled)) {
			const samplerGain = audioContext.createGain();
			samplerGain.gain.value = engine.sampler.volume;
			samplerGain.connect(envelopeGain);
	
			if (engine.sampler.granularModeEnabled && !engine.sampler.liveInputEnabled && samplesRef.current.has(engine.id)) {
				// Set up the voice for the central granular scheduler
				newVoice.granularModeEnabled = true;
				newVoice.nextGrainTime = scheduledTime;
			} else if (!engine.sampler.granularModeEnabled && samplesRef.current.has(engine.id)) {
				 const sampleSource = audioContext.createBufferSource();
				 sampleSource.buffer = samplesRef.current.get(engine.id)!;
				 // Assuming original pitch of sample is C4 (MIDI note 60)
				 const playbackRate = Math.pow(2, (midiNote - 60 + engine.sampler.transpose) / 12);
				 sampleSource.playbackRate.setValueAtTime(playbackRate, scheduledTime);
				 sampleSource.connect(samplerGain);
				 sampleSource.start(scheduledTime);
				 sourceNodes.push(sampleSource);
			}
		}

		envelopeGain.gain.cancelScheduledValues(scheduledTime);
		envelopeGain.gain.setValueAtTime(0.0001, scheduledTime);
		envelopeGain.gain.linearRampToValueAtTime(1, scheduledTime + attack);
		envelopeGain.gain.setTargetAtTime(sustain, scheduledTime + attack, decay / 3 + 0.001); // decay to sustain level

		activeVoicesRef.current.set(noteId, newVoice);

	}, [audioContext, noteOff, harmonicTuningSystem, syncRates]);

    // High-Precision Web Audio Sequencer
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
                const now = audioContext.currentTime;
                const scheduleUntil = now + schedulerState.current.scheduleAheadTime;

				// Cleanup old sequencer modulation events
				const cleanupTime = now - 2.0; // Clean up events older than 2s
				sequencerModEventsRef.current.forEach((events, engineId) => {
					const filteredEvents = events.filter(e => e.end > cleanupTime);
					sequencerModEventsRef.current.set(engineId, filteredEvents);
				});

                // --- Schedule Sequencer Notes ---
                latestStateRef.current.engines.forEach(engine => {
                    if (!engine.sequencerEnabled) return;
                    const engineSch = engineSchedulerStates.current.get(engine.id)!;
                    const engineNodes = audioNodesRef.current.get(engine.id);
					if (!engineNodes) return;
                    
                    const secondsPerStep = (60 / latestStateRef.current.bpm) / (parseInt(engine.sequencerRate.split('/')[1]) / 4);

                    while (engineSch.nextNoteTime < scheduleUntil) {
                        const currentStepForNote = engineSch.currentStep;
                        if (engine.sequence[currentStepForNote] === 1) {
                            const noteId = `seq_${engine.id}_${currentStepForNote}_${engineSch.nextNoteTime}`;
                            const freq = engine.melodicSequence[currentStepForNote];
							const midiNote = frequencyToMidiNote(freq);
                            noteOn(engine.id, noteId, midiNote, engineSch.nextNoteTime);
                            
                            const noteDuration = secondsPerStep * 0.8; // Note lasts 80% of step duration
							const modGateDuration = secondsPerStep * 0.95; // Modulation gate is slightly longer
                            noteOff(noteId, engineSch.nextNoteTime + noteDuration);

							// Schedule the modulation gate for AudioParams
							engineNodes.sequencerModGate.gain.setValueAtTime(1.0, engineSch.nextNoteTime);
							engineNodes.sequencerModGate.gain.setValueAtTime(0.0, engineSch.nextNoteTime + modGateDuration);
							
							// Record modulation gate event for JS-based modulation (granular)
							const modEvents = sequencerModEventsRef.current.get(engine.id) || [];
							modEvents.push({ start: engineSch.nextNoteTime, end: engineSch.nextNoteTime + modGateDuration });
							sequencerModEventsRef.current.set(engine.id, modEvents);
                        }
                        
                        const stepTime = engineSch.nextNoteTime;
                        setTimeout(() => {
                            if (isTransportPlaying) { // check again in case it was stopped
                                setSequencerCurrentSteps(prev => new Map(prev).set(engine.id, currentStepForNote));
                            }
                        }, (stepTime - now) * 1000);


                        engineSch.nextNoteTime += secondsPerStep;
                        engineSch.currentStep = (engineSch.currentStep + 1) % engine.sequencerSteps;
                    }
                });
                
                // --- Schedule Granular Synthesis ---
                activeVoicesRef.current.forEach((voice) => {
                    if (!voice.granularModeEnabled || !voice.nextGrainTime) return;

                    const engine = latestStateRef.current.engines.find(e => e.id === voice.engineId);
                    if (!engine || !engine.sampler.granularModeEnabled) {
                        voice.granularModeEnabled = false; 
                        return;
                    }

                    const sampleBuffer = samplesRef.current.get(voice.engineId);
                    const engineNodes = audioNodesRef.current.get(voice.engineId);
                    if (!sampleBuffer || !engineNodes) return;
                    
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
							let isGateOn = false;
							if (modEvents) {
								for (const event of modEvents) {
									if (nextGrainTime >= event.start && nextGrainTime < event.end) {
										isGateOn = true;
										break;
									}
								}
							}
							if(isGateOn) {
								if(sourceEngine.routing[granularDestKeys.pos]) positionMod += 0.5;
								if(sourceEngine.routing[granularDestKeys.size]) sizeMod += 0.1;
								if(sourceEngine.routing[granularDestKeys.density]) densityMod += 20;
								if(sourceEngine.routing[granularDestKeys.jitter]) jitterMod += 0.5;
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
                        const grainEnvelope = audioContext.createGain();
                        const samplerGain = engineNodes.sampler.volumeGain;
                        samplerGain.connect(voice.envelopeGain);
                        
                        grainEnvelope.connect(samplerGain);
                        grainSource.connect(grainEnvelope);
        
                        grainSource.start(nextGrainTime, startOffset, grainSize * 2); 
                        
                        const attackTime = grainSize * 0.4;
                        const releaseTime = grainSize * 0.4;
        
                        grainEnvelope.gain.setValueAtTime(0, nextGrainTime);
                        grainEnvelope.gain.linearRampToValueAtTime(1, nextGrainTime + attackTime);
                        grainEnvelope.gain.linearRampToValueAtTime(0, nextGrainTime + attackTime + releaseTime);
        
                        grainSource.stop(nextGrainTime + grainSize * 2);
                        
						const finalDensity = Math.max(1, density + densityMod);
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

	// MIDI Setup
	useEffect(() => {
		const setupMidi = async () => {
			if (navigator.requestMIDIAccess) {
				try {
					const midiAccess = await navigator.requestMIDIAccess();
					const inputs = Array.from(midiAccess.inputs.values());
					setMidiInputs(inputs);

					midiAccess.onstatechange = () => {
						setMidiInputs(Array.from(midiAccess.inputs.values()));
					};
				} catch (error) {
					console.error("MIDI access denied or not available.", error);
				}
			}
		};
		setupMidi();
	}, []);
	
	// MIDI Message Handler
	useEffect(() => {
		const input = midiInputs.find(i => i.id === selectedMidiInputId);
		if (input && audioContext) {
			const handleMidiMessage = (event: MIDIMessageEvent) => {
				const command = event.data[0] >> 4;
				const note = event.data[1];
				
				setMidiActivity(true);
				if(midiActivityTimeoutRef.current) clearTimeout(midiActivityTimeoutRef.current);
				midiActivityTimeoutRef.current = window.setTimeout(() => setMidiActivity(false), 100);

				const now = audioContext.currentTime;
				if(command === 9 && event.data[2] > 0) { // Note On
					latestStateRef.current.engines.forEach(engine => {
						if(engine.midiControlled) {
							noteOn(engine.id, `midi_${note}`, note, now);
						}
					})
				} else if (command === 8 || (command === 9 && event.data[2] === 0)) { // Note Off
					latestStateRef.current.engines.forEach(engine => {
						if(engine.midiControlled) {
							noteOff(`midi_${note}`, now);
						}
					})
				}
			}
			input.onmidimessage = handleMidiMessage;
			return () => { input.onmidimessage = null; }
		}
	}, [selectedMidiInputId, midiInputs, audioContext, noteOn, noteOff, harmonicTuningSystem]);

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
    	
    	        audioNodesRef.current.forEach(nodes => nodes.finalOutput.connect(masterBus));
    	    
    	        const lastFilterNode = (() => {
    	            if (filterRouting === 'series') {
    	                let node: AudioNode = masterBus;
    	                if (filter1State.enabled) {
    	                    node.connect(f1);
    	                    node = f1;
    	                }
    	                if (filter2State.enabled) {
    	                    node.connect(f2);
    	                    node = f2;
    	                }
    	                return node;
    	            } else { // Parallel
    	                const parallelOutput = audioContext.createGain();
    	                let isAnyFilterEnabled = false;
    	                if (filter1State.enabled) {
    	                    masterBus.connect(f1);
    	                    f1.connect(parallelOutput);
    	                    isAnyFilterEnabled = true;
    	                }
    	                if (filter2State.enabled) {
    	                    masterBus.connect(f2);
    	                    f2.connect(parallelOutput);
    	                    isAnyFilterEnabled = true;
    	                }
    	                if (!isAnyFilterEnabled) {
    	                    masterBus.connect(parallelOutput);
    	                }
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
    	    
    	    }, [audioContext, filter1State.enabled, filter2State.enabled, filterRouting, masterEffectsChain]);
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
					nodes.lfo.type = params.tremolo!.shape === 'ramp' ? 'sawtooth' : params.tremolo!.shape;
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
        f1.frequency.setTargetAtTime(filter1State.cutoff, now, 0.01);
        f1.Q.setTargetAtTime(filter1State.resonance, now, 0.01);

        f2.type = filter2State.type;
        f2.frequency.setTargetAtTime(filter2State.cutoff, now, 0.01);
        f2.Q.setTargetAtTime(filter2State.resonance, now, 0.01);

    }, [audioContext, filter1State, filter2State]);

    // LFO Parameter and Routing Update
    useEffect(() => {
        if (!audioContext || !lfoNodesRef.current || !lfoRoutingBussesRef.current) return;
		const now = audioContext.currentTime;

        lfos.forEach(lfo => {
            const lfoNodes = lfoNodesRef.current.get(lfo.id);
            if (!lfoNodes) return;

            const { lfoNode, depthGain } = lfoNodes;
            lfoNode.type = lfo.shape === 'ramp' ? 'sawtooth' : lfo.shape; // Ramp is a sawtooth
            depthGain.gain.setTargetAtTime(lfo.depth, now, 0.01);

			let lfoFrequency = lfo.rate;
			if (lfo.sync) {
				const syncRate = lfo.syncRate;
				let noteValueInBeats = 1;
				// lfoSyncRates does not have dotted notes, but this is robust
				const isDotted = syncRate.endsWith("d");
				const cleanRate = syncRate.replace("d", "");

				if (cleanRate.includes("/")) {
					const parts = cleanRate.split("/");
					const denominator = parseFloat(parts[1]);
					if (denominator) noteValueInBeats = 4 / denominator;
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
            lfoNode.frequency.setTargetAtTime(lfoFrequency, now, 0.01);

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
			const progress = Math.min((now - startTime) / duration, 1);

			const startState = morphStartRef.current;
			const targetState = morphTargetRef.current;
			const audioNow = audioContext.currentTime;
			const rampTime = 0.01;

			// Direct AudioParam manipulation (for performance)
			if (startState && targetState) {
				audioNodesRef.current.forEach((nodes, id) => {
					const start = startState.engines.find((e: EngineState) => e.id === id);
					const target = targetState.engines.find((e: EngineState) => e.id === id);
					if (!start || !target) return;

					nodes.synth.volumeGain.gain.setTargetAtTime(lerp(start.synth.volume, target.synth.volume, progress), audioNow, rampTime);
					nodes.noise.volumeGain.gain.setTargetAtTime(lerp(start.noise.volume, target.noise.volume, progress), audioNow, rampTime);
					nodes.sampler.volumeGain.gain.setTargetAtTime(lerp(start.sampler.volume, target.sampler.volume, progress), audioNow, rampTime);
				});
				
				if (filterNodesRef.current) {
					filterNodesRef.current.filter1.node.frequency.setTargetAtTime(lerp(startState.filter1State.cutoff, targetState.filter1State.cutoff, progress), audioNow, rampTime);
					filterNodesRef.current.filter1.node.Q.setTargetAtTime(lerp(startState.filter1State.resonance, targetState.filter1State.resonance, progress), audioNow, rampTime);
					filterNodesRef.current.filter2.node.frequency.setTargetAtTime(lerp(startState.filter2State.cutoff, targetState.filter2State.cutoff, progress), audioNow, rampTime);
					filterNodesRef.current.filter2.node.Q.setTargetAtTime(lerp(startState.filter2State.resonance, targetState.filter2State.resonance, progress), audioNow, rampTime);
				}

				lfoNodesRef.current.forEach((nodes, id) => {
					const start = startState.lfos.find((l: LFOState) => l.id === id);
					const target = targetState.lfos.find((l: LFOState) => l.id === id);
					if (!start || !target) return;
					nodes.lfoNode.frequency.setTargetAtTime(lerp(start.rate, target.rate, progress), audioNow, rampTime);
					nodes.depthGain.gain.setTargetAtTime(lerp(start.depth, target.depth, progress), audioNow, rampTime);
				});

				effectNodesRef.current.forEach((fxNodes, id) => {
					const start = startState.masterEffects.find((e: MasterEffect) => e.id === id);
					const target = targetState.masterEffects.find((e: MasterEffect) => e.id === id);
					if (!start || !target || start.type !== target.type) return;

					const startParams = start.params;
					const targetParams = target.params;
					
					switch (fxNodes.type) {
						case "delay":
							fxNodes.nodes.delay.delayTime.setTargetAtTime(lerp(startParams.delay!.time, targetParams.delay!.time, progress), audioNow, rampTime);
							fxNodes.nodes.feedback.gain.setTargetAtTime(lerp(startParams.delay!.feedback, targetParams.delay!.feedback, progress), audioNow, rampTime);
							fxNodes.nodes.wet.gain.setTargetAtTime(lerp(startParams.delay!.mix, targetParams.delay!.mix, progress), audioNow, rampTime);
							fxNodes.nodes.dry.gain.setTargetAtTime(1 - lerp(startParams.delay!.mix, targetParams.delay!.mix, progress), audioNow, rampTime);
							break;
						case "reverb":
							fxNodes.nodes.wet.gain.setTargetAtTime(lerp(startParams.reverb!.mix, targetParams.reverb!.mix, progress), audioNow, rampTime);
							fxNodes.nodes.dry.gain.setTargetAtTime(1 - lerp(startParams.reverb!.mix, targetParams.reverb!.mix, progress), audioNow, rampTime);
							break;
						case "chorus":
							fxNodes.nodes.lfo.frequency.setTargetAtTime(lerp(startParams.chorus!.rate, targetParams.chorus!.rate, progress), audioNow, rampTime);
							fxNodes.nodes.lfoGain.gain.setTargetAtTime(0.005 * lerp(startParams.chorus!.depth, targetParams.chorus!.depth, progress), audioNow, rampTime);
							fxNodes.nodes.wet.gain.setTargetAtTime(lerp(startParams.chorus!.mix, targetParams.chorus!.mix, progress), audioNow, rampTime);
							fxNodes.nodes.dry.gain.setTargetAtTime(1 - lerp(startParams.chorus!.mix, targetParams.chorus!.mix, progress), audioNow, rampTime);
							break;
						case "flanger":
							fxNodes.nodes.lfo.frequency.setTargetAtTime(lerp(startParams.flanger!.rate, targetParams.flanger!.rate, progress), audioNow, rampTime);
							const flangerLfoGain = lerp(startParams.flanger!.delay, targetParams.flanger!.delay, progress) * lerp(startParams.flanger!.depth, targetParams.flanger!.depth, progress);
							fxNodes.nodes.lfoGain.gain.setTargetAtTime(flangerLfoGain, audioNow, rampTime);
							fxNodes.nodes.delay.delayTime.setTargetAtTime(lerp(startParams.flanger!.delay, targetParams.flanger!.delay, progress), audioNow, rampTime);
							fxNodes.nodes.feedback.gain.setTargetAtTime(lerp(startParams.flanger!.feedback, targetParams.flanger!.feedback, progress), audioNow, rampTime);
							fxNodes.nodes.wet.gain.setTargetAtTime(lerp(startParams.flanger!.mix, targetParams.flanger!.mix, progress), audioNow, rampTime);
							fxNodes.nodes.dry.gain.setTargetAtTime(1 - lerp(startParams.flanger!.mix, targetParams.flanger!.mix, progress), audioNow, rampTime);
							break;
						case "phaser":
							fxNodes.nodes.lfo.frequency.setTargetAtTime(lerp(startParams.phaser!.rate, targetParams.phaser!.rate, progress), audioNow, rampTime);
							fxNodes.nodes.filters.forEach((f: BiquadFilterNode) => f.Q.setTargetAtTime(lerp(startParams.phaser!.q, targetParams.phaser!.q, progress), audioNow, rampTime));
							fxNodes.nodes.wet.gain.setTargetAtTime(lerp(startParams.phaser!.mix, targetParams.phaser!.mix, progress), audioNow, rampTime);
							fxNodes.nodes.dry.gain.setTargetAtTime(1 - lerp(startParams.phaser!.mix, targetParams.phaser!.mix, progress), audioNow, rampTime);
							break;
						case "tremolo":
							fxNodes.nodes.lfo.frequency.setTargetAtTime(lerp(startParams.tremolo!.rate, targetParams.tremolo!.rate, progress), audioNow, rampTime);
							fxNodes.nodes.lfoGain.gain.setTargetAtTime(lerp(startParams.tremolo!.depth, targetParams.tremolo!.depth, progress), audioNow, rampTime);
							break;
						case "eq":
							fxNodes.nodes.bands.forEach((band: BiquadFilterNode, i: number) => {
								band.gain.setTargetAtTime(lerp(startParams.eq!.bands[i], targetParams.eq!.bands[i], progress), audioNow, rampTime);
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
		const initial = getInitialState();
		setEngines(initial.engines);
		setLfos(initial.lfos);
		setFilter1State(initial.filter1);
		setFilter2State(initial.filter2);
		setMasterEffects(initial.masterEffects);
	}, []);

	const handlePanic = useCallback(() => {
		if (!audioContext || !masterVolumeNodeRef.current) return;
		setIsTransportPlaying(false); // Stop sequencers

		// Stop all active notes with a fast release
		const now = audioContext.currentTime;
		activeVoicesRef.current.forEach(voice => {
			voice.envelopeGain.gain.cancelScheduledValues(now);
			voice.envelopeGain.gain.setTargetAtTime(0.0, now, 0.01);
		});
		
		// Flush effect tails by quickly ramping master volume
		masterVolumeNodeRef.current.gain.cancelScheduledValues(now);
		masterVolumeNodeRef.current.gain.setValueAtTime(masterVolumeNodeRef.current.gain.value, now);
		masterVolumeNodeRef.current.gain.linearRampToValueAtTime(0.0, now + 0.05);
		masterVolumeNodeRef.current.gain.linearRampToValueAtTime(masterVolume, now + 0.3);

		setTimeout(() => activeVoicesRef.current.clear(), 100);

	}, [audioContext, masterVolume]);

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
			const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
			samplesRef.current.set(engineId, audioBuffer);
			setEngines(prev => prev.map(e => e.id === engineId ? {...e, sampler: {...e.sampler, sampleName: file.name}} : e));
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

	return (
		<>
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
						onToggleTransport={() => setIsTransportPlaying(p => !p)}
						onPanic={handlePanic}
						midiInputs={midiInputs}
						selectedMidiInputId={selectedMidiInputId}
						onMidiInputChange={setSelectedMidiInputId}
						midiActivity={midiActivity}
						lockState={lockState}
						onToggleLock={handleToggleLock}
					/>
	
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
						syncRates={syncRates}
						harmonicTuningSystem={harmonicTuningSystem}
						setHarmonicTuningSystem={setHarmonicTuningSystem}
						voicingMode={voicingMode}
						setVoicingMode={setVoicingMode}
						glideTime={glideTime}
						setGlideTime={setGlideTime}
						isGlideSynced={isGlideSynced}
						setIsGlideSynced={setIsGlideSynced}
						glideSyncRateIndex={glideSyncRateIndex}
						setGlideSyncRateIndex={setGlideSyncRateIndex}
						glideSyncRates={syncRates} /* Assuming same rates */
						scale={scale}
						setScale={setScale}
						transpose={transpose}
						setTranspose={setTranspose}
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
							/>
						))}
					</div>
					
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
					/>
				</div>
			)}
		</>
	);
};

const container = document.getElementById("root");
if (container) {
	const root = createRoot(container);
	root.render(<App />);
}