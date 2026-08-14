PFD — Probabilistic Fractal Drum V0.9

AUDIO FILES
Put all samples in one folder named "audio" beside index.html.

Expected filenames:
  kick1.ogg  kick2.ogg  kick3.ogg  kick4.ogg  kick5.ogg
  snare1.ogg snare2.ogg snare3.ogg snare4.ogg snare5.ogg
  hh1.ogg    hh2.ogg    hh3.ogg    hh4.ogg    hh5.ogg
  perc1.ogg  perc2.ogg  perc3.ogg  perc4.ogg  perc5.ogg

Slot 1 also accepts the older filenames kick.ogg, snare.ogg, hh.ogg and perc.ogg
so an existing V0.7 audio folder still works while you rename things.

The SAMPLE 1–5 selectors switch live. All 20 samples are preloaded on PLAY.
If a selected sample is missing, PFD uses its synthesized fallback for that hit.


PFD V0.10 LFO
- One global sine LFO modulates sample detune.
- RATE: 0.03 to 8 Hz, logarithmic.
- DEPTH: 0 to +/-24 semitones.
- Route buttons 1-4 choose which tracks receive the LFO.
- Each track's normal TUNE setting remains the centre pitch.
- LFO routing/rate/depth can all be changed live.

V0.11
- Tempo and Swing moved to a global top control strip.
- LFO moved to its own upper-right modulation bay.
- Added SINE / SQUARE LFO waveform selection.
- LFO routing remains per track; no route buttons = no audible modulation.


PFD V2.3 MIDI CLOCK + FA PHASE
- Added Web MIDI clock input and MIDI status panel.
- Incoming F8 drives the actual PFD engine: 6 F8 pulses = one PFD 1/16-note step.
- Incoming BPM updates the existing tempo knob/readout.
- Incoming FA resets the hidden musical phase to ONE but does not force PFD to play.
- Incoming FC is shown as MASTER STOP; local PFD PLAY/STOP remains independent.
- MIDI phase keeps counting while PFD is locally stopped.
- Local PLAY joins the current external phase instead of resetting its own beat position.
- F8-only sources still work; phase is prefixed with ~ because absolute ONE is unknown.
- Selecting NO MIDI INPUT returns to the original internal Web Audio scheduler.


PFD V2.4 AUTOFILL
- Added two small AUTOFILL buttons beside PLAY.
- Fill 1: eight 1/16-note snare hits with a velocity crescendo.
- Fill 2: eight-step figure: hit-hit-rest-rest-hit-hit-hit-hit.
- Fills use the currently selected snare sample and the snare channel's tune/filter/volume/pan/reverb.
- Pressing a fill queues it for the next quarter-note boundary; the button stays lit while queued/playing.
- Each fill lasts eight 1/16-note steps, then the normal fractal pattern continues automatically.
- MIDI clock mode follows the external 1/16-note phase, including FA reset to ONE.
