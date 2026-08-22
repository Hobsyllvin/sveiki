# lv-a1-test — Balsu tests (audio script)

Voice and tag test fixture, not curriculum. Sentences are copied verbatim from
lessons 01–03 so no glossing or dictionary work is needed; they are not meant to
make sense as a scene. 317 characters of Latvian, so a full run costs roughly a
sixth of a real lesson.

Each line probes something different:
- s1 carries no tags at all — the control, to hear a voice unsteered.
- s2 switches emotion three times, including mid-clause.
- s3 puts a pacing tag in front of a digit string.
- s4 is a single tag on a short professional line.

A tag must be followed by a word, never by punctuation: `haha [chuckles]!` strips
to `haha !` and fails the byte-identity check against the lesson's `target`.

s1 | Narrator | Viesmīlis nāk un atnes tēju, kafiju un kūkas.
s2 | Pēteris | [teasing] Redzi? Tā ir skumja dzīve, haha! [warmly] Vai tu gribi kūku? Šeit ir [emphatically] ļoti garšīgas kūkas. [confidently] Es iesaku siera kūku.
s3 | Anna | [cheerfully] Es strādāju kafejnīcā. Tas ir interesants darbs. [slowly] Un mans numurs ir divi seši, septiņi viens pieci, nulle trīs četri. [warmly] Uz redzēšanos!
s4 | Waiter | [politely] Un kafiju ar govs pienu vai auzu pienu?
