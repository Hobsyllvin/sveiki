"use client";

const RATES = [0.75, 1];

function formatTime(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(whole / 60);
  return `${minutes}:${String(whole % 60).padStart(2, "0")}`;
}

interface Props {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  rate: number;
  onRateChange: (rate: number) => void;
  repeat: boolean;
  onToggleRepeat: () => void;
  onTogglePlay: () => void;
}

export default function AudioPlayer({
  isPlaying,
  currentTime,
  duration,
  rate,
  onRateChange,
  repeat,
  onToggleRepeat,
  onTogglePlay,
}: Props) {
  return (
    <div className="audio-bar" role="group" aria-label="Lesson audio">
      <button
        className="audio-play"
        onClick={onTogglePlay}
        aria-label={isPlaying ? "Pause" : "Play"}
      >
        {isPlaying ? "❙❙" : "▶"}
      </button>

      <span className="audio-time">
        {formatTime(currentTime)} <span className="audio-time-sep">/</span>{" "}
        {formatTime(duration)}
      </span>

      <span className="audio-rates" role="group" aria-label="Playback speed">
        {RATES.map((option) => (
          <button
            key={option}
            className={`audio-rate${option === rate ? " audio-rate--active" : ""}`}
            onClick={() => onRateChange(option)}
            aria-pressed={option === rate}
          >
            {option}×
          </button>
        ))}
      </span>

      <button
        className={`audio-repeat${repeat ? " audio-repeat--active" : ""}`}
        onClick={onToggleRepeat}
        aria-pressed={repeat}
      >
        ⟳ repeat sentence
      </button>
    </div>
  );
}
