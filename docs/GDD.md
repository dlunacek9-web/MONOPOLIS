# MONOPOLIS — Game Design Document

Satirická česká hra o nemovitostech, špinavých penězích a akčních minihrách. Styl: Vlk z Wall Street × GTA v kulisách české reality. Mechanicky vychází z klasické deskové hry o nemovitostech, ale názvy, ceny, karty i vzhled jsou vlastní.

Hra je plně hratelná v jednom hráči. Každou roli standardně hraje bot a spoluhráč ji může později převzít. Sólo znamená člověk + 1–3 boti.

Čísla jsou v Kč. Hodnoty označené **(návrh)** patří k pozdějším fázím a ještě se budou ladit.

## 1. Režimy a nastavení partie

| Nastavení                   | Možnosti                                                                      |
| --------------------------- | ----------------------------------------------------------------------------- |
| Režim                       | Klasika (jen základ), MONOPOLIS (nová vrstva, od Fáze 4)                      |
| Výhra                       | Poslední nezbankrotovaný; nejbohatší po X kolech; první na Y Kč čistého jmění |
| Boti                        | 1–3, obtížnost Lehká / Normální / Těžká                                       |
| Osobnosti botů              | Žralok, Lakomec, Kriminálník, Vyvážený (přidělují se náhodně)                 |
| Počáteční hotovost          | 1 000 000, 1 500 000 (výchozí), 2 000 000 Kč                                  |
| Místa u stolu (multiplayer) | 2–4, volná místa obsadí boti                                                  |

### Multiplayer

- Hostitel založí místnost a pošle kód nebo odkaz. Pravidla i boti běží jen u něj, ostatní posílají akce a dostávají hotový stav.
- Hráči se najdou přes veřejné bezplatné servery sítě Nostr, herní data pak jdou přímo mezi prohlížeči (WebRTC). Na některých sítích se přímé spojení nenaváže, placený přenosový server záměrně nepoužíváme.
- Výpadek hosta: 15 sekund čekání, pak za něj hraje Vyvážený bot. Po návratu ze stejné karty prohlížeče dostane hráč místo zpátky.
- Příchozí během partie si vybere bota a převezme jeho místo, majetek i peníze. Když žádný bot nezbývá, je místnost plná.
- Odchod hostitele partii ukončí, hostitel se nepřenáší na jiného hráče.
- Rychlost hry je jen v sólu.

Čisté jmění = hotovost + cena pozemků (zastavený pozemek jen zástavní hodnota) + pořizovací cena budov.

## 2. Deska

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

Obtížnost ovlivňuje ocenění celých měst, ochotu nabízet obchody a opatrnost při dávání soupeři celého města. Bot se rozhoduje jen z veřejného stavu a jeho rozhodnutí jsou deterministická vzhledem ke stavu. S přibývajícími koly boti snižují přirážku za prodej pozemku soupeři, aby se partie nezasekla.

## 6. Archetypy (Fáze 4)

| Archetyp      | Pasivní schopnost (návrh)                                           |
| ------------- | ------------------------------------------------------------------- |
| Developer     | Domy a hotely o 15 % levněji                                        |
| Kryptobro     | +20 % zisk z prodeje akcií, ale ceny jeho akcií kolísají o 50 % víc |
| Dotační baron | Úplatky o 30 % levněji, šance na odhalení úplatku −5 bodů           |
| Trafikant     | Poplatek za praní 15 % místo 25 %, šance na odhalení praní −5 bodů  |

## 7. Režim MONOPOLIS (Fáze 4, návrh)

Žádný heat meter. Každá nelegální akce má procentuální šanci na odhalení a následuje pokuta a vězení.

| Akce                     | Výnos nebo efekt                                   | Cena              | Šance na odhalení | Trest                                       |
| ------------------------ | -------------------------------------------------- | ----------------- | ----------------- | ------------------------------------------- |
| Praní peněz              | Černé na bílé, nejvýše 100 000 Kč za tah za podnik | Poplatek 25 %     | 10 %              | Pokuta 50 % prané částky, vězení            |
| Úplatek úředníkovi       | Daň z pole −50 %                                   | 20 000 Kč         | 15 %              | Pokuta 100 000 Kč, vězení                   |
| Úplatek policajtovi      | Okamžitý odchod z vězení                           | 40 000 Kč         | 20 %              | Pokuta 100 000 Kč, další kolo ve vězení     |
| Úplatek stavebnímu úřadu | Stavba bez rovnoměrnosti                           | 50 000 Kč         | 20 %              | Pokuta 150 000 Kč, vězení, stavba se zbourá |
| Pump & dump              | Cena akcie +30 % na 2 kola, pak −40 %              | 50 000 Kč černých | 25 %              | Zabavení zisku, pokuta 200 000 Kč, vězení   |
| Heist na hotel           | 200 000–500 000 Kč černých                         | Minihra           | 30 % při prohře   | Pokuta 300 000 Kč, vězení                   |
| Heist na banku           | 500 000–1 000 000 Kč černých                       | Minihra           | 45 % při prohře   | Pokuta 500 000 Kč, vězení                   |

Černé peníze nejdou použít na stavbu, daně, hypotéky ani koupi od banky. Nájem a úplatky jimi zaplatit lze.

Burza: každé město je firma, počáteční cena akcie 10 000 Kč. Stavba v městě +2 %, bankrot vlastníka −15 %, karty a pump & dump podle efektu, náhodný šum ±3 % za kolo.

## 8. Minihry (Fáze 5–7)

Každá minihra je plugin s `start(context) → Promise<result>`, AI a lidským controllerem pro každou roli a s `autoResolve()`.

Délka podle důležitosti: běžné situace (honička, útěk z vězení) jsou krátké arkády na 30–60 sekund, velké heisty jsou delší mise o více fázích. Obojí se dá přeskočit přes `autoResolve()`. Minihry běží ve 3D ve stejném stylu jako město (viz kapitola 10).

| Minihra              | Spouštěč                  | Výsledek                                | Auto-resolve (návrh) |
| -------------------- | ------------------------- | --------------------------------------- | -------------------- |
| Honička autem        | Cizí pozemek, místo nájmu | Ujedeš: neplatíš. Chytí tě: dvojnásobek | Šance na útěk 45 %   |
| Útěk z vězení        | Místo čekání              | Ven zdarma, nebo pokuta a tah ve vězení | Šance 40 %           |
| Live aukce           | Odmítnutá koupě           | Pozemek za nejvyšší příhoz              | Tahová dražba        |
| Tower defense hotelu | Heist na hotel            | Obrana, nebo ztráta peněz               | 50 % ± rozdíl úrovní |

## 9. Progrese

Zatím žádná. `src/profile/` obsahuje úložiště za rozhraním (localStorage) a událost konce partie, na kterou se později napojí statistiky a odemykání.

## 10. Vizuální styl

- **Mapa:** město-diorama na plovoucím ostrově. Silnice tvoří čtvercový okruh jako deska, pozemky jsou parcely na vnější straně silnice a uprostřed stojí centrum s věžáky. Vrstvená skála pod ostrovem a menší ostrovy v oparu.
- **Vzhled:** low-poly s plochým stínováním, výrazné tvary, žádné realistické textury. Modely vznikají přímo v kódu, takže nejsou potřeba externí assety.
- **Atmosféra:** teplý písečný soumrak s oparem, rozsvícená okna a neonové reklamy. Paleta je v `src/render/palette.ts`, případná noční varianta je změna palety.
- **Kamera:** šikmý přehled na celé město, při jízdě se přiblíží k autu a vrátí se. Myší jde otáčet a přibližovat.
- **Rozhraní:** tlusté bílé číslice a kostky přímo nad scénou, panely jen tam, kde je potřeba číst nebo klikat.
- **Minihry a postavy:** stejný low-poly jazyk, přehnané pózy, výbuchy a záře, ale vlastní postavy a prostředí.
