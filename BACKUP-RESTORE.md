# Backup och återställning

Det här dokumentet beskriver hur vi kontrollerar att Firestore-backuper går att återställa utan att röra produktionsdatabasen. Följ stegen först i en separat återställningsdatabas. Återställ aldrig testbackupen direkt till `(default)`.

## Nuvarande läge

I Google Cloud Console visades den 21 oktober 2026:

- Firestore-databasen `(default)` i projektet `fordonsmappen-af27a`.
- Dagliga schemalagda backuper med 84 dagars retention.
- Point-in-time recovery (PITR) avstängt.
- Databasens plats anges i projektinformationen som `europe-north2`.

Kontrollera alltid läget i Cloud Console innan en övning; inställningar och tillgängliga backuper kan ha ändrats. Databasens plats följer med backupen och den återställda databasen skapas på samma plats.

En Firestore-backup innehåller databasens data och indexkonfiguration vid backupögonblicket. Den innehåller inte Cloud Storage-filer, Firebase Authentication-konton, säkerhetsregler, IAM-inställningar eller TTL-policyer. Storage måste därför ha ett separat återställningsskydd.

## Övning: återställ till en separat databas

### 1. Kontrollera backupen

1. Öppna Google Cloud Console och välj projektet `fordonsmappen-af27a`.
2. Gå till **Firestore → Databases → (default) → Disaster Recovery** (menynamnen kan ändras).
3. Kontrollera att en daglig backup finns med status klar och välj en backup från en tidpunkt före testets återställningspunkt.
4. Notera backupens datum/tid och ID. Kontrollera att den inte har gått ut.

Alternativt kan Cloud Shell lista backuper:

```sh
gcloud firestore backups list \
  --location=europe-north2 \
  --project=fordonsmappen-af27a \
  --format="table(name,database,state)"
```

### 2. Starta en isolerad återställning

I backupens meny väljer du **Restore with Cloud Shell**. Ersätt destinationsdatabasens ID med ett nytt, tydligt testnamn, till exempel `restore-check-20261024`. Granska kommandot innan det körs: destinationen måste vara den nya testdatabasen, aldrig `(default)`.

Motsvarande kommando ser ut så här:

```sh
gcloud firestore databases restore \
  --source-backup=projects/fordonsmappen-af27a/locations/europe-north2/backups/BACKUP_ID \
  --destination-database=restore-check-20261024 \
  --project=fordonsmappen-af27a
```

Byt `BACKUP_ID` mot ID:t för den backup du valde. Starta inte kommandot med platshållaren kvar. Återställningen skapar en ny databas och kan ta tid; vänta tills operationen är klar innan du granskar resultatet. Google Cloud visar operationens status i kommandoutdata. Du kan även kontrollera databasen och operationen i Cloud Console.

### 3. Verifiera innehållet utan att koppla appen till testdatabasen

Öppna återställningsdatabasen i Firestore Data-vyn. Kontrollera ett litet urval mot det som fanns vid backupens tidpunkt:

- huvudsamlingarna `users`, `vehicles` och `transferRequests`;
- ett testkonto och dess `privateVehicles`/bilagemetadata;
- ett testfordon med `events`, `members` och `ownershipHistory`;
- att innehållet motsvarar backupens datum, inte dagens senare ändringar.

Dokumentera backupens tidpunkt, återställningsdatabasens ID, när operationen blev klar och vilka kontroller som gjordes. Använd inte den återställda databasen från webbappen och ändra inte dess säkerhetsregler för att göra den publik.

Behåll återställningsdatabasen tills granskningen är klar. Om den ska raderas efter övningen, verifiera först att rätt databas-ID är markerat; radering är separat från återställningen och går inte att ångra. Återställningsåtgärden kan medföra kostnader.

## Separat kontroll för Storage

Firestore-backupen återställer inte bilagor eller profilbilder från Firebase Storage. Kontrollera därför bucketens **Data protection**-inställningar i Cloud Storage och dokumentera soft delete/versionering och retention separat. Log Storage-retention gäller loggar och är inte en backup av användarnas Storage-filer. Om en fil återställs måste man också kontrollera att dess Firestore-metadata pekar på rätt objekt.

## Officiella instruktioner

- [Firestore: Back up and restore data](https://cloud.google.com/firestore/docs/backups)
- [gcloud: restore Firestore database from a backup](https://cloud.google.com/sdk/gcloud/reference/firestore/databases/restore)
- [Cloud Storage: Soft delete](https://cloud.google.com/storage/docs/soft-delete)
- [Cloud Storage: Object Versioning](https://cloud.google.com/storage/docs/object-versioning)
