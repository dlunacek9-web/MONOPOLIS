# MONOPOLIS

Webová hra pro školní projekt do IT: česká byznysová satira ve stylu Vlk z Wall Street × GTA, postavená na mechanikách klasické deskové hry o nemovitostech. Repo: `dlunacek9-web/MONOPOLIS`. Hosting: GitHub Pages.

Majitel projektu je vibecoder. Neprogramuje ručně, hru řídí a testuje. Komunikuj česky, stručně a srozumitelně. Důležité technické rozhodnutí vysvětli jednou dvěma větami.

## Tvrdá omezení

- **Všechno zdarma.** Žádné placené služby, API ani assety. Cokoli, co by mohlo stát peníze, předem výslovně nahlas.
- **Single player je základ.** Jeden člověk musí sám odehrát všechno bez internetu. Každou roli standardně hraje bot, člověk ji může v multiplayeru převzít. Každou funkci nejdřív otestuj v sólu.
- 2–4 hráči, libovolný mix lidí a botů.
- Jen PC, klávesnice a myš.
- **Čeština.** Všechny texty hry patří do `src/i18n/cs.ts`. V kódu mimo tento soubor nejsou žádné herní texty.
- **Assety** jen low-poly cartoon s CC0 nebo jinou volnou licencí. Každý zapiš do `CREDITS.md`.
- **Právně čisté.** Nikde slovo „Monopoly“, žádné assety ani loga Hasbra, žádní skuteční žijící lidé ani politici jmény, žádná skutečná loga firem. Parodie a archetypy jsou v pořádku. Názvy, karty, ceny a vzhled jsou naše vlastní, přebíráme jen herní mechaniky. **Výjimka:** režim Klasika je na přání majitele věrná kopie originálu jen pro školní účely (originální názvy polí a znění karet, `src/core/sets/classic.ts` a `CLASSIC_TEXTS` v `cs.ts`). Slovo „Monopoly“, loga a vzhled Hasbra zůstávají zakázané i tam.

Když by něco tato omezení porušilo, zastav se a zeptej se.

## Architektura

- `src/core/` obsahuje čistá pravidla: `reduce(stav, akce) → nový stav`. Je deterministické, používá seedované RNG ve stavu a nezná Three.js, DOM ani síť. Stav je čisté JSON.
- `src/bots/` rozhoduje za boty nad stavem hry a vrací běžné akce. Bot nemá žádné výhody oproti člověku.
- `src/net/` obsahuje rozhraní `GameTransport`. Hra neví, jestli běží přes `LocalTransport`, nebo později přes Trystero. Sólo nikdy nesmí záviset na síti.
- `src/ui/` je rozhraní nad transportem. `src/render/` (od Fáze 2) je 3D město.
- `src/minigames/` (od Fáze 5) jsou pluginy: `start(context) → Promise<result>`, AI i lidský controller pro každou roli a `autoResolve()`.
- `src/profile/` je příprava na progresi: úložiště za rozhraním a událost konce partie.
- Zdroj pravdy o pravidlech a číslech je `docs/GDD.md`, stav prací je v `docs/ROADMAP.md`.

## Konvence

- TypeScript strict. Peníze jsou celá čísla v korunách.
- Pravidla se mění jen přes akce v `src/core/reducer.ts`. Každé nové pravidlo dostane test.
- Nové herní texty a události přidávej přes `src/i18n/cs.ts`.
- Hra musí být spustitelná vždycky, `main` nesmí být rozbitý.
- Fáze je hotová, až když jde všechno, co přidává, plně hrát v single playeru proti botům.
- Po každé fázi: `npm run lint`, `npm test`, `npm run build`, oprava chyb, commit se srozumitelnou zprávou a česká zpráva majiteli, co je hotové, jak to vyzkouší a co je další krok.
- Nezačínej další fázi, dokud ti ji majitel neřekne.

## Příkazy

```bash
npm install
npm run dev
npm test
npm run lint
npm run build
```
