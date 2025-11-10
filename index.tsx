
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
interface EngineState {
  id: string;
  name: string;
  synth: SynthLayerState;
  noise: NoiseLayerState;
  sampler: SamplerLayerState;
  sequencerEnabled: boolean;
  sequencerSteps: number;
  sequencerPulses: number;
  sequencerRotate: number;
  effects: EffectState;
}

interface LFOState {
    id: string;
    name: string;
    rate: number;
    depth: number;
    shape: LFO_Shape;
    sync: boolean;
    syncRate: string; // e.g. '1/4', '1/8'
    routing: {
        filter1Cutoff: boolean;
        filter1Resonance: boolean;
        filter2Cutoff: boolean;
        filter2Resonance: boolean;
        engine1Vol: boolean;
        engine1SynthFreq: boolean;
        engine1SamplerTranspose: boolean;
        engine2Vol: boolean;
        engine2SynthFreq: boolean;
        engine2SamplerTranspose: boolean;
        engine3Vol: boolean;
        engine3SynthFreq: boolean;
        engine3SamplerTranspose: boolean;
    }
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
            <h2>{engine.name}</h2>
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
            <label>Sequencer</label>
            <button
                className={`power-toggle small ${engine.sequencerEnabled ? 'active' : ''}`}
                onClick={() => onUpdate(engine.id, { sequencerEnabled: !engine.sequencerEnabled })}>
                {engine.sequencerEnabled ? 'ON' : 'OFF'}
            </button>
        </div>
        {engine.sequencerEnabled && (
            <>
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
            </>
        )}
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
    masterVolume, setMasterVolume, bpm, setBPM, isTransportPlaying, onToggleTransport
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

    return (
        <div className="top-bar">
            <div className="top-bar-group">
                <h2>Poly-Rhythm Synth</h2>
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
                            style={{width: '120px'}}
                        />
                        <input
                            type="text"
                            value={inputValue}
                            onChange={(e) => setInputValue(e.target.value)}
                            onFocus={() => isFocusedRef.current = true}
                            onBlur={handleBlur}
                            onKeyDown={handleKeyDown}
                            style={{ width: '70px', textAlign: 'right', backgroundColor: '#3a3a50', color: 'var(--on-surface-color)', border: '1px solid #4a4a60', borderRadius: '4px', padding: '0.3rem' }}
                        />
                    </div>
                </div>
                <button onClick={onToggleTransport} className={isTransportPlaying ? 'active' : ''}>
                    {isTransportPlaying ? 'Stop' : 'Play'}
                </button>
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

const RoutingMatrix: React.FC<RoutingMatrixProps> = ({ lfoStates, onLfoUpdate }) => {
    const routingTargets = [
        { key: 'filter1Cutoff', label: 'Filter 1 Cutoff' },
        { key: 'filter1Resonance', label: 'Filter 1 Reso' },
        { key: 'filter2Cutoff', label: 'Filter 2 Cutoff' },
        { key: 'filter2Resonance', label: 'Filter 2 Reso' },
        { key: 'engine1Vol', label: 'Engine 1 Volume' },
        { key: 'engine1SynthFreq', label: 'E1 Synth Freq' },
        { key: 'engine1SamplerTranspose', label: 'E1 Sampler Trans' },
        { key: 'engine2Vol', label: 'Engine 2 Volume' },
        { key: 'engine2SynthFreq', label: 'E2 Synth Freq' },
        { key: 'engine2SamplerTranspose', label: 'E2 Sampler Trans' },
        { key: 'engine3Vol', label: 'Engine 3 Volume' },
        { key: 'engine3SynthFreq', label: 'E3 Synth Freq' },
        { key: 'engine3SamplerTranspose', label: 'E3 Sampler Trans' },
    ];

    const handleRoutingChange = (lfoId: string, target: keyof LFOState['routing'], value: boolean) => {
        const lfo = lfoStates.find(l => l.id === lfoId);
        if (lfo) {
            onLfoUpdate(lfoId, { routing: { ...lfo.routing, [target]: value } });
        }
    };

    return (
        <table className="routing-matrix">
            <thead>
                <tr>
                    <th>Target</th>
                    {lfoStates.map(lfo => (
                        <th key={lfo.id} className="rotated-header"><div>{lfo.name}</div></th>
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
                                    onChange={e => handleRoutingChange(lfo.id, target.key as keyof LFOState['routing'], e.target.checked)}
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
  isTransportPlaying: boolean
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

  const [isInitialized, setIsInitialized] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [sampleBuffers, setSampleBuffers] = useState<Map<string, AudioBuffer>>(new Map());

  const patternsRef = useRef<Map<string, number[]>>(new Map());
  const stepTimeRef = useRef(0);

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
      const engineMixer = audioContext.createGain();
      const sequencerGain = audioContext.createGain();
      const analyser = audioContext.createAnalyser();

      engineMixer.connect(sequencerGain).connect(analyser).connect(filterSplitterRef.current!);

      engineNodesRef.current.set(engine.id, {
        synth: { volumeGain: audioContext.createGain() },
        noise: { volumeGain: audioContext.createGain() },
        sampler: { volumeGain: audioContext.createGain() },
        engineMixer,
        sequencerGain,
        analyser
      });
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
        if (engineNodes) volBus.connect(engineNodes.engineMixer.gain);
        
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
  
  useEffect(() => {
    const { audioContext, masterGain } = audioContextRef.current;
    if (!audioContext || !masterGain) return;
    masterGain.gain.setTargetAtTime(masterVolume, audioContext.currentTime, 0.01);
  }, [masterVolume, isInitialized]);
  
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

  useEffect(() => {
    if (!isTransportPlaying || !isInitialized || !audioContextRef.current.audioContext) {
        if (!isTransportPlaying) setCurrentStep(0);
        return;
    }
    const interval = (60 / bpm) / 4; // 16th note
    stepTimeRef.current = audioContextRef.current.audioContext!.currentTime + interval;
    const maxSteps = Math.max(...engineStates.map(e => e.sequencerSteps), 1);
    const scheduler = () => {
      const { audioContext } = audioContextRef.current;
      if (!audioContext) return;
      while (stepTimeRef.current < audioContext.currentTime + 0.1) {
        const currentGlobalStep = currentStep;
        engineStates.forEach(engine => {
          const pattern = patternsRef.current.get(engine.id);
          const engineNodes = engineNodesRef.current.get(engine.id);
          if (pattern && engineNodes && engine.sequencerEnabled) {
              const stepIndex = currentGlobalStep % pattern.length;
              if (pattern[stepIndex] === 1) {
                  engineNodes.sequencerGain.gain.cancelScheduledValues(stepTimeRef.current);
                  engineNodes.sequencerGain.gain.setValueAtTime(1, stepTimeRef.current);
                  engineNodes.sequencerGain.gain.setValueAtTime(0, stepTimeRef.current + interval * 0.9);
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
            if (samplerNodes.sourceNode) { // Stop standard playback if it's running
                samplerNodes.sourceNode.stop();
                samplerNodes.sourceNode.disconnect();
                samplerNodes.sourceNode = undefined;
            }
            if (!samplerNodes.granularSchedulerId) {
                const scheduler = () => {
                    const { grainSize, grainDensity, playbackPosition, positionJitter } = engine.sampler;
                    const grain = audioContext.createBufferSource();
                    grain.buffer = sampleBuffer;
                    
                    const jitter = (Math.random() - 0.5) * positionJitter;
                    const startPos = Math.max(0, playbackPosition + jitter) * sampleBuffer.duration;

                    grain.connect(samplerNodes.volumeGain);
                    if (samplerTransposeBus) samplerTransposeBus.connect(grain.detune);
                    grain.detune.value = engine.sampler.transpose * 100;
                    grain.start(audioContext.currentTime, startPos % sampleBuffer.duration, grainSize);
                };
                const intervalId = window.setInterval(scheduler, 1000 / sampler.grainDensity);
                samplerNodes.granularSchedulerId = intervalId;
            }
            samplerNodes.volumeGain.gain.setTargetAtTime(sampler.volume, audioContext.currentTime, 0.01);
        } else {
            // --- STANDARD MODE ---
             if (samplerNodes.granularSchedulerId) { // Stop granular playback if it's running
                clearInterval(samplerNodes.granularSchedulerId);
                samplerNodes.granularSchedulerId = undefined;
            }
            if (!samplerNodes.sourceNode) {
                const sampleSource = audioContext.createBufferSource();
                sampleSource.buffer = sampleBuffer;
                sampleSource.loop = true;
                if (samplerTransposeBus) samplerTransposeBus.connect(sampleSource.detune);
                sampleSource.connect(samplerNodes.volumeGain).connect(engineMixer);
                sampleSource.start();
                samplerNodes.sourceNode = sampleSource;
            }
            (samplerNodes.sourceNode as AudioBufferSourceNode).detune.setTargetAtTime(sampler.transpose * 100, audioContext.currentTime, 0.01);
            samplerNodes.volumeGain.gain.setTargetAtTime(sampler.volume, audioContext.currentTime, 0.01);
        }
      } else {
         // --- SAMPLER DISABLED ---
        if (samplerNodes.sourceNode) {
            samplerNodes.sourceNode.stop();
            samplerNodes.sourceNode.disconnect();
            samplerNodes.sourceNode = undefined;
        }
        if (samplerNodes.granularSchedulerId) {
            clearInterval(samplerNodes.granularSchedulerId);
            samplerNodes.granularSchedulerId = undefined;
        }
      }

    });
  }, [engineStates, isInitialized, sampleBuffers]);

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

    // LFO Routing
    useEffect(() => {
        if (!isInitialized || !lfoRoutingBussesRef.current || !filter1NodesRef.current || !filter2NodesRef.current) return;
        const busses = lfoRoutingBussesRef.current;
        
        lfoStates.forEach(lfoState => {
            const lfoNodes = lfoNodesRef.current.get(lfoState.id);
            if (!lfoNodes) return;
            try { lfoNodes.depth.disconnect(); } catch (e) {}
        });

        const connectLfo = (lfoId: string, targetNode: AudioNode | undefined, isConnected: boolean) => {
             const lfoNodes = lfoNodesRef.current.get(lfoId);
             if (lfoNodes && isConnected && targetNode) lfoNodes.depth.connect(targetNode);
        };

        lfoStates.forEach(lfoState => {
            connectLfo(lfoState.id, busses.filter1.cutoffModBus, lfoState.routing.filter1Cutoff);
            connectLfo(lfoState.id, busses.filter1.resonanceModBus, lfoState.routing.filter1Resonance);
            connectLfo(lfoState.id, busses.filter2.cutoffModBus, lfoState.routing.filter2Cutoff);
            connectLfo(lfoState.id, busses.filter2.resonanceModBus, lfoState.routing.filter2Resonance);
            ['engine1', 'engine2', 'engine3'].forEach(engineId => {
                const eBusses = busses.engineModBusses.get(engineId);
                if(eBusses) {
                    connectLfo(lfoState.id, eBusses.vol, lfoState.routing[`${engineId}Vol` as keyof LFOState['routing']]);
                    connectLfo(lfoState.id, eBusses.synthFreq, lfoState.routing[`${engineId}SynthFreq` as keyof LFOState['routing']]);
                    connectLfo(lfoState.id, eBusses.samplerTranspose, lfoState.routing[`${engineId}SamplerTranspose` as keyof LFOState['routing']]);
                }
            });
        });
    }, [lfoStates, isInitialized]);

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
}
interface MorphState {
    isActive: boolean;
    duration: number; // in steps
    startStep: number;
    start: MorphSnapshot | null;
    target: MorphSnapshot | null;
}

const createInitialEngineState = (id: string, name: string): EngineState => ({
    id, name, sequencerEnabled: false, sequencerSteps: 16, sequencerPulses: 4, sequencerRotate: 0,
    effects: { distortion: 0, delayTime: 0, delayFeedback: 0 },
    synth: { enabled: false, volume: 0.7, frequency: 440, oscillatorType: 'sine', solfeggioFrequency: '' },
    noise: { enabled: false, volume: 0.5, noiseType: 'white' },
    sampler: { enabled: false, volume: 1, sampleName: null, transpose: 0, granularModeEnabled: false, grainSize: 0.1, grainDensity: 20, playbackPosition: 0, positionJitter: 0 },
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

  
  const createInitialLFOState = (id: string, name: string): LFOState => ({
    id, name, rate: 5, depth: 0.5, shape: 'sine', sync: false, syncRate: '1/4',
    routing: {
        filter1Cutoff: false, filter1Resonance: false, filter2Cutoff: false, filter2Resonance: false,
        engine1Vol: false, engine1SynthFreq: false, engine1SamplerTranspose: false,
        engine2Vol: false, engine2SynthFreq: false, engine2SamplerTranspose: false,
        engine3Vol: false, engine3SynthFreq: false, engine3SamplerTranspose: false,
    }
  });

  const [lfoStates, setLfoStates] = useState<LFOState[]>([
    createInitialLFOState('lfo1', 'LFO 1'),
    createInitialLFOState('lfo2', 'LFO 2'),
    createInitialLFOState('lfo3', 'LFO 3'),
  ]);

  const [engineStates, setEngineStates] = useState<EngineState[]>([
    { ...createInitialEngineState('engine1', 'Engine 1'), sequencerEnabled: true, synth: {...createInitialEngineState('','').synth, enabled: true} },
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
    engineStates, setEngineStates, masterVolume, filter1, filter2, filterRouting, lfoStates, masterEffects, bpm, isTransportPlaying,
  );
  
  const cancelMorph = useCallback(() => {
    setMorph(prev => ({ ...prev, isActive: false, start: null, target: null }));
    lastMorphStepRef.current = -1;
  }, []);

  const handleEngineUpdate = (engineId: string, updates: Partial<EngineState>) => {
    cancelMorph();
    setEngineStates(prev => prev.map(e => e.id === engineId ? { ...e, ...updates } : e));
  };
  
  const handleEngineLayerUpdate = <K extends 'synth' | 'noise' | 'sampler' | 'effects'>(
    engineId: string,
    layer: K,
    updates: Partial<EngineState[K]>
  ) => {
    cancelMorph();
    setEngineStates(prev => prev.map(e => e.id === engineId ? { ...e, [layer]: { ...e[layer], ...updates } } : e));
  };

  const handleLfoUpdate = (lfoId: string, updates: Partial<LFOState>) => {
    cancelMorph();
    setLfoStates(prevLfos =>
      prevLfos.map(lfo => {
        if (lfo.id !== lfoId) return lfo;
        const newLfo = { ...lfo, ...updates };
        if (updates.routing) newLfo.routing = { ...lfo.routing, ...updates.routing };
        return newLfo;
      })
    );
  };

  const wrappedSetMasterVolume = (v: number) => { cancelMorph(); setMasterVolume(v); };
  const handleFilter1Update = (u: Partial<FilterState>) => { cancelMorph(); setFilter1(p => ({...p, ...u})); };
  const handleFilter2Update = (u: Partial<FilterState>) => { cancelMorph(); setFilter2(p => ({...p, ...u})); };
  const wrappedSetMasterEffects = (effects: React.SetStateAction<MasterEffect[]>) => { cancelMorph(); setMasterEffects(effects); };

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
            newEngine.sampler.transpose = getRandomElement([0, 3, 5, 7, 12, -5, -7, -12]);
        } else if (mode === 'rhythmic') {
            newEngine.sequencerSteps = getRandomElement([8, 12, 16, 24, 32]);
            newEngine.sequencerPulses = getRandomInt(1, newEngine.sequencerSteps / 2);
            newEngine.sequencerRotate = getRandomInt(0, newEngine.sequencerSteps - 1);
        }
        return newEngine;
    };
    
    const randomizeLfo = (lfo: LFOState): LFOState => {
        const newLfo = JSON.parse(JSON.stringify(lfo));
        if (mode === 'chaos') {
            newLfo.rate = getRandom(0.1, 20);
            newLfo.depth = getRandom(0, 1);
            newLfo.shape = getRandomElement(lfoShapes);
            newLfo.sync = getRandomBool(0.3);
            newLfo.syncRate = getRandomElement(lfoSyncRates);
        } else if (mode === 'rhythmic') {
            newLfo.sync = true;
            newLfo.syncRate = getRandomElement(lfoSyncRates);
            newLfo.rate = 1; // placeholder, sync will override
        } else { // harmonic
             newLfo.rate = getRandom(0.5, 5);
             newLfo.depth = getRandom(0.2, 0.8);
        }
        return newLfo;
    };
    const randomizeFilter = (): FilterState => {
        if (mode === 'chaos') {
            return {
                type: getRandomElement(filterTypes),
                cutoff: getRandom(100, 15000),
                resonance: getRandom(0, 20),
            };
        }
        // Harmonic and Rhythmic can have more "tame" values
        return {
            type: getRandomElement(['lowpass', 'highpass']),
            cutoff: getRandom(500, 8000),
            resonance: getRandom(0.5, 5),
        };
    };
    const randomizeEffect = (effect: MasterEffect): MasterEffect => {
       const newEffect = JSON.parse(JSON.stringify(effect));
       switch(newEffect.type) {
           case 'distortion':
               newEffect.params.distortion = { mode: getRandomElement(distortionModes), amount: getRandom(0, 1) };
               break;
           case 'delay':
               newEffect.params.delay = { time: getRandom(0.05, 1), feedback: getRandom(0, 0.9), mix: getRandom(0, 1) };
               break;
           case 'reverb':
               newEffect.params.reverb = { decay: getRandom(0.5, 8), mix: getRandom(0, 1) };
               break;
       }
       return newEffect;
    };
    const randomizeRoutingMatrix = (): LFOState[] => {
        const newLfos = JSON.parse(JSON.stringify(lfoStates));
        newLfos.forEach((lfo: LFOState) => {
            for (const key in lfo.routing) {
                let probability = 0.2; // Chaos
                if(mode === 'harmonic' || mode === 'rhythmic') {
                    probability = 0.1; // Sparser for musical modes
                }
                (lfo.routing as any)[key] = getRandomBool(probability);
            }
        });
        return newLfos;
    }
      
    const startSnapshot = { engines: engineStates, lfos: lfoStates, filter1, filter2, effects: masterEffects };
    let targetSnapshot = JSON.parse(JSON.stringify(startSnapshot));

    if (scope === 'global') {
        targetSnapshot.engines = engineStates.map(e => randomizeEngine(e));
        targetSnapshot.lfos = randomizeRoutingMatrix().map(l => randomizeLfo(l));
        targetSnapshot.filter1 = randomizeFilter();
        targetSnapshot.filter2 = randomizeFilter();
        targetSnapshot.effects = masterEffects.map(ef => randomizeEffect(ef));
    } else if (scope.startsWith('engine')) {
        targetSnapshot.engines = engineStates.map(e => e.id === scope ? randomizeEngine(e) : e);
    } else if (scope.startsWith('lfo')) {
        targetSnapshot.lfos = lfoStates.map(l => l.id === scope ? randomizeLfo(l) : l);
    } else if (scope === 'filter1') {
        targetSnapshot.filter1 = randomizeFilter();
    } else if (scope === 'filter2') {
        targetSnapshot.filter2 = randomizeFilter();
    } else if (scope === 'routingmatrix') {
        targetSnapshot.lfos = randomizeRoutingMatrix();
    } else { // Is an effect ID
        targetSnapshot.effects = masterEffects.map(ef => ef.id === scope ? randomizeEffect(ef) : ef);
    }

    if (isMorphEnabled && isTransportPlaying) {
        setMorph({ isActive: true, duration: morphDuration, startStep: currentStep, start: startSnapshot, target: targetSnapshot });
    } else {
        setEngineStates(targetSnapshot.engines);
        setLfoStates(targetSnapshot.lfos);
        setFilter1(targetSnapshot.filter1);
        setFilter2(targetSnapshot.filter2);
        setMasterEffects(targetSnapshot.effects);
    }
  }, [engineStates, lfoStates, filter1, filter2, masterEffects, isMorphEnabled, morphDuration, harmonicTuningSystem, isTransportPlaying, currentStep, cancelMorph]);
  
  useEffect(() => {
    if (!morph.isActive || !morph.start || !morph.target || !isTransportPlaying) {
        return;
    }
    
    // This ensures we only run the interpolation logic ONCE per sequencer step
    if (currentStep === lastMorphStepRef.current) {
        return;
    }
    lastMorphStepRef.current = currentStep;

    const stepsElapsed = (currentStep - morph.startStep + Math.max(...engineStates.map(e => e.sequencerSteps), 1)) % Math.max(...engineStates.map(e => e.sequencerSteps), 1);

    if (stepsElapsed >= morph.duration) {
        // Ensure final state is set exactly
        setEngineStates(morph.target.engines);
        setLfoStates(morph.target.lfos);
        setFilter1(morph.target.filter1);
        setFilter2(morph.target.filter2);
        setMasterEffects(morph.target.effects);
        cancelMorph();
        return;
    }

    const progress = stepsElapsed / morph.duration;
    const interpolate = (start: number, end: number) => start + (end - start) * progress;

    // Interpolate and update states
    const nextEngines = morph.start.engines.map((startEngine, i) => {
        const targetEngine = morph.target!.engines[i];
        if (!targetEngine) return startEngine;
        return {
            ...startEngine,
            synth: {
                ...startEngine.synth,
                volume: interpolate(startEngine.synth.volume, targetEngine.synth.volume),
                frequency: interpolate(startEngine.synth.frequency, targetEngine.synth.frequency),
            },
            noise: {
                ...startEngine.noise,
                volume: interpolate(startEngine.noise.volume, targetEngine.noise.volume),
            },
            sampler: {
                ...startEngine.sampler,
                volume: interpolate(startEngine.sampler.volume, targetEngine.sampler.volume),
                transpose: interpolate(startEngine.sampler.transpose, targetEngine.sampler.transpose),
                grainSize: interpolate(startEngine.sampler.grainSize, targetEngine.sampler.grainSize),
                grainDensity: interpolate(startEngine.sampler.grainDensity, targetEngine.sampler.playbackPosition),
                positionJitter: interpolate(startEngine.sampler.positionJitter, targetEngine.sampler.positionJitter),
            },
            sequencerSteps: Math.round(interpolate(startEngine.sequencerSteps, targetEngine.sequencerSteps)),
            sequencerPulses: Math.round(interpolate(startEngine.sequencerPulses, targetEngine.sequencerPulses)),
            sequencerRotate: Math.round(interpolate(startEngine.sequencerRotate, targetEngine.sequencerRotate)),
        };
    });
    setEngineStates(nextEngines);

    const nextLfos = morph.start.lfos.map((startLfo, i) => {
        const targetLfo = morph.target!.lfos[i];
        if (!targetLfo) return startLfo;
        return {
            ...startLfo,
            rate: interpolate(startLfo.rate, targetLfo.rate),
            depth: interpolate(startLfo.depth, targetLfo.depth),
        };
    });
    setLfoStates(nextLfos);
    
    setFilter1({
        ...morph.start.filter1,
        cutoff: interpolate(morph.start.filter1.cutoff, morph.target.filter1.cutoff),
        resonance: interpolate(morph.start.filter1.resonance, morph.target.filter1.resonance),
    });
    setFilter2({
        ...morph.start.filter2,
        cutoff: interpolate(morph.start.filter2.cutoff, morph.target.filter2.cutoff),
        resonance: interpolate(morph.start.filter2.resonance, morph.target.filter2.resonance),
    });

    const nextEffects = morph.start.effects.map((startEffect) => {
        const targetEffect = morph.target!.effects.find(e => e.id === startEffect.id);
        if (!targetEffect) return startEffect;
        const newParams: MasterEffect['params'] = JSON.parse(JSON.stringify(startEffect.params));

        if (startEffect.type === 'distortion' && startEffect.params.distortion && targetEffect.params.distortion) {
            newParams.distortion!.amount = interpolate(startEffect.params.distortion.amount, targetEffect.params.distortion.amount);
        }
        if (startEffect.type === 'delay' && startEffect.params.delay && targetEffect.params.delay) {
            newParams.delay!.time = interpolate(startEffect.params.delay.time, targetEffect.params.delay.time);
            newParams.delay!.feedback = interpolate(startEffect.params.delay.feedback, targetEffect.params.delay.mix);
            newParams.delay!.mix = interpolate(startEffect.params.delay.mix, targetEffect.params.delay.mix);
        }
        if (startEffect.type === 'reverb' && startEffect.params.reverb && targetEffect.params.reverb) {
            newParams.reverb!.decay = interpolate(startEffect.params.reverb.decay, targetEffect.params.reverb.decay);
            newParams.reverb!.mix = interpolate(startEffect.params.reverb.mix, targetEffect.params.reverb.mix);
        }
        return {...startEffect, params: newParams };
    });
    setMasterEffects(nextEffects);

  }, [currentStep, isTransportPlaying, morph, cancelMorph, engineStates]);

  const handleToggleTransport = () => {
      setIsTransportPlaying(p => { 
        if (!p) {
            lastMorphStepRef.current = -1; // Reset morph tracking on play
        } else {
            cancelMorph(); 
        }
        return !p; 
      });
  };
  
  const ai = useMemo(() => process.env.API_KEY ? new GoogleGenAI({ apiKey: process.env.API_KEY }) : null, []);

  const handleIntelligentRandomize = useCallback(async (scope: 'global' | string) => {
    if (!ai) {
      alert("API Key not configured.");
      return;
    }
    cancelMorph();
    setIsAiLoading(true);

    const currentState = { engines: engineStates, lfos: lfoStates, filter1, filter2, effects: masterEffects };
    const prompt = `You are a sound design expert for a complex poly-rhythmic synthesizer. A user wants a creative, musically coherent variation.
    The current state of the synthesizer is: ${JSON.stringify(currentState)}
    The user wants to randomize only the following part(s): '${scope}'.
    Your task is to generate a new set of parameters for ONLY the specified scope. The new parameters should be an interesting and musically pleasing evolution of the current state.
    For example, if the current synth frequency is 440Hz, a good variation might be 660Hz (a perfect fifth higher), not a random number like 1234Hz. If the LFO is slow, maybe a slightly faster but related tempo would be good.
    IMPORTANT: Return ONLY the JSON object for the part(s) you are changing. For example, if scope is 'engine1', return an object like: { "engines": [{ "id": "engine1", "synth": { "frequency": 660, "volume": 0.6 } }] }. If scope is 'routingmatrix', return an object like { "lfos": [{ "id": "lfo1", "routing": { "filter1Cutoff": true, ... }}] }. Do not return the full synth state. Be minimal in your response.`;

    const samplerSchema = { 
        type: Type.OBJECT,
        properties: {
            volume: { type: Type.NUMBER },
            transpose: { type: Type.NUMBER },
            granularModeEnabled: { type: Type.BOOLEAN },
            grainSize: { type: Type.NUMBER },
            grainDensity: { type: Type.NUMBER },
            playbackPosition: { type: Type.NUMBER },
            positionJitter: { type: Type.NUMBER },
        },
        optional: ['volume', 'transpose', 'granularModeEnabled', 'grainSize', 'grainDensity', 'playbackPosition', 'positionJitter'],
    };
    
    const routingSchema = {
        type: Type.OBJECT,
        properties: {
            filter1Cutoff: { type: Type.BOOLEAN }, filter1Resonance: { type: Type.BOOLEAN },
            filter2Cutoff: { type: Type.BOOLEAN }, filter2Resonance: { type: Type.BOOLEAN },
            engine1Vol: { type: Type.BOOLEAN }, engine1SynthFreq: { type: Type.BOOLEAN }, engine1SamplerTranspose: { type: Type.BOOLEAN },
            engine2Vol: { type: Type.BOOLEAN }, engine2SynthFreq: { type: Type.BOOLEAN }, engine2SamplerTranspose: { type: Type.BOOLEAN },
            engine3Vol: { type: Type.BOOLEAN }, engine3SynthFreq: { type: Type.BOOLEAN }, engine3SamplerTranspose: { type: Type.BOOLEAN },
        },
        optional: Object.keys(createInitialLFOState('','').routing)
    }

    let responseSchema: any = { type: Type.OBJECT, properties: {}, optional: ['engines', 'lfos', 'filter1', 'filter2', 'effects'] };
    if (scope === 'global' || scope.startsWith('engine')) responseSchema.properties.engines = { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { id: { type: Type.STRING }, synth: { type: Type.OBJECT, properties: { volume: { type: Type.NUMBER }, frequency: { type: Type.NUMBER }, oscillatorType: { type: Type.STRING, enum: [...oscillatorTypes] } }, optional: ['volume', 'frequency', 'oscillatorType'] }, noise: { type: Type.OBJECT, properties: { volume: {type: Type.NUMBER}, noiseType: { type: Type.STRING, enum: [...noiseTypes]}}, optional: ['volume', 'noiseType'] }, sampler: samplerSchema, sequencerSteps: { type: Type.NUMBER }, sequencerPulses: { type: Type.NUMBER } }, optional: ['id', 'synth', 'noise', 'sampler', 'sequencerSteps', 'sequencerPulses'] } };
    if (scope === 'global' || scope.startsWith('lfo') || scope === 'routingmatrix') responseSchema.properties.lfos = { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { id: { type: Type.STRING }, rate: { type: Type.NUMBER }, depth: { type: Type.NUMBER }, shape: { type: Type.STRING, enum: [...lfoShapes] }, routing: routingSchema }, optional: ['id', 'rate', 'depth', 'shape', 'routing'] } };
    if (scope === 'global' || scope === 'filter1') responseSchema.properties.filter1 = { type: Type.OBJECT, properties: { cutoff: { type: Type.NUMBER }, resonance: { type: Type.NUMBER }, type: { type: Type.STRING, enum: [...filterTypes] } }, optional: ['cutoff', 'resonance', 'type'] };
    if (scope === 'global' || scope === 'filter2') responseSchema.properties.filter2 = { type: Type.OBJECT, properties: { cutoff: { type: Type.NUMBER }, resonance: { type: Type.NUMBER }, type: { type: Type.STRING, enum: [...filterTypes] } }, optional: ['cutoff', 'resonance', 'type'] };
    
    try {
        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: prompt,
            config: { responseMimeType: "application/json", responseSchema }
        });
        
        const update = JSON.parse(response.text);
        
        const startSnapshot: MorphSnapshot = { engines: JSON.parse(JSON.stringify(engineStates)), lfos: JSON.parse(JSON.stringify(lfoStates)), filter1: {...filter1}, filter2: {...filter2}, effects: JSON.parse(JSON.stringify(masterEffects)) };
        
        let targetEngines = JSON.parse(JSON.stringify(startSnapshot.engines));
        let targetLfos = JSON.parse(JSON.stringify(startSnapshot.lfos));
        let targetFilter1 = JSON.parse(JSON.stringify(startSnapshot.filter1));
        let targetFilter2 = JSON.parse(JSON.stringify(startSnapshot.filter2));
        
        if (update.engines) {
            update.engines.forEach((engineUpdate: Partial<EngineState> & { id: string }) => {
                const index = targetEngines.findIndex((e: EngineState) => e.id === engineUpdate.id);
                if (index !== -1) {
                    if (engineUpdate.synth) targetEngines[index].synth = {...targetEngines[index].synth, ...engineUpdate.synth};
                    if (engineUpdate.noise) targetEngines[index].noise = {...targetEngines[index].noise, ...engineUpdate.noise};
                    if (engineUpdate.sampler) targetEngines[index].sampler = {...targetEngines[index].sampler, ...engineUpdate.sampler};
                    if (engineUpdate.sequencerSteps) targetEngines[index].sequencerSteps = engineUpdate.sequencerSteps;
                    if (engineUpdate.sequencerPulses) targetEngines[index].sequencerPulses = engineUpdate.sequencerPulses;
                }
            });
        }
        if (update.lfos) {
             update.lfos.forEach((lfoUpdate: Partial<LFOState> & { id: string }) => {
                const index = targetLfos.findIndex((l: LFOState) => l.id === lfoUpdate.id);
                if (index !== -1) {
                    // Safely merge routing
                    const newRouting = lfoUpdate.routing ? { ...targetLfos[index].routing, ...lfoUpdate.routing } : targetLfos[index].routing;
                    targetLfos[index] = {...targetLfos[index], ...lfoUpdate, routing: newRouting };
                }
            });
        }
        if (update.filter1) targetFilter1 = {...targetFilter1, ...update.filter1};
        if (update.filter2) targetFilter2 = {...targetFilter2, ...update.filter2};

        const targetSnapshot = { engines: targetEngines, lfos: targetLfos, filter1: targetFilter1, filter2: targetFilter2, effects: startSnapshot.effects };
        
        if (isMorphEnabled && isTransportPlaying) {
            setMorph({ isActive: true, duration: morphDuration, startStep: currentStep, start: startSnapshot, target: targetSnapshot });
        } else {
            setEngineStates(targetSnapshot.engines);
            setLfoStates(targetSnapshot.lfos);
            setFilter1(targetSnapshot.filter1);
            setFilter2(targetSnapshot.filter2);
        }

    } catch (e) {
        console.error("AI Generation Error:", e);
        alert("Failed to generate AI response.");
    } finally {
        setIsAiLoading(false);
    }
  }, [ai, engineStates, lfoStates, filter1, filter2, masterEffects, isMorphEnabled, morphDuration, cancelMorph, isTransportPlaying, currentStep]);

  if (!isReady) {
    return (
      <div className="init-overlay">
        <button onClick={() => { initializeAudio(); setIsReady(true); }}>Start Synthesizer</button>
      </div>
    );
  }
  
  return (
    <>
      {isAiLoading && <div className="ai-loading-overlay">AI is thinking...</div>}
      <div className="app-container">
        <TopBar
          masterVolume={masterVolume}
          setMasterVolume={wrappedSetMasterVolume}
          bpm={bpm}
          setBPM={setBpm}
          isTransportPlaying={isTransportPlaying}
          onToggleTransport={handleToggleTransport}
        />
        <div className="main-grid">
            <div className="full-width-container">
                <GenerativeTools
                    onRandomize={handleRandomize} onIntelligentRandomize={handleIntelligentRandomize}
                    isMorphEnabled={isMorphEnabled} setIsMorphEnabled={setIsMorphEnabled}
                    morphDuration={morphDuration} setMorphDuration={setMorphDuration}
                    harmonicTuningSystem={harmonicTuningSystem} setHarmonicTuningSystem={setHarmonicTuningSystem}
                />
            </div>
             <div className="full-width-container">
                <div className="master-visualizer-container">
                    {leftAnalyserRef.current && <div className="visualizer-wrapper"><span className="visualizer-label">L</span><Visualizer analyserNode={leftAnalyserRef.current} type="waveform" /></div>}
                    {rightAnalyserRef.current && <div className="visualizer-wrapper"><span className="visualizer-label">R</span><Visualizer analyserNode={rightAnalyserRef.current} type="waveform" /></div>}
                    {masterAnalyserRef.current && <div className="visualizer-wrapper"><span className="visualizer-label">M</span><Visualizer analyserNode={masterAnalyserRef.current} type="waveform" /></div>}
                </div>
             </div>
             <div className="channels-container">
                {engineStates.map(engine => (
                <EngineControls key={engine.id} engine={engine}
                    onUpdate={handleEngineUpdate} onLayerUpdate={handleEngineLayerUpdate}
                    onLoadSample={loadSample} onRandomize={handleRandomize} onIntelligentRandomize={handleIntelligentRandomize}
                    analyserNode={engineNodesRef.current.get(engine.id)?.analyser}
                    currentStep={currentStep} isTransportPlaying={isTransportPlaying}
                />
                ))}
             </div>
             <div className="processing-container">
                <div className="filters-container">
                    <div className="filters-container-header">
                        <h2>Master Filters</h2>
                        <FilterRoutingSwitch filterRouting={filterRouting} setFilterRouting={setFilterRouting} />
                    </div>
                    <div className="filters-grid">
                        <MasterFilterControls title="Filter 1" filterState={filter1} onUpdate={handleFilter1Update} onRandomize={handleRandomize} onIntelligentRandomize={handleIntelligentRandomize} />
                        <MasterFilterControls title="Filter 2" filterState={filter2} onUpdate={handleFilter2Update} onRandomize={handleRandomize} onIntelligentRandomize={handleIntelligentRandomize} />
                    </div>
                </div>
                 <MasterEffects effects={masterEffects} setEffects={wrappedSetMasterEffects} onRandomize={handleRandomize} onIntelligentRandomize={handleIntelligentRandomize} />
             </div>
             <div className="bottom-module-container">
                <div className="bottom-module-header">
                    <div className="bottom-tab-nav">
                        <button className={`bottom-tab-button ${bottomTab === 'lfos' ? 'active' : ''}`} onClick={() => setBottomTab('lfos')}>LFOs</button>
                        <button className={`bottom-tab-button ${bottomTab === 'matrix' ? 'active' : ''}`} onClick={() => setBottomTab('matrix')}>Routing Matrix</button>
                    </div>
                    {bottomTab === 'matrix' && (
                         <div className="randomizer-buttons-group">
                             <button className="icon-button" onClick={() => handleRandomize('chaos', 'routingmatrix')} title="Chaos Randomize"><ChaosIcon /></button>
                             <button className="icon-button" onClick={() => handleRandomize('harmonic', 'routingmatrix')} title="Harmonic Randomize"><HarmonicIcon /></button>
                             <button className="icon-button" onClick={() => handleRandomize('rhythmic', 'routingmatrix')} title="Rhythmic Randomize"><RhythmicIcon /></button>
                             <button className="icon-button ai-button" onClick={() => handleIntelligentRandomize('routingmatrix')} title="Intelligent Randomize"><AIIcon /></button>
                        </div>
                    )}
                </div>
                {bottomTab === 'lfos' && (
                    <div className="lfo-grid-container">
                        {lfoStates.map((lfo) => (
                            <LFOControls key={lfo.id} lfoState={lfo}
                                onUpdate={(updates) => handleLfoUpdate(lfo.id, updates)}
                                onRandomize={handleRandomize} onIntelligentRandomize={handleIntelligentRandomize}
                            />
                        ))}
                    </div>
                )}
                {bottomTab === 'matrix' && <RoutingMatrix lfoStates={lfoStates} onLfoUpdate={handleLfoUpdate} />}
             </div>
        </div>
      </div>
    </>
  );
};

const container = document.getElementById('root');
const root = createRoot(container!);
root.render(<App />);