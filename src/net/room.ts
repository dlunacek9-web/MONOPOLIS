/** Spojení s ostatními v místnosti. Testy ho nahrazují pamětí, hra používá Trystero. */
export interface PeerRoom {
  /** Bez `peerId` jde zpráva všem. */
  send(message: unknown, peerId?: string): void;
  onMessage(handler: (message: unknown, peerId: string) => void): void;
  onPeerJoin(handler: (peerId: string) => void): void;
  onPeerLeave(handler: (peerId: string) => void): void;
  leave(): void;
}

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 6;

export function randomRoomCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  return Array.from(bytes, (byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join('');
}

/** Vrátí kód velkými písmeny, nebo `null`, když takový kód nemůže existovat. */
export function normalizeRoomCode(value: string): string | null {
  const code = value.trim().toUpperCase();
  if (code.length !== CODE_LENGTH) return null;
  return [...code].every((char) => CODE_ALPHABET.includes(char)) ? code : null;
}
