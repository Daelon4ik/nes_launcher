// Звуковой вывод кооп-движка (src/netplay/engine.ts) — общий для NES и Genesis.
//
// Почему не jsnes Speakers (NES) и не AudioBufferSourceNode на каждый кадр
// (Genesis), как в одиночной игре: оба играют звук «впритык» — без запаса в
// буфере. В одиночной игре это терпимо (jsnes при опустошении буфера сам
// догоняет лишними кадрами), а в кооп-сессии темп кадров зависит ещё и от
// сети: любой кадр, пришедший на пару мс позже, давал провал звука (щелчок /
// «заикание»). Здесь же:
// - джиттер-буфер: воспроизведение стартует, только когда накоплено
//   TARGET_LATENCY_MS звука, и после опустошения снова ждёт этого запаса —
//   короткая стойка или догоняющий рывок не слышны;
// - мягкая подстройка скорости (±0.5%, на слух незаметно) держит заполнение
//   буфера около цели — часы эмуляции (performance.now) и звуковой карты
//   немного расходятся, иначе буфер со временем переполнялся бы или пустел;
// - ресемплинг с частоты ядра на частоту AudioContext — там же (линейная
//   интерполяция), так что Genesis с его 44.1/53 кГц не требует отдельного пути.

// Сколько звука держать в буфере (мс): закрывает стойку до ~2 кадров и
// неравномерность тиков rAF, но ещё не даёт заметного отставания звука от картинки.
const TARGET_LATENCY_MS = 50;

const PROCESSOR_NAME = "netplay-audio";

// Код AudioWorkletProcessor строкой — грузится через Blob URL, как и в
// jsnes Speakers, без бандлер-специфичных импортов (?worker/?raw).
const workletCode = `
class NetplayAudioProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const { inputRate, targetMs } = options.processorOptions;
    this.baseRatio = inputRate / sampleRate;
    this.target = Math.max(256, Math.round((inputRate * targetMs) / 1000));
    this.capacity = Math.max(this.target * 4, Math.round(inputRate));
    this.buf = new Float32Array(this.capacity * 2);
    this.read = 0;
    this.write = 0;
    this.count = 0;
    this.frac = 0;
    this.avg = 0;
    this.playing = false;
    this.port.onmessage = (e) => this.push(e.data);
  }

  push(chunk) {
    const frames = chunk.length >> 1;
    for (let i = 0; i < frames; i++) {
      if (this.count === this.capacity) {
        this.read = (this.read + 1) % this.capacity;
        this.count--;
      }
      this.buf[this.write * 2] = chunk[i * 2];
      this.buf[this.write * 2 + 1] = chunk[i * 2 + 1];
      this.write = (this.write + 1) % this.capacity;
      this.count++;
    }
  }

  process(_inputs, outputs) {
    const left = outputs[0][0];
    const right = outputs[0][1] || left;
    const n = left.length;
    if (!this.playing) {
      if (this.count < this.target) {
        left.fill(0);
        right.fill(0);
        return true;
      }
      this.playing = true;
      this.avg = this.count;
      this.frac = 0;
    }

    this.avg += (this.count - this.avg) * 0.01;
    const deviation = Math.max(-1, Math.min(1, (this.avg - this.target) / this.target));
    const ratio = this.baseRatio * (1 + deviation * 0.005);
    if (this.count < Math.floor(this.frac + (n - 1) * ratio) + 2) {
      // Буфер опустел — тишина и заново копим запас, вместо рваного звука.
      this.playing = false;
      left.fill(0);
      right.fill(0);
      return true;
    }

    const buf = this.buf;
    const cap = this.capacity;
    let pos = this.frac;
    for (let i = 0; i < n; i++) {
      const idx = Math.floor(pos);
      const t = pos - idx;
      let a = this.read + idx;
      if (a >= cap) a -= cap;
      let b = a + 1;
      if (b >= cap) b -= cap;
      left[i] = buf[a * 2] + (buf[b * 2] - buf[a * 2]) * t;
      if (right !== left) right[i] = buf[a * 2 + 1] + (buf[b * 2 + 1] - buf[a * 2 + 1]) * t;
      pos += ratio;
    }
    const consumed = Math.floor(pos);
    this.read = (this.read + consumed) % cap;
    this.count -= consumed;
    this.frac = pos - consumed;
    return true;
  }
}

registerProcessor("${PROCESSOR_NAME}", NetplayAudioProcessor);
`;

export interface NetplayAudioOptions {
  volume: number;
  /** Частота, в которой ядро выдаёт сэмплы; по умолчанию — частота AudioContext (так делает NES, см. sampleRate). */
  inputSampleRate?: number;
}

export class NetplayAudio {
  /** Частота AudioContext — NES (jsnes) генерирует звук сразу в ней, без ресемплинга. */
  readonly sampleRate: number;

  private readonly ctx: AudioContext;
  private readonly gain: GainNode;
  private readonly inputRate: number;
  private node: AudioWorkletNode | null = null;
  private batch = new Float32Array(4096);
  private batchLen = 0;
  private closed = false;
  private resumeOnInteraction: (() => void) | null = null;

  constructor(options: NetplayAudioOptions) {
    this.ctx = new AudioContext();
    this.sampleRate = this.ctx.sampleRate;
    this.inputRate = options.inputSampleRate ?? this.ctx.sampleRate;
    this.gain = this.ctx.createGain();
    this.gain.gain.value = options.volume;
    this.gain.connect(this.ctx.destination);
    // Звук не критичен для сессии: если worklet не поднялся, игра идёт без него.
    this.init().catch((err) => console.error("netplay audio:", err));
  }

  private async init(): Promise<void> {
    const url = URL.createObjectURL(new Blob([workletCode], { type: "application/javascript" }));
    try {
      await this.ctx.audioWorklet.addModule(url);
    } finally {
      URL.revokeObjectURL(url);
    }
    if (this.closed) return;
    this.node = new AudioWorkletNode(this.ctx, PROCESSOR_NAME, {
      numberOfInputs: 0,
      outputChannelCount: [2],
      processorOptions: { inputRate: this.inputRate, targetMs: TARGET_LATENCY_MS },
    });
    this.node.connect(this.gain);

    // Политика автозапуска может держать AudioContext в suspended до жеста
    // пользователя — тот же обход, что у jsnes Speakers.
    if (this.ctx.state === "suspended") {
      this.resumeOnInteraction = () => {
        void this.ctx.resume();
        this.removeResumeListeners();
      };
      document.addEventListener("keydown", this.resumeOnInteraction);
      document.addEventListener("mousedown", this.resumeOnInteraction);
    }
  }

  /** Один стерео-сэмпл в диапазоне [-1, 1] (колбэк onAudioSample у jsnes). */
  writeSample = (left: number, right: number): void => {
    if (this.batchLen + 2 > this.batch.length) {
      const grown = new Float32Array(this.batch.length * 2);
      grown.set(this.batch);
      this.batch = grown;
    }
    this.batch[this.batchLen++] = left;
    this.batch[this.batchLen++] = right;
  };

  /** Interleaved S16-стерео (формат GenesisCore.drainAudio). */
  writeS16(samples: Int16Array): void {
    for (let i = 0; i + 1 < samples.length; i += 2) this.writeSample(samples[i] / 32768, samples[i + 1] / 32768);
  }

  /** Отдаёт накопленное за тик в worklet одним сообщением. */
  flush(): void {
    if (this.batchLen === 0) return;
    if (this.node) {
      const chunk = this.batch.slice(0, this.batchLen);
      this.node.port.postMessage(chunk, [chunk.buffer]);
    }
    this.batchLen = 0;
  }

  private removeResumeListeners(): void {
    if (!this.resumeOnInteraction) return;
    document.removeEventListener("keydown", this.resumeOnInteraction);
    document.removeEventListener("mousedown", this.resumeOnInteraction);
    this.resumeOnInteraction = null;
  }

  destroy(): void {
    this.closed = true;
    this.removeResumeListeners();
    this.node?.disconnect();
    this.node = null;
    this.ctx.close().catch(() => {});
  }
}
