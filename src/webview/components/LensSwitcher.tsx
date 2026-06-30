/**
 * The map "lens" switcher — a compact segmented control, like the data-overlay
 * toggles in a city-builder. Switching the lens recolours the whole map to read
 * it through a different layer: structure, risk, drift, coverage, traffic.
 */

import { LENSES, type MapLens } from '../../shared/model/lenses';

interface LensSwitcherProps {
  lens: MapLens;
  onChange: (lens: MapLens) => void;
}

export function LensSwitcher({ lens, onChange }: LensSwitcherProps): JSX.Element {
  return (
    <div className="atlas-lenses" role="group" aria-label="Map layer">
      {LENSES.map((l) => (
        <button
          key={l.id}
          type="button"
          className={`atlas-lens${l.id === lens ? ' atlas-lens--active' : ''}`}
          aria-pressed={l.id === lens}
          title={l.hint}
          onClick={() => onChange(l.id)}
        >
          {l.label}
        </button>
      ))}
    </div>
  );
}
