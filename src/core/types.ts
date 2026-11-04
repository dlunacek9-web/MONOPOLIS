export type PlayerId = number;
export type TileId = number;

export type GroupId = 'most' | 'ostrava' | 'usti' | 'olomouc' | 'plzen' | 'brno' | 'vary' | 'praha';
export type DeckId = 'tip' | 'urad';
export type GameMode = 'classic' | 'nextlevel';
export type Personality = 'zralok' | 'lakomec' | 'kriminalnik' | 'vyvazeny';
export type Difficulty = 'easy' | 'normal' | 'hard';

export type Tile =
  | { kind: 'start' }
  | { kind: 'property'; group: GroupId; price: number; rents: readonly number[]; houseCost: number }
  | { kind: 'station'; price: number }
  | { kind: 'utility'; price: number }
  | { kind: 'tax'; amount: number }
  | { kind: 'card'; deck: DeckId }
  | { kind: 'jail' }
  | { kind: 'parking' }
  | { kind: 'goToJail' };

export type WinCondition =
  | { type: 'lastStanding' }
  | { type: 'richestAfterRounds'; rounds: number }
  | { type: 'firstToMoney'; amount: number };

export interface GameSettings {
  mode: GameMode;
  win: WinCondition;
  /** Počáteční hotovost. Bez hodnoty platí `START_CASH`. */
  startCash?: number;
}

export interface BotConfig {
  personality: Personality;
  difficulty: Difficulty;
}

export interface PlayerSetup {
  name: string;
  /** Bez `bot` jde o lidského hráče. */
  bot?: BotConfig;
}

export interface Player {
  id: PlayerId;
  name: string;
  bot: BotConfig | null;
  cash: number;
  position: TileId;
  inJail: boolean;
  jailTurns: number;
  /** Propustky z vězení. Hodnota říká, do kterého balíčku se karta vrátí. */
  jailCards: DeckId[];
  doublesCount: number;
  bankrupt: boolean;
}

/** Vlastnictví pozemku. `level` je 0–4 domů, 5 znamená hotel. */
export interface Deed {
  owner: PlayerId | null;
  level: number;
  mortgaged: boolean;
}

export interface Debt {
  player: PlayerId;
  /** `null` znamená banku. */
  creditor: PlayerId | null;
  amount: number;
}

export interface Auction {
  tile: TileId;
  bid: number;
  leader: PlayerId | null;
  bidders: PlayerId[];
  index: number;
}

export interface TradeSide {
  tiles: TileId[];
  cash: number;
  jailCards: number;
}

export interface TradeOffer {
  from: PlayerId;
  to: PlayerId;
  /** Co dává navrhovatel. */
  give: TradeSide;
  /** Co chce navrhovatel dostat. */
  get: TradeSide;
}

export type Phase = 'awaitRoll' | 'awaitBuy' | 'awaitEnd' | 'gameOver';

export type GameEventBody =
  | { type: 'gameStart' }
  | { type: 'turnStart'; player: PlayerId; round: number }
  | { type: 'roll'; player: PlayerId; dice: [number, number] }
  | { type: 'move'; player: PlayerId; tile: TileId }
  | { type: 'passStart'; player: PlayerId; amount: number }
  | { type: 'buy'; player: PlayerId; tile: TileId; price: number }
  | { type: 'decline'; player: PlayerId; tile: TileId }
  | { type: 'rent'; player: PlayerId; owner: PlayerId; tile: TileId; amount: number }
  | { type: 'mortgagedNoRent'; player: PlayerId; tile: TileId }
  | { type: 'tax'; player: PlayerId; tile: TileId; amount: number }
  | { type: 'card'; player: PlayerId; deck: DeckId; card: number }
  | { type: 'gain'; player: PlayerId; amount: number }
  | { type: 'pay'; player: PlayerId; amount: number; to: PlayerId | null }
  | { type: 'jail'; player: PlayerId }
  | { type: 'jailStay'; player: PlayerId; attempt: number }
  | { type: 'jailOut'; player: PlayerId; how: 'bail' | 'card' | 'doubles' | 'forced' }
  | { type: 'threeDoubles'; player: PlayerId }
  | { type: 'auctionStart'; tile: TileId }
  | { type: 'bid'; player: PlayerId; amount: number }
  | { type: 'passBid'; player: PlayerId }
  | { type: 'auctionWon'; player: PlayerId; tile: TileId; amount: number }
  | { type: 'auctionNone'; tile: TileId }
  | { type: 'build'; player: PlayerId; tile: TileId; level: number }
  | { type: 'sellBuilding'; player: PlayerId; tile: TileId; level: number }
  | { type: 'mortgage'; player: PlayerId; tile: TileId }
  | { type: 'unmortgage'; player: PlayerId; tile: TileId }
  | { type: 'tradeProposed'; from: PlayerId; to: PlayerId }
  | { type: 'tradeAccepted'; from: PlayerId; to: PlayerId }
  | { type: 'tradeRejected'; from: PlayerId; to: PlayerId }
  | { type: 'debt'; player: PlayerId; amount: number; creditor: PlayerId | null }
  | { type: 'debtPaid'; player: PlayerId; amount: number; creditor: PlayerId | null }
  | { type: 'bankrupt'; player: PlayerId; creditor: PlayerId | null }
  | { type: 'gameOver'; winner: PlayerId }
  | { type: 'controller'; player: PlayerId; previous: string; bot: boolean };

export type GameEvent = GameEventBody & { seq: number };

export interface GameStats {
  biggestRent: { player: PlayerId; amount: number } | null;
}

export interface GameState {
  settings: GameSettings;
  players: Player[];
  /** Indexováno polem desky, `null` pro políčka, která nejde vlastnit. */
  deeds: (Deed | null)[];
  phase: Phase;
  active: PlayerId;
  firstPlayer: PlayerId;
  round: number;
  /** Počet tahů od začátku partie. */
  turn: number;
  /** Stav seedovaného generátoru. */
  rng: number;
  lastRoll: [number, number] | null;
  extraRoll: boolean;
  pendingBuy: TileId | null;
  decks: Record<DeckId, number[]>;
  housesLeft: number;
  hotelsLeft: number;
  debts: Debt[];
  auction: Auction | null;
  pendingAuctions: TileId[];
  trade: TradeOffer | null;
  tradesThisTurn: number;
  winner: PlayerId | null;
  /** Posledních několik událostí pro výpis ve hře. */
  events: GameEvent[];
  eventSeq: number;
  stats: GameStats;
}

export type Action =
  | { type: 'roll'; player: PlayerId }
  | { type: 'payBail'; player: PlayerId }
  | { type: 'useJailCard'; player: PlayerId }
  | { type: 'buy'; player: PlayerId }
  | { type: 'decline'; player: PlayerId }
  | { type: 'bid'; player: PlayerId; amount: number }
  | { type: 'passBid'; player: PlayerId }
  | { type: 'build'; player: PlayerId; tile: TileId }
  | { type: 'sellBuilding'; player: PlayerId; tile: TileId }
  | { type: 'mortgage'; player: PlayerId; tile: TileId }
  | { type: 'unmortgage'; player: PlayerId; tile: TileId }
  | { type: 'proposeTrade'; player: PlayerId; offer: Omit<TradeOffer, 'from'> }
  | { type: 'acceptTrade'; player: PlayerId }
  | { type: 'rejectTrade'; player: PlayerId }
  | { type: 'settleDebt'; player: PlayerId }
  | { type: 'declareBankruptcy'; player: PlayerId }
  | { type: 'endTurn'; player: PlayerId }
  /** Místo u stolu přebírá člověk nebo bot. Posílá jen hostitel, nikdy hráč po síti. */
  | { type: 'setController'; player: PlayerId; name: string; bot: BotConfig | null };

export type CardEffect =
  | { kind: 'gain'; amount: number }
  | { kind: 'pay'; amount: number }
  | { kind: 'gainEach'; amount: number }
  | { kind: 'payEach'; amount: number }
  | { kind: 'moveTo'; tile: TileId }
  | { kind: 'moveBack'; steps: number }
  | { kind: 'nearest'; what: 'station' | 'utility' }
  | { kind: 'toJail' }
  | { kind: 'jailCard' }
  | { kind: 'repairs'; perHouse: number; perHotel: number };

/** Čísla a data jedné sady pravidel. Částky jsou v celých korunách. */
export interface Ruleset {
  board: readonly Tile[];
  cards: Record<DeckId, readonly CardEffect[]>;
  /** Základní jednotka částek: zaokrouhlování, kroky v obchodech a u botů. */
  moneyUnit: number;
  startCash: number;
  startSalary: number;
  jailBail: number;
  minBidStep: number;
  stationRents: readonly number[];
  utilityRateOne: number;
  utilityRateBoth: number;
  totalHouses: number;
  totalHotels: number;
}
