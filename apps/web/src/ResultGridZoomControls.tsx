import { MAX_GRID_ZOOM, MIN_GRID_ZOOM } from './result-grid-zoom'

export function ResultGridZoomControls({ zoom, onChange }: { zoom: number; onChange: (zoom: number) => void }) {
  return <div className="grid-zoom-controls" aria-label="Result grid zoom">
    <button type="button" onClick={() => onChange(zoom - 10)} disabled={zoom <= MIN_GRID_ZOOM} aria-label="Decrease grid zoom">−</button>
    <button type="button" onClick={() => onChange(100)} className="grid-zoom-value" aria-label="Reset grid zoom to 100%">{zoom}%</button>
    <button type="button" onClick={() => onChange(zoom + 10)} disabled={zoom >= MAX_GRID_ZOOM} aria-label="Increase grid zoom">+</button>
  </div>
}
