import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI, Type } from "@google/genai";

// --- Type Definitions ---
type OscillatorType = 'sine' | 'square' | 'sawtooth' | 'triangle';
type NoiseType = 'white' | 'pink' | 'brown';
type ChannelType = 'synth' | 'sample' | 'noise';
type LFO_Shape = 'sine' | 'square' | 'sawtooth' | 'triangle';
type FilterType = 'lowpass' | 'highpass' | 'bandpass' | 'notch';
type RandomizeMode = 'chaos' | 'solfeggio';

interface EffectState {
  distortion: number; // 0 to 1
  delayTime: number; // in seconds
  delayFeedback: number; // 0 to 1
}

interface ChannelState {
  id: string;
  name: string;
  volume: number;
  // Synth specific
  frequency?: number;
  oscillatorType?: OscillatorType;
  solfeggioFrequency?: string;
  // Sample specific
  channelType: ChannelType;
  sampleName?: string | null;
  // Noise specific
  noiseType?: NoiseType;
  // Sequencer
  sequencerEnabled: boolean;
  sequencerSteps: number;
  sequencerPulses: number;
  sequencerRotate: number;
  // Effects
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
        channel1Vol: boolean;
        channel2Vol: boolean;
        channel3Vol: boolean;
    }
}

interface AudioNodes {
  oscillator?: OscillatorNode;
  sourceGain: GainNode; // Used for sequencer note envelope
  channelVolumeGain: GainNode; // Used for volume slider
  lfoVolumeScaler: GainNode; // Used for LFO volume modulation
  analyser: AnalyserNode;
  // Effects chain
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
  backgroundColor?: string;
  strokeColor?: string | CanvasGradient;
}

interface CircularVisualizerSequencerProps {
    analyserNode: AnalyserNode;
    steps: number;
    pulses: number;
    rotate: number;
    currentStep: number;
    isTransportPlaying: boolean;
}

interface ChannelControlsProps {
  channel: ChannelState;
  onUpdate: (id: string, updates: Partial<ChannelState>) => void;
  onToggleSequencer: (id: string) => void;
  onLoadSample: (channelId: string, file: File) => void;
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
const lfoShapes: LFO_Shape[] = ['sine', 'square', 'sawtooth', 'triangle'];
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


// --- Components ---

const Visualizer: React.FC<VisualizerProps> = ({
  analyserNode,
  type,
  backgroundColor = 'transparent',
  strokeColor = '#bb86fc',
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const canvasCtx = canvas.getContext('2d');
    let animationFrameId: number;

    const draw = () => {
      if (!canvasCtx) return;
      
      const { width, height } = canvas;
      canvasCtx.fillStyle = backgroundColor;
      canvasCtx.fillRect(0, 0, width, height);

      if (type === 'waveform') {
        analyserNode.fftSize = 2048;
        const bufferLength = analyserNode.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        analyserNode.getByteTimeDomainData(dataArray);

        canvasCtx.lineWidth = 2;
        canvasCtx.strokeStyle = typeof strokeColor === 'string' ? strokeColor : '#bb86fc';
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
        canvasCtx.lineTo(width, height / 2);
        canvasCtx.stroke();
      } else { // frequency
        analyserNode.fftSize = 256;
        const bufferLength = analyserNode.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        analyserNode.getByteFrequencyData(dataArray);
        
        canvasCtx.lineWidth = 2;
        const barWidth = (width / bufferLength) * 2.5;
        let x = 0;
        for (let i = 0; i < bufferLength; i++) {
          const barHeight = dataArray[i];
          if (strokeColor instanceof CanvasGradient) {
             canvasCtx.fillStyle = strokeColor;
          } else {
             canvasCtx.fillStyle = 'rgb(' + (barHeight + 100) + ',50,50)';
          }
          canvasCtx.fillRect(x, height - barHeight / 2, barWidth, barHeight / 2);
          x += barWidth + 1;
        }
      }
      animationFrameId = requestAnimationFrame(draw);
    };

    draw();

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [analyserNode, type, backgroundColor, strokeColor]);

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

            // Draw playhead
            if (isTransportPlaying) {
                const stepInPattern = currentStep;
                const angle = (stepInPattern / steps) * 2 * Math.PI - Math.PI / 2;
                const x = centerX + radius * Math.cos(angle);
                const y = centerY + radius * Math.sin(angle);
                ctx.beginPath();
                ctx.fillStyle = '#ffd700'; // Gold playhead
                ctx.arc(x, y, 7, 0, 2 * Math.PI);
                ctx.strokeStyle = 'white';
                ctx.lineWidth = 2;
                ctx.stroke();
                ctx.fill();
            }
            
            // Draw spectrum analyzer in the center
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


const ChannelControls: React.FC<ChannelControlsProps> = ({ channel, onUpdate, onToggleSequencer, onLoadSample, onRandomize, analyserNode, currentStep, isTransportPlaying }) => {
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => { e.preventDefault(); e.stopPropagation(); setIsDraggingOver(true); };
  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => { e.preventDefault(); e.stopPropagation(); setIsDraggingOver(false); };
  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault(); e.stopPropagation(); setIsDraggingOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      onLoadSample(channel.id, e.dataTransfer.files[0]);
      e.dataTransfer.clearData();
    }
  };
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => { if (e.target.files && e.target.files.length > 0) { onLoadSample(channel.id, e.target.files[0]); } };
  const handleLoadClick = () => { fileInputRef.current?.click(); };


  return (
    <div className="control-group">
      <div className="control-group-header">
        <h2>{channel.name}</h2>
        <div className="randomizer-buttons-group">
          <button title="Chaos Randomize" onClick={() => onRandomize('chaos')}>🎲</button>
          <button title="Musical Randomize" onClick={() => onRandomize('solfeggio')}>🎵</button>
        </div>
      </div>
       {analyserNode && (
        <div className="channel-visualizer-container">
          <CircularVisualizerSequencer 
            analyserNode={analyserNode}
            steps={channel.sequencerSteps}
            pulses={channel.sequencerPulses}
            rotate={channel.sequencerRotate}
            currentStep={currentStep % channel.sequencerSteps}
            isTransportPlaying={isTransportPlaying}
          />
        </div>
       )}
       <div className="control-row">
           <label>Enable Sequencer</label>
            <button 
              onClick={() => onToggleSequencer(channel.id)} 
              className={channel.sequencerEnabled ? 'active' : ''}
            >
              {channel.sequencerEnabled ? 'On' : 'Off'}
            </button>
      </div>
      <div className="control-row">
        <label htmlFor={`volume-${channel.id}`}>Volume</label>
        <div className="control-value-wrapper">
          <input type="range" id={`volume-${channel.id}`} min="0" max="1" step="0.01" value={channel.volume} onChange={(e) => onUpdate(channel.id, { volume: parseFloat(e.target.value) })} />
          <span>{channel.volume.toFixed(2)}</span>
        </div>
      </div>
       <div className="control-row">
        <label htmlFor={`steps-${channel.id}`}>Steps</label>
        <div className="control-value-wrapper">
          <input type="range" id={`steps-${channel.id}`} min="1" max="32" step="1" value={channel.sequencerSteps} onChange={(e) => onUpdate(channel.id, { sequencerSteps: parseInt(e.target.value, 10) })} />
          <span>{channel.sequencerSteps}</span>
        </div>
      </div>
       <div className="control-row">
        <label htmlFor={`pulses-${channel.id}`}>Pulses</label>
        <div className="control-value-wrapper">
          <input type="range" id={`pulses-${channel.id}`} min="0" max={channel.sequencerSteps} step="1" value={channel.sequencerPulses} onChange={(e) => onUpdate(channel.id, { sequencerPulses: parseInt(e.target.value, 10) })} />
          <span>{channel.sequencerPulses}</span>
        </div>
      </div>
       <div className="control-row">
        <label htmlFor={`rotate-${channel.id}`}>Rotate</label>
        <div className="control-value-wrapper">
          <input type="range" id={`rotate-${channel.id}`} min="0" max={channel.sequencerSteps - 1} step="1" value={channel.sequencerRotate} onChange={(e) => onUpdate(channel.id, { sequencerRotate: parseInt(e.target.value, 10) })} />
          <span>{channel.sequencerRotate}</span>
        </div>
      </div>
      {channel.channelType === 'synth' && (
        <>
          <div className="control-row">
            <label htmlFor={`freq-${channel.id}`}>Solfeggio</label>
            <select value={channel.solfeggioFrequency} onChange={(e) => onUpdate(channel.id, { solfeggioFrequency: e.target.value, frequency: parseFloat(e.target.value) })}>
              {solfeggioFrequencies.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
            </select>
          </div>
          <div className="control-row">
            <label htmlFor={`osc-type-${channel.id}`}>Waveform</label>
            <select id={`osc-type-${channel.id}`} value={channel.oscillatorType} onChange={(e) => onUpdate(channel.id, { oscillatorType: e.target.value as OscillatorType })}>
              {oscillatorTypes.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
            </select>
          </div>
        </>
      )}
      {channel.channelType === 'noise' && (
        <div className="control-row">
          <label htmlFor={`noise-type-${channel.id}`}>Noise Type</label>
          <select id={`noise-type-${channel.id}`} value={channel.noiseType} onChange={(e) => onUpdate(channel.id, { noiseType: e.target.value as NoiseType })}>
            {noiseTypes.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
          </select>
        </div>
      )}
       {channel.channelType === 'sample' && (
         <div 
           className={`drop-zone ${isDraggingOver ? 'drop-zone-active' : ''}`} 
           onDragOver={handleDragOver} 
           onDragLeave={handleDragLeave} 
           onDrop={handleDrop}
           onClick={handleLoadClick}
           style={{cursor: 'pointer'}}
         >
           <input type="file" ref={fileInputRef} onChange={handleFileChange} style={{display: 'none'}} accept="audio/*" />
           {channel.sampleName ? 
            <div>
              <span>{channel.sampleName}</span>
              <span className="replace-sample-text">(Click or drop to replace)</span>
            </div>
            : <span>Drop file or click to load</span>
           }
        </div>
      )}
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
                    <button title="Musical Randomize" onClick={() => props.onRandomize('solfeggio')}>🎵</button>
                </div>
            </div>
            <div className="control-row">
                <label>Transport</label>
                <button onClick={props.onToggleTransport} className={props.isTransportPlaying ? 'active' : ''}>
                    {props.isTransportPlaying ? 'Stop' : 'Play'}
                </button>
            </div>
             <div className="control-row">
                <label htmlFor="master-volume">Master Volume</label>
                <div className="control-value-wrapper">
                  <input type="range" id="master-volume" min="0" max="1" step="0.01" value={props.masterVolume} onChange={(e) => props.setMasterVolume(parseFloat(e.target.value))} />
                  <span>{props.masterVolume.toFixed(2)}</span>
                </div>
            </div>
            <div className="control-row">
                <label htmlFor="filter-type">Filter Type</label>
                <select value={props.globalFilterType} onChange={(e) => props.setGlobalFilterType(e.target.value as FilterType)}>
                    {filterTypes.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
            </div>
             <div className="control-row">
                <label htmlFor="filter-cutoff">Filter Cutoff</label>
                <div className="control-value-wrapper">
                  <input type="range" id="filter-cutoff" min="20" max="20000" step="1" value={props.globalFilterCutoff} onChange={(e) => props.setGlobalFilterCutoff(parseFloat(e.target.value))} />
                  <span>{Math.round(props.globalFilterCutoff)} Hz</span>
                </div>
            </div>
             <div className="control-row">
                <label htmlFor="filter-resonance">Filter Resonance</label>
                <div className="control-value-wrapper">
                  <input type="range" id="filter-resonance" min="0" max="20" step="0.1" value={props.globalFilterResonance} onChange={(e) => props.setGlobalFilterResonance(parseFloat(e.target.value))} />
                  <span>{props.globalFilterResonance.toFixed(1)}</span>
                </div>
            </div>
            <div className="control-row">
                <label htmlFor="bpm">BPM</label>
                <div className="control-value-wrapper">
                  <input type="range" id="bpm" min="60" max="240" step="1" value={props.linkStatus.bpm} onChange={(e) => props.setBPM(parseInt(e.target.value, 10))} disabled={props.linkStatus.isEnabled} />
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
                    <button title="Musical Randomize" onClick={() => onRandomize('solfeggio')}>🎵</button>
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


// --- Main App Component ---
const App = () => {
    const [channels, setChannels] = useState<ChannelState[]>([
        { id: '1', name: 'Synth 1', volume: 0.5, frequency: 528, oscillatorType: 'sawtooth', solfeggioFrequency: '528', channelType: 'synth', sequencerEnabled: true, sequencerSteps: 16, sequencerPulses: 4, sequencerRotate: 0, effects: { distortion: 0, delayTime: 0, delayFeedback: 0 } },
        { id: '2', name: 'Noise OSC', volume: 0.3, channelType: 'noise', noiseType: 'white', sequencerEnabled: true, sequencerSteps: 16, sequencerPulses: 8, sequencerRotate: 8, effects: { distortion: 0, delayTime: 0, delayFeedback: 0 } },
        { id: '3', name: 'Sampler', volume: 0.8, channelType: 'sample', sampleName: null, sequencerEnabled: false, sequencerSteps: 8, sequencerPulses: 3, sequencerRotate: 0, effects: { distortion: 0, delayTime: 0, delayFeedback: 0 } },
    ]);
    const [masterVolume, setMasterVolume] = useState(0.8);
    const [linkStatus, setLinkStatus] = useState<LinkStatus>({ isEnabled: false, bpm: 120, peers: 0 });
    const [lfoState, setLFOState] = useState<LFOState>({ rate: 5, depth: 0.5, shape: 'sine', sync: false, syncRate: '1/4', routing: { filterCutoff: false, filterResonance: false, channel1Vol: false, channel2Vol: false, channel3Vol: false } });
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
    const audioNodesRef = useRef<Map<string, AudioNodes>>(new Map());
    const [decodedSamples, setDecodedSamples] = useState<Map<string, AudioBuffer>>(new Map());
    const [noiseBuffers, setNoiseBuffers] = useState<Map<NoiseType, AudioBuffer>>(new Map());

    const lfoOscillatorRef = useRef<OscillatorNode | null>(null);
    const lfoGainRef = useRef<GainNode | null>(null);
    const lfoRoutingNodesRef = useRef<LfoRoutingNodes | null>(null);

    const linkRef = useRef<any>(null);
    
    // Refs for scheduling to avoid re-renders and stale closures
    const schedulerTimerRef = useRef<number | null>(null);
    const nextStepTimeRef = useRef(0);
    const currentStepRef = useRef(0);


    const masterVisualizerGradient = useMemo(() => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) return '#fff';
        const gradient = ctx.createLinearGradient(0, 0, 300, 0);
        gradient.addColorStop(0, '#bb86fc');
        gradient.addColorStop(0.5, '#f079d6');
        gradient.addColorStop(1, '#03dac6');
        return gradient;
    }, []);

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
        audioContextRef.current = context;
        masterGainRef.current = context.createGain();
        masterFilterRef.current = context.createBiquadFilter();
        masterAnalyserRef.current = context.createAnalyser();
        masterFilterRef.current.connect(masterGainRef.current);
        masterGainRef.current.connect(masterAnalyserRef.current);
        masterAnalyserRef.current.connect(context.destination);
        
        // LFO Setup
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


        setNoiseBuffers(await generateNoiseSamples(context));
        setIsAudioInitialized(true);
    }, [isAudioInitialized, generateNoiseSamples]);

    // Setup and update audio nodes
    useEffect(() => {
        if (!isAudioInitialized || !audioContextRef.current || !lfoGainRef.current) return;
        const audioContext = audioContextRef.current;
        channels.forEach(channel => {
            let nodes = audioNodesRef.current.get(channel.id);
            if (!nodes) {
                const sourceGain = audioContext.createGain();
                const channelVolumeGain = audioContext.createGain();
                const lfoVolumeScaler = audioContext.createGain();
                const analyser = audioContext.createAnalyser();
                
                sourceGain.connect(channelVolumeGain);
                channelVolumeGain.connect(analyser);
                analyser.connect(masterFilterRef.current!);

                // LFO connection
                lfoVolumeScaler.gain.value = 0;
                lfoGainRef.current!.connect(lfoVolumeScaler);
                lfoVolumeScaler.connect(channelVolumeGain.gain);

                nodes = { sourceGain, channelVolumeGain, analyser, lfoVolumeScaler };
                audioNodesRef.current.set(channel.id, nodes);
            }

            if (channel.channelType === 'synth') {
                if (!nodes.oscillator) {
                    nodes.oscillator = audioContext.createOscillator();
                    nodes.oscillator.connect(nodes.sourceGain);
                    nodes.oscillator.start();
                }
                nodes.oscillator.type = channel.oscillatorType!;
                nodes.oscillator.frequency.setTargetAtTime(channel.frequency!, audioContext.currentTime, 0.01);
            } else {
                 if (nodes.oscillator) {
                    nodes.oscillator.disconnect();
                    nodes.oscillator.stop();
                    delete nodes.oscillator;
                }
            }

            nodes.channelVolumeGain.gain.setTargetAtTime(channel.volume, audioContext.currentTime, 0.01);
            nodes.sourceGain.gain.setValueAtTime(0, audioContext.currentTime);
        });
    }, [isAudioInitialized, channels]);

     // Master Clock and Sequencer Triggering
    useEffect(() => {
        const scheduleNotes = (beat: number, time: number) => {
            setCurrentStep(beat % 16); // For UI display
            channels.forEach(channel => {
                const nodes = audioNodesRef.current.get(channel.id);
                if (!channel.sequencerEnabled || !nodes) return;
                
                const pattern = rotatePattern(generateEuclideanPattern(channel.sequencerSteps, channel.sequencerPulses), channel.sequencerRotate);
                const stepInPattern = beat % channel.sequencerSteps;

                if (pattern[stepInPattern] === 1) {
                    if (channel.channelType === 'sample' || channel.channelType === 'noise') {
                         let buffer: AudioBuffer | undefined;
                         if (channel.channelType === 'sample') buffer = decodedSamples.get(channel.id);
                         else if (channel.channelType === 'noise' && channel.noiseType) buffer = noiseBuffers.get(channel.noiseType);
                        
                         if (buffer) {
                            const source = audioContextRef.current!.createBufferSource();
                            source.buffer = buffer;
                            source.connect(nodes.sourceGain);
                            source.start(time);
                         }
                    }
                    // Apply envelope to all types
                    nodes.sourceGain.gain.cancelScheduledValues(time);
                    nodes.sourceGain.gain.setValueAtTime(0, time);
                    nodes.sourceGain.gain.linearRampToValueAtTime(1, time + 0.01);
                    nodes.sourceGain.gain.exponentialRampToValueAtTime(0.0001, time + 0.2);
                }
            });
        };

        const scheduler = () => {
            const context = audioContextRef.current!;
            const link = linkRef.current;
            const scheduleAheadTime = 0.1; // seconds

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
                currentStepRef.current = (currentStepRef.current + 1) % 64; // Assuming 4 bars max sequence
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
            schedulerTimerRef.current = window.setInterval(scheduler, 25); // Run scheduler every 25ms
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
    }, [isTransportPlaying, isAudioInitialized, linkStatus, channels, decodedSamples, noiseBuffers]);

    // LFO Logic
    useEffect(() => {
        if (!isAudioInitialized || !lfoOscillatorRef.current || !lfoGainRef.current || !lfoRoutingNodesRef.current) return;
        const audioContext = audioContextRef.current;
        const now = audioContext.currentTime;

        lfoOscillatorRef.current.type = lfoState.shape;
        
        let rate = lfoState.rate;
        if(lfoState.sync) {
            const noteDuration = 60 / linkStatus.bpm;
            const syncRateParts = lfoState.syncRate.split('/').map(s => parseFloat(s.trim()));
            const syncMultiplier = syncRateParts.length > 1 ? syncRateParts[0] / syncRateParts[1] : syncRateParts[0];
            rate = 1 / (noteDuration * syncMultiplier);
        }
        lfoOscillatorRef.current.frequency.setTargetAtTime(rate, now, 0.01);
        lfoGainRef.current.gain.setTargetAtTime(lfoState.depth, now, 0.01);

        // --- ROUTING ---
        const { filterCutoffScaler, filterResonanceScaler } = lfoRoutingNodesRef.current;
        filterCutoffScaler.gain.setTargetAtTime(lfoState.routing.filterCutoff ? 5000 : 0, now, 0.01);
        filterResonanceScaler.gain.setTargetAtTime(lfoState.routing.filterResonance ? 10 : 0, now, 0.01);

        // Channel Volumes
        channels.forEach((channel, index) => {
            const channelKey = `channel${index+1}Vol` as keyof LFOState['routing'];
            const nodes = audioNodesRef.current.get(channel.id);
            if (nodes?.lfoVolumeScaler) {
                // Modulate the main volume, not the note envelope
                nodes.lfoVolumeScaler.gain.setTargetAtTime(lfoState.routing[channelKey] ? 1 : 0, now, 0.01);
            }
        });

    }, [lfoState, isAudioInitialized, linkStatus.bpm, channels]);


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

    const handleUpdateChannel = useCallback((id: string, updates: Partial<ChannelState>) => {
        setChannels(prevChannels => prevChannels.map(c => {
            if (c.id === id) {
                const newState = { ...c, ...updates };
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
            return c;
        }));
    }, []);
    const handleToggleSequencer = useCallback((id: string) => setChannels(p => p.map(c => c.id === id ? { ...c, sequencerEnabled: !c.sequencerEnabled } : c)), []);
    const handleToggleTransport = useCallback(() => {
      const newIsPlaying = !isTransportPlaying;
      if (linkStatus.isEnabled && linkRef.current) {
          linkRef.current.setIsPlaying(newIsPlaying);
      }
      setIsTransportPlaying(newIsPlaying);
    }, [isTransportPlaying, linkStatus.isEnabled]);
    
    const handleLoadSample = useCallback(async (channelId: string, file: File) => {
        if (!audioContextRef.current) return;
        if (!file.type.startsWith('audio/')) {
            alert('Invalid file type. Please load an audio file.');
            return;
        }
        try {
            const arrayBuffer = await file.arrayBuffer();
            const audioBuffer = await audioContextRef.current.decodeAudioData(arrayBuffer);
            setDecodedSamples(prev => new Map(prev).set(channelId, audioBuffer));
            setChannels(prev => prev.map(ch => ch.id === channelId ? { ...ch, sampleName: file.name, sequencerEnabled: true } : ch));
        } catch (error) {
            console.error("Failed to decode audio file:", error);
            alert("Failed to load sample. Please check the file format.");
        }
    }, []);

    const handleRandomize = useCallback((mode: RandomizeMode, scope: 'global' | 'master' | 'lfo' | string = 'global') => {
        const random = (min: number, max: number, floor = false) => {
            const val = Math.random() * (max - min) + min;
            return floor ? Math.floor(val) : val;
        };

        if (scope === 'global' || scope === 'lfo') {
            const newLFOState: LFOState = {
                ...lfoState,
                shape: lfoShapes[random(0, lfoShapes.length, true)],
                rate: random(0.1, 20),
                depth: random(0, 1),
                sync: Math.random() > 0.5,
                syncRate: lfoSyncRates[random(0, lfoSyncRates.length, true)],
                routing: {
                    filterCutoff: Math.random() > 0.5,
                    filterResonance: Math.random() > 0.5,
                    channel1Vol: Math.random() > 0.5,
                    channel2Vol: Math.random() > 0.5,
                    channel3Vol: Math.random() > 0.5,
                }
            };
            setLFOState(newLFOState);
        }

        if (scope === 'global' || scope === 'master') {
            setGlobalFilterCutoff(random(100, 15000));
            setGlobalFilterResonance(random(0, 20));
            setGlobalFilterType(filterTypes[random(0, filterTypes.length, true)]);
        }

        if (scope === 'global' || channels.some(c => c.id === scope)) {
            setChannels(prevChannels => prevChannels.map(c => {
                if (scope === 'global' || c.id === scope) {
                    const steps = random(4, 32, true);
                    const solfeggioFrequency = solfeggioFrequencies[random(0, solfeggioFrequencies.length, true)];
                    return {
                        ...c,
                        volume: random(0.2, 0.9),
                        sequencerEnabled: Math.random() > 0.3,
                        sequencerSteps: steps,
                        sequencerPulses: random(1, steps, true),
                        sequencerRotate: random(0, steps - 1, true),
                        oscillatorType: oscillatorTypes[random(0, oscillatorTypes.length, true)],
                        noiseType: noiseTypes[random(0, noiseTypes.length, true)],
                        frequency: mode === 'solfeggio' 
                            ? solfeggioFrequency.value
                            : random(100, 1000),
                        solfeggioFrequency: mode === 'solfeggio'
                            ? solfeggioFrequency.value.toString()
                            : c.solfeggioFrequency,
                        effects: {
                            distortion: random(0, 0.8),
                            delayTime: random(0, 1),
                            delayFeedback: random(0, 0.9)
                        }
                    };
                }
                return c;
            }));
        }
    }, [channels, lfoState]);

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
                        <Visualizer analyserNode={masterAnalyserRef.current} type="frequency" strokeColor={masterVisualizerGradient} />
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
                    {channels.map(channel => (
                        <ChannelControls
                            key={channel.id}
                            channel={channel}
                            onUpdate={handleUpdateChannel}
                            onToggleSequencer={handleToggleSequencer}
                            onLoadSample={handleLoadSample}
                            onRandomize={(mode) => handleRandomize(mode, channel.id)}
                            analyserNode={audioNodesRef.current.get(channel.id)?.analyser}
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