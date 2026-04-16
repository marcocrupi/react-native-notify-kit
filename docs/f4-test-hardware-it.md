# Procedure di Test E2E su Hardware — F4

Procedure manuali per verificare l'intera pipeline di notifiche FCM su
dispositivi reali. Non automatizzate: devono essere eseguite da uno
sviluppatore con accesso fisico ai dispositivi.

## Prerequisiti

- Progetto Firebase con FCM abilitato (NotifyKitTest o equivalente)
- Chiave del service account in `./firebase-notifykittest.json` nella root del repo (mai committata)
- Smoke app installata sul dispositivo (`yarn smoke:android` / `yarn smoke:ios`)
- Token del dispositivo ottenuto dai log dell'app all'avvio

## Scenario A — Android (Pixel 9 Pro XL, Android 16)

### Configurazione iniziale

```bash
yarn smoke:android   # Deploy della smoke app
# Copiare il token dal logcat
adb logcat | grep "FCM Token"
```

### Test 1: `handleFcmMessage` locale

Premere il pulsante "Test handleFcmMessage" nella smoke app.
Risultato atteso: la notifica viene mostrata con titolo e corpo dal payload mock.

### Test 2: Push FCM reale (app in foreground)

```bash
yarn send:test:fcm <token> kitchen-sink
```

Risultato atteso: `onMessage` si attiva, `handleFcmMessage` viene eseguito,
la notifica viene mostrata con channelId, pressAction, stile BIG_TEXT.

### Test 3: Push FCM reale (app in background)

Mettere l'app in background, poi inviare:

```bash
yarn send:test:fcm <token> minimal
```

Risultato atteso: `setBackgroundMessageHandler` si attiva,
`handleFcmMessage` viene eseguito, la notifica appare.

### Test 4: Push FCM reale (app terminata)

Forzare l'arresto dell'app, poi inviare.
Risultato atteso: identico al background.

### Test 5: Tap sulla notifica

Toccare la notifica mostrata.
Risultato atteso: l'app si apre, `onForegroundEvent` si attiva con `EventType.PRESS`.

### Test 6: Pulsante azione

Inviare il payload kitchen-sink (contiene azioni). Toccare "Reply".
Risultato atteso: evento in background con action ID `reply`.

### Test 7: Immagine BIG_PICTURE

Mettere l'app in background o chiuderla, poi inviare:

```bash
yarn send:test:fcm <token> android-big-picture
```

Risultato atteso: la notifica appare con titolo e corpo; espandendola dal
drawer si vede l'immagine scaricata dall'URL remoto. Il bitmap viene
recuperato nativamente da `ResourceUtils.getImageBitmapFromUrl()` (timeout
10s). L'immagine è visibile solo quando la notifica è espansa.

## Scenario B — iOS (iPhone reale + NSE)

### Configurazione iniziale

```bash
npx react-native-notify-kit init-nse --ios-path apps/smoke/ios
cd apps/smoke/ios && pod install
# Aprire NotifeeExample.xcworkspace in Xcode
# Impostare il team di firma per entrambi i target:
#   NotifeeExample e NotifyKitNSE
# Build and run sul dispositivo
```

### Test 1: Push FCM reale (foreground)

```bash
yarn send:test:fcm <ios-token> kitchen-sink
```

Risultato atteso: `onMessage` si attiva, `handleFcmMessage` viene eseguito,
`displayNotification` crea un banner con suono.

### Test 2: Push FCM reale (background)

Mettere l'app in background, poi inviare.
Risultato atteso: NSE si attiva, `aps.alert` viene mostrato,
`notifee_options` elaborato da `NotifeeExtensionHelper`.
Suono personalizzato, thread-id, interruption-level rispettati.

### Test 3: Push FCM reale (app terminata)

Chiudere forzatamente l'app, poi inviare.
Risultato atteso: identico al background.

### Test 4: Allegati via NSE

Mettere l'app in background o chiuderla, poi inviare:

```bash
yarn send:test:fcm <ios-token> ios-attachment
```

Risultato atteso: NSE scarica e allega l'immagine.

### Test 5: Tap sulla notifica

Toccare la notifica.
Risultato atteso: l'app si avvia, l'evento di pressione si attiva.

### Debug NSE

Se l'NSE non si attiva:

1. Verificare che il payload contenga `mutable-content: 1` in `aps`
2. Aprire Console.app, filtrare per processo `NotifyKitNSE`
3. Controllare la firma Xcode: entrambi i target devono usare lo stesso team

### Pulizia post-test

```bash
git checkout apps/smoke/ios/
rm -rf apps/smoke/ios/NotifyKitNSE/
```

## Utilizzo di `yarn send:test:fcm`

```bash
# Installare le dipendenze del repo se non presenti
yarn install

# Se manca la build del server SDK
yarn build:rn:server

# Configurare la chiave del service account
# Scaricare da Firebase Console > Impostazioni progetto > Account di servizio
# Salvare come firebase-notifykittest.json nella root del repo

# Inviare notifica di test
yarn send:test:fcm <device-token> <scenario>

# Scenari disponibili: minimal | kitchen-sink | emoji | marketing | ios-attachment | android-big-picture
```

## Riepilogo Risultati Attesi

| Scenario          | Android            | iOS (foreground)   | iOS (background/terminata) |
| ----------------- | ------------------ | ------------------ | -------------------------- |
| Titolo/corpo      | da notifee_options | da notifee_options | da aps.alert + NSE         |
| channelId custom  | si                 | N/A                | N/A                        |
| Stile BIG_TEXT    | si                 | N/A                | N/A                        |
| Suono             | N/A                | da aps.sound       | da aps.sound               |
| Badge             | N/A                | da aps.badge       | da aps.badge               |
| Immagini/Allegati | via BIG_PICTURE    | via NSE            | via NSE                    |
| Evento pressione  | si                 | si                 | si (tap avvia l'app)       |

## Log Risultati Test

Compilare durante l'esecuzione:

| Test                       | Stato | Note |
| -------------------------- | ----- | ---- |
| A1 getFCMToken             |       |      |
| A2 FCM foreground          |       |      |
| A3 FCM background          |       |      |
| A4 FCM app terminata       |       |      |
| A5 Tap, evento PRESS       |       |      |
| A6 Pulsante azione         |       |      |
| A7 Campi notifee_options   |       |      |
| A8 Immagine BIG_PICTURE    |       |      |
| B0 CLI init-nse            |       |      |
| B1 pod install + build     |       |      |
| B2 getFCMToken (iOS)       |       |      |
| B3 FCM foreground (iOS)    |       |      |
| B4 FCM background (NSE)    |       |      |
| B5 FCM app terminata (NSE) |       |      |
| B6 Campi iOS (suono/badge) |       |      |
| B7 Tap, avvio app          |       |      |
| B8 Pulizia e ripristino    |       |      |
