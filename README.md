# Fordonsmappen

Allt om ditt fordon. På ett ställe.

En responsiv webbapp på svenska som samlar fordon, historik, problem, kostnader, påminnelser och delning.

## Webbplats

Publiceras från repots rot med GitHub Actions och GitHub Pages.

## Lokal prototyp

Öppna `index.html` i en modern webbläsare. Data sparas lokalt i webbläsaren; se **Inställningar** i appen för begränsningar.

## Google-inloggning och molnsynk

Firebase-projektet `fordonsmappen-af27a` är anslutet. Google-inloggning är aktiverad, GitHub Pages-domänen `d0ss3n.github.io` är godkänd och Cloud Firestore använder regionen `europe-north2` (Stockholm) på Spark-planen. Firestore-reglerna begränsar läsning och skrivning till dokument under användarens eget UID.

Webbkonfigurationen i `firebase-config.js` innehåller offentliga klientidentifierare och är avsedd att ingå i klientkoden. Vid första Google-inloggningen kopieras befintlig lokal fordonsdata till kontot om molnet saknar data. Därefter synkas fordonsdata och historik mellan användarens enheter. Bilagornas filinnehåll lagras för närvarande inte i molnet; appens befintliga dokumentfält innehåller bara den information som den redan sparar lokalt.