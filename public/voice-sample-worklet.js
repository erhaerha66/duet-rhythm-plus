class VoiceSampleRecorder extends AudioWorkletProcessor {
  samples = new Int16Array(80_000);
  count = 0;
  phase = 0;
  sum = 0;
  frames = 0;

  constructor() {
    super();
    this.port.onmessage = () => this.finish();
  }

  finish() {
    if (!this.samples) return;
    const result = this.samples.slice(0, this.count);
    this.samples = null;
    this.port.postMessage(result.buffer, [result.buffer]);
  }

  process(inputs) {
    const input = inputs[0]?.[0];
    if (!this.samples || !input) return true;
    for (const value of input) {
      this.sum += value;
      this.frames += 1;
      this.phase += 16_000;
      if (this.phase < sampleRate) continue;
      this.phase -= sampleRate;
      this.samples[this.count++] = Math.max(-1, Math.min(1, this.sum / this.frames)) * 32767;
      this.sum = 0;
      this.frames = 0;
      if (this.count === this.samples.length) {
        this.finish();
        break;
      }
    }
    return true;
  }
}

registerProcessor('voice-sample-recorder', VoiceSampleRecorder);
