
import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI, Type } from "@google/genai";

// --- Type Definitions ---
type OscillatorType = 'sine' | 'square' | 'sawtooth' | 'triangle';
type NoiseType = 'white' | 'pink' | 'brown';
type LFO_Shape = 'sine' | 'square' | 'sawtooth' | 'triangle' | 'ramp';
type FilterType = 'lowpass' | 'highpass' | 'bandpass' | 'notch';
type RandomizeMode = 'chaos' | 'solfeggio';
type EngineLayerType = 'synth' | 'noise' | 'sampler';

// --- Master Effects Types ---
type MasterEffectType = 'distortion' | 'delay' | 'reverb';

interface MasterEffect {
  id: string;
  type: MasterEffectType;
  enabled: boolean;
  params: {
    distortion?: { amount: number }; // 0 to 1
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
  isAiControlled: boolean;
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
        engine2Vol: boolean;
        engine3Vol: boolean;
    }
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

interface LfoRoutingBusses {
    filterCutoffModBus: GainNode;
    filterResonanceModBus: GainNode;
    engineVolModBusses: Map<string, GainNode>;
}


interface LinkStatus {
    isEnabled: boolean;
    bpm: number;
    peers: number;
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
  onLayerUpdate: <K extends keyof Omit<EngineState, 'id' | 'name' | 'isAiControlled'>>(
    engineId: string,
    layer: K,
    updates: Partial<EngineState[K]>
  ) => void;
  onLoadSample: (engineId: string, file: File) => void;
  onRandomize: (mode: RandomizeMode) => void;
  onToggleAiControl: (engineId: string) => void;
  analyserNode?: AnalyserNode;
  currentStep: number;
  isTransportPlaying: boolean;
}

interface TopBarProps {
    masterVolume: number;
    setMasterVolume: (volume: number) => void;
    linkStatus: LinkStatus;
    toggleLink: () => void;
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
    onRandomize: (mode: RandomizeMode) => void;
}

interface LFOControlsProps {
    lfoState: LFOState;
    onUpdate: (updates: Partial<LFOState>) => void;
    linkStatus: LinkStatus;
    onRandomize: (mode: RandomizeMode) => void;
}

interface GenerativeToolsProps {
    onRandomize: (mode: RandomizeMode, scope: 'global' | 'master' | 'lfo' | string) => void;
    isAiJamEnabled: boolean;
    setIsAiJamEnabled: (enabled: boolean) => void;
    aiJamInterval: number;
    setAiJamInterval: (interval: number) => void;
    isAiJamLoading: boolean;
}

interface MasterEffectsProps {
    effects: MasterEffect[];
    setEffects: React.Dispatch<React.SetStateAction<MasterEffect[]>>;
}

interface EffectModuleProps {
    effect: MasterEffect;
    onUpdate: (id: string, params: MasterEffect['params']) => void;
    onRemove: (id: string) => void;
    onToggle: (id: string) => void;
    onDragStart: (e: React.DragEvent<HTMLDivElement>, effect: MasterEffect) => void;
    onDragEnter: (e: React.DragEvent<HTMLDivElement>, effect: MasterEffect) => void;
    onDragEnd: (e: React.DragEvent<HTMLDivElement>) => void;
    isDragging: boolean;
    isDragOver: boolean;
}

declare global {
  interface Window {
    AbletonLink: any;
  }
}

// --- Constants ---
const solfeggioFrequencies = [
  { value: 174, label: '174 Hz - Foundation' }, { value: 285, label: '285 Hz - Restoration' },
  { value: 396, label: '396 Hz - Liberation' }, { value: 417, label: '417 Hz - Transformation' },
  { value: 528, label: '528 Hz - Miracle' }, { value: 639, label: '639 Hz - Connection' },
  { value: 741, label: '741 Hz - Intuition' }, { value: 852, label: '852 Hz - Awakening' },
  { value: 963, label: '963 Hz - Oneness' },
];

const oscillatorTypes: OscillatorType[] = ['sine', 'square', 'sawtooth', 'triangle'];
const lfoShapes: LFO_Shape[] = ['sine', 'square', 'sawtooth', 'ramp', 'triangle'];
const filterTypes: FilterType[] = ['lowpass', 'highpass', 'bandpass', 'notch'];
const lfoSyncRates = ['1/16', '1/8', '1/4', '1/2', '1'];
const noiseTypes: NoiseType[] = ['white', 'pink', 'brown'];
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
function getRandomElement<T>(arr: readonly T[]): T {
    return arr[Math.floor(Math.random() * arr.length)];
}


// --- Components ---

const Visualizer: React.FC<VisualizerProps> = ({ analyserNode, type }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const canvasCtx = canvas.getContext('2d');
    let animationFrameId: number;

    const draw = () => {
      if (!canvasCtx) return;
      
      const { width, height } = canvas;
      canvasCtx.fillStyle = 'transparent';
      canvasCtx.fillRect(0, 0, width, height);

      if (type === 'frequency') {
        analyserNode.fftSize = 256;
        const bufferLength = analyserNode.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        analyserNode.getByteFrequencyData(dataArray);
        
        const barWidth = (width / bufferLength) * 2.5;
        let x = 0;
        for (let i = 0; i < bufferLength; i++) {
          const barHeight = dataArray[i];
          const percent = barHeight / 255;
          const hue = (i / bufferLength) * 360;
          const saturation = 100;
          const lightness = 50 + (percent * 25);
          
          canvasCtx.fillStyle = `hsl(${hue}, ${saturation}%, ${lightness}%)`;
          canvasCtx.fillRect(x, height - (percent * height), barWidth, percent * height);
          x += barWidth + 1;
        }
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
                    ctx.fillStyle = '#03dac6'; // Active step
                    ctx.arc(x, y, 5, 0, 2 * Math.PI);
                } else {
                    ctx.fillStyle = '#444'; // Inactive step
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
                ctx.fillStyle = '#ffd700';
                ctx.arc(x, y, 7, 0, 2 * Math.PI);
                ctx.strokeStyle = 'white';
                ctx.lineWidth = 2;
                ctx.stroke();
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
                
                const hue = (i / bufferLength) * 360;
                ctx.strokeStyle = `hsla(${hue}, 100%, 70%, 0.8)`;
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


const EngineControls: React.FC<EngineControlsProps> = ({ engine, onUpdate, onLayerUpdate, onLoadSample, onRandomize, onToggleAiControl, analyserNode, currentStep, isTransportPlaying }) => {
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
            <div className="layer-header">
              <h4>Synth Oscillator</h4>
              <button 
                className={`power-toggle small ${engine.synth.enabled ? 'active' : ''}`}
                onClick={() => onLayerUpdate(engine.id, 'synth', { enabled: !engine.synth.enabled })}>
                {engine.synth.enabled ? 'ON' : 'OFF'}
              </button>
            </div>
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
                      const freq = solfeggioFrequencies.find(f => f.value === +e.target.value)?.value ?? 440;
                      onLayerUpdate(engine.id, 'synth', { solfeggioFrequency: e.target.value, frequency: freq });
                  }}>
                      <option value="">Manual</option>
                      {solfeggioFrequencies.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                  </select>
              </div>
            </>}
          </div>
        );
      case 'noise':
        return (
          <div className="layer-group">
             <div className="layer-header">
              <h4>Noise Generator</h4>
              <button 
                className={`power-toggle small ${engine.noise.enabled ? 'active' : ''}`}
                onClick={() => onLayerUpdate(engine.id, 'noise', { enabled: !engine.noise.enabled })}>
                {engine.noise.enabled ? 'ON' : 'OFF'}
              </button>
            </div>
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
            <div className="layer-header">
              <h4>Sampler</h4>
              <button 
                className={`power-toggle small ${engine.sampler.enabled ? 'active' : ''}`}
                onClick={() => onLayerUpdate(engine.id, 'sampler', { enabled: !engine.sampler.enabled })}>
                {engine.sampler.enabled ? 'ON' : 'OFF'}
              </button>
            </div>
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

  return (
    <div className="control-group engine-controls">
        <div className="control-group-header">
            <h2>{engine.name}</h2>
            <div className="randomizer-buttons-group">
                <button title="Solfeggio Random" onClick={() => onRandomize('solfeggio')}>S</button>
                <button title="Chaos Random" onClick={() => onRandomize('chaos')}>C</button>
                <button
                    className={`ai-toggle ${engine.isAiControlled ? 'active' : ''}`}
                    title="Toggle AI Control"
                    onClick={() => onToggleAiControl(engine.id)}
                >
                    AI
                </button>
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

        <div className="tab-nav">
          {(['synth', 'noise', 'sampler'] as EngineLayerType[]).map(tab => (
            <button 
              key={tab} 
              className={`tab-button ${activeTab === tab ? 'active' : ''}`}
              onClick={() => setActiveTab(tab)}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>
        <div className="tab-content">
          {renderTabContent()}
        </div>
    </div>
  );
};

const TopBar: React.FC<TopBarProps> = ({
    masterVolume, setMasterVolume, linkStatus, toggleLink, setBPM, isTransportPlaying, onToggleTransport
}) => {
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
                            type="number"
                            value={linkStatus.bpm.toFixed(2)}
                            onChange={(e) => setBPM(parseFloat(e.target.value))}
                            style={{ width: '80px' }}
                            disabled={linkStatus.isEnabled}
                        />
                        <button onClick={toggleLink} className={linkStatus.isEnabled ? 'active' : ''} title={`Peers: ${linkStatus.peers}`}>
                            Link {linkStatus.isEnabled ? `(${linkStatus.peers})` : ''}
                        </button>
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
    globalFilterType, setGlobalFilterType, onRandomize
}) => {
    return (
        <div className="control-group master-filter-container">
            <div className="control-group-header">
                <h2>Master Filter</h2>
                <div className="randomizer-buttons-group">
                    <button onClick={() => onRandomize('solfeggio')}>S</button>
                    <button onClick={() => onRandomize('chaos')}>C</button>
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


const LFOControls: React.FC<LFOControlsProps> = ({ lfoState, onUpdate, linkStatus, onRandomize }) => {
    const handleRoutingChange = (target: keyof LFOState['routing'], value: boolean) => {
        onUpdate({ routing: { ...lfoState.routing, [target]: value } });
    };

    return (
        <div className="control-group lfo-controls">
            <div className="control-group-header">
                <h2>{lfoState.name}</h2>
                 <div className="randomizer-buttons-group">
                    <button onClick={() => onRandomize('solfeggio')}>S</button>
                    <button onClick={() => onRandomize('chaos')}>C</button>
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
            <div className="routing-section">
                <h4>Routing</h4>
                <div className="control-row checkbox-row">
                    <label htmlFor={`lfo-filter-cutoff-${lfoState.id}`}>Filter Cutoff</label>
                    <input type="checkbox" id={`lfo-filter-cutoff-${lfoState.id}`} checked={lfoState.routing.filterCutoff} onChange={e => handleRoutingChange('filterCutoff', e.target.checked)} />
                </div>
                 <div className="control-row checkbox-row">
                    <label htmlFor={`lfo-filter-res-${lfoState.id}`}>Filter Res</label>
                    <input type="checkbox" id={`lfo-filter-res-${lfoState.id}`} checked={lfoState.routing.filterResonance} onChange={e => handleRoutingChange('filterResonance', e.target.checked)} />
                </div>
                <div className="control-row checkbox-row">
                    <label htmlFor={`lfo-eng1vol-${lfoState.id}`}>Engine 1 Vol</label>
                    <input type="checkbox" id={`lfo-eng1vol-${lfoState.id}`} checked={lfoState.routing.engine1Vol} onChange={e => handleRoutingChange('engine1Vol', e.target.checked)} />
                </div>
                <div className="control-row checkbox-row">
                    <label htmlFor={`lfo-eng2vol-${lfoState.id}`}>Engine 2 Vol</label>
                    <input type="checkbox" id={`lfo-eng2vol-${lfoState.id}`} checked={lfoState.routing.engine2Vol} onChange={e => handleRoutingChange('engine2Vol', e.target.checked)} />
                </div>
                <div className="control-row checkbox-row">
                    <label htmlFor={`lfo-eng3vol-${lfoState.id}`}>Engine 3 Vol</label>
                    <input type="checkbox" id={`lfo-eng3vol-${lfoState.id}`} checked={lfoState.routing.engine3Vol} onChange={e => handleRoutingChange('engine3Vol', e.target.checked)} />
                </div>
            </div>
        </div>
    );
};

const EffectModule: React.FC<EffectModuleProps> = ({ effect, onUpdate, onRemove, onToggle, onDragStart, onDragEnter, onDragEnd, isDragging, isDragOver }) => {
    const handleParamChange = (param: string, value: any) => {
        onUpdate(effect.id, { ...effect.params, [effect.type]: { ...effect.params[effect.type], [param]: value } });
    };

    const renderParams = () => {
        switch (effect.type) {
            case 'distortion':
                return (
                    <div className="control-row">
                        <label>Amount</label>
                        <div className="control-value-wrapper">
                            <input type="range" min="0" max="1" step="0.01" value={effect.params.distortion?.amount ?? 0} onChange={e => handleParamChange('amount', +e.target.value)} />
                             <span>{( (effect.params.distortion?.amount ?? 0) * 100).toFixed(0)}%</span>
                        </div>
                    </div>
                );
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
            draggable
            onDragStart={(e) => onDragStart(e, effect)}
            onDragEnter={(e) => onDragEnter(e, effect)}
            onDragEnd={onDragEnd}
        >
            <div className="effect-header">
                <h4>{effect.type.charAt(0).toUpperCase() + effect.type.slice(1)}</h4>
                <div className="effect-header-buttons">
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

const MasterEffects: React.FC<MasterEffectsProps> = ({ effects, setEffects }) => {
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
            case 'distortion': newEffect.params.distortion = { amount: 0.5 }; break;
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


const GenerativeTools: React.FC<GenerativeToolsProps> = ({
    onRandomize, isAiJamEnabled, setIsAiJamEnabled,
    aiJamInterval, setAiJamInterval, isAiJamLoading
}) => {
    return (
        <div className="control-group generative-container">
            <div className="control-group-header">
                <h2>Generative Tools</h2>
            </div>
            <div className="generative-controls">
                 <div className="control-row">
                    <label>Randomize All</label>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                         <button onClick={() => onRandomize('solfeggio', 'global')}>Solfeggio</button>
                         <button onClick={() => onRandomize('chaos', 'global')}>Chaos</button>
                    </div>
                </div>
                <div className="control-row">
                    <label>AI Jam Assistant</label>
                    <button
                        className={isAiJamEnabled ? 'active' : ''}
                        onClick={() => setIsAiJamEnabled(!isAiJamEnabled)}
                    >
                        {isAiJamEnabled ? 'Disable' : 'Enable'} AI Jam
                    </button>
                </div>
                {isAiJamEnabled && (
                    <div className="control-row">
                        <label>Interval (s)</label>
                         <div className="control-value-wrapper">
                            <input
                                type="range"
                                min="2"
                                max="30"
                                step="1"
                                value={aiJamInterval}
                                onChange={e => setAiJamInterval(Number(e.target.value))}
                            />
                            <span>{aiJamInterval}s</span>
                         </div>
                    </div>
                )}
                {isAiJamLoading && <div className="loading-indicator">AI is thinking...</div>}
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
  linkStatus: LinkStatus,
  isTransportPlaying: boolean
) => {
  const audioContextRef = useRef<{ audioContext: AudioContext | null, masterGain: GainNode | null }>({ audioContext: null, masterGain: null });
  const engineNodesRef = useRef<Map<string, EngineAudioNodes>>(new Map());
  const globalFilterNodeRef = useRef<BiquadFilterNode | null>(null);
  const lfoNodesRef = useRef<Map<string, { lfo: OscillatorNode; depth: GainNode }>>(new Map());
  const lfoRoutingBussesRef = useRef<LfoRoutingBusses | null>(null);
  const masterEffectsChainRef = useRef<AudioNode[]>([]);

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
        lfo.type = lfoState.shape;
        lfo.frequency.value = lfoState.rate;
        depth.gain.value = lfoState.depth;
        lfo.start();
        lfo.connect(depth);
        lfoNodesRef.current.set(lfoState.id, { lfo, depth });
    });

    // LFO Routing Busses Setup
    const filterCutoffModBus = audioContext.createGain();
    const filterResonanceModBus = audioContext.createGain();
    const engineVolModBusses = new Map<string, GainNode>();

    filterCutoffModBus.gain.value = 5000;
    filterResonanceModBus.gain.value = 15;

    filterCutoffModBus.connect(globalFilterNode.frequency);
    filterResonanceModBus.connect(globalFilterNode.Q);
    
    engineStates.forEach(engine => {
        const engineNodes = engineNodesRef.current.get(engine.id);
        if (engineNodes) {
            const bus = audioContext.createGain();
            bus.gain.value = 0.5; // Modulate by +/- 50%
            bus.connect(engineNodes.engineMixer.gain);
            engineVolModBusses.set(engine.id, bus);
        }
    });
    
    lfoRoutingBussesRef.current = {
        filterCutoffModBus,
        filterResonanceModBus,
        engineVolModBusses
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
    const interval = (60 / linkStatus.bpm) / 4; // 16th note
    stepTimeRef.current = audioContextRef.current.audioContext!.currentTime + interval;

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

        stepTimeRef.current += interval;
      }
      
      const nextStep = (currentStep + 1);
      setCurrentStep(nextStep);
    };

    const timerId = setInterval(scheduler, 25);
    return () => clearInterval(timerId);
  }, [isTransportPlaying, linkStatus.bpm, currentStep, engineStates, isInitialized]);

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
          if (!noiseNodes.sourceNode) {
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
            sampleSource.connect(samplerNodes.volumeGain).connect(engineMixer);
            sampleSource.start();
            samplerNodes.sourceNode = sampleSource;
        }
        (samplerNodes.sourceNode as AudioBufferSourceNode).playbackRate.value = Math.pow(2, sampler.transpose / 12);
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

        const syncRateToHz = (rate: string, bpm: number) => {
            const beatsPerSecond = bpm / 60;
            return beatsPerSecond * eval(rate);
        };

        lfoStates.forEach(lfoState => {
            const nodes = lfoNodesRef.current.get(lfoState.id);
            if (nodes) {
                const { lfo, depth } = nodes;
                lfo.type = lfoState.shape;
                depth.gain.setTargetAtTime(lfoState.depth, audioContext.currentTime, 0.01);
                
                const rate = lfoState.sync
                    ? syncRateToHz(lfoState.syncRate, linkStatus.bpm)
                    : lfoState.rate;
                lfo.frequency.setTargetAtTime(rate, audioContext.currentTime, 0.01);
            }
        });
    }, [lfoStates, isInitialized, linkStatus.bpm]);

    // LFO Routing
    useEffect(() => {
        if (!audioContextRef.current.audioContext || !isInitialized || !lfoRoutingBussesRef.current) return;

        const busses = lfoRoutingBussesRef.current;
        const engineIdMap: { [key in keyof LFOState['routing']]?: string } = {
            engine1Vol: 'engine1',
            engine2Vol: 'engine2',
            engine3Vol: 'engine3',
        };

        lfoStates.forEach(lfoState => {
            const lfoNodes = lfoNodesRef.current.get(lfoState.id);
            if (!lfoNodes) return;
            const { depth: lfoOutputGain } = lfoNodes;

            const updateConnection = (shouldConnect: boolean, destination: AudioNode) => {
                try {
                    if (shouldConnect) {
                        lfoOutputGain.connect(destination);
                    } else {
                        lfoOutputGain.disconnect(destination);
                    }
                } catch (e) {
                    // Ignore errors from disconnecting a non-connected node
                }
            };

            updateConnection(lfoState.routing.filterCutoff, busses.filterCutoffModBus);
            updateConnection(lfoState.routing.filterResonance, busses.filterResonanceModBus);

            Object.entries(engineIdMap).forEach(([routingKey, engineId]) => {
                const bus = busses.engineVolModBusses.get(engineId!);
                if (bus) {
                    updateConnection(lfoState.routing[routingKey as keyof LFOState['routing']], bus);
                }
            });
        });
    }, [lfoStates, isInitialized]);

    // Master Effects Chain
    useEffect(() => {
        if (!audioContextRef.current.audioContext || !isInitialized || !globalFilterNodeRef.current || !audioContextRef.current.masterGain) return;
        const { audioContext, masterGain } = audioContextRef.current;
        const filterNode = globalFilterNodeRef.current;

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
                    const amount = effect.params.distortion?.amount ?? 0.5;
                    const k = amount * 100;
                    const n_samples = 44100;
                    const curve = new Float32Array(n_samples);
                    const deg = Math.PI / 180;
                    for (let i = 0; i < n_samples; ++i) {
                        const x = i * 2 / n_samples - 1;
                        curve[i] = (3 + k) * x * 20 * deg / (Math.PI + k * Math.abs(x));
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
        
        lastNode.connect(masterGain);

    }, [masterEffects, isInitialized]);

  return { isInitialized, initializeAudio, currentStep, loadSample, engineNodesRef };
};



const App = () => {
  const [isReady, setIsReady] = useState(false);
  const [masterVolume, setMasterVolume] = useState(0.7);
  const [globalFilterCutoff, setGlobalFilterCutoff] = useState(12000);
  const [globalFilterResonance, setGlobalFilterResonance] = useState(1);
  const [globalFilterType, setGlobalFilterType] = useState<FilterType>('lowpass');
  
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
        engine2Vol: false,
        engine3Vol: false,
    }
  });

  const [lfoStates, setLfoStates] = useState<LFOState[]>([
    createInitialLFOState('lfo1', 'LFO 1'),
    createInitialLFOState('lfo2', 'LFO 2'),
    createInitialLFOState('lfo3', 'LFO 3'),
  ]);

  const [engineStates, setEngineStates] = useState<EngineState[]>([
    { id: 'engine1', name: 'Engine 1', isAiControlled: false, sequencerEnabled: true, sequencerSteps: 16, sequencerPulses: 4, sequencerRotate: 0, effects: { distortion: 0, delayTime: 0, delayFeedback: 0 }, synth: { enabled: true, volume: 0.7, frequency: 440, oscillatorType: 'sine', solfeggioFrequency: '' }, noise: { enabled: false, volume: 0.5, noiseType: 'white' }, sampler: { enabled: false, volume: 1, sampleName: null, transpose: 0 }},
    { id: 'engine2', name: 'Engine 2', isAiControlled: false, sequencerEnabled: true, sequencerSteps: 12, sequencerPulses: 3, sequencerRotate: 0, effects: { distortion: 0, delayTime: 0, delayFeedback: 0 }, synth: { enabled: false, volume: 0.7, frequency: 220, oscillatorType: 'square', solfeggioFrequency: '' }, noise: { enabled: true, volume: 0.1, noiseType: 'pink' }, sampler: { enabled: false, volume: 1, sampleName: null, transpose: 0 }},
    { id: 'engine3', name: 'Engine 3', isAiControlled: false, sequencerEnabled: true, sequencerSteps: 7, sequencerPulses: 2, sequencerRotate: 0, effects: { distortion: 0, delayTime: 0, delayFeedback: 0 }, synth: { enabled: false, volume: 0.7, frequency: 880, oscillatorType: 'sawtooth', solfeggioFrequency: '' }, noise: { enabled: false, volume: 0.5, noiseType: 'brown' }, sampler: { enabled: true, volume: 1, sampleName: null, transpose: 0 }}
  ]);
  const [linkStatus, setLinkStatus] = useState<LinkStatus>({ isEnabled: false, bpm: 120, peers: 0 });
  const [isTransportPlaying, setIsTransportPlaying] = useState(false);
  const linkRef = useRef<any>(null);

  const [isAiJamEnabled, setIsAiJamEnabled] = useState(false);
  const [aiJamInterval, setAiJamInterval] = useState(10);
  const [isAiJamLoading, setIsAiJamLoading] = useState(false);
  const [masterEffects, setMasterEffects] = useState<MasterEffect[]>([]);

  const { isInitialized, initializeAudio, currentStep, loadSample, engineNodesRef } = useAudio(
    engineStates,
    setEngineStates,
    masterVolume,
    globalFilterCutoff,
    globalFilterResonance,
    globalFilterType,
    lfoStates,
    masterEffects,
    linkStatus,
    isTransportPlaying,
  );

  const handleEngineUpdate = (engineId: string, updates: Partial<EngineState>) => {
    setEngineStates(prev => prev.map(e => e.id === engineId ? { ...e, ...updates } : e));
  };
  
  const handleEngineLayerUpdate = <K extends keyof Omit<EngineState, 'id' | 'name' | 'isAiControlled'>>(
    engineId: string,
    layer: K,
    updates: Partial<EngineState[K]>
  ) => {
    setEngineStates(prev => prev.map(e => e.id === engineId ? { ...e, [layer]: { ...e[layer], ...updates } } : e));
  };

  const handleLfoUpdate = (lfoId: string, updates: Partial<LFOState>) => {
    setLfoStates(prevLfos =>
        prevLfos.map(lfo =>
            lfo.id === lfoId ? { ...lfo, ...updates, ...updates.routing ? {routing: {...lfo.routing, ...updates.routing}} : {} } : lfo
        )
    );
  };
  
  const handleToggleAiControl = (engineId: string) => {
      setEngineStates(prev => prev.map(e => e.id === engineId ? { ...e, isAiControlled: !e.isAiControlled } : e));
  };

  const handleRandomize = useCallback((mode: RandomizeMode, scope: 'global' | 'master' | 'lfo' | string) => {
    const randomizeEngine = (engine: EngineState, randMode: RandomizeMode): EngineState => {
      const solfeggio = randMode === 'solfeggio' ? getRandomElement(solfeggioFrequencies) : null;
      return {
        ...engine,
        sequencerSteps: getRandomInt(4, 32),
        sequencerPulses: getRandomInt(1, 8),
        sequencerRotate: getRandomInt(0, 31),
        synth: {
          ...engine.synth,
          enabled: getRandomBool(0.8),
          volume: getRandom(0.2, 0.8),
          frequency: solfeggio ? solfeggio.value : getRandom(80, 1000),
          oscillatorType: getRandomElement(oscillatorTypes),
          solfeggioFrequency: solfeggio ? String(solfeggio.value) : '',
        },
        noise: {
            ...engine.noise,
            enabled: getRandomBool(0.4),
            volume: getRandom(0.01, 0.3),
            noiseType: getRandomElement(noiseTypes),
        },
        sampler: {
            ...engine.sampler,
            enabled: getRandomBool(0.3),
            transpose: getRandomInt(-12, 12),
            volume: getRandom(0.5, 1.0),
        }
      };
    };

    const randomizeLfo = (lfo: LFOState, randMode: RandomizeMode): LFOState => {
        return {
            ...lfo,
            rate: getRandom(0.1, 20),
            depth: getRandom(0, 1),
            shape: getRandomElement(lfoShapes),
            sync: getRandomBool(0.3),
            syncRate: getRandomElement(lfoSyncRates),
            routing: {
                filterCutoff: getRandomBool(0.2),
                filterResonance: getRandomBool(0.2),
                engine1Vol: getRandomBool(0.2),
                engine2Vol: getRandomBool(0.2),
                engine3Vol: getRandomBool(0.2),
            }
        };
    };

    const randomizeMasterFilter = () => {
        setGlobalFilterType(getRandomElement(filterTypes));
        setGlobalFilterCutoff(getRandom(500, 15000));
        setGlobalFilterResonance(getRandom(0, 15));
    };

    if (scope === 'global') {
      setEngineStates(prev => prev.map(e => randomizeEngine(e, mode)));
      setLfoStates(prev => prev.map(lfo => randomizeLfo(lfo, mode)));
      randomizeMasterFilter();
    } else if (scope === 'master') {
      randomizeMasterFilter();
    } else if (scope === 'lfo') {
      setLfoStates(prev => prev.map(lfo => randomizeLfo(lfo, mode)));
    } else if (scope.startsWith('engine')) {
      setEngineStates(prev => prev.map(e => e.id === scope ? randomizeEngine(e, mode) : e));
    } else if (scope.startsWith('lfo')) {
      setLfoStates(prev => prev.map(lfo => lfo.id === scope ? randomizeLfo(lfo, mode) : lfo));
    }

  }, []);

  useEffect(() => {
      if (!window.AbletonLink) return;
      // The UMD build for AbletonLink might be exposing the class on a .default property
      const AbletonLinkClass = (window.AbletonLink as any).default || window.AbletonLink;
      const link = new AbletonLinkClass();
      linkRef.current = link;
      link.on('enabled', (isEnabled: boolean) => setLinkStatus(s => ({ ...s, isEnabled })));
      link.on('bpm', (bpm: number) => setLinkStatus(s => ({ ...s, bpm })));
      link.on('numPeers', (peers: number) => setLinkStatus(s => ({ ...s, peers })));
      return () => { link.disable(); };
  }, []);
  
  const toggleLink = () => {
      if (!linkRef.current) return;
      if (linkRef.current.isEnabled) linkRef.current.disable();
      else linkRef.current.enable();
  };
  const setBPM = (bpm: number) => {
      if (!linkRef.current) return;
      if (!linkRef.current.isEnabled) {
          linkRef.current.bpm = bpm;
          setLinkStatus(s => ({...s, bpm}));
      }
  };

  const handleToggleTransport = () => {
      setIsTransportPlaying(p => !p);
  };
  
  const ai = useMemo(() => process.env.API_KEY ? new GoogleGenAI({ apiKey: process.env.API_KEY }) : null, []);

  const runAiJam = useCallback(async () => {
    if (!ai) return;
    setIsAiJamLoading(true);

    const controlledEngines = engineStates.filter(e => e.isAiControlled);
    if (controlledEngines.length === 0) {
        setIsAiJamLoading(false);
        return;
    }
    
    try {
        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: `The current state of a polyrhythmic synthesizer is: ${JSON.stringify(engineStates)}. You are an AI Jam Assistant. Your task is to modify the parameters for the AI-controlled engines: ${controlledEngines.map(e => e.name).join(', ')}. Make creative, subtle, and musically interesting changes. Respond ONLY with a JSON object containing the modified engine states.`,
            config: {
                 responseMimeType: "application/json",
                 responseSchema: {
                    type: Type.ARRAY,
                    items: {
                        type: Type.OBJECT,
                        properties: {
                            id: { type: Type.STRING },
                            sequencerSteps: { type: Type.INTEGER },
                            sequencerPulses: { type: Type.INTEGER },
                            sequencerRotate: { type: Type.INTEGER },
                            synth: {
                                type: Type.OBJECT,
                                properties: {
                                    volume: { type: Type.NUMBER },
                                    frequency: { type: Type.NUMBER },
                                    oscillatorType: { type: Type.STRING }
                                }
                            }
                        }
                    }
                 }
            },
        });
        
        const aiStates = JSON.parse(response.text) as Partial<EngineState>[];
        setEngineStates(currentStates => currentStates.map(engine => {
            if (engine.isAiControlled) {
                const aiUpdate = aiStates.find(s => s.id === engine.id);
                if (aiUpdate) {
                    return {
                        ...engine,
                        ...aiUpdate,
                        synth: { ...engine.synth, ...aiUpdate.synth }
                    };
                }
            }
            return engine;
        }));

    } catch(e) {
        console.error("AI Jam Error:", e);
    } finally {
        setIsAiJamLoading(false);
    }
  }, [ai, engineStates]);

  useEffect(() => {
      if (isAiJamEnabled && !isAiJamLoading) {
          const timerId = setInterval(runAiJam, aiJamInterval * 1000);
          return () => clearInterval(timerId);
      }
  }, [isAiJamEnabled, aiJamInterval, isAiJamLoading, runAiJam]);


  if (!isReady) {
    return (
      <div className="init-overlay">
        <button onClick={() => { initializeAudio(); setIsReady(true); }}>Start Synthesizer</button>
      </div>
    );
  }

  const masterAnalyser = engineNodesRef.current.get('engine1')?.analyser; // Just using engine1 for master vis

  return (
    <div className="app-container">
      <TopBar
        masterVolume={masterVolume}
        setMasterVolume={setMasterVolume}
        linkStatus={linkStatus}
        toggleLink={toggleLink}
        setBPM={setBPM}
        isTransportPlaying={isTransportPlaying}
        onToggleTransport={handleToggleTransport}
      />
      <div className="main-grid">
        <GenerativeTools
            onRandomize={handleRandomize}
            isAiJamEnabled={isAiJamEnabled}
            setIsAiJamEnabled={setIsAiJamEnabled}
            aiJamInterval={aiJamInterval}
            setAiJamInterval={setAiJamInterval}
            isAiJamLoading={isAiJamLoading}
        />
        <div className="master-visualizer-container">
            {masterAnalyser && <Visualizer analyserNode={masterAnalyser} type="frequency" />}
        </div>
        <div className="channels-container">
          {engineStates.map(engine => (
            <EngineControls
              key={engine.id}
              engine={engine}
              onUpdate={handleEngineUpdate}
              onLayerUpdate={handleEngineLayerUpdate}
              onLoadSample={loadSample}
              onRandomize={(mode) => handleRandomize(mode, engine.id)}
              onToggleAiControl={handleToggleAiControl}
              analyserNode={engineNodesRef.current.get(engine.id)?.analyser}
              currentStep={currentStep}
              isTransportPlaying={isTransportPlaying}
            />
          ))}
        </div>
        <div className="lfo-grid-container">
            {lfoStates.map((lfo) => (
                <LFOControls
                    key={lfo.id}
                    lfoState={lfo}
                    onUpdate={(updates) => handleLfoUpdate(lfo.id, updates)}
                    linkStatus={linkStatus}
                    onRandomize={(mode) => handleRandomize(mode, lfo.id)}
                />
            ))}
        </div>
        <MasterFilterControls
            globalFilterCutoff={globalFilterCutoff}
            setGlobalFilterCutoff={setGlobalFilterCutoff}
            globalFilterResonance={globalFilterResonance}
            setGlobalFilterResonance={setGlobalFilterResonance}
            globalFilterType={globalFilterType}
            setGlobalFilterType={setGlobalFilterType}
            onRandomize={(mode) => handleRandomize(mode, 'master')}
        />
        <MasterEffects effects={masterEffects} setEffects={setMasterEffects} />
      </div>
    </div>
  );
};

const container = document.getElementById('root');
const root = createRoot(container!);
root.render(<App />);
