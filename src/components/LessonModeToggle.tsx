"use client";

import type { ViewMode } from "./InterlinearSentence";

const MODES: { value: ViewMode; label: string }[] = [
  { value: "decode", label: "Decode" },
  { value: "natural", label: "Natural" },
  { value: "latvian", label: "Latvian" },
];

interface Props {
  mode: ViewMode;
  onChange: (mode: ViewMode) => void;
}

export default function LessonModeToggle({ mode, onChange }: Props) {
  return (
    <div className="mode-toggle" role="group" aria-label="Reading mode">
      {MODES.map(({ value, label }) => (
        <button
          key={value}
          className={`mode-btn${mode === value ? " mode-btn--active" : ""}`}
          onClick={() => onChange(value)}
          aria-pressed={mode === value}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
