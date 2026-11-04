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

Pořadí fází: 2 → 4 → 3 → 5 a dál. Multiplayer jde až po byznysové vrstvě, aby se nemusela každá nová mechanika testovat i přes síť.

## Fáze 2 — 3D město

- [x] Low-poly deska jako město na plovoucím ostrově, auta jako figurky
- [x] Animace pohybu a kamera

## Fáze 4 — Byznysová vrstva (režim MONOPOLIS)

- [ ] Černé a bílé peníze
- [ ] Praní přes podniky
- [ ] Korupce a úplatky
- [ ] Burza a pump & dump
- [ ] Vězení a pokuty za odhalení
- [ ] Archetypy podnikatelů s pasivními schopnostmi (přesunuto z Fáze 2, stojí na burze, úplatcích a praní)
- [ ] Doladění satirických karet a textů

## Fáze 3 — Multiplayer

- [ ] Lobby s kódem místnosti a odkazem
- [ ] TrysteroTransport, host-authoritative
- [ ] Boti doplní prázdná místa, člověk může převzít bota
- [ ] Rozšířené nastavení partie

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
