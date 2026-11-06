# MONOPOLIS — Game Design Document

Satirická česká hra o nemovitostech, špinavých penězích a akčních minihrách. Styl: Vlk z Wall Street × GTA v kulisách české reality. Mechanicky vychází z klasické deskové hry o nemovitostech, ale názvy, ceny, karty i vzhled jsou vlastní.

Hra je plně hratelná v jednom hráči. Každou roli standardně hraje bot a spoluhráč ji může později převzít. Sólo znamená člověk + 1–3 boti.

Čísla jsou v Kč. Hodnoty označené **(návrh)** patří k pozdějším fázím a ještě se budou ladit.

## 1. Režimy a nastavení partie

| Nastavení                   | Možnosti                                                                                             |
| --------------------------- | ---------------------------------------------------------------------------------------------------- |
| Režim                       | Klasika (věrná kopie originální hry), Next level (naše česká satira, od Fáze 4 s byznysovou vrstvou) |
| Výhra                       | Poslední nezbankrotovaný; nejbohatší po X kolech; první na Y Kč čistého jmění                        |
| Boti                        | 1–3, obtížnost Lehká / Normální / Těžká                                                              |
| Osobnosti botů              | Žralok, Lakomec, Kriminálník, Vyvážený (přidělují se náhodně)                                        |
| Počáteční hotovost          | 1 000 000, 1 500 000 (výchozí), 2 000 000 Kč                                                         |
| Místa u stolu (multiplayer) | 2–4, volná místa obsadí boti                                                                         |

### Multiplayer

- Hostitel založí místnost a pošle kód nebo odkaz. Pravidla i boti běží jen u něj, ostatní posílají akce a dostávají hotový stav.
- Hráči se najdou přes veřejné bezplatné servery sítě Nostr, herní data pak jdou přímo mezi prohlížeči (WebRTC). Na některých sítích se přímé spojení nenaváže, placený přenosový server záměrně nepoužíváme.
- Výpadek hosta: 15 sekund čekání, pak za něj hraje Vyvážený bot. Po návratu ze stejné karty prohlížeče dostane hráč místo zpátky.
- Příchozí během partie si vybere bota a převezme jeho místo, majetek i peníze. Když žádný bot nezbývá, je místnost plná.
- Odchod hostitele partii ukončí, hostitel se nepřenáší na jiného hráče.
- Rychlost hry je jen v sólu.

Čisté jmění = hotovost + cena pozemků (zastavený pozemek jen zástavní hodnota) + pořizovací cena budov. V režimu Next level navíc akcie za tržní cenu a 75 % černých.

### Dva režimy

- **Klasika:** co nejvěrnější kopie originální hry pro školní zadání (jen pro výuku). Originální pravidla, deska, ceny, nájmy a 2×16 karet, částky 1 500 / 200 / 50 Kč. Sada je v `src/core/sets/classic.ts`, názvy a texty karet v `cs.ts` (`CLASSIC_TEXTS`). Pozor: původní názvy ulic a karet jsou pojmenování třetí strany, proto repo nikde nepoužívá slovo „Monopoly“.
- **Next level:** tahle hra, tedy vše níže v kapitolách 2–10. Sada je v `src/core/sets/nextlevel.ts`.
- Režim se vybírá v lobby (sólo i multiplayer) a je součástí `GameSettings.mode`. Jádro přepíná sadu přes `useRuleset(mode)`, UI texty přes `useTexts(mode)`.

## 2. Deska (režim Next level)

Kruh 40 políček. Každá barevná skupina je české město, od nejlevnějšího po nejdražší.

| Pole | Název                     | Typ             | Cena    | Základní nájem |
| ---- | ------------------------- | --------------- | ------- | -------------- |
| 0    | Start                     | výplata 200 000 |         |                |
| 1    | Most: Sídliště Výsluní    | Hnědá           | 70 000  | 3 000          |
| 2    | Finanční úřad             | karta           |         |                |
| 3    | Most: Bazar U Dolu        | Hnědá           | 90 000  | 5 000          |
| 4    | Daň z příjmů              | daň 200 000     |         |                |
| 5    | Nádraží Bohumín           | nádraží         | 200 000 | viz níže       |
| 6    | Ostrava: Hutní kolonie    | Světle modrá    | 110 000 | 7 000          |
| 7    | Tip od kámoše             | karta           |         |                |
| 8    | Ostrava: Vítkovická       | Světle modrá    | 110 000 | 7 000          |
| 9    | Ostrava: Stodolní         | Světle modrá    | 130 000 | 9 000          |
| 10   | Vazba (i jen na návštěvě) | vězení          |         |                |
| 11   | Ústí: Předmostí           | Růžová          | 150 000 | 11 000         |
| 12   | Elektrárna Temelínek      | podnik          | 150 000 | viz níže       |
| 13   | Ústí: Masarykova          | Růžová          | 150 000 | 11 000         |
| 14   | Ústí: Střekov             | Růžová          | 170 000 | 13 000         |
| 15   | Nádraží Česká Třebová     | nádraží         | 200 000 |                |
| 16   | Olomouc: Tržnice          | Oranžová        | 190 000 | 15 000         |
| 17   | Finanční úřad             | karta           |         |                |
| 18   | Olomouc: Tvarůžková       | Oranžová        | 190 000 | 15 000         |
| 19   | Olomouc: Horní náměstí    | Oranžová        | 210 000 | 17 000         |
| 20   | Parkoviště zadarmo        | nic se neděje   |         |                |
| 21   | Plzeň: Skvrňany           | Červená         | 230 000 | 19 000         |
| 22   | Tip od kámoše             | karta           |         |                |
| 23   | Plzeň: Pivovarská         | Červená         | 230 000 | 19 000         |
| 24   | Plzeň: Náměstí Republiky  | Červená         | 250 000 | 21 000         |
| 25   | Letiště Mošnov            | nádraží         | 200 000 |                |
| 26   | Brno: Cejl                | Žlutá           | 270 000 | 23 000         |
| 27   | Brno: Kounicova           | Žlutá           | 270 000 | 23 000         |
| 28   | Vodárna Suchý Kohoutek    | podnik          | 150 000 |                |
| 29   | Brno: Špilberk            | Žlutá           | 290 000 | 25 000         |
| 30   | Razie: rovnou do vazby    | jdi do vězení   |         |                |
| 31   | Vary: Kolonáda            | Zelená          | 310 000 | 27 000         |
| 32   | Vary: Lázeňský vrch       | Zelená          | 310 000 | 27 000         |
| 33   | Finanční úřad             | karta           |         |                |
| 34   | Vary: Rublová vila        | Zelená          | 330 000 | 30 000         |
| 35   | Letiště Ruzyně            | nádraží         | 200 000 |                |
| 36   | Tip od kámoše             | karta           |         |                |
| 37   | Praha: Václavák           | Tmavě modrá     | 370 000 | 36 000         |
| 38   | Daň z luxusu              | daň 100 000     |         |                |
| 39   | Praha: Pařížská           | Tmavě modrá     | 420 000 | 52 000         |

### Nájmy podle budov

Násobky základního nájmu pro 1, 2, 3, 4 domy a hotel. Výsledek se zaokrouhluje na tisíce.

| Města   | 1 dům | 2 domy | 3 domy | 4 domy | Hotel | Cena domu |
| ------- | ----- | ------ | ------ | ------ | ----- | --------- |
| Most    | ×5    | ×15    | ×40    | ×65    | ×90   | 60 000    |
| Ostrava | ×5    | ×15    | ×40    | ×58    | ×78   | 60 000    |
| Ústí    | ×5    | ×14    | ×40    | ×55    | ×70   | 110 000   |
| Olomouc | ×5    | ×14    | ×38    | ×50    | ×62   | 110 000   |
| Plzeň   | ×5    | ×14    | ×36    | ×46    | ×56   | 160 000   |
| Brno    | ×5    | ×14    | ×34    | ×42    | ×50   | 160 000   |
| Vary    | ×5    | ×13    | ×32    | ×39    | ×46   | 210 000   |
| Praha   | ×4    | ×12    | ×28    | ×34    | ×40   | 210 000   |

Hotel stojí jako pátý dům a vrací do banky 4 domy.

### Nádraží a podniky

- Nádraží: 30 000 / 60 000 / 120 000 / 240 000 Kč podle počtu vlastněných nádraží.
- Podniky: součet kostek × 4 000 Kč, při vlastnictví obou × 10 000 Kč.
- Karta „na nejbližší nádraží“: dvojnásobný nájem. Karta „na nejbližší podnik“: nový hod × 10 000 Kč.

## 3. Klasická pravidla (Fáze 1)

- Start: 1 500 000 Kč, náhodný první hráč, 2 kostky.
- Průjezd Startem: výplata 200 000 Kč. Přesun do vězení výplatu nedává.
- Volný pozemek: koupě za cenu, nebo odmítnutí a dražba.
- Dražba: hráči přihazují po kole, minimální příhoz 10 000 Kč, přihodit lze jen do výše hotovosti, kdo pasuje, je venku. Dražit může i ten, kdo koupi odmítl. Když nikdo nepřihodí, pozemek zůstane bance.
- Nájem: bez budov dvojnásobný při vlastnictví celého města. Zastavený pozemek nájem nevybírá. Majitel ve vězení nájem vybírá.
- Stavba: jen s celým městem bez zástav, rovnoměrně, 32 domů a 12 hotelů v bance. Prodej zpět za 50 % ceny, rovnoměrně.
- Hypotéka: 50 % ceny, jen když v celém městě nestojí budovy. Splacení za 110 % zástavy, zaokrouhleno nahoru na tisíce.
- Dubly: hraješ znovu, třetí dubl za sebou znamená vězení.
- Vězení: kauce 50 000 Kč, karta „Propustka“, nebo pokus o dubl. Dubl tě pustí a posune, ale další hod nedává. Po třetím neúspěchu zaplatíš kauci a jedeš podle hodu.
- Obchody: strukturovaná nabídka (pozemky, hotovost, propustky) na tahu. Pozemek nelze vyměnit, když v jeho městě stojí budova. Nový majitel zastaveného pozemku platí 10 % zástavy hned. Nejvýše 3 nabídky za tah.
- Protinabídky: kdo dostal nabídku, ji může přijmout, odmítnout, nebo poslat protinabídku s jinými podmínkami, ať už v pozemcích, hotovosti, nebo propustkách. Rozhodnutí se vrací navrhovateli, který má stejné tři možnosti. V jednom vyjednávání padnou nejvýše 3 protinabídky, potom jde už jen přijmout, nebo odmítnout. Celé vyjednávání se počítá jako jedna nabídka z limitu na tah. Platí v obou režimech.
- Dluh: nemáš-li hotovost, prodáváš budovy, zastavuješ a obchoduješ, dokud nezaplatíš, nebo zbankrotuješ.
- Bankrot vůči hráči: věřitel dostane hotovost včetně poloviny ceny budov, pozemky i propustky a platí 10 % ze zástav. Bankrot vůči bance: pozemky se bez zástav vydraží, propustky se vrátí do balíčků.

### Záměrná zjednodušení kvůli tahům a botům

- Spravovat majetek a obchodovat lze jen na vlastním tahu nebo během vlastního dluhu.
- Při nedostatku domů se nekoná dražba posledních domů.
- Hotel nelze prodat, když v bance nejsou 4 domy.

## 4. Karty

Dva balíčky po 16 kartách. Texty jsou v `src/i18n/cs.ts`, efekty v `src/core/cards.ts`. „Tip od kámoše“ jsou rady, které skončí špatně nebo výjimečně dobře. „Finanční úřad“ jsou daně, exekuce, dotace a vratky.

## 5. Boti

| Osobnost    | Chování                                                           |
| ----------- | ----------------------------------------------------------------- |
| Žralok      | Kupuje skoro všechno, draží vysoko, staví ochotně                 |
| Lakomec     | Drží velkou rezervu, draží málo, staví až s plnou kapsou          |
| Kriminálník | Jede na krev bez rezervy, v režimu MONOPOLIS bude hlavně riskovat |
| Vyvážený    | Rozumný průměr                                                    |

Obtížnost ovlivňuje ocenění celých měst, ochotu nabízet obchody a opatrnost při dávání soupeři celého města. Bot se rozhoduje jen z veřejného stavu a jeho rozhodnutí jsou deterministická vzhledem ke stavu. Na slabou nabídku odpoví protinabídkou s doplatkem: nejdřív s přirážkou, v dalších kolech slevuje až na svou cenu. Pozemky ve vyjednávání nemění. Nabídku pod polovinou své ceny odmítne a protinabídku nepošle ani tehdy, když na doplatek protistrana nemá. S přibývajícími koly boti snižují přirážku za prodej pozemku soupeři, aby se partie nezasekla.

## 6. Archetypy

Každý hráč má jeden archetyp, u stolu se neopakují. Sólista a hostitel si ho vybírají v lobby (nebo náhodně), ostatní ho dostanou podle seedu. Platí jen v režimu Next level.

| Archetyp      | Pasivní schopnost                                                               |
| ------------- | ------------------------------------------------------------------------------- |
| Developer     | Domy a hotely o 15 % levněji                                                    |
| Kryptobro     | +20 % ze zisku při prodeji akcií, vlastní pump & dump má o polovinu větší výkyv |
| Dotační baron | Úplatky o 30 % levněji, šance na odhalení úplatku −5 bodů                       |
| Trafikant     | Poplatek za praní 15 % místo 25 %, šance na odhalení praní −5 bodů              |

## 7. Byznysová vrstva (režim Next level)

Žádný heat meter. Každá nelegální akce má procentuální šanci na odhalení a následuje pokuta a vazba. Čísla jsou v `src/core/sets/nextlevel.ts`, pravidla v `src/core/reducer.ts` a `src/core/business.ts`. Klasika tuhle vrstvu nemá.

### Černé peníze

Hráč má bílé (hotovost) a černé. Černé jdou jen na úplatky, pump & dump a nájem na ruku. Nejdou na stavbu, daně, hypotéky, dluhy ani koupi od banky. Do čistého jmění se počítají za 75 %.

Zdrojem je **nájem na ruku**: majitel si ho zapne u každého pozemku zvlášť. Nájemník platí stejnou částku, nejdřív svými černými, zbytek bílými. Majitel dostane všechno v černých a banka k tomu přidá 50 %. Na co nájemník nemá, to dluží v bílých. Obchod a bankrot nájem na ruku u pozemku vypnou.

Proč to dává smysl: 100 Kč nájmu je 150 Kč černých, po praní 112,50 Kč bílých. Vyplatí se to, ale peníze nejsou hned k dispozici, pere se po malých částkách a s rizikem. Když je odhalen, přijde hráč o polovinu černých, takže se je nevyplatí hromadit. Druhým zdrojem jsou heisty.

### Nelegální akce

Nelegální akce jdou jen na svobodě, bez dluhu a mimo rozhodování o koupi nebo dani. Výjimkou jsou úplatky úředníkovi (při dani) a policajtovi (ve vazbě). Úplatek se platí nejdřív černými, zbytek bílými. Každé odhalení zabaví 50 % zbylých černých.

| Akce                     | Výnos nebo efekt                                     | Cena               | Šance na odhalení | Trest                                            |
| ------------------------ | ---------------------------------------------------- | ------------------ | ----------------- | ------------------------------------------------ |
| Praní peněz              | Černé na bílé, nejvýše 100 000 Kč za tah přes podnik | Poplatek 25 %      | 10 %              | Praná částka propadá, pokuta 50 %, vazba         |
| Úplatek úředníkovi       | Daň z pole −50 %                                     | 20 000 Kč          | 15 %              | Celá daň, pokuta 100 000 Kč, vazba               |
| Úplatek policajtovi      | Okamžitý odchod z vazby, hráč hned hází              | 40 000 Kč          | 20 %              | Pokuta 100 000 Kč, tento tah se nehází           |
| Úplatek stavebnímu úřadu | Stavba bez rovnoměrnosti                             | 50 000 Kč + stavba | 20 %              | Stavba se zbourá, pokuta 150 000 Kč, vazba       |
| Pump & dump              | Cena akcie +30 %, po 2 tazích viníka −40 %           | 50 000 Kč černých  | 25 % při pádu     | Zisk z prodejů propadá, pokuta 200 000 Kč, vazba |
| Heist na hotel           | 200 000–500 000 Kč černých                           | Minihra            | 30 % při prohře   | Pokuta 300 000 Kč, vazba                         |
| Heist na banku           | 500 000–1 000 000 Kč černých                         | Minihra            | 45 % při prohře   | Pokuta 500 000 Kč, vazba                         |

Podnikem je každý vlastní nezastavený pozemek a každý vypere jednou za tah. Pokuta, na kterou hráč nemá, se stává běžným dluhem.

### Burza

Každé město je firma, počáteční cena akcie 10 000 Kč, nejvýše 50 akcií jedné firmy na hráče. Akcie se kupují jen za bílé a prodávat je jde i při dluhu. Stavba ve městě +2 %, bankrot vlastníka pozemků ve městě −15 %, náhodný šum ±3 % na konci každého kola, pump & dump podle tabulky. Jedna firma může být jen v jednom pump & dumpu a hráč smí mít jen jeden. Při bankrotu se akcie prodají za tržní cenu. Akcie se počítají do čistého jmění i do toho, co jde prodat na dluh.

## 8. Minihry (Fáze 5–7)

Každá minihra je plugin s `start(context) → Promise<result>`, AI a lidským controllerem pro každou roli a s `autoResolve()`.

Délka podle důležitosti: běžné situace (honička, útěk z vězení) jsou krátké arkády na 30–60 sekund, velké heisty jsou delší mise o více fázích. Obojí se dá přeskočit přes `autoResolve()`. Minihry běží ve 3D ve stejném stylu jako město (viz kapitola 10).

| Minihra              | Spouštěč                  | Výsledek                                        | Auto-resolve (návrh)   |
| -------------------- | ------------------------- | ----------------------------------------------- | ---------------------- |
| Honička autem        | Cizí pozemek, místo nájmu | Ujedeš: neplatíš. Chytí tě: dvojnásobek a vazba | Šance na útěk 45 %     |
| Útěk z vězení        | Ve vazbě, místo hodu      | Ven zdarma, nebo pokuta a tah ve vězení         | Šance 40 %             |
| Živá dražba          | Odmítnutá koupě, bankrot  | Pozemek za nejvyšší příhoz                      | Tahová dražba          |
| Heist                | Zadní místnost            | Lup v černých, nebo riziko pokuty a vazby       | Hotel 50 %, banka 35 % |
| Tower defense hotelu | Heist na hotel            | Obrana, nebo ztráta peněz                       | 50 % ± rozdíl úrovní   |

### Honička autem

Jen v režimu Next level. Po příjezdu na cizí nezastavený pozemek se hráč rozhodne, jestli zaplatí, nebo ujede. Jeden hráč smí ujíždět jednou za 3 kola, jinak se nájem platí hned.

- **Cíl:** za 45 s dojet ulicemi města k dálnici.
- **Chycení:** policie hráče zastaví, nebo vyprší čas. Hráč zaplatí dvojnásobek nájmu a jde do vazby.
- **Ovládání:** arkádová jízda, WASD nebo šipky, mezerník na smyk, Shift na nitro.
- **Boti a přeskočení:** bot se nehraje, rozhodne `autoResolve()` se šancí 45 %. Člověk může honičku přeskočit před startem za stejných podmínek.
- **Multiplayer:** honičku počítá jen počítač ujíždějícího hráče, policii řídí AI a ostatní dostanou výsledek.
- **Vzhled:** low-poly s plochým stínováním, jednolitý opar a tlusté bílé číslice v HUD. Grafickou referencí je nálada hry Grapples Galore, ale modely a prostředí jsou vlastní a žádné její mechaniky nepřebíráme.

### Útěk z vězení

Jen v režimu Next level. Ve vazbě může hráč místo hodu, kauce nebo úplatku zkusit útěk.

- **Cíl:** za 45 s sebrat klíč a dostat se k bráně na opačné straně vězeňského dvora.
- **Úspěch:** hráč je venku zdarma a hned hází.
- **Nezdar:** pokuta 30 000 Kč, tah končí a pokus se počítá jako jeden ze tří pokusů o dubl. Poslední pokus ale řeší až hod. Pokuta, na kterou hráč nemá, se stává běžným dluhem.
- **Chycení:** naplní se měřák poplachu, dotkne se tě bachař, nebo vyprší čas.
- **Poplach:** plní ho reflektory a pohled tří bachařů, rychleji zblízka. Překážky zakrývají výhled, mimo dohled poplach pomalu klesá. Reflektor navíc přivolá nejbližšího bachaře.
- **Ovládání:** WASD nebo šipky, Shift na krátký sprint. Sprint slyší bachaři v okolí i přes překážky a jdou se podívat.
- **Boti a přeskočení:** bot se nehraje, rozhodne `autoResolve()` se šancí 40 %. Člověk může útěk přeskočit před startem za stejných podmínek. Bot to zkouší podle ochoty ke zločinu, jen když si může dovolit pokutu.
- **Multiplayer:** útěk počítá jen počítač utíkajícího hráče a ostatní dostanou výsledek.
- **Vzhled:** stejný low-poly jazyk, ale noční scéna, aby vynikly reflektory.

### Heist

Jen v režimu Next level. Spouští se ze Zadní místnosti na svém tahu, na svobodě, bez dluhu a mimo rozhodování o koupi nebo dani. Mezi heisty jednoho hráče musí uběhnout 6 kol. Banka jde vykrást vždy, hotel jen tehdy, když na desce stojí hotel soupeře. Lup jde z banky, majitel hotelu zatím o nic nepřichází, to přijde s tower defense.

| Cíl   | První pytel | Další pytel | Pytlů | Zámků | Kamer | Poplach | Policistů | Odhalení při prohře | Pokuta  |
| ----- | ----------- | ----------- | ----- | ----- | ----- | ------- | --------- | ------------------- | ------- |
| Hotel | 200 000     | 100 000     | 4     | 2     | 2     | 26 s    | 4         | 30 %                | 300 000 |
| Banka | 500 000     | 100 000     | 6     | 3     | 4     | 30 s    | 6         | 45 %                | 500 000 |

- **Dovnitř:** hráč jde od dodávky halou k trezoru kolem kamer. Pohled kamery plní podezření, plné podezření spustí poplach dřív. Bez poplachu se po 75 s vystřídá ostraha a poplach přijde sám.
- **Trezor:** u dveří hráč chytá ručičku v zeleném výseku, po zámcích je rychlejší a výsek menší. Stisk vedle přidá podezření a výsek se přesune. Otevření trezoru spustí poplach.
- **Útěk s lupem:** po poplachu běží čas a přibývá policie, nejdřív zezadu, později z ulice. Většina pytlů je v trezoru, po jednom v kancelářích, které jde vybrat i před poplachem. Každý pytel zpomalí o 9 % a naložení chvíli trvá. Pytel jde odhodit a znovu sebrat.
- **Konec:** hráč odjíždí dotykem dodávky, po poplachu i s prázdnou. Dotek policisty nebo vypršení času znamená konec bez lupu a hod na odhalení: pokuta, zabavení poloviny černých a vazba.
- **Ovládání:** WASD nebo šipky, E nebo mezerník na trezor, zámek a pytel, Q odhodit pytel, Shift sprint.
- **Boti a přeskočení:** bot se nehraje, rozhodne `autoResolve()`: hotel 50 %, banka 35 %, lup je náhodný a nikdy plný. Člověk může heist přeskočit za stejných podmínek. Na heist jde jen bot se sklonem ke zločinu, který unese pokutu, a to nejdřív od 4. kola.
- **Multiplayer:** heist počítá jen počítač hrajícího hráče a ostatní dostanou výsledek.
- **Vzhled:** stejný low-poly jazyk, noční scéna, po poplachu bliká červená a modrá.

### Živá dražba

Jen v režimu Next level a jen když v dražbě sedí aspoň jeden člověk. Samotní boti a Klasika draží po řadě jako dřív.

- **Průběh:** přihazují všichni najednou, kdykoli a bez pořadí. Kdo vede, nesmí přihodit ani pasovat.
- **Kladívko:** bez příhozu klepne poprvé, podruhé a potřetí a pak je prodáno. Na první příhoz je 5 s, mezi klepnutími 2,5 s. Každý příhoz vrací kladívko na začátek.
- **Pas:** je volitelný a nevratný. Stačí i čekat. Když pasuje poslední člověk, zbytek dohrají boti po řadě bez obrazovky.
- **Ovládání:** mezerník nejnižší příhoz, W a E větší příhozy, Q pas. Všechno jde i myší.
- **Boti blafují:** někteří přihazují až o 40 % nad svou cenu a riskují, že předražený pozemek zaplatí. Někteří po přeplacení jen mlčí, takže nejde poznat, jestli skončili, nebo číhají. Číhající bot přihodí až po klepnutí kladívka a občas přihodí velkým skokem. Bluf i řeči v bublinách vycházejí jen z veřejného stavu, bot nemá žádnou výhodu.
- **Časovač:** pravidla žádný čas neznají. Hodiny běží u hostitele a klepnutí je běžná akce, kterou hosté poslat nemohou.
- **Vzhled:** dražební síň ve stejném low-poly jazyce, bez 3D běží jen s panely.

## 9. Progrese

Zatím žádná. `src/profile/` obsahuje úložiště za rozhraním (localStorage) a událost konce partie, na kterou se později napojí statistiky a odemykání.

## 10. Vizuální styl

- **Mapa:** město-diorama na plovoucím ostrově. Silnice tvoří čtvercový okruh jako deska, pozemky jsou parcely na vnější straně silnice a uprostřed stojí centrum s věžáky. Vrstvená skála pod ostrovem a menší ostrovy v oparu.
- **Vzhled:** low-poly s plochým stínováním, výrazné tvary, žádné realistické textury. Modely vznikají přímo v kódu, takže nejsou potřeba externí assety.
- **Atmosféra:** teplý písečný soumrak s oparem, rozsvícená okna a neonové reklamy. Paleta je v `src/render/palette.ts`, případná noční varianta je změna palety.
- **Kamera:** šikmý přehled na celé město, při jízdě se přiblíží k autu a vrátí se. Myší jde otáčet a přibližovat.
- **Rozhraní:** tlusté bílé číslice a kostky přímo nad scénou, panely jen tam, kde je potřeba číst nebo klikat.
- **Minihry a postavy:** stejný low-poly jazyk, přehnané pózy, výbuchy a záře, ale vlastní postavy a prostředí.
