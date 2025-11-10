

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
    lfoVolumeScaler: GainNode;
    analyser: AnalyserNode;
    distortion?: WaveShaperNode;
    delay?: DelayNode;
    feedback?: GainNode;
}

interface LfoRoutingNodes {
    filterCutoffScaler: GainNode;
    filterResonanceScaler: GainNode;
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
  onLayerUpdate: <K extends keyof Omit<EngineState, 'id' | 'name'>>(
    engineId: string,
    layer: K,
    updates: Partial<EngineState[K]>
  ) => void;
  onLoadSample: (engineId: string, file: File) => void;
  onRandomize: (mode: RandomizeMode) => void;
  analyserNode?: AnalyserNode;
  currentStep: number;
  isTransportPlaying: boolean;
}

interface MasterControlsProps {
    masterVolume: number;
    setMasterVolume: (volume: number) => void;
    linkStatus: LinkStatus;
    toggleLink: () => void;
    setBPM: (bpm: number) => void;
    globalFilterCutoff: number;
    setGlobalFilterCutoff: (cutoff: number) => void;
    globalFilterResonance: number;
    setGlobalFilterResonance: (resonance: number) => void;
    globalFilterType: FilterType;
    setGlobalFilterType: (type: FilterType) => void;
    isTransportPlaying: boolean;
    onToggleTransport: () => void;
    onRandomize: (mode: RandomizeMode) => void;
}

interface LFOControlsProps {
    lfoState: LFOState;
    setLFOState: React.Dispatch<React.SetStateAction<LFOState>>;
    linkStatus: LinkStatus;
    onRandomize: (mode: RandomizeMode) => void;
}

interface RandomizerProps {
    onRandomize: (mode: RandomizeMode, scope: 'global' | 'master' | 'lfo' | string) => void;
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
// FIX: Changed to function declaration to avoid TSX parsing ambiguity with generics.
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


const EngineControls: React.FC<EngineControlsProps> = ({ engine, onUpdate, onLayerUpdate, onLoadSample, onRandomize, analyserNode, currentStep, isTransportPlaying }) => {
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
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => { if (e.target.files && e.target.files.length > 0) { onLoadSample(engine.id, e.target.files[0]); } };
  const handleLoadClick = () => { fileInputRef.current?.click(); };

  const renderTabContent = () => {
    switch (activeTab) {
      case 'synth':
        return (
          <div className="layer-group">
            <div className="layer-header">
              <h4>Synth Settings</h4>
              <button onClick={() => onLayerUpdate(engine.id, 'synth', { enabled: !engine.synth.enabled })} className={engine.synth.enabled ? 'active power-toggle' : 'power-toggle'}>
                {engine.synth.enabled ? 'On' : 'Off'}
              </button>
            </div>
            <div className="control-row">
              <label>Volume</label>
              <div className="control-value-wrapper">
                <input type="range" min="0" max="1" step="0.01" value={engine.synth.volume} onChange={(e) => onLayerUpdate(engine.id, 'synth', { volume: parseFloat(e.target.value) })} />
                <span>{engine.synth.volume.toFixed(2)}</span>
              </div>
            </div>
            <div className="control-row">
              <label>Solfeggio</label>
              <select value={engine.synth.solfeggioFrequency} onChange={(e) => onLayerUpdate(engine.id, 'synth', { solfeggioFrequency: e.target.value, frequency: parseFloat(e.target.value) })}>
                {solfeggioFrequencies.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
              </select>
            </div>
            <div className="control-row">
              <label>Waveform</label>
              <select value={engine.synth.oscillatorType} onChange={(e) => onLayerUpdate(engine.id, 'synth', { oscillatorType: e.target.value as OscillatorType })}>
                {oscillatorTypes.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
              </select>
            </div>
          </div>
        );
      case 'noise':
        return (
          <div className="layer-group">
            <div className="layer-header">
              <h4>Noise Settings</h4>
              <button onClick={() => onLayerUpdate(engine.id, 'noise', { enabled: !engine.noise.enabled })} className={engine.noise.enabled ? 'active power-toggle' : 'power-toggle'}>
                {engine.noise.enabled ? 'On' : 'Off'}
              </button>
            </div>
            <div className="control-row">
              <label>Volume</label>
              <div className="control-value-wrapper">
                <input type="range" min="0" max="1" step="0.01" value={engine.noise.volume} onChange={(e) => onLayerUpdate(engine.id, 'noise', { volume: parseFloat(e.target.value) })} />
                <span>{engine.noise.volume.toFixed(2)}</span>
              </div>
            </div>
            <div className="control-row">
              <label>Noise Type</label>
              <select value={engine.noise.noiseType} onChange={(e) => onLayerUpdate(engine.id, 'noise', { noiseType: e.target.value as NoiseType })}>
                {noiseTypes.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
              </select>
            </div>
          </div>
        );
      case 'sampler':
        return (
          <div className="layer-group">
            <div className="layer-header">
              <h4>Sampler Settings</h4>
              <button onClick={() => onLayerUpdate(engine.id, 'sampler', { enabled: !engine.sampler.enabled })} className={engine.sampler.enabled ? 'active power-toggle' : 'power-toggle'}>
                {engine.sampler.enabled ? 'On' : 'Off'}
              </button>
            </div>
            <div className="control-row">
              <label>Volume</label>
              <div className="control-value-wrapper">
                <input type="range" min="0" max="1" step="0.01" value={engine.sampler.volume} onChange={(e) => onLayerUpdate(engine.id, 'sampler', { volume: parseFloat(e.target.value) })} />
                <span>{engine.sampler.volume.toFixed(2)}</span>
              </div>
            </div>
            <div
              className={`drop-zone ${isDraggingOver ? 'drop-zone-active' : ''}`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={handleLoadClick}
              style={{ cursor: 'pointer' }}
            >
              <input type="file" ref={fileInputRef} onChange={handleFileChange} style={{ display: 'none' }} accept="audio/*" />
              {engine.sampler.sampleName ?
                <div>
                  <span>{engine.sampler.sampleName}</span>
                  <span className="replace-sample-text">(Click or drop to replace)</span>
                </div>
                : <span>Drop file or click to load</span>
              }
            </div>
            <div className="control-row">
              <label>Transpose</label>
              <div className="control-value-wrapper">
                <input type="range" min="-24" max="24" step="1" value={engine.sampler.transpose} onChange={(e) => onLayerUpdate(engine.id, 'sampler', { transpose: parseInt(e.target.value, 10) })} />
                <span>{engine.sampler.transpose} st</span>
              </div>
            </div>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="control-group">
      <div className="control-group-header">
        <h2>{engine.name}</h2>
        <div className="randomizer-buttons-group">
          <button title="Chaos Randomize" onClick={() => onRandomize('chaos')}>🎲</button>
          <button title="Musical Randomize" onClick={() => onRandomize('solfeggio')}>🎵</button>
        </div>
      </div>
       {analyserNode && (
        <div className="channel-visualizer-container">
          <CircularVisualizerSequencer 
            analyserNode={analyserNode}
            steps={engine.sequencerSteps}
            pulses={engine.sequencerPulses}
            rotate={engine.sequencerRotate}
            currentStep={currentStep % engine.sequencerSteps}
            isTransportPlaying={isTransportPlaying}
          />
        </div>
       )}
        <div className="tab-nav">
          <button onClick={() => setActiveTab('synth')} className={`tab-button ${activeTab === 'synth' ? 'active' : ''}`}>Synth</button>
          <button onClick={() => setActiveTab('noise')} className={`tab-button ${activeTab === 'noise' ? 'active' : ''}`}>Noise</button>
          <button onClick={() => setActiveTab('sampler')} className={`tab-button ${activeTab === 'sampler' ? 'active' : ''}`}>Sampler</button>
        </div>
        <div className="tab-content">
          {renderTabContent()}
        </div>
       <div className="control-row">
           <label>Enable Sequencer</label>
            <button 
              onClick={() => onUpdate(engine.id, { sequencerEnabled: !engine.sequencerEnabled })} 
              className={engine.sequencerEnabled ? 'active' : ''}
            >
              {engine.sequencerEnabled ? 'On' : 'Off'}
            </button>
      </div>
       <div className="control-row">
        <label>Steps</label>
        <div className="control-value-wrapper">
          <input type="range" min="1" max="32" step="1" value={engine.sequencerSteps} onChange={(e) => onUpdate(engine.id, { sequencerSteps: parseInt(e.target.value, 10) })} />
          <span>{engine.sequencerSteps}</span>
        </div>
      </div>
       <div className="control-row">
        <label>Pulses</label>
        <div className="control-value-wrapper">
          <input type="range" min="0" max={engine.sequencerSteps} step="1" value={engine.sequencerPulses} onChange={(e) => onUpdate(engine.id, { sequencerPulses: parseInt(e.target.value, 10) })} />
          <span>{engine.sequencerPulses}</span>
        </div>
      </div>
       <div className="control-row">
        <label>Rotate</label>
        <div className="control-value-wrapper">
          <input type="range" min="0" max={engine.sequencerSteps - 1} step="1" value={engine.sequencerRotate} onChange={(e) => onUpdate(engine.id, { sequencerRotate: parseInt(e.target.value, 10) })} />
          <span>{engine.sequencerRotate}</span>
        </div>
      </div>
    </div>
  );
};

const MasterControls: React.FC<MasterControlsProps> = (props) => {
    return (
        <div className="control-group master-container">
            <div className="control-group-header">
                <h2>Master</h2>
                <div className="randomizer-buttons-group">
                    <button title="Chaos Randomize" onClick={() => props.onRandomize('chaos')}>🎲</button>
                </div>
            </div>
            <div className="control-row">
                <label>Transport</label>
                <button onClick={props.onToggleTransport} className={props.isTransportPlaying ? 'active' : ''}>
                    {props.isTransportPlaying ? 'Stop' : 'Play'}
                </button>
            </div>
             <div className="control-row">
                <label>Master Volume</label>
                <div className="control-value-wrapper">
                  <input type="range" min="0" max="1" step="0.01" value={props.masterVolume} onChange={(e) => props.setMasterVolume(parseFloat(e.target.value))} />
                  <span>{props.masterVolume.toFixed(2)}</span>
                </div>
            </div>
            <div className="control-row">
                <label>Filter Type</label>
                <select value={props.globalFilterType} onChange={(e) => props.setGlobalFilterType(e.target.value as FilterType)}>
                    {filterTypes.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
            </div>
             <div className="control-row">
                <label>Filter Cutoff</label>
                <div className="control-value-wrapper">
                  <input type="range" min="20" max="20000" step="1" value={props.globalFilterCutoff} onChange={(e) => props.setGlobalFilterCutoff(parseFloat(e.target.value))} />
                  <span>{Math.round(props.globalFilterCutoff)} Hz</span>
                </div>
            </div>
             <div className="control-row">
                <label>Filter Resonance</label>
                <div className="control-value-wrapper">
                  <input type="range" min="0" max="20" step="0.1" value={props.globalFilterResonance} onChange={(e) => props.setGlobalFilterResonance(parseFloat(e.target.value))} />
                  <span>{props.globalFilterResonance.toFixed(1)}</span>
                </div>
            </div>
            <div className="control-row">
                <label>BPM</label>
                <div className="control-value-wrapper">
                  <input type="range" min="60" max="240" step="1" value={props.linkStatus.bpm} onChange={(e) => props.setBPM(parseInt(e.target.value, 10))} disabled={props.linkStatus.isEnabled} />
                  <span>{props.linkStatus.bpm}</span>
                </div>
            </div>
             <div className="control-row">
                <label>Ableton Link</label>
                <button onClick={props.toggleLink} className={props.linkStatus.isEnabled ? 'active' : ''}>
                    {props.linkStatus.isEnabled ? `On (${props.linkStatus.peers} peers)` : 'Off'}
                </button>
            </div>
        </div>
    );
};

const LFOControls: React.FC<LFOControlsProps> = ({lfoState, setLFOState, linkStatus, onRandomize}) => {
    const handleUpdate = (updates: Partial<LFOState>) => {
        setLFOState(prevState => ({...prevState, ...updates}));
    };

    const formatRoutingLabel = (key: string) => {
      return key
          .replace(/([A-Z])/g, ' $1')
          .replace(/([0-9])([A-Za-z])/g, '$1 $2')
          .replace(/^./, str => str.toUpperCase());
    };

    return (
         <div className="control-group lfo-container">
            <div className="control-group-header">
                <h2>LFO</h2>
                <div className="randomizer-buttons-group">
                    <button title="Chaos Randomize" onClick={() => onRandomize('chaos')}>🎲</button>
                </div>
            </div>
             <div className="control-row">
                <label>Shape</label>
                <select value={lfoState.shape} onChange={e => handleUpdate({ shape: e.target.value as LFO_Shape })}>
                    {lfoShapes.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
            </div>
            <div className="control-row">
              <label>Sync</label>
              <button onClick={() => handleUpdate({ sync: !lfoState.sync })} className={lfoState.sync ? 'active' : ''}>
                  {lfoState.sync ? 'On' : 'Off'}
              </button>
            </div>
            {lfoState.sync ? (
              <div className="control-row">
                  <label>Sync Rate</label>
                  <select value={lfoState.syncRate} onChange={e => handleUpdate({ syncRate: e.target.value })}>
                      {lfoSyncRates.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
              </div>
            ) : (
              <div className="control-row">
                  <label>Rate</label>
                    <div className="control-value-wrapper">
                      <input type="range" min="0.1" max="20" step="0.1" value={lfoState.rate} onChange={e => handleUpdate({ rate: parseFloat(e.target.value) })} />
                      <span>{lfoState.rate.toFixed(1)} Hz</span>
                  </div>
              </div>
            )}
             <div className="control-row">
                <label>Depth</label>
                <div className="control-value-wrapper">
                  <input type="range" min="0" max="1" step="0.01" value={lfoState.depth} onChange={e => handleUpdate({ depth: parseFloat(e.target.value) })} />
                  <span>{lfoState.depth.toFixed(2)}</span>
                </div>
            </div>
            <div className="routing-section">
                <h4>Routing</h4>
                {Object.keys(lfoState.routing).map(key => (
                    <div className="control-row checkbox-row" key={key}>
                        <label htmlFor={`lfo-route-${key}`}>{formatRoutingLabel(key)}</label>
                        <input
                            type="checkbox"
                            id={`lfo-route-${key}`}
                            checked={lfoState.routing[key as keyof LFOState['routing']]}
                            onChange={e => handleUpdate({ routing: { ...lfoState.routing, [key]: e.target.checked } })}
                        />
                    </div>
                ))}
            </div>
        </div>
    );
};
const Randomizer: React.FC<RandomizerProps> = ({ onRandomize }) => {
    return (
         <div className="control-group randomizer-container">
            <div className="control-group-header">
                <h2>Randomizer</h2>
            </div>
             <div className="control-row">
                <button className="small" onClick={() => onRandomize('chaos', 'global')}>Global Chaos</button>
                <button className="small" onClick={() => onRandomize('solfeggio', 'global')}>Global Musical</button>
            </div>
        </div>
    );
};

const initialEngines: EngineState[] = [
    {
        id: '1', name: 'Engine 1',
        synth: { enabled: true, volume: 0.7, frequency: 528, oscillatorType: 'sawtooth', solfeggioFrequency: '528' },
        noise: { enabled: false, volume: 0.5, noiseType: 'white' },
        sampler: { enabled: false, volume: 0.8, sampleName: null, transpose: 0 },
        sequencerEnabled: true, sequencerSteps: 16, sequencerPulses: 4, sequencerRotate: 0,
        effects: { distortion: 0, delayTime: 0, delayFeedback: 0 }
    },
    {
        id: '2', name: 'Engine 2',
        synth: { enabled: false, volume: 0.7, frequency: 417, oscillatorType: 'sine', solfeggioFrequency: '417' },
        noise: { enabled: true, volume: 0.3, noiseType: 'pink' },
        sampler: { enabled: false, volume: 0.8, sampleName: null, transpose: 0 },
        sequencerEnabled: true, sequencerSteps: 16, sequencerPulses: 8, sequencerRotate: 8,
        effects: { distortion: 0, delayTime: 0, delayFeedback: 0 }
    },
    {
        id: '3', name: 'Engine 3',
        synth: { enabled: false, volume: 0.7, frequency: 639, oscillatorType: 'square', solfeggioFrequency: '639' },
        noise: { enabled: false, volume: 0.5, noiseType: 'brown' },
        sampler: { enabled: true, volume: 0.8, sampleName: null, transpose: 0 },
        sequencerEnabled: false, sequencerSteps: 8, sequencerPulses: 3, sequencerRotate: 0,
        effects: { distortion: 0, delayTime: 0, delayFeedback: 0 }
    },
];

// --- Main App Component ---
const App = () => {
    const [engines, setEngines] = useState<EngineState[]>(initialEngines);
    const [masterVolume, setMasterVolume] = useState(0.8);
    const [linkStatus, setLinkStatus] = useState<LinkStatus>({ isEnabled: false, bpm: 120, peers: 0 });
    const [lfoState, setLFOState] = useState<LFOState>({ rate: 5, depth: 0.5, shape: 'sine', sync: false, syncRate: '1/4', routing: { filterCutoff: false, filterResonance: false, engine1Vol: false, engine2Vol: false, engine3Vol: false } });
    const [globalFilterCutoff, setGlobalFilterCutoff] = useState(12000);
    const [globalFilterResonance, setGlobalFilterResonance] = useState(1);
    const [globalFilterType, setGlobalFilterType] = useState<FilterType>('lowpass');
    
    const [isAudioInitialized, setIsAudioInitialized] = useState(false);
    const [isTransportPlaying, setIsTransportPlaying] = useState(false);
    const [currentStep, setCurrentStep] = useState(0);

    const audioContextRef = useRef<AudioContext | null>(null);
    const masterGainRef = useRef<GainNode | null>(null);
    const masterFilterRef = useRef<BiquadFilterNode | null>(null);
    const masterAnalyserRef = useRef<AnalyserNode | null>(null);
    const audioNodesRef = useRef<Map<string, EngineAudioNodes>>(new Map());
    const [decodedSamples, setDecodedSamples] = useState<Map<string, AudioBuffer>>(new Map());
    const [noiseBuffers, setNoiseBuffers] = useState<Map<NoiseType, AudioBuffer>>(new Map());

    const lfoOscillatorRef = useRef<OscillatorNode | null>(null);
    const lfoGainRef = useRef<GainNode | null>(null);
    const lfoRoutingNodesRef = useRef<LfoRoutingNodes | null>(null);

    const linkRef = useRef<any>(null);
    
    const schedulerTimerRef = useRef<number | null>(null);
    const nextStepTimeRef = useRef(0);
    const currentStepRef = useRef(0);


    const generateNoiseSamples = useCallback(async (context: AudioContext): Promise<Map<NoiseType, AudioBuffer>> => {
        const bufferSize = context.sampleRate * 2; // 2 seconds
        const buffers = new Map<NoiseType, AudioBuffer>();
        const noiseGen = (genFn:()=>number) => {
            const buffer = context.createBuffer(1, bufferSize, context.sampleRate);
            const data = buffer.getChannelData(0);
            for (let i = 0; i < bufferSize; i++) data[i] = genFn();
            return buffer;
        }
        buffers.set('white', noiseGen(() => Math.random() * 2 - 1));
        let lastOut = 0;
        buffers.set('brown', noiseGen(() => (lastOut = (lastOut + (0.02 * (Math.random() * 2 - 1))) / 1.02 * 3.5, lastOut)));
        let b = [0,0,0,0,0,0,0];
        buffers.set('pink', noiseGen(() => {
            const white = Math.random() * 2 - 1;
            b[0] = 0.99886*b[0] + white*0.0555179; b[1] = 0.99332*b[1] + white*0.0750759;
            b[2] = 0.96900*b[2] + white*0.1538520; b[3] = 0.86650*b[3] + white*0.3104856;
            b[4] = 0.55000*b[4] + white*0.5329522; b[5] = -0.7616*b[5] - white*0.0168980;
            const pink = (b[0]+b[1]+b[2]+b[3]+b[4]+b[5]+b[6] + white*0.5362) * 0.11;
            b[6] = white * 0.115926; return pink;
        }));
        return buffers;
    }, []);


    const initAudio = useCallback(async () => {
        if (isAudioInitialized) return;
        const context = new (window.AudioContext || (window as any).webkitAudioContext)();
        await context.resume();
        audioContextRef.current = context;
        masterGainRef.current = context.createGain();
        masterFilterRef.current = context.createBiquadFilter();
        masterAnalyserRef.current = context.createAnalyser();
        masterAnalyserRef.current.smoothingTimeConstant = 0.3;
        masterFilterRef.current.connect(masterGainRef.current);
        masterGainRef.current.connect(masterAnalyserRef.current);
        masterAnalyserRef.current.connect(context.destination);
        
        lfoOscillatorRef.current = context.createOscillator();
        lfoGainRef.current = context.createGain();
        lfoOscillatorRef.current.connect(lfoGainRef.current);
        lfoOscillatorRef.current.start();
        
        const filterCutoffScaler = context.createGain();
        const filterResonanceScaler = context.createGain();
        filterCutoffScaler.gain.value = 0;
        filterResonanceScaler.gain.value = 0;
        lfoGainRef.current.connect(filterCutoffScaler);
        lfoGainRef.current.connect(filterResonanceScaler);
        filterCutoffScaler.connect(masterFilterRef.current.frequency);
        filterResonanceScaler.connect(masterFilterRef.current.Q);
        lfoRoutingNodesRef.current = { filterCutoffScaler, filterResonanceScaler };

        if (linkRef.current) {
            linkRef.current.startUpdate(context);
        }

        setNoiseBuffers(await generateNoiseSamples(context));
        setIsAudioInitialized(true);
    }, [isAudioInitialized, generateNoiseSamples]);

    // Setup and update audio nodes
    useEffect(() => {
        if (!isAudioInitialized || !audioContextRef.current || !lfoGainRef.current) return;
        const audioContext = audioContextRef.current;
        engines.forEach(engine => {
            let nodes = audioNodesRef.current.get(engine.id);
            if (!nodes) {
                const engineMixer = audioContext.createGain();
                const sequencerGain = audioContext.createGain();
                const lfoVolumeScaler = audioContext.createGain();
                const analyser = audioContext.createAnalyser();

                const synthNodes: LayerAudioNodes = { volumeGain: audioContext.createGain() };
                const noiseNodes: LayerAudioNodes = { volumeGain: audioContext.createGain() };
                const samplerNodes: LayerAudioNodes = { volumeGain: audioContext.createGain() };
                
                synthNodes.volumeGain.connect(engineMixer);
                noiseNodes.volumeGain.connect(engineMixer);
                samplerNodes.volumeGain.connect(engineMixer);

                engineMixer.connect(sequencerGain);
                sequencerGain.connect(analyser);
                analyser.connect(masterFilterRef.current!);

                lfoVolumeScaler.gain.value = 0;
                lfoGainRef.current!.connect(lfoVolumeScaler);
                // Note: LFO modulates the mixer, affecting overall engine volume
                lfoVolumeScaler.connect(engineMixer.gain); 

                nodes = { synth: synthNodes, noise: noiseNodes, sampler: samplerNodes, engineMixer, sequencerGain, analyser, lfoVolumeScaler };
                audioNodesRef.current.set(engine.id, nodes);
            }

            // --- Synth Layer ---
            if (engine.synth.enabled) {
                if (!nodes.synth.sourceNode) {
                    const oscillator = audioContext.createOscillator();
                    oscillator.connect(nodes.synth.volumeGain);
                    oscillator.start();
                    nodes.synth.sourceNode = oscillator;
                }
                (nodes.synth.sourceNode as OscillatorNode).type = engine.synth.oscillatorType;
                (nodes.synth.sourceNode as OscillatorNode).frequency.setTargetAtTime(engine.synth.frequency, audioContext.currentTime, 0.01);
                nodes.synth.volumeGain.gain.setTargetAtTime(engine.synth.volume, audioContext.currentTime, 0.01);
            } else if (nodes.synth.sourceNode) {
                 (nodes.synth.sourceNode as OscillatorNode).disconnect();
                 (nodes.synth.sourceNode as OscillatorNode).stop();
                 delete nodes.synth.sourceNode;
            }
            
            // --- Noise and Sampler Layers are handled during triggering ---
            nodes.noise.volumeGain.gain.setTargetAtTime(engine.noise.volume, audioContext.currentTime, 0.01);
            nodes.sampler.volumeGain.gain.setTargetAtTime(engine.sampler.volume, audioContext.currentTime, 0.01);
            
            nodes.sequencerGain.gain.setValueAtTime(0, audioContext.currentTime);
        });
    }, [isAudioInitialized, engines]);

     // Master Clock and Sequencer Triggering
    useEffect(() => {
        const scheduleNotes = (beat: number, time: number) => {
            setCurrentStep(beat % 16);
            engines.forEach(engine => {
                const nodes = audioNodesRef.current.get(engine.id);
                if (!engine.sequencerEnabled || !nodes) return;
                
                const pattern = rotatePattern(generateEuclideanPattern(engine.sequencerSteps, engine.sequencerPulses), engine.sequencerRotate);
                const stepInPattern = beat % engine.sequencerSteps;

                if (pattern[stepInPattern] === 1) {
                    const noteDuration = 0.2;
                    // Trigger layers if they are enabled
                    if (engine.noise.enabled && engine.noise.noiseType && noiseBuffers.has(engine.noise.noiseType)) {
                        const source = audioContextRef.current!.createBufferSource();
                        source.buffer = noiseBuffers.get(engine.noise.noiseType)!;
                        source.connect(nodes.noise.volumeGain);
                        source.start(time);
                        source.stop(time + noteDuration);
                    }
                    if (engine.sampler.enabled && decodedSamples.has(engine.id)) {
                        const source = audioContextRef.current!.createBufferSource();
                        source.buffer = decodedSamples.get(engine.id)!;
                        const rate = Math.pow(2, engine.sampler.transpose / 12);
                        source.playbackRate.value = rate;
                        source.connect(nodes.sampler.volumeGain);
                        source.start(time);
                        source.stop(time + noteDuration);
                    }
                    
                    // Apply envelope to the entire engine mix
                    nodes.sequencerGain.gain.cancelScheduledValues(time);
                    nodes.sequencerGain.gain.setValueAtTime(0, time);
                    nodes.sequencerGain.gain.linearRampToValueAtTime(1, time + 0.01);
                    nodes.sequencerGain.gain.exponentialRampToValueAtTime(0.0001, time + noteDuration);
                }
            });
        };

        const scheduler = () => {
            const context = audioContextRef.current!;
            const link = linkRef.current;
            const scheduleAheadTime = 0.1;

            while (nextStepTimeRef.current < context.currentTime + scheduleAheadTime) {
                let beat = 0;
                if (linkStatus.isEnabled && link) {
                    const sessionState = link.captureAppSessionState();
                    const currentQuantum = 4.0;
                    beat = Math.floor(sessionState.beatAtTime(nextStepTimeRef.current, currentQuantum) * 4);
                } else {
                    beat = currentStepRef.current;
                }
                
                scheduleNotes(beat, nextStepTimeRef.current);

                const sixteenthNoteDuration = 60.0 / linkStatus.bpm / 4.0;
                nextStepTimeRef.current += sixteenthNoteDuration;
                currentStepRef.current = (currentStepRef.current + 1) % 64;
            }
        };

        if (isTransportPlaying && isAudioInitialized) {
            const context = audioContextRef.current!;
            if (linkStatus.isEnabled && linkRef.current) {
                const sessionState = linkRef.current.captureAppSessionState();
                const currentQuantum = 4.0;
                const currentBeat = sessionState.beatAtTime(context.currentTime, currentQuantum);
                currentStepRef.current = Math.floor(currentBeat * 4);
                const timeToNext16th = (Math.ceil(currentBeat * 4) / 4 - currentBeat) * (60.0 / linkStatus.bpm);
                nextStepTimeRef.current = context.currentTime + timeToNext16th;
            } else {
                currentStepRef.current = 0;
                nextStepTimeRef.current = context.currentTime;
            }
            if(schedulerTimerRef.current) clearInterval(schedulerTimerRef.current);
            schedulerTimerRef.current = window.setInterval(scheduler, 25);
        } else {
            if (schedulerTimerRef.current) {
                clearInterval(schedulerTimerRef.current);
                schedulerTimerRef.current = null;
            }
        }
        
        return () => {
            if (schedulerTimerRef.current) {
                clearInterval(schedulerTimerRef.current);
                schedulerTimerRef.current = null;
            }
        };
    }, [isTransportPlaying, isAudioInitialized, linkStatus, engines, decodedSamples, noiseBuffers]);

    // LFO Logic
    useEffect(() => {
        if (!isAudioInitialized || !lfoOscillatorRef.current || !lfoGainRef.current || !lfoRoutingNodesRef.current) return;
        const audioContext = audioContextRef.current;
        const now = audioContext.currentTime;

        const shape = lfoState.shape;
        lfoOscillatorRef.current.type = shape === 'ramp' ? 'sawtooth' : shape;
        
        let rate = lfoState.rate;
        if(lfoState.sync) {
            try {
              const noteDuration = 60 / linkStatus.bpm;
              // Safer evaluation
              const syncRateParts = lfoState.syncRate.split('/');
              const numerator = parseFloat(syncRateParts[0]);
              const denominator = parseFloat(syncRateParts[1] || '1');
              if (!isNaN(numerator) && !isNaN(denominator) && denominator !== 0) {
                  const multiplier = numerator / denominator;
                  rate = 1 / (noteDuration * multiplier);
              }
            } catch (e) {
                console.error("Error calculating sync rate", e);
                rate = 1.0; // fallback
            }
        }
        lfoOscillatorRef.current.frequency.setTargetAtTime(rate, now, 0.01);
        lfoGainRef.current.gain.setTargetAtTime(lfoState.depth, now, 0.01);

        const { filterCutoffScaler, filterResonanceScaler } = lfoRoutingNodesRef.current;
        filterCutoffScaler.gain.setTargetAtTime(lfoState.routing.filterCutoff ? 5000 : 0, now, 0.01);
        filterResonanceScaler.gain.setTargetAtTime(lfoState.routing.filterResonance ? 10 : 0, now, 0.01);

        engines.forEach((engine, index) => {
            const engineKey = `engine${index+1}Vol` as keyof LFOState['routing'];
            const nodes = audioNodesRef.current.get(engine.id);
            if (nodes?.lfoVolumeScaler) {
                nodes.lfoVolumeScaler.gain.setTargetAtTime(lfoState.routing[engineKey] ? 1 : 0, now, 0.01);
            }
        });

    }, [lfoState, isAudioInitialized, linkStatus.bpm, engines]);


    useEffect(() => {
        if (!isAudioInitialized || !masterGainRef.current || !masterFilterRef.current) return;
        const now = audioContextRef.current!.currentTime;
        masterGainRef.current.gain.setTargetAtTime(masterVolume, now, 0.01);
        masterFilterRef.current.type = globalFilterType;
        masterFilterRef.current.frequency.setTargetAtTime(globalFilterCutoff, now, 0.01);
        masterFilterRef.current.Q.setTargetAtTime(globalFilterResonance, now, 0.01);
    }, [masterVolume, globalFilterCutoff, globalFilterResonance, globalFilterType, isAudioInitialized]);


    useEffect(() => {
        if (window.AbletonLink) {
            const link = new window.AbletonLink();
            linkRef.current = link;
            link.on('tempo', (bpm: number) => setLinkStatus(p => ({ ...p, bpm: Math.round(bpm) })));
            link.on('numPeers', (peers: number) => setLinkStatus(p => ({ ...p, peers })));
            link.on('isLinkEnabled', (isEnabled: boolean) => setLinkStatus(p => ({ ...p, isEnabled })));
            link.on('startPlaying', () => setIsTransportPlaying(true));
            link.on('stopPlaying', () => setIsTransportPlaying(false));
            return () => { if (linkRef.current) linkRef.current.enable(false); };
        }
    }, []);

    const handleUpdateEngine = useCallback((engineId: string, updates: Partial<EngineState>) => {
        setEngines(prevEngines => prevEngines.map(e => {
            if (e.id === engineId) {
                const newState = { ...e, ...updates };
                if (updates.sequencerSteps !== undefined) {
                    if (newState.sequencerPulses > updates.sequencerSteps) {
                        newState.sequencerPulses = updates.sequencerSteps;
                    }
                    if (newState.sequencerRotate >= updates.sequencerSteps) {
                        newState.sequencerRotate = Math.max(0, updates.sequencerSteps - 1);
                    }
                }
                return newState;
            }
            return e;
        }));
    }, []);

    // FIX: Changed to a function expression to avoid TSX parsing ambiguity with generics.
    const handleUpdateEngineLayer = useCallback(function <K extends keyof Omit<EngineState, 'id' | 'name'>>(
        engineId: string,
        layer: K,
        updates: Partial<EngineState[K]>
    ) {
        setEngines(prevEngines => prevEngines.map(e => {
            if (e.id === engineId) {
                const layerValue = e[layer];
                if (typeof layerValue === 'object' && layerValue !== null) {
                    return { ...e, [layer]: { ...layerValue, ...updates } };
                }
            }
            return e;
        }));
    }, []);

    const handleToggleTransport = useCallback(() => {
      const newIsPlaying = !isTransportPlaying;
      if (linkStatus.isEnabled && linkRef.current) {
          linkRef.current.setIsPlaying(newIsPlaying);
      }
      setIsTransportPlaying(newIsPlaying);
    }, [isTransportPlaying, linkStatus.isEnabled]);
    
    const handleLoadSample = useCallback(async (engineId: string, file: File) => {
        if (!audioContextRef.current) return;
        if (!file.type.startsWith('audio/')) {
            alert('Invalid file type. Please load an audio file.');
            return;
        }
        try {
            const arrayBuffer = await file.arrayBuffer();
            const audioBuffer = await audioContextRef.current.decodeAudioData(arrayBuffer);
            setDecodedSamples(prev => new Map(prev).set(engineId, audioBuffer));
            handleUpdateEngineLayer(engineId, 'sampler', { sampleName: file.name, enabled: true });
        } catch (error) {
            console.error("Failed to decode audio file:", error);
            alert("Failed to load sample. Please check the file format.");
        }
    }, [handleUpdateEngineLayer]);

    const handleRandomize = useCallback((mode: RandomizeMode, scope: 'global' | 'master' | 'lfo' | string = 'global') => {
        const randomizeEngine = (engine: EngineState, currentMode: RandomizeMode): EngineState => {
            const steps = getRandomInt(4, 32);
            const pulses = getRandomInt(1, steps);
            const rotate = getRandomInt(0, steps - 1);

            const randomFreq = getRandomElement(solfeggioFrequencies);

            return {
                ...engine,
                sequencerEnabled: getRandomBool(0.8),
                sequencerSteps: steps,
                sequencerPulses: pulses,
                sequencerRotate: rotate,
                synth: {
                    ...engine.synth,
                    enabled: getRandomBool(0.7),
                    volume: getRandom(0.4, 0.9),
                    oscillatorType: getRandomElement(oscillatorTypes),
                    frequency: currentMode === 'solfeggio' ? randomFreq.value : getRandom(100, 1500),
                    solfeggioFrequency: currentMode === 'solfeggio' ? String(randomFreq.value) : engine.synth.solfeggioFrequency,
                },
                noise: {
                    ...engine.noise,
                    enabled: getRandomBool(0.5),
                    volume: getRandom(0.2, 0.7),
                    noiseType: getRandomElement(noiseTypes),
                },
                sampler: {
                    ...engine.sampler,
                    enabled: engine.sampler.sampleName ? getRandomBool(0.3) : false,
                    volume: getRandom(0.5, 1.0),
                    transpose: getRandomInt(-12, 12),
                },
                effects: {
                    ...engine.effects,
                    distortion: getRandom(0, 0.7),
                    delayTime: getRandom(0, 1),
                    delayFeedback: getRandom(0, 0.85),
                }
            };
        };

        if (scope === 'global' || scope === 'master') {
            setGlobalFilterType(getRandomElement(filterTypes));
            setGlobalFilterCutoff(getRandom(100, 10000));
            setGlobalFilterResonance(getRandom(0.1, 15));
            setMasterVolume(getRandom(0.5, 1.0));
        }

        if (scope === 'global' || scope === 'lfo') {
            const newRouting: LFOState['routing'] = {
                filterCutoff: getRandomBool(0.3),
                filterResonance: getRandomBool(0.3),
                engine1Vol: getRandomBool(0.3),
                engine2Vol: getRandomBool(0.3),
                engine3Vol: getRandomBool(0.3),
            };
            setLFOState({
                shape: getRandomElement(lfoShapes),
                sync: getRandomBool(0.5),
                syncRate: getRandomElement(lfoSyncRates),
                rate: getRandom(0.1, 20),
                depth: getRandom(0.2, 1.0),
                routing: newRouting,
            });
        }
        
        if (scope === 'global') {
            setEngines(prev => prev.map(engine => randomizeEngine(engine, mode)));
        } else if (scope !== 'master' && scope !== 'lfo') {
            setEngines(prev => prev.map(engine => engine.id === scope ? randomizeEngine(engine, mode) : engine));
        }

    }, []);

    const handleToggleLink = useCallback(() => { if (linkRef.current) linkRef.current.enable(!linkStatus.isEnabled); }, [linkStatus.isEnabled]);
    const handleSetBPM = useCallback((bpm: number) => {
        setLinkStatus(s => ({...s, bpm}));
        if (linkRef.current && !linkStatus.isEnabled) linkRef.current.setTempo(bpm);
    }, [linkStatus.isEnabled]);

    return (
        <div className="app-container">
            {!isAudioInitialized && (
                <div className="init-overlay">
                    <button onClick={initAudio}>Initialize Audio Engine</button>
                </div>
            )}
            <header className="header">
                <h1>Poly-Rhythm Synth</h1>
            </header>
            <div className="main-grid">
                {masterAnalyserRef.current && (
                    <div className="master-visualizer-container">
                        <Visualizer analyserNode={masterAnalyserRef.current} type="frequency" />
                    </div>
                )}
                 <MasterControls
                    masterVolume={masterVolume}
                    setMasterVolume={setMasterVolume}
                    linkStatus={linkStatus}
                    toggleLink={handleToggleLink}
                    setBPM={handleSetBPM}
                    globalFilterCutoff={globalFilterCutoff}
                    setGlobalFilterCutoff={setGlobalFilterCutoff}
                    globalFilterResonance={globalFilterResonance}
                    setGlobalFilterResonance={setGlobalFilterResonance}
                    globalFilterType={globalFilterType}
                    setGlobalFilterType={setGlobalFilterType}
                    isTransportPlaying={isTransportPlaying}
                    onToggleTransport={handleToggleTransport}
                    onRandomize={(mode) => handleRandomize(mode, 'master')}
                />
                <div className="channels-container">
                    {engines.map(engine => (
                        <EngineControls
                            key={engine.id}
                            engine={engine}
                            onUpdate={handleUpdateEngine}
                            onLayerUpdate={handleUpdateEngineLayer}
                            onLoadSample={handleLoadSample}
                            onRandomize={(mode) => handleRandomize(mode, engine.id)}
                            analyserNode={audioNodesRef.current.get(engine.id)?.analyser}
                            currentStep={currentStep}
                            isTransportPlaying={isTransportPlaying}
                        />
                    ))}
                </div>
                <LFOControls 
                    lfoState={lfoState} 
                    setLFOState={setLFOState} 
                    linkStatus={linkStatus} 
                    onRandomize={(mode) => handleRandomize(mode, 'lfo')}
                />
                <Randomizer onRandomize={handleRandomize} />
            </div>
        </div>
    );
};

const container = document.getElementById('root');
if (container) {
    const root = createRoot(container);
    root.render(<React.StrictMode><App /></React.StrictMode>);
}
