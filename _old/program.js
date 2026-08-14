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
const midiOverlay = document.getElementById('midiOverlay');
const midiClose = document.getElementById('midiClose');
const midiInputSelect = document.getElementById('midiInput');
const midiStatus = document.getElementById('midiStatus');
const midiBpm = document.getElementById('midiBpm');

const tracks = [];
let audioCtx = null;
let isPlaying = false;
let schedulerTimer = null;
let nextStepTime = 0;
let stepIndex = 0;
const lookAheadMs = 25;
const scheduleAheadSec = 0.10;

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

function setTempoVisualOnly(bpm) {
  const min = Number(tempo.min);
  const max = Number(tempo.max);
  const clamped = Math.max(min, Math.min(max, Math.round(bpm)));
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

function synthFallback(trackIndex, time) {
  const gain = audioCtx.createGain();
  gain.connect(tracks[trackIndex].filterNode || tracks[trackIndex].gainNode || audioCtx.destination);

  if (trackIndex === 0) {
    const osc = audioCtx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(135, time);
    osc.frequency.exponentialRampToValueAtTime(45, time + 0.10);
    gain.gain.setValueAtTime(0.9, time);
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
    gain.gain.setValueAtTime(0.35, time);
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
    gain.gain.setValueAtTime(0.22, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.045);
    noise.connect(hp).connect(gain); noise.start(time); noise.stop(time + 0.05);
  } else {
    const osc = audioCtx.createOscillator();
    osc.type = 'square'; osc.frequency.setValueAtTime(620, time);
    osc.frequency.exponentialRampToValueAtTime(210, time + 0.07);
    gain.gain.setValueAtTime(0.16, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.09);
    osc.connect(gain); osc.start(time); osc.stop(time + 0.10);
  }
}

function triggerTrack(track, time) {
  if (track.muted) return;
  const buffer = track.buffers[track.selectedSample];
  if (buffer) {
    const source = audioCtx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = Math.pow(2, track.tune / 12);
    if (track.lfoEnabled && track.lfoGain) track.lfoGain.connect(source.detune);
    source.connect(track.filterNode || track.gainNode || audioCtx.destination);
    source.start(time);
  } else {
    synthFallback(track.index, time);
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
}

function scheduler() {
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
  stepIndex = 0;
  tracks.forEach(track => { track.path = null; track.localStep = 0; });
  nextStepTime = audioCtx.currentTime + 0.06;
  scheduler();
  schedulerTimer = window.setInterval(scheduler, lookAheadMs);
}

function stopSequencer() {
  isPlaying = false;
  transport.setAttribute('aria-pressed', 'false');
  transport.textContent = 'PLAY';
  if (schedulerTimer) window.clearInterval(schedulerTimer);
  schedulerTimer = null;
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


// ---- MIDI CLOCK TEST LAYER (display only; does not drive the sequencer yet) ----
let midiAccess = null;
let activeMidiInput = null;
let midiClockTimes = [];
let midiClockCount = 0;
let midiLastClockAt = 0;
let midiClockLostTimer = null;
let midiPulseTimer = null;

function setMidiStatus(text) {
  if (midiStatus) midiStatus.value = text;
}

function restoreInternalTempoVisual() {
  setTempoVisualOnly(Number(tempo.value));
}

function clearMidiClockState(showLost = false) {
  midiClockTimes = [];
  midiClockCount = 0;
  midiLastClockAt = 0;
  if (midiBpm) midiBpm.value = '-- BPM';
  if (showLost) setMidiStatus(activeMidiInput ? 'NO CLOCK' : 'OFF');
  restoreInternalTempoVisual();
}

function flashMidiButton() {
  if (!midiButton) return;
  midiButton.classList.add('clock-pulse');
  if (midiPulseTimer) clearTimeout(midiPulseTimer);
  midiPulseTimer = setTimeout(() => midiButton.classList.remove('clock-pulse'), 80);
}

function updateMidiBpm(timestamp) {
  midiClockTimes.push(timestamp);
  if (midiClockTimes.length > 25) midiClockTimes.shift();
  if (midiClockTimes.length < 7) return;

  const elapsed = midiClockTimes[midiClockTimes.length - 1] - midiClockTimes[0];
  const intervals = midiClockTimes.length - 1;
  if (elapsed <= 0) return;

  const msPerClock = elapsed / intervals;
  const bpm = 60000 / (msPerClock * 24);
  if (!Number.isFinite(bpm) || bpm < 20 || bpm > 300) return;

  const rounded = Math.round(bpm);
  midiBpm.value = `${rounded} BPM`;
  setMidiStatus('CLOCK');
  setTempoVisualOnly(rounded);
}

function handleMidiMessage(event) {
  const status = event.data && event.data[0];
  if (status !== 0xF8) return; // MIDI Timing Clock only

  const now = event.timeStamp || performance.now();
  midiLastClockAt = now;
  midiClockCount = (midiClockCount + 1) % 24;
  updateMidiBpm(now);

  // Blink on quarter notes, not on all 24 clock pulses.
  if (midiClockCount === 0) flashMidiButton();

  if (midiClockLostTimer) clearTimeout(midiClockLostTimer);
  midiClockLostTimer = setTimeout(() => {
    const age = performance.now() - midiLastClockAt;
    if (age > 650) clearMidiClockState(true);
  }, 700);
}

function disconnectMidiInput() {
  if (activeMidiInput) activeMidiInput.onmidimessage = null;
  activeMidiInput = null;
  midiButton?.classList.remove('connected', 'clock-pulse');
  clearMidiClockState(false);
}

function connectMidiInput(id) {
  disconnectMidiInput();
  if (!midiAccess || !id) { setMidiStatus('OFF'); return; }
  const input = midiAccess.inputs.get(id);
  if (!input) { setMidiStatus('MISSING'); return; }
  activeMidiInput = input;
  activeMidiInput.onmidimessage = handleMidiMessage;
  midiButton?.classList.add('connected');
  setMidiStatus('READY');
}

function populateMidiInputs() {
  if (!midiInputSelect || !midiAccess) return;
  const previous = activeMidiInput?.id || midiInputSelect.value;
  midiInputSelect.innerHTML = '';
  const none = document.createElement('option');
  none.value = '';
  none.textContent = 'No MIDI input';
  midiInputSelect.appendChild(none);
  for (const input of midiAccess.inputs.values()) {
    const option = document.createElement('option');
    option.value = input.id;
    option.textContent = input.name || input.manufacturer || 'MIDI input';
    midiInputSelect.appendChild(option);
  }
  if ([...midiInputSelect.options].some(o => o.value === previous)) {
    midiInputSelect.value = previous;
  }
}

async function ensureMidiAccess() {
  if (midiAccess) return true;
  if (!navigator.requestMIDIAccess) {
    setMidiStatus('UNAVAILABLE');
    return false;
  }
  try {
    midiAccess = await navigator.requestMIDIAccess({ sysex: false });
    midiAccess.onstatechange = () => {
      populateMidiInputs();
      if (activeMidiInput && !midiAccess.inputs.get(activeMidiInput.id)) disconnectMidiInput();
    };
    populateMidiInputs();
    setMidiStatus('READY');
    return true;
  } catch (err) {
    console.warn('MIDI access denied or unavailable', err);
    setMidiStatus('DENIED');
    return false;
  }
}

async function openMidiOverlay() {
  midiOverlay.hidden = false;
  midiButton.setAttribute('aria-expanded', 'true');
  await ensureMidiAccess();
}

function closeMidiOverlay() {
  midiOverlay.hidden = true;
  midiButton.setAttribute('aria-expanded', 'false');
}

midiButton?.addEventListener('click', openMidiOverlay);
midiClose?.addEventListener('click', closeMidiOverlay);
midiOverlay?.addEventListener('click', event => { if (event.target === midiOverlay) closeMidiOverlay(); });
window.addEventListener('keydown', event => { if (event.key === 'Escape' && !midiOverlay?.hidden) closeMidiOverlay(); });
midiInputSelect?.addEventListener('change', () => connectMidiInput(midiInputSelect.value));


transport.addEventListener('click', () => {
  if (isPlaying) stopSequencer();
  else startSequencer();
});

tempoKnob.addEventListener('wheel', event => {
  event.preventDefault();
  setTempo(Number(tempo.value) + (event.deltaY < 0 ? 1 : -1));
}, { passive: false });

let dragging = false;
let lastY = 0;

tempoKnob.addEventListener('pointerdown', event => {
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
tempoKnob.addEventListener('dblclick', () => setTempo(90));
window.addEventListener('resize', alignTrees);

alignTrees();
setTempo(Number(tempo.value));
updateLfoUi();
