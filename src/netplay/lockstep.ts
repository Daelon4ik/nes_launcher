// Платформо- и транспорто-независимое ядро лок-степ синхронизации кооп-сессии
// (см. docs/netplay.md, «Синхронизация»). Ничего не знает ни про NES/Genesis,
// ни про DOM/Tauri — только номера кадров, байты ввода и время, поэтому его
// можно гонять в симуляции с искусственной задержкой/джиттером/потерями сети.
//
// Что здесь решается (каждое — отдельная причина микрофризов в прошлой версии):
// - Темп эмуляции задают часы (нативный fps ядра), а не частота rAF/монитора:
//   на 144 Гц мониторе эмуляция не убегает вперёд и не упирается в партнёра
//   каждый тик, а короткая задержка сети потом догоняется (catch-up) вместо
//   того, чтобы навсегда сдвинуть эту сторону назад.
// - Свой ввод за кадр отправляется ровно один раз (раньше на каждом тике
//   стойки он перечитывался и переотправлялся с возможно другими кнопками —
//   партнёр мог уже применить первую версию, т.е. рассинхрон).
// - Пакет несёт ВСЁ, что партнёр ещё не подтвердил (ack), поэтому транспорт
//   может быть ненадёжным: потерянный пакет покрывается следующим, без
//   ожидания ретрансмита и блокировки очереди (head-of-line), как у reliable.
// - Тайм-синк: стороны обмениваются своим запасом по времени (margin — за
//   сколько кадров до того, как он понадобился, пришёл ввод партнёра), и та,
//   что убежала вперёд, плавно притормаживает — иначе более быстрая сторона
//   навсегда остаётся на краю окна задержки и стопорится на каждом малейшем
//   джиттере сети.
// - Старт по барьеру: часы запускаются только после первого пакета партнёра,
//   чтобы разница во времени загрузки двух инстансов не превращалась в фору.

export const INPUT_DELAY_FRAMES = 6;
// Задержка ввода может только расти (см. maybeRaiseDelay) — уменьшить её без
// согласования сторон нельзя: пришлось бы «выкинуть» уже отправленный кадр.
const MAX_INPUT_DELAY_FRAMES = 12;
// Если суммарный запас обеих сторон стабильно меньше этого (сеть медленнее,
// чем покрывает задержка ввода), каждая сторона добавляет себе кадр задержки.
const MIN_TOTAL_MARGIN_FRAMES = 5;
const DELAY_RAISE_COOLDOWN_MS = 2000;

// Сколько кадров можно догнать после стойки и сколько прогнать за один тик.
const MAX_CATCHUP_FRAMES = 8;
const MAX_STEPS_PER_TICK = 4;
// Длинный разрыв между тиками (окно свернули, rAF не вызывался) — не копить.
const MAX_TICK_GAP_MS = 250;
const DT_SMOOTHING = 0.1;
// Повторная отправка неподтверждённого окна, если нового ввода нет (стойка).
const RESEND_INTERVAL_MS = 33;

const MARGIN_SMOOTHING_MS = 500;
// Тормозим, только если впереди партнёра И свой запас уже мал: пока запаса
// хватает обоим, перекос безвреден, а каждое торможение — это видимый повтор
// кадра, так что зря его не делаем.
const LEAD_THRESHOLD_FRAMES = 1;
const COMFORT_MARGIN_FRAMES = 2;
// Насколько замедляться, пока сбрасываем опережение: 5% ≈ 3 кадра в секунду.
const SLOWDOWN_FRACTION = 0.05;
// После коррекции не оцениваем перекос заново, пока сглаженные замеры обеих
// сторон (и задержка сети до партнёра) не отразят её — иначе перелёт.
const TIME_SYNC_HOLD_MS = 2000;

const STALL_TIMEOUT_MS = 5000;
// До первого пакета партнёр может ещё грузиться (WASM-ядро Genesis и т.п.).
const START_TIMEOUT_MS = 20000;

/** Пакет ввода на проводе — Rust-транспорт (LAN/Steam) пересылает его как есть. */
export interface InputPacket {
  /** Номер кадра первого элемента `buttons`. */
  first: number;
  /** Ввод отправителя за кадры first..first+buttons.length-1 (по байту на кадр). */
  buttons: number[];
  /** Отправитель знает ввод получателя за все кадры < ack. */
  ack: number;
  /** Сглаженный запас отправителя в кадрах: насколько раньше нужного к нему приходит ввод получателя. */
  margin: number;
}

export interface LockstepOptions {
  fps: number;
  send: (packet: InputPacket) => void;
}

export interface TickResult {
  /** Сколько кадров прогнано за этот тик (0 — показывать нечего нового). */
  stepped: number;
  /** Партнёр слишком долго молчит — сессию пора завершать с ошибкой. */
  timedOut: boolean;
}

export class Lockstep {
  /** Следующий кадр, который будет эмулирован. */
  frameNo = 0;
  /** Текущая задержка своего ввода (кадров), см. maybeRaiseDelay. */
  delay = INPUT_DELAY_FRAMES;
  started = false;
  /** Сколько раз эмуляция вставала в ожидании ввода партнёра (для отладки/симуляции). */
  stalls = 0;

  private readonly frameMs: number;
  private readonly marginAlpha: number;
  private readonly sendFn: (packet: InputPacket) => void;

  private readonly local = new Map<number, number>();
  private readonly remote = new Map<number, number>();
  /** Когда пришёл ввод партнёра за кадр — для замера запаса (margin). */
  private readonly arrivals = new Map<number, number>();
  private nextSendFrame = INPUT_DELAY_FRAMES;
  private localPrunedUpTo = 0;
  /** Ввод партнёра известен для всех кадров < remoteReadyUpTo. */
  private remoteReadyUpTo = INPUT_DELAY_FRAMES;
  /** Партнёр подтвердил наш ввод для всех кадров < remoteAck. */
  private remoteAck = INPUT_DELAY_FRAMES;

  private lastNow: number | null = null;
  private budgetMs = 0;
  private smoothDtMs: number | null = null;
  private waitMs = 0;
  private dirty = false;
  private lastSendAt = -Infinity;

  // Обе стороны стартуют с одинакового нейтрального значения — перекос 0.
  private margin = INPUT_DELAY_FRAMES / 2;
  private remoteMargin = INPUT_DELAY_FRAMES / 2;
  private lastMarginEnd = -1;
  /** Сколько ещё времени часов «не засчитать» — оценённое опережение партнёра. */
  private shedMs = 0;
  private timeSyncHoldUntil = -Infinity;
  private startedAt = 0;
  private lastDelayRaiseAt = -Infinity;

  constructor(options: LockstepOptions) {
    this.frameMs = 1000 / options.fps;
    this.marginAlpha = 1 - Math.exp(-this.frameMs / MARGIN_SMOOTHING_MS);
    this.sendFn = options.send;
    // Кадры 0..INPUT_DELAY_FRAMES-1 не покрыты обычной отправкой (она
    // начинается с frameNo + delay) — обе стороны детерминированно
    // договариваются считать их "без нажатий" за обоих игроков.
    for (let frame = 0; frame < INPUT_DELAY_FRAMES; frame++) {
      this.local.set(frame, 0);
      this.remote.set(frame, 0);
    }
  }

  /** Пакет от партнёра (`now` — время прихода, в той же шкале, что у tick). Дубли, переупорядочивание и потери допустимы. */
  receive(packet: InputPacket, now: number): void {
    const end = packet.first + packet.buttons.length;
    for (let frame = Math.max(packet.first, this.remoteReadyUpTo); frame < end; frame++) {
      if (this.remote.has(frame)) continue;
      this.remote.set(frame, packet.buttons[frame - packet.first] & 0xff);
      this.arrivals.set(frame, now);
    }
    while (this.remote.has(this.remoteReadyUpTo)) this.remoteReadyUpTo++;

    if (packet.ack > this.remoteAck) {
      this.remoteAck = Math.min(packet.ack, this.nextSendFrame);
      this.pruneLocal();
    }
    // margin из более старого (переупорядоченного) пакета не должен затирать свежий.
    if (end >= this.lastMarginEnd) {
      this.lastMarginEnd = end;
      this.remoteMargin = packet.margin;
    }
  }

  /**
   * Один тик игрового цикла (rAF). `now` — время тика в мс, `readLocal` —
   * текущее состояние своих кнопок, `step` — прогнать ровно один кадр с
   * заданным вводом обоих игроков (рендер/звук — на стороне вызывающего,
   * один раз за тик, если stepped > 0).
   */
  tick(now: number, readLocal: () => number, step: (localBits: number, remoteBits: number) => void): TickResult {
    const dt = this.lastNow === null ? 0 : Math.min(Math.max(now - this.lastNow, 0), MAX_TICK_GAP_MS);
    this.lastNow = now;

    // Ввод читается раз за тик; если за тик прогоняется несколько кадров,
    // на все новые отправляемые кадры идёт одно и то же состояние кнопок.
    const bits = readLocal() & 0xff;
    this.queueLocal(bits);

    if (!this.started) {
      if (this.remoteReadyUpTo > INPUT_DELAY_FRAMES) {
        this.started = true;
        this.startedAt = now;
        this.waitMs = 0;
      } else {
        this.waitMs += dt;
        this.flush(now);
        return { stepped: 0, timedOut: this.waitMs >= START_TIMEOUT_MS };
      }
    }

    // Шаг часов — сглаженный интервал между тиками: rAF тикает периодично,
    // а его дрожание на доли мс иначе даёт чередование 0/2 кадров за тик,
    // пока остаток бюджета у границы кадра (60 Гц монитор против 60.0988 fps
    // NES — раз в ~10 с). Сумма сглаженных шагов равна сумме реальных (фильтр
    // с единичным усилением), так что темп эмуляции не меняется.
    if (dt > 0) this.smoothDtMs = this.smoothDtMs === null ? dt : this.smoothDtMs + (dt - this.smoothDtMs) * DT_SMOOTHING;
    let advanceMs = this.smoothDtMs ?? 0;
    if (this.shedMs > 0) {
      // Тормозим: часть шага не засчитываем, а «долг» на догонялки сверх
      // кадра (впереди партнёра он мнимый) сбрасываем сразу.
      const shed = Math.min(this.shedMs, advanceMs * SLOWDOWN_FRACTION + Math.max(0, this.budgetMs - this.frameMs));
      advanceMs -= shed;
      this.shedMs -= shed;
      if (this.shedMs <= 0) {
        this.shedMs = 0;
        this.timeSyncHoldUntil = now + TIME_SYNC_HOLD_MS;
      }
    }
    this.budgetMs = Math.min(this.budgetMs + advanceMs, MAX_CATCHUP_FRAMES * this.frameMs);

    let stepped = 0;
    let starved = false;
    // Кадр считается «пора» с половины его длительности (округление, а не
    // floor) — так джиттер времени тиков около границы кадра не превращается
    // в чередование 0/2 кадров за тик при fps ≈ частоте монитора.
    while (this.budgetMs >= this.frameMs / 2 && stepped < MAX_STEPS_PER_TICK) {
      const remoteBits = this.remote.get(this.frameNo);
      if (remoteBits === undefined) {
        // Ввода партнёра для этого кадра ещё нет — не продвигаемся: кадр не
        // эмулируется, пока обе стороны не знают ввод обоих игроков для него.
        starved = true;
        break;
      }
      this.observeMargin(this.frameNo, now - (this.budgetMs - this.frameMs / 2));
      step(this.local.get(this.frameNo) ?? 0, remoteBits);
      this.remote.delete(this.frameNo);
      this.frameNo++;
      this.budgetMs -= this.frameMs;
      stepped++;
      this.queueLocal(bits);
    }
    this.pruneLocal();

    if (starved && stepped === 0) {
      if (this.waitMs === 0) this.stalls++;
      this.waitMs += dt;
    } else {
      this.waitMs = 0;
    }

    this.updateTimeSync(now);
    this.flush(now);
    return { stepped, timedOut: this.waitMs >= STALL_TIMEOUT_MS };
  }

  private queueLocal(bits: number): void {
    while (this.nextSendFrame <= this.frameNo + this.delay) {
      this.local.set(this.nextSendFrame++, bits);
      this.dirty = true;
    }
  }

  private pruneLocal(): void {
    const keepFrom = Math.min(this.frameNo, this.remoteAck);
    while (this.localPrunedUpTo < keepFrom) this.local.delete(this.localPrunedUpTo++);
  }

  /**
   * Запас по кадру: насколько раньше момента, когда кадр стал «пора» по
   * часам (dueAt), пришёл ввод партнёра за него (отрицательный — пришлось
   * ждать). Меряется во времени, а не в штуках кадров в буфере: число кадров
   * квантуется тиками rAF и шумит на ±1-2 кадра, а время прихода — нет.
   */
  private observeMargin(frame: number, dueAt: number): void {
    const arrivedAt = this.arrivals.get(frame);
    if (arrivedAt === undefined) return; // предзаполненные стартовые кадры
    this.arrivals.delete(frame);
    this.margin += ((dueAt - arrivedAt) / this.frameMs - this.margin) * this.marginAlpha;
  }

  /**
   * Опережение относительно партнёра в кадрах: если мы впереди на k кадров,
   * ввод партнёра нам нужен на k кадров раньше (наш запас меньше на k), а
   * наш ему — на k позже (его запас больше на k); сетевая задержка входит в
   * оба запаса одинаково и в разнице сокращается — отсюда (его - наш) / 2.
   */
  private updateTimeSync(now: number): void {
    if (this.shedMs === 0 && now >= this.timeSyncHoldUntil) {
      const lead = (this.remoteMargin - this.margin) / 2;
      if (lead > LEAD_THRESHOLD_FRAMES && this.margin < COMFORT_MARGIN_FRAMES) this.shedMs = lead * this.frameMs;
    }
    this.maybeRaiseDelay(now);
  }

  /**
   * Сеть медленнее, чем покрывает задержка ввода (суммарный запас обеих сторон
   * стабильно мал) — значит стойки будут постоянно, сколько ни балансируй.
   * Добавляем себе кадр задержки: свой ввод начинает уходить на кадр раньше
   * нужного партнёру, его запас растёт на кадр (партнёр делает то же самое
   * для нас). Согласования не требует — следующий тик просто отправит лишний
   * кадр с тем же вводом.
   */
  private maybeRaiseDelay(now: number): void {
    if (this.delay >= MAX_INPUT_DELAY_FRAMES || now - this.lastDelayRaiseAt < DELAY_RAISE_COOLDOWN_MS) return;
    // Пока стороны не выровнены (старт, идущая коррекция), стойки опережающей
    // стороны занижают запас обеих — это не признак медленной сети.
    if (now - this.startedAt < DELAY_RAISE_COOLDOWN_MS || this.shedMs > 0) return;
    if (this.margin + this.remoteMargin >= MIN_TOTAL_MARGIN_FRAMES) return;
    this.delay++;
    this.lastDelayRaiseAt = now;
  }

  private flush(now: number): void {
    if (!this.dirty && now - this.lastSendAt < RESEND_INTERVAL_MS) return;
    const buttons: number[] = [];
    for (let frame = this.remoteAck; frame < this.nextSendFrame; frame++) buttons.push(this.local.get(frame) ?? 0);
    this.sendFn({ first: this.remoteAck, buttons, ack: this.remoteReadyUpTo, margin: this.margin });
    this.dirty = false;
    this.lastSendAt = now;
  }
}
