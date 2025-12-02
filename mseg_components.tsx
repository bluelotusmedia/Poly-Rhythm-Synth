interface MSEGEditorProps {
	mseg: MSEGState;
	onUpdate: (updates: Partial<MSEGState>) => void;
	width?: number;
	height?: number;
	readOnly?: boolean;
}

const MSEGEditor: React.FC<MSEGEditorProps> = ({ mseg, onUpdate, width = 600, height = 200, readOnly = false }) => {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const [draggedPointIndex, setDraggedPointIndex] = useState<number | null>(null);

	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;
		const ctx = canvas.getContext("2d");
		if (!ctx) return;

		const draw = () => {
			ctx.clearRect(0, 0, width, height);

			// Draw Grid
			ctx.strokeStyle = "#333";
			ctx.lineWidth = 1;
			ctx.beginPath();
			for (let i = 0; i <= 10; i++) {
				const x = (i / 10) * width;
				ctx.moveTo(x, 0);
				ctx.lineTo(x, height);
				const y = (i / 10) * height;
				ctx.moveTo(0, y);
				ctx.lineTo(width, y);
			}
			ctx.stroke();

			// Draw MSEG Line
			ctx.strokeStyle = "#00ffcc";
			ctx.lineWidth = 2;
			ctx.beginPath();
			
			// Sort points by time just in case
			const sortedPoints = [...mseg.points].sort((a, b) => a.time - b.time);
			
			if (sortedPoints.length > 0) {
				const startX = sortedPoints[0].time * width;
				const startY = (1 - sortedPoints[0].value) * height;
				ctx.moveTo(startX, startY);

				for (let i = 1; i < sortedPoints.length; i++) {
					const p1 = sortedPoints[i - 1];
					const p2 = sortedPoints[i];
					const x1 = p1.time * width;
					const y1 = (1 - p1.value) * height;
					const x2 = p2.time * width;
					const y2 = (1 - p2.value) * height;

					// Simple linear for now, curve support later
					ctx.lineTo(x2, y2);
				}
			}
			ctx.stroke();

			// Draw Points
			sortedPoints.forEach((p, i) => {
				const x = p.time * width;
				const y = (1 - p.value) * height;
				
				ctx.fillStyle = draggedPointIndex === i ? "#fff" : "#00ffcc";
				ctx.beginPath();
				ctx.arc(x, y, readOnly ? 3 : 5, 0, Math.PI * 2);
				ctx.fill();
			});
		};

		draw();
	}, [mseg.points, width, height, draggedPointIndex, readOnly]);

	const handleMouseDown = (e: React.MouseEvent) => {
		if (readOnly) return;
		const canvas = canvasRef.current;
		if (!canvas) return;
		const rect = canvas.getBoundingClientRect();
		const x = e.clientX - rect.left;
		const y = e.clientY - rect.top;

		// Check if clicking existing point
		const clickThreshold = 10;
		const pointIndex = mseg.points.findIndex(p => {
			const px = p.time * width;
			const py = (1 - p.value) * height;
			return Math.sqrt(Math.pow(x - px, 2) + Math.pow(y - py, 2)) < clickThreshold;
		});

		if (pointIndex !== -1) {
			// Remove point on double click (simulated with modifier for now or just check logic)
			if (e.altKey) {
				if (mseg.points.length > 2) {
					const newPoints = [...mseg.points];
					newPoints.splice(pointIndex, 1);
					onUpdate({ points: newPoints });
				}
			} else {
				setDraggedPointIndex(pointIndex);
			}
		} else {
			// Add new point
			const time = Math.max(0, Math.min(1, x / width));
			const value = Math.max(0, Math.min(1, 1 - y / height));
			const newPoints = [...mseg.points, { time, value, curve: 0 }];
			newPoints.sort((a, b) => a.time - b.time);
			onUpdate({ points: newPoints });
		}
	};

	const handleMouseMove = (e: React.MouseEvent) => {
		if (readOnly || draggedPointIndex === null) return;
		const canvas = canvasRef.current;
		if (!canvas) return;
		const rect = canvas.getBoundingClientRect();
		const x = e.clientX - rect.left;
		const y = e.clientY - rect.top;

		const time = Math.max(0, Math.min(1, x / width));
		const value = Math.max(0, Math.min(1, 1 - y / height));

		const newPoints = [...mseg.points];
		newPoints[draggedPointIndex] = { ...newPoints[draggedPointIndex], time, value };
		newPoints.sort((a, b) => a.time - b.time);
		onUpdate({ points: newPoints });
	};

	const handleMouseUp = () => {
		if (readOnly) return;
		setDraggedPointIndex(null);
	};

	return (
		<canvas
			ref={canvasRef}
			width={width}
			height={height}
			style={{ background: "#222", borderRadius: "4px", cursor: readOnly ? "default" : "crosshair" }}
			onMouseDown={handleMouseDown}
			onMouseMove={handleMouseMove}
			onMouseUp={handleMouseUp}
			onMouseLeave={handleMouseUp}
		/>
	);
};

interface MSEGControlsProps {
	mseg: MSEGState;
	onUpdate: (updates: Partial<MSEGState>) => void;
	bpm: number;
	lockState: LockState;
	onToggleLock: (path: string) => void;
}

const MSEGControls: React.FC<MSEGControlsProps> = ({ mseg, onUpdate, bpm, lockState, onToggleLock }) => {
	const [isExpanded, setIsExpanded] = useState(false);

	const getLock = (path: string) => {
		// Simplified lock check
		return false; 
	};

	if (isExpanded) {
		return (
			<div style={{
				position: 'fixed',
				top: 0,
				left: 0,
				width: '100vw',
				height: '100vh',
				background: 'rgba(0,0,0,0.9)',
				zIndex: 1000,
				display: 'flex',
				alignItems: 'center',
				justifyContent: 'center'
			}}>
				<div style={{
					background: '#1a1a1a',
					padding: '2rem',
					borderRadius: '8px',
					width: '90%',
					maxWidth: '1000px',
					display: 'flex',
					flexDirection: 'column',
					gap: '1rem'
				}}>
					<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
						<h2>{mseg.name} Editor</h2>
						<button onClick={() => setIsExpanded(false)} style={{ padding: '0.5rem 1rem', background: '#444', border: 'none', color: '#fff', borderRadius: '4px', cursor: 'pointer' }}>Close</button>
					</div>
					
					<div className="control-group-header">
						<div className="toggle-group">
							<button className={mseg.loop ? "active" : ""} onClick={() => onUpdate({ loop: !mseg.loop })}>Loop</button>
							<button className={mseg.sync ? "active" : ""} onClick={() => onUpdate({ sync: !mseg.sync })}>Sync</button>
						</div>
					</div>
					
					<div style={{ display: 'flex', gap: '1rem', flexDirection: 'column' }}>
						<MSEGEditor mseg={mseg} onUpdate={onUpdate} width={900} height={400} />
						
						<div className="control-row">
							<label>Rate</label>
							{mseg.sync ? (
								<select
									value={mseg.syncRateIndex}
									onChange={(e) => onUpdate({ syncRateIndex: parseInt(e.target.value) })}
									style={{ padding: '0.5rem', background: '#333', color: '#fff', border: 'none', borderRadius: '4px' }}
								>
									{syncRates.map((rate, i) => (
										<option key={i} value={i}>{rate}</option>
									))}
								</select>
							) : (
								<div className="control-value-wrapper" style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
									<input
										type="range"
										min="0.1"
										max="20"
										step="0.1"
										value={mseg.rate}
										onChange={(e) => onUpdate({ rate: parseFloat(e.target.value) })}
										style={{ flex: 1 }}
									/>
									<span>{mseg.rate.toFixed(1)} Hz</span>
								</div>
							)}
						</div>
					</div>
				</div>
			</div>
		);
	}

	return (
		<div className="lfo-controls" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', padding: '0.5rem', background: '#1a1a1a', borderRadius: '8px', width: '220px' }}>
			<div className="control-group-header" style={{ marginBottom: '0.5rem' }}>
				<h4 style={{ margin: 0 }}>{mseg.name}</h4>
				<button onClick={() => setIsExpanded(true)} style={{ fontSize: '0.8rem', padding: '0.2rem 0.5rem' }}>Edit</button>
			</div>
			
			<div onClick={() => setIsExpanded(true)} style={{ cursor: 'pointer' }}>
				<MSEGEditor mseg={mseg} onUpdate={onUpdate} width={200} height={100} readOnly={true} />
			</div>
		</div>
	);
};
