PFD V2.5 — Nmidi v3 MASTER / FOLLOW
====================================

Based on supplied PFD V2.4 AUTOFILL.

CLOCK panel now contains:
- Nmidi OFF / LOCAL
- Nmidi MASTER
- Nmidi FOLLOW
- Existing Web MIDI input

Nmidi channel:
  monke-nmidi-v3

MASTER:
- PFD PLAY starts the shared Nmidi clock.
- PFD STOP sends master stop.
- Tempo knob broadcasts tempo changes.
- State heartbeat is sent roughly every 2 seconds.
- No PPQN tick stream.

FOLLOW:
- Receives BPM + phase origin.
- PFD schedules its own audio locally.
- Routine heartbeats do NOT restart/re-phase the scheduler.
- PFD's PLAY/STOP remains local.
- On START / actual BPM change / meaningful phase change, PFD re-aligns to shared phase.

MIDI and Nmidi modes are mutually exclusive.

Test suggestion:
1. PFD CLOCK -> NMIDI MASTER.
2. Press PFD PLAY.
3. Inspector Morse v0.73 CLOCK -> NMIDI FOLLOW, then PLAY.
4. Compare the drum quarter-note feel against Morse metronome.
5. Then reverse roles using the standalone v3 sender or another future Nmidi master.
