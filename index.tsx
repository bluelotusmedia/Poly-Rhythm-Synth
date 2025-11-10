
import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI, Type } from "@google/genai";

// --- Type Definitions ---
type OscillatorType = 'sine' | 'square' | 'sawtooth' | 'triangle';
type NoiseType = 'white' | 'pink' | 'brown';
type LFO_Shape = 'sine' | 'square' | 'sawtooth' | 'triangle' | 'ramp';
type FilterType = 'lowpass' | 'highpass' | 'bandpass' | 'notch';
type RandomizeMode = 'chaos' | 'harmonic' | 'rhythmic';
type EngineLayerType = 'synth' | 'noise' | 'sampler';
type DistortionMode = 'overdrive' | 'soft clip' | 'hard clip' | 'foldback';

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
        filterCutoff: boolean;
        filterResonance: boolean;
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
type TuningSystem = '440_ET' | '432_ET' | 'just_intonation' | 'pythagorean' | 'solfeggio' | 'custom';
interface CustomTuning {
    name: string;
    frequencies: number[];
}

// --- New Audio Node Types ---
interface LayerAudioNodes {
    sourceNode?: OscillatorNode | AudioBufferSourceNode;
    volumeGain: GainNode;
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

interface LfoRoutingBusses {
    filterCutoffModBus: GainNode;
    filterResonanceModBus: GainNode;
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
  onLayerUpdate: <K extends keyof Omit<EngineState, 'id' | 'name'>>(
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

interface MasterFilterControlsProps {
    globalFilterCutoff: number;
    setGlobalFilterCutoff: (cutoff: number) => void;
    globalFilterResonance: number;
    setGlobalFilterResonance: (resonance: number) => void;
    globalFilterType: FilterType;
    setGlobalFilterType: (type: FilterType) => void;
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
    onLoadCustomTuning: (file: File) => void;
    customTuning: CustomTuning | null;
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
const midiToFreq = (midi: number, a4 = 440) => a4 * Math.pow(2, (midi - 69) / 12);


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
      
      canvasCtx.clearRect(0, 0, width, height);
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
    globalFilterCutoff, setGlobalFilterCutoff, globalFilterResonance, setGlobalFilterResonance,
    globalFilterType, setGlobalFilterType, onRandomize, onIntelligentRandomize
}) => {
    return (
        <div className="control-group master-filter-container">
            <div className="control-group-header">
                <h2>Master Filter</h2>
                <div className="randomizer-buttons-group">
                    <button className="icon-button" title="Chaos Randomize" onClick={() => onRandomize('chaos', 'masterFilter')}><ChaosIcon /></button>
                    <button className="icon-button" title="Harmonic Randomize" onClick={() => onRandomize('harmonic', 'masterFilter')}><HarmonicIcon /></button>
                    <button className="icon-button" title="Rhythmic Randomize" onClick={() => onRandomize('rhythmic', 'masterFilter')}><RhythmicIcon /></button>
                    <button className="icon-button ai-button" title="Intelligent Randomize" onClick={() => onIntelligentRandomize('masterFilter')}><AIIcon /></button>
                </div>
            </div>
            <div className="control-row">
                <label>Type</label>
                <select value={globalFilterType} onChange={e => setGlobalFilterType(e.target.value as FilterType)}>
                    {filterTypes.map(type => <option key={type} value={type}>{type}</option>)}
                </select>
            </div>
            <div className="control-row">
                <label>Cutoff</label>
                <div className="control-value-wrapper">
                    <input type="range" min="20" max="20000" step="1" value={globalFilterCutoff} onChange={e => setGlobalFilterCutoff(Number(e.target.value))} />
                    <span>{globalFilterCutoff.toFixed(0)} Hz</span>
                </div>
            </div>
            <div className="control-row">
                <label>Resonance</label>
                <div className="control-value-wrapper">
                    <input type="range" min="0" max="30" step="0.1" value={globalFilterResonance} onChange={e => setGlobalFilterResonance(Number(e.target.value))} />
                    <span>{globalFilterResonance.toFixed(2)}</span>
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
                <button onClick={() => onUpdate({ sync: !lfoState.sync })} className={lfoState.sync ? 'active' : ''}>
                    {lfoState.sync ? 'ON' : 'OFF'}
                </button>
            </div>
        </div>
    );
};

const RoutingMatrix: React.FC<RoutingMatrixProps> = ({ lfoStates, onLfoUpdate }) => {
    const routingTargets = [
        { key: 'filterCutoff', label: 'Filter Cutoff' },
        { key: 'filterResonance', label: 'Filter Resonance' },
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
    onLoadCustomTuning: (file: File) => void,
    customTuning: CustomTuning | null
}> = ({ harmonicTuningSystem, setHarmonicTuningSystem, onLoadCustomTuning, customTuning }) => {
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        if (event.target.files && event.target.files[0]) {
            onLoadCustomTuning(event.target.files[0]);
        }
    };

    return (
        <div className="tuning-selector">
            <div className="control-row">
                <label>Harmonic Mode</label>
                <select value={harmonicTuningSystem} onChange={e => setHarmonicTuningSystem(e.target.value as TuningSystem)}>
                    <option value="440_ET">440Hz Equal Temperament</option>
                    <option value="432_ET">432Hz Equal Temperament</option>
                    <option value="just_intonation">Just Intonation</option>
                    <option value="pythagorean">Pythagorean</option>
                    <option value="solfeggio">Solfeggio</option>
                    {customTuning && <option value="custom">{customTuning.name}</option>}
                </select>
            </div>
            <div className="control-row">
                <label>Load Custom Tuning</label>
                <input type="file" accept=".json" style={{ display: 'none' }} ref={fileInputRef} onChange={handleFileChange} />
                <button className="small file-load-button" onClick={() => fileInputRef.current?.click()}>Load</button>
            </div>
        </div>
    );
};


const GenerativeTools: React.FC<GenerativeToolsProps> = ({
    onRandomize, onIntelligentRandomize, isMorphEnabled, setIsMorphEnabled, morphDuration, setMorphDuration,
    harmonicTuningSystem, setHarmonicTuningSystem, onLoadCustomTuning, customTuning
}) => {
    return (
        <div className="control-group generative-container">
            <div className="control-group-header">
                <h2>Generative Tools</h2>
            </div>
            <div className="generative-controls">
                 <div className="control-row">
                    <label>Randomize All</label>
                    <div className="randomizer-buttons-group">
                         <button className="icon-button" onClick={() => onRandomize('chaos', 'global')} title="Chaos Randomize"><ChaosIcon /></button>
                         <button className="icon-button" onClick={() => onRandomize('harmonic', 'global')} title="Harmonic Randomize"><HarmonicIcon /></button>
                         <button className="icon-button" onClick={() => onRandomize('rhythmic', 'global')} title="Rhythmic Randomize"><RhythmicIcon /></button>
                         <button className="icon-button ai-button" onClick={() => onIntelligentRandomize('global')} title="Intelligent Randomize"><AIIcon /></button>
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
                        onLoadCustomTuning={onLoadCustomTuning}
                        customTuning={customTuning}
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
  globalFilterCutoff: number,
  globalFilterResonance: number,
  globalFilterType: FilterType,
  lfoStates: LFOState[],
  masterEffects: MasterEffect[],
  bpm: number,
  isTransportPlaying: boolean
) => {
  const audioContextRef = useRef<{ audioContext: AudioContext | null, masterGain: GainNode | null }>({ audioContext: null, masterGain: null });
  const engineNodesRef = useRef<Map<string, EngineAudioNodes>>(new Map());
  const globalFilterNodeRef = useRef<BiquadFilterNode | null>(null);
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
    
    // Create all analysers and splitter
    masterAnalyserRef.current = audioContext.createAnalyser();
    leftAnalyserRef.current = audioContext.createAnalyser();
    rightAnalyserRef.current = audioContext.createAnalyser();
    splitterRef.current = audioContext.createChannelSplitter(2);

    const globalFilterNode = audioContext.createBiquadFilter();
    globalFilterNodeRef.current = globalFilterNode;

    engineStates.forEach(engine => {
      const engineMixer = audioContext.createGain();
      const sequencerGain = audioContext.createGain();
      const analyser = audioContext.createAnalyser();

      engineMixer.connect(sequencerGain).connect(analyser).connect(globalFilterNode);

      engineNodesRef.current.set(engine.id, {
        synth: { volumeGain: audioContext.createGain() },
        noise: { volumeGain: audioContext.createGain() },
        sampler: { volumeGain: audioContext.createGain() },
        engineMixer,
        sequencerGain,
        analyser
      });
    });

    // LFOs setup
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

    // LFO Routing Busses Setup
    const filterCutoffModBus = audioContext.createGain();
    const filterResonanceModBus = audioContext.createGain();
    const engineModBusses = new Map<string, EngineModBusses>();

    filterCutoffModBus.gain.value = 5000;
    filterResonanceModBus.gain.value = 15;

    filterCutoffModBus.connect(globalFilterNode.frequency);
    filterResonanceModBus.connect(globalFilterNode.Q);
    
    engineStates.forEach(engine => {
        const volBus = audioContext.createGain();
        volBus.gain.value = 0.5; // Modulate by +/- 50%
        const engineNodes = engineNodesRef.current.get(engine.id);
        if (engineNodes) {
             volBus.connect(engineNodes.engineMixer.gain);
        }

        const synthFreqBus = audioContext.createGain();
        synthFreqBus.gain.value = 440; // Modulate by +/- 440 Hz

        const samplerTransposeBus = audioContext.createGain();
        samplerTransposeBus.gain.value = 1200; // Modulate by +/- 12 semitones (1200 cents)

        engineModBusses.set(engine.id, {
            vol: volBus,
            synthFreq: synthFreqBus,
            samplerTranspose: samplerTransposeBus,
        });
    });
    
    lfoRoutingBussesRef.current = {
        filterCutoffModBus,
        filterResonanceModBus,
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
        }
      }
    };
    reader.readAsArrayBuffer(file);
  }, [setEngineStates]);
  
  // Master volume and filter effect updates
  useEffect(() => {
    const { audioContext, masterGain } = audioContextRef.current;
    if (!audioContext || !masterGain) return;
    masterGain.gain.setTargetAtTime(masterVolume, audioContext.currentTime, 0.01);
  }, [masterVolume, isInitialized]);
  
  useEffect(() => {
    const filterNode = globalFilterNodeRef.current;
    if (!filterNode || !audioContextRef.current.audioContext) return;
    const { audioContext } = audioContextRef.current;
    filterNode.type = globalFilterType;
    filterNode.frequency.setTargetAtTime(globalFilterCutoff, audioContext.currentTime, 0.01);
    filterNode.Q.setTargetAtTime(globalFilterResonance, audioContext.currentTime, 0.01);
  }, [globalFilterCutoff, globalFilterResonance, globalFilterType, isInitialized]);

  // Sequencer logic
  useEffect(() => {
    engineStates.forEach(engine => {
      const pattern = rotatePattern(
        generateEuclideanPattern(engine.sequencerSteps, engine.sequencerPulses),
        engine.sequencerRotate
      );
      patternsRef.current.set(engine.id, pattern);
    });
  }, [engineStates]);

  useEffect(() => {
    if (!isTransportPlaying || !isInitialized) return;
    const interval = (60 / bpm) / 4; // 16th note
    stepTimeRef.current = audioContextRef.current.audioContext!.currentTime + interval;
    
    const maxSteps = Math.max(...engineStates.map(e => e.sequencerSteps), 1);

    const scheduler = () => {
      while (stepTimeRef.current < audioContextRef.current.audioContext!.currentTime + 0.1) {
        
        engineStates.forEach(engine => {
          const pattern = patternsRef.current.get(engine.id);
          const engineNodes = engineNodesRef.current.get(engine.id);
          if (pattern && engineNodes && engine.sequencerEnabled) {
              const stepIndex = currentStep % pattern.length;
              if (pattern[stepIndex] === 1) {
                  engineNodes.sequencerGain.gain.setValueAtTime(1, stepTimeRef.current);
                  engineNodes.sequencerGain.gain.setValueAtTime(0, stepTimeRef.current + interval * 0.9);
              }
          }
        });
        
        const nextStep = (currentStep + 1) % maxSteps;
        setCurrentStep(nextStep);
        
        stepTimeRef.current += interval;
      }
    };

    const timerId = setInterval(scheduler, 25);
    return () => clearInterval(timerId);
  }, [isTransportPlaying, bpm, currentStep, engineStates, isInitialized]);


  // Update engine layer audio nodes
  useEffect(() => {
    const { audioContext } = audioContextRef.current;
    if (!audioContext || !isInitialized) return;

    engineStates.forEach(engine => {
      const engineNodes = engineNodesRef.current.get(engine.id);
      if (!engineNodes) return;
      
      const { synth, noise, sampler } = engine;
      const { synth: synthNodes, noise: noiseNodes, sampler: samplerNodes, engineMixer } = engineNodes;
      
      // Synth Layer
      if (synth.enabled) {
          if (!synthNodes.sourceNode) {
              synthNodes.sourceNode = audioContext.createOscillator();
              const synthFreqBus = lfoRoutingBussesRef.current?.engineModBusses.get(engine.id)?.synthFreq;
              if(synthFreqBus) {
                  synthFreqBus.connect((synthNodes.sourceNode as OscillatorNode).frequency);
              }
              synthNodes.sourceNode.connect(synthNodes.volumeGain).connect(engineMixer);
              synthNodes.sourceNode.start();
          }
          (synthNodes.sourceNode as OscillatorNode).type = synth.oscillatorType;
          (synthNodes.sourceNode as OscillatorNode).frequency.setTargetAtTime(synth.frequency, audioContext.currentTime, 0.01);
          synthNodes.volumeGain.gain.setTargetAtTime(synth.volume, audioContext.currentTime, 0.01);
      } else if (synthNodes.sourceNode) {
          synthNodes.sourceNode.stop();
          synthNodes.sourceNode.disconnect();
          synthNodes.sourceNode = undefined;
      }

      // Noise Layer
      if (noise.enabled) {
          if (!noiseNodes.sourceNode || (noiseNodes.sourceNode as any).noiseType !== noise.noiseType) {
              if (noiseNodes.sourceNode) {
                  noiseNodes.sourceNode.stop();
                  noiseNodes.sourceNode.disconnect();
              }
              const bufferSize = audioContext.sampleRate * 2; // 2 seconds of noise
              const buffer = audioContext.createBuffer(1, bufferSize, audioContext.sampleRate);
              const output = buffer.getChannelData(0);
              let lastOut = 0;
              for (let i = 0; i < bufferSize; i++) {
                let sample;
                switch (noise.noiseType) {
                    case 'white': sample = Math.random() * 2 - 1; break;
                    case 'pink': 
                        const b0 = 0.99886 * lastOut + (Math.random() * 2 - 1) * 0.0555179;
                        const b1 = 0.99332 * lastOut + (Math.random() * 2 - 1) * 0.0750759;
                        const b2 = 0.96900 * lastOut + (Math.random() * 2 - 1) * 0.1538520;
                        lastOut = b0 + b1 + b2 + (Math.random() * 2 - 1) * 0.01;
                        sample = lastOut * 0.11;
                        break;
                    case 'brown':
                        const brown = lastOut + (Math.random() * 2 - 1) * 0.02;
                        lastOut = brown;
                        sample = brown * 3.5;
                        break;
                    default: sample = Math.random() * 2 - 1;
                }
                output[i] = sample;
              }
              const noiseSource = audioContext.createBufferSource();
              (noiseSource as any).noiseType = noise.noiseType;
              noiseSource.buffer = buffer;
              noiseSource.loop = true;
              noiseSource.connect(noiseNodes.volumeGain).connect(engineMixer);
              noiseSource.start();
              noiseNodes.sourceNode = noiseSource;
          }
          noiseNodes.volumeGain.gain.setTargetAtTime(noise.volume, audioContext.currentTime, 0.01);
      } else if (noiseNodes.sourceNode) {
          noiseNodes.sourceNode.stop();
          noiseNodes.sourceNode.disconnect();
          noiseNodes.sourceNode = undefined;
      }

      // Sampler Layer
      const sampleBuffer = sampleBuffers.get(engine.id);
      if (sampler.enabled && sampleBuffer) {
        if(!samplerNodes.sourceNode) {
            const sampleSource = audioContext.createBufferSource();
            sampleSource.buffer = sampleBuffer;
            sampleSource.loop = true;
            
            const samplerTransposeBus = lfoRoutingBussesRef.current?.engineModBusses.get(engine.id)?.samplerTranspose;
            if (samplerTransposeBus) {
                samplerTransposeBus.connect(sampleSource.detune);
            }

            sampleSource.connect(samplerNodes.volumeGain).connect(engineMixer);
            sampleSource.start();
            samplerNodes.sourceNode = sampleSource;
        }
        (samplerNodes.sourceNode as AudioBufferSourceNode).detune.setTargetAtTime(sampler.transpose * 100, audioContext.currentTime, 0.01);
        samplerNodes.volumeGain.gain.setTargetAtTime(sampler.volume, audioContext.currentTime, 0.01);
      } else if(samplerNodes.sourceNode) {
        samplerNodes.sourceNode.stop();
        samplerNodes.sourceNode.disconnect();
        samplerNodes.sourceNode = undefined;
      }

    });
  }, [engineStates, isInitialized, sampleBuffers]);

  // LFO parameter updates
    useEffect(() => {
        if (!audioContextRef.current.audioContext || !isInitialized) return;
        const { audioContext } = audioContextRef.current;

        const syncRateToHz = (rate: string, currentBpm: number) => {
            const beatsPerSecond = currentBpm / 60;
            return beatsPerSecond * eval(rate);
        };

        lfoStates.forEach(lfoState => {
            const nodes = lfoNodesRef.current.get(lfoState.id);
            if (nodes) {
                const { lfo, depth } = nodes;
                lfo.type = lfoState.shape === 'ramp' ? 'sawtooth' : lfoState.shape;
                depth.gain.setTargetAtTime(lfoState.depth, audioContext.currentTime, 0.01);
                
                const rate = lfoState.sync
                    ? syncRateToHz(lfoState.syncRate, bpm)
                    : lfoState.rate;
                lfo.frequency.setTargetAtTime(rate, audioContext.currentTime, 0.01);
            }
        });
    }, [lfoStates, isInitialized, bpm]);

    // LFO Routing
    useEffect(() => {
        if (!audioContextRef.current.audioContext || !isInitialized || !lfoRoutingBussesRef.current) return;

        const busses = lfoRoutingBussesRef.current;
        
        // Disconnect all LFOs from all busses first to ensure a clean slate
        lfoStates.forEach(lfoState => {
            const lfoNodes = lfoNodesRef.current.get(lfoState.id);
            if (!lfoNodes) return;
            try {
                lfoNodes.depth.disconnect();
            } catch (e) { /* Ignore disconnection errors */ }
        });

        // Reconnect based on current state
        lfoStates.forEach(lfoState => {
            const lfoNodes = lfoNodesRef.current.get(lfoState.id);
            if (!lfoNodes) return;
            const { depth: lfoOutputGain } = lfoNodes;
            
            if (lfoState.routing.filterCutoff) lfoOutputGain.connect(busses.filterCutoffModBus);
            if (lfoState.routing.filterResonance) lfoOutputGain.connect(busses.filterResonanceModBus);
            
            const e1b = busses.engineModBusses.get('engine1');
            if (e1b) {
                if(lfoState.routing.engine1Vol) lfoOutputGain.connect(e1b.vol);
                if(lfoState.routing.engine1SynthFreq) lfoOutputGain.connect(e1b.synthFreq);
                if(lfoState.routing.engine1SamplerTranspose) lfoOutputGain.connect(e1b.samplerTranspose);
            }
            const e2b = busses.engineModBusses.get('engine2');
            if (e2b) {
                if(lfoState.routing.engine2Vol) lfoOutputGain.connect(e2b.vol);
                if(lfoState.routing.engine2SynthFreq) lfoOutputGain.connect(e2b.synthFreq);
                if(lfoState.routing.engine2SamplerTranspose) lfoOutputGain.connect(e2b.samplerTranspose);
            }
            const e3b = busses.engineModBusses.get('engine3');
            if (e3b) {
                if(lfoState.routing.engine3Vol) lfoOutputGain.connect(e3b.vol);
                if(lfoState.routing.engine3SynthFreq) lfoOutputGain.connect(e3b.synthFreq);
                if(lfoState.routing.engine3SamplerTranspose) lfoOutputGain.connect(e3b.samplerTranspose);
            }
        });
    }, [lfoStates, isInitialized]);

    // Master Effects Chain
    useEffect(() => {
        if (!audioContextRef.current.audioContext || !isInitialized || !globalFilterNodeRef.current || !audioContextRef.current.masterGain || !masterAnalyserRef.current || !splitterRef.current || !leftAnalyserRef.current || !rightAnalyserRef.current) return;
        const { audioContext, masterGain } = audioContextRef.current;
        const filterNode = globalFilterNodeRef.current;
        const masterAnalyser = masterAnalyserRef.current;
        const leftAnalyser = leftAnalyserRef.current;
        const rightAnalyser = rightAnalyserRef.current;
        const splitter = splitterRef.current;

        // Disconnect previous chain
        let lastNode: AudioNode = filterNode;
        lastNode.disconnect();

        // Clear old nodes
        masterEffectsChainRef.current.forEach(node => {
            if ('disconnect' in node) node.disconnect();
        });
        masterEffectsChainRef.current = [];

        // Build new chain
        masterEffects.forEach(effect => {
            if (!effect.enabled) return;

            let effectNode: AudioNode | null = null;
            switch(effect.type) {
                case 'distortion':
                    const distortion = audioContext.createWaveShaper();
                    const mode = effect.params.distortion?.mode ?? 'overdrive';
                    const amount = effect.params.distortion?.amount ?? 0.5;
                    const n_samples = 44100;
                    const curve = new Float32Array(n_samples);

                    switch (mode) {
                        case 'overdrive': {
                            const k = amount * 100;
                            const deg = Math.PI / 180;
                            for (let i = 0; i < n_samples; ++i) {
                                const x = i * 2 / n_samples - 1;
                                curve[i] = (3 + k) * x * 20 * deg / (Math.PI + k * Math.abs(x));
                            }
                            break;
                        }
                        case 'soft clip': {
                            const k = Math.max(amount, 0.01) * 5;
                            for (let i = 0; i < n_samples; i++) {
                                const x = i * 2 / n_samples - 1;
                                curve[i] = Math.tanh(x * k);
                            }
                            break;
                        }
                        case 'hard clip': {
                            const threshold = 1.0 - amount;
                            for (let i = 0; i < n_samples; i++) {
                                const x = i * 2 / n_samples - 1;
                                curve[i] = Math.max(-threshold, Math.min(x, threshold));
                            }
                            break;
                        }
                        case 'foldback': {
                            const threshold = 1.0 - (amount * 0.99);
                            for (let i = 0; i < n_samples; i++) {
                                const x = i * 2 / n_samples - 1;
                                if (x > threshold) {
                                    curve[i] = threshold - (x - threshold);
                                } else if (x < -threshold) {
                                    curve[i] = -threshold - (x + threshold);
                                } else {
                                    curve[i] = x;
                                }
                            }
                            break;
                        }
                    }
                    distortion.curve = curve;
                    distortion.oversample = '4x';
                    effectNode = distortion;
                    break;
                case 'delay':
                    const delay = audioContext.createDelay(2.0);
                    const feedback = audioContext.createGain();
                    const mix = audioContext.createGain();
                    
                    delay.delayTime.value = effect.params.delay?.time ?? 0.5;
                    feedback.gain.value = effect.params.delay?.feedback ?? 0.5;
                    mix.gain.value = effect.params.delay?.mix ?? 0.5;

                    const dry = audioContext.createGain();
                    dry.gain.value = 1.0 - mix.gain.value;

                    lastNode.connect(delay);
                    lastNode.connect(dry);
                    delay.connect(feedback).connect(delay);
                    delay.connect(mix);

                    const wetDryMixer = audioContext.createGain();
                    dry.connect(wetDryMixer);
                    mix.connect(wetDryMixer);
                    
                    effectNode = wetDryMixer;
                    masterEffectsChainRef.current.push(delay, feedback, mix, dry);
                    break;
                case 'reverb':
                    const decay = effect.params.reverb?.decay ?? 2;
                    const mixValue = effect.params.reverb?.mix ?? 0.5;
                    const reverb = audioContext.createConvolver();
                    
                    const rate = audioContext.sampleRate;
                    const length = rate * decay;
                    const impulse = audioContext.createBuffer(2, length, rate);
                    const impulseL = impulse.getChannelData(0);
                    const impulseR = impulse.getChannelData(1);

                    for (let i = 0; i < length; i++) {
                        impulseL[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 2.5);
                        impulseR[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 2.5);
                    }
                    reverb.buffer = impulse;

                    const reverbMix = audioContext.createGain();
                    reverbMix.gain.value = mixValue;
                    const reverbDry = audioContext.createGain();
                    reverbDry.gain.value = 1 - mixValue;
                    
                    lastNode.connect(reverb);
                    lastNode.connect(reverbDry);

                    const reverbMixer = audioContext.createGain();
                    reverb.connect(reverbMix).connect(reverbMixer);
                    reverbDry.connect(reverbMixer);

                    effectNode = reverbMixer;
                    masterEffectsChainRef.current.push(reverb, reverbMix, reverbDry);
                    break;
            }

            if (effectNode) {
                lastNode.connect(effectNode);
                lastNode = effectNode;
                masterEffectsChainRef.current.push(effectNode);
            }
        });
        
        // Connect final node to all analysis taps and the main output gain
        lastNode.connect(masterAnalyser);
        lastNode.connect(splitter);
        splitter.connect(leftAnalyser, 0);
        splitter.connect(rightAnalyser, 1);
        lastNode.connect(masterGain);

    }, [masterEffects, isInitialized]);

  return { isInitialized, initializeAudio, currentStep, loadSample, engineNodesRef, masterAnalyserRef, leftAnalyserRef, rightAnalyserRef };
};

// --- Morphing Types ---
interface MasterFilterState {
    cutoff: number;
    resonance: number;
    type: FilterType;
}
interface MorphSnapshot {
    engines: EngineState[];
    lfos: LFOState[];
    filter: MasterFilterState;
    effects: MasterEffect[];
}
interface MorphState {
    isActive: boolean;
    duration: number; // in steps
    progress: number; // in steps
    start: MorphSnapshot | null;
    target: MorphSnapshot | null;
}


const App = () => {
  const [isReady, setIsReady] = useState(false);
  const [masterVolume, setMasterVolume] = useState(0.7);
  const [bpm, setBpm] = useState(120);
  const [globalFilterCutoff, setGlobalFilterCutoff] = useState(12000);
  const [globalFilterResonance, setGlobalFilterResonance] = useState(1);
  const [globalFilterType, setGlobalFilterType] = useState<FilterType>('lowpass');
  const [harmonicTuningSystem, setHarmonicTuningSystem] = useState<TuningSystem>('440_ET');
  const [customTuning, setCustomTuning] = useState<CustomTuning | null>(null);
  const [bottomTab, setBottomTab] = useState<'lfos' | 'matrix'>('lfos');

  
  const createInitialLFOState = (id: string, name: string): LFOState => ({
    id,
    name,
    rate: 5,
    depth: 0.5,
    shape: 'sine',
    sync: false,
    syncRate: '1/4',
    routing: {
        filterCutoff: false,
        filterResonance: false,
        engine1Vol: false,
        engine1SynthFreq: false,
        engine1SamplerTranspose: false,
        engine2Vol: false,
        engine2SynthFreq: false,
        engine2SamplerTranspose: false,
        engine3Vol: false,
        engine3SynthFreq: false,
        engine3SamplerTranspose: false,
    }
  });

  const [lfoStates, setLfoStates] = useState<LFOState[]>([
    createInitialLFOState('lfo1', 'LFO 1'),
    createInitialLFOState('lfo2', 'LFO 2'),
    createInitialLFOState('lfo3', 'LFO 3'),
  ]);

  const [engineStates, setEngineStates] = useState<EngineState[]>([
    { id: 'engine1', name: 'Engine 1', sequencerEnabled: true, sequencerSteps: 16, sequencerPulses: 4, sequencerRotate: 0, effects: { distortion: 0, delayTime: 0, delayFeedback: 0 }, synth: { enabled: true, volume: 0.7, frequency: 440, oscillatorType: 'sine', solfeggioFrequency: '' }, noise: { enabled: false, volume: 0.5, noiseType: 'white' }, sampler: { enabled: false, volume: 1, sampleName: null, transpose: 0 }},
    { id: 'engine2', name: 'Engine 2', sequencerEnabled: true, sequencerSteps: 12, sequencerPulses: 3, sequencerRotate: 0, effects: { distortion: 0, delayTime: 0, delayFeedback: 0 }, synth: { enabled: false, volume: 0.7, frequency: 220, oscillatorType: 'square', solfeggioFrequency: '' }, noise: { enabled: true, volume: 0.1, noiseType: 'pink' }, sampler: { enabled: false, volume: 1, sampleName: null, transpose: 0 }},
    { id: 'engine3', name: 'Engine 3', sequencerEnabled: true, sequencerSteps: 7, sequencerPulses: 2, sequencerRotate: 0, effects: { distortion: 0, delayTime: 0, delayFeedback: 0 }, synth: { enabled: false, volume: 0.7, frequency: 880, oscillatorType: 'sawtooth', solfeggioFrequency: '' }, noise: { enabled: false, volume: 0.5, noiseType: 'brown' }, sampler: { enabled: true, volume: 1, sampleName: null, transpose: 0 }}
  ]);
  const [isTransportPlaying, setIsTransportPlaying] = useState(false);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [masterEffects, setMasterEffects] = useState<MasterEffect[]>([]);

  // Morphing State
  const [isMorphEnabled, setIsMorphEnabled] = useState(false);
  const [morphDuration, setMorphDuration] = useState(16);
  const [morph, setMorph] = useState<MorphState>({
      isActive: false,
      duration: 16,
      progress: 0,
      start: null,
      target: null,
  });


  const { isInitialized, initializeAudio, currentStep, loadSample, engineNodesRef, masterAnalyserRef, leftAnalyserRef, rightAnalyserRef } = useAudio(
    engineStates,
    setEngineStates,
    masterVolume,
    globalFilterCutoff,
    globalFilterResonance,
    globalFilterType,
    lfoStates,
    masterEffects,
    bpm,
    isTransportPlaying,
  );
  
  const cancelMorph = useCallback(() => {
    if (morph.isActive) {
        setMorph(prev => ({ ...prev, isActive: false, progress: 0, start: null, target: null }));
    }
  }, [morph.isActive]);

  const handleEngineUpdate = (engineId: string, updates: Partial<EngineState>) => {
    cancelMorph();
    setEngineStates(prev => prev.map(e => e.id === engineId ? { ...e, ...updates } : e));
  };
  
  const handleEngineLayerUpdate = <K extends keyof Omit<EngineState, 'id' | 'name'>>(
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
        if (lfo.id !== lfoId) {
          return lfo;
        }

        const newLfo = { ...lfo, ...updates };
        if (updates.routing) {
          newLfo.routing = { ...lfo.routing, ...updates.routing };
        }
        return newLfo;
      })
    );
  };
  
  const handleLoadCustomTuning = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const result = JSON.parse(e.target?.result as string);
            if (result.frequencies && Array.isArray(result.frequencies) && result.frequencies.every(f => typeof f === 'number')) {
                const name = result.name || file.name.replace('.json', '');
                setCustomTuning({ name, frequencies: result.frequencies });
                setHarmonicTuningSystem('custom');
            } else {
                alert('Invalid tuning file format. Must be a JSON with a "frequencies" array.');
            }
        } catch (error) {
            alert('Error parsing tuning file.');
            console.error(error);
        }
    };
    reader.readAsText(file);
  };


  const wrappedSetMasterVolume = (v: number) => { cancelMorph(); setMasterVolume(v); };
  const wrappedSetGlobalFilterCutoff = (v: number) => { cancelMorph(); setGlobalFilterCutoff(v); };
  const wrappedSetGlobalFilterResonance = (v: number) => { cancelMorph(); setGlobalFilterResonance(v); };
  const wrappedSetGlobalFilterType = (t: FilterType) => { cancelMorph(); setGlobalFilterType(t); };
  const wrappedSetMasterEffects = (effects: React.SetStateAction<MasterEffect[]>) => { cancelMorph(); setMasterEffects(effects); };


  const handleRandomize = useCallback((mode: RandomizeMode, scope: 'global' | string) => {
      
      const createFullTargetState = (partialUpdate: Partial<MorphSnapshot>): MorphSnapshot => {
          const currentState = {
              engines: engineStates,
              lfos: lfoStates,
              filter: { cutoff: globalFilterCutoff, resonance: globalFilterResonance, type: globalFilterType },
              effects: masterEffects
          };
          const targetState = JSON.parse(JSON.stringify(currentState));
          
          if(partialUpdate.engines) {
             partialUpdate.engines.forEach(updatedEngine => {
                const index = targetState.engines.findIndex((e: EngineState) => e.id === updatedEngine.id);
                if (index !== -1) targetState.engines[index] = updatedEngine;
             });
          }
          if(partialUpdate.lfos) {
              partialUpdate.lfos.forEach(updatedLfo => {
                const index = targetState.lfos.findIndex((l: LFOState) => l.id === updatedLfo.id);
                if (index !== -1) targetState.lfos[index] = updatedLfo;
             });
          }
          if(partialUpdate.filter) {
              targetState.filter = partialUpdate.filter;
          }
           if(partialUpdate.effects) {
              partialUpdate.effects.forEach(updatedEffect => {
                const index = targetState.effects.findIndex((ef: MasterEffect) => ef.id === updatedEffect.id);
                if (index !== -1) targetState.effects[index] = updatedEffect;
             });
          }
          
          return targetState;
      };

      // --- Randomization Generation Functions ---
      const randomizeEngine = (engine: EngineState, currentBpm: number): EngineState => {
          const newEngine = JSON.parse(JSON.stringify(engine));
          
          if(mode === 'chaos') {
              newEngine.sequencerEnabled = getRandomBool(0.9);
              newEngine.sequencerSteps = getRandomInt(4, 32);
              newEngine.sequencerPulses = getRandomInt(1, newEngine.sequencerSteps);
              newEngine.sequencerRotate = getRandomInt(0, newEngine.sequencerSteps - 1);
              newEngine.synth.enabled = getRandomBool(0.8);
              newEngine.synth.volume = getRandom(0.2, 0.8);
              newEngine.synth.frequency = getRandom(80, 1000);
              newEngine.synth.oscillatorType = getRandomElement(oscillatorTypes);
              newEngine.synth.solfeggioFrequency = '';
              newEngine.noise.enabled = getRandomBool(0.4);
              newEngine.noise.volume = getRandom(0.01, 0.3);
              newEngine.noise.noiseType = getRandomElement(noiseTypes);
              newEngine.sampler.enabled = getRandomBool(0.3);
              newEngine.sampler.transpose = getRandomInt(-12, 12);
              newEngine.sampler.volume = getRandom(0.5, 1.0);
          } else if (mode === 'harmonic') {
              const rootFreq = getRandom(110, 220); // A2 to A3
              switch(harmonicTuningSystem) {
                case '440_ET':
                case '432_ET':
                    const baseA4 = harmonicTuningSystem === '432_ET' ? 432 : 440;
                    const scale = musicalScales[getRandomElement(Object.keys(musicalScales) as ScaleName[])];
                    const rootMidi = getRandomInt(40, 64);
                    const noteMidi = rootMidi + getRandomElement(scale);
                    newEngine.synth.frequency = midiToFreq(noteMidi, baseA4);
                    break;
                case 'just_intonation':
                    newEngine.synth.frequency = rootFreq * getRandomElement(justIntonationRatios);
                    break;
                case 'pythagorean':
                    newEngine.synth.frequency = rootFreq * getRandomElement(pythagoreanRatios);
                    break;
                case 'solfeggio':
                     const solfeggioFreq = getRandomElement(solfeggioFrequencies);
                     newEngine.synth.frequency = solfeggioFreq;
                     newEngine.synth.solfeggioFrequency = String(solfeggioFreq);
                     break;
                case 'custom':
                    if (customTuning?.frequencies?.length) {
                        newEngine.synth.frequency = getRandomElement(customTuning.frequencies);
                    }
                    break;
              }
              newEngine.sampler.transpose = getRandomElement([0, 3, 5, 7, 12, -5, -7, -12]);
              newEngine.synth.volume = getRandom(0.5, 0.8);
              newEngine.noise.volume = getRandom(0, 0.1); // Less noise in harmonic mode
          } else if (mode === 'rhythmic') {
              newEngine.sequencerSteps = getRandomElement([8, 12, 16, 24, 32]);
              newEngine.sequencerPulses = Math.min(newEngine.sequencerSteps, getRandomElement([2,3,4,5,7,8]));
              newEngine.sequencerRotate = getRandomInt(0, newEngine.sequencerSteps - 1);
          }
          return newEngine;
      };

      const randomizeLfo = (lfo: LFOState, currentBpm: number): LFOState => {
          const newLfo = JSON.parse(JSON.stringify(lfo));
          if (mode === 'chaos') {
              newLfo.rate = getRandom(0.1, 20);
              newLfo.depth = getRandom(0, 1);
              newLfo.shape = getRandomElement(lfoShapes);
              newLfo.sync = getRandomBool(0.3);
              newLfo.syncRate = getRandomElement(lfoSyncRates);
              Object.keys(newLfo.routing).forEach(key => {
                  newLfo.routing[key as keyof typeof newLfo.routing] = getRandomBool(0.2);
              });
          } else if (mode === 'harmonic') {
              newLfo.rate = getRandom(0.2, 5); // Slower, more musical rates
              newLfo.depth = getRandom(0.1, 0.6);
              newLfo.shape = getRandomElement(['sine', 'triangle']);
          } else if (mode === 'rhythmic') {
              newLfo.sync = true;
              newLfo.syncRate = getRandomElement(lfoSyncRates);
              newLfo.shape = getRandomElement(['square', 'sawtooth', 'ramp']);
          }
          return newLfo;
      };

      const randomizeMasterFilter = (): MasterFilterState => {
          if (mode === 'chaos') {
              return {
                  type: getRandomElement(filterTypes),
                  cutoff: getRandom(500, 15000),
                  resonance: getRandom(0, 15),
              };
          } else { // Harmonic and Rhythmic
              return {
                  type: getRandomElement(['lowpass', 'highpass']),
                  cutoff: getRandom(2000, 10000),
                  resonance: getRandom(0.5, 5),
              };
          }
      };

      const randomizeEffect = (effect: MasterEffect, currentBpm: number): MasterEffect => {
          const newEffect = JSON.parse(JSON.stringify(effect));
          switch (newEffect.type) {
              case 'distortion':
                  newEffect.params.distortion.mode = getRandomElement(distortionModes);
                  newEffect.params.distortion.amount = (mode === 'harmonic') ? getRandom(0, 0.4) : getRandom(0, 1);
                  break;
              case 'delay':
                  if (mode === 'rhythmic') {
                      const beatDuration = 60 / currentBpm;
                      const rateStr = getRandomElement(delaySyncRates);
                      let multiplier = 1 / parseFloat(rateStr.replace('d',''));
                      if (rateStr.includes('d')) multiplier *= 1.5;
                      newEffect.params.delay.time = Math.min(1.0, beatDuration * multiplier);
                  } else {
                      newEffect.params.delay.time = getRandom(0.05, 1);
                  }
                  newEffect.params.delay.feedback = (mode === 'harmonic') ? getRandom(0.1, 0.5) : getRandom(0.1, 0.9);
                  newEffect.params.delay.mix = getRandom(0.1, 0.6);
                  break;
              case 'reverb':
                  newEffect.params.reverb.decay = getRandom(0.5, 8);
                  newEffect.params.reverb.mix = getRandom(0.1, 0.7);
                  break;
          }
          return newEffect;
      }
      
      let partialUpdate: Partial<MorphSnapshot> = {};

      if (scope === 'global') {
          partialUpdate.engines = engineStates.map(e => randomizeEngine(e, bpm));
          partialUpdate.lfos = lfoStates.map(l => randomizeLfo(l, bpm));
          partialUpdate.filter = randomizeMasterFilter();
          partialUpdate.effects = masterEffects.map(ef => randomizeEffect(ef, bpm));
      } else if (scope.startsWith('engine')) {
          partialUpdate.engines = [randomizeEngine(engineStates.find(e => e.id === scope)!, bpm)];
      } else if (scope.startsWith('lfo')) {
          partialUpdate.lfos = [randomizeLfo(lfoStates.find(l => l.id === scope)!, bpm)];
      } else if (scope === 'masterFilter') {
          partialUpdate.filter = randomizeMasterFilter();
      } else { // Must be an effect
          partialUpdate.effects = [randomizeEffect(masterEffects.find(ef => ef.id === scope)!, bpm)];
      }
      

      if (isMorphEnabled) {
          cancelMorph();
          const startSnapshot = {
              engines: engineStates, lfos: lfoStates,
              filter: { cutoff: globalFilterCutoff, resonance: globalFilterResonance, type: globalFilterType },
              effects: masterEffects,
          };
          const targetSnapshot = createFullTargetState(partialUpdate);
          setMorph({
              isActive: true, progress: 0, duration: morphDuration,
              start: startSnapshot, target: targetSnapshot
          });
      } else {
          if (partialUpdate.engines) setEngineStates(prev => prev.map(e => partialUpdate.engines!.find(u => u.id === e.id) || e));
          if (partialUpdate.lfos) setLfoStates(prev => prev.map(l => partialUpdate.lfos!.find(u => u.id === l.id) || l));
          if (partialUpdate.filter) {
              setGlobalFilterCutoff(partialUpdate.filter.cutoff);
              setGlobalFilterResonance(partialUpdate.filter.resonance);
              setGlobalFilterType(partialUpdate.filter.type);
          }
          if (partialUpdate.effects) setMasterEffects(prev => prev.map(ef => partialUpdate.effects!.find(u => u.id === ef.id) || ef));
      }


  }, [bpm, cancelMorph, engineStates, lfoStates, globalFilterCutoff, globalFilterResonance, globalFilterType, masterEffects, isMorphEnabled, morphDuration, harmonicTuningSystem, customTuning]);
  
  // Morphing effect
  useEffect(() => {
    if (!morph.isActive || !isTransportPlaying || !morph.start || !morph.target) {
      if (morph.isActive) { // If transport stopped during morph, finalize it
        setMorph(prev => ({...prev, isActive: false, progress: 0, start: null, target: null}));
      }
      return;
    };

    const newProgress = morph.progress + 1;
    if (newProgress > morph.duration) {
      // Finalize state to target
       setEngineStates(morph.target.engines);
       setLfoStates(morph.target.lfos);
       setGlobalFilterCutoff(morph.target.filter.cutoff);
       setGlobalFilterResonance(morph.target.filter.resonance);
       setGlobalFilterType(morph.target.filter.type);
       setMasterEffects(morph.target.effects);
       setMorph(prev => ({ ...prev, isActive: false, progress: 0, start: null, target: null }));
       return;
    }

    const t = newProgress / morph.duration;
    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

    // Interpolate Engines
    const interpolatedEngines = morph.start.engines.map((startEngine, i) => {
        const targetEngine = morph.target!.engines[i];
        if (!targetEngine) return startEngine;
        return {
            ...targetEngine,
            sequencerSteps: Math.round(lerp(startEngine.sequencerSteps, targetEngine.sequencerSteps, t)),
            sequencerPulses: Math.round(lerp(startEngine.sequencerPulses, targetEngine.sequencerPulses, t)),
            sequencerRotate: Math.round(lerp(startEngine.sequencerRotate, targetEngine.sequencerRotate, t)),
            synth: { ...targetEngine.synth,
                volume: lerp(startEngine.synth.volume, targetEngine.synth.volume, t),
                frequency: lerp(startEngine.synth.frequency, targetEngine.synth.frequency, t),
            },
            noise: { ...targetEngine.noise,
                volume: lerp(startEngine.noise.volume, targetEngine.noise.volume, t),
            },
            sampler: { ...targetEngine.sampler,
                volume: lerp(startEngine.sampler.volume, targetEngine.sampler.volume, t),
                transpose: lerp(startEngine.sampler.transpose, targetEngine.sampler.transpose, t),
            },
        };
    });
    setEngineStates(interpolatedEngines);

    // Interpolate LFOs
    const interpolatedLFOs = morph.start.lfos.map((startLfo, i) => {
        const targetLfo = morph.target!.lfos[i];
        if (!targetLfo) return startLfo;
        return {
            ...targetLfo,
            rate: lerp(startLfo.rate, targetLfo.rate, t),
            depth: lerp(startLfo.depth, targetLfo.depth, t),
        };
    });
    setLfoStates(interpolatedLFOs);

    // Interpolate Master Filter
    setGlobalFilterCutoff(lerp(morph.start.filter.cutoff, morph.target.filter.cutoff, t));
    setGlobalFilterResonance(lerp(morph.start.filter.resonance, morph.target.filter.resonance, t));
    
    // Interpolate Master Effects
    const interpolatedEffects = morph.start.effects.map((startEffect, i) => {
        const targetEffect = morph.target!.effects.find(ef => ef.id === startEffect.id);
        if(!targetEffect) return startEffect;
        const newParams = { ...targetEffect.params };
        // FIX: Corrected if condition to check both start and target effect params to ensure type safety.
        if(startEffect.type === 'distortion' && startEffect.params.distortion && targetEffect.params.distortion) {
            // FIX: Replaced spread with explicit properties to avoid potential type inference issues.
            newParams.distortion = { 
                mode: targetEffect.params.distortion.mode,
                amount: lerp(startEffect.params.distortion.amount, targetEffect.params.distortion.amount, t)
            };
        }
        // FIX: Corrected if condition to check both start and target effect params to ensure type safety.
        if(startEffect.type === 'delay' && startEffect.params.delay && targetEffect.params.delay) {
            newParams.delay = {
                time: lerp(startEffect.params.delay.time, targetEffect.params.delay.time, t),
                feedback: lerp(startEffect.params.delay.feedback, targetEffect.params.delay.feedback, t),
                mix: lerp(startEffect.params.delay.mix, targetEffect.params.delay.mix, t),
            };
        }
        // FIX: Corrected if condition to check both start and target effect params to ensure type safety.
        if(startEffect.type === 'reverb' && startEffect.params.reverb && targetEffect.params.reverb) {
             newParams.reverb = {
                decay: lerp(startEffect.params.reverb.decay, targetEffect.params.reverb.decay, t),
                mix: lerp(startEffect.params.reverb.mix, targetEffect.params.reverb.mix, t),
            };
        }
        return { ...targetEffect, params: newParams };
    });
    setMasterEffects(interpolatedEffects);

    setMorph(prev => ({ ...prev, progress: newProgress }));

  }, [currentStep, isTransportPlaying]);

  const handleToggleTransport = () => {
      setIsTransportPlaying(p => {
          if (!p) { // just started playing
             cancelMorph();
          }
          return !p;
      });
  };
  
  const ai = useMemo(() => process.env.API_KEY ? new GoogleGenAI({ apiKey: process.env.API_KEY }) : null, []);

  const handleIntelligentRandomize = useCallback(async (scope: 'global' | string) => {
    if (!ai) return;
    setIsAiLoading(true);

    const fullState = {
        engines: engineStates,
        lfos: lfoStates,
        masterFilter: { cutoff: globalFilterCutoff, resonance: globalFilterResonance, type: globalFilterType },
        masterEffects: masterEffects,
    };

    let prompt = `You are an expert sound designer for a polyrhythmic synthesizer. The synth's current state is: ${JSON.stringify(fullState, null, 2)}.`;
    let responseSchema: any;

    const engineSchema = {
        type: Type.OBJECT, properties: {
            sequencerEnabled: { type: Type.BOOLEAN }, sequencerSteps: { type: Type.INTEGER }, sequencerPulses: { type: Type.INTEGER }, sequencerRotate: { type: Type.INTEGER },
            // FIX: Removed spread from readonly array to fix "Spread types may only be created from object types" error.
            synth: { type: Type.OBJECT, properties: { enabled: { type: Type.BOOLEAN }, volume: { type: Type.NUMBER }, frequency: { type: Type.NUMBER }, oscillatorType: { type: Type.STRING, enum: oscillatorTypes }}},
            // FIX: Removed spread from readonly array to fix "Spread types may only be created from object types" error.
            noise: { type: Type.OBJECT, properties: { enabled: { type: Type.BOOLEAN }, volume: { type: Type.NUMBER }, noiseType: { type: Type.STRING, enum: noiseTypes }}},
            sampler: { type: Type.OBJECT, properties: { enabled: { type: Type.BOOLEAN }, volume: { type: Type.NUMBER }, transpose: { type: Type.INTEGER }}},
        }
    };
     const lfoSchema = {
        type: Type.OBJECT, properties: {
            // FIX: Removed spread from readonly array to fix "Spread types may only be created from object types" error.
            rate: { type: Type.NUMBER }, depth: { type: Type.NUMBER }, shape: { type: Type.STRING, enum: lfoShapes }, sync: { type: Type.BOOLEAN }, syncRate: { type: Type.STRING, enum: lfoSyncRates },
            routing: { type: Type.OBJECT, properties: {
                filterCutoff: { type: Type.BOOLEAN }, filterResonance: { type: Type.BOOLEAN }, engine1Vol: { type: Type.BOOLEAN }, engine1SynthFreq: { type: Type.BOOLEAN }, engine1SamplerTranspose: { type: Type.BOOLEAN },
                engine2Vol: { type: Type.BOOLEAN }, engine2SynthFreq: { type: Type.BOOLEAN }, engine2SamplerTranspose: { type: Type.BOOLEAN },
                engine3Vol: { type: Type.BOOLEAN }, engine3SynthFreq: { type: Type.BOOLEAN }, engine3SamplerTranspose: { type: Type.BOOLEAN },
            }}
        }
    };
    // FIX: Removed spread from readonly array to fix "Spread types may only be created from object types" error.
    const filterSchema = { type: Type.OBJECT, properties: { cutoff: { type: Type.NUMBER }, resonance: { type: Type.NUMBER }, type: { type: Type.STRING, enum: filterTypes }}};
    // FIX: Removed spread from readonly array to fix "Spread types may only be created from object types" error.
    const distortionSchema = { type: Type.OBJECT, properties: { mode: { type: Type.STRING, enum: distortionModes }, amount: { type: Type.NUMBER }}};
    const delaySchema = { type: Type.OBJECT, properties: { time: { type: Type.NUMBER }, feedback: { type: Type.NUMBER }, mix: { type: Type.NUMBER }}};
    const reverbSchema = { type: Type.OBJECT, properties: { decay: { type: Type.NUMBER }, mix: { type: Type.NUMBER }}};

    if (scope === 'global') {
        prompt += `\nGenerate a completely new, creative, and musically coherent patch that is an interesting variation of the current patch. Respond ONLY with a JSON object for the entire synth state.`;
        responseSchema = {
            type: Type.OBJECT,
            properties: {
                engines: { type: Type.ARRAY, items: engineSchema },
                lfos: { type: Type.ARRAY, items: lfoSchema },
                masterFilter: filterSchema
            }
        }
    } else if (scope.startsWith('engine')) {
        prompt += `\nGenerate a new, creative, and musically coherent set of parameters ONLY for the engine with id "${scope}". The new parameters should complement the rest of the patch. Respond ONLY with a JSON object for the modified engine.`;
        responseSchema = engineSchema;
    } else if (scope.startsWith('lfo')) {
        prompt += `\nGenerate a new, creative, and musically coherent set of parameters ONLY for the LFO with id "${scope}". The new parameters should create interesting modulations that work with the rest of the patch. Respond ONLY with a JSON object for the modified LFO.`;
        responseSchema = lfoSchema;
    } else if (scope === 'masterFilter') {
        prompt += `\nGenerate a new, creative, and musically coherent set of parameters ONLY for the Master Filter. The new parameters should complement the rest of the patch. Respond ONLY with a JSON object for the modified filter.`;
        responseSchema = filterSchema;
    } else if (scope.startsWith('distortion')) {
        prompt += `\nGenerate new parameters for the distortion effect (id: ${scope}). Respond with ONLY a JSON object.`;
        responseSchema = distortionSchema;
    } else if (scope.startsWith('delay')) {
        prompt += `\nGenerate new parameters for the delay effect (id: ${scope}). Respond with ONLY a JSON object.`;
        responseSchema = delaySchema;
    } else if (scope.startsWith('reverb')) {
        prompt += `\nGenerate new parameters for the reverb effect (id: ${scope}). Respond with ONLY a JSON object.`;
        responseSchema = reverbSchema;
    }

    try {
        const response = await ai.models.generateContent({ model: "gemini-2.5-flash", contents: prompt, config: { responseMimeType: "application/json", responseSchema } });
        const update = JSON.parse(response.text.trim());

        const startSnapshot: MorphSnapshot = {
            engines: engineStates, lfos: lfoStates,
            filter: { cutoff: globalFilterCutoff, resonance: globalFilterResonance, type: globalFilterType },
            effects: masterEffects
        };
        const targetSnapshot: MorphSnapshot = JSON.parse(JSON.stringify(startSnapshot));

        if (isMorphEnabled) cancelMorph();

        if (scope === 'global') {
            if (update.engines) targetSnapshot.engines = update.engines;
            if (update.lfos) targetSnapshot.lfos = update.lfos;
            if (update.masterFilter) targetSnapshot.filter = update.masterFilter;
        } else if (scope.startsWith('engine')) {
            const index = targetSnapshot.engines.findIndex((e: EngineState) => e.id === scope);
            if(index !== -1) targetSnapshot.engines[index] = { ...targetSnapshot.engines[index], ...update };
        } else if (scope.startsWith('lfo')) {
            const index = targetSnapshot.lfos.findIndex((l: LFOState) => l.id === scope);
            if(index !== -1) targetSnapshot.lfos[index] = { ...targetSnapshot.lfos[index], ...update };
        } else if (scope === 'masterFilter') {
            targetSnapshot.filter = { ...targetSnapshot.filter, ...update };
        } else { // Handle effects
            const index = targetSnapshot.effects.findIndex((ef: MasterEffect) => ef.id === scope);
            if(index !== -1) {
                const effect = targetSnapshot.effects[index];
                if (typeof update === 'object' && update !== null) {
                    switch (effect.type) {
                        case 'distortion':
                            effect.params.distortion = { ...(effect.params.distortion || {}), ...(update as object) };
                            break;
                        case 'delay':
                            effect.params.delay = { ...(effect.params.delay || {}), ...(update as object) };
                            break;
                        case 'reverb':
                            effect.params.reverb = { ...(effect.params.reverb || {}), ...(update as object) };
                            break;
                    }
                }
            }
        }
        
        if (isMorphEnabled) {
            setMorph({ isActive: true, progress: 0, duration: morphDuration, start: startSnapshot, target: targetSnapshot });
        } else {
             if (targetSnapshot.engines) setEngineStates(targetSnapshot.engines);
             if (targetSnapshot.lfos) setLfoStates(targetSnapshot.lfos);
             if (targetSnapshot.filter) {
                setGlobalFilterCutoff(targetSnapshot.filter.cutoff);
                setGlobalFilterResonance(targetSnapshot.filter.resonance);
                setGlobalFilterType(targetSnapshot.filter.type);
             }
             if (targetSnapshot.effects) setMasterEffects(targetSnapshot.effects);
        }

    } catch(e) {
        console.error("AI Generation Error:", e);
    } finally {
        setIsAiLoading(false);
    }
  }, [ai, engineStates, lfoStates, globalFilterCutoff, globalFilterResonance, globalFilterType, masterEffects, isMorphEnabled, morphDuration]);

  if (!isReady) {
    return (
      <div className="init-overlay">
        <button onClick={() => { initializeAudio(); setIsReady(true); }}>Start Synthesizer</button>
      </div>
    );
  }

  const masterAnalyser = masterAnalyserRef.current;
  const leftAnalyser = leftAnalyserRef.current;
  const rightAnalyser = rightAnalyserRef.current;

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
          <GenerativeTools
              onRandomize={handleRandomize}
              onIntelligentRandomize={handleIntelligentRandomize}
              isMorphEnabled={isMorphEnabled}
              setIsMorphEnabled={setIsMorphEnabled}
              morphDuration={morphDuration}
              setMorphDuration={setMorphDuration}
              harmonicTuningSystem={harmonicTuningSystem}
              setHarmonicTuningSystem={setHarmonicTuningSystem}
              onLoadCustomTuning={handleLoadCustomTuning}
              customTuning={customTuning}
          />
          <div className="master-visualizer-container">
                {leftAnalyser && <div className="visualizer-wrapper"><span className="visualizer-label">L</span><Visualizer analyserNode={leftAnalyser} type="waveform" /></div>}
                {rightAnalyser && <div className="visualizer-wrapper"><span className="visualizer-label">R</span><Visualizer analyserNode={rightAnalyser} type="waveform" /></div>}
                {masterAnalyser && <div className="visualizer-wrapper"><span className="visualizer-label">M</span><Visualizer analyserNode={masterAnalyser} type="waveform" /></div>}
          </div>
           <MasterFilterControls
              globalFilterCutoff={globalFilterCutoff}
              setGlobalFilterCutoff={wrappedSetGlobalFilterCutoff}
              globalFilterResonance={globalFilterResonance}
              setGlobalFilterResonance={wrappedSetGlobalFilterResonance}
              globalFilterType={globalFilterType}
              setGlobalFilterType={wrappedSetGlobalFilterType}
              onRandomize={handleRandomize}
              onIntelligentRandomize={handleIntelligentRandomize}
          />
          <MasterEffects
              effects={masterEffects}
              setEffects={wrappedSetMasterEffects}
              onRandomize={handleRandomize}
              onIntelligentRandomize={handleIntelligentRandomize}
          />
          <div className="channels-container">
            {engineStates.map(engine => (
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
          <div className="bottom-module-container">
            <div className="bottom-tab-nav">
                <button className={`bottom-tab-button ${bottomTab === 'lfos' ? 'active' : ''}`} onClick={() => setBottomTab('lfos')}>
                    LFOs
                </button>
                <button className={`bottom-tab-button ${bottomTab === 'matrix' ? 'active' : ''}`} onClick={() => setBottomTab('matrix')}>
                    Routing Matrix
                </button>
            </div>
            {bottomTab === 'lfos' && (
                <div className="lfo-grid-container">
                    {lfoStates.map((lfo) => (
                        <LFOControls
                            key={lfo.id}
                            lfoState={lfo}
                            onUpdate={(updates) => handleLfoUpdate(lfo.id, updates)}
                            onRandomize={handleRandomize}
                            onIntelligentRandomize={handleIntelligentRandomize}
                        />
                    ))}
                </div>
            )}
            {bottomTab === 'matrix' && (
                <RoutingMatrix lfoStates={lfoStates} onLfoUpdate={handleLfoUpdate} />
            )}
          </div>
        </div>
      </div>
    </>
  );
};

const container = document.getElementById('root');
const root = createRoot(container!);
root.render(<App />);
