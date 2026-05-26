# Firebase Notes

Project ID: `clicksprint-a3028`

The app expects `firebase-config.js` to define:

```js
window.CLICKSPRINT_FIREBASE_CONFIG = {
  projectId: "clicksprint-a3028",
  apiKey: "YOUR_WEB_API_KEY"
};
```

To get the API key, create or open a Firebase Web App in the Firebase console, then copy the `apiKey` from the Firebase SDK config.

Firestore collection:

- `leaderboard`

Stored fields:

- `name` string, 1-18 chars
- `timeMs` integer race time in milliseconds
- `topSpeedCps` number, fastest 10m split converted to clicks per second
- `reactionMs` integer reaction time in milliseconds
- `createdAt` timestamp

Rules are in `firestore.rules`. With Firebase CLI auth configured, deploy them with:

```sh
npx firebase-tools deploy --only firestore:rules --project clicksprint-a3028
```

If the submit form says Firebase config is missing, fill in `firebase-config.js`. If Firebase rejects writes, deploy `firestore.rules` and confirm Firestore is enabled in Native mode.
