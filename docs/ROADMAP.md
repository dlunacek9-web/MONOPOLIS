# Roadmapa

Pravidlo pro všechny fáze: fáze je hotová, až když jde všechno, co přidává, plně hrát v single playeru proti botům.

## Fáze 0 — Setup

- [x] Vite + TypeScript strict
- [x] ESLint, Prettier, Vitest
- [x] GitHub Actions: kontrola a deploy na Pages
- [x] CLAUDE.md, docs/GDD.md, docs/ROADMAP.md, CREDITS.md

## Fáze 1 — Pravidla a boti

- [x] Engine klasických pravidel v `src/core/` s testy
- [x] Boti s osobnostmi a obtížností
- [x] Jednoduché 2D UI: menu, lobby, deska, správa majetku, obchody, aukce
- [x] Celá partie v sólu proti 1–3 botům

Pořadí fází: 2 → 3 → 4 → 5 a dál. Multiplayer jde před byznysovou vrstvou, takže každou její novou mechaniku je potřeba vyzkoušet i přes síť.

## Fáze 2 — 3D město

- [x] Low-poly deska jako město na plovoucím ostrově, auta jako figurky
- [x] Animace pohybu a kamera

## Fáze 3 — Multiplayer

- [x] Lobby s kódem místnosti a odkazem
- [x] Trystero, host-authoritative (`src/net/host.ts`, `src/net/guest.ts`)
- [x] Boti doplní prázdná místa, člověk může převzít bota
- [x] Rozšířené nastavení partie

## Mezifáze — Dva režimy

- [x] Klasika: věrná kopie originálních pravidel, desky a karet
- [x] Next level: dosavadní hra
- [x] Výběr režimu v lobby, sólo i multiplayer
- [x] Klasika: plochá deska jako originál a klasičtí panáčci, 3D město jen pro Next level

## Fáze 4 — Byznysová vrstva (režim Next level)

- [x] Černé a bílé peníze
- [x] Praní přes podniky
- [x] Korupce a úplatky
- [x] Burza a pump & dump
- [x] Vězení a pokuty za odhalení
- [x] Archetypy podnikatelů s pasivními schopnostmi

## Fáze 5 — Framework miniher a honička autem

- [ ] Společné rozhraní miniher, AI a lidský controller, auto-resolve
- [ ] Rapier a honička autem

## Fáze 6 — Útěk z vězení, live aukce a vyjednávání

- [ ] Útěk z vězení
- [ ] Aukce v reálném čase, boti blafují
- [ ] Protinabídky v obchodech

## Fáze 7 — Heisty a tower defense hotelu

- [ ] Heist na hotel a banku
- [ ] Tower defense hotelu

## Fáze 8 — Polish

- [ ] Zvuky, hudba, efekty
- [ ] Hlavní menu a tutoriál
- [ ] Vyvážení ekonomiky
- [ ] Doladění satirických karet a textů (přesunuto z Fáze 4, až budou hotové minihry)
