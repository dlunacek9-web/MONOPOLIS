import { hashToUnit } from '../core';
import type {
  BribeKind,
  BustReason,
  DeckId,
  GameEvent,
  GameState,
  Player,
  PlayerId,
  TileId,
} from '../core';
import { cs, formatMoney } from '../i18n/cs';
import type { CharacterId } from './characters';
import { formatEvent, quipFor } from './log';

export type SceneTone =
  'office' | 'underground' | 'police' | 'market' | 'laundry' | 'auction' | 'bust';
export type SceneProp = 'envelope' | 'washer' | 'chart' | 'gavel' | 'siren';

interface BeatBase {
  seq: number;
  /** Řádek do historie. Prázdný se nezapisuje. */
  text: string;
  player: PlayerId | null;
  /** Scénu neodklikává nikdo, ani její majitel: ten má místo ní minihru. */
  timed?: boolean;
}

export type Beat = BeatBase &
  (
    | { kind: 'note' }
    | { kind: 'turn'; ms: number; name: string; mine: boolean }
    | { kind: 'dice'; ms: number; dice: [number, number] }
    | { kind: 'drive' }
    | { kind: 'card'; ms: number; deck: DeckId; body: string; character: CharacterId | null }
    | {
        kind: 'scene';
        ms: number;
        tone: SceneTone;
        character: CharacterId;
        lines: string[];
        prop: SceneProp | null;
        stamp: { text: string; good: boolean } | null;
      }
    | { kind: 'stamp'; ms: number; title: string; tile: TileId; stamp: string }
    | { kind: 'banner'; ms: number; tone: 'neutral' | 'good' | 'bad' }
    | { kind: 'toast'; amount: number | null; quip: boolean }
  );

export type BeatWait =
  /** Vlastní scéna: zůstane, dokud ji hráč neodklikne. */
  | { kind: 'mine' }
  /** Scéna jiného člověka: zůstane, dokud ji odklikne on. */
  | { kind: 'other'; player: PlayerId }
  /** Bot, nebo scéna bez majitele: běží podle tempa. */
  | { kind: 'timed' };

/** Podle koho se řídí délka scény. Kostky, auto a pruh tahu běží vždy samy. */
export function beatWait(beat: Beat, me: PlayerId, players: readonly Player[]): BeatWait {
  const clickable =
    beat.kind === 'card' ||
    beat.kind === 'scene' ||
    beat.kind === 'stamp' ||
    beat.kind === 'banner';
  if (!clickable || beat.timed || beat.player === null) return { kind: 'timed' };
  if (beat.player === me) return { kind: 'mine' };
  return players[beat.player]?.bot === null
    ? { kind: 'other', player: beat.player }
    : { kind: 'timed' };
}

const MS = {
  turn: 850,
  dice: 1250,
  cardMin: 2000,
  cardMax: 4500,
  cardPerChar: 28,
  stamp: 1250,
  banner: 1300,
  scene: 1500,
  sceneTwoLines: 2400,
  bankrupt: 2800,
};

function pick(lines: readonly string[], seq: number, salt = 3): string {
  return lines[Math.floor(hashToUnit(seq, salt) * lines.length)]!;
}

function cardMs(body: string): number {
  return Math.min(MS.cardMax, Math.max(MS.cardMin, body.length * MS.cardPerChar));
}

const BRIBE_CHARACTER: Record<BribeKind, CharacterId> = {
  official: 'clerk',
  police: 'cop',
  build: 'foreman',
};

const BUST_CHARACTER: Record<BustReason, CharacterId> = {
  official: 'clerk',
  police: 'cop',
  build: 'foreman',
  launder: 'cop',
  pump: 'cop',
};

/** Hledá v rozsahu stejné akce: co se stalo hned po této události. */
function followedBy(events: readonly GameEvent[], index: number, type: GameEvent['type']): boolean {
  return events.slice(index + 1).some((event) => event.type === type);
}

function precededBy(events: readonly GameEvent[], index: number, type: GameEvent['type']): boolean {
  return events.slice(0, index).some((event) => event.type === type);
}

/** Přeloží události jedné akce na scény. Čistá funkce, nezná DOM ani čas. */
export function beatsFor(s: GameState, events: readonly GameEvent[], me: PlayerId): Beat[] {
  const nextLevel = s.settings.mode === 'nextlevel';
  const beats: Beat[] = [];

  events.forEach((e, i) => {
    const text = formatEvent(s, e);
    const owner = 'player' in e ? e.player : 'from' in e ? e.from : null;
    const base = { seq: e.seq, text, player: owner };
    const toast = (amount: number | null = null): Beat => ({
      ...base,
      kind: 'toast',
      amount,
      quip: false,
    });
    const banner = (tone: 'neutral' | 'good' | 'bad', ms = MS.banner): Beat => ({
      ...base,
      kind: 'banner',
      ms,
      tone,
    });
    const scene = (
      tone: SceneTone,
      character: CharacterId,
      lines: string[],
      stamp: { text: string; good: boolean } | null,
      prop: SceneProp | null = null,
      ms = lines.length > 1 ? MS.sceneTwoLines : MS.scene,
    ): Beat => ({ ...base, kind: 'scene', ms, tone, character, lines, prop, stamp });

    switch (e.type) {
      case 'gameStart':
      case 'gameOver':
      case 'decline':
        beats.push({ ...base, kind: 'note' });
        break;
      case 'turnStart':
        beats.push({
          ...base,
          kind: 'turn',
          ms: MS.turn,
          name: s.players[e.player]?.name ?? '',
          mine: e.player === me,
        });
        break;
      case 'roll': {
        // Hod a pohyb tvoří v historii jeden řádek.
        const next = events[i + 1];
        const merged = next?.type === 'move' && next.player === e.player;
        const name = s.players[e.player]?.name ?? '';
        beats.push({
          ...base,
          text: merged
            ? cs.log.rollMove(name, e.dice[0], e.dice[1], cs.tiles[next.tile] ?? '')
            : text,
          kind: 'dice',
          ms: MS.dice,
          dice: e.dice,
        });
        break;
      }
      case 'move': {
        const previous = events[i - 1];
        const merged = previous?.type === 'roll' && previous.player === e.player;
        beats.push({ ...base, text: merged ? '' : text, kind: 'drive' });
        break;
      }
      case 'buy':
        beats.push({
          ...base,
          kind: 'stamp',
          ms: MS.stamp,
          title: cs.tiles[e.tile] ?? '',
          tile: e.tile,
          stamp: cs.stamp.bought,
        });
        break;
      case 'auctionWon':
        beats.push({
          ...base,
          kind: 'stamp',
          ms: MS.stamp,
          title: cs.tiles[e.tile] ?? '',
          tile: e.tile,
          stamp: cs.stamp.won,
        });
        break;
      case 'rent':
        beats.push(banner('bad'));
        break;
      case 'tax':
        // Daň po úplatku už odvyprávěla scéna s úředníkem.
        beats.push(precededBy(events, i, 'bribe') ? toast(-e.amount) : banner('bad'));
        break;
      case 'card': {
        const body = cs.cards[e.deck][e.card] ?? '';
        beats.push({
          ...base,
          kind: 'card',
          ms: cardMs(body),
          deck: e.deck,
          body,
          character: nextLevel ? (e.deck === 'tip' ? 'friend' : 'clerk') : null,
        });
        break;
      }
      case 'jail':
        if (precededBy(events, i, 'busted') || precededBy(events, i, 'chaseEnd')) {
          beats.push(toast());
        } else if (nextLevel) {
          beats.push(
            scene('police', 'cop', [pick(cs.scene.jail, e.seq)], {
              text: cs.stamp.jail,
              good: false,
            }),
          );
        } else {
          beats.push(banner('bad'));
        }
        break;
      case 'threeDoubles':
        beats.push(banner('bad'));
        break;
      case 'jailOut':
        // Úplatek i útěk mají vlastní scénu, tady by se jen opakovaly.
        if (e.how !== 'bribe' && e.how !== 'breakout') beats.push(toast());
        else beats.push({ ...base, kind: 'note' });
        break;
      case 'auctionStart':
        // Živá dražba má vlastní obrazovku a její hodiny už běží.
        if (e.live) {
          beats.push({ ...base, kind: 'note' });
          break;
        }
        beats.push(
          nextLevel
            ? scene('auction', 'auctioneer', [pick(cs.scene.auction, e.seq)], null, 'gavel')
            : banner('neutral'),
        );
        break;
      case 'tradeAccepted':
        beats.push(banner('good'));
        break;
      case 'bankrupt':
        beats.push(
          nextLevel
            ? scene(
                'bust',
                'bailiff',
                [pick(cs.scene.bankrupt, e.seq)],
                { text: cs.stamp.bankrupt, good: false },
                null,
                MS.bankrupt,
              )
            : banner('bad', MS.bankrupt),
        );
        break;
      case 'bribe': {
        const lines = cs.scene.bribe[e.kind];
        const caught = followedBy(events, i, 'busted');
        beats.push(
          scene(
            'underground',
            BRIBE_CHARACTER[e.kind],
            caught ? [pick(lines.ask, e.seq)] : [pick(lines.ask, e.seq), pick(lines.ok, e.seq, 5)],
            caught ? null : { text: cs.stamp.done, good: true },
            'envelope',
          ),
        );
        break;
      }
      case 'busted':
        beats.push(
          scene(
            'bust',
            BUST_CHARACTER[e.reason],
            [cs.scene.busted[e.reason]],
            { text: cs.stamp.caught, good: false },
            'siren',
            MS.sceneTwoLines,
          ),
        );
        break;
      case 'launder':
        beats.push(
          scene(
            'laundry',
            'washer',
            [pick(cs.scene.laundry, e.seq)],
            {
              text: cs.stamp.washed,
              good: true,
            },
            'washer',
          ),
        );
        break;
      case 'pump':
        beats.push(scene('market', 'broker', [pick(cs.scene.pump, e.seq)], null, 'chart'));
        break;
      case 'dump':
        beats.push(
          scene(
            'market',
            'broker',
            [pick(cs.scene.dump, e.seq)],
            {
              text: cs.stamp.crash,
              good: false,
            },
            'chart',
          ),
        );
        break;
      case 'chaseStart':
        beats.push(
          e.player === me
            ? toast()
            : {
                ...scene('police', 'cop', [pick(cs.scene.chase, e.seq)], null, 'siren'),
                timed: true,
              },
        );
        break;
      case 'chaseEnd':
        // Vlastní honičku hráč právě odehrál, výsledek viděl.
        beats.push(
          e.player === me
            ? toast()
            : {
                ...scene(
                  'police',
                  'cop',
                  [e.escaped ? cs.scene.chaseEscaped : cs.scene.chaseCaught],
                  { text: e.escaped ? cs.stamp.escaped : cs.stamp.arrested, good: e.escaped },
                  'siren',
                ),
                timed: true,
              },
        );
        break;
      case 'breakoutStart':
        beats.push(
          e.player === me
            ? banner('bad', MS.turn)
            : scene('police', 'cop', [pick(cs.scene.breakout, e.seq)], null, 'siren'),
        );
        break;
      case 'breakoutEnd':
        beats.push(
          e.player === me
            ? toast(e.escaped ? null : -e.fine)
            : scene(
                'police',
                'cop',
                [e.escaped ? cs.scene.breakoutEscaped : cs.scene.breakoutCaught],
                {
                  text: e.escaped ? cs.stamp.escaped : cs.stamp.arrested,
                  good: e.escaped,
                },
                'siren',
              ),
        );
        break;
      case 'passStart':
      case 'gain':
      case 'blackRent':
        beats.push(toast(e.amount));
        break;
      case 'pay':
        beats.push(toast(-e.amount));
        break;
      case 'debt':
        beats.push(toast(-e.amount));
        break;
      case 'debtPaid':
        beats.push(toast(-e.amount));
        break;
      default:
        beats.push(toast());
    }

    const quip = quipFor(s, e);
    if (quip) {
      const speaker = e.type === 'rent' ? e.owner : owner;
      beats.push({
        seq: e.seq,
        text: quip,
        player: speaker,
        kind: 'toast',
        amount: null,
        quip: true,
      });
    }
  });
  return beats;
}

/** Peníze jako krátký text s nápadným znaménkem. */
export function signedMoney(amount: number): string {
  return `${amount >= 0 ? '+' : '−'}${formatMoney(Math.abs(amount))}`;
}
