# Fordonsmappen

Allt om ditt fordon. På ett ställe.

En preliminär inventering av personuppgifter, ändamål, lagring och identifierade GDPR-luckor finns i [`GDPR-DATAINVENTERING.md`](GDPR-DATAINVENTERING.md). Dokumentet är internt arbetsunderlag och behöver kompletteras av tjänstens personuppgiftsansvarige innan en integritetspolicy publiceras.

En responsiv webbapp på svenska som samlar fordon, historik, problem, kostnader, påminnelser och delning.

## Webbplats

Publiceras från repots rot med GitHub Actions och GitHub Pages.

## Lokal prototyp

Öppna `index.html` i en modern webbläsare. Data sparas lokalt i webbläsaren; se **Inställningar** i appen för begränsningar.

## Google-inloggning och molnsynk

Firebase-projektet `fordonsmappen-af27a` är anslutet. Google-inloggning är aktiverad, GitHub Pages-domänen `d0ss3n.github.io` är godkänd och Cloud Firestore använder regionen `europe-north2` (Stockholm) på Spark-planen. Firestore-reglerna begränsar privata dokument till kontots UID och fordonsfakta till aktiva fordonsmedlemmar; publika delningar går att läsa via sin länk. Ägarbyte hanteras av två autentiserade Firebase callable functions i regionen `europe-north1`.

Webbkonfigurationen i `firebase-config.js` innehåller offentliga klientidentifierare och är avsedd att ingå i klientkoden. Fordonsdata synkas till Firestore mellan användarens enheter. Bilagefiler använder Firebase Storage; bilagemetadata och filreferenser hålls privata per konto.

## Testa Firestore-regler

Reglerna i `firestore.rules` kan testas lokalt i Firestore Emulatorn. Testerna använder två simulerade konton (`alice` och `bob`) och kräver inga riktiga Google-konton:

```sh
npm install
npm run test:rules
```

Testerna verifierar att en publik delningslänk bara kan läsa ett enskilt, sanerat dokument. Slumptoken skapas och återkallas av callable Functions; klienter kan inte lista, skapa eller ändra publika profiler. Profilen tillåter bara fordonsnamn, typ, märke, modell, årsmodell, miltal samt valda händelsers kategori, rubrik, datum, miltal och källtyp. Registreringsnummer, ägar-ID, kostnad, verkstad, beskrivning och bilagor publiceras aldrig. Delningsadressen använder `?delning=<slumptoken>` och profilsidan sätter `noindex,nofollow`.

## Publicera Firestore-regler

Firebase CLI behöver vara inloggad med ett konto som har behörighet till projektet. Efter att reglerna granskats kan de publiceras separat från webbplatsen med:

```sh
npx firebase-tools login
npx firebase-tools deploy --only firestore --project fordonsmappen-af27a
```

Publicering ersätter projektets nuvarande Firestore-regler med `firestore.rules` i repot. Kör därför testerna och granska de aktiva reglerna i Firebase Console före publicering. Detta kommando publicerar inte webbplatsen eller Storage-reglerna.

## Ägarbyte med överföringskod

Ägarbyte använder Firebase Functions (Node.js 22) och kräver att Firebase-projektet har Blaze-plan/billing aktiverat för att Functions ska kunna deployas. Koden skapas av `createVehicleTransfer`, är 128 bitar slumpmässig, gäller i 24 timmar och lagras bara som SHA-256-hash. Köparen måste vara inloggad med Google och löser in den via `acceptVehicleTransfer`. Funktionen uppdaterar medlemskap, kontots fordonsindex, ägarhistorik och återkallar säljarens tokenbaserade publika profil i en Firestore-transaktion. Tidigare ägares privata anteckningar och originalbilagor följer inte med.

Publik delning hanteras av `publishPublicVehicle` och `revokePublicVehicleShare`. De skapar respektive återkallar en slumpmässig 192-bitars token och skriver endast den tillåtna publika fältlistan. Tokenmappningen är privat under säljarens konto. Ägarbyte tar bort både mappning och profil. Gamla länkar med `?fordon=<fordons-id>` fungerar inte längre efter att reglerna publicerats; ägaren behöver publicera profilen igen och dela den nya länken/QR-koden.

Installera Functions-beroenden och deploya först efter att ändringen granskats:

```sh
cd functions
npm install
cd ..
npx firebase-tools deploy --only functions,firestore --project fordonsmappen-af27a
```

Deployen har inte körts som del av den här ändringen. Kör `npm run test:rules` och granska sedan Firebase Console.

## Datamodell och migrering

Klienten migrerar v1-data till v2 vid inloggning när v2-markören saknas, läser sedan fordon och historik från v2 och skriver fortsatta ändringar dit. Det gamla `users/{uid}/appData/primary`-dokumentet behålls som oförändrad återställningskopia; konto-inställningar sparas i `preferences-v2`. Se [`DATA_MODEL.md`](DATA_MODEL.md) för strukturen och begränsningarna.

Ändringarna i klienten och `firestore.rules` måste granskas och v2-reglerna deployas innan skarp migrering kan verifieras. Ägarbyten mellan konton ingår inte i den här migreringen.
