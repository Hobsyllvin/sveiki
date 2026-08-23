# voice-test — ElevenLabs voice and tag scratch script

Not lesson content. Nothing here is glossed, translated or validated — edit it
freely. Each speaker introduces themselves so the voice is identifiable, then
says one short tagged line so the emotion is audible on its own.

Run with:

    npm run audio -- --script content/lv/audio-scripts/voice-test.md

Speaker names must match the keys in `content/lv/voices.json`. Output goes to
`content/lv/audio-elevenlabs/voice-test.*`.

s1 | Narrator | Mani sauc stāstnieks.
s2 | Narrator | [calmly] Nāk viesmīlis.
s3 | Pēteris | Mani sauc Pēteris.
s4 | Pēteris | [angrily] Kafija man negaršo!
s5 | Anna | Mani sauc Anna.
s6 | Anna | [sadly] Cik skumja dzīve!
s7 | Marta | Mani sauc Marta.
s8 | Marta | [excited] Tu runā ļoti labi!
s9 | Waiter | Mani sauc viesmīlis.
s10 | Waiter | [nervously] Kādu tēju jūs vēlaties?
