const LEVELS = 4;
const TRACK_COUNT = 4;
const W = 200;
const H = 430;
const yLevels = [368, 270, 172, 74];
const samplePrefixes = ['kick', 'snare', 'hh', 'perc'];
const SAMPLE_COUNT = 5;

const machine = document.querySelector('.machine');
const treesHost = document.getElementById('trees');
const trackButtons = [...document.querySelectorAll('.track-button')];
const muteButtons = [...document.querySelectorAll('.mute-button')];
const transport = document.getElementById('transport');
const tempo = document.getElementById('tempo');
const tempoKnob = document.getElementById('tempoKnob');
const tempoValue = document.getElementById('tempoValue');
const swing = document.getElementById('swing');
const swingValue = document.getElementById('swingValue');
const lfoRate = document.getElementById('lfoRate');
const lfoDepth = document.getElementById('lfoDepth');
const lfoRateKnob = document.getElementById('lfoRateKnob');
const lfoDepthKnob = document.getElementById('lfoDepthKnob');
const lfoRateValue = document.getElementById('lfoRateValue');
const lfoDepthValue = document.getElementById('lfoDepthValue');
const lfoRouteButtons = [...document.querySelectorAll('.lfo-route-button')];
const lfoWaveButtons = [...document.querySelectorAll('.lfo-wave-button')];
const channels = [...document.querySelectorAll('.channel')];
const knobIndicator = document.querySelector('#tempoKnob span');
const midiButton = document.getElementById('midiButton');
const midiPanel = document.getElementById('midiPanel');
const midiInput = document.getElementById('midiInput');
const midiStatus = document.getElementById('midiStatus');
const midiBpm = document.getElementById('midiBpm');
const midiPhase = document.getElementById('midiPhase');
const autoFillButtons = [...document.querySelectorAll('.autofill-button')];

const tracks = [];
let audioCtx = null;
let isPlaying = false;
let schedulerTimer = null;
let nextStepTime = 0;
let stepIndex = 0;
const lookAheadMs = 25;
const scheduleAheadSec = 0.10;

// MIDI clock state. Phase runs even while the drum engine is locally stopped.
let midiAccess = null;
let midiPort = null;
let midiExternal = false;
let midiPulseCounter = 0;   // 24 PPQN, 96 pulses per 4/4 bar
let midiStepCounter = 0;    // 16th-note counter (one step every 6 F8)
let midiLastPulseTime = 0;
let midiIntervals = [];
let midiClockSeenAt = 0;
let midiHasStartReference = false;

// Two short snare fills. A button press queues the selected fill for the next 1/4-note boundary.
// Each fill occupies eight 1/16-note steps, then normal fractal playback simply continues.
let fillStepCounter = 0;
let queuedFill = null;
let activeFill = null;
const AUTO_FILLS = [
  { hits:[1,1,1,1,1,1,1,1], velocities:[0.24,0.31,0.39,0.48,0.58,0.70,0.84,1.00] },
  { hits:[1,1,0,0,1,1,1,1], velocities:[0.78,0.82,0,0,0.90,0.94,0.97,1.00] }
];

function nodePosition(level, index) {
  const count = 2 ** level;
  const sidePadding = level === LEVELS - 1 ? 7 : 18;
  const usableWidth = W - sidePadding * 2;
  return {
    x: sidePadding + ((index + 0.5) / count) * usableWidth,
    y: yLevels[level]
  };
}

function branchKey(childLevel, childIndex) {
  return `${childLevel}:${childIndex}`;
}

function createTrack(index) {
  const area = document.createElement('div');
  area.className = 'tree-area';
  area.dataset.track = String(index);
  area.setAttribute('aria-hidden', 'true');

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.classList.add('branches');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('preserveAspectRatio', 'none');

  const nodesLayer = document.createElement('div');
  nodesLayer.className = 'nodes';

  area.appendChild(svg);
  area.appendChild(nodesLayer);
  treesHost.appendChild(area);

  const track = {
    index,
    area,
    svg,
    nodesLayer,
    nodes: [],
    branchPulses: new Map(),
    visible: false,
    muted: false,
    path: null,
    buffers: new Array(SAMPLE_COUNT).fill(null),
    sampleStates: new Array(SAMPLE_COUNT).fill('idle'),
    selectedSample: 0,
    mode: 'variation', halfTime: false, localStep: 0,
    tune: 0, volume: 1, pan: 0, reverb: 0.08, filterHz: 20000,
    filterNode: null, gainNode: null, panNode: null, sendGain: null,
    lfoEnabled: false, lfoGain: null
  };

  for (let level = 0; level < LEVELS; level++) {
    const count = 2 ** level;
    track.nodes[level] = [];

    for (let i = 0; i < count; i++) {
      const { x, y } = nodePosition(level, i);
      const button = document.createElement('button');
      button.className = 'node';
      button.type = 'button';
      button.style.left = `${(x / W) * 100}%`;
      button.style.top = `${(y / H) * 100}%`;
      button.setAttribute('aria-pressed', 'false');
      button.title = `Track ${index + 1}, level ${level + 1}, node ${i + 1}`;

      button.addEventListener('click', () => {
        const active = button.classList.toggle('active');
        button.setAttribute('aria-pressed', String(active));
        updateTrackStatus(index);
      });

      nodesLayer.appendChild(button);
      track.nodes[level][i] = button;

      if (level > 0) {
        const parentIndex = Math.floor(i / 2);
        const parent = nodePosition(level - 1, parentIndex);

        const base = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        base.setAttribute('x1', parent.x);
        base.setAttribute('y1', parent.y);
        base.setAttribute('x2', x);
        base.setAttribute('y2', y);
        base.setAttribute('class', 'branch');
        svg.appendChild(base);

        const pulse = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        pulse.setAttribute('x1', parent.x);
        pulse.setAttribute('y1', parent.y);
        pulse.setAttribute('x2', x);
        pulse.setAttribute('y2', y);
        pulse.setAttribute('class', 'branch-pulse');
        svg.appendChild(pulse);
        track.branchPulses.set(branchKey(level, i), pulse);
      }
    }
  }

  const mode = document.createElement('div');
  mode.className = 'tree-mode';
  mode.innerHTML = '<button type="button" data-mode="static">STATIC</button><button type="button" data-mode="variation" class="active">VARIATION</button>';
  mode.querySelectorAll('button').forEach(btn => btn.addEventListener('click', () => {
    track.mode = btn.dataset.mode;
    mode.querySelectorAll('button').forEach(b => b.classList.toggle('active', b === btn));
    if (track.mode === 'static') track.path = [0,0,0,0];
  }));
  area.appendChild(mode);

  const half = document.createElement('button');
  half.className = 'half-time';
  half.type = 'button';
  half.textContent = '½';
  half.setAttribute('aria-label', `Track ${index + 1} half time`);
  half.setAttribute('aria-pressed', 'false');
  half.addEventListener('click', () => {
    track.halfTime = !track.halfTime;
    track.localStep = 0;
    track.path = null;
    half.setAttribute('aria-pressed', String(track.halfTime));
  });
  area.appendChild(half);

  tracks.push(track);
}

function alignTrees() {
  const machineRect = machine.getBoundingClientRect();
  trackButtons.forEach((button, i) => {
    const rect = button.getBoundingClientRect();
    const center = rect.left - machineRect.left + rect.width / 2;
    tracks[i].area.style.left = `${center - tracks[i].area.offsetWidth / 2}px`;
  });
}

function hasActiveNodes(track) {
  return track.nodes.some(level => level.some(node => node.classList.contains('active')));
}

function updateTrackStatus(index) {
  const track = tracks[index];
  const button = trackButtons[index];
  const patterned = hasActiveNodes(track);
  button.classList.toggle('has-pattern', patterned);
  button.classList.toggle('tree-open', track.visible);
  button.setAttribute('aria-pressed', String(track.visible));
}

function setTempo(bpm) {
  const min = Number(tempo.min);
  const max = Number(tempo.max);
  const clamped = Math.max(min, Math.min(max, Math.round(bpm)));
  tempo.value = String(clamped);
  tempoValue.value = `${clamped} BPM`;
  tempoKnob.setAttribute('aria-valuenow', String(clamped));

  const t = (clamped - min) / (max - min);
  const degrees = 135 + t * 270;
  knobIndicator.style.transform = `rotate(${degrees}deg)`;
}

function stepSeconds() {
  return (60 / Number(tempo.value)) / 4;
}

function makeRandomPath() {
  const path = [0];
  let index = 0;
  for (let level = 1; level < LEVELS; level++) {
    index = index * 2 + (Math.random() < 0.5 ? 0 : 1);
    path.push(index);
  }
  return path;
}


function createImpulse(seconds = 1.05, decay = 2.4) {
  const len = Math.floor(audioCtx.sampleRate * seconds);
  const impulse = audioCtx.createBuffer(2, len, audioCtx.sampleRate);
  for (let c=0;c<2;c++) { const d=impulse.getChannelData(c); for(let i=0;i<len;i++) d[i]=(Math.random()*2-1)*Math.pow(1-i/len,decay); }
  return impulse;
}
let reverbNode = null;
let lfoOsc = null;
let lfoWave = 'sine';

function lfoRateFromSlider(value) {
  const min = 0.03, max = 8;
  const t = Number(value) / 100;
  return min * Math.pow(max / min, t);
}

function setupLfo() {
  if (lfoOsc) return;
  lfoOsc = audioCtx.createOscillator();
  lfoOsc.type = lfoWave;
  lfoOsc.frequency.value = lfoRateFromSlider(lfoRate.value);
  tracks.forEach(track => {
    track.lfoGain = audioCtx.createGain();
    track.lfoGain.gain.value = track.lfoEnabled ? Number(lfoDepth.value) * 100 : 0;
    lfoOsc.connect(track.lfoGain);
  });
  lfoOsc.start();
}

function updateLfoAudio() {
  if (!audioCtx || !lfoOsc) return;
  lfoOsc.frequency.setTargetAtTime(lfoRateFromSlider(lfoRate.value), audioCtx.currentTime, 0.02);
  tracks.forEach(track => {
    if (!track.lfoGain) return;
    const cents = track.lfoEnabled ? Number(lfoDepth.value) * 100 : 0;
    track.lfoGain.gain.setTargetAtTime(cents, audioCtx.currentTime, 0.02);
  });
}

function setupAudioRouting() {
  if (reverbNode) return;
  reverbNode = audioCtx.createConvolver(); reverbNode.buffer = createImpulse(); reverbNode.connect(audioCtx.destination);
  setupLfo();
  tracks.forEach(track => {
    track.filterNode = audioCtx.createBiquadFilter(); track.filterNode.type = 'lowpass'; track.filterNode.frequency.value = track.filterHz; track.filterNode.Q.value = 0.35;
    track.gainNode = audioCtx.createGain(); track.gainNode.gain.value = track.volume;
    track.panNode = audioCtx.createStereoPanner(); track.panNode.pan.value = track.pan;
    track.sendGain = audioCtx.createGain(); track.sendGain.gain.value = track.reverb;
    track.filterNode.connect(track.gainNode);
    track.gainNode.connect(track.panNode).connect(audioCtx.destination);
    track.gainNode.connect(track.sendGain).connect(reverbNode);
  });
}

async function loadSampleSlot(track, slot) {
  if (track.sampleStates[slot] === 'loaded') return track.buffers[slot];
  if (track.sampleStates[slot] === 'loading') return null;
  track.sampleStates[slot] = 'loading';

  const prefix = samplePrefixes[track.index];
  const candidates = [`audio/${prefix}${slot + 1}.ogg`];
  // Backward compatibility while the first sample is being renamed.
  if (slot === 0) candidates.push(`audio/${prefix}.ogg`);

  for (const file of candidates) {
    try {
      const response = await fetch(file);
      if (!response.ok) continue;
      const bytes = await response.arrayBuffer();
      track.buffers[slot] = await audioCtx.decodeAudioData(bytes);
      track.sampleStates[slot] = 'loaded';
      console.log(`${file} loaded`);
      updateSampleButtonState(track.index, slot, true);
      return track.buffers[slot];
    } catch (err) {
      console.warn(`Could not load ${file}`, err);
    }
  }

  track.sampleStates[slot] = 'missing';
  updateSampleButtonState(track.index, slot, false);
  console.warn(`${prefix}${slot + 1}.ogg not found; synthesized fallback will be used for this slot.`);
  return null;
}

async function loadAllSamples() {
  await Promise.all(tracks.flatMap(track =>
    Array.from({ length: SAMPLE_COUNT }, (_, slot) => loadSampleSlot(track, slot))
  ));
}

function synthFallback(trackIndex, time, velocity = 1) {
  const gain = audioCtx.createGain();
  gain.connect(tracks[trackIndex].filterNode || tracks[trackIndex].gainNode || audioCtx.destination);

  if (trackIndex === 0) {
    const osc = audioCtx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(135, time);
    osc.frequency.exponentialRampToValueAtTime(45, time + 0.10);
    gain.gain.setValueAtTime(0.9 * velocity, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.16);
    osc.connect(gain);
    osc.start(time); osc.stop(time + 0.18);
  } else if (trackIndex === 1) {
    const osc = audioCtx.createOscillator();
    const noise = audioCtx.createBufferSource();
    const noiseBuffer = audioCtx.createBuffer(1, audioCtx.sampleRate * 0.12, audioCtx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    noise.buffer = noiseBuffer;
    osc.type = 'triangle'; osc.frequency.value = 180;
    gain.gain.setValueAtTime(0.35 * velocity, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.12);
    osc.connect(gain); noise.connect(gain);
    osc.start(time); noise.start(time); osc.stop(time + 0.13); noise.stop(time + 0.13);
  } else if (trackIndex === 2) {
    const noise = audioCtx.createBufferSource();
    const noiseBuffer = audioCtx.createBuffer(1, audioCtx.sampleRate * 0.045, audioCtx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    noise.buffer = noiseBuffer;
    const hp = audioCtx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 5500;
    gain.gain.setValueAtTime(0.22 * velocity, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.045);
    noise.connect(hp).connect(gain); noise.start(time); noise.stop(time + 0.05);
  } else {
    const osc = audioCtx.createOscillator();
    osc.type = 'square'; osc.frequency.setValueAtTime(620, time);
    osc.frequency.exponentialRampToValueAtTime(210, time + 0.07);
    gain.gain.setValueAtTime(0.16 * velocity, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.09);
    osc.connect(gain); osc.start(time); osc.stop(time + 0.10);
  }
}

function triggerTrack(track, time, velocity = 1) {
  if (track.muted) return;
  const buffer = track.buffers[track.selectedSample];
  if (buffer) {
    const source = audioCtx.createBufferSource();
    const hitGain = audioCtx.createGain();
    source.buffer = buffer;
    source.playbackRate.value = Math.pow(2, track.tune / 12);
    hitGain.gain.value = Math.max(0.001, velocity);
    if (track.lfoEnabled && track.lfoGain) track.lfoGain.connect(source.detune);
    source.connect(hitGain);
    hitGain.connect(track.filterNode || track.gainNode || audioCtx.destination);
    source.start(time);
  } else {
    synthFallback(track.index, time, velocity);
  }
}

function updateAutoFillLights() {
  autoFillButtons.forEach((button, i) => {
    const on = queuedFill === i || (activeFill && activeFill.index === i);
    button.classList.toggle('active', on);
    button.setAttribute('aria-pressed', String(on));
  });
}

function queueAutoFill(index) {
  if (!AUTO_FILLS[index]) return;
  queuedFill = index;
  updateAutoFillLights();
}

function scheduleAutoFillStep(time) {
  // Queue point: next quarter-note boundary (four 16ths). This makes button presses land cleanly
  // without waiting for an entire bar. FA/PLAY still reset the phase, so machines agree on the grid.
  if (!activeFill && queuedFill !== null && fillStepCounter % 4 === 0) {
    activeFill = { index: queuedFill, step: 0 };
    queuedFill = null;
    updateAutoFillLights();
  }

  if (!activeFill) return;
  const def = AUTO_FILLS[activeFill.index];
  const i = activeFill.step;
  if (def.hits[i]) triggerTrack(tracks[1], time, def.velocities[i] ?? 1);
  activeFill.step++;
  if (activeFill.step >= def.hits.length) {
    activeFill = null;
    updateAutoFillLights();
  }
}

function scheduleVisual(audioTime, fn) {
  const delay = Math.max(0, (audioTime - audioCtx.currentTime) * 1000);
  window.setTimeout(() => { if (isPlaying) fn(); }, delay);
}

function flashNode(track, level, index, audioTime) {
  if (!track.visible) return;
  scheduleVisual(audioTime, () => {
    const node = track.nodes[level][index];
    node.classList.remove('playhead');
    void node.offsetWidth;
    node.classList.add('playhead');
    window.setTimeout(() => node.classList.remove('playhead'), Math.min(130, stepSeconds() * 500));
  });
}

function animateBranch(track, childLevel, childIndex, audioTime, durationSec) {
  if (!track.visible) return;
  scheduleVisual(audioTime, () => {
    const line = track.branchPulses.get(branchKey(childLevel, childIndex));
    if (!line) return;
    const length = line.getTotalLength();
    line.getAnimations().forEach(a => a.cancel());
    line.style.opacity = '1';
    line.style.strokeDasharray = `${Math.max(10, length * 0.18)} ${length}`;
    line.style.strokeDashoffset = '0';
    line.animate([
      { strokeDashoffset: '0', opacity: 0 },
      { opacity: 1, offset: 0.08 },
      { strokeDashoffset: `${-length}px`, opacity: 1, offset: 0.88 },
      { strokeDashoffset: `${-length}px`, opacity: 0 }
    ], { duration: durationSec * 1000, easing: 'linear' });
  });
}

function flashHiddenTrackButtons(audioTime) {
  scheduleVisual(audioTime, () => {
    const flashMs = Math.min(90, Math.max(45, (60 / Number(tempo.value)) * 170));
    tracks.forEach((track, i) => {
      if (!track.visible && hasActiveNodes(track)) {
        const button = trackButtons[i];
        button.classList.add('tempo-flash');
        window.setTimeout(() => button.classList.remove('tempo-flash'), flashMs);
      }
    });
  });
}

function scheduleStep(time) {
  // Master quarter-note blink remains tied to the global 4-step cycle.
  if (stepIndex === 0) flashHiddenTrackButtons(time);

  scheduleAutoFillStep(time);

  tracks.forEach(track => {
    // Half-time tracks only advance on every other master subdivision.
    if (track.halfTime && (stepIndex % 2 === 1)) return;

    const level = track.localStep;
    if (level === 0 || !track.path) {
      track.path = track.mode === 'static' ? [0,0,0,0] : makeRandomPath();
    }

    const nodeIndex = track.path[level];
    flashNode(track, level, nodeIndex, time);

    if (track.nodes[level][nodeIndex].classList.contains('active')) {
      triggerTrack(track, time);
    }

    if (level < LEVELS - 1) {
      const childIndex = track.path[level + 1];
      const travel = stepSeconds() * (track.halfTime ? 1.92 : 0.96);
      animateBranch(track, level + 1, childIndex, time, travel);
    }

    track.localStep = (track.localStep + 1) % LEVELS;
  });

  stepIndex = (stepIndex + 1) % LEVELS;
  fillStepCounter++;
}

function scheduler() {
  if (midiExternal) return;
  while (nextStepTime < audioCtx.currentTime + scheduleAheadSec) {
    scheduleStep(nextStepTime);
    const base = stepSeconds();
    const sw = Number(swing.value) / 100;
    nextStepTime += (stepIndex % 2 === 1) ? base * (2 * sw) : base * (2 * (1 - sw));
  }
}

async function startSequencer() {
  if (!audioCtx) audioCtx = new AudioContext();
  if (audioCtx.state === 'suspended') await audioCtx.resume();
  setupAudioRouting();
  await loadAllSamples();

  isPlaying = true;
  transport.setAttribute('aria-pressed', 'true');
  transport.textContent = 'STOP';

  if (midiExternal) {
    // The MIDI phase has kept running silently while PFD was stopped.
    // Join at the current 16th-note position instead of inventing a new ONE.
    stepIndex = midiStepCounter % LEVELS;
    tracks.forEach(track => {
      track.path = null;
      track.localStep = track.halfTime
        ? Math.floor(midiStepCounter / 2) % LEVELS
        : midiStepCounter % LEVELS;
    });
    if (schedulerTimer) window.clearInterval(schedulerTimer);
    schedulerTimer = null;
  } else {
    stepIndex = 0;
    fillStepCounter = 0;
    activeFill = null;
    updateAutoFillLights();
    tracks.forEach(track => { track.path = null; track.localStep = 0; });
    nextStepTime = audioCtx.currentTime + 0.06;
    scheduler();
    schedulerTimer = window.setInterval(scheduler, lookAheadMs);
  }
}

function stopSequencer() {
  isPlaying = false;
  transport.setAttribute('aria-pressed', 'false');
  transport.textContent = 'PLAY';
  if (schedulerTimer) window.clearInterval(schedulerTimer);
  schedulerTimer = null;
  queuedFill = null;
  activeFill = null;
  updateAutoFillLights();
  document.querySelectorAll('.node.playhead').forEach(n => n.classList.remove('playhead'));
  document.querySelectorAll('.track-button.tempo-flash').forEach(b => b.classList.remove('tempo-flash'));
  document.querySelectorAll('.branch-pulse').forEach(line => {
    line.getAnimations().forEach(a => a.cancel());
    line.style.opacity = '0';
  });
}

for (let i = 0; i < TRACK_COUNT; i++) createTrack(i);

trackButtons.forEach((button, i) => {
  button.addEventListener('click', () => {
    const track = tracks[i];
    track.visible = !track.visible;
    track.area.classList.toggle('visible', track.visible);
    track.area.setAttribute('aria-hidden', String(!track.visible));
    updateTrackStatus(i);
    alignTrees();
  });
});

muteButtons.forEach((button, i) => {
  button.addEventListener('click', () => {
    const track = tracks[i];
    track.muted = !track.muted;
    button.setAttribute('aria-pressed', String(track.muted));
    if (track.gainNode && audioCtx) track.gainNode.gain.setTargetAtTime(track.muted ? 0 : track.volume, audioCtx.currentTime, .01);
  });
});


function filterFromSlider(value) {
  const min = 200, max = 20000;
  const t = Number(value) / 100;
  return min * Math.pow(max / min, t);
}

function setFilterVisual(channel, value) {
  const knob = channel.querySelector('.filter-knob');
  const indicator = knob.querySelector('span');
  const degrees = 135 + (Number(value) / 100) * 270;
  indicator.style.transform = `rotate(${degrees}deg)`;
  const hz = Math.round(filterFromSlider(value));
  knob.setAttribute('aria-valuenow', String(hz));
  knob.title = hz >= 1000 ? `${(hz/1000).toFixed(1)} kHz` : `${hz} Hz`;
}

function updateSampleButtonState(trackIndex, slot, loaded) {
  const channel = channels[trackIndex];
  if (!channel) return;
  const button = channel.querySelector(`.sample-button[data-sample="${slot}"]`);
  if (!button) return;
  button.classList.toggle('missing', loaded === false);
  button.title = loaded === false
    ? `${samplePrefixes[trackIndex]}${slot + 1}.ogg missing — fallback sound will be used`
    : `${samplePrefixes[trackIndex]}${slot + 1}.ogg`;
}

channels.forEach((channel, i) => {
  const t = channel.querySelector('.tune'), v = channel.querySelector('.volume'), p = channel.querySelector('.pan'), r = channel.querySelector('.reverb'), f = channel.querySelector('.filter');
  const fk = channel.querySelector('.filter-knob');
  const sampleButtons = [...channel.querySelectorAll('.sample-button')];
  sampleButtons.forEach((button, slot) => {
    button.addEventListener('click', async () => {
      tracks[i].selectedSample = slot;
      sampleButtons.forEach((b, n) => {
        const selected = n === slot;
        b.classList.toggle('selected', selected);
        b.setAttribute('aria-pressed', String(selected));
      });
      if (audioCtx && tracks[i].sampleStates[slot] === 'idle') await loadSampleSlot(tracks[i], slot);
    });
  });
  const apply = () => {
    const tr = tracks[i]; tr.tune=Number(t.value); tr.volume=Number(v.value)/100; tr.pan=Number(p.value)/100; tr.reverb=Number(r.value)/100; tr.filterHz=filterFromSlider(f.value);
    if (tr.gainNode) tr.gainNode.gain.setTargetAtTime(tr.muted?0:tr.volume,audioCtx.currentTime,.01);
    if (tr.panNode) tr.panNode.pan.setTargetAtTime(tr.pan,audioCtx.currentTime,.01);
    if (tr.sendGain) tr.sendGain.gain.setTargetAtTime(tr.reverb,audioCtx.currentTime,.01);
    if (tr.filterNode) tr.filterNode.frequency.setTargetAtTime(tr.filterHz,audioCtx.currentTime,.01);
    setFilterVisual(channel, f.value);
  };
  [t,v,p,r,f].forEach(el => el.addEventListener('input', apply));
  t.addEventListener('dblclick',()=>{t.value=0;apply();});
  p.addEventListener('dblclick',()=>{p.value=0;apply();});
  f.addEventListener('dblclick',()=>{f.value=100;apply();});

  let fd=false, fy=0;
  fk.addEventListener('pointerdown', e=>{fd=true;fy=e.clientY;fk.setPointerCapture(e.pointerId);});
  fk.addEventListener('pointermove', e=>{ if(!fd)return; const d=fy-e.clientY; if(Math.abs(d)>=1){f.value=Math.max(0,Math.min(100,Number(f.value)+d));fy=e.clientY;apply();}});
  fk.addEventListener('pointerup',()=>fd=false); fk.addEventListener('pointercancel',()=>fd=false);
  fk.addEventListener('wheel',e=>{e.preventDefault();f.value=Math.max(0,Math.min(100,Number(f.value)+(e.deltaY<0?2:-2)));apply();},{passive:false});
  fk.addEventListener('dblclick',()=>{f.value=100;apply();});
  setFilterVisual(channel, f.value);
});
swing.addEventListener('input',()=>{ swingValue.value=`${swing.value}%`; });


function setMiniKnobVisual(knob, slider, minDeg = 135, sweep = 270) {
    const indicator = knob.querySelector('span');

    const min = Number(slider.min) || 0;
    const max = Number(slider.max) || 100;
    const value = Number(slider.value);

    const t = (value - min) / (max - min);

    indicator.style.transform = `rotate(${minDeg + t * sweep}deg)`;
}

function updateLfoUi() {
  const hz = lfoRateFromSlider(lfoRate.value);
  lfoRateValue.value = hz < 1 ? `${hz.toFixed(2)} Hz` : `${hz.toFixed(1)} Hz`;
  lfoDepthValue.value = `${Number(lfoDepth.value).toFixed(0)} st`;
  setMiniKnobVisual(lfoRateKnob, lfoRate);
  setMiniKnobVisual(lfoDepthKnob, lfoDepth);
  updateLfoAudio();
}

function attachMiniKnob(knob, slider, resetValue) {
  let active = false;
  let lastY = 0;
  knob.addEventListener('pointerdown', event => {
    active = true;
    lastY = event.clientY;
    knob.setPointerCapture(event.pointerId);
  });
  knob.addEventListener('pointermove', event => {
    if (!active) return;
    const delta = lastY - event.clientY;
    if (Math.abs(delta) >= 1) {
      slider.value = String(Math.max(0, Math.min(100, Number(slider.value) + delta)));
      lastY = event.clientY;
      updateLfoUi();
    }
  });
  knob.addEventListener('pointerup', () => { active = false; });
  knob.addEventListener('pointercancel', () => { active = false; });
  knob.addEventListener('wheel', event => {
    event.preventDefault();
    slider.value = String(Math.max(0, Math.min(100, Number(slider.value) + (event.deltaY < 0 ? 2 : -2))));
    updateLfoUi();
  }, { passive: false });
  knob.addEventListener('dblclick', () => {
    slider.value = String(resetValue);
    updateLfoUi();
  });
}

lfoWaveButtons.forEach(button => {
  button.addEventListener('click', () => {
    lfoWave = button.dataset.wave === 'square' ? 'square' : 'sine';
    lfoWaveButtons.forEach(other => {
      const selected = other.dataset.wave === lfoWave;
      other.classList.toggle('active', selected);
      other.setAttribute('aria-pressed', String(selected));
    });
    if (lfoOsc) lfoOsc.type = lfoWave;
  });
});

lfoRouteButtons.forEach((button, i) => {
  button.addEventListener('click', () => {
    tracks[i].lfoEnabled = !tracks[i].lfoEnabled;
    button.setAttribute('aria-pressed', String(tracks[i].lfoEnabled));
    updateLfoAudio();
  });
});

lfoRate.addEventListener('input', updateLfoUi);
lfoDepth.addEventListener('input', updateLfoUi);
attachMiniKnob(lfoRateKnob, lfoRate, 42);
attachMiniKnob(lfoDepthKnob, lfoDepth, 0);


autoFillButtons.forEach((button, i) => {
  button.addEventListener('click', () => queueAutoFill(i));
});

transport.addEventListener('click', () => {
  if (isPlaying) stopSequencer();
  else startSequencer();
});

tempoKnob.addEventListener('wheel', event => {
  event.preventDefault();
  if (midiExternal) return;
  setTempo(Number(tempo.value) + (event.deltaY < 0 ? 1 : -1));
}, { passive: false });

let dragging = false;
let lastY = 0;

tempoKnob.addEventListener('pointerdown', event => {
  if (midiExternal) return;
  dragging = true;
  lastY = event.clientY;
  tempoKnob.setPointerCapture(event.pointerId);
});

tempoKnob.addEventListener('pointermove', event => {
  if (!dragging) return;
  const delta = lastY - event.clientY;
  if (Math.abs(delta) >= 1) {
    setTempo(Number(tempo.value) + delta);
    lastY = event.clientY;
  }
});

tempoKnob.addEventListener('pointerup', () => { dragging = false; });
tempoKnob.addEventListener('pointercancel', () => { dragging = false; });
tempoKnob.addEventListener('dblclick', () => { if (!midiExternal) setTempo(90); });

/* ---------- WEB MIDI CLOCK IN ----------
   F8 = timing clock, 24 pulses per quarter note.
   PFD master step = 1/16 note, therefore 6 F8 pulses per step.

   FA = establish musical ONE / reset hidden phase.
   FC = master-stop indication only; local PFD transport remains independent.
   The hidden phase continues to count while PFD is locally stopped.
*/
midiButton.addEventListener('click', async () => {
  midiPanel.classList.toggle('open');
  if (!midiAccess) await initMIDI();
});

async function initMIDI() {
  if (!navigator.requestMIDIAccess) {
    midiStatus.textContent = 'UNAVAILABLE';
    return;
  }
  try {
    midiStatus.textContent = 'REQUESTING';
    midiAccess = await navigator.requestMIDIAccess({ sysex:false });
    midiAccess.onstatechange = populateMidiInputs;
    populateMidiInputs();
    midiStatus.textContent = 'READY';
  } catch (err) {
    console.warn('MIDI access failed', err);
    midiStatus.textContent = 'DENIED';
  }
}

function populateMidiInputs() {
  const old = midiInput.value;
  midiInput.innerHTML = '<option value="">NO MIDI INPUT</option>';
  if (!midiAccess) return;

  for (const input of midiAccess.inputs.values()) {
    const option = document.createElement('option');
    option.value = input.id;
    option.textContent = input.name || 'MIDI INPUT';
    midiInput.appendChild(option);
  }

  if ([...midiInput.options].some(o => o.value === old)) midiInput.value = old;
}

midiInput.addEventListener('change', async () => {
  if (midiPort) midiPort.onmidimessage = null;
  midiPort = null;
  midiExternal = !!midiInput.value;

  midiLastPulseTime = 0;
  midiIntervals = [];
  midiClockSeenAt = 0;
  midiBpm.textContent = '--';

  if (!midiExternal) {
    fillStepCounter = 0;
    activeFill = null;
    updateAutoFillLights();
    midiStatus.textContent = 'READY';
    midiPhase.textContent = '--';

    if (isPlaying) {
      stepIndex = 0;
      tracks.forEach(track => { track.path = null; track.localStep = 0; });
      nextStepTime = audioCtx.currentTime + 0.05;
      if (schedulerTimer) window.clearInterval(schedulerTimer);
      scheduler();
      schedulerTimer = window.setInterval(scheduler, lookAheadMs);
    }
    return;
  }

  midiPort = midiAccess.inputs.get(midiInput.value);
  if (midiPort) {
    try { await midiPort.open(); } catch (err) {}
    midiPort.onmidimessage = handleMidiMessage;
    midiStatus.textContent = 'WAITING';

    if (schedulerTimer) window.clearInterval(schedulerTimer);
    schedulerTimer = null;
  }
});

function updateMidiTempoDisplay(bpm) {
  const min = Number(tempo.min);
  const max = Number(tempo.max);
  const clamped = Math.max(min, Math.min(max, Math.round(bpm)));
  setTempo(clamped);
  midiBpm.textContent = String(clamped);
}

function updateMidiPhaseDisplay() {
  const pulseInBar = ((midiPulseCounter % 96) + 96) % 96;
  const beat = Math.floor(pulseInBar / 24) + 1;
  const sixteenth = Math.floor((pulseInBar % 24) / 6) + 1;
  midiPhase.textContent = `${midiHasStartReference ? '' : '~'}${beat}.${sixteenth}`;
}

function flashMidiQuarter() {
  midiButton.classList.add('clock-pulse');
  window.setTimeout(() => midiButton.classList.remove('clock-pulse'), 70);
}

function resetPfdMusicalPhase() {
  midiPulseCounter = 0;
  midiStepCounter = 0;
  fillStepCounter = 0;
  activeFill = null;
  updateAutoFillLights();

  // FA establishes ONE for the engine's phase too, but does not start it.
  stepIndex = 0;
  tracks.forEach(track => {
    track.path = null;
    track.localStep = 0;
  });
}

function handleMidiMessage(event) {
  if (!event.data || !event.data.length) return;
  const status = event.data[0];

  if (status === 0xFA) {
    resetPfdMusicalPhase();
    midiHasStartReference = true;
    midiStatus.textContent = 'START / CLOCK';
    updateMidiPhaseDisplay();
    return;
  }

  if (status === 0xFC) {
    midiStatus.textContent = 'MASTER STOP';
    return;
  }

  if (status !== 0xF8) return;

  const now = performance.now();
  midiClockSeenAt = now;

  // BPM smoothing from recent F8 intervals.
  if (midiLastPulseTime) {
    const dt = now - midiLastPulseTime;
    if (dt > 1 && dt < 1000) {
      midiIntervals.push(dt);
      if (midiIntervals.length > 24) midiIntervals.shift();

      if (midiIntervals.length >= 6) {
        const avg = midiIntervals.reduce((a,b) => a+b, 0) / midiIntervals.length;
        const bpm = 60000 / (avg * 24);
        if (Number.isFinite(bpm) && bpm >= 20 && bpm <= 300) {
          updateMidiTempoDisplay(bpm);
        }
      }
    }
  }
  midiLastPulseTime = now;
  midiStatus.textContent = 'CLOCK';

  // Visual MIDI heartbeat on quarter notes.
  if (midiPulseCounter % 24 === 0) flashMidiQuarter();

  // Six MIDI clocks = one PFD 16th-note base step.
  if (midiPulseCounter % 6 === 0) {
    if (isPlaying) {
      if (!audioCtx) audioCtx = new AudioContext();
      const eventTime = audioCtx.currentTime + 0.006;

      // stepIndex/fillStepCounter reflect the external phase BEFORE scheduleStep advances them.
      stepIndex = midiStepCounter % LEVELS;
      fillStepCounter = midiStepCounter;
      scheduleStep(eventTime);
    }

    // This advances even while locally stopped.
    midiStepCounter++;
  }

  midiPulseCounter++;
  updateMidiPhaseDisplay();
}

window.setInterval(() => {
  if (midiExternal && midiClockSeenAt && performance.now() - midiClockSeenAt > 1000) {
    midiStatus.textContent = 'NO CLOCK';
    midiBpm.textContent = '--';
  }
}, 250);


window.addEventListener('resize', alignTrees);

alignTrees();
setTempo(Number(tempo.value));
updateLfoUi();
