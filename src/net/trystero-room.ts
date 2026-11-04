import type { JsonValue } from 'trystero';
import type { PeerRoom } from './room';

const APP_ID = 'monopolis-hra-v1';

/**
 * Hráči se najdou přes veřejné relé sítě Nostr a pak si data posílají přímo (WebRTC).
 * Import je dynamický, aby sólo hra nikdy nestahovala ani nespouštěla síťový kód.
 */
export async function joinTrysteroRoom(code: string): Promise<PeerRoom> {
  const { joinRoom } = await import('trystero');
  const room = joinRoom({ appId: APP_ID, password: code }, code, {
    onJoinError: (details) => console.warn('Nejde navázat spojení s hráčem.', details.error),
  });
  const channel = room.makeAction<JsonValue>('msg');
  return {
    send(message, peerId) {
      channel
        .send(message as JsonValue, peerId === undefined ? undefined : { target: peerId })
        .catch((error: unknown) => console.warn('Zprávu nejde odeslat.', error));
    },
    onMessage(handler) {
      channel.onMessage = (data, context) => handler(data, context.peerId);
    },
    onPeerJoin(handler) {
      room.onPeerJoin = handler;
    },
    onPeerLeave(handler) {
      room.onPeerLeave = handler;
    },
    leave() {
      void room.leave();
    },
  };
}
