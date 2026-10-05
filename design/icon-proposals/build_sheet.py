"""Rebuilds contact-sheet.html from whatever is in svg/. Standard library only."""
import glob, os

SVGS = {}
for f in sorted(glob.glob("svg/*.svg")):
    s = open(f).read().strip().replace(' width="24" height="24"', '')
    SVGS[os.path.basename(f)[:-4]] = s

ORDER = ["paula", "marta", "peteris", "janis", "waiter"]
LABEL = {"paula":"Paula","marta":"Marta","peteris":"Pēteris",
         "janis":"Jānis","waiter":"Waiter"}
NOTE = {
 "paula":"Long, full, falls past the shoulders. Widest mark in the set — she is the protagonist and carries the most visual weight.",
 "marta":"Blunt bob with a straight fringe. Deliberately the shortest hair of the two women so she can never be confused with Paula.",
 "peteris":"Short even crop, no part. The plainest head in the set — nothing fussy, which suits him.",
 "janis":"Same short length, but swept into a hard side part. Formality rendered as grooming.",
 "waiter":"Forward-facing like everyone else. Identified by the apron — a narrow bib stepping out to a wide skirt — not by hair. The only mark in the set that carries its identity on the body.",
}
SIZES = [16, 20, 24, 32, 48, 96]

def icon(name, px, cls="mk"):
    return f'<span class="{cls}" style="--s:{px}px">{SVGS[name]}</span>'

rows = "".join(
    f'<tr><th>{LABEL[n]}</th>'
    + "".join(f'<td>{icon(n, s)}</td>' for s in SIZES)
    + f'<td class="note">{NOTE[n]}</td></tr>'
    for n in ORDER
)
strip   = "".join(icon(n, 20) for n in ORDER)
strip24 = "".join(icon(n, 24) for n in ORDER)

# Gutter mock. The Narrator line is kept deliberately: it has no mark, so it
# shows what the unmarked fallback looks like sitting next to marked speakers.
SENT = [
 ("janis",   "Labdien! Kā jūs sauc?",        "Good day! What are you called?"),
 ("paula",   "Mani sauc Paula.",             "I am called Paula."),
 ("waiter",  "Ko jūs vēlaties?",             "What would you like?"),
 ("paula",   "Man arī. Es esmu no Lietuvas.","Me too. I am from Lithuania."),
 ("narrator","Viņi apsēžas pie galda.",      "They sit down at the table."),
]
def gutter(mode):
    out = []
    for i, (spk, lv, en) in enumerate(SENT):
        active = " is-active" if i == 3 else ""
        has = spk in SVGS
        name = LABEL.get(spk, "Narrator")
        if mode == "icon" and has:
            g = f'<span class="gut">{icon(spk, 20, "mk gmk")}</span>'
        elif mode == "both" and has:
            g = (f'<span class="gut gut-both">{icon(spk, 18, "mk gmk")}'
                 f'<span class="lbl">{name}</span></span>')
        else:
            g = f'<span class="gut"><span class="lbl">{name}</span></span>'
        out.append(f'<div class="sent{active}">{g}<div class="txt">'
                   f'<div class="lv">{lv}</div><div class="en">{en}</div></div></div>')
    return "".join(out)

HTML = f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sveiki — speaker mark proposal</title>
<style>
@import url("https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Manrope:wght@400;500;600;700&family=Newsreader:opsz,wght@6..72,400;6..72,500&display=swap");
:root {{
  --ink:#17312e; --paper:#f8f8f2; --canvas:#eef3ed; --margin:#dce9e2;
  --gloss:#52645f; --accent:#0a7068; --accent-strong:#07534e; --signal:#c96043;
  --rule:#b8cec4; --active-bg:#dcece4;
  --font-lv:"Newsreader",Georgia,serif; --font-gloss:"Manrope",system-ui,sans-serif;
  --font-meta:"DM Mono",ui-monospace,monospace;
}}
body.dark {{
  --ink:#e5eee6; --paper:#122522; --canvas:#0e1d1b; --margin:#1b3632;
  --gloss:#bfd0c6; --accent:#7bd0c2; --accent-strong:#b2e6db; --signal:#f09a77;
  --rule:#38554e; --active-bg:#1a3732;
}}
*{{box-sizing:border-box}}
body{{margin:0;padding:clamp(1.5rem,4vw,3.5rem);background:var(--canvas);color:var(--ink);
 font-family:var(--font-gloss);line-height:1.6;transition:background .2s,color .2s}}
.wrap{{max-width:64rem;margin:0 auto}}
.eyebrow{{font-family:var(--font-meta);font-size:.69rem;letter-spacing:.08em;
 text-transform:uppercase;color:var(--accent);margin:0 0 1rem}}
h1{{font-family:var(--font-lv);font-weight:500;font-size:clamp(2.2rem,5vw,3.4rem);
 letter-spacing:-.05em;line-height:.95;margin:0 0 .6rem}}
.sub{{color:var(--gloss);max-width:42rem;margin:0 0 2rem;font-size:.95rem}}
h2{{font-family:var(--font-lv);font-weight:500;font-size:1.5rem;letter-spacing:-.03em;
 margin:3.5rem 0 .3rem;padding-top:1.6rem;border-top:1px solid var(--rule)}}
.h2note{{color:var(--gloss);font-size:.86rem;margin:0 0 1.4rem;max-width:42rem}}
button{{font-family:var(--font-meta);font-size:.68rem;letter-spacing:.04em;padding:.5rem .9rem;
 border:1px solid var(--rule);border-radius:999px;background:var(--paper);color:var(--ink);
 cursor:pointer;text-transform:uppercase}}
button:hover{{border-color:var(--accent);color:var(--accent-strong)}}
.mk{{display:inline-flex;width:var(--s);height:var(--s);color:var(--gloss);
 vertical-align:middle;flex:0 0 auto}}
.mk svg{{width:100%;height:100%;display:block}}
table{{width:100%;border-collapse:collapse;background:var(--paper);border-radius:.5rem;overflow:hidden}}
th,td{{padding:.7rem .6rem;text-align:center;border-bottom:1px solid var(--rule);vertical-align:middle}}
tr:last-child th,tr:last-child td{{border-bottom:0}}
th{{text-align:left;font-family:var(--font-lv);font-weight:500;font-size:1.05rem;
 padding-left:1.1rem;white-space:nowrap}}
thead td{{font-family:var(--font-meta);font-size:.64rem;color:var(--gloss);letter-spacing:.04em}}
td.note{{text-align:left;color:var(--gloss);font-size:.78rem;line-height:1.5;
 max-width:20rem;padding-right:1.1rem}}
.band{{background:var(--paper);border-radius:.5rem;padding:1.6rem;display:flex;
 gap:1.6rem;align-items:center;flex-wrap:wrap}}
.band.tight{{gap:.9rem}}
.swatch{{display:flex;gap:1.4rem;flex-wrap:wrap}}
.sw{{display:flex;flex-direction:column;align-items:center;gap:.5rem;
 font-family:var(--font-meta);font-size:.6rem;color:var(--gloss)}}
.on-accent .mk{{color:var(--accent)}} .on-strong .mk{{color:var(--accent-strong)}}
.on-signal .mk{{color:var(--signal)}} .on-ink .mk{{color:var(--ink)}}
.sim{{background:var(--paper);border-radius:.5rem;padding:1.4rem 1.6rem}}
.sim h3{{font-family:var(--font-meta);font-size:.63rem;letter-spacing:.07em;
 text-transform:uppercase;color:var(--accent);margin:0 0 1rem;font-weight:400}}
.sent{{display:grid;grid-template-columns:6.6rem minmax(0,1fr);gap:1rem;
 padding:.55rem .5rem;border-radius:.3rem;align-items:start}}
.sent.is-active{{background:var(--active-bg)}}
.sent.is-active .mk{{color:var(--accent)}}
.gut{{display:flex;justify-content:flex-end;align-items:center;padding-top:.15rem;min-width:0}}
.gut-both{{gap:.42rem}}
.lbl{{font-family:var(--font-meta);font-size:.64rem;font-weight:500;letter-spacing:.06em;
 line-height:1.75;text-transform:uppercase;color:var(--gloss);white-space:nowrap;
 overflow:hidden;text-overflow:ellipsis}}
.lv{{font-family:var(--font-lv);font-size:1.12rem;line-height:1.35}}
.en{{font-size:.76rem;color:var(--gloss);line-height:1.4}}
.sims{{display:grid;gap:1.1rem;grid-template-columns:repeat(auto-fit,minmax(20rem,1fr))}}
.caption{{font-family:var(--font-meta);font-size:.62rem;color:var(--gloss);
 letter-spacing:.03em;margin:.7rem 0 0}}
.top{{display:flex;justify-content:space-between;align-items:flex-start;gap:1rem;flex-wrap:wrap}}
</style></head><body>
<div class="wrap">
<div class="top">
  <div><p class="eyebrow">Proposal — not wired in</p><h1>Speaker marks</h1></div>
  <button onclick="document.body.classList.toggle('dark')">Toggle dark</button>
</div>
<p class="sub">Five marks for the dialogue gutter. Two-tone: the head-and-shoulders
chassis sits at 33% opacity, the identifying layer at full strength. Both layers are
<code>currentColor</code>, so each mark inherits whatever colour the surrounding text
already uses and dark mode needs no separate artwork. The Narrator has no mark by
design — it is not a character.</p>

<h2>The set</h2>
<p class="h2note">Every mark at every size it might plausibly be used. The 20px column
is the one that matters — that is the dialogue gutter.</p>
<table>
<thead><tr><td></td>{"".join(f'<td>{s}px</td>' for s in SIZES)}<td class="note"></td></tr></thead>
<tbody>{rows}</tbody></table>

<h2>Confusability check</h2>
<p class="h2note">The real test: all five side by side at gutter size. If any two read
as the same person here, the set has failed. Pēteris and Jānis are the closest pair —
same hair length, separated only by the side part.</p>
<div class="band tight">{strip}</div>
<p class="caption">↑ 20px, true size · ↓ 24px</p>
<div class="band tight">{strip24}</div>

<h2>In the gutter</h2>
<p class="h2note">Three ways to use them, in a mock of the real lesson layout. The
fourth row is styled as the active sentence, where the mark picks up
<code>--accent</code> automatically. The fifth row is the Narrator, which has no mark
and falls back to the text label — worth checking that the mix does not look broken.</p>
<div class="sims">
  <div class="sim"><h3>Mark only</h3>{gutter("icon")}
    <p class="caption">Quietest. Needs the aria-label to carry the name.</p></div>
  <div class="sim"><h3>Mark + label</h3>{gutter("both")}
    <p class="caption">Belt and braces. Best for a learner meeting a character for the first time.</p></div>
  <div class="sim"><h3>Label only — today</h3>{gutter("label")}
    <p class="caption">Current behaviour, for comparison.</p></div>
</div>

<h2>Palette safety</h2>
<p class="h2note">The marks introduce no colour of their own. Here is the same mark
inheriting each existing token — nothing was added to the palette.</p>
<div class="band"><div class="swatch">
  <div class="sw"><span class="mk" style="--s:40px">{SVGS["waiter"]}</span>--gloss</div>
  <div class="sw on-ink"><span class="mk" style="--s:40px">{SVGS["waiter"]}</span>--ink</div>
  <div class="sw on-accent"><span class="mk" style="--s:40px">{SVGS["waiter"]}</span>--accent</div>
  <div class="sw on-strong"><span class="mk" style="--s:40px">{SVGS["waiter"]}</span>--accent-strong</div>
  <div class="sw on-signal"><span class="mk" style="--s:40px">{SVGS["waiter"]}</span>--signal</div>
</div></div>
</div></body></html>
"""
open("contact-sheet.html", "w").write(HTML)
print("contact-sheet.html rebuilt —", len(SVGS), "marks:", ", ".join(sorted(SVGS)))
