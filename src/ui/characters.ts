export type CharacterId =
  'clerk' | 'cop' | 'broker' | 'washer' | 'foreman' | 'auctioneer' | 'bailiff' | 'friend';

const INK = '#241a12';
const LINE = `stroke="${INK}" stroke-width="5" stroke-linejoin="round" stroke-linecap="round"`;

interface Look {
  skin: string;
  suit: string;
  /** Oblečení a doplňky pod hlavou. */
  chest: string;
  /** Účes, klobouk a brýle nad hlavou. */
  top: string;
  face?: string;
}

function bust({ skin, suit, chest, top, face = '' }: Look): string {
  return `
    <svg class="character" viewBox="0 0 200 240" aria-hidden="true">
      <path d="M22 240c2-52 28-78 78-80 50 2 76 28 78 80z" fill="${suit}" ${LINE}/>
      ${chest}
      <circle cx="53" cy="98" r="10" fill="${skin}" ${LINE}/>
      <circle cx="147" cy="98" r="10" fill="${skin}" ${LINE}/>
      <ellipse cx="100" cy="96" rx="47" ry="54" fill="${skin}" ${LINE}/>
      <g class="ch-eyes" fill="${INK}">
        <circle cx="82" cy="92" r="5.5"/><circle cx="118" cy="92" r="5.5"/>
      </g>
      <path d="M100 98l-5 14h9" fill="none" ${LINE}/>
      <path class="ch-mouth" d="M84 126q16 11 32 0v3q-16 13-32 0z" fill="${INK}" ${LINE}/>
      ${face}
      ${top}
    </svg>`;
}

const looks: Record<CharacterId, Look> = {
  // Referent: pleška, brýle, svetr přes košili.
  clerk: {
    skin: '#f1c9a0',
    suit: '#a89468',
    chest: `<path d="M84 162l16 22 16-22" fill="#f4efe0" ${LINE}/><path d="M100 184l-7 30h14z" fill="#5a6b4e" ${LINE}/>`,
    face: `<circle cx="82" cy="92" r="15" fill="none" ${LINE}/><circle cx="118" cy="92" r="15" fill="none" ${LINE}/><path d="M97 92h6" ${LINE}/><path d="M84 116q16-6 32 0" fill="none" ${LINE}/>`,
    top: `<path d="M60 70q12-22 52-24-22 8-30 14" fill="#54422f" ${LINE}/>`,
  },
  // Policajt: čepice s odznakem a knír.
  cop: {
    skin: '#e8b48c',
    suit: '#2d4a7c',
    chest: `<path d="M78 164l22 18 22-18" fill="#22375e" ${LINE}/><circle cx="142" cy="198" r="9" fill="#f2b632" ${LINE}/>`,
    face: `<path d="M78 118q11-11 22-3 11-8 22 3-11 6-22 2-11 4-22-2z" fill="#3b2a1d" ${LINE}/>`,
    top: `<path d="M46 62q54-44 108 0l-8 16H54z" fill="#22375e" ${LINE}/><path d="M50 78q50 12 100 0l4 10q-54 12-108 0z" fill="#17243f" ${LINE}/><circle cx="100" cy="56" r="10" fill="#f2b632" ${LINE}/>`,
  },
  // Makléř: uhlazený účes, proužky, červená kravata, sluchátko.
  broker: {
    skin: '#f0c49c',
    suit: '#2c2f3c',
    chest: `<path d="M82 162l18 26 18-26" fill="#f4efe0" ${LINE}/><path d="M100 188l-9 40h18z" fill="#d92b2b" ${LINE}/><path d="M50 190v50M150 190v50" stroke="#555a70" stroke-width="3"/>`,
    top: `<path d="M54 84q-6-46 46-46t46 46q-8-22-32-26-32 8-60 26z" fill="#1d1712" ${LINE}/><path d="M44 96q0-58 56-62 56 4 56 62" fill="none" ${LINE}/><rect x="146" y="90" width="12" height="20" rx="4" fill="#111" ${LINE}/>`,
  },
  // Pračkař: placatá čepice, strniště, zástěra, cigareta.
  washer: {
    skin: '#dfae86',
    suit: '#5b7f86',
    chest: `<path d="M70 168h60v72H70z" fill="#efe6cf" ${LINE}/><path d="M84 168v-10M116 168v-10" ${LINE}/>`,
    face: `<path d="M116 124l24 5" stroke="#f4efe0" stroke-width="7" stroke-linecap="round"/><circle cx="142" cy="130" r="3" fill="#ff5a3c"/><path d="M72 116h2M78 128h2M122 112h2M88 136h2M110 138h2" ${LINE}/>`,
    top: `<path d="M48 70q6-34 52-34t56 34q-56-10-108 0z" fill="#4a3b2c" ${LINE}/><path d="M42 72q60-10 118 2l6 8q-70-14-128-2z" fill="#3a2d21" ${LINE}/>`,
  },
  // Stavbyvedoucí: helma a reflexní vesta.
  foreman: {
    skin: '#e6b48a',
    suit: '#f28c28',
    chest: `<path d="M56 196h88M50 216h100" stroke="#f5f2d0" stroke-width="9"/><path d="M100 162v78" ${LINE}/>`,
    face: `<path d="M86 134q14 10 28 0" fill="none" ${LINE}/>`,
    top: `<path d="M48 72q2-44 52-44t52 44z" fill="#f7d531" ${LINE}/><rect x="38" y="68" width="124" height="12" rx="6" fill="#f7d531" ${LINE}/>`,
  },
  // Dražebník: cylindr a motýlek.
  auctioneer: {
    skin: '#f3cfa9',
    suit: '#3f1f2e',
    chest: `<path d="M100 172l-22-11v22zM100 172l22-11v22z" fill="#d92b2b" ${LINE}/>`,
    face: `<path d="M74 118q-14 2-16-10M126 118q14 2 16-10" fill="none" ${LINE}/>`,
    top: `<path d="M64 62V14h72v48z" fill="#1d1712" ${LINE}/><path d="M64 48h72" stroke="#d92b2b" stroke-width="8"/><rect x="44" y="58" width="112" height="12" rx="6" fill="#1d1712" ${LINE}/>`,
  },
  // Exekutor: holá hlava a černé brýle.
  bailiff: {
    skin: '#d9a884',
    suit: '#17151a',
    chest: `<path d="M84 162l16 20 16-20" fill="#d8d3c5" ${LINE}/><path d="M100 182l-6 44h12z" fill="#000" ${LINE}/>`,
    face: `<rect x="64" y="82" width="32" height="18" rx="5" fill="#000" ${LINE}/><rect x="104" y="82" width="32" height="18" rx="5" fill="#000" ${LINE}/><path d="M96 88h8" ${LINE}/>`,
    top: '',
  },
  // Kámoš: tepláky, zlatý řetěz a kšiltovka.
  friend: {
    skin: '#ecbd93',
    suit: '#2f8f5b',
    chest: `<path d="M74 170q26 32 52 0" fill="none" stroke="#f2b632" stroke-width="7"/><path d="M60 180v60M140 180v60" stroke="#f4efe0" stroke-width="6"/>`,
    top: `<path d="M52 68q2-34 48-34t48 34z" fill="#c92a4a" ${LINE}/><path d="M48 68h82q26 2 34 14-54-6-116-2z" fill="#a51f3a" ${LINE}/>`,
  },
};

export function character(id: CharacterId): string {
  return bust(looks[id]);
}
