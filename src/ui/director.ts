/** Co režisér potřebuje vědět o scéně. Texty a vzhled řeší `beats.ts` a `stage.ts`. */
export interface DirectorHooks<State, Beat> {
  /** Scéna začíná. */
  play(beat: Beat): void;
  /**
   * Jak dlouho scéna trvá, v milisekundách. `hold` znamená, že čeká na `skip()`, tedy na klik.
   * Volá se až po `play`, takže může záviset na něm.
   */
  duration(beat: Beat, backlog: number): number | 'hold';
  /** Začíná poslední scéna dávky: rozhraní už smí ukázat nový stav hry. */
  settle(state: State): void;
  /** Všechno je dohrané. */
  idle(): void;
}

interface Batch<State, Beat> {
  state: State;
  beats: Beat[];
  next: number;
}

/**
 * Přehrává události hry po jedné. Pravidla běží okamžitě, režisér jen rozhoduje,
 * co a kdy hráč uvidí. Vstup hráče i tahy botů čekají, dokud je `busy`.
 */
export class Director<State, Beat> {
  private readonly queue: Batch<State, Beat>[] = [];
  private batch: Batch<State, Beat> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private holding = false;
  private stopped = false;

  constructor(private readonly hooks: DirectorHooks<State, Beat>) {}

  get busy(): boolean {
    return this.timer !== null || this.holding || this.batch !== null || this.queue.length > 0;
  }

  /** Stav, ke kterému patří právě hraná scéna. */
  get currentState(): State | null {
    return this.batch?.state ?? null;
  }

  enqueue(state: State, beats: Beat[]): void {
    if (this.stopped) return;
    this.queue.push({ state, beats, next: 0 });
    if (this.timer === null && !this.holding) this.advance();
  }

  /** Přeskočí právě hranou scénu, nebo potvrdí tu, která čeká na klik. */
  skip(): void {
    if (this.timer === null && !this.holding) return;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.holding = false;
    this.advance();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.holding = false;
    this.batch = null;
    this.queue.length = 0;
  }

  private advance(): void {
    // Scény s nulovou délkou (oznámení, režim Turbo) běží v cyklu, ne rekurzí.
    while (!this.stopped) {
      if (!this.batch) {
        const batch = this.queue.shift();
        if (!batch) {
          this.hooks.idle();
          return;
        }
        this.batch = batch;
        if (batch.beats.length === 0) {
          this.hooks.settle(batch.state);
          this.batch = null;
          continue;
        }
      }
      const batch = this.batch;
      const beat = batch.beats[batch.next]!;
      batch.next += 1;
      const last = batch.next >= batch.beats.length;
      if (last) this.hooks.settle(batch.state);
      this.hooks.play(beat);
      if (last) this.batch = null;
      const ms = this.hooks.duration(beat, this.backlog());
      if (ms === 'hold') {
        this.holding = true;
        return;
      }
      if (ms > 0) {
        this.timer = setTimeout(() => {
          this.timer = null;
          this.advance();
        }, ms);
        return;
      }
    }
  }

  /** Kolik dávek ještě čeká. Při velkém skluzu (síť, rychlí boti) se scény zkracují. */
  private backlog(): number {
    return this.queue.length;
  }
}
