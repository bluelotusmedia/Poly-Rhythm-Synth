
import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI, Type, GenerateContentResponse } from "@google/genai";

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
type MasterEffectType = 'distortion' | 'delay' | 'reverb';

interface MasterEffect {
  id: string;
  type: MasterEffectType;
  enabled: boolean;
  params: {
    distortion?: { mode: DistortionMode; amount: number }; // 0 to 1
    delay?: { time: number; feedback: number; mix: number }; // s, 0-1, 0-1
    reverb?: { decay: number; mix: number }; // s, 0-1
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
}
interface EffectState {
  distortion: number; // 0 to 1
  delayTime: number; // in seconds
  delayFeedback: number; // 0 to 1
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
  effects: EffectState;
  routing: LFORoutingState;
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

// --- Tuning System Types ---
type TuningSystem = '440_ET' | '432_ET' | 'just_intonation_440' | 'just_intonation_432' | 'pythagorean_440' | 'pythagorean_432' | 'solfeggio' | 'wholesome_scale';


// --- New Audio Node Types ---
interface LayerAudioNodes {
    sourceNode?: OscillatorNode | AudioBufferSourceNode;
    volumeGain: GainNode;
    // For granular
    granularSchedulerId?: number;
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
    velocityGain: GainNode;
    noiseNodes?: (AudioBufferSourceNode | GainNode)[];
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
  onRandomize: (mode: RandomizeMode, scope: string) => void;
  onIntelligentRandomize: (scope: string) => void;
  analyserNode?: AnalyserNode;
  currentStep: number;
  isTransportPlaying: boolean;
}

interface TopBarProps {
    masterVolume: number;
    setMasterVolume: (volume: number) => void;
    bpm: number;
    setBPM: (bpm: number) => void;
    isTransportPlaying: boolean;
    onToggleTransport: () => void;
    midiInputs: MIDIInput[];
    selectedMidiInputId: string | null;
    onMidiInputChange: (id: string) => void;
    midiActivity: boolean;
    voicingMode: VoicingMode;
    setVoicingMode: (mode: VoicingMode) => void;
    glideTime: number;
    setGlideTime: (time: number) => void;
    isGlideSynced: boolean;
    setIsGlideSynced: (synced: boolean) => void;
    glideSyncRateIndex: number;
    setGlideSyncRateIndex: (index: number) => void;
    glideSyncRates: string[];
    // Presets
    presets: Record<string, any>;
    selectedPreset: string;
    onLoadPreset: (name: string) => void;
    onSavePreset: () => void;
    onDeletePreset: (name: string) => void;
    // Audio Output
    audioOutputs: { id: string, label: string }[];
    selectedAudioOutputId: string;
    onAudioOutputChange: (id: string) => void;
}

interface FilterState {
    cutoff: number;
    resonance: number;
    type: FilterType;
}

interface MasterFilterControlsProps {
    title: string;
    filterState: FilterState;
    onUpdate: (updates: Partial<FilterState>) => void;
    onRandomize: (mode: RandomizeMode, scope: string) => void;
    onIntelligentRandomize: (scope: string) => void;
}

interface LFOControlsProps {
    lfoState: LFOState;
    onUpdate: (updates: Partial<LFOState>) => void;
    onRandomize: (mode: RandomizeMode, scope: string) => void;
    onIntelligentRandomize: (scope: string) => void;
}

interface GenerativeToolsProps {
    onRandomize: (mode: RandomizeMode, scope: 'global') => void;
    onIntelligentRandomize: (scope: 'global') => void;
    isMorphEnabled: boolean;
    setIsMorphEnabled: (enabled: boolean) => void;
    morphDuration: number;
    setMorphDuration: (duration: number) => void;
    harmonicTuningSystem: TuningSystem;
    setHarmonicTuningSystem: (system: TuningSystem) => void;
}


interface MasterEffectsProps {
    effects: MasterEffect[];
    setEffects: React.Dispatch<React.SetStateAction<MasterEffect[]>>;
    onRandomize: (mode: RandomizeMode, scope: string) => void;
    onIntelligentRandomize: (scope: string) => void;
}

interface EffectModuleProps {
    effect: MasterEffect;
    onUpdate: (id: string, params: MasterEffect['params']) => void;
    onRemove: (id: string) => void;
    onToggle: (id: string) => void;
    onRandomize: (mode: RandomizeMode, scope: string) => void;
    onIntelligentRandomize: (scope: string) => void;
    onDragStart: (e: React.DragEvent<HTMLDivElement>, effect: MasterEffect) => void;
    onDragEnter: (e: React.DragEvent<HTMLDivElement>, effect: MasterEffect) => void;
    onDragEnd: (e: React.DragEvent<HTMLDivElement>) => void;
    isDragging: boolean;
    isDragOver: boolean;
}

interface RoutingMatrixProps {
    lfoStates: LFOState[];
    onLfoUpdate: (lfoId: string, updates: Partial<LFOState>) => void;
    engineStates: EngineState[];
    onEngineUpdate: (engineId: string, updates: Partial<EngineState>) => void;
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

const musicalScales = {
    major: [0, 2, 4, 5, 7, 9, 11],
    minor: [0, 2, 3, 5, 7, 8, 10],
    pentatonicMajor: [0, 2, 4, 7, 9],
    pentatonicMinor: [0, 3, 5, 7, 10],
};
type ScaleName = keyof typeof musicalScales;

const justIntonationRatios = [1/1, 9/8, 5/4, 4/3, 3/2, 5/3, 15/8];
const pythagoreanRatios = [1/1, 9/8, 81/64, 4/3, 3/2, 27/16, 243/128];

const oscillatorTypes: readonly OscillatorType[] = ['sine', 'square', 'sawtooth', 'triangle'];
const lfoShapes: readonly LFO_Shape[] = ['sine', 'square', 'sawtooth', 'ramp', 'triangle'];
const filterTypes: readonly FilterType[] = ['lowpass', 'highpass', 'bandpass', 'notch'];
const lfoSyncRates = ['1/16', '1/8', '1/4', '1/2', '1'];
const delaySyncRates = ['1/16', '1/8', '1/8d', '1/4', '1/4d', '1/2'];
const noiseTypes: readonly NoiseType[] = ['white', 'pink', 'brown'];
const distortionModes: readonly DistortionMode[] = ['overdrive', 'soft clip', 'hard clip', 'foldback'];
const availableMasterEffects: MasterEffectType[] = ['distortion', 'delay', 'reverb'];


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
const getNoteFromScale = (rootFreq: number, ratios: number[], octaves: number) => {
    const octave = getRandomInt(0, octaves - 1);
    const ratio = getRandomElement(ratios);
    return rootFreq * ratio * Math.pow(2, octave);
};

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
const AIIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2.25c.83 0 1.5.67 1.5 1.5s-.67 1.5-1.5 1.5S10.5 4.58 10.5 3.75s.67-1.5 1.5-1.5zm6.75 3c.41 0 .75.34.75.75s-.34.75-.75.75-.75-.34-.75-.75.34-.75.75-.75zM5.25 5.25c.41 0 .75.34.75.75S5.66 6.75 5.25 6.75s-.75-.34-.75-.75.34-.75.75-.75zm13.5 9c.41 0 .75.34.75.75s-.34.75-.75.75-.75-.34-.75-.75.34-.75.75-.75zM12 18c.83 0 1.5.67 1.5 1.5s-.67 1.5-1.5 1.5-1.5-.67-1.5-1.5.67-1.5 1.5-1.5zm-6.75-3c.41 0 .75.34.75.75s-.34.75-.75.75-.75-.34-.75-.75.34-.75.75-.75zM21 12c0-.83-.67-1.5-1.5-1.5S18 11.17 18 12s.67 1.5 1.5 1.5S21 12.83 21 12zM4.5 10.5c-.83 0-1.5.67-1.5 1.5s.67 1.5 1.5 1.5S6 12.83 6 12s-.67-1.5-1.5-1.5z"></path>
    </svg>
);
const HarmonicIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
      <path d="M15.75,7.5a1.5,1.5,0,0,1-3,0A1.5,1.5,0,0,1,14.25,6h.09a3.41,3.41,0,0,0,.16-.05,1.5,1.5,0,0,1,1.25,2.94A3.41,3.41,0,0,0,16,8.94V17a1,1,0,0,1-2,0V14H10v3a1,1,0,0,1-2,0V8.94a3.41,3.41,0,0,0,.25.05A1.5,1.5,0,0,1,9.5,6.06,3.41,3.41,0,0,0,9.75,6h.09A1.5,1.5,0,0,1,11.25,7.5a1.5,1.5,0,0,1-3,0A1.5,1.5,0,0,1,9.75,6,3.5,3.5,0,0,0,6,9.5V17a3,3,0,0,0,6,0V12h0v5a3,3,0,0,0,6,0V9.5A3.5,3.5,0,0,0,15.75,6,1.5,1.5,0,0,1,15.75,7.5Z"></path>
    </svg>
);
const RhythmicIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
        <path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z"></path>
    </svg>
);

const LFOVisualizer: React.FC<{ shape: LFO_Shape; rate: number }> = ({ shape, rate }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        let animationFrameId: number;
        let phase = 0;
        let lastTime = 0;

        const draw = (time: number) => {
            if (lastTime === 0) lastTime = time;
            const deltaTime = (time - lastTime) / 1000;
            lastTime = time;
            
            const { width, height } = canvas;
            ctx.fillStyle = '#191924';
            ctx.fillRect(0, 0, width, height);

            ctx.strokeStyle = '#a45ee5';
            ctx.lineWidth = 2;
            ctx.beginPath();

            phase += deltaTime * rate;
            
            for (let x = 0; x < width; x++) {
                const normalizedX = x / width;
                const angle = 2 * Math.PI * (normalizedX + phase);
                let y;
                switch (shape) {
                    case 'sine':
                        y = (1 - Math.sin(angle)) * (height / 2);
                        break;
                    case 'square':
                        y = Math.sin(angle) >= 0 ? height * 0.1 : height * 0.9;
                        break;
                    case 'sawtooth':
                         y = ( (angle / (2*Math.PI)) % 1) * height;
                        break;
                    case 'triangle':
                        y = 2 * Math.abs( ( (angle / (2 * Math.PI)) % 1) - 0.5) * height;
                        break;
                    case 'ramp':
                        y = (1-((angle / (2*Math.PI)) % 1)) * height;
                        break;
                    default:
                        y = height / 2;
                }
                if (x === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
            ctx.stroke();

            animationFrameId = requestAnimationFrame(draw);
        };

        animationFrameId = requestAnimationFrame(draw);
        return () => cancelAnimationFrame(animationFrameId);
    }, [shape, rate]);

    return <canvas ref={canvasRef} className="lfo-visualizer-container" />;
};


const EngineControls: React.FC<EngineControlsProps> = ({ engine, onUpdate, onLayerUpdate, onLoadSample, onRandomize, onIntelligentRandomize, analyserNode, currentStep, isTransportPlaying }) => {
  const [activeTab, setActiveTab] = useState<EngineLayerType>('synth');
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => { e.preventDefault(); e.stopPropagation(); setIsDraggingOver(true); };
  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => { e.preventDefault(); e.stopPropagation(); setIsDraggingOver(false); };
  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault(); e.stopPropagation(); setIsDraggingOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      onLoadSample(engine.id, e.dataTransfer.files[0]);
      e.dataTransfer.clearData();
    }
  };
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      onLoadSample(engine.id, e.target.files[0]);
    }
  };

  const renderTabContent = () => {
    switch (activeTab) {
      case 'synth':
        return (
          <div className="layer-group">
            {engine.synth.enabled && <>
              <div className="control-row">
                <label>Waveform</label>
                <select value={engine.synth.oscillatorType} onChange={e => onLayerUpdate(engine.id, 'synth', { oscillatorType: e.target.value as OscillatorType })}>
                  {oscillatorTypes.map(type => <option key={type} value={type}>{type}</option>)}
                </select>
              </div>
              <div className="control-row">
                <label>Frequency</label>
                 <div className="control-value-wrapper">
                  <input type="range" min="20" max="2000" step="1" value={engine.synth.frequency} onChange={e => onLayerUpdate(engine.id, 'synth', { frequency: +e.target.value })} />
                  <span>{engine.synth.frequency.toFixed(0)} Hz</span>
                </div>
              </div>
              <div className="control-row">
                <label>Volume</label>
                <div className="control-value-wrapper">
                    <input type="range" min="0" max="1" step="0.01" value={engine.synth.volume} onChange={e => onLayerUpdate(engine.id, 'synth', { volume: +e.target.value })} />
                    <span>{(engine.synth.volume * 100).toFixed(0)}%</span>
                </div>
              </div>
              <div className="control-row">
                  <label>Solfeggio</label>
                  <select value={engine.synth.solfeggioFrequency} onChange={e => {
                      const freq = solfeggioFrequenciesData.find(f => f.value === +e.target.value)?.value ?? 440;
                      onLayerUpdate(engine.id, 'synth', { solfeggioFrequency: e.target.value, frequency: freq });
                  }}>
                      <option value="">Manual</option>
                      {solfeggioFrequenciesData.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                  </select>
              </div>
            </>}
          </div>
        );
      case 'noise':
        return (
          <div className="layer-group">
            {engine.noise.enabled && <>
              <div className="control-row">
                <label>Type</label>
                <select value={engine.noise.noiseType} onChange={e => onLayerUpdate(engine.id, 'noise', { noiseType: e.target.value as NoiseType })}>
                  {noiseTypes.map(type => <option key={type} value={type}>{type}</option>)}
                </select>
              </div>
              <div className="control-row">
                <label>Volume</label>
                <div className="control-value-wrapper">
                  <input type="range" min="0" max="1" step="0.01" value={engine.noise.volume} onChange={e => onLayerUpdate(engine.id, 'noise', { volume: +e.target.value })} />
                   <span>{(engine.noise.volume * 100).toFixed(0)}%</span>
                </div>
              </div>
            </>}
          </div>
        );
       case 'sampler':
        return (
          <div className="layer-group">
            {engine.sampler.enabled && <>
               <div
                  className={`drop-zone ${isDraggingOver ? 'drop-zone-active' : ''}`}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                >
                  {engine.sampler.sampleName ? 
                   (<div>
                        <span>Loaded: {engine.sampler.sampleName}</span>
                        <span className="replace-sample-text">Drag/drop or click to replace</span>
                    </div>)
                   : 'Drag & Drop Sample'}
                   <input type="file" ref={fileInputRef} onChange={handleFileSelect} accept="audio/*" style={{ display: 'none' }}/>
                   <button className="small" onClick={() => fileInputRef.current?.click()}>Load</button>
                </div>
              <div className="control-row">
                <label>Transpose</label>
                <div className="control-value-wrapper">
                  <input type="range" min="-24" max="24" step="1" value={engine.sampler.transpose} onChange={e => onLayerUpdate(engine.id, 'sampler', { transpose: +e.target.value })} />
                   <span>{engine.sampler.transpose} st</span>
                </div>
              </div>
              <div className="control-row">
                <label>Volume</label>
                <div className="control-value-wrapper">
                  <input type="range" min="0" max="1" step="0.01" value={engine.sampler.volume} onChange={e => onLayerUpdate(engine.id, 'sampler', { volume: +e.target.value })} />
                   <span>{(engine.sampler.volume * 100).toFixed(0)}%</span>
                </div>
              </div>
              <div className="control-row">
                <label>Granular Mode</label>
                <button
                    className={`power-toggle small ${engine.sampler.granularModeEnabled ? 'active' : ''}`}
                    onClick={() => onLayerUpdate(engine.id, 'sampler', { granularModeEnabled: !engine.sampler.granularModeEnabled })}>
                    {engine.sampler.granularModeEnabled ? 'ON' : 'OFF'}
                </button>
              </div>
              {engine.sampler.granularModeEnabled && (
                <>
                    <div className="control-row">
                        <label>Grain Size</label>
                        <div className="control-value-wrapper">
                            <input type="range" min="0.01" max="0.5" step="0.001" value={engine.sampler.grainSize} onChange={e => onLayerUpdate(engine.id, 'sampler', { grainSize: +e.target.value })} />
                            <span>{(engine.sampler.grainSize * 1000).toFixed(0)} ms</span>
                        </div>
                    </div>
                    <div className="control-row">
                        <label>Density</label>
                        <div className="control-value-wrapper">
                            <input type="range" min="1" max="100" step="1" value={engine.sampler.grainDensity} onChange={e => onLayerUpdate(engine.id, 'sampler', { grainDensity: +e.target.value })} />
                            <span>{engine.sampler.grainDensity} /s</span>
                        </div>
                    </div>
                    <div className="control-row">
                        <label>Position</label>
                        <div className="control-value-wrapper">
                            <input type="range" min="0" max="1" step="0.001" value={engine.sampler.playbackPosition} onChange={e => onLayerUpdate(engine.id, 'sampler', { playbackPosition: +e.target.value })} />
                            <span>{(engine.sampler.playbackPosition * 100).toFixed(1)}%</span>
                        </div>
                    </div>
                    <div className="control-row">
                        <label>Jitter</label>
                        <div className="control-value-wrapper">
                            <input type="range" min="0" max="1" step="0.01" value={engine.sampler.positionJitter} onChange={e => onLayerUpdate(engine.id, 'sampler', { positionJitter: +e.target.value })} />
                            <span>{(engine.sampler.positionJitter * 100).toFixed(0)}%</span>
                        </div>
                    </div>
                </>
              )}
            </>}
          </div>
        );
      default: return null;
    }
  };
  
  const layerStates = {
      synth: engine.synth,
      noise: engine.noise,
      sampler: engine.sampler
  };

  return (
    <div className="control-group engine-controls">
        <div className="control-group-header">
            <div className="engine-title-group">
                <h2>{engine.name}</h2>
                <button
                    className={`seq-toggle small ${engine.sequencerEnabled ? 'active' : ''}`}
                    onClick={() => onUpdate(engine.id, { sequencerEnabled: !engine.sequencerEnabled })}
                    title="Toggle Sequencer"
                >
                    SEQ
                </button>
                <button
                    className={`midi-toggle small ${engine.midiControlled ? 'active' : ''}`}
                    onClick={() => onUpdate(engine.id, { midiControlled: !engine.midiControlled })}
                    title="Toggle MIDI Input"
                >
                    MIDI
                </button>
            </div>
            <div className="randomizer-buttons-group">
                <button className="icon-button" title="Chaos Randomize" onClick={() => onRandomize('chaos', engine.id)}><ChaosIcon /></button>
                <button className="icon-button" title="Harmonic Randomize" onClick={() => onRandomize('harmonic', engine.id)}><HarmonicIcon /></button>
                <button className="icon-button" title="Rhythmic Randomize" onClick={() => onRandomize('rhythmic', engine.id)}><RhythmicIcon /></button>
                <button className="icon-button ai-button" title="Intelligent Randomize" onClick={() => onIntelligentRandomize(engine.id)}><AIIcon /></button>
            </div>
        </div>
        {analyserNode &&
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
        }
        <div className="tab-nav">
          {(['synth', 'noise', 'sampler'] as EngineLayerType[]).map(tab => {
            const layerState = layerStates[tab];
            return (
                <div 
                  key={tab} 
                  className={`tab-button-wrapper ${activeTab === tab ? 'active' : ''}`}
                  onClick={() => setActiveTab(tab)}
                >
                  <span className="tab-button-label">{tab.charAt(0).toUpperCase() + tab.slice(1)}</span>
                  <button
                    className={`tab-power-button ${layerState.enabled ? 'active' : ''}`}
                    onClick={(e) => {
                        e.stopPropagation();
                        onLayerUpdate(engine.id, tab, { enabled: !layerState.enabled });
                    }}
                  />
                </div>
            )
          })}
        </div>
        <div className="tab-content">
          {renderTabContent()}
        </div>
        <div className="control-row">
            <label>Steps</label>
            <div className="control-value-wrapper">
                <input type="range" min="1" max="32" step="1" value={engine.sequencerSteps} onChange={e => onUpdate(engine.id, { sequencerSteps: +e.target.value })} />
                <span>{engine.sequencerSteps}</span>
            </div>
        </div>
        <div className="control-row">
            <label>Pulses</label>
             <div className="control-value-wrapper">
                <input type="range" min="0" max={engine.sequencerSteps} step="1" value={engine.sequencerPulses} onChange={e => onUpdate(engine.id, { sequencerPulses: +e.target.value })} />
                <span>{engine.sequencerPulses}</span>
            </div>
        </div>
         <div className="control-row">
            <label>Rotate</label>
             <div className="control-value-wrapper">
                <input type="range" min="0" max={engine.sequencerSteps -1} step="1" value={engine.sequencerRotate} onChange={e => onUpdate(engine.id, { sequencerRotate: +e.target.value })} />
                <span>{engine.sequencerRotate}</span>
            </div>
        </div>
    </div>
  );
};

const FilterRoutingSwitch: React.FC<{
    filterRouting: FilterRouting;
    setFilterRouting: (routing: FilterRouting) => void;
}> = ({ filterRouting, setFilterRouting }) => {
    return (
        <div className="filter-routing-switch">
            <button className={filterRouting === 'series' ? 'active' : ''} onClick={() => setFilterRouting('series')}>
                Series
            </button>
            <button className={filterRouting === 'parallel' ? 'active' : ''} onClick={() => setFilterRouting('parallel')}>
                Parallel
            </button>
        </div>
    );
};

const TopBar: React.FC<TopBarProps> = ({
    masterVolume, setMasterVolume, bpm, setBPM, isTransportPlaying, onToggleTransport,
    midiInputs, selectedMidiInputId, onMidiInputChange, midiActivity,
    voicingMode, setVoicingMode, glideTime, setGlideTime, isGlideSynced, setIsGlideSynced,
    glideSyncRateIndex, setGlideSyncRateIndex, glideSyncRates,
    presets, selectedPreset, onLoadPreset, onSavePreset, onDeletePreset,
    audioOutputs, selectedAudioOutputId, onAudioOutputChange,
}) => {
    const [inputValue, setInputValue] = useState(bpm.toFixed(2));
    const isFocusedRef = useRef(false);

    useEffect(() => {
        if (!isFocusedRef.current) {
            setInputValue(bpm.toFixed(2));
        }
    }, [bpm]);
    
    const commitChange = () => {
        const newBpm = parseFloat(inputValue);
        if (!isNaN(newBpm) && newBpm > 0) {
            setBPM(newBpm);
        } else {
            setInputValue(bpm.toFixed(2));
        }
    };

    const handleBlur = () => {
        isFocusedRef.current = false;
        commitChange();
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            commitChange();
            (e.target as HTMLInputElement).blur();
        } else if (e.key === 'Escape') {
            setInputValue(bpm.toFixed(2));
            (e.target as HTMLInputElement).blur();
        }
    };
    
    const handleGlideChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (isGlideSynced) {
            setGlideSyncRateIndex(Number(e.target.value));
        } else {
            setGlideTime(Number(e.target.value));
        }
    }

    return (
        <div className="top-bar">
            <div className="top-bar-group">
                <h2>Poly-Rhythm Synth</h2>
            </div>
            <div className="top-bar-group preset-group">
                <label>Presets</label>
                <select value={selectedPreset} onChange={e => onLoadPreset(e.target.value)}>
                    <option value="">-- unsaved --</option>
                    {Object.keys(presets).map(name => <option key={name} value={name}>{name}</option>)}
                </select>
                <div className="preset-buttons">
                    <button className="small" onClick={onSavePreset}>Save</button>
                    <button className="small" onClick={() => onDeletePreset(selectedPreset)} disabled={!selectedPreset}>Delete</button>
                </div>
            </div>
             <div className="top-bar-group">
                <label>Audio Output</label>
                <select value={selectedAudioOutputId} onChange={e => onAudioOutputChange(e.target.value)}>
                    {audioOutputs.map(output => <option key={output.id} value={output.id}>{output.label}</option>)}
                </select>
            </div>
            <div className="top-bar-group">
                <div className="control-row">
                    <label>Master Volume</label>
                    <div className="control-value-wrapper">
                        <input type="range" min="0" max="1" step="0.01" value={masterVolume} onChange={e => setMasterVolume(Number(e.target.value))} />
                        <span>{(masterVolume * 100).toFixed(0)}%</span>
                    </div>
                </div>
            </div>
            <div className="top-bar-group">
                <div className="control-row">
                    <label>BPM</label>
                    <div className="control-value-wrapper">
                         <input
                            type="range"
                            min="30"
                            max="300"
                            step="0.1"
                            value={bpm}
                            onChange={e => setBPM(Number(e.target.value))}
                            style={{width: '100px'}}
                        />
                        <input
                            type="text"
                            value={inputValue}
                            onChange={(e) => setInputValue(e.target.value)}
                            onFocus={() => isFocusedRef.current = true}
                            onBlur={handleBlur}
                            onKeyDown={handleKeyDown}
                            style={{ width: '60px', textAlign: 'right', backgroundColor: '#3a3a50', color: 'var(--on-surface-color)', border: '1px solid #4a4a60', borderRadius: '4px', padding: '0.3rem' }}
                        />
                    </div>
                </div>
                <button onClick={onToggleTransport} className={isTransportPlaying ? 'active' : ''}>
                    {isTransportPlaying ? 'Stop' : 'Play'}
                </button>
            </div>
             <div className="top-bar-group">
                <label>Voicing</label>
                <div className="voicing-switch">
                    <button className={voicingMode === 'poly' ? 'active' : ''} onClick={() => setVoicingMode('poly')}>Poly</button>
                    <button className={voicingMode === 'mono' ? 'active' : ''} onClick={() => setVoicingMode('mono')}>Mono</button>
                    <button className={voicingMode === 'legato' ? 'active' : ''} onClick={() => setVoicingMode('legato')}>Legato</button>
                </div>
                 <div className="control-value-wrapper">
                    <label>Glide</label>
                    <input
                        type="range"
                        min={isGlideSynced ? 0 : 0.001}
                        max={isGlideSynced ? glideSyncRates.length - 1 : 2}
                        step={isGlideSynced ? 1 : 0.001}
                        value={isGlideSynced ? glideSyncRateIndex : glideTime}
                        onChange={handleGlideChange}
                        style={{width: '80px'}}
                    />
                    <button onClick={() => setIsGlideSynced(!isGlideSynced)} className={`small ${isGlideSynced ? 'active' : ''}`}>Sync</button>
                    <span style={{minWidth: '50px'}}>
                        {isGlideSynced ? glideSyncRates[glideSyncRateIndex] : `${(glideTime*1000).toFixed(0)}ms`}
                    </span>
                 </div>
            </div>
            <div className="top-bar-group">
                <label>MIDI Input</label>
                <div className="midi-indicator" style={{ backgroundColor: midiActivity ? 'var(--secondary-color)' : '#333' }} />
                <select value={selectedMidiInputId ?? ''} onChange={e => onMidiInputChange(e.target.value)}>
                    <option value="">No Device</option>
                    {midiInputs.map(input => <option key={input.id} value={input.id}>{input.name}</option>)}
                </select>
            </div>
        </div>
    );
};


const MasterFilterControls: React.FC<MasterFilterControlsProps> = ({
    title, filterState, onUpdate, onRandomize, onIntelligentRandomize
}) => {
    return (
        <div className="control-group">
            <div className="control-group-header">
                <h2>{title}</h2>
                <div className="randomizer-buttons-group">
                    <button className="icon-button" title="Chaos Randomize" onClick={() => onRandomize('chaos', title.toLowerCase().replace(' ', ''))}><ChaosIcon /></button>
                    <button className="icon-button" title="Harmonic Randomize" onClick={() => onRandomize('harmonic', title.toLowerCase().replace(' ', ''))}><HarmonicIcon /></button>
                    <button className="icon-button" title="Rhythmic Randomize" onClick={() => onRandomize('rhythmic', title.toLowerCase().replace(' ', ''))}><RhythmicIcon /></button>
                    <button className="icon-button ai-button" title="Intelligent Randomize" onClick={() => onIntelligentRandomize(title.toLowerCase().replace(' ', ''))}><AIIcon /></button>
                </div>
            </div>
            <div className="control-row">
                <label>Type</label>
                <select value={filterState.type} onChange={e => onUpdate({ type: e.target.value as FilterType })}>
                    {filterTypes.map(type => <option key={type} value={type}>{type}</option>)}
                </select>
            </div>
            <div className="control-row">
                <label>Cutoff</label>
                <div className="control-value-wrapper">
                    <input type="range" min="20" max="20000" step="1" value={filterState.cutoff} onChange={e => onUpdate({ cutoff: Number(e.target.value) })} />
                    <span>{filterState.cutoff.toFixed(0)} Hz</span>
                </div>
            </div>
            <div className="control-row">
                <label>Resonance</label>
                <div className="control-value-wrapper">
                    <input type="range" min="0" max="30" step="0.1" value={filterState.resonance} onChange={e => onUpdate({ resonance: Number(e.target.value) })} />
                    <span>{filterState.resonance.toFixed(2)}</span>
                </div>
            </div>
        </div>
    );
}


const LFOControls: React.FC<LFOControlsProps> = ({ lfoState, onUpdate, onRandomize, onIntelligentRandomize }) => {
    return (
        <div className="control-group lfo-controls">
            <div className="control-group-header">
                <h2>{lfoState.name}</h2>
                 <div className="randomizer-buttons-group">
                    <button className="icon-button" title="Chaos Randomize" onClick={() => onRandomize('chaos', lfoState.id)}><ChaosIcon /></button>
                    <button className="icon-button" title="Harmonic Randomize" onClick={() => onRandomize('harmonic', lfoState.id)}><HarmonicIcon /></button>
                    <button className="icon-button" title="Rhythmic Randomize" onClick={() => onRandomize('rhythmic', lfoState.id)}><RhythmicIcon /></button>
                    <button className="icon-button ai-button" title="Intelligent Randomize" onClick={() => onIntelligentRandomize(lfoState.id)}><AIIcon /></button>
                </div>
            </div>
            <LFOVisualizer shape={lfoState.shape} rate={lfoState.rate} />
            <div className="control-row">
                <label>Shape</label>
                <select value={lfoState.shape} onChange={e => onUpdate({ shape: e.target.value as LFO_Shape })}>
                    {lfoShapes.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
            </div>
            <div className="control-row">
                <label>{lfoState.sync ? 'Sync Rate' : 'Rate'}</label>
                {lfoState.sync ? (
                     <select value={lfoState.syncRate} onChange={e => onUpdate({ syncRate: e.target.value })}>
                        {lfoSyncRates.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                ) : (
                    <div className="control-value-wrapper">
                        <input type="range" min="0.1" max="30" step="0.1" value={lfoState.rate} onChange={e => onUpdate({ rate: +e.target.value })} />
                        <span>{lfoState.rate.toFixed(1)} Hz</span>
                    </div>
                )}
            </div>
             <div className="control-row">
                <label>Depth</label>
                 <div className="control-value-wrapper">
                    <input type="range" min="0" max="1" step="0.01" value={lfoState.depth} onChange={e => onUpdate({ depth: +e.target.value })} />
                    <span>{(lfoState.depth * 100).toFixed(0)}%</span>
                </div>
            </div>
            <div className="control-row">
                <label>BPM Sync</label>
                <button onClick={() => onUpdate({ sync: !lfoState.sync })} className={`small ${lfoState.sync ? 'active' : ''}`}>
                    {lfoState.sync ? 'ON' : 'OFF'}
                </button>
            </div>
        </div>
    );
};

const RoutingMatrix: React.FC<RoutingMatrixProps> = ({ lfoStates, onLfoUpdate, engineStates, onEngineUpdate }) => {
    const routingTargets = [
        { key: 'filter1Cutoff', label: 'Filter 1 Cutoff' },
        { key: 'filter1Resonance', label: 'Filter 1 Reso' },
        { key: 'filter2Cutoff', label: 'Filter 2 Cutoff' },
        { key: 'filter2Resonance', label: 'Filter 2 Reso' },
        { key: 'engine1Vol', label: 'Engine 1 Volume' },
        { key: 'engine1SynthFreq', label: 'E1 Synth Freq' },
        { key: 'engine1SamplerTranspose', label: 'E1 Sampler Trans' },
        { key: 'engine1GrainSize', label: 'E1 Grain Size' },
        { key: 'engine1GrainDensity', label: 'E1 Grain Density' },
        { key: 'engine1GrainPosition', label: 'E1 Grain Position' },
        { key: 'engine1GrainJitter', label: 'E1 Grain Jitter' },
        { key: 'engine2Vol', label: 'Engine 2 Volume' },
        { key: 'engine2SynthFreq', label: 'E2 Synth Freq' },
        { key: 'engine2SamplerTranspose', label: 'E2 Sampler Trans' },
        { key: 'engine2GrainSize', label: 'E2 Grain Size' },
        { key: 'engine2GrainDensity', label: 'E2 Grain Density' },
        { key: 'engine2GrainPosition', label: 'E2 Grain Position' },
        { key: 'engine2GrainJitter', label: 'E2 Grain Jitter' },
        { key: 'engine3Vol', label: 'Engine 3 Volume' },
        { key: 'engine3SynthFreq', label: 'E3 Synth Freq' },
        { key: 'engine3SamplerTranspose', label: 'E3 Sampler Trans' },
        { key: 'engine3GrainSize', label: 'E3 Grain Size' },
        { key: 'engine3GrainDensity', label: 'E3 Grain Density' },
        { key: 'engine3GrainPosition', label: 'E3 Grain Position' },
        { key: 'engine3GrainJitter', label: 'E3 Grain Jitter' },
    ];

    const handleLfoRoutingChange = (lfoId: string, target: keyof LFOState['routing'], value: boolean) => {
        const lfo = lfoStates.find(l => l.id === lfoId);
        if (lfo) {
            onLfoUpdate(lfoId, { routing: { ...lfo.routing, [target]: value } });
        }
    };

    const handleSequencerRoutingChange = (engineId: string, target: keyof EngineState['routing'], value: boolean) => {
        const engine = engineStates.find(e => e.id === engineId);
        if(engine) {
            onEngineUpdate(engineId, { routing: { ...engine.routing, [target]: value }});
        }
    }

    return (
        <table className="routing-matrix">
            <thead>
                <tr>
                    <th>Target</th>
                    {lfoStates.map(lfo => (
                        <th key={lfo.id} className="rotated-header"><div>{lfo.name}</div></th>
                    ))}
                     {engineStates.map((engine, i) => (
                        <th key={engine.id} className="rotated-header"><div>SEQ {i+1}</div></th>
                    ))}
                </tr>
            </thead>
            <tbody>
                {routingTargets.map(target => (
                    <tr key={target.key}>
                        <td>{target.label}</td>
                        {lfoStates.map(lfo => (
                            <td key={`${lfo.id}-${target.key}`}>
                                <input
                                    type="checkbox"
                                    checked={lfo.routing[target.key as keyof LFOState['routing']]}
                                    onChange={e => handleLfoRoutingChange(lfo.id, target.key as keyof LFOState['routing'], e.target.checked)}
                                />
                            </td>
                        ))}
                        {engineStates.map(engine => (
                            <td key={`${engine.id}-${target.key}`}>
                                <input
                                    type="checkbox"
                                    checked={engine.routing[target.key as keyof EngineState['routing']]}
                                    onChange={e => handleSequencerRoutingChange(engine.id, target.key as keyof EngineState['routing'], e.target.checked)}
                                />
                            </td>
                        ))}
                    </tr>
                ))}
            </tbody>
        </table>
    );
};


const EffectModule: React.FC<EffectModuleProps> = ({ effect, onUpdate, onRemove, onToggle, onRandomize, onIntelligentRandomize, onDragStart, onDragEnter, onDragEnd, isDragging, isDragOver }) => {
    const handleParamChange = (param: string, value: any) => {
        onUpdate(effect.id, { ...effect.params, [effect.type]: { ...effect.params[effect.type], [param]: value } });
    };

    const renderParams = () => {
        switch (effect.type) {
            case 'distortion':
                return <>
                    <div className="control-row">
                        <label>Mode</label>
                        <select value={effect.params.distortion?.mode ?? 'overdrive'} onChange={e => handleParamChange('mode', e.target.value as DistortionMode)}>
                            {distortionModes.map(mode => <option key={mode} value={mode}>{mode}</option>)}
                        </select>
                    </div>
                    <div className="control-row">
                        <label>Amount</label>
                        <div className="control-value-wrapper">
                            <input type="range" min="0" max="1" step="0.01" value={effect.params.distortion?.amount ?? 0} onChange={e => handleParamChange('amount', +e.target.value)} />
                             <span>{( (effect.params.distortion?.amount ?? 0) * 100).toFixed(0)}%</span>
                        </div>
                    </div>
                </>;
            case 'delay':
                return <>
                    <div className="control-row">
                        <label>Time</label>
                        <div className="control-value-wrapper">
                            <input type="range" min="0" max="1" step="0.01" value={effect.params.delay?.time ?? 0} onChange={e => handleParamChange('time', +e.target.value)} />
                             <span>{(effect.params.delay?.time ?? 0).toFixed(2)}s</span>
                        </div>
                    </div>
                    <div className="control-row">
                        <label>Feedback</label>
                        <div className="control-value-wrapper">
                            <input type="range" min="0" max="0.95" step="0.01" value={effect.params.delay?.feedback ?? 0} onChange={e => handleParamChange('feedback', +e.target.value)} />
                             <span>{((effect.params.delay?.feedback ?? 0) * 100).toFixed(0)}%</span>
                        </div>
                    </div>
                     <div className="control-row">
                        <label>Mix</label>
                        <div className="control-value-wrapper">
                            <input type="range" min="0" max="1" step="0.01" value={effect.params.delay?.mix ?? 0} onChange={e => handleParamChange('mix', +e.target.value)} />
                             <span>{((effect.params.delay?.mix ?? 0) * 100).toFixed(0)}%</span>
                        </div>
                    </div>
                </>;
            case 'reverb':
                 return <>
                    <div className="control-row">
                        <label>Decay</label>
                         <div className="control-value-wrapper">
                            <input type="range" min="0.1" max="10" step="0.1" value={effect.params.reverb?.decay ?? 0} onChange={e => handleParamChange('decay', +e.target.value)} />
                             <span>{(effect.params.reverb?.decay ?? 0).toFixed(1)}s</span>
                        </div>
                    </div>
                     <div className="control-row">
                        <label>Mix</label>
                         <div className="control-value-wrapper">
                            <input type="range" min="0" max="1" step="0.01" value={effect.params.reverb?.mix ?? 0} onChange={e => handleParamChange('mix', +e.target.value)} />
                             <span>{((effect.params.reverb?.mix ?? 0) * 100).toFixed(0)}%</span>
                        </div>
                    </div>
                </>;
            default: return null;
        }
    }

    return (
        <div
            className={`effect-module ${isDragging ? 'dragging' : ''} ${isDragOver ? 'drag-over' : ''}`}
        >
            <div
                className="effect-header"
                draggable
                onDragStart={(e) => onDragStart(e, effect)}
                onDragEnter={(e) => onDragEnter(e, effect)}
                onDragEnd={onDragEnd}
            >
                <h4>{effect.type.charAt(0).toUpperCase() + effect.type.slice(1)}</h4>
                <div className="effect-header-buttons">
                    <div className="randomizer-buttons-group">
                        <button className="icon-button" title="Chaos Randomize" onClick={() => onRandomize('chaos', effect.id)}><ChaosIcon /></button>
                        <button className="icon-button" title="Harmonic Randomize" onClick={() => onRandomize('harmonic', effect.id)}><HarmonicIcon /></button>
                        <button className="icon-button" title="Rhythmic Randomize" onClick={() => onRandomize('rhythmic', effect.id)}><RhythmicIcon /></button>
                        <button className="icon-button ai-button" title="Intelligent Randomize" onClick={() => onIntelligentRandomize(effect.id)}><AIIcon /></button>
                    </div>
                    <button className={`small ${effect.enabled ? 'active' : ''}`} onClick={() => onToggle(effect.id)}>
                        {effect.enabled ? 'On' : 'Off'}
                    </button>
                    <button className="small remove-effect-btn" onClick={() => onRemove(effect.id)}>X</button>
                </div>
            </div>
            {renderParams()}
        </div>
    );
};

const MasterEffects: React.FC<MasterEffectsProps> = ({ effects, setEffects, onRandomize, onIntelligentRandomize }) => {
    const [draggingEffect, setDraggingEffect] = useState<MasterEffect | null>(null);
    const [dragOverEffect, setDragOverEffect] = useState<MasterEffect | null>(null);
    const dragNode = useRef<HTMLDivElement | null>(null);

    const handleAddEffect = (type: MasterEffectType) => {
        const newEffect: MasterEffect = {
            id: `${type}-${Date.now()}`,
            type,
            enabled: true,
            params: {}
        };
        switch(type) {
            case 'distortion': newEffect.params.distortion = { mode: 'overdrive', amount: 0.5 }; break;
            case 'delay': newEffect.params.delay = { time: 0.5, feedback: 0.5, mix: 0.5 }; break;
            case 'reverb': newEffect.params.reverb = { decay: 2, mix: 0.5 }; break;
        }
        setEffects(prev => [...prev, newEffect]);
    };

    const handleUpdateEffect = (id: string, params: MasterEffect['params']) => {
        setEffects(prev => prev.map(e => e.id === id ? { ...e, params } : e));
    };
    const handleRemoveEffect = (id: string) => {
        setEffects(prev => prev.filter(e => e.id !== id));
    };
    const handleToggleEffect = (id: string) => {
        setEffects(prev => prev.map(e => e.id === id ? { ...e, enabled: !e.enabled } : e));
    };

    const handleDragStart = (e: React.DragEvent<HTMLDivElement>, effect: MasterEffect) => {
        setDraggingEffect(effect);
        dragNode.current = e.target as HTMLDivElement;
        dragNode.current.addEventListener('dragend', handleDragEnd);
    };

    const handleDragEnter = (e: React.DragEvent<HTMLDivElement>, effect: MasterEffect) => {
        if (draggingEffect && draggingEffect.id !== effect.id) {
            setDragOverEffect(effect);
        }
    };

    const handleDragEnd = () => {
        if (draggingEffect && dragOverEffect) {
            setEffects(prev => {
                const newEffects = [...prev];
                const draggingIndex = newEffects.findIndex(e => e.id === draggingEffect.id);
                const dragOverIndex = newEffects.findIndex(e => e.id === dragOverEffect.id);
                const [removed] = newEffects.splice(draggingIndex, 1);
                newEffects.splice(dragOverIndex, 0, removed);
                return newEffects;
            });
        }
        setDraggingEffect(null);
        setDragOverEffect(null);
        if (dragNode.current) {
            dragNode.current.removeEventListener('dragend', handleDragEnd);
            dragNode.current = null;
        }
    };

    return (
        <div className="control-group master-effects-container">
            <div className="control-group-header master-effects-header">
                <h2>Master Effects</h2>
                <select onChange={(e) => handleAddEffect(e.target.value as MasterEffectType)} value="">
                    <option value="" disabled>Add Effect...</option>
                    {availableMasterEffects.map(type => <option key={type} value={type}>{type}</option>)}
                </select>
            </div>
            <div className="effects-chain">
                {effects.length > 0 ? effects.map(effect => (
                    <EffectModule
                        key={effect.id}
                        effect={effect}
                        onUpdate={handleUpdateEffect}
                        onRemove={handleRemoveEffect}
                        onToggle={handleToggleEffect}
                        onRandomize={onRandomize}
                        onIntelligentRandomize={onIntelligentRandomize}
                        onDragStart={handleDragStart}
                        onDragEnter={handleDragEnter}
                        onDragEnd={handleDragEnd}
                        isDragging={draggingEffect?.id === effect.id}
                        isDragOver={dragOverEffect?.id === effect.id}
                    />
                )) : (
                     <div className="effects-chain-empty">
                        <p>Add an effect to begin</p>
                    </div>
                )}
            </div>
        </div>
    );
};

const TuningSelector: React.FC<{
    harmonicTuningSystem: TuningSystem,
    setHarmonicTuningSystem: (system: TuningSystem) => void,
}> = ({ harmonicTuningSystem, setHarmonicTuningSystem }) => {
    return (
        <div className="tuning-selector">
            <div className="control-row">
                <label>Harmonic Mode</label>
                <select value={harmonicTuningSystem} onChange={e => setHarmonicTuningSystem(e.target.value as TuningSystem)}>
                    <option value="440_ET">440Hz Equal Temperament</option>
                    <option value="432_ET">432Hz Equal Temperament</option>
                    <option value="just_intonation_440">Just Intonation (A4=440)</option>
                    <option value="just_intonation_432">Just Intonation (A4=432)</option>
                    <option value="pythagorean_440">Pythagorean (A4=440)</option>
                    <option value="pythagorean_432">Pythagorean (A4=432)</option>
                    <option value="solfeggio">Solfeggio</option>
                    <option value="wholesome_scale">Wholesome Scale (G Major)</option>
                </select>
            </div>
        </div>
    );
};


const GenerativeTools: React.FC<GenerativeToolsProps> = ({
    onRandomize, onIntelligentRandomize, isMorphEnabled, setIsMorphEnabled, morphDuration, setMorphDuration,
    harmonicTuningSystem, setHarmonicTuningSystem
}) => {
    return (
        <div className="control-group generative-container">
            <div className="control-group-header">
                <h2>Generative Tools</h2>
            </div>
            <div className="generative-controls">
                <div className="sub-control-group">
                     <div className="control-row">
                        <label>Randomize All</label>
                        <div className="randomizer-buttons-group">
                             <button className="icon-button" onClick={() => onRandomize('chaos', 'global')} title="Chaos Randomize"><ChaosIcon /></button>
                             <button className="icon-button" onClick={() => onRandomize('harmonic', 'global')} title="Harmonic Randomize"><HarmonicIcon /></button>
                             <button className="icon-button" onClick={() => onRandomize('rhythmic', 'global')} title="Rhythmic Randomize"><RhythmicIcon /></button>
                             <button className="icon-button ai-button" onClick={() => onIntelligentRandomize('global')} title="Intelligent Randomize"><AIIcon /></button>
                        </div>
                    </div>
                </div>
                <div className="sub-control-group">
                    <div className="control-row">
                        <label>Morph Randomization</label>
                        <button onClick={() => setIsMorphEnabled(!isMorphEnabled)} className={`small ${isMorphEnabled ? 'active' : ''}`}>
                            {isMorphEnabled ? 'ON' : 'OFF'}
                        </button>
                    </div>
                    {isMorphEnabled && (
                        <div className="control-row">
                            <label>Duration (steps)</label>
                            <div className="control-value-wrapper">
                                <input
                                    type="range" min="1" max="64" step="1"
                                    value={morphDuration}
                                    onChange={e => setMorphDuration(Number(e.target.value))}
                                />
                                <span>{morphDuration}</span>
                            </div>
                        </div>
                    )}
                </div>
                 <div className="sub-control-group">
                    <TuningSelector
                        harmonicTuningSystem={harmonicTuningSystem}
                        setHarmonicTuningSystem={setHarmonicTuningSystem}
                    />
                 </div>
            </div>
        </div>
    );
};


// --- Main Audio Hook ---
const useAudio = (
  engineStates: EngineState[],
  setEngineStates: React.Dispatch<React.SetStateAction<EngineState[]>>,
  masterVolume: number,
  filter1State: FilterState,
  filter2State: FilterState,
  filterRouting: FilterRouting,
  lfoStates: LFOState[],
  masterEffects: MasterEffect[],
  bpm: number,
  isTransportPlaying: boolean,
  harmonicTuningSystem: TuningSystem,
  selectedMidiInputId: string | null,
  setMidiActivity: (active: boolean) => void,
  voicingMode: VoicingMode,
  glideTime: number,
  selectedAudioOutputId: string
) => {
  const audioContextRef = useRef<{ audioContext: AudioContext | null, masterGain: GainNode | null }>({ audioContext: null, masterGain: null });
  const engineNodesRef = useRef<Map<string, EngineAudioNodes>>(new Map());
  const filter1NodesRef = useRef<FilterNodes | null>(null);
  const filter2NodesRef = useRef<FilterNodes | null>(null);
  const filterSplitterRef = useRef<GainNode | null>(null);
  const filterMergerRef = useRef<GainNode | null>(null);
  const lfoNodesRef = useRef<Map<string, { lfo: OscillatorNode; depth: GainNode }>>(new Map());
  const lfoRoutingBussesRef = useRef<LfoRoutingBusses | null>(null);
  const masterEffectsChainRef = useRef<AudioNode[]>([]);
  const masterAnalyserRef = useRef<AnalyserNode | null>(null);
  const leftAnalyserRef = useRef<AnalyserNode | null>(null);
  const rightAnalyserRef = useRef<AnalyserNode | null>(null);
  const splitterRef = useRef<ChannelSplitterNode | null>(null);
  
  // Voice Management Refs
  const polyVoicesRef = useRef<Map<string, Map<number, ActiveVoice>>>(new Map());
  const monoVoicesRef = useRef<Map<string, ActiveVoice>>(new Map());
  const heldNotesRef = useRef<number[]>([]);

  const [isInitialized, setIsInitialized] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [sampleBuffers, setSampleBuffers] = useState<Map<string, AudioBuffer>>(new Map());

  const patternsRef = useRef<Map<string, number[]>>(new Map());
  const stepTimeRef = useRef(0);
  const midiActivityTimerRef = useRef<number | null>(null);
  
  // Create refs for state that's used in callbacks, to keep callbacks stable
  const engineStatesRef = useRef(engineStates);
  engineStatesRef.current = engineStates;
  const lfoStatesRef = useRef(lfoStates);
  lfoStatesRef.current = lfoStates;
  const bpmRef = useRef(bpm);
  bpmRef.current = bpm;
  const harmonicTuningSystemRef = useRef(harmonicTuningSystem);
  harmonicTuningSystemRef.current = harmonicTuningSystem;
  const sampleBuffersRef = useRef(sampleBuffers);
  sampleBuffersRef.current = sampleBuffers;
  const voicingModeRef = useRef(voicingMode);
  voicingModeRef.current = voicingMode;
  const glideTimeRef = useRef(glideTime);
  glideTimeRef.current = glideTime;
  const playStartTimeRef = useRef(0);
  const lfoPhasesRef = useRef(new Map());


  const initializeAudio = useCallback(() => {
    if (isInitialized) return;
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    const masterGain = audioContext.createGain();
    masterGain.connect(audioContext.destination);
    
    audioContextRef.current = { audioContext, masterGain };
    
    masterAnalyserRef.current = audioContext.createAnalyser();
    leftAnalyserRef.current = audioContext.createAnalyser();
    rightAnalyserRef.current = audioContext.createAnalyser();
    splitterRef.current = audioContext.createChannelSplitter(2);

    // Create dual filters and routing nodes
    const createFilterWithBusses = (): FilterNodes => {
        const node = audioContext.createBiquadFilter();
        const cutoffModBus = audioContext.createGain();
        const resonanceModBus = audioContext.createGain();
        cutoffModBus.gain.value = 5000; // Modulation range
        resonanceModBus.gain.value = 15; // Modulation range
        cutoffModBus.connect(node.frequency);
        resonanceModBus.connect(node.Q);
        return { node, cutoffModBus, resonanceModBus };
    };
    filter1NodesRef.current = createFilterWithBusses();
    filter2NodesRef.current = createFilterWithBusses();
    filterSplitterRef.current = audioContext.createGain();
    filterMergerRef.current = audioContext.createGain();

    engineStates.forEach(engine => {
      const engineMixer = audioContext.createGain(); // For continuous sources
      const finalOutput = audioContext.createGain(); // To combine MIDI and Sequencer
      const sequencerGain = audioContext.createGain();
      const midiInputGain = audioContext.createGain();

      const sequencerModSource = audioContext.createConstantSource();
      sequencerModSource.offset.value = 1.0; // The signal for modulation
      const sequencerModGate = audioContext.createGain();
      sequencerModGate.gain.value = 0; // Starts at 0
      sequencerModSource.connect(sequencerModGate);
      sequencerModSource.start();

      const analyser = audioContext.createAnalyser();

      // Path for sequenced sound (continuous sources -> mixer -> sequencer gate)
      engineMixer.connect(sequencerGain);
      sequencerGain.connect(finalOutput);
      // Path for MIDI sound
      midiInputGain.connect(finalOutput);
      // Combined output path
      finalOutput.connect(analyser);
      finalOutput.connect(filterSplitterRef.current!);


      engineNodesRef.current.set(engine.id, {
        synth: { volumeGain: audioContext.createGain() },
        noise: { volumeGain: audioContext.createGain() },
        sampler: { volumeGain: audioContext.createGain() },
        engineMixer,
        finalOutput,
        sequencerGain,
        midiInputGain,
        sequencerModSource,
        sequencerModGate,
        analyser
      });
      polyVoicesRef.current.set(engine.id, new Map());
    });

    lfoStates.forEach(lfoState => {
        const lfo = audioContext.createOscillator();
        const depth = audioContext.createGain();
        lfo.type = lfoState.shape === 'ramp' ? 'sawtooth' : lfoState.shape;
        lfo.frequency.value = lfoState.rate;
        depth.gain.value = lfoState.depth;
        lfo.start();
        lfo.connect(depth);
        lfoNodesRef.current.set(lfoState.id, { lfo, depth });
    });

    const engineModBusses = new Map<string, EngineModBusses>();
    engineStates.forEach(engine => {
        const volBus = audioContext.createGain();
        volBus.gain.value = 0.5; // Neutral point
        const engineNodes = engineNodesRef.current.get(engine.id);
        if (engineNodes) volBus.connect(engineNodes.finalOutput.gain);
        
        const synthFreqBus = audioContext.createGain();
        synthFreqBus.gain.value = 2000; // Modulation range in Hz
        const samplerTransposeBus = audioContext.createGain();
        samplerTransposeBus.gain.value = 2400; // Modulation range in cents (24 semitones)

        engineModBusses.set(engine.id, { vol: volBus, synthFreq: synthFreqBus, samplerTranspose: samplerTransposeBus });
    });
    
    lfoRoutingBussesRef.current = {
        filter1: { cutoffModBus: filter1NodesRef.current.cutoffModBus, resonanceModBus: filter1NodesRef.current.resonanceModBus },
        filter2: { cutoffModBus: filter2NodesRef.current.cutoffModBus, resonanceModBus: filter2NodesRef.current.resonanceModBus },
        engineModBusses
    };

    setIsInitialized(true);
  }, [engineStates, isInitialized, lfoStates]);

  const loadSample = useCallback(async (engineId: string, file: File) => {
    if (!audioContextRef.current.audioContext) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
      if (e.target?.result instanceof ArrayBuffer) {
        try {
          const audioBuffer = await audioContextRef.current.audioContext!.decodeAudioData(e.target.result);
          setSampleBuffers(prev => new Map(prev).set(engineId, audioBuffer));
          setEngineStates(prev => prev.map(eng => eng.id === engineId ? { ...eng, sampler: {...eng.sampler, sampleName: file.name} } : eng));
        } catch (err) {
          console.error('Error decoding audio file:', err);
          alert(`Could not load audio file: "${file.name}". The file may be corrupted or in an unsupported format. Please try a different file (e.g., WAV, MP3).`);
        }
      }
    };
    reader.readAsArrayBuffer(file);
  }, [setEngineStates]);
  
    const stopVoice = useCallback((voice: ActiveVoice, context: AudioContext) => {
        const stopTime = context.currentTime + 0.1;
        voice.velocityGain.gain.setTargetAtTime(0, context.currentTime, 0.02);
        voice.sourceNodes.forEach(node => {
            try { node.stop(stopTime); } catch (e) { /* already stopped */ }
        });
        setTimeout(() => {
            voice.sourceNodes.forEach(n => n.disconnect());
            voice.noiseNodes?.forEach(n => n.disconnect());
            voice.velocityGain.disconnect();
        }, 200);
    }, []);
    
    const glideVoice = useCallback((voice: ActiveVoice, newNote: number, context: AudioContext, engine: EngineState) => {
        const newFreq = midiNoteToFrequency(newNote, harmonicTuningSystemRef.current);
        const glideTimeConstant = Math.max(0.001, glideTimeRef.current / 5);
        voice.sourceNodes.forEach(node => {
            if (node instanceof OscillatorNode) {
                node.frequency.cancelScheduledValues(context.currentTime);
                node.frequency.setTargetAtTime(newFreq, context.currentTime, glideTimeConstant);
            } else if (node instanceof AudioBufferSourceNode) {
                 if (engine) {
                    const c4Freq = midiNoteToFrequency(60, '440_ET');
                    const semitones = 12 * Math.log2(newFreq / c4Freq);
                    const detune = semitones * 100 + engine.sampler.transpose * 100;
                    node.detune.cancelScheduledValues(context.currentTime);
                    node.detune.setTargetAtTime(detune, context.currentTime, glideTimeConstant);
                }
            }
        });
    }, []);
  
  const handleNoteOn = useCallback((note: number, velocity: number) => {
    const { audioContext } = audioContextRef.current;
    if (!audioContext) return;
    
    // Add note to tracking array
    heldNotesRef.current = [...heldNotesRef.current.filter(n => n !== note), note];

    if (voicingModeRef.current === 'poly') {
        engineStatesRef.current.forEach(engine => {
            if (!engine.midiControlled) return;
            const engineVoices = polyVoicesRef.current.get(engine.id);
            if (engineVoices?.has(note)) return;

            const freq = midiNoteToFrequency(note, harmonicTuningSystemRef.current);
            const engineNodes = engineNodesRef.current.get(engine.id)!;
            const velocityGain = audioContext.createGain();
            velocityGain.gain.setValueAtTime(velocity / 127, audioContext.currentTime);
            velocityGain.connect(engineNodes.midiInputGain);
            
            const sourceNodes: (OscillatorNode | AudioBufferSourceNode)[] = [];
            const noiseNodes: (AudioBufferSourceNode | GainNode)[] = [];

            if (engine.synth.enabled) {
                const osc = audioContext.createOscillator();
                osc.type = engine.synth.oscillatorType;
                osc.frequency.setValueAtTime(freq, audioContext.currentTime);
                osc.connect(velocityGain);
                osc.start();
                sourceNodes.push(osc);
            }
            if (engine.noise.enabled && engine.noise.volume > 0) {
                 const bufferSize = audioContext.sampleRate * 2;
                const buffer = audioContext.createBuffer(1, bufferSize, audioContext.sampleRate);
                const output = buffer.getChannelData(0); let lastOut = 0;
                for (let i = 0; i < bufferSize; i++) {
                    let s; switch (engine.noise.noiseType) {
                        case 'white': s = Math.random() * 2 - 1; break;
                        case 'pink': { const b0 = 0.99886 * lastOut + (Math.random() * 2 - 1) * 0.0555179; const b1 = 0.99332 * lastOut + (Math.random() * 2 - 1) * 0.0750759; const b2 = 0.969 * lastOut + (Math.random() * 2 - 1) * 0.153852; lastOut = b0 + b1 + b2 + (Math.random() * 2 - 1) * 0.01; s = lastOut * 0.11; if (s > 1) s = 1; if (s < -1) s = -1; break; }
                        case 'brown': { const br = lastOut + (Math.random() * 2 - 1) * 0.02; lastOut = br; s = br * 3.5; if (s > 1) s = 1; if (s < -1) s = -1; break; }
                        default: s = Math.random() * 2-1;
                    } output[i] = s;
                }
                const noiseSource = audioContext.createBufferSource(); noiseSource.buffer = buffer; noiseSource.loop = true;
                const noiseVolumeGain = audioContext.createGain(); noiseVolumeGain.gain.setValueAtTime(engine.noise.volume, audioContext.currentTime);
                noiseSource.connect(noiseVolumeGain).connect(velocityGain); noiseSource.start();
                sourceNodes.push(noiseSource); noiseNodes.push(noiseSource, noiseVolumeGain);
            }
            const sampleBuffer = sampleBuffersRef.current.get(engine.id);
            if (engine.sampler.enabled && sampleBuffer) {
                const sampleSource = audioContext.createBufferSource();
                sampleSource.buffer = sampleBuffer;
                const c4Freq = midiNoteToFrequency(60, '440_ET');
                const semitones = 12 * Math.log2(freq / c4Freq);
                sampleSource.detune.setValueAtTime(semitones * 100 + engine.sampler.transpose * 100, audioContext.currentTime);
                sampleSource.loop = true;
                sampleSource.connect(velocityGain);
                sampleSource.start();
                sourceNodes.push(sampleSource);
            }
            if (sourceNodes.length > 0) {
                engineVoices?.set(note, { sourceNodes, velocityGain, noiseNodes });
            }
        });
    } else { // Mono or Legato
        engineStatesRef.current.forEach(engine => {
            if (!engine.midiControlled) return;
            const monoVoice = monoVoicesRef.current.get(engine.id);
            if (monoVoice) { // Voice already exists, glide it
                glideVoice(monoVoice, note, audioContext, engine);
                if (voicingModeRef.current === 'mono') { // Re-trigger envelope for mono
                    monoVoice.velocityGain.gain.cancelScheduledValues(audioContext.currentTime);
                    monoVoice.velocityGain.gain.setTargetAtTime(velocity / 127, audioContext.currentTime, 0.01);
                }
            } else { // No voice, create a new one
                 const freq = midiNoteToFrequency(note, harmonicTuningSystemRef.current);
                const engineNodes = engineNodesRef.current.get(engine.id)!;
                const velocityGain = audioContext.createGain();
                velocityGain.gain.setValueAtTime(velocity / 127, audioContext.currentTime);
                velocityGain.connect(engineNodes.midiInputGain);
                const sourceNodes: (OscillatorNode | AudioBufferSourceNode)[] = [];
                const noiseNodes: (AudioBufferSourceNode | GainNode)[] = [];

                 if (engine.synth.enabled) {
                    const osc = audioContext.createOscillator();
                    osc.type = engine.synth.oscillatorType;
                    osc.frequency.setValueAtTime(freq, audioContext.currentTime);
                    osc.connect(velocityGain);
                    osc.start();
                    sourceNodes.push(osc);
                }
                const sampleBuffer = sampleBuffersRef.current.get(engine.id);
                if (engine.sampler.enabled && sampleBuffer) {
                    const sampleSource = audioContext.createBufferSource();
                    sampleSource.buffer = sampleBuffer;
                    const c4Freq = midiNoteToFrequency(60, '440_ET');
                    const semitones = 12 * Math.log2(freq / c4Freq);
                    sampleSource.detune.setValueAtTime(semitones * 100 + engine.sampler.transpose * 100, audioContext.currentTime);
                    sampleSource.loop = true; // Make sure sampler loops for mono notes
                    sampleSource.connect(velocityGain);
                    sampleSource.start();
                    sourceNodes.push(sampleSource);
                }

                if(sourceNodes.length > 0) {
                    monoVoicesRef.current.set(engine.id, { sourceNodes, velocityGain, noiseNodes });
                }
            }
        });
    }
  }, [glideVoice]);
  
  const handleNoteOff = useCallback((note: number) => {
    const { audioContext } = audioContextRef.current;
    if (!audioContext) return;
    
    // Remove note from tracking array
    heldNotesRef.current = heldNotesRef.current.filter(n => n !== note);

    if (voicingModeRef.current === 'poly') {
        engineStatesRef.current.forEach(engine => {
            if (!engine.midiControlled) return;
            const engineVoices = polyVoicesRef.current.get(engine.id);
            const voice = engineVoices?.get(note);
            if (voice) {
                stopVoice(voice, audioContext);
                engineVoices.delete(note);
            }
        });
    } else { // Mono or Legato
        if (heldNotesRef.current.length === 0) { // Last note released
             monoVoicesRef.current.forEach((voice, engineId) => {
                stopVoice(voice, audioContext);
                monoVoicesRef.current.delete(engineId);
            });
        } else if (voicingModeRef.current === 'legato') { // Note released, but others held
            const lastNote = heldNotesRef.current[heldNotesRef.current.length - 1];
            monoVoicesRef.current.forEach((voice, engineId) => {
                const engine = engineStatesRef.current.find(e => e.id === engineId);
                if (engine) {
                    glideVoice(voice, lastNote, audioContext, engine);
                }
            });
        }
    }
  }, [stopVoice, glideVoice]);

  const midiMessageHandler = useCallback((message: MIDIMessageEvent) => {
    if (midiActivityTimerRef.current) clearTimeout(midiActivityTimerRef.current);
    setMidiActivity(true);
    midiActivityTimerRef.current = window.setTimeout(() => setMidiActivity(false), 50);

    const [command, note, velocity] = message.data;
    const cmd = command & 0xF0; // Get command type, ignoring channel

    if (cmd === 0x90 && velocity > 0) { // Note On on any channel
        handleNoteOn(note, velocity);
    } else if (cmd === 0x80 || (cmd === 0x90 && velocity === 0)) { // Note Off on any channel
        handleNoteOff(note);
    }
  }, [handleNoteOn, handleNoteOff, setMidiActivity]);

  // MIDI Handling Effect
  useEffect(() => {
    let activeInput: MIDIInput | null = null;
    const midiAccessHandler = (access: MIDIAccess) => {
        // Clean up previous listener
        if (activeInput) {
            activeInput.removeEventListener('midimessage', midiMessageHandler);
        }
        
        const selectedInput = access.inputs.get(selectedMidiInputId!);
        if (selectedInput) {
            activeInput = selectedInput;
            activeInput.addEventListener('midimessage', midiMessageHandler);
        }
    };

    if (selectedMidiInputId && navigator.requestMIDIAccess) {
        navigator.requestMIDIAccess().then(midiAccessHandler);
    }

    // Cleanup function
    return () => {
        // `activeInput` from the previous render is captured in this closure
        if (activeInput) {
            activeInput.removeEventListener('midimessage', midiMessageHandler);
        }
    }
  }, [selectedMidiInputId, midiMessageHandler]);

  useEffect(() => {
    const { audioContext, masterGain } = audioContextRef.current;
    if (!audioContext || !masterGain) return;
    masterGain.gain.setTargetAtTime(masterVolume, audioContext.currentTime, 0.01);
  }, [masterVolume, isInitialized]);
  
  // Audio Output Routing
  useEffect(() => {
    const { audioContext } = audioContextRef.current;
    if (!audioContext || !isInitialized || !('setSinkId' in AudioContext.prototype)) return;

    // An ID of 'default' can be problematic if the browser doesn't list a device with that exact ID.
    // An empty string '' is the specified way to select the user-agent's default output.
    const sinkIdToSet = selectedAudioOutputId === 'default' ? '' : selectedAudioOutputId;

    (audioContext as any).setSinkId(sinkIdToSet)
      .catch((err: any) => {
          console.error(`Failed to set audio output device to "${sinkIdToSet}":`, err);
          // Attempt to fallback to the default device if the selected one failed.
          if (sinkIdToSet !== '') {
            (audioContext as any).setSinkId('')
              .catch((fallbackErr: any) => console.error("Failed to set fallback audio output device:", fallbackErr));
          }
      });
  }, [selectedAudioOutputId, isInitialized]);
  
  useEffect(() => {
    const f1 = filter1NodesRef.current;
    const f2 = filter2NodesRef.current;
    if (!f1 || !f2 || !audioContextRef.current.audioContext) return;
    const { audioContext } = audioContextRef.current;
    
    f1.node.type = filter1State.type;
    f1.node.frequency.setTargetAtTime(filter1State.cutoff, audioContext.currentTime, 0.01);
    f1.node.Q.setTargetAtTime(filter1State.resonance, audioContext.currentTime, 0.01);

    f2.node.type = filter2State.type;
    f2.node.frequency.setTargetAtTime(filter2State.cutoff, audioContext.currentTime, 0.01);
    f2.node.Q.setTargetAtTime(filter2State.resonance, audioContext.currentTime, 0.01);
  }, [filter1State, filter2State, isInitialized]);

  // Sequencer logic
  useEffect(() => {
    engineStates.forEach(engine => {
      patternsRef.current.set(engine.id, rotatePattern(
        generateEuclideanPattern(engine.sequencerSteps, engine.sequencerPulses),
        engine.sequencerRotate
      ));
    });
  }, [engineStates]);

  // Transport Start/Stop handler
  useEffect(() => {
    if (!isTransportPlaying) {
        playStartTimeRef.current = 0;
        lfoPhasesRef.current.clear();
    }
  }, [isTransportPlaying]);

  useEffect(() => {
    if (!isTransportPlaying || !isInitialized || !audioContextRef.current.audioContext) {
        if (!isTransportPlaying) setCurrentStep(0);
        return;
    }
    const interval = (60 / bpm) / 4; // 16th note
    const { audioContext } = audioContextRef.current;

    if (playStartTimeRef.current === 0) {
        playStartTimeRef.current = audioContext.currentTime;
    }

    stepTimeRef.current = audioContext.currentTime + interval;
    const maxSteps = Math.max(...engineStates.map(e => e.sequencerSteps), 1);
    const scheduler = () => {
      const { audioContext } = audioContextRef.current;
      if (!audioContext) return;
      while (stepTimeRef.current < audioContext.currentTime + 0.1) {
        const currentGlobalStep = currentStep;
        engineStates.forEach(engine => {
          const pattern = patternsRef.current.get(engine.id);
          const engineNodes = engineNodesRef.current.get(engine.id);
          if (pattern && engineNodes) {
              const stepIndex = currentGlobalStep % pattern.length;
              if (pattern[stepIndex] === 1) {
                  // Always run modulation signal
                  engineNodes.sequencerModGate.gain.cancelScheduledValues(stepTimeRef.current);
                  engineNodes.sequencerModGate.gain.setValueAtTime(1, stepTimeRef.current);
                  engineNodes.sequencerModGate.gain.setValueAtTime(0, stepTimeRef.current + interval * 0.9);

                  // Only trigger audio if the engine's sequencer is enabled
                  if (engine.sequencerEnabled) {
                    engineNodes.sequencerGain.gain.cancelScheduledValues(stepTimeRef.current);
                    engineNodes.sequencerGain.gain.setValueAtTime(1, stepTimeRef.current);
                    engineNodes.sequencerGain.gain.setValueAtTime(0, stepTimeRef.current + interval * 0.9);
                  }
              }
          }
        });
        setCurrentStep(prev => (prev + 1) % maxSteps);
        stepTimeRef.current += interval;
      }
    };
    const timerId = setInterval(scheduler, 25);
    return () => clearInterval(timerId);
  }, [isTransportPlaying, bpm, currentStep, engineStates, isInitialized]);


  useEffect(() => {
    const { audioContext } = audioContextRef.current;
    if (!audioContext || !isInitialized) return;
    engineStates.forEach(engine => {
      const engineNodes = engineNodesRef.current.get(engine.id);
      if (!engineNodes) return;
      
      const { synth, noise, sampler } = engine;
      const { synth: synthNodes, noise: noiseNodes, sampler: samplerNodes, engineMixer } = engineNodes;
      
      // --- ALWAYS clean up old schedulers/sources for this engine first ---
      if (samplerNodes.granularSchedulerId) {
          clearTimeout(samplerNodes.granularSchedulerId);
          samplerNodes.granularSchedulerId = undefined;
      }
      if (samplerNodes.sourceNode) {
          try { samplerNodes.sourceNode.stop(); } catch (e) {}
          samplerNodes.sourceNode.disconnect();
          samplerNodes.sourceNode = undefined;
      }
      
      const synthFreqBus = lfoRoutingBussesRef.current?.engineModBusses.get(engine.id)?.synthFreq;
      if (synth.enabled) {
          if (!synthNodes.sourceNode) {
              synthNodes.sourceNode = audioContext.createOscillator();
              if(synthFreqBus) synthFreqBus.connect((synthNodes.sourceNode as OscillatorNode).frequency);
              synthNodes.sourceNode.connect(synthNodes.volumeGain).connect(engineMixer);
              synthNodes.sourceNode.start();
          }
          (synthNodes.sourceNode as OscillatorNode).type = synth.oscillatorType;
          (synthNodes.sourceNode as OscillatorNode).frequency.setTargetAtTime(synth.frequency, audioContext.currentTime, 0.01);
          synthNodes.volumeGain.gain.setTargetAtTime(synth.volume, audioContext.currentTime, 0.01);
      } else if (synthNodes.sourceNode) {
          synthNodes.sourceNode.stop(); synthNodes.sourceNode.disconnect(); synthNodes.sourceNode = undefined;
      }
      
      if (noise.enabled) {
          if (!noiseNodes.sourceNode || (noiseNodes.sourceNode as any).noiseType !== noise.noiseType) {
              if (noiseNodes.sourceNode) { noiseNodes.sourceNode.stop(); noiseNodes.sourceNode.disconnect(); }
              const bufferSize = audioContext.sampleRate * 2;
              const buffer = audioContext.createBuffer(1, bufferSize, audioContext.sampleRate);
              const output = buffer.getChannelData(0); let lastOut = 0;
              for (let i = 0; i < bufferSize; i++) {
                let s; switch (noise.noiseType) {
                    case 'white': s = Math.random() * 2 - 1; break;
                    case 'pink': {
                        const b0 = 0.99886 * lastOut + (Math.random() * 2 - 1) * 0.0555179;
                        const b1 = 0.99332 * lastOut + (Math.random() * 2 - 1) * 0.0750759;
                        const b2 = 0.969 * lastOut + (Math.random() * 2 - 1) * 0.153852;
                        lastOut = b0 + b1 + b2 + (Math.random() * 2 - 1) * 0.01;
                        s = lastOut * 0.11;
                        if (s > 1) s = 1; if (s < -1) s = -1;
                        break;
                    }
                    case 'brown': {
                       const br = lastOut + (Math.random() * 2 - 1) * 0.02;
                       lastOut = br;
                       s = br * 3.5;
                       if (s > 1) s = 1; if (s < -1) s = -1;
                       break;
                    }
                    default: s = Math.random() * 2-1;
                } output[i] = s;
              }
              const noiseSource = audioContext.createBufferSource(); (noiseSource as any).noiseType = noise.noiseType;
              noiseSource.buffer = buffer; noiseSource.loop = true;
              noiseSource.connect(noiseNodes.volumeGain).connect(engineMixer);
              noiseSource.start(); noiseNodes.sourceNode = noiseSource;
          }
          noiseNodes.volumeGain.gain.setTargetAtTime(noise.volume, audioContext.currentTime, 0.01);
      } else if (noiseNodes.sourceNode) {
          noiseNodes.sourceNode.stop(); noiseNodes.sourceNode.disconnect(); noiseNodes.sourceNode = undefined;
      }

      const sampleBuffer = sampleBuffers.get(engine.id);
      const samplerTransposeBus = lfoRoutingBussesRef.current?.engineModBusses.get(engine.id)?.samplerTranspose;

      // --- Granular/Standard Sampler Logic ---
      if (sampler.enabled && sampleBuffer) {
        if (sampler.granularModeEnabled) {
            // --- GRANULAR MODE ---
            let nextGrainTime = audioContext.currentTime;

            const calculateLfoValue = (lfo: LFOState, time: number) => {
                const last = lfoPhasesRef.current.get(lfo.id) || { time: playStartTimeRef.current, phase: 0 };
                const timeSinceLast = time - last.time;
                const bpm = bpmRef.current;
                const rate = lfo.sync ? ((bpm / 60) * eval(lfo.syncRate)) : lfo.rate;
                const phaseAdvance = timeSinceLast * rate;
                const newPhase = (last.phase + phaseAdvance) % 1.0;
                lfoPhasesRef.current.set(lfo.id, { time, phase: newPhase });

                const angle = newPhase * 2 * Math.PI;
                switch (lfo.shape) {
                    case 'sine': return Math.sin(angle);
                    case 'square': return Math.sin(angle) >= 0 ? 1 : -1;
                    case 'sawtooth': return 2 * (newPhase - Math.floor(newPhase + 0.5));
                    case 'ramp': return 2 * (1 - newPhase) - 1;
                    case 'triangle': return 2 * Math.abs(2 * (newPhase - Math.floor(newPhase + 0.5))) - 1;
                    default: return 0;
                }
            };
            
            const scheduler = () => {
                const currentEngineState = engineStatesRef.current.find(e => e.id === engine.id);
                if (!currentEngineState || !currentEngineState.sampler.granularModeEnabled || !isTransportPlaying) {
                    samplerNodes.granularSchedulerId = undefined;
                    return; 
                }
                const { grainSize, grainDensity, playbackPosition, positionJitter, transpose } = currentEngineState.sampler;

                while (nextGrainTime < audioContext.currentTime + 0.1) {
                    const modulationTime = nextGrainTime;
                    let sizeMod = 0, densityMod = 0, posMod = 0, jitterMod = 0;

                    // Calculate LFO modulations
                    lfoStatesRef.current.forEach(lfo => {
                        const lfoValue = calculateLfoValue(lfo, modulationTime) * lfo.depth;
                        if (lfo.routing[`${engine.id}GrainSize` as keyof LFORoutingState]) sizeMod += lfoValue;
                        if (lfo.routing[`${engine.id}GrainDensity` as keyof LFORoutingState]) densityMod += lfoValue;
                        if (lfo.routing[`${engine.id}GrainPosition` as keyof LFORoutingState]) posMod += lfoValue;
                        if (lfo.routing[`${engine.id}GrainJitter` as keyof LFORoutingState]) jitterMod += lfoValue;
                    });
                    
                    // Calculate Sequencer modulations
                    const timeSincePlayStart = modulationTime - playStartTimeRef.current;
                    const sixteenthNoteDuration = (60 / bpmRef.current) / 4;
                    const currentSixteenth = Math.floor(timeSincePlayStart / sixteenthNoteDuration);

                    engineStatesRef.current.forEach(modulatingEngine => {
                        const pattern = patternsRef.current.get(modulatingEngine.id);
                        if(pattern && pattern.length > 0) {
                            const stepIndex = currentSixteenth % pattern.length;
                            const isModulatorOn = pattern[stepIndex] === 1;
                            if (isModulatorOn) {
                                if(modulatingEngine.routing[`${engine.id}GrainSize` as keyof LFORoutingState]) sizeMod += 1;
                                if(modulatingEngine.routing[`${engine.id}GrainDensity` as keyof LFORoutingState]) densityMod += 1;
                                if(modulatingEngine.routing[`${engine.id}GrainPosition` as keyof LFORoutingState]) posMod += 1;
                                if(modulatingEngine.routing[`${engine.id}GrainJitter` as keyof LFORoutingState]) jitterMod += 1;
                            }
                        }
                    });

                    // Apply modulations and clamp values
                    const modulatedGrainSize = Math.max(0.01, Math.min(0.5, grainSize + sizeMod * 0.25));
                    const modulatedDensity = Math.max(1, Math.min(100, grainDensity + densityMod * 50));
                    const modulatedPosition = Math.max(0, Math.min(1, playbackPosition + posMod * 0.5));
                    const modulatedJitter = Math.max(0, Math.min(1, positionJitter + jitterMod * 0.5));

                    const grain = audioContext.createBufferSource();
                    const grainEnvelope = audioContext.createGain();
                    
                    grain.buffer = sampleBuffer;
                    grainEnvelope.connect(samplerNodes.volumeGain);

                    const jitter = (Math.random() - 0.5) * modulatedJitter;
                    const startPos = Math.max(0, modulatedPosition + jitter) * sampleBuffer.duration;
                    
                    // CRITICAL FIX: Connect the modulation bus to the grain's detune AudioParam
                    if (samplerTransposeBus) {
                        samplerTransposeBus.connect(grain.detune);
                    }
                    grain.detune.value = transpose * 100; // Set the base detune
                    
                    grainEnvelope.gain.setValueAtTime(0, nextGrainTime);
                    const attackTime = Math.min(0.01, modulatedGrainSize * 0.5); // Add short attack/release to prevent clicks
                    grainEnvelope.gain.linearRampToValueAtTime(1, nextGrainTime + attackTime);
                    grainEnvelope.gain.linearRampToValueAtTime(0, nextGrainTime + modulatedGrainSize);

                    grain.connect(grainEnvelope);
                    grain.start(nextGrainTime, startPos % sampleBuffer.duration);
                    grain.stop(nextGrainTime + modulatedGrainSize);
                    
                    nextGrainTime += 1.0 / modulatedDensity;
                }
                samplerNodes.granularSchedulerId = window.setTimeout(scheduler, 25);
            };
            scheduler();
            samplerNodes.volumeGain.gain.setTargetAtTime(sampler.volume, audioContext.currentTime, 0.01);
        } else {
            // --- STANDARD MODE ---
            const sampleSource = audioContext.createBufferSource();
            sampleSource.buffer = sampleBuffer;
            sampleSource.loop = true;
            if (samplerTransposeBus) samplerTransposeBus.connect(sampleSource.detune);
            sampleSource.connect(samplerNodes.volumeGain).connect(engineMixer);
            sampleSource.start();
            samplerNodes.sourceNode = sampleSource;
            (samplerNodes.sourceNode as AudioBufferSourceNode).detune.setTargetAtTime(sampler.transpose * 100, audioContext.currentTime, 0.01);
            samplerNodes.volumeGain.gain.setTargetAtTime(sampler.volume, audioContext.currentTime, 0.01);
        }
      }

    });
  }, [engineStates, isInitialized, sampleBuffers, isTransportPlaying]);

    useEffect(() => {
        if (!isInitialized || !audioContextRef.current.audioContext) return;
        const { audioContext } = audioContextRef.current;
        const syncRateToHz = (rate: string) => {
            try { return (bpm / 60) * eval(rate); } catch { return 1; }
        };
        lfoStates.forEach(lfoState => {
            const nodes = lfoNodesRef.current.get(lfoState.id);
            if (nodes) {
                const { lfo, depth } = nodes;
                lfo.type = lfoState.shape === 'ramp' ? 'sawtooth' : lfoState.shape;
                depth.gain.setTargetAtTime(lfoState.depth, audioContext.currentTime, 0.01);
                lfo.frequency.setTargetAtTime(lfoState.sync ? syncRateToHz(lfoState.syncRate) : lfoState.rate, audioContext.currentTime, 0.01);
            }
        });
    }, [lfoStates, isInitialized, bpm]);

    const connectModSource = (source: AudioNode | undefined, targetNode: AudioNode | undefined, isConnected: boolean) => {
        if (source && isConnected && targetNode) {
            source.connect(targetNode);
        }
    };

    // LFO Routing
    useEffect(() => {
        if (!isInitialized || !lfoRoutingBussesRef.current) return;
        const busses = lfoRoutingBussesRef.current;
        
        lfoStates.forEach(lfoState => {
            const lfoNodes = lfoNodesRef.current.get(lfoState.id);
            if (!lfoNodes) return;
            try { lfoNodes.depth.disconnect(); } catch (e) {}
        });

        lfoStates.forEach(lfoState => {
            const lfoSource = lfoNodesRef.current.get(lfoState.id)?.depth;
            connectModSource(lfoSource, busses.filter1.cutoffModBus, lfoState.routing.filter1Cutoff);
            connectModSource(lfoSource, busses.filter1.resonanceModBus, lfoState.routing.filter1Resonance);
            connectModSource(lfoSource, busses.filter2.cutoffModBus, lfoState.routing.filter2Cutoff);
            connectModSource(lfoSource, busses.filter2.resonanceModBus, lfoState.routing.filter2Resonance);
            ['engine1', 'engine2', 'engine3'].forEach(engineId => {
                const eBusses = busses.engineModBusses.get(engineId);
                if(eBusses) {
                    connectModSource(lfoSource, eBusses.vol, lfoState.routing[`${engineId}Vol` as keyof LFORoutingState]);
                    connectModSource(lfoSource, eBusses.synthFreq, lfoState.routing[`${engineId}SynthFreq` as keyof LFORoutingState]);
                    connectModSource(lfoSource, eBusses.samplerTranspose, lfoState.routing[`${engineId}SamplerTranspose` as keyof LFORoutingState]);
                }
            });
        });
    }, [lfoStates, isInitialized]);
    
    // Sequencer Routing
    useEffect(() => {
        if (!isInitialized || !lfoRoutingBussesRef.current) return;
        const busses = lfoRoutingBussesRef.current;

        engineStates.forEach(engine => {
             const modSource = engineNodesRef.current.get(engine.id)?.sequencerModGate;
             if (!modSource) return;
             try { modSource.disconnect(); } catch (e) {}
        });
        
        engineStates.forEach(engine => {
            const modSource = engineNodesRef.current.get(engine.id)?.sequencerModGate;
            connectModSource(modSource, busses.filter1.cutoffModBus, engine.routing.filter1Cutoff);
            connectModSource(modSource, busses.filter1.resonanceModBus, engine.routing.filter1Resonance);
            connectModSource(modSource, busses.filter2.cutoffModBus, engine.routing.filter2Cutoff);
            connectModSource(modSource, busses.filter2.resonanceModBus, engine.routing.filter2Resonance);
            ['engine1', 'engine2', 'engine3'].forEach(engineId => {
                const eBusses = busses.engineModBusses.get(engineId);
                if(eBusses) {
                    connectModSource(modSource, eBusses.vol, engine.routing[`${engineId}Vol` as keyof LFORoutingState]);
                    connectModSource(modSource, eBusses.synthFreq, engine.routing[`${engineId}SynthFreq` as keyof LFORoutingState]);
                    connectModSource(modSource, eBusses.samplerTranspose, engine.routing[`${engineId}SamplerTranspose` as keyof LFORoutingState]);
                }
            });
        });

    }, [engineStates, isInitialized]);


    // Filter and Master Effects Chain Routing
    useEffect(() => {
        if (!isInitialized || !filterSplitterRef.current || !filter1NodesRef.current || !filter2NodesRef.current || !filterMergerRef.current || !audioContextRef.current.masterGain || !masterAnalyserRef.current || !splitterRef.current) return;
        const { audioContext, masterGain } = audioContextRef.current;
        const splitter = filterSplitterRef.current;
        const f1 = filter1NodesRef.current.node;
        const f2 = filter2NodesRef.current.node;
        const merger = filterMergerRef.current;
        
        splitter.disconnect();
        f1.disconnect();
        f2.disconnect();
        merger.disconnect();

        if (filterRouting === 'series') {
            splitter.connect(f1).connect(f2).connect(merger);
        } else {
            splitter.connect(f1).connect(merger);
            splitter.connect(f2).connect(merger);
        }
        
        let lastNode: AudioNode = merger;
        masterEffectsChainRef.current.forEach(node => node.disconnect());
        masterEffectsChainRef.current = [];

        masterEffects.forEach(effect => {
            if (!effect.enabled) return;
            let effectNode: AudioNode | null = null;
             switch(effect.type) {
                case 'distortion':
                    const d = audioContext.createWaveShaper(); const c=new Float32Array(44100); const m=effect.params.distortion?.mode??'overdrive'; const a=effect.params.distortion?.amount??0.5;
                    switch(m){case 'overdrive':{const k=a*100;for(let i=0;i<44100;++i){const x=i*2/44100-1;c[i]=(3+k)*x*20*(Math.PI/180)/(Math.PI+k*Math.abs(x));}}break;case 'soft clip':{const k=Math.max(a,0.01)*5;for(let i=0;i<44100;i++){const x=i*2/44100-1;c[i]=Math.tanh(x*k);}}break;case 'hard clip':{const t=1-a;for(let i=0;i<44100;i++){const x=i*2/44100-1;c[i]=Math.max(-t,Math.min(x,t));}}break;case 'foldback':{const t=1-(a*0.99);for(let i=0;i<44100;i++){const x=i*2/44100-1;if(x>t){c[i]=t-(x-t);}else if(x<-t){c[i]=-t-(x+t);}else{c[i]=x;}}}break;}
                    d.curve=c; d.oversample='4x'; effectNode=d; break;
                case 'delay':
                    const dl=audioContext.createDelay(2); const fb=audioContext.createGain(); const mx=audioContext.createGain(); const dr=audioContext.createGain();
                    dl.delayTime.value=effect.params.delay?.time??0.5; fb.gain.value=effect.params.delay?.feedback??0.5; mx.gain.value=effect.params.delay?.mix??0.5; dr.gain.value=1-mx.gain.value;
                    lastNode.connect(dl); lastNode.connect(dr); dl.connect(fb).connect(dl); dl.connect(mx);
                    const wd=audioContext.createGain(); dr.connect(wd); mx.connect(wd); effectNode=wd; masterEffectsChainRef.current.push(dl,fb,mx,dr); break;
                case 'reverb':
                    const rv=audioContext.createConvolver(); const dc=effect.params.reverb?.decay??2; const mv=effect.params.reverb?.mix??0.5; const r=audioContext.sampleRate; const l=r*dc; const imp=audioContext.createBuffer(2,l,r);
                    for(let i=0;i<l;i++){imp.getChannelData(0)[i]=(Math.random()*2-1)*Math.pow(1-i/l,2.5); imp.getChannelData(1)[i]=(Math.random()*2-1)*Math.pow(1-i/l,2.5);} rv.buffer=imp;
                    const rmx=audioContext.createGain(); rmx.gain.value=mv; const rdr=audioContext.createGain(); rdr.gain.value=1-mv; const rm=audioContext.createGain();
                    lastNode.connect(rv); lastNode.connect(rdr); rv.connect(rmx).connect(rm); rdr.connect(rm); effectNode=rm; masterEffectsChainRef.current.push(rv,rmx,rdr); break;
            }
            if (effectNode) { lastNode.connect(effectNode); lastNode = effectNode; masterEffectsChainRef.current.push(effectNode); }
        });
        
        lastNode.connect(masterAnalyserRef.current);
        lastNode.connect(splitterRef.current);
        splitterRef.current.connect(leftAnalyserRef.current!, 0);
        splitterRef.current.connect(rightAnalyserRef.current!, 1);
        lastNode.connect(masterGain);
    }, [masterEffects, filterRouting, isInitialized]);

  return { isInitialized, initializeAudio, currentStep, loadSample, engineNodesRef, masterAnalyserRef, leftAnalyserRef, rightAnalyserRef };
};

// --- Morphing Types ---
interface MorphSnapshot {
    engines: EngineState[];
    lfos: LFOState[];
    filter1: FilterState;
    filter2: FilterState;
    effects: MasterEffect[];
    masterVolume: number;
    bpm: number;
    filterRouting: FilterRouting;
    harmonicTuningSystem: TuningSystem;
}
interface MorphState {
    isActive: boolean;
    duration: number; // in steps
    startStep: number;
    start: MorphSnapshot | null;
    target: MorphSnapshot | null;
}

const createInitialRoutingState = (): LFORoutingState => ({
    filter1Cutoff: false, filter1Resonance: false, filter2Cutoff: false, filter2Resonance: false,
    engine1Vol: false, engine1SynthFreq: false, engine1SamplerTranspose: false,
    engine1GrainSize: false, engine1GrainDensity: false, engine1GrainPosition: false, engine1GrainJitter: false,
    engine2Vol: false, engine2SynthFreq: false, engine2SamplerTranspose: false,
    engine2GrainSize: false, engine2GrainDensity: false, engine2GrainPosition: false, engine2GrainJitter: false,
    engine3Vol: false, engine3SynthFreq: false, engine3SamplerTranspose: false,
    engine3GrainSize: false, engine3GrainDensity: false, engine3GrainPosition: false, engine3GrainJitter: false,
});


const createInitialEngineState = (id: string, name: string): EngineState => ({
    id, name, sequencerEnabled: false, sequencerSteps: 16, sequencerPulses: 4, sequencerRotate: 0,
    midiControlled: false,
    effects: { distortion: 0, delayTime: 0, delayFeedback: 0 },
    synth: { enabled: false, volume: 0.7, frequency: 440, oscillatorType: 'sine', solfeggioFrequency: '' },
    noise: { enabled: false, volume: 0.5, noiseType: 'white' },
    sampler: { enabled: false, volume: 1, sampleName: null, transpose: 0, granularModeEnabled: false, grainSize: 0.1, grainDensity: 20, playbackPosition: 0, positionJitter: 0 },
    routing: createInitialRoutingState(),
});

const App = () => {
  const [isReady, setIsReady] = useState(false);
  const [masterVolume, setMasterVolume] = useState(0.7);
  const [bpm, setBpm] = useState(120);
  const [filter1, setFilter1] = useState<FilterState>({ cutoff: 12000, resonance: 1, type: 'lowpass' });
  const [filter2, setFilter2] = useState<FilterState>({ cutoff: 500, resonance: 1, type: 'highpass' });
  const [filterRouting, setFilterRouting] = useState<FilterRouting>('series');
  const [harmonicTuningSystem, setHarmonicTuningSystem] = useState<TuningSystem>('440_ET');
  const [bottomTab, setBottomTab] = useState<'lfos' | 'matrix'>('lfos');
  const [midiInputs, setMidiInputs] = useState<MIDIInput[]>([]);
  const [selectedMidiInputId, setSelectedMidiInputId] = useState<string | null>(null);
  const [midiActivity, setMidiActivity] = useState(false);
  
  // Voicing and Glide State
  const [voicingMode, setVoicingMode] = useState<VoicingMode>('poly');
  const [glideTime, setGlideTime] = useState(0.05); // in seconds
  const [isGlideSynced, setIsGlideSynced] = useState(false);
  const glideSyncRates = useMemo(() => ['1/64', '1/32', '1/16', '1/8', '1/4', '1/2'], []);
  const [glideSyncRateIndex, setGlideSyncRateIndex] = useState(2); // '1/16'

  // Preset State
  const [presets, setPresets] = useState<Record<string, MorphSnapshot>>({});
  const [selectedPreset, setSelectedPreset] = useState('');
  
  // Audio Output State
  const [audioOutputs, setAudioOutputs] = useState<{id: string, label: string}[]>([]);
  const [selectedAudioOutputId, setSelectedAudioOutputId] = useState('default');


  const actualGlideTime = useMemo(() => {
    if (isGlideSynced) {
        try { return (60 / bpm) * eval(glideSyncRates[glideSyncRateIndex]); } catch { return 0.05; }
    }
    return glideTime;
  }, [isGlideSynced, bpm, glideSyncRates, glideSyncRateIndex, glideTime]);

  const createInitialLFOState = (id: string, name: string): LFOState => ({
    id, name, rate: 5, depth: 0.5, shape: 'sine', sync: false, syncRate: '1/4',
    routing: createInitialRoutingState(),
  });

  const [lfoStates, setLfoStates] = useState<LFOState[]>([
    createInitialLFOState('lfo1', 'LFO 1'),
    createInitialLFOState('lfo2', 'LFO 2'),
    createInitialLFOState('lfo3', 'LFO 3'),
  ]);

  const [engineStates, setEngineStates] = useState<EngineState[]>([
    { ...createInitialEngineState('engine1', 'Engine 1'), sequencerEnabled: true, midiControlled: true, synth: {...createInitialEngineState('','').synth, enabled: true} },
    { ...createInitialEngineState('engine2', 'Engine 2'), sequencerEnabled: true, noise: {...createInitialEngineState('','').noise, enabled: true, volume: 0.1} },
    { ...createInitialEngineState('engine3', 'Engine 3'), sequencerEnabled: true, sampler: {...createInitialEngineState('','').sampler, enabled: true} }
  ]);
  const [isTransportPlaying, setIsTransportPlaying] = useState(false);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [masterEffects, setMasterEffects] = useState<MasterEffect[]>([]);

  const [isMorphEnabled, setIsMorphEnabled] = useState(false);
  const [morphDuration, setMorphDuration] = useState(16);
  const [morph, setMorph] = useState<MorphState>({ isActive: false, duration: 16, startStep: 0, start: null, target: null, });
  const lastMorphStepRef = useRef(-1);

  const { isInitialized, initializeAudio, currentStep, loadSample, engineNodesRef, masterAnalyserRef, leftAnalyserRef, rightAnalyserRef } = useAudio(
    engineStates, setEngineStates, masterVolume, filter1, filter2, filterRouting, lfoStates, masterEffects, bpm, isTransportPlaying, harmonicTuningSystem, selectedMidiInputId, setMidiActivity,
    voicingMode, actualGlideTime, selectedAudioOutputId
  );
  
  useEffect(() => {
    if (!navigator.requestMIDIAccess) return;
    navigator.requestMIDIAccess({ sysex: false }).then((access) => {
        const inputs = Array.from(access.inputs.values());
        setMidiInputs(inputs);
        if (inputs.length > 0) {
            setSelectedMidiInputId(inputs[0].id);
        }
        access.onstatechange = (event) => {
            const updatedInputs = Array.from(access.inputs.values());
            setMidiInputs(updatedInputs);
        };
    }).catch(err => console.error("Could not access MIDI devices.", err));
  }, []);
  
    // Audio Output Device Detection
  useEffect(() => {
    const getDevices = async () => {
        if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
            try {
                const devices = await navigator.mediaDevices.enumerateDevices();
                const audioOutputs = devices
                    .filter(device => device.kind === 'audiooutput')
                    .map(device => ({ id: device.deviceId, label: device.label || `Output ${device.deviceId.substring(0, 8)}` }));
                setAudioOutputs(audioOutputs);
            } catch (err) {
                console.error("Error enumerating audio devices:", err);
            }
        }
    };
    getDevices();
    navigator.mediaDevices?.addEventListener('devicechange', getDevices);
    return () => navigator.mediaDevices?.removeEventListener('devicechange', getDevices);
  }, []);
  
    // Preset Handling
  useEffect(() => {
    try {
        const savedPresets = localStorage.getItem('polyRhythmSynthPresets');
        if (savedPresets) {
            setPresets(JSON.parse(savedPresets));
        }
    } catch (e) {
        console.error("Could not load presets from localStorage", e);
    }
  }, []);

  const handleSavePreset = () => {
    const name = prompt("Enter preset name:", selectedPreset || "");
    if (name) {
        const snapshot: MorphSnapshot = {
            engines: engineStates, lfos: lfoStates, filter1, filter2,
            effects: masterEffects, masterVolume, bpm, filterRouting, harmonicTuningSystem,
        };
        const newPresets = { ...presets, [name]: snapshot };
        setPresets(newPresets);
        setSelectedPreset(name);
        try {
            localStorage.setItem('polyRhythmSynthPresets', JSON.stringify(newPresets));
        } catch (e) {
            console.error("Could not save presets to localStorage", e);
            alert("Error saving preset. Storage might be full.");
        }
    }
  };
  
  const handleLoadPreset = (name: string) => {
    if (name && presets[name]) {
        const preset = presets[name];
        setEngineStates(preset.engines);
        setLfoStates(preset.lfos);
        setFilter1(preset.filter1);
        setFilter2(preset.filter2);
        setMasterEffects(preset.effects);
        setMasterVolume(preset.masterVolume);
        setBpm(preset.bpm);
        setFilterRouting(preset.filterRouting);
        setHarmonicTuningSystem(preset.harmonicTuningSystem);
        setSelectedPreset(name);
    } else {
        setSelectedPreset('');
    }
  };

  const handleDeletePreset = (name: string) => {
    if (name && presets[name]) {
        if (confirm(`Are you sure you want to delete the preset "${name}"?`)) {
            const newPresets = { ...presets };
            delete newPresets[name];
            setPresets(newPresets);
            if (selectedPreset === name) {
                setSelectedPreset('');
            }
             try {
                localStorage.setItem('polyRhythmSynthPresets', JSON.stringify(newPresets));
            } catch (e) {
                console.error("Could not save presets to localStorage", e);
            }
        }
    }
  };


  const cancelMorph = useCallback(() => {
    setMorph(prev => ({ ...prev, isActive: false, start: null, target: null }));
    lastMorphStepRef.current = -1;
  }, []);

  const handleStateChange = <T extends (...args: any[]) => void>(setter: T) => (...args: Parameters<T>): void => {
      cancelMorph();
      setSelectedPreset('');
      setter(...args);
  }

  const handleEngineUpdate = handleStateChange( (engineId: string, updates: Partial<EngineState>) => {
    setEngineStates(prev => prev.map(e => e.id === engineId ? { ...e, ...updates, routing: updates.routing ? { ...e.routing, ...updates.routing} : e.routing } : e));
  });
  
  const handleEngineLayerUpdate = handleStateChange(<K extends 'synth' | 'noise' | 'sampler' | 'effects'>(
    engineId: string,
    layer: K,
    updates: Partial<EngineState[K]>
  ) => {
    setEngineStates(prev => prev.map(e => e.id === engineId ? { ...e, [layer]: { ...e[layer], ...updates } } : e));
  });

  const handleLfoUpdate = handleStateChange((lfoId: string, updates: Partial<LFOState>) => {
    setLfoStates(prevLfos =>
      prevLfos.map(lfo => {
        if (lfo.id !== lfoId) return lfo;
        const newLfo = { ...lfo, ...updates };
        if (updates.routing) newLfo.routing = { ...lfo.routing, ...updates.routing };
        return newLfo;
      })
    );
  });
  
  const wrappedSetMasterVolume = handleStateChange(setMasterVolume);
  const handleFilter1Update = handleStateChange((u: Partial<FilterState>) => setFilter1(p => ({...p, ...u})));
  const handleFilter2Update = handleStateChange((u: Partial<FilterState>) => setFilter2(p => ({...p, ...u})));
  const wrappedSetMasterEffects = handleStateChange(setMasterEffects);
  const wrappedSetBpm = handleStateChange(setBpm);
  const wrappedSetFilterRouting = handleStateChange(setFilterRouting);
  const wrappedSetHarmonicTuningSystem = handleStateChange(setHarmonicTuningSystem);

  const handleRandomize = useCallback((mode: RandomizeMode, scope: 'global' | string) => {
    cancelMorph();
    const getHarmonicFreq = () => {
        const getRoot = (a4: number) => a4 * Math.pow(2, -9 / 12); // Get C4 from A4
        let root = getRoot(440);
        let ratios: number[] | null = null;

        switch (harmonicTuningSystem) {
            case '432_ET': root = getRoot(432); ratios = musicalScales.major.map(s => Math.pow(2, s / 12)); break;
            case '440_ET': root = getRoot(440); ratios = musicalScales.major.map(s => Math.pow(2, s / 12)); break;
            case 'just_intonation_440': root = getRoot(440); ratios = justIntonationRatios; break;
            case 'just_intonation_432': root = getRoot(432); ratios = justIntonationRatios; break;
            case 'pythagorean_440': root = getRoot(440); ratios = pythagoreanRatios; break;
            case 'pythagorean_432': root = getRoot(432); ratios = pythagoreanRatios; break;
            case 'solfeggio': return getRandomElement(solfeggioFrequencies);
            case 'wholesome_scale': return getRandomElement(wholesomeScaleFrequencies) * getRandomElement([0.5, 1, 2]);
        }
        return getNoteFromScale(root, ratios, 3);
    };

    const randomizeEngine = (engine: EngineState): EngineState => {
        const newEngine = JSON.parse(JSON.stringify(engine));
        if (mode === 'chaos') {
            newEngine.synth.volume = getRandom(0, 1);
            newEngine.synth.frequency = getRandom(40, 1000);
            newEngine.synth.oscillatorType = getRandomElement(oscillatorTypes);
            newEngine.noise.volume = getRandom(0, 0.5);
            newEngine.noise.noiseType = getRandomElement(noiseTypes);
            newEngine.sampler.volume = getRandom(0, 1);
            newEngine.sampler.transpose = getRandomInt(-12, 12);
            newEngine.sampler.granularModeEnabled = getRandomBool(0.5);
            newEngine.sampler.grainSize = getRandom(0.01, 0.5);
            newEngine.sampler.grainDensity = getRandomInt(1, 100);
            newEngine.sampler.playbackPosition = getRandom(0,1);
            newEngine.sampler.positionJitter = getRandom(0,1);
            newEngine.sequencerSteps = getRandomInt(4, 32);
            newEngine.sequencerPulses = getRandomInt(1, newEngine.sequencerSteps);
            newEngine.sequencerRotate = getRandomInt(0, newEngine.sequencerSteps - 1);
        } else if (mode === 'harmonic') {
            newEngine.synth.frequency = getHarmonicFreq();
            newEngine.synth.volume = getRandom(0.5, 1);
            newEngine.sampler.transpose = getRandomElement([0, 3, 5, 7, 12, -12, -7, -5]);
            newEngine.synth.oscillatorType = getRandomElement(['sine', 'triangle']);
            newEngine.noise.volume = getRandom(0, 0.1); // Less noise in harmonic mode
        } else if (mode === 'rhythmic') {
            newEngine.sequencerSteps = getRandomElement([8, 12, 16, 24, 32]);
            newEngine.sequencerPulses = getRandomInt(1, Math.floor(newEngine.sequencerSteps / 2));
            newEngine.sequencerRotate = getRandomInt(0, newEngine.sequencerSteps - 1);
        }
        return newEngine;
    };

    const randomizeLFO = (lfo: LFOState): LFOState => {
        const newLFO = JSON.parse(JSON.stringify(lfo));
        if (mode === 'chaos') {
            newLFO.rate = getRandom(0.1, 30);
            newLFO.depth = getRandom(0, 1);
            newLFO.shape = getRandomElement(lfoShapes);
            newLFO.sync = getRandomBool();
            newLFO.syncRate = getRandomElement(lfoSyncRates);
        } else if (mode === 'harmonic') {
            newLFO.rate = getRandom(0.2, 4); // Slower rates for harmonic
            newLFO.depth = getRandom(0.1, 0.6);
            newLFO.shape = 'sine';
        } else if (mode === 'rhythmic') {
            newLFO.sync = true;
            newLFO.syncRate = getRandomElement(lfoSyncRates);
            newLFO.shape = getRandomElement(['square', 'ramp']);
            newLFO.depth = getRandom(0.5, 1);
        }
        return newLFO;
    };
    
    const randomizeFilter = (filter: FilterState): FilterState => {
        const newFilter = { ...filter };
        if (mode === 'chaos') {
            newFilter.type = getRandomElement(filterTypes);
            newFilter.cutoff = getRandom(100, 18000);
            newFilter.resonance = getRandom(0, 20);
        } else if (mode === 'harmonic') {
            newFilter.cutoff = getRandom(800, 10000);
            newFilter.resonance = getRandom(0.5, 5);
        } else if (mode === 'rhythmic') {
             newFilter.cutoff = getRandom(200, 5000);
             newFilter.resonance = getRandom(5, 25);
        }
        return newFilter;
    };
    
    const randomizeMasterEffect = (effect: MasterEffect): MasterEffect => {
      const newEffect = JSON.parse(JSON.stringify(effect));
       if (mode === 'chaos') {
          switch(newEffect.type) {
              case 'distortion': newEffect.params.distortion = { mode: getRandomElement(distortionModes), amount: getRandom(0, 1)}; break;
              case 'delay': newEffect.params.delay = { time: getRandom(0.01, 1), feedback: getRandom(0, 0.95), mix: getRandom(0, 1)}; break;
              case 'reverb': newEffect.params.reverb = { decay: getRandom(0.1, 10), mix: getRandom(0, 1)}; break;
          }
       } else if (mode === 'harmonic') {
           switch(newEffect.type) {
              case 'distortion': newEffect.params.distortion = { mode: 'soft clip', amount: getRandom(0, 0.3)}; break;
              case 'delay': newEffect.params.delay = { time: getRandom(0.2, 0.8), feedback: getRandom(0.2, 0.6), mix: getRandom(0.1, 0.5)}; break;
              case 'reverb': newEffect.params.reverb = { decay: getRandom(2, 8), mix: getRandom(0.2, 0.6)}; break;
           }
       } else if (mode === 'rhythmic') {
           switch(newEffect.type) {
              case 'distortion': newEffect.params.distortion = { mode: 'overdrive', amount: getRandom(0.3, 0.8)}; break;
              case 'delay': newEffect.params.delay = { time: (60/bpm) * getRandomElement([0.25, 0.5, 0.75]), feedback: getRandom(0.4, 0.8), mix: getRandom(0.3, 0.7)}; break;
              case 'reverb': newEffect.params.reverb = { decay: getRandom(0.5, 2.5), mix: getRandom(0.1, 0.4)}; break;
           }
       }
      return newEffect;
    };


    const snapshot: MorphSnapshot = {
        engines: engineStates.map(e => (scope === 'global' || scope === e.id) ? randomizeEngine(e) : e),
        lfos: lfoStates.map(l => (scope === 'global' || scope === l.id) ? randomizeLFO(l) : l),
        filter1: (scope === 'global' || scope === 'filter1') ? randomizeFilter(filter1) : filter1,
        filter2: (scope === 'global' || scope === 'filter2') ? randomizeFilter(filter2) : filter2,
        effects: masterEffects.map(ef => (scope === 'global' || scope === ef.id) ? randomizeMasterEffect(ef) : ef),
        masterVolume: masterVolume,
        bpm: (scope === 'global' && (mode === 'chaos' || mode === 'rhythmic')) ? getRandom(80, 180) : bpm,
        filterRouting: (scope === 'global' && mode === 'chaos') ? getRandomElement(['series', 'parallel']) : filterRouting,
        harmonicTuningSystem: (scope === 'global' && mode === 'harmonic') ? getRandomElement(['440_ET', '432_ET', 'just_intonation_440', 'solfeggio']) : harmonicTuningSystem,
    };
    
    if (isMorphEnabled && isTransportPlaying) {
        setMorph({
            isActive: true,
            duration: morphDuration,
            startStep: currentStep,
            start: { engines: engineStates, lfos: lfoStates, filter1, filter2, effects: masterEffects, masterVolume, bpm, filterRouting, harmonicTuningSystem },
            target: snapshot,
        });
    } else {
      setEngineStates(snapshot.engines);
      setLfoStates(snapshot.lfos);
      setFilter1(snapshot.filter1);
      setFilter2(snapshot.filter2);
      setMasterEffects(snapshot.effects);
      setBpm(snapshot.bpm);
      setFilterRouting(snapshot.filterRouting);
      setHarmonicTuningSystem(snapshot.harmonicTuningSystem);
    }
    setSelectedPreset('');
  }, [cancelMorph, harmonicTuningSystem, engineStates, lfoStates, filter1, filter2, masterEffects, masterVolume, bpm, filterRouting, isMorphEnabled, isTransportPlaying, morphDuration, currentStep]);

    const handleIntelligentRandomize = useCallback(async (scope: string) => {
    setIsAiLoading(true);
    try {
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY as string });
        
        const currentSnapshot: MorphSnapshot = {
            engines: engineStates, lfos: lfoStates, filter1, filter2,
            effects: masterEffects, masterVolume, bpm, filterRouting, harmonicTuningSystem,
        };
        const prompt = `You are a world-class sound designer creating a patch for a sophisticated polyrhythmic software synthesizer.
        The user wants you to intelligently randomize parts of the current patch.
        Current patch state: ${JSON.stringify(currentSnapshot, null, 2)}
        User's request: Randomize the "${scope}" section.
        Your task is to generate a new, musically interesting, and coherent patch by modifying ONLY the requested scope.
        - If scope is 'global', create a completely new sound.
        - If scope is an engine, LFO, or filter, only modify that component's parameters.
        - Be creative. Think about how parameters interact. For example, a fast LFO on a filter cutoff can create a wobble bass. A slow LFO on sample position can create evolving textures.
        - Ensure the output is valid JSON conforming to the provided schema. Do not include any commentary, just the JSON object.
        - Don't just pick random values; make thoughtful choices that result in a good sound. Create something beautiful, atmospheric, or powerfully rhythmic.
        - If randomizing a rhythmic component, consider syncing LFOs or delays to the BPM.
        `;
        
        const schema = {
            type: Type.OBJECT,
            properties: {
                engines: {
                    type: Type.ARRAY,
                    items: {
                        type: Type.OBJECT,
                        properties: {
                             id: { type: Type.STRING },
                             name: { type: Type.STRING },
                             sequencerEnabled: { type: Type.BOOLEAN },
                             sequencerSteps: { type: Type.INTEGER },
                             sequencerPulses: { type: Type.INTEGER },
                             sequencerRotate: { type: Type.INTEGER },
                             midiControlled: { type: Type.BOOLEAN },
                             synth: {
                                type: Type.OBJECT,
                                properties: {
                                    enabled: { type: Type.BOOLEAN },
                                    volume: { type: Type.NUMBER },
                                    frequency: { type: Type.NUMBER },
                                    oscillatorType: { type: Type.STRING, enum: [...oscillatorTypes]},
                                    solfeggioFrequency: {type: Type.STRING}
                                }
                             },
                             noise: {
                                type: Type.OBJECT,
                                properties: {
                                    enabled: { type: Type.BOOLEAN },
                                    volume: { type: Type.NUMBER },
                                    noiseType: { type: Type.STRING, enum: [...noiseTypes]}
                                }
                             },
                             sampler: {
                                type: Type.OBJECT,
                                properties: {
                                    enabled: { type: Type.BOOLEAN },
                                    volume: { type: Type.NUMBER },
                                    transpose: { type: Type.INTEGER },
                                    granularModeEnabled: { type: Type.BOOLEAN },
                                    grainSize: { type: Type.NUMBER },
                                    grainDensity: { type: Type.NUMBER },
                                    playbackPosition: { type: Type.NUMBER },
                                    positionJitter: { type: Type.NUMBER },
                                }
                             }
                        }
                    }
                },
                lfos: {
                     type: Type.ARRAY,
                     items: {
                        type: Type.OBJECT,
                        properties: {
                             id: { type: Type.STRING },
                             name: { type: Type.STRING },
                             rate: { type: Type.NUMBER },
                             depth: { type: Type.NUMBER },
                             shape: { type: Type.STRING, enum: [...lfoShapes]},
                             sync: { type: Type.BOOLEAN },
                             syncRate: { type: Type.STRING, enum: lfoSyncRates }
                        }
                     }
                },
                filter1: {
                    type: Type.OBJECT,
                    properties: {
                        cutoff: { type: Type.NUMBER },
                        resonance: { type: Type.NUMBER },
                        type: { type: Type.STRING, enum: [...filterTypes]}
                    }
                },
                filter2: {
                     type: Type.OBJECT,
                    properties: {
                        cutoff: { type: Type.NUMBER },
                        resonance: { type: Type.NUMBER },
                        type: { type: Type.STRING, enum: [...filterTypes]}
                    }
                },
                effects: {
                    type: Type.ARRAY,
                    items: {
                        type: Type.OBJECT,
                        properties: {
                            id: { type: Type.STRING },
                            type: { type: Type.STRING, enum: availableMasterEffects },
                            enabled: { type: Type.BOOLEAN },
                            params: {
                                type: Type.OBJECT,
                                properties: {
                                    distortion: {
                                        type: Type.OBJECT,
                                        properties: {
                                            mode: { type: Type.STRING, enum: [...distortionModes] },
                                            amount: { type: Type.NUMBER }
                                        }
                                    },
                                    delay: {
                                        type: Type.OBJECT,
                                        properties: {
                                            time: { type: Type.NUMBER },
                                            feedback: { type: Type.NUMBER },
                                            mix: { type: Type.NUMBER }
                                        }
                                    },
                                    reverb: {
                                         type: Type.OBJECT,
                                        properties: {
                                            decay: { type: Type.NUMBER },
                                            mix: { type: Type.NUMBER }
                                        }
                                    }
                                }
                            }
                        }
                    }
                },
                bpm: { type: Type.NUMBER },
                filterRouting: { type: Type.STRING, enum: ['series', 'parallel']},
                harmonicTuningSystem: { type: Type.STRING, enum: ['440_ET', '432_ET', 'just_intonation_440', 'just_intonation_432', 'pythagorean_440', 'pythagorean_432', 'solfeggio', 'wholesome_scale']}
            }
        };

        const response: GenerateContentResponse = await ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: [{ parts: [{ text: prompt }] }],
          config: {
            responseMimeType: "application/json",
            responseSchema: schema,
          },
        });
        
        const jsonText = response.text.trim();
        const newSnapshot = JSON.parse(jsonText);

        if (isMorphEnabled && isTransportPlaying) {
             setMorph({
                isActive: true,
                duration: morphDuration,
                startStep: currentStep,
                start: currentSnapshot,
                target: newSnapshot,
            });
        } else {
             setEngineStates(newSnapshot.engines.map((e: EngineState, i: number) => ({...e, sampler: {...e.sampler, sampleName: engineStates[i].sampler.sampleName }})));
             setLfoStates(newSnapshot.lfos);
             setFilter1(newSnapshot.filter1);
             setFilter2(newSnapshot.filter2);
             setMasterEffects(newSnapshot.effects);
             setBpm(newSnapshot.bpm);
             setFilterRouting(newSnapshot.filterRouting);
             setHarmonicTuningSystem(newSnapshot.harmonicTuningSystem);
        }
        setSelectedPreset('');
        
    } catch (error) {
        console.error("AI Generation Error:", error);
        alert("An error occurred during AI patch generation. Please check the console for details.");
    } finally {
        setIsAiLoading(false);
    }
}, [engineStates, lfoStates, filter1, filter2, masterEffects, masterVolume, bpm, filterRouting, harmonicTuningSystem, isMorphEnabled, isTransportPlaying, morphDuration, currentStep]);


  useEffect(() => {
    if (!isTransportPlaying || !morph.isActive || !morph.start || !morph.target) {
        lastMorphStepRef.current = -1;
        return;
    }
    
    if (lastMorphStepRef.current === currentStep) return;
    lastMorphStepRef.current = currentStep;

    const progress = Math.min(1, ((currentStep - morph.startStep + morph.duration) % morph.duration) / morph.duration);
    
    const lerp = (a: number, b: number, t: number) => a * (1 - t) + b * t;

    // Morph engines
    setEngineStates(prev => prev.map((engine, i) => {
        const start = morph.start!.engines[i];
        const target = morph.target!.engines[i];
        return {
            ...engine,
            synth: {
                ...engine.synth,
                volume: lerp(start.synth.volume, target.synth.volume, progress),
                frequency: lerp(start.synth.frequency, target.synth.frequency, progress),
            },
            noise: {
                ...engine.noise,
                volume: lerp(start.noise.volume, target.noise.volume, progress),
            },
            sampler: {
                 ...engine.sampler,
                volume: lerp(start.sampler.volume, target.sampler.volume, progress),
                transpose: lerp(start.sampler.transpose, target.sampler.transpose, progress),
                grainSize: lerp(start.sampler.grainSize, target.sampler.grainSize, progress),
                grainDensity: lerp(start.sampler.grainDensity, target.sampler.grainDensity, progress),
                playbackPosition: lerp(start.sampler.playbackPosition, target.sampler.playbackPosition, progress),
                positionJitter: lerp(start.sampler.positionJitter, target.sampler.positionJitter, progress),
            }
        };
    }));

    // Morph LFOs
    setLfoStates(prev => prev.map((lfo, i) => ({
        ...lfo,
        rate: lerp(morph.start!.lfos[i].rate, morph.target!.lfos[i].rate, progress),
        depth: lerp(morph.start!.lfos[i].depth, morph.target!.lfos[i].depth, progress),
    })));

    // Morph filters
    setFilter1(prev => ({
        ...prev,
        cutoff: lerp(morph.start!.filter1.cutoff, morph.target!.filter1.cutoff, progress),
        resonance: lerp(morph.start!.filter1.resonance, morph.target!.filter1.resonance, progress),
    }));
    setFilter2(prev => ({
        ...prev,
        cutoff: lerp(morph.start!.filter2.cutoff, morph.target!.filter2.cutoff, progress),
        resonance: lerp(morph.start!.filter2.resonance, morph.target!.filter2.resonance, progress),
    }));
    
    // Morph Effects
    setMasterEffects(prev => prev.map((effect, i) => {
        const start = morph.start!.effects[i];
        const target = morph.target!.effects[i];
        if (!start || !target || start.type !== target.type) return effect;
        const newEffect = JSON.parse(JSON.stringify(effect));
        switch(effect.type) {
            case 'distortion': newEffect.params.distortion.amount = lerp(start.params.distortion!.amount, target.params.distortion!.amount, progress); break;
            case 'delay': 
              newEffect.params.delay.time = lerp(start.params.delay!.time, target.params.delay!.time, progress);
              newEffect.params.delay.feedback = lerp(start.params.delay!.feedback, target.params.delay!.feedback, progress);
              newEffect.params.delay.mix = lerp(start.params.delay!.mix, target.params.delay!.mix, progress);
              break;
            case 'reverb':
              newEffect.params.reverb.decay = lerp(start.params.reverb!.decay, target.params.reverb!.decay, progress);
              newEffect.params.reverb.mix = lerp(start.params.reverb!.mix, target.params.reverb!.mix, progress);
              break;
        }
        return newEffect;
    }));

    if (progress >= 1) {
        cancelMorph();
    }
  }, [currentStep, isTransportPlaying, morph, cancelMorph]);
  
  const toggleTransport = () => {
    setIsTransportPlaying(prev => !prev);
    if (morph.isActive) {
        cancelMorph();
    }
  }

  if (!isReady) {
    return (
      <div className="init-overlay">
        <button onClick={() => { initializeAudio(); setIsReady(true); }}>
          Start Synthesizer
        </button>
      </div>
    );
  }

  return (
    <div className="app-container">
      {isAiLoading && <div className="ai-loading-overlay">Asking the ghost in the machine...</div>}
      <TopBar
        masterVolume={masterVolume}
        setMasterVolume={wrappedSetMasterVolume}
        bpm={bpm}
        setBPM={wrappedSetBpm}
        isTransportPlaying={isTransportPlaying}
        onToggleTransport={toggleTransport}
        midiInputs={midiInputs}
        selectedMidiInputId={selectedMidiInputId}
        onMidiInputChange={setSelectedMidiInputId}
        midiActivity={midiActivity}
        voicingMode={voicingMode}
        setVoicingMode={setVoicingMode}
        glideTime={glideTime}
        setGlideTime={setGlideTime}
        isGlideSynced={isGlideSynced}
        setIsGlideSynced={setIsGlideSynced}
        glideSyncRateIndex={glideSyncRateIndex}
        setGlideSyncRateIndex={setGlideSyncRateIndex}
        glideSyncRates={glideSyncRates}
        presets={presets}
        selectedPreset={selectedPreset}
        onLoadPreset={handleLoadPreset}
        onSavePreset={handleSavePreset}
        onDeletePreset={handleDeletePreset}
        audioOutputs={audioOutputs}
        selectedAudioOutputId={selectedAudioOutputId}
        onAudioOutputChange={setSelectedAudioOutputId}
      />

       <div className="main-grid">
         <div className="full-width-container master-visualizer-container">
            <div className="visualizer-wrapper">
              <span className="visualizer-label">L</span>
              {leftAnalyserRef.current && <Visualizer analyserNode={leftAnalyserRef.current} type="waveform" />}
            </div>
            <div className="visualizer-wrapper">
              <span className="visualizer-label">R</span>
              {rightAnalyserRef.current && <Visualizer analyserNode={rightAnalyserRef.current} type="waveform" />}
            </div>
         </div>
        
         <div className="channels-container">
            {engineStates.map((engine) => (
              <EngineControls
                key={engine.id}
                engine={engine}
                onUpdate={handleEngineUpdate}
                onLayerUpdate={handleEngineLayerUpdate}
                onLoadSample={loadSample}
                onRandomize={handleRandomize}
                onIntelligentRandomize={handleIntelligentRandomize}
                analyserNode={engineNodesRef.current.get(engine.id)?.analyser}
                currentStep={currentStep}
                isTransportPlaying={isTransportPlaying}
              />
            ))}
        </div>
        
        <div className="processing-container">
          <div className="filters-container">
             <div className="filters-container-header">
                <h2>Filters</h2>
                <FilterRoutingSwitch filterRouting={filterRouting} setFilterRouting={wrappedSetFilterRouting} />
             </div>
             <div className="filters-grid">
                 <MasterFilterControls title="Filter 1" filterState={filter1} onUpdate={handleFilter1Update} onRandomize={handleRandomize} onIntelligentRandomize={handleIntelligentRandomize} />
                 <MasterFilterControls title="Filter 2" filterState={filter2} onUpdate={handleFilter2Update} onRandomize={handleRandomize} onIntelligentRandomize={handleIntelligentRandomize}/>
             </div>
          </div>
          <MasterEffects effects={masterEffects} setEffects={wrappedSetMasterEffects} onRandomize={handleRandomize} onIntelligentRandomize={handleIntelligentRandomize}/>
        </div>
        
        <div className="bottom-module-container">
          <div className="bottom-module-header">
              <div className="bottom-tab-nav">
                  <button className={`bottom-tab-button ${bottomTab === 'lfos' ? 'active' : ''}`} onClick={() => setBottomTab('lfos')}>LFOs & Generative</button>
                  <button className={`bottom-tab-button ${bottomTab === 'matrix' ? 'active' : ''}`} onClick={() => setBottomTab('matrix')}>Routing Matrix</button>
              </div>
          </div>
           {bottomTab === 'lfos' && (
             <div className="lfo-grid-container">
               {lfoStates.map(lfo => <LFOControls key={lfo.id} lfoState={lfo} onUpdate={(u) => handleLfoUpdate(lfo.id, u)} onRandomize={handleRandomize} onIntelligentRandomize={handleIntelligentRandomize} />)}
               <GenerativeTools
                  onRandomize={handleRandomize}
                  onIntelligentRandomize={handleIntelligentRandomize}
                  isMorphEnabled={isMorphEnabled}
                  setIsMorphEnabled={setIsMorphEnabled}
                  morphDuration={morphDuration}
                  setMorphDuration={setMorphDuration}
                  harmonicTuningSystem={harmonicTuningSystem}
                  setHarmonicTuningSystem={wrappedSetHarmonicTuningSystem}
               />
             </div>
           )}
           {bottomTab === 'matrix' && (
              <RoutingMatrix
                lfoStates={lfoStates}
                onLfoUpdate={handleLfoUpdate}
                engineStates={engineStates}
                onEngineUpdate={handleEngineUpdate}
              />
           )}
        </div>
       </div>
    </div>
  );
};

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<App />);
}
