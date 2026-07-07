/**
 * Time-lapse: scrub through the map's git history and watch the architecture
 * grow and rewire. View-only — a shield blocks canvas edits while active, so a
 * historical snapshot can never be accidentally saved over the present.
 */

export interface HistoryEntry {
  sha: string;
  date: string;
  summary: string;
}

interface TimeLapseProps {
  entries: HistoryEntry[]; // newest first, as delivered by the host
  index: number; // index into `entries`
  onScrub: (index: number) => void;
  onClose: () => void;
}

export function TimeLapse({ entries, index, onScrub, onClose }: TimeLapseProps): JSX.Element {
  // The slider runs oldest → newest left-to-right, so invert the index.
  const max = entries.length - 1;
  const sliderValue = max - index;
  const entry = entries[index];
  const date = entry ? entry.date.slice(0, 16) : '';

  return (
    <>
      {/* Blocks canvas interaction while time-travelling. */}
      <div className="atlas-timelapse-shield" aria-hidden="true" />
      <div className="atlas-timelapse" role="group" aria-label="Time-lapse">
        <span className="atlas-timelapse__glyph" aria-hidden="true">
          ⧗
        </span>
        <input
          className="atlas-timelapse__slider"
          type="range"
          min={0}
          max={max}
          value={sliderValue}
          aria-label="History position"
          onChange={(event) => onScrub(max - Number(event.target.value))}
        />
        <div className="atlas-timelapse__meta">
          <span className="atlas-timelapse__date">{date}</span>
          <span className="atlas-timelapse__summary" title={entry?.summary}>
            {entry?.summary}
          </span>
          <span className="atlas-timelapse__count">
            {entries.length - index}/{entries.length}
          </span>
        </div>
        <button type="button" className="atlas-button atlas-button--small" onClick={onClose}>
          Exit
        </button>
      </div>
    </>
  );
}
