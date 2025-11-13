# Poly-Rhythm Synth

Poly-Rhythm Synth is a powerful and versatile web-based synthesizer that specializes in the creation of complex polyrhythms and generative music. It combines multiple synthesis engines, advanced sequencing capabilities, and a flexible modulation system to provide a unique and inspiring music creation experience.

## Features

*   **Three Independent Synthesis Engines:** Each engine can function as a synthesizer, a noise generator, or a sampler, allowing for rich and layered soundscapes.
    *   **Synth Layer:** Sine, square, sawtooth, and triangle oscillators.
    *   **Noise Layer:** White, pink, and brown noise.
    *   **Sampler Layer:** Load your own samples, record audio directly in the browser, or process live audio input. Features a granular synthesis mode with control over grain size, density, position, and jitter.
*   **Euclidean Rhythm Sequencers:** Each engine has its own circular sequencer with live spectral audio feedback based on Euclidean algorithms, making it easy to generate complex and interesting polyrhythms. Control steps, pulses, and rotation.
*   **Melodic Sequencing:** Each step in a sequence can be assigned a specific frequency, allowing for the creation of intricate melodies.
*   **Advanced Modulation Matrix:**
    *   **3 LFOs:** With sine, square, sawtooth, ramp, and triangle shapes, plus BPM sync.
    *   **Flexible Routing:** Route LFOs and even the engine sequencers to modulate a wide range of parameters, including filter cutoff/resonance, engine volume, synth frequency, sampler transpose, and all granular parameters.
*   **Comprehensive Effects Section:**
    *   **Dual Multi-Mode Filters:** Two filters (low-pass, high-pass, band-pass, notch) that can be configured in series or parallel.
    *   **Re-orderable Master Effects Chain:** A full suite of 8 master effects: Distortion, Delay, Reverb, Chorus, Flanger, Phaser, Tremolo, and a multi-band EQ.
*   **"Randomorph" Generative System:**
    *   **Multi-mode Randomization:** Instantly generate new patches using "Chaos," "Melodic," or "Rhythmic" modes.
    *   **Scoped Application:** Apply randomization globally or target specific modules like engines, filters, LFOs, or the routing matrix.
    *   **Parameter Locking:** Lock any parameter to protect it from randomization.
    *   **Smooth Morphing:** Seamlessly transition between the current patch and a new randomized one with BPM-syncable morph time.
    *   **Auto-Randomization:** Set the synth to automatically randomize itself at a BPM-synced interval.
*   **Diverse Tuning Systems:** Explore different tonal possibilities with support for various tuning systems, including Equal Temperament (440Hz and 432Hz), Just Intonation, Pythagorean tuning, Solfeggio frequencies, a "Wholesome" G Major scale, and Maria Renold I.
*   **Voicing and Performance:**
    *   **Poly, Mono, and Legato Modes:** With adjustable glide time that can be synced to BPM.
    *   **MIDI Control:** Connect your favorite MIDI controller to play the synthesizer.
    *   **Panic Button:** Instantly silences all audio to prevent runaway feedback.

## Architecture

Poly-Rhythm Synth is built with modern web technologies, ensuring a high-performance and responsive user experience.

*   **Frontend:** The user interface is built with **React** and **TypeScript**, providing a robust and type-safe foundation.
*   **Bundler:** **Vite** is used for fast and efficient development and bundling.
*   **Web Audio API:** The synthesizer's audio engine is built directly on the **Web Audio API**, allowing for low-latency audio processing and a high degree of control over the sound. All synthesis, sequencing, and randomization logic is handled on the client-side.
*   **Component-Based Design:** The application is organized into a series of modular React components, making the codebase easy to understand, maintain, and extend.

## How to Run

1.  **Install dependencies:**
    ```bash
    npm install
    ```
2.  **Run the development server:**
    ```bash
    npm run dev
    ```
    The application will be available at a local port (usually `http://localhost:5173` or similar).

## Controls Overview

*   **Top Bar:** Controls for Master Volume, BPM, Transport (Play/Stop), and MIDI input selection.
*   **Main Control Panel:** This is the heart of the generative system.
    *   **Randomorph:** Select the global harmonic mode (tuning system) and trigger the main randomization actions. Control the morph time and sync it to the BPM.
    *   **Voicing & Glide:** Set the synth to polyphonic, monophonic, or legato, and control the glide time between notes.
    *   **Global Settings:** Set the musical scale and global transpose.
    *   **Auto-Random:** Enable and configure the automatic randomization feature.
*   **Engine Controls (x3):** Each of the three large vertical modules controls one synthesis engine.
    *   Use the top toggles to enable/disable the sequencer (SEQ) or MIDI control for that engine.
    *   Use the randomization buttons to affect only that engine.
    *   Control the sequencer's rate, steps, pulses, and rotation.
    *   Use the tabs to switch between the **Synth**, **Noise**, and **Sampler** layers and edit their parameters.
    *   Adjust the **Amplitude Envelope (ADSR)** for the engine at the bottom.
*   **Processing Container:**
    *   **Filters:** Control the two master filters and their series/parallel routing.
    *   **Master Effects:** Add, remove, and re-order effects in the master signal chain. Click an effect to expand its parameters.
*   **Bottom Tabs:**
    *   **LFOs:** Access the controls for the three Low-Frequency Oscillators.
    *   **Routing Matrix:** A grid for connecting modulation sources (LFOs, Sequencers) to their destinations.
*   **Lock Icons:** Click the small lock icon next to any parameter to "lock" it, preventing it from being changed by the randomization engine.