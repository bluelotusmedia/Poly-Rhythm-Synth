const AbletonLink = require('abletonlink');
const { Server } = require('socket.io');
const NanoTimer = require('nanotimer');
const EventEmitter = require('events');

// --- LinkSequencer Class ---
class LinkSequencer extends EventEmitter {
    constructor(link, quantum = 4) {
        super();
        this.link = link;
        this.quantum = quantum;
        
        // Scheduler settings
        this.lookahead = 0.1; // 100ms
        this.interval = 25;   // 25ms check interval
        this.timer = new NanoTimer();
        
        // State
        this.nextNoteTime = 0;
        this.currentStep = -1;
        
        this.isRunning = false;
    }

    start() {
        if (this.isRunning) return;
        this.isRunning = true;
        // Start the loose loop
        this.timer.setInterval(() => {
            this.scheduler();
        }, '', `${this.interval}m`);
    }

    stop() {
        this.isRunning = false;
        this.timer.clearInterval();
    }

    scheduler() {
        // 1. Get current Link state
        this.link.update();
        const beat = this.link.beat;
        const tempo = this.link.bpm;
        const phase = this.link.phase; // Phase relative to quantum (usually 4)
        
        // Emit update for UI (approx every 25ms)
        this.emit('update', {
            beat,
            phase,
            bpm: tempo,
            isPlaying: this.link.isPlaying
        });

        // 2. Calculate time per beat in seconds
        const secondsPerBeat = 60.0 / tempo;
        
        // 3. Determine the next integer beat (quantized to grid)
        const nextTargetBeat = Math.ceil(beat); 
        
        // 4. Calculate how far away that beat is in "Link Time" (beats)
        const beatDiff = nextTargetBeat - beat;
        
        // 5. Convert beat difference to seconds
        const timeUntilNextBeat = beatDiff * secondsPerBeat;

        // 6. THE LOOKAHEAD CHECK
        if (timeUntilNextBeat > 0 && timeUntilNextBeat < this.lookahead) {
            this.scheduleEvent(timeUntilNextBeat, nextTargetBeat);
        }
    }

    scheduleEvent(delaySeconds, beatNumber) {
        // Prevent double scheduling
        if (this.currentStep === beatNumber) return;
        this.currentStep = beatNumber;

        // Use NanoTimer for the final precise wait
        const nanoDelay = `${Math.floor(delaySeconds * 1000)}m`;
        
        new NanoTimer().setTimeout(() => {
            // FIRE!
            const positionInBar = (beatNumber % this.quantum) + 1;
            
            this.emit('tick', {
                beat: beatNumber,
                barPosition: positionInBar,
                tempo: this.link.bpm
            });
            
        }, '', nanoDelay);
    }
}

// --- Main Server Logic ---

const link = new AbletonLink();

// Enable Link
if (link.enable) link.enable();
else if (link.isLinkEnable !== undefined) link.isLinkEnable = true;

// Enable Start/Stop Sync
if (link.enableStartStopSync) link.enableStartStopSync();
else if (link.isPlayStateSync !== undefined) link.isPlayStateSync = true;
else if (link.startStopSyncEnabled !== undefined) link.startStopSyncEnabled = true;

console.log("Link enabled. Start/Stop Sync enabled.");

const io = new Server(3001, {
    cors: {
        origin: "*", 
        methods: ["GET", "POST"]
    }
});

console.log("Ableton Link Server running on port 3001");

// Initialize Sequencer
const sequencer = new LinkSequencer(link);
sequencer.start();

// Handle Sequencer Events
sequencer.on('update', (state) => {
    // Helper to get isPlaying safely
    const getIsPlaying = () => {
        if (typeof link.isPlaying === 'function') return link.isPlaying();
        if (typeof link.isPlaying === 'boolean') return link.isPlaying;
        return false;
    };

    io.emit('link-update', {
        ...state,
        isPlaying: getIsPlaying()
    });
});

sequencer.on('tick', (data) => {
    // console.log(`Tick: ${data.beat}`);
    io.emit('link-tick', data);
});

io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);

    const getIsPlaying = () => {
        if (typeof link.isPlaying === 'function') return link.isPlaying();
        if (typeof link.isPlaying === 'boolean') return link.isPlaying;
        return false;
    };

    // Send initial state
    socket.emit('link-state', {
        bpm: link.bpm,
        phase: link.phase,
        beat: link.beat,
        isPlaying: getIsPlaying()
    });

    socket.on('set-bpm', (bpm) => {
        link.bpm = bpm;
        io.emit('bpm-changed', bpm); 
    });

    socket.on('start-stop', (isPlaying) => {
        if (typeof link.setIsPlaying === 'function') link.setIsPlaying(isPlaying);
        else if (isPlaying) {
            if (link.play) link.play();
        } else {
            if (link.stop) link.stop();
        }
        
        io.emit('transport-changed', isPlaying);
    });
    
    socket.on('request-sync', () => {
         socket.emit('link-state', {
            bpm: link.bpm,
            phase: link.phase,
            beat: link.beat,
            isPlaying: getIsPlaying()
        });
    });

    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
    });
});

// Setup callbacks if available
if (link.on) {
    link.on('playState', (isPlaying) => {
        io.emit('transport-changed', !!isPlaying);
    });
    link.on('tempo', (bpm) => {
        io.emit('bpm-changed', bpm);
    });
} else if (link.setStartStopCallback) {
    link.setStartStopCallback((isPlaying) => {
        io.emit('transport-changed', isPlaying);
    });
}
