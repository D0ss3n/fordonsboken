# GDPR – preliminär datainventering

**Status:** arbetsunderlag, inte en färdig integritetspolicy eller juridisk bedömning.  
**Inventerad:** 2026-10-08  
**Omfattning:** källkod och Firebase-konfiguration i repot. Faktiska Google-/GitHub-avtal, driftloggar, inställningar i konsolerna, backupkonfiguration och vem som juridiskt driver tjänsten är inte verifierade.

Enligt GDPR artikel 30 ska den personuppgiftsansvariges register bland annat beskriva ändamål, kategorier av registrerade och uppgifter, mottagare, eventuella tredjelandsöverföringar, raderingsfrister och säkerhetsåtgärder. Detta dokument kartlägger kodens nuläge och lämnar öppna beslut tydligt markerade. Se [GDPR artikel 30 hos EUR-Lex](https://eur-lex.europa.eu/eli/reg/2016/679/oj?locale=sv) och [IMY:s vägledning om register över behandling](https://www.imy.se/verksamhet/dataskydd/det-har-galler-enligt-gdpr/fora-register-over-behandling/).

## Ansvarig och kontakt – måste fyllas i

- **Personuppgiftsansvarig:** inte fastställd i repot. Ange den fysiska eller juridiska person som faktiskt bestämmer varför och hur tjänsten behandlar personuppgifter.
- **Kontaktadress för dataskyddsfrågor och rättighetsbegäran:** saknas.
- **Dataskyddsombud/företrädare:** ej fastställt; ange endast om tillämpligt.
- **Tjänstens målgrupp och eventuell minimiålder:** ej dokumenterad.

## Registrerade och datakategorier

Berörda personer kan vara kontoinnehavare, nuvarande och tidigare fordonsägare, köpare som löser in överföringskod, personer vars namn eller kontaktuppgifter förekommer i fritext/kvitton, samt besökare på en publik delningslänk. En person behöver inte själv ha ett konto för att förekomma i ett kvitto eller en anteckning.

| Behandling och ändamål | Uppgifter som koden hanterar | System/mottagare | Rättslig grund och lagring |
|---|---|---|---|
| Konto och inloggning: identifiera kontot och synka användarens data | Firebase UID, e-postadress, visningsnamn och profilbild från Google. Kontouppgifter finns även i appens sparade tillstånd. | Google-inloggning/Firebase Authentication; Firestore `users/{uid}/appData/*`; lokal webbläsare | **Grund måste beslutas per ändamål.** Avtal kan vara relevant för kontofunktioner, men ansvarig måste bedöma nödvändighet och beskriva grunden innan insamling. Ingen kontoradering i molnet är implementerad. |
| Fordon och fordonsbok: lagra och visa fordonets grunduppgifter och historik | Fordonsnamn, typ, märke, modell, årsmodell, registreringsnummer, VIN/chassinummer, miltal. Händelser: kategori, rubrik, datum, miltal, källtyp och skapande UID. Problem har även status. Registreringsnummer tillsammans med andra uppgifter kan knytas till en person. | Firestore `vehicles/*`; medlems- och ägarhistorik under `members`, `ownershipHistory` och `vehicleMemberships`; användarens cache | **Grund måste beslutas.** Möjlig avtalsgrund för den registrerades egna tjänstefunktioner behöver prövas. Fordonsfakta kan ligga kvar efter ägarbyte; kopplingen till tidigare ägare är personuppgift och saknar beslutad gallringsregel. |
| Ägarens privata fordonsuppgifter: stödja kostnads-/underhållsöversikt och privata noteringar | Händelsedetaljer som kostnad, verkstad, beskrivning, filnamn och annan v1-metadata; privata problemuppdateringar, påminnelser och däckuppgifter. Fritext och kvitton kan innehålla personuppgifter om ägaren eller tredje person. | Firestore `users/{uid}/privateVehicles/*`; lokal `localStorage` och IndexedDB | **Grund måste beslutas.** Någon ändamålsvis retention finns inte. Privata data överförs inte automatiskt till ny fordonsägare. |
| Bilagor: spara och visa uppladdade bilder/PDF:er | Filinnehåll, filnamn, MIME-typ, storlek och koppling till händelse/konto. Uppladdningskoden tillåter bilder och PDF under 10 MB enligt `storage.rules`; exakt aktiv regel i projektet är inte verifierad. | IndexedDB lokalt; Firebase Storage `users/{uid}/events/{eventId}/...` om synkning lyckas | **Grund måste beslutas.** Ingen automatisk retention hittad. `firebase.json` refererar inte till `storage.rules`, så repot visar inte att dessa regler är deployade. Nedladdning skapar en Firebase download-URL; hantering av sådana länkar och tokenlivslängd behöver verifieras. |
| Överföring av fordon: genomföra och dokumentera ägarbyte i appen | Fordons-ID, säljande UID, köparens UID efter acceptans, status, skapad-/accepterad tid, kodhash och utgångstid. Den råa 128-bitarskoden visas en gång och lagras inte i Firestore. | Firebase callable Functions och Firestore `transferRequests/*`, medlemskap och ägarhistorik | **Grund måste beslutas.** Koden gäller 24 timmar, men implementationen raderar inte automatiskt utgångna/förbrukade transferdokument; status uppdateras när en utgången kod löses in. Retention för historiken är inte beslutad. |
| Publik fordonsprofil: visa ägarens valda uppgifter via länk/QR | Slumpmässig 192-bitars delningstoken och allowlist: fordonsnamn, typ, märke, modell, årsmodell, miltal samt utvalda händelsers kategori, rubrik, datum, miltal och källtyp. | Firestore `publicVehicles/{token}`; tillgänglig för alla som har länken. Ägarens tokenmappning ligger under `users/{uid}/publicShareMappings/*`. | Aktivt publiceringsval; profilen kan återkallas. **Rättslig grund och information till berörda måste bekräftas.** `noindex` är inte ett åtkomstskydd. Historiska gamla ID-länkar nekas av de nuvarande reglerna. |
| Lokal lagring och export: hålla appen användbar mellan sidbesök och låta användaren hämta data | Fordonsdata, kontotillstånd, inställningar och lokalt lagrade filblobbar. JSON/CSV-exporten gäller det valda fordonet; JSON tar med fordon, händelser, problem, påminnelser och däckuppgifter, men är inte en fullständig kontoexport eller fullständig export av bilagefiler. | Webbläsarens `localStorage`/IndexedDB; nedladdning till användarens enhet | Lokal lagring upphör inte nödvändigtvis när kontot raderas, eftersom någon sådan molnradering saknas. Åtgärden ”radera från webbläsaren” tar enligt koden endast bort basnyckeln, inte UID-suffixerad cache eller IndexedDB-bilagor. |
| Drift och säkerhet | Firebase-/Google-kontoanvändning, begäransmetadata och drift-/säkerhetsloggar kan behandlas av leverantörer. Appen initierar ingen särskild Analytics-SDK i koden som granskats. | Google/Firebase; GitHub Pages för webbplatsen | Leverantörernas exakta loggkategorier, roller, retention och eventuella överföringar utanför EU/EES måste verifieras i avtal och konsoler. |

## Rättslig grund – ej fastställd

Appen ska inte ange ”samtycke till allt”. IMY anger att ansvarig måste ha den rättsliga grunden klar före insamlingen och att grunden beror på ändamålet. Avtal kan vara relevant för behandling som faktiskt är nödvändig för att tillhandahålla kontotjänsten; det täcker inte automatiskt all historik, offentlig delning, säkerhetsloggning eller dokument. Berättigat intresse kräver en separat dokumenterad intresseavvägning. Se [IMY: rättslig grund](https://www.imy.se/verksamhet/dataskydd/det-har-galler-enligt-gdpr/rattslig-grund/) och [GDPR artikel 6](https://eur-lex.europa.eu/eli/reg/2016/679/oj?locale=sv).

Följande beslut saknas därför i nuläget:

1. Bestäm behandlingsändamål för varje rad i tabellen.
2. Välj och dokumentera rättslig grund per ändamål.
3. Bestäm hur publik delning ska informeras om och hur den registrerades rättigheter hanteras när uppgifter delas via tokenlänk.
4. Bestäm om fritext/bilagor får innehålla uppgifter om andra personer och hur sådana begäranden hanteras.

## Lagring och gallring – nuläge och luckor

- Ingen automatisk gallring av inaktiva konton, gamla händelser, v1-backup, bilagor eller avslutade ägarhistorikposter hittades.
- Överföringskoder har 24 timmars giltighet, men dokumenten raderas inte automatiskt efter utgång eller användning.
- Återkallad publik profil tas bort av callable function; ägarbyte raderar den gamla ägarens delningsprofil och mappning.
- `users/{uid}/appData/primary` bevaras uttryckligen som v1-återställningskopia. Den kan därför innehålla äldre kontouppgifter, fordon, händelsedetaljer och filmetadata efter migrering.
- Att radera en händelse försöker radera dess molnbilagor, men kontot har ingen komplett raderingsrutin. Lokala bilageblobbar kan finnas kvar i IndexedDB.
- Ingen regel för säkerhetskopiors utgångstid eller återställning efter radering är dokumenterad.

**Beslut som behövs:** sätt separata tidsfrister för konto-/profiluppgifter, privata händelsedetaljer, filer, transferdokument, loggar och fordons-/ägarskifteshistorik. Motivera varje frist och implementera faktisk gallring; ange tills dess att perioden inte är fastställd i informationen till användarna. GDPR:s lagringsminimering kräver att identifierbara uppgifter inte sparas längre än nödvändigt.

## Rättigheter och nuvarande tekniskt stöd

| Rättighet/åtgärd | Nuvarande stöd i koden | Gap |
|---|---|---|
| Tillgång och dataportabilitet | JSON och CSV för valt fordon | Saknar komplett kontoexport, alla fordon och en tydlig export av bilagefiler, transfer-/delningsdata och konto-/ägarkopplingar. |
| Rättelse | Ägaren kan ändra vissa uppgifter via appen | Ingen dokumenterad begärandeprocess. Äldre ägares fordonsfakta är avsiktligt låsta för senare ägare; behövs en granskningsbar rättelseprocess utan att historiken skrivs om. |
| Radering | Radera enskild händelse; återkalla publik länk; lokal ”radera”-åtgärd | Ingen kontoradering i Firebase. Lokal åtgärd rensar inte UID-cache/IndexedDB. v1-backup, ägarhistorik, transferdokument och kopplade Storage-objekt kräver definierad policy och samordnad radering. |
| Invändning/begränsning | Ingen särskild funktion hittad | Process och kontaktväg saknas. |

GDPR ger rättigheter som tillgång, rättelse, radering och i vissa fall dataportabilitet; de gäller med förutsättningar och undantag. Detta dokument avgör inte enskilda juridiska begäranden. Se [GDPR artiklarna 15–20](https://eur-lex.europa.eu/eli/reg/2016/679/oj?locale=sv).

## Leverantörer, mottagare och geografisk plats

- **Google/Firebase:** Authentication, Cloud Firestore, Cloud Storage och Cloud Functions används/är konfigurerade i klienten. Functions körs i `europe-north1`; repots README anger Firestore `europe-north2`. Storage-bucketens plats är inte fastställd i koden och måste kontrolleras i Firebase Console.
- **GitHub:** GitHub Pages levererar den publika webbappen. GitHub Actions bygger och publicerar statiska filer. Kontrollera gällande villkor/DPA, loggar, supportåtkomst och eventuella tredjelandsöverföringar.
- **Google-inloggning:** Google tillhandahåller identitetsinloggning; appen får UID, e-post, visningsnamn och profilbild när leverantören returnerar dem.
- **Besökare:** besökare med tokenlänken får läsa den publika profilen utan inloggning.

Datacenterregion visar inte ensamt var all support, telemetri, säkerhetskopiering eller åtkomst sker. Kontrollera Googles och GitHubs personuppgiftsbiträdesvillkor, underbiträden och överföringsmekanismer innan integritetspolicyn färdigställs.

## Risker och konkreta åtgärder från inventeringen

1. Bygg och testa en komplett radering av Firebase-konto, Firestore-dokument, Storage-filer, v1-backup, lokala UID-cachar och IndexedDB-data; definiera separat vilka historiska fordonsfakta som eventuellt får behållas och varför.
2. Sätt TTL/gallring för transferdokument och bestäm retention för ägarhistorik och säkerhetsloggar.
3. Gör JSON-exporten komplett på kontonivå och hantera bilagefiler.
4. Kontrollera Storage-reglerna i produktion. `firebase.json` inkluderar för närvarande inte `storage.rules`, så reglerna i repot är inte bevis för aktiva regler.
5. Bestäm och dokumentera controlleridentitet/kontakt, rättslig grund, retention, Google/GitHub DPA och eventuella tredjelandsöverföringar.
6. Granska kvitto-/bilagelänkar: Firebase download-URL:er kan fungera som bärare av åtkomst och ska inte exponeras publikt av misstag.
7. Lägg en begriplig integritetspolicy och rättighetskontakt i appen innan den öppnas för bred publik.

## Källor

- [Dataskyddsförordningen, särskilt artiklarna 5, 6, 13, 15–20 och 30 – EUR-Lex](https://eur-lex.europa.eu/eli/reg/2016/679/oj?locale=sv)
- [IMY: Rättslig grund](https://www.imy.se/verksamhet/dataskydd/det-har-galler-enligt-gdpr/rattslig-grund/)
- [IMY: Föra register över behandling](https://www.imy.se/verksamhet/dataskydd/det-har-galler-enligt-gdpr/fora-register-over-behandling/)
