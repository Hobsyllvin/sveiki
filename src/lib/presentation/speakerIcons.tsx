import type { SVGProps } from "react";

type MarkProps = Omit<SVGProps<SVGSVGElement>, "viewBox" | "children"> & {
  size?: number;
};

function PaulaMark({ size = 20, ...props }: MarkProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width={size} height={size} role="img" aria-label="Paula" {...props}>
      <title>Paula</title>
      <g fill="currentColor" opacity={0.33}>
        <circle cx="12" cy="9.2" r="5" />
        <path d="M12 16.0 C7.27 16.0 3.40 19.60 3.40 24 L20.60 24 C20.60 19.60 16.73 16.0 12 16.0 Z" />
      </g>
      <g fill="currentColor">
        <path d="M5.2 19.4 C4.4 15.0 4.3 11.0 4.8 8.6 C5.5 5.0 8.3 2.8 12 2.8 C15.7 2.8 18.5 5.0 19.2 8.6 C19.7 11.0 19.6 15.0 18.8 19.4 C17.8 17.6 17.2 15.0 17.0 12.0 C16.6 9.6 16.2 8.4 15.6 7.6 C14.4 8.4 13.2 8.8 12 8.8 C10.8 8.8 9.6 8.4 8.4 7.6 C7.8 8.4 7.4 9.6 7.0 12.0 C6.8 15.0 6.2 17.6 5.2 19.4 Z" />
      </g>
    </svg>
  );
}

function MartaMark({ size = 20, ...props }: MarkProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width={size} height={size} role="img" aria-label="Marta" {...props}>
      <title>Marta</title>
      <g fill="currentColor" opacity={0.33}>
        <circle cx="12" cy="9.2" r="5" />
        <path d="M12 16.0 C7.43 16.0 3.70 19.60 3.70 24 L20.30 24 C20.30 19.60 16.57 16.0 12 16.0 Z" />
      </g>
      <g fill="currentColor">
        <path d="M6.4 14.6 C5.8 12.2 5.7 9.8 6.0 8.4 C6.6 5.4 9.0 3.6 12 3.6 C15.0 3.6 17.4 5.4 18.0 8.4 C18.3 9.8 18.2 12.2 17.6 14.6 L15.6 14.6 C16.1 12.8 16.2 10.6 16.0 9.0 L8.0 9.0 C7.8 10.6 7.9 12.8 8.4 14.6 Z" />
      </g>
    </svg>
  );
}

function PeterisMark({ size = 20, ...props }: MarkProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width={size} height={size} role="img" aria-label="Pēteris" {...props}>
      <title>Pēteris</title>
      <g fill="currentColor" opacity={0.33}>
        <circle cx="12" cy="9.2" r="5" />
        <path d="M12 16.0 C6.94 16.0 2.80 19.60 2.80 24 L21.20 24 C21.20 19.60 17.06 16.0 12 16.0 Z" />
      </g>
      <g fill="currentColor">
        <path d="M7.05 11.2 C6.8 6.8 9.1 4.1 12 4.1 C14.9 4.1 17.2 6.8 16.95 11.2 C16.6 9.6 16.2 8.6 15.7 8.0 C14.5 8.9 13.3 9.3 12 9.3 C10.7 9.3 9.5 8.9 8.3 8.0 C7.8 8.6 7.4 9.6 7.05 11.2 Z" />
      </g>
    </svg>
  );
}

function JanisMark({ size = 20, ...props }: MarkProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width={size} height={size} role="img" aria-label="Jānis" {...props}>
      <title>Jānis</title>
      <g fill="currentColor" opacity={0.33}>
        <circle cx="12" cy="9.2" r="5" />
        <path d="M12 16.0 C7.65 16.0 4.10 19.60 4.10 24 L19.90 24 C19.90 19.60 16.34 16.0 12 16.0 Z" />
      </g>
      <g fill="currentColor">
        <path d="M7.2 10.8 C6.9 6.8 9.1 4.1 12 4.1 C14.9 4.1 17.1 6.8 16.9 10.8 C16.7 9.4 16.5 8.2 16.2 7.4 C14.2 9.0 10.8 10.2 7.6 9.8 Z" />
      </g>
    </svg>
  );
}

function WaiterMark({ size = 20, ...props }: MarkProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width={size} height={size} role="img" aria-label="Waiter" {...props}>
      <title>Waiter</title>
      <g fill="currentColor" opacity={0.33}>
        <circle cx="12" cy="9.2" r="5" />
        <path d="M12 16.0 C7.43 16.0 3.70 19.60 3.70 24 L20.30 24 C20.30 19.60 16.57 16.0 12 16.0 Z" />
      </g>
      <g fill="currentColor">
        <path d="M7.3 10.0 C7.1 6.5 9.2 4.1 12 4.1 C14.8 4.1 16.9 6.5 16.7 10.0 C16.5 8.4 16.1 7.3 15.6 6.8 C14.4 7.2 13.3 7.4 12 7.4 C10.7 7.4 9.6 7.2 8.4 6.8 C7.9 7.3 7.5 8.4 7.3 10.0 Z" />
        <rect x="10.7" y="16.8" width="2.6" height="3.6" rx=".5" />
        <rect x="6.5" y="19.2" width="11" height="6" rx=".7" />
      </g>
    </svg>
  );
}

/** Keys are the exact speaker strings used in content/lv/lessons/*.json. */
export const SPEAKER_MARKS: Record<string, (props: MarkProps) => React.JSX.Element> = {
  Paula: PaulaMark,
  Marta: MartaMark,
  "Pēteris": PeterisMark,
  "Jānis": JanisMark,
  Waiter: WaiterMark,
  // Narrator is intentionally absent — falls back to the plain text label.
};

export function markForSpeaker(speaker: string | undefined) {
  if (!speaker) return undefined;
  return SPEAKER_MARKS[speaker];
}
