# Poly-Rhythm Synth - Developer Guide & AI Context

This document serves as a technical reference for maintaining and extending the Poly-Rhythm Synth. It is designed to help developers (and AI assistants) understand the codebase's architecture, core logic, and common pitfalls.

## 1. Project Structure

*   **`index.tsx`**: The core application file. It contains:
    *   **State Management**: All React state (`useState`, `useRef`) for the synth.
    *   **Audio Engine**: Web Audio API initialization, node creation, and connection logic.
    *   **UI Components**: All React components (TopBar, EngineControls, etc.) are currently defined within this file or as sub-components.
    *   **Logic**: Sequencer, Randomization, and MIDI handling.
*   **`factoryPresets.ts`**: Contains the `FACTORY_PRESETS` array and the `createDefaultState` helper.
    *   **Important**: When modifying factory presets, you must ensure the `localStorage` loading logic in `index.tsx` is updated to force an overwrite, otherwise users will see cached, stale versions.
*   **`index.css`**: Global styles and utility classes.

## 2. Core Architecture

### State Management & Audio Callbacks
The synth uses a hybrid state approach:
*   **React State**: Used for UI rendering (`engines`, `lfos`, `filter1State`, etc.).
*   **Refs (`latestStateRef`)**: Critical for the audio engine. The `scheduler` and `handleMidiMessage` functions run outside the React render cycle (often in `requestAnimationFrame` or event listeners). They **MUST** access state via `latestStateRef.current` to avoid stale closures.
    *   *Rule*: Whenever you add a new state variable that affects audio/sequencing, add it to `latestStateRef` in the main `useEffect` (around line 4670).

### Audio Graph
The audio signal flow is as follows:
1.  **Sources**: Oscillators (Synth), Noise Buffers, or Audio Buffers (Sampler).
2.  **Engine Mixer**: Each engine mixes its 3 layers (Synth, Noise, Sampler) into an `engineMixer` node.
3.  **Analyser**: `engineMixer` -> `analyser` (for visualizer).
4.  **Final Output**: `analyser` -> `finalOutput`.
5.  **Master Bus**: All engines' `finalOutput` nodes connect to `masterBus`.
    *   *Note*: Per-engine routing to filters is currently **not implemented** in the audio graph, despite the `filterRouting` state structure suggesting it. All engines go to `masterBus`.
6.  **Filters**: `masterBus` connects to Filter 1 and/or Filter 2 based on `filterRouting.serial` (Series vs Parallel).
7.  **Master Effects**: The output of the filters goes through the `masterEffects` chain (Distortion -> Delay -> etc.).
8.  **Master Volume**: Final effect -> `masterVolumeNode` -> `masterAnalyser` -> `Destination`.

### Sequencing & Timing
*   **Clock**: Can be "internal" or "midi".
*   **Scheduler**: A recursive `setTimeout` loop (lookahead scheduler) manages timing.
    *   It schedules notes (`noteOn`) and granular grains slightly in the future (`scheduleAheadTime`).
    *   It uses `audioContext.currentTime` for precise timing.
*   **Granular Engine**: Runs its own scheduling loop within the main scheduler to trigger grains.

## 3. Key Features Implementation

### Randomization ("Randomorph")
*   **`createRandomizedState()`**: Generates a new full state object.
    *   Respects **Parameter Locks** (`lockState`).
    *   Respects **Harmonic Mode** (`harmonicTuningSystem`) for melodic generation.
*   **Morphing**:
    *   If `morphTime < 50ms`: State is updated immediately.
    *   If `morphTime >= 50ms`: An animation loop (`requestAnimationFrame`) interpolates between `morphStartRef` and `morphTargetRef` over the duration.
    *   *Safety*: The loop has checks for `NaN` duration/progress to prevent hanging.

### MIDI Handling
*   **`useMidi` Hook**: Manages MIDI access and input selection.
*   **`handleMidiMessage`**: Processes Note On/Off and Clock messages.
    *   **Voicing**: Respects "Poly", "Mono", and "Legato" modes.
        *   *Mono*: Kills previous note on the *same engine*.
        *   *Legato*: Retriggers envelope but glides pitch if `Glide Time > 0`.

## 4. Maintenance & Common Pitfalls

### Adding New Features
1.  **New Parameters**:
    *   Add to interfaces (`EngineState`, `FilterState`, etc.).
    *   Update `createDefaultState` in `factoryPresets.ts`.
    *   Update `latestStateRef` in `index.tsx`.
    *   Update `onLoadPreset` to handle missing values (defaulting).
2.  **New Effects**:
    *   Add to `MasterEffectType`.
    *   Update `MasterEffects` component for UI.
    *   Update `updateAudioGraph` (specifically the `masterEffects` reduction loop) to handle the new node type.

### Troubleshooting Guide
*   **Silent Presets**:
    *   Check Filter Cutoff (is it too low?).
    *   Check Filter Resonance (is it too high?).
    *   Check LFO Modulation (is it driving frequency negative?).
    *   Check `localStorage` (is it loading an old broken version?).
*   **Randomization Broken**:
    *   Check `handleRandomize` dependencies. Missing dependencies (like `morphTime` or `harmonicTuningSystem`) cause stale logic.
    *   Check `morphTime` (is it undefined?).
*   **Panic Button**:
    *   Ensure it *stays* muted. Don't ramp volume back up immediately.

### Critical "Do Not Touch" Areas
*   **`DEFAULT_ROUTING`**: Be careful modifying this in `factoryPresets.ts`. It's used as a spread base.
*   **Audio Context Initialization**: The `initializeAudio` function handles the delicate startup sequence (creating context, dummy gain for LFOs).
