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


V2.1 MIDI CLOCK TEST
- Added MIDI button and temporary MIDI clock overlay.
- Requests Web MIDI access and lists available MIDI inputs.
- Detects MIDI Timing Clock (F8) only.
- MIDI button flashes once per received quarter note.
- Incoming BPM is averaged, displayed in the overlay, and mirrored by the main tempo knob/readout.
- IMPORTANT: MIDI does NOT drive PFD timing yet; the sequencer still uses its internal tempo.
- For a cross-origin iframe embed, the iframe may need: allow="midi"
