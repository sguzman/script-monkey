'use strict';

// Only a response completion asks this offscreen document to make sound.
// Chrome automatically tears down AUDIO_PLAYBACK documents after inactivity.
// No heartbeat, polling loop, DOM observer, or per-tab audio context.
let audioContext = null;

function withDeadline(promise, timeoutMs, stage) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(
      new Error('Audio ' + stage + ' timed out after ' + timeoutMs + ' ms')
    ), timeoutMs);
    Promise.resolve(promise).then(
      value => { clearTimeout(timer); resolve(value); },
      error => { clearTimeout(timer); reject(error); }
    );
  });
}

async function runningAudioContext() {
  if (!audioContext || audioContext.state === 'closed') {
    audioContext = new AudioContext();
  }
  if (audioContext.state !== 'running') {
    await withDeadline(audioContext.resume(), 1800, 'resume');
  }
  if (audioContext.state !== 'running') {
    throw new Error('Audio context is ' + audioContext.state + ', not running');
  }
  return audioContext;
}

function tone(ctx, frequency, start, duration, volume) {
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.type = 'sine';
  oscillator.frequency.value = frequency;
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(volume, start + 0.02);
  gain.gain.setValueAtTime(volume, start + duration - 0.06);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(gain);
  gain.connect(ctx.destination);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.01);
  return oscillator;
}

async function playCompletionSound() {
  const ctx = await runningAudioContext();
  // Two clear, nonoverlapping tones (~0.7 seconds). Longer and louder
  // than the original 0.4-second, low-gain chime.
  const start = ctx.currentTime + 0.03;
  const first = tone(ctx, 740, start, 0.28, 0.35);
  const second = tone(ctx, 988, start + 0.34, 0.32, 0.38);
  const expectedEnd = start + 0.34 + 0.32;

  // AudioContext "running" and two scheduled oscillators by themselves
  // prove nothing about rendering. Wait for the second oscillator to end,
  // then verify that the Web Audio clock actually progressed.
  await withDeadline(new Promise((resolve, reject) => {
    second.addEventListener('ended', resolve, { once: true });
    second.addEventListener('error', () => reject(
      new Error('Second chime oscillator failed')
    ), { once: true });
  }), 2400, 'render');
  if (ctx.state !== 'running' || ctx.currentTime < expectedEnd - 0.025) {
    throw new Error('Audio did not advance through the chime');
  }
  return { ok: true, rendered: true, contextState: ctx.state,
    durationSeconds: 0.66 };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'PLAY_COMPLETION_SOUND') return;
  playCompletionSound()
    .then(sendResponse)
    .catch(error => {
      console.error('ChatGPT Tab Signal offscreen audio failed', error);
      sendResponse({ ok: false, error: String(error?.message || error) });
    });
  return true;
});
