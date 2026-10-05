---
created: 2026-09-28
type: proposal
status: awaiting review
tags: [design, icons, speakers]
related: [docs/CHARACTER-BIBLE.md]
---

# Speaker marks — proposal

Five icons for the dialogue gutter: Paula, Marta, Pēteris, Jānis and the Waiter. The
Narrator has no mark — see below. Nothing here is wired into the app, and this folder
is additive only: no existing file in the repo was touched.

Open `contact-sheet.html` in a browser. It shows every mark at every plausible size,
a side-by-side confusability check at true gutter size, three ways of using them
inside a mock of the real lesson layout, and a dark-mode toggle driven by the actual
tokens from `globals.css`.

> Revised 2026-09-28 after review: the Waiter was turned to face forward and given an
> apron in place of a side bun, and the Narrator mark was dropped.

## On the format question

SVG is the right answer, but the choice that actually matters is how it enters
Next.js rather than the file format itself.

At gutter size these marks render at roughly 20 CSS pixels. Serving them as
`<img src="/icons/paula.svg">` would cost five network requests, would not inherit
the palette, and would need a second set of files for dark mode. Inlining them as
React components does none of that. Both layers of every mark are painted in
`currentColor`, so a mark placed in the gutter picks up `--gloss` from the
surrounding label, switches to `--accent` when the sentence goes active, and inverts
for dark mode with no separate artwork and no extra CSS. That behaviour is the entire
reason to prefer inline SVG here, and it is why raster formats (PNG, WebP) are
genuinely worse for this job rather than merely unfashionable — they cannot inherit
anything, and would need five files times two modes times three pixel densities.

Icon fonts are a third option and not worth considering: they break when the font
fails to load, and they fight the three typefaces you already load.

## How the marks are built

Each mark is a 24×24 viewBox with two layers, both `currentColor`.

The **chassis** — a head circle and a shoulder trapezoid — sits at 33% opacity and
is nearly identical across the set. It supplies the "a person is speaking" read and
gives every mark the same optical weight and alignment.

The **identifying layer** sits on top at full strength. For the four learners that
layer is hair; for the Waiter it is an apron. This is the important decision, and it
was not my first attempt. My first two passes made the
whole head a solid one-colour silhouette and differentiated by outer contour, which
failed: a single-colour silhouette yields about four reliably distinct head shapes,
and six characters need more than four. Marta, Pēteris and Jānis came out
indistinguishable at 20px. Moving the hair to the solid layer and the head to the
tint layer means differentiation comes from hair length, hairline shape and parting —
which is how people actually recognise each other at a glance, and which survives
reduction to 16px.

The Waiter breaks that rule on purpose. She is the only person in the set defined by
a job rather than by a personality, and putting her mark on the body instead of the
head uses an axis nothing else in the set occupies — which makes her the single most
distinguishable mark, at no cost to the others.

There are no eyes, mouths or other interior features anywhere in the set. At 20px
they turn to mud, and adding them would also have forced far more specific
appearance decisions than the character bible supports.

No mark introduces any colour. There are no fills, strokes or gradients other than
`currentColor` at two opacities, so the set cannot interfere with the palette — see
the last section of the contact sheet, which shows the same mark inheriting
`--gloss`, `--ink`, `--accent`, `--accent-strong` and `--signal` in turn.

## Appearance decisions, and why

The character bible establishes no ages, no surnames and no appearance for anyone —
Part 2 lists this as deliberate. So every contour below is invented by me. I hooked
each one to a trait that *is* established so the choices are at least defensible, but
they are all individually vetoable and none is load-bearing for anything else.

| Mark | What I drew | Hooked to |
|---|---|---|
| Paula | Long, full hair falling past the shoulders. The widest, heaviest mark in the set. | She is the emotional centre and speaks 79 of the 136 lines; she should carry the most visual weight. |
| Marta | Blunt bob to the jaw with a straight fringe. | Had to be unmistakably *not* Paula at 20px, and a neat pragmatic cut suits the pragmatist axis proposed in Part 4. |
| Pēteris | Short even crop, no parting. The plainest head in the set. | Dry, deadpan, comfortable, unhurried. Nothing fussy. |
| Jānis | Same length as Pēteris, but swept into a hard side parting. | His formality is established — `Labdien` where others say `Sveika`. Rendered as grooming rather than as an expression. |
| Waiter | Forward-facing like everyone else, plain short hair, identified by an apron: a narrow bib stepping out to a wide skirt. | Professional and efficient, on shift. An apron says *working here* without saying anything about who she is — which is all the bible gives us. |

One of these is worth arguing about. Assigning long hair to Paula and a short bob to
Marta is a legibility decision dressed up as a character decision: I needed the two
women maximally separated at 20px and the bible gave me nothing to choose between
them, so I gave the more prominent silhouette to the more prominent character. Swap
them freely if you have a different picture in your head.

One note on the Waiter. `docs/CHARACTER-BIBLE.md` records her as a female voice, and
the apron mark is deliberately gender-neutral so it does not contradict that or
commit to anything further. If she is ever named and given a personality, she should
probably graduate to a hair-based mark like everyone else and let the apron go.

## Why the Narrator has no mark

The Narrator is not a person — third person, present tense, three lines in L03, scene
setting and physical action only. An earlier draft gave it a hollow outline mark,
which was a mistake: it made a non-character look like a character, and it was the
boldest thing in the gutter for the quietest voice in the course.

Narrator lines now fall back to the plain text label, which is the current behaviour
and needs no code at all. The contact sheet's gutter mock includes a Narrator line
precisely so you can check that a mix of marked and unmarked speakers does not look
broken.

## The known weak point

Pēteris and Jānis are the closest pair in the set. Same hair length, separated only
by the parting, and they are the two marks most likely to be confused at 16px. They
are distinguishable at 20px — the confusability strip in the contact sheet is the
place to judge that — but if you want more margin, the cheapest fix is the
"mark + label" option rather than redrawing, since it removes the ambiguity entirely.

This is also the pair where the story might change. If Jānis stays a diaspora Latvian
and becomes Paula's mirror, he arguably deserves a more distinctive mark than a
parting.

## Accessibility

Each file carries `role="img"`, an `aria-label` and a `<title>`, with diacritics
matching the content files exactly (`Jānis`, `Pēteris`). If a mark ever *replaces*
the text label, that label is the only thing naming the speaker for a screen reader,
so it has to stay accurate. If the mark sits alongside the text label, the reverse
holds: the mark should be `aria-hidden="true"` so the name is not announced twice.

The marks are decorative reinforcement and never the sole carrier of meaning — the
Latvian and the gloss are present regardless.

## If you decide to wire it in

Lesson JSON carries `"speaker": "Paula"` as a bare string and nothing else, which is
correct and should not change. Per the standing instruction that content files hold
no presentation information, the speaker-to-mark mapping belongs in the presentation
layer next to `lessonTitles.ts`, not in `content/`.

I deliberately did **not** add any `.ts` or `.tsx` file to this folder.
`tsconfig.json` includes `**/*.tsx` and excludes only `node_modules`, so a component
dropped in here would be picked up by `npx tsc --noEmit` and by ESLint, and an
unreviewed proposal file could fail CI. The code below is a sketch to copy, not a
file to import.

```tsx
// src/lib/presentation/speakerIcons.tsx  (does not exist yet)
//
// Keys are the exact speaker strings used in content/lv/lessons/*.json.
// Speakers with no entry - Narrator today, any future walk-on - resolve to
// undefined and the caller falls back to the plain text label. A missing mark
// should never throw and never break a lesson that otherwise validates.

type MarkProps = { size?: number };

const Chassis = () => (
  <g fill="currentColor" opacity={0.33}>
    <circle cx="12" cy="9.2" r="5" />
    <path d="M12 16 C7.65 16 4.1 19.6 4.1 24 L19.9 24 C19.9 19.6 16.34 16 12 16 Z" />
  </g>
);

// ...one `d` string per character, lifted from ./svg/*.svg

export const SPEAKER_MARKS: Record<string, React.FC<MarkProps>> = {
  Paula: PaulaMark,
  Marta: MartaMark,
  "Pēteris": PeterisMark,
  "Jānis": JanisMark,
  Waiter: WaiterMark,
  // Narrator is intentionally absent.
};

export function markForSpeaker(speaker: string | undefined) {
  if (!speaker) return undefined;
  return SPEAKER_MARKS[speaker];
}
```

In `InterlinearSentence.tsx` the current gutter is a single span:

```tsx
{showSpeaker && sentence.speaker && (
  <span className="speaker-label">{sentence.speaker}</span>
)}
```

The mark-plus-label variant keeps the existing label intact and hides the mark from
assistive tech, so nothing regresses:

```tsx
{showSpeaker && sentence.speaker && (
  <span className="speaker-label">
    <Mark size={18} aria-hidden="true" />
    {sentence.speaker}
  </span>
)}
```

`.speaker-label` currently sets `text-align: right` and `white-space: nowrap`. It
would need `display: inline-flex` with `align-items: center` and a small gap to sit a
mark beside the text. Note that the gutter is `--sentence-gutter`, which is
`clamp(5.75rem, 14vw, 7.5rem)`, and the label already ellipsises at that width —
adding an 18px mark plus a gap eats roughly 1.5rem of it, so `Pēteris` should be
checked for truncation at the narrow end of the clamp before this ships. `Narrator`
is the longest label of all and never gets a mark, so it is unaffected.
The mark-only variant avoids that problem entirely.

## Regenerating

`build_sheet.py` rebuilds `contact-sheet.html` from whatever is in `svg/`. Standard
library only. Edit an SVG, re-run it, reload the page.

## Not done

No mark for the fast-talking market seller from the Part 4 proposal, and none for
Paula's sister or parents, since none of them exist in content yet. The set covers
the five speaking characters currently present across lessons 01–04; the Narrator is
the sixth speaker string in the content and is unmarked by design.

The apron uses no `clipPath`. An earlier version clipped it to the body silhouette,
which would have meant a document-unique id — a real hazard once the mark is inlined
as a React component many times over, since an unmounting instance can take the
shared definition with it. The bib and skirt are instead sized to sit inside the
body outline on their own, so the mark is a flat list of shapes with no ids at all.
