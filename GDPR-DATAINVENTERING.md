# GDPR – preliminär datainventering

**Status:** intern behandlingsinventering med preliminära verksamhetsbeslut; inte en färdig integritetspolicy eller juridisk bedömning.
**Inventerad:** 2026-10-08  
**Omfattning:** källkod och Firebase-konfiguration i repot. Faktiska Google-/GitHub-avtal, driftloggar, inställningar i konsolerna, backupkonfiguration och vem som juridiskt driver tjänsten är inte verifierade.

Enligt GDPR artikel 30 ska den personuppgiftsansvariges register bland annat beskriva ändamål, kategorier av registrerade och uppgifter, mottagare, eventuella tredjelandsöverföringar, raderingsfrister och säkerhetsåtgärder. Detta dokument kartlägger kodens nuläge och lämnar öppna beslut tydligt markerade. Se [GDPR artikel 30 hos EUR-Lex](https://eur-lex.europa.eu/eli/reg/2016/679/oj?locale=sv) och [IMY:s vägledning om register över behandling](https://www.imy.se/verksamhet/dataskydd/det-har-galler-enligt-gdpr/fora-register-over-behandling/).

## Ansvarig och kontakt – verksamhetsbeslut fattat; transparensen ska verifieras

- **Personuppgiftsansvarig:** William driver tills vidare tjänsten som privatperson och bestämmer ändamålen och medlen för tjänstens behandling.
- **Publik kontakt enligt grundarens beslut:** William, william@doss.se. Efternamn ska inte publiceras. Kontrollera att adressen bevakas. GDPR kräver att ansvarig och kontaktuppgifter anges; om förnamn och e-post tydligt nog identifierar ansvarig bör verifieras före bred lansering.
- När ett företag tar över ska ansvarig och informationen uppdateras innan förändringen börjar gälla.
- **Dataskyddsombud/företrädare:** ej fastställt; ange endast om tillämpligt.
- **Målgrupp/minimiålder:** Fordonsmappen riktar sig till personer som fyllt 18 år. Åldersbekräftelserutan har tagits bort på grundarens begäran; tjänsten verifierar inte åldern tekniskt. Gränsen ska anges i den publika integritetspolicyn.

## Registrerade och datakategorier

Berörda personer kan vara kontoinnehavare, nuvarande och tidigare fordonsägare, köpare som löser in överföringskod, personer vars namn eller kontaktuppgifter förekommer i fritext/kvitton, samt besökare på en publik delningslänk. En person behöver inte själv ha ett konto för att förekomma i ett kvitto eller en anteckning.

| Behandling och ändamål | Uppgifter som koden hanterar | System/mottagare | Rättslig grund och lagring |
|---|---|---|---|
| Konto och inloggning: identifiera kontot och synka användarens data | Firebase UID, e-postadress, visningsnamn och profilbild från Google. Kontouppgifter finns även i appens sparade tillstånd. | Google-inloggning/Firebase Authentication; Firestore `users/{uid}/appData/*`; lokal webbläsare | **Verksamhetsbeslut:** kontot och privata uppgifter behålls medan kontot är aktivt. Efter raderingsbegäran är målet att radera från aktiv databas inom 30 dagar och från kontrollerade säkerhetskopior inom högst 90 dagar. Detta behöver implementeras och verifieras. Rättslig grund per ändamål behöver fortfarande fastställas. |
| Fordon och fordonsbok: lagra och visa fordonets grunduppgifter och historik | Fordonsnamn, typ, märke, modell, årsmodell, registreringsnummer, VIN/chassinummer, miltal. Händelser: kategori, rubrik, datum, miltal, källtyp och skapande UID. Problem har även status. Registreringsnummer tillsammans med andra uppgifter kan knytas till en person. | Firestore `vehicles/*`; medlems- och ägarhistorik under `members`, `ownershipHistory` och `vehicleMemberships`; användarens cache | **Verksamhetsbeslut:** vid kontoradering tas användarens UID-/ägarattribution bort tillsammans med privata anteckningar och bilagor. Fordonsfakta får endast bevaras/fortsätta med bilen om ändamål och rättslig grund för det är fastställda. Om ingen annan aktiv fordonsmedlem finns raderar raderingsflödet fordonet; annars tas den raderande personens attribution bort. Flödet är ännu inte deployat eller verifierat. |
| Ägarens privata fordonsuppgifter: stödja kostnads-/underhållsöversikt och privata noteringar | Händelsedetaljer som kostnad, verkstad, beskrivning, filnamn och annan v1-metadata; privata problemuppdateringar, påminnelser och däckuppgifter. Fritext och kvitton kan innehålla personuppgifter om ägaren eller tredje person. | Firestore `users/{uid}/privateVehicles/*`; lokal `localStorage` och IndexedDB | **Verksamhetsbeslut:** behålls medan kontot är aktivt. Raderingsflödet är kodat för att ta bort privata uppgifter och originalfiler. Målet är 30 dagar från aktiv databas och högst 90 dagar i kontrollerade säkerhetskopior. |
| Bilagor: spara och visa uppladdade bilder/PDF:er | Filinnehåll, filnamn, MIME-typ, storlek och koppling till händelse/konto. Uppladdningskoden tillåter bilder och PDF under 10 MB enligt `storage.rules`; exakt aktiv regel i projektet är inte verifierad. | IndexedDB lokalt; Firebase Storage `users/{uid}/events/{eventId}/...` om synkning lyckas | **Grund måste beslutas.** Ingen automatisk retention hittad. `firebase.json` refererar inte till `storage.rules`, så repot visar inte att dessa regler är deployade. Nedladdning skapar en Firebase download-URL; hantering av sådana länkar och tokenlivslängd behöver verifieras. |
| Överföring av fordon: genomföra och dokumentera ägarbyte i appen | Fordons-ID, säljande UID, köparens UID efter acceptans, status, skapad-/accepterad tid, kodhash och utgångstid. Den råa 128-bitarskoden visas en gång och lagras inte i Firestore. | Firebase callable Functions och Firestore `transferRequests/*`, medlemskap och ägarhistorik | **Verksamhetsbeslut:** koden slutar fungera efter 24 timmar. Transferdokument ska gallras inom 30 dagar efter förbrukning eller utgång. En schemalagd gallringsfunktion finns nu i källkoden för att ta bort överföringsdokument inom tidsmålet; den är ännu inte deployad eller verifierad. Rättslig grund för kvarvarande ägarhistorik behöver fastställas. |
| Publik fordonsprofil: visa ägarens valda uppgifter via länk/QR | Slumpmässig 192-bitars delningstoken och allowlist: fordonsnamn, typ, märke, modell, årsmodell, miltal samt utvalda händelsers kategori, rubrik, datum, miltal och källtyp. | Firestore `publicVehicles/{token}`; tillgänglig för alla som har länken. Ägarens tokenmappning ligger under `users/{uid}/publicShareMappings/*`. | **Verksamhetsbeslut:** behåll profilen endast medan ägaren har aktiverat delning; återkallning ska ta bort profilen omedelbart. Återkallning finns i koden. `noindex` är inte ett åtkomstskydd. |
| Lokal lagring och export: hålla appen användbar mellan sidbesök och låta användaren hämta data | Fordonsdata, kontotillstånd, inställningar och lokalt lagrade filblobbar. Kontoexporten hämtar Firestore-dokument, Auth-profil och Storage-bilagor till en gzip-komprimerad JSON-fil. | Webbläsarens `localStorage`/IndexedDB; nedladdning till användarens enhet; HTTP-funktionen `exportAccountData` | Kontoexport och kontoradering har lagts till i källkoden men är ännu inte deployade eller verifierade. Exporten läser molndata; osynkade lokala ändringar och enbart lokala bilagor kan saknas. |
| Drift och säkerhet | Firebase-/Google-kontoanvändning, begäransmetadata och drift-/säkerhetsloggar kan behandlas av leverantörer. Appen initierar ingen särskild Analytics-SDK i koden som granskats. | Google/Firebase; GitHub Pages för webbplatsen | **Verksamhetsbeslut:** mål högst 30 dagar för säkerhetsloggar som tjänsten själv styr. Längre tid endast för dokumenterad incident/annat motiverat behov. Leverantörers egna loggkategorier och lagring styrs separat och måste verifieras i avtal/konsoler. |

## Föreslagen rättslig grund – verksamhetsval bekräftade, dokumentation återstår

Grundaren har bekräftat tjänstevalen: konto/fordonsbok/bilagor/ägarbyte ska tillhandahållas enligt tjänstens användarvillkor; publik delning ska kräva separat återkalleligt samtycke; användare ska uppmanas att inte lägga in onödiga uppgifter om andra; begränsade fordonsfakta får finnas kvar för andra aktiva medlemmar enligt gallringsregeln nedan. Detta dokumenterar verksamhetens avsikt men ersätter inte en slutlig juridisk bedömning. Appen ska inte ange ”samtycke till allt”. IMY anger att grunden ska vara bestämd och dokumenterad före behandlingen och att registrerade ska informeras om den. Avtalsgrund passar endast uppgifter som faktiskt behövs för tjänstefunktionen. Berättigat intresse kräver en dokumenterad intresseavvägning. Se [IMY: rättslig grund](https://www.imy.se/verksamhet/dataskydd/det-har-galler-enligt-gdpr/rattslig-grund/) och [GDPR artikel 6](https://eur-lex.europa.eu/eli/reg/2016/679/oj?locale=sv).

| Ändamål | Föreslagen grund | Vad som behöver bekräftas |
|---|---|---|
| Skapa konto, logga in och synka användarens fordonsbok | Avtal med användaren; begränsa till uppgifter som behövs för funktionerna användaren valt | Att användarvillkor beskriver tjänsten och att appens dataflöden är nödvändiga för den |
| Spara fordonsuppgifter, underhållshistorik, påminnelser och användarens privata fordonsanteckningar | Avtal med användaren för användarens egna fordonsbok och valda funktioner | Om fordons-/ägarhistorik ska följa bilen efter ägarbyte är ett separat ändamål och behöver en egen bedömning |
| Lagra användarens uppladdade dokument och bilagor | Avtal för den uttryckligen valda uppladdnings-/lagringsfunktionen | Informera användaren att själv kontrollera att bilagor inte innehåller onödiga uppgifter om andra |
| Skapa och lösa in en tidsbegränsad ägarbyteskod | Avtal med säljaren och köparen för överföringsfunktionen | Överföringshistorik och fortsatt lagring efter genomfört byte behöver begränsas till beslutad tid/nytta |
| Publicera en profil som går att läsa via länk eller QR-kod | Samtycke genom ett separat, frivilligt och tydligt publiceringsval; återkalleligt genom avstängning | Publicerade fält ska visas före aktivering; återkallning ska ta bort åtkomsten omedelbart |
| Skydda tjänsten och utreda missbruk/säkerhetsincidenter | Berättigat intresse, om en dokumenterad intresseavvägning visar att behandlingen är nödvändig och inte väger tyngre än användarens rättigheter | Vilka loggar appen själv faktiskt samlar in, åtkomst, 30-dagarsgallring och undantag vid incident |
| Ta emot och hantera begäran om registerutdrag, rättelse eller radering | Rättslig förpliktelse i den utsträckning GDPR kräver att begäran hanteras | Praktisk kontaktväg, identitetskontroll och svarsrutin |

### Kvar att verifiera före bred publicering

1. Dokumentera den rättsliga grunden per ändamål i tabellen och göra en intresseavvägning för säkerhetsloggar om den grunden behålls.
2. Lägga in den godkända uppmaningen om andra personers uppgifter i appen och policyn.
3. Fastställa vilka tekniska säkerhetsloggar appen själv samlar in och om de kan gallras inom 30 dagar.
4. 18-årsgränsen är beslutad och anges i policyn. Ingen åldersruta eller teknisk åldersverifiering används; bedöm om detta är tillräckligt för den valda målgruppen.

## Beslutad målpolicy för lagring och gallring

- Konto, privat data och bilagor: behålls medan kontot är aktivt. Efter raderingsbegäran ska de tas bort från aktiv databas inom 30 dagar och från säkerhetskopior som tjänsten styr inom högst 90 dagar.
- Överföringsdokument: koden gäller 24 timmar; dokument ska tas bort inom 30 dagar från användning eller utgång.
- Publik profil: finns bara när användaren har delningen aktiverad; återkallning ska ta bort profilen omedelbart.
- Säkerhetsloggar som tjänsten styr: högst 30 dagar, utom vid dokumenterad incident eller annat motiverat behov.
- Fordonshistorik: ägarens UID/ägarattribution, privata anteckningar och originalbilagor ska tas bort vid kontoradering. Fordonsfakta får bevaras endast om ett fortsatt ändamål och rättslig grund fastställts; detta beslut är inte färdigt.

**Tekniskt nuläge:** dessa lagringstider är beslutade mål, inte ännu uppnådda garantier. Schemalagd gallring av transferdokument är tillagd i källkoden men behöver deployas och verifieras. Automatisk gallring av loggar styrs inte av appkod och behöver verifieras i Google Cloud/GitHub. `users/{uid}/appData/primary` bevaras uttryckligen som v1-återställningskopia och kan innehålla äldre personuppgifter. Kontoexport och kontoradering är tillagda i källkoden men behöver granskas, testas och deployas; borttagning ur säkerhetskopior inom 90 dagar måste fortfarande verifieras. Firebase-/GitHub-leverantörers egna driftloggar och backuper styrs separat och måste verifieras i deras villkor/konsoler.

**Verksamhetsbeslut:** grundläggande fordonsfakta och historik får finnas kvar efter kontoradering endast när en annan aktiv medlem finns kvar och uppgifterna behövs för den medlemmens fordonsbok. Den raderande personens UID/ägarattribution, privata anteckningar och originalbilagor tas bort. Exakta fält och rättslig grund måste dokumenteras; uppgifter som fortfarande kan kopplas till en person är inte anonyma.

## Rättigheter och nuvarande tekniskt stöd

| Rättighet/åtgärd | Nuvarande stöd i koden | Gap |
|---|---|---|
| Tillgång och dataportabilitet | JSON och CSV för valt fordon; ny kontoexport är kodad för Firestore, Auth-profil och Storage-filer | Kontoexporten är ännu inte deployad eller verifierad; den kan sakna osynkade lokala ändringar och enbart lokala bilagor. |
| Rättelse | Ägaren kan ändra vissa uppgifter via appen | Ingen dokumenterad begärandeprocess. Äldre ägares fordonsfakta är avsiktligt låsta för senare ägare; behövs en granskningsbar rättelseprocess utan att historiken skrivs om. |
| Radering | Radera enskild händelse; återkalla publik länk; ny Firebase-kontoradering är kodad | Kontoraderingen är ännu inte deployad eller verifierad. Gallring ur säkerhetskopior och leverantörsloggar måste verifieras. |
| Invändning/begränsning | Ingen särskild funktion hittad | Process och kontaktväg saknas. |

GDPR ger rättigheter som tillgång, rättelse, radering och i vissa fall dataportabilitet; de gäller med förutsättningar och undantag. Detta dokument avgör inte enskilda juridiska begäranden. Se [GDPR artiklarna 15–20](https://eur-lex.europa.eu/eli/reg/2016/679/oj?locale=sv).

## Leverantörer, mottagare och geografisk plats

- **Google/Firebase:** Authentication, Cloud Firestore, Cloud Storage och Cloud Functions används/är konfigurerade i klienten. Functions körs i `europe-north1`; repots README anger Firestore `europe-north2`. Storage-bucketens plats är inte fastställd i koden och måste kontrolleras i Firebase Console.
- **GitHub:** GitHub Pages levererar den publika webbappen. GitHub Actions bygger och publicerar statiska filer. Kontrollera gällande villkor/DPA, loggar, supportåtkomst och eventuella tredjelandsöverföringar.
- **Google-inloggning:** Google tillhandahåller identitetsinloggning; appen får UID, e-post, visningsnamn och profilbild när leverantören returnerar dem.
- **Besökare:** besökare med tokenlänken får läsa den publika profilen utan inloggning.

Datacenterregion visar inte ensamt var all support, telemetri, säkerhetskopiering eller åtkomst sker. Kontrollera Googles och GitHubs personuppgiftsbiträdesvillkor, underbiträden och överföringsmekanismer innan integritetspolicyn färdigställs.

## Risker och konkreta åtgärder från inventeringen

1. Bygg och testa en komplett radering av Firebase-konto, Firestore-dokument, Storage-filer, v1-backup, lokala UID-cachar och IndexedDB-data; fastställ rättslig grund innan fordonsfakta behålls efter radering.
2. Deploya och verifiera den schemalagda gallringen av transferdokument. Kontrollera dessutom leverantörernas logg- och backupretention mot de beslutade tidsmålen.
3. Gör JSON-exporten komplett på kontonivå och hantera bilagefiler.
4. Kontrollera Storage-reglerna i produktion. `firebase.json` inkluderar för närvarande inte `storage.rules`, så reglerna i repot är inte bevis för aktiva regler.
5. Bestäm och dokumentera controlleridentitet/kontakt, rättslig grund, retention, Google/GitHub DPA och eventuella tredjelandsöverföringar.
6. Granska kvitto-/bilagelänkar: Firebase download-URL:er kan fungera som bärare av åtkomst och ska inte exponeras publikt av misstag.
7. Lägg en begriplig integritetspolicy och rättighetskontakt i appen innan den öppnas för bred publik. Tjänsten drivs för närvarande av grundaren som privatperson och är planerad att vara gratis först; om ett företag senare tar över och betalning införs ska personuppgiftsansvarig, ändamål/rättsliga grunder, kontakt och information uppdateras innan förändringen träder i kraft.

## Källor

- [Dataskyddsförordningen, särskilt artiklarna 5, 6, 13, 15–20 och 30 – EUR-Lex](https://eur-lex.europa.eu/eli/reg/2016/679/oj?locale=sv)
- [IMY: Rättslig grund](https://www.imy.se/verksamhet/dataskydd/det-har-galler-enligt-gdpr/rattslig-grund/)
- [IMY: Föra register över behandling](https://www.imy.se/verksamhet/dataskydd/det-har-galler-enligt-gdpr/fora-register-over-behandling/)
