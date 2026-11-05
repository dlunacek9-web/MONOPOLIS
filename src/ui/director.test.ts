import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Director } from './director';

interface TestBeat {
  name: string;
  ms: number;
}

function setup() {
  const log: string[] = [];
  const director = new Director<string, TestBeat>({
    play: (beat) => log.push(`play:${beat.name}`),
    duration: (beat) => beat.ms,
    settle: (state) => log.push(`settle:${state}`),
    idle: () => log.push('idle'),
  });
  return { log, director };
}

describe('režisér událostí', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('hraje scény po jedné a další začne až po doběhnutí předchozí', () => {
    const { log, director } = setup();
    director.enqueue('A', [
      { name: 'kostky', ms: 100 },
      { name: 'auto', ms: 100 },
    ]);
    expect(log).toEqual(['play:kostky']);
    expect(director.busy).toBe(true);
    vi.advanceTimersByTime(100);
    expect(log).toEqual(['play:kostky', 'settle:A', 'play:auto']);
    vi.advanceTimersByTime(100);
    expect(log.at(-1)).toBe('idle');
    expect(director.busy).toBe(false);
  });

  it('další dávka počká ve frontě a stav se odkryje až s její poslední scénou', () => {
    const { log, director } = setup();
    director.enqueue('A', [{ name: 'a', ms: 100 }]);
    director.enqueue('B', [{ name: 'b', ms: 100 }]);
    expect(log).toEqual(['settle:A', 'play:a']);
    vi.advanceTimersByTime(100);
    expect(log).toEqual(['settle:A', 'play:a', 'settle:B', 'play:b']);
  });

  it('přeskočení ukončí scénu hned', () => {
    const { log, director } = setup();
    director.enqueue('A', [
      { name: 'a', ms: 5000 },
      { name: 'b', ms: 0 },
    ]);
    director.skip();
    expect(log).toEqual(['play:a', 'settle:A', 'play:b', 'idle']);
    expect(director.busy).toBe(false);
  });

  it('scény s nulovou délkou a prázdná dávka hned doběhnou', () => {
    const { log, director } = setup();
    director.enqueue('A', []);
    expect(log).toEqual(['settle:A', 'idle']);
    expect(director.busy).toBe(false);
  });

  it('po zastavení už nic nehraje', () => {
    const { log, director } = setup();
    director.enqueue('A', [
      { name: 'a', ms: 100 },
      { name: 'b', ms: 100 },
    ]);
    director.stop();
    vi.advanceTimersByTime(500);
    expect(log).toEqual(['play:a']);
    expect(director.busy).toBe(false);
  });
});
