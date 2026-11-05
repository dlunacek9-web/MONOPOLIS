export type PlayerId = number;
export type TileId = number;

export type GroupId = 'most' | 'ostrava' | 'usti' | 'olomouc' | 'plzen' | 'brno' | 'vary' | 'praha';
export type DeckId = 'tip' | 'urad';
export type GameMode = 'classic' | 'nextlevel';
export type Personality = 'zralok' | 'lakomec' | 'kriminalnik' | 'vyvazeny';
export type Difficulty = 'easy' | 'normal' | 'hard';
export type Archetype = 'developer' | 'kryptobro' | 'baron' | 'trafikant';

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
  /** Pasivní schopnost. Používá ji jen sada s byznysovou vrstvou. */
  archetype?: Archetype;
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
  /** Černé peníze. Jdou jen na úplatky, pump & dump a nájem na ruku. */
  dirty: number;
  shares: Partial<Record<GroupId, Holding>>;
  archetype: Archetype | null;
  /** Od kterého kola smí hráč znovu ujíždět před nájmem. */
  nextChaseRound: number;
}

/** Akcie jedné firmy. `cost` je celková pořizovací cena držených kusů. */
export interface Holding {
  count: number;
  cost: number;
}

/** Běžící pump & dump. `turnsLeft` se odpočítává na začátku tahů viníka. */
export interface Pump {
  group: GroupId;
  by: PlayerId;
  turnsLeft: number;
  /** Zisk viníka z prodejů během pumpy, při odhalení propadá. */
  profit: number;
}

export interface Market {
  prices: Record<GroupId, number>;
  pumps: Pump[];
}

/** Vlastnictví pozemku. `level` je 0–4 domů, 5 znamená hotel. */
export interface Deed {
  owner: PlayerId | null;
  level: number;
  mortgaged: boolean;
  /** Nájem na ruku: majitel ho dostane v černých, o přirážku vyšší. */
  offBooks: boolean;
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

export type Phase =
  | 'awaitRoll'
  | 'awaitBuy'
  | 'awaitTax'
  | 'awaitRent'
  | 'chase'
  | 'breakout'
  | 'awaitEnd'
  | 'gameOver';
export type BribeKind = 'official' | 'police' | 'build';
export type BustReason = BribeKind | 'launder' | 'pump';

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
  | {
      type: 'jailOut';
      player: PlayerId;
      how: 'bail' | 'card' | 'doubles' | 'forced' | 'bribe' | 'breakout';
    }
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
  | { type: 'blackRent'; owner: PlayerId; tile: TileId; amount: number }
  | { type: 'launder'; player: PlayerId; tile: TileId; amount: number; net: number }
  | { type: 'bribe'; player: PlayerId; kind: BribeKind; cost: number }
  | { type: 'busted'; player: PlayerId; reason: BustReason; fine: number; seized: number }
  | {
      type: 'shares';
      player: PlayerId;
      group: GroupId;
      count: number;
      price: number;
      buy: boolean;
    }
  | { type: 'pump'; player: PlayerId; group: GroupId; price: number }
  | { type: 'dump'; player: PlayerId; group: GroupId; price: number }
  | { type: 'chaseStart'; player: PlayerId; owner: PlayerId; tile: TileId }
  | { type: 'chaseEnd'; player: PlayerId; owner: PlayerId; tile: TileId; escaped: boolean }
  | { type: 'breakoutStart'; player: PlayerId }
  | { type: 'breakoutEnd'; player: PlayerId; escaped: boolean; fine: number }
  | { type: 'controller'; player: PlayerId; previous: string; bot: boolean };

export type GameEvent = GameEventBody & { seq: number };

export interface GameStats {
  biggestRent: { player: PlayerId; amount: number } | null;
}

export interface PendingRent {
  tile: TileId;
  owner: PlayerId;
  amount: number;
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
  /** Burza. `null` v sadě bez byznysové vrstvy. */
  market: Market | null;
  /** Podniky, přes které už se v tomto tahu pralo. */
  launderedTiles: TileId[];
  /** Daň čekající na rozhodnutí hráče, jestli uplatí úředníka. */
  pendingTax: { tile: TileId; amount: number } | null;
  /** Nájem čekající na rozhodnutí hráče. Během honičky je to to, oč se hraje. */
  pendingRent: PendingRent | null;
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
  | { type: 'setOffBooks'; player: PlayerId; tile: TileId; on: boolean }
  | { type: 'launder'; player: PlayerId; tile: TileId; amount: number }
  | { type: 'payTax'; player: PlayerId }
  | { type: 'bribeOfficial'; player: PlayerId }
  | { type: 'bribePolice'; player: PlayerId }
  | { type: 'bribeBuild'; player: PlayerId; tile: TileId }
  | { type: 'buyShares'; player: PlayerId; group: GroupId; count: number }
  | { type: 'sellShares'; player: PlayerId; group: GroupId; count: number }
  | { type: 'pumpDump'; player: PlayerId; group: GroupId }
  | { type: 'payRent'; player: PlayerId }
  | { type: 'flee'; player: PlayerId }
  /** Výsledek odehrané honičky. */
  | { type: 'chaseResult'; player: PlayerId; escaped: boolean }
  /** Honička bez hraní: rozhodne seedovaný generátor. */
  | { type: 'chaseSkip'; player: PlayerId }
  /** Pokus o útěk z vězení místo hodu. */
  | { type: 'breakout'; player: PlayerId }
  /** Výsledek odehraného útěku. */
  | { type: 'breakoutResult'; player: PlayerId; escaped: boolean }
  /** Útěk bez hraní: rozhodne seedovaný generátor. */
  | { type: 'breakoutSkip'; player: PlayerId }
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

export interface BribeRules {
  cost: number;
  riskPct: number;
  fine: number;
}

export interface ArchetypePerks {
  /** Sleva na domy a hotely. */
  buildDiscountPct: number;
  /** Bonus z čistého zisku při prodeji akcií. */
  profitBonusPct: number;
  /** O kolik procent silněji se hýbe cena při vlastním pump & dumpu. */
  pumpSwingPct: number;
  bribeDiscountPct: number;
  /** Změna šance na odhalení úplatku v procentních bodech. */
  bribeRiskDelta: number;
  launderFeePct: number;
  launderRiskDelta: number;
}

/** Čísla byznysové vrstvy. Výklad je v `docs/GDD.md`, kapitoly 6 a 7. */
export interface BusinessRules {
  blackRentBonusPct: number;
  /** Za kolik procent se černé počítají do čistého jmění. */
  dirtyWorthPct: number;
  /** Kolik procent černých zabaví policie při každém odhalení. */
  seizeDirtyPct: number;
  launderCap: number;
  launderFinePct: number;
  launderRiskPct: number;
  taxDiscountPct: number;
  official: BribeRules;
  police: BribeRules;
  build: BribeRules;
  pump: BribeRules & { upPct: number; downPct: number; turns: number };
  stock: {
    startPrice: number;
    minPrice: number;
    priceUnit: number;
    maxShares: number;
    buildPct: number;
    bankruptPct: number;
    noisePct: number;
  };
  /** Poplatek bez archetypu je v `launderFeePct`, archetypy ho mohou přebít. */
  launderFeePct: number;
  chase: {
    /** Šance na útěk, když se honička nehraje. */
    autoEscapePct: number;
    cooldownRounds: number;
    caughtRentFactor: number;
  };
  breakout: {
    /** Šance na útěk, když se minihra nehraje. */
    autoEscapePct: number;
    fine: number;
  };
  perks: Record<Archetype, Partial<ArchetypePerks>>;
}

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
  /** Bez této části hraje sada jen klasická pravidla. */
  business?: BusinessRules;
}
