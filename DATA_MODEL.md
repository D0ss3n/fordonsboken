# Fordonscentrerad datamodell (v2)

## Mål

Ett fordon ska kunna finnas kvar när ett konto avslutas eller ägaren byts. Fordonets historik och en användares privata uppgifter lagras därför separat. Registreringsnummer är identifierande information och får inte användas som bevis på ägande.

Klientkoden är kopplad till v2-modellen. Vid inloggning migreras ett befintligt v1-dokument om v2-markören saknas. Ägarbyte körs genom Firebase callable functions och uppdaterar Firestore-medlemskap och ägarhistorik atomiskt. Regler, Functions och klientkod måste testas, granskas och publiceras innan flödet används i produktion.

## Firestore-struktur

```text
vehicles/{vehicleId}
  vehicle fields: name, type, make, model, year, registration, VIN, mileage
  events/{eventId}
  problems/{problemId}
  eventCorrections/{correctionId}
  members/{uid}
  ownershipHistory/{ownershipId}
  publicShares/{shareId}
  (transfer requests live in top-level transferRequests/{sha256(code)} documents)

users/{uid}/privateVehicles/{vehicleId}
  reminders/{reminderId}
  eventDetails/{eventId}
  attachments/{attachmentId}
users/{uid}/vehicleMemberships/{vehicleId}
users/{uid}/appData/preferences-v2
```

`users/{uid}/appData/primary` behålls som oförändrad v1-återställningskopia. Konto-inställningar som aktivt fordon och delningsval sparas separat i `preferences-v2`; fordonslistor och historik finns i v2.

### `vehicles/{vehicleId}`

Har en slumpmässig, ogenomskinlig ID och beskriver bilen, inte kontot. Registreringsnummer sparas här för att behöriga ägare ska kunna använda det, men får aldrig läggas i den publika delningsprofilen som standard.

### `events/{eventId}`

Innehåller fordonsfakta som kan följa bilen: kategori, rubrik, datum, miltal och källtyp. Källtyper ska kunna skilja mellan exempelvis `owner_entry`, `receipt`, `workshop` och `imported`; en bifogad fil räknas inte automatiskt som verifiering. Detaljerade beskrivningar och verkstadsanteckningar ligger privat per ägare.

En historikpost blir skrivskyddad för nya ägare vid ägarbyte. Rättelser görs som en ny post i `eventCorrections`, med referens till den ursprungliga posten och en synlig tidsstämpel. Den gamla posten skrivs inte över eller raderas i smyg.

### `members/{uid}` och `ownershipHistory/{ownershipId}`

`members` är behörighetsrelationen till fordonet och innehåller aktuell roll/åtkomst. `ownershipHistory` beskriver ägarperioder utan att registreringsnumret fungerar som ägarbevis. Ägarbyte får endast ske genom ett separat betrott engångsflöde; klienten ska inte själv kunna utse en ny ägare genom att skriva ett UID.

`users/{uid}/vehicleMemberships/{vehicleId}` är en användarspecifik indexpost. Den gör det möjligt att hitta kontots fordon utan att ge generell liståtkomst till hela `vehicles`-samlingen. Den ska alltid motsvara en riktig aktiv medlemsrelation.

### Ägarens privata uppgifter

Påminnelser, privata anteckningar, kostnader och originalkvitton ligger under `users/{uid}/privateVehicles/{vehicleId}` och följer inte automatiskt med bilen. Det skyddar exempelvis säljarens namn, adress, kundnummer och andra personuppgifter i ett kvitto. Om användaren uttryckligen delar en kostnad eller ett dokument ska det ske genom en separat, begränsad publicering.

Problem/felsökning delas i två delar: en kort fordonsfakta-post (`title`, datum, miltal och status) under `vehicles/{vehicleId}/problems`, och ägarens beskrivningar/uppdateringar i den privata grenen. Därmed kan ett olöst problem följa bilen utan att tidigare ägares privata anteckningar följer med.

Bilagor sparas privat per konto som standard. En bilagereferens i historiken är inte en publik nedladdningslänk. Om användaren senare väljer att föra över ett dokument ska mottagaren få en egen kopia efter att användaren granskat innehållet.

### Publika delningar

Den aktuella publika länken använder `publicVehicles/{token}` med ett kryptografiskt slumpmässigt 192-bitars token, inte fordonets ID eller registreringsnummer. `users/{uid}/publicShareMappings/{vehicleId}` binder ägarens fordon till token och är endast åtkomlig för betrodda callable Functions. `publishPublicVehicle` kontrollerar aktivt ägarskap och skriver en server-sanerad allowlist; `revokePublicVehicleShare` tar bort tokenprofilen och mappningen. Ägarbyte tar också bort säljarens profil och mappning.

Profilen tillåter enbart fordonsnamn, typ, märke, modell, årsmodell och miltal, samt de valda historikhändelsernas kategori, rubrik, datum, miltal och källtyp. Registreringsnummer, VIN, ägar-ID, kostnad, verkstad, beskrivningar, interna ID:n och bilagor publiceras inte. Firestore tillåter endast enskilda `get`-läsningar av v2-profiler och nekar listning och klientskrivningar. Profilvyn använder `noindex,nofollow`; detta är en sökmotorsignal, medan token och serverns allowlist utgör åtkomst-/dataskyddet.

Delning är avstängd som standard; ägaren kan återkalla token. Gamla länkar med fordons-ID (`?fordon=...`) ska inte längre visa profilen efter reglerna är publicerade. Delning måste då publiceras på nytt för att få en tokenlänk.

### Överföringar

`transferRequests/{sha256(code)}` lagrar en tidsbegränsad engångsförfrågan. Två Firebase callable functions hanterar flödet: `createVehicleTransfer` kräver att säljaren är aktiv ägare och returnerar en slumpmässig 128-bitars kod som visas en gång; bara SHA-256-hashen lagras. Koden gäller i 24 timmar. `acceptVehicleTransfer` kräver inloggad köpare och genomför kontroll, kodförbrukning, byte av medlemskap/index, avslut av tidigare ägarperiod och skapande av ny ägarhistorik i en Firestore-transaktion. Den gamla publika profilen tas bort och tidigare ägares privata uppgifter och bilagor förblir privata. Funktionerna ligger i `functions/` och behöver deployas separat med Firebase CLI; Firebase Functions kräver Blaze-plan/billing.

## Migrering från v1

Nuvarande v1-data är en sammanhållen blob i `users/{uid}/appData/primary`. Klientflödet är byggt för en idempotent och icke-destruktiv migrering:

1. Behåll v1-dokumentet oförändrat som återställningskälla.
2. Skapa v2-fordon, historikposter, ägaråtkomst och privata uppgifter från en kopia av v1.
3. Bevara befintliga ID:n där de är unika; generera nya kryptografiskt slumpmässiga ID:n för publika tokens.
4. Jämför antal poster och fält före/efter och verifiera åtkomst med olika användare i emulatorn.
5. Skriv en komplett migreringsmarkör först när kopieringen lyckats. Läs och synka sedan fordonsdata i v2; spara konto-inställningar i `preferences-v2`.

v1-kopian skrivs inte över efter att den skapats. Ingen migrering sker förrän användaren loggar in och appen får läsa/skriva med aktiva Firestore-regler. V2-reglerna måste därför deployas före ett skarpt migreringstest. Överföringsflödet behöver verifieras i emulator och genom ett kontrollerat test med två inloggade konton före produktionsbruk.
