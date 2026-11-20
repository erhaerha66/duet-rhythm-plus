export const voiceSampleEditor = `<section class="voice-sample">
  <p>最多录 5 秒。试听满意后，可以发布到玩家列表，也可以随时下架。</p>
  <div class="dialog-actions">
    <button class="button outline" type="button" data-record>开始录音</button>
    <button class="button outline" type="button" data-stop hidden>停止录音</button>
    <button class="button primary" type="button" data-publish hidden>公开发布</button>
    <button class="button outline" type="button" data-remove>下架试听</button>
  </div>
  <audio controls preload="none" aria-label="试听录音" hidden></audio>
  <p role="status"></p>
</section>`;

function encodeWav(buffer) {
  const samples = new Int16Array(buffer);
  const header = new DataView(new ArrayBuffer(44));
  header.setUint32(0, 0x52494646);
  header.setUint32(4, 36 + samples.byteLength, true);
  header.setUint32(8, 0x57415645);
  header.setUint32(12, 0x666d7420);
  header.setUint32(16, 16, true);
  header.setUint16(20, 1, true);
  header.setUint16(22, 1, true);
  header.setUint32(24, 16_000, true);
  header.setUint32(28, 32_000, true);
  header.setUint16(32, 2, true);
  header.setUint16(34, 16, true);
  header.setUint32(36, 0x64617461);
  header.setUint32(40, samples.byteLength, true);
  const pcm = new DataView(new ArrayBuffer(samples.byteLength));
  for (const [index, value] of samples.entries()) pcm.setInt16(index * 2, value, true);
  return new Blob([header, pcm], { type: 'audio/wav' });
}

export class VoiceSampleEditor {
  constructor(element, key, changed) {
    this.key = key;
    this.changed = changed;
    this.record = element.querySelector('[data-record]');
    this.stop = element.querySelector('[data-stop]');
    this.publish = element.querySelector('[data-publish]');
    this.remove = element.querySelector('[data-remove]');
    this.audio = element.querySelector('audio');
    this.status = element.querySelector('[role="status"]');
    this.record.addEventListener('click', () => this.start());
    this.stop.addEventListener('click', () => this.worklet?.port.postMessage('stop'));
    this.publish.addEventListener('click', () => this.update('POST'));
    this.remove.addEventListener('click', () => this.update('DELETE'));
  }

  async start() {
    const Context = window.AudioContext ?? window.webkitAudioContext;
    if (!Context || !window.AudioWorkletNode || !navigator.mediaDevices?.getUserMedia) {
      this.status.textContent = '当前浏览器无法录音。';
      return;
    }
    this.record.disabled = this.remove.disabled = this.publish.disabled = true;
    this.audio.pause();
    this.status.textContent = '正在请求麦克风权限…';
    try {
      this.context = new Context();
      const context = this.context;
      const resume = context.resume();
      resume.catch(() => {});
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 } });
      if (this.closed) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      this.stream = stream;
      await resume;
      await context.audioWorklet.addModule('/voice-sample-worklet.js');
      if (this.closed) return;
      this.worklet = new AudioWorkletNode(context, 'voice-sample-recorder');
      this.worklet.port.onmessage = event => this.complete(event.data);
      context.createMediaStreamSource(stream).connect(this.worklet).connect(context.destination);
      this.stop.hidden = false;
      this.status.textContent = '正在录音，最多 5 秒…';
      this.timer = setTimeout(() => this.release('录音中断，请重新录制。'), 6500);
    } catch {
      if (!this.closed) this.release('无法录音，请检查麦克风权限后重试。');
    }
  }

  complete(buffer) {
    if (this.closed || !this.worklet) return;
    if (buffer.byteLength < 3200) {
      this.release('录音太短，请重新录制。');
      return;
    }
    this.draft = encodeWav(buffer);
    if (this.preview) URL.revokeObjectURL(this.preview);
    this.preview = URL.createObjectURL(this.draft);
    this.audio.src = this.preview;
    this.audio.hidden = this.publish.hidden = false;
    this.release('可以先试听，再公开发布。');
  }

  release(message) {
    clearTimeout(this.timer);
    this.stream?.getTracks().forEach(track => track.stop());
    this.stream = undefined;
    this.worklet?.port.close();
    this.worklet = undefined;
    this.context?.close().catch(() => {});
    this.context = undefined;
    this.stop.hidden = true;
    this.record.disabled = this.remove.disabled = this.publish.disabled = false;
    if (message) this.status.textContent = message;
  }

  async update(method) {
    this.record.disabled = this.remove.disabled = this.publish.disabled = true;
    try {
      const headers = { 'X-Jianke-Guest-Key': await this.key() };
      const response = await fetch('/api/voice-sample', {
        method, headers, body: method === 'POST' ? this.draft : undefined, signal: AbortSignal.timeout(15_000)
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      this.changed();
      if (this.closed) return;
      this.publish.hidden = true;
      if (method === 'DELETE') {
        this.audio.removeAttribute('src');
        this.audio.load();
        this.audio.hidden = true;
      }
      this.status.textContent = method === 'POST' ? '试听已公开发布。' : '试听已下架。';
    } catch (error) {
      if (!this.closed) this.status.textContent = ['TimeoutError', 'TypeError'].includes(error.name)
        ? '连接中断，请重试。' : error.message;
    } finally {
      this.record.disabled = this.remove.disabled = this.publish.disabled = false;
    }
  }

  destroy() {
    this.closed = true;
    this.release();
    this.audio.pause();
    if (this.preview) URL.revokeObjectURL(this.preview);
  }
}
