# Zahln Mensa

One mensa payment flow on three surfaces, in one TypeScript monorepo:

| Surface | Where | Tech |
|---|---|---|
| **Student app** — pick a test user, scan the till QR, see mensa, items and *your* price, confirm with biometrics or PIN, see the result, history with details | `apps/mobile` | Expo SDK 58 · React Native 0.88 |
| **Till** (tablet) — ring up from the menu, show the QR, see “Paid”, refund in full or in part | `apps/mobile` (same app, cashier login) | Expo SDK 58 · React Native 0.88 |
| **Studierendenwerk dashboard** — daily totals per mensa and per till, payments that need attention, search with full history, CSV export | `apps/web` | React 19 · Vite |
| **Shared core** — API client, types, payment rules, idempotency, offline cache, German/English, CSV, hooks | `packages/core` | TypeScript |

**Dashboard:** https://zahln-mensa-dashboard.web.app — login `finance` / `test1234`
**Android APK:** attached to the GitHub release `v1.0.0` of this repository (`zahln-mensa-1.0.0.apk`).
**Design document:** [DESIGN.md](DESIGN.md) — architecture, payment states, releases, security, technology, API gaps.

## Test logins

All passwords are `test1234`.

| User | Surface |
|---|---|
| `student`, `staff`, `guest` | Student app — the same order costs a different amount for each |
| `cashier-campus-1/2/3`, `cashier-nord-1/2`, `cashier-bibliothek-1` | Till |
| `finance` | Dashboard |

## Try a payment

1. Install the APK on a tablet (or a second phone) and sign in as `cashier-campus-1`. Add a dish, tap **Ring up & show QR**.
2. Install it on a phone and sign in as `student`. Tap **Scan QR code** and point it at the till. (Scanning with the phone's own camera app works too: the QR is a `zahln://pay?order=…` link that opens the app.)
3. Check the amount and tap **Pay**. Confirm with your fingerprint, face or phone PIN. On a phone without a screen lock the app asks you to set a 4-digit app PIN.
4. The phone shows the result; the till switches to **Paid** on its own. **View payment** on the till lets the cashier refund part or all of it.
5. Open the dashboard as `finance` to see the payment in the day's totals and in the search, with its full history.

Language follows the device (German or English) and can be switched with **DE / EN** on every screen.

## Run it

Prerequisites: Node 20+ (22 used in CI), npm 10+. For the Android app: JDK 17+ and the Android SDK (Android Studio).

```bash
npm install                     # installs all workspaces
npm run typecheck               # core, web, mobile
npm test                        # unit and component tests
npm run test:coverage           # with coverage thresholds
```

**Dashboard**

```bash
npm run dev -w @zahln/web       # http://localhost:5173 (proxies /api to dev.zahln.de)
npm run test:e2e -w @zahln/web  # Playwright against the live test API
E2E_BASE_URL=https://zahln-mensa-dashboard.web.app npm run test:e2e -w @zahln/web
npm run deploy -w @zahln/web    # build + Firebase Hosting
```

**App and till**

```bash
cd apps/mobile
npx expo run:android            # development build on a connected device or emulator
npx expo prebuild --platform android --clean
cd android && ./gradlew assembleRelease   # → app/build/outputs/apk/release/app-release.apk
```

The release build is signed with the upload key from `~/.gradle/gradle.properties` (`ZAHLN_UPLOAD_*`) when present, otherwise with the debug key. Device flows for [Maestro](https://maestro.mobile.dev) are in `apps/mobile/e2e/`.

Configuration (optional): `EXPO_PUBLIC_API_BASE`, `EXPO_PUBLIC_CANDIDATE_ID` for the app; `VITE_API_BASE`, `VITE_CANDIDATE_ID` for the dashboard. Defaults: `https://dev.zahln.de` and `c_111437af73`.

## What I built — and how it keeps money safe

The full reasoning is in [DESIGN.md](DESIGN.md). In short:

* **No double charge.** Every money-moving request (ring up, pay, refund) has one Idempotency-Key per intent, written to durable storage *before* the request is sent and reused for every retry — including after the app is killed. A lost response is never treated as a failure: the app re-reads the order and follows the payment if it exists, otherwise says “unclear — paying again is safe”.
* **No false result.** “Paid” on the phone means our own payment is `confirmed`; “Paid” on the till means the order is `paid`. Pending stays pending (“please do not pay again”). Out-of-order responses never replace newer data (`version` guard). Expiry uses the server clock.
* **Resilience.** Retries with backoff and jitter for retryable errors, single-flight re-login on `401`, polling that never piles up requests, last-known data shown (and marked) when the server fails.
* **Remote switches.** `paymentsEnabled` and `minAppVersion` are read at start and again right before every payment.
* **Accessibility.** All controls have roles, labels and states for TalkBack; results are announced; touch targets are at least 48 dp; text scales with the system font size; the dashboard is keyboard-usable with a skip link, real buttons in table rows and proper table headers.
* **Low-end phones.** No navigation or state library, the till QR is one SVG path, lists are virtualised, polling slows down when a payment takes long.

### Tests

| Package | What | |
|---|---|---|
| `packages/core` | API client edge cases (retries, keys, 401, lost responses, aborts, problem parsing), pay rules and screen states, idempotency, cache, version guard, i18n completeness, CSV | Vitest |
| `apps/web` | Dashboard screens, auth and re-login, filters, export (capped, failed, cancelled), offline copy | Vitest + Testing Library |
| `apps/web/e2e` | Totals, attention, search, history, CSV download, German — against the **deployed** dashboard and the live API, desktop and phone sizes | Playwright |
| `apps/mobile` | App PIN (hashing, lockout), confirmation method | Vitest |
| `apps/mobile/e2e` | Till ring-up and a full payment on two emulators | Maestro |

### Tested on

| Device | What |
|---|---|
| POCO C71 (Unisoc T7250, Android 15) — a low-end phone | cold start ≈ 0.7 s, ≈ 72 MB memory, deep link to the pay screen, screen-reader labels on every control |
| POCO X3 (Android 12), no screen lock | camera scan of a real till QR, student price, app PIN set-up and confirm, **Paid** — confirmed on the server |
| Samsung Galaxy S22 Ultra (Android 16) | install and start |
| Pixel Tablet + Pixel phone emulators | full Maestro run: ring up → pay → till shows Paid → partial refund completes |

Testing on real phones found two bugs that are fixed: the language buttons were smaller than 48 dp, and with Android's edge-to-edge layout the PIN sheet sat behind the keyboard.

CI (`.github/workflows/ci.yml`) typechecks, runs all unit tests with coverage and builds the dashboard on every push.

## What I left out, and why

* **iOS build** — the code is cross-platform, but the brief asks for Android and I could not test on an iPhone.
* **Crash reporting** — designed (DESIGN.md §4, §7), not wired.
* **Push updates for the till** — needs an API change (DESIGN.md §6); polling is used instead.
* **Cancelling an abandoned order** — the API has no endpoint for it; this is the most important API gap (DESIGN.md §6.1).
* **Offline payments** — deliberately not built: queuing money moves offline would break “never show a result that is not true”.
* **React Native component tests** — the money rules live in `@zahln/core` and are unit-tested there; the screens are covered by device flows (Maestro) rather than by a second, mocked renderer.

## Important libraries

| Library | Why |
|---|---|
| `expo-sqlite/kv-store` | Synchronous, durable storage for Idempotency-Keys (must be on disk before a request leaves) and the offline cache |
| `expo-local-authentication` | System biometric prompt with the phone's own PIN as fallback |
| `expo-secure-store`, `expo-crypto` | Keystore-backed app PIN hash; secure random UUIDs for keys |
| `expo-camera` | QR scanning (ML Kit), QR codes only |
| `react-native-svg`, `qrcode` | Till QR drawn as a single SVG path |
| `expo-keep-awake`, `expo-haptics`, `expo-localization` | Till screen stays on; feedback on the result; device language |
| `react`, `vite` | Dashboard |
| `vitest`, `@testing-library/react`, `@playwright/test`, Maestro | Tests |

## AI tools used

* **Claude (Anthropic)** — used throughout as a pair programmer: reading the brief and the OpenAPI spec, scaffolding the monorepo, writing and refactoring code and tests, running the builds and test suites, and drafting this README and the design document. I reviewed and steered the decisions (scope, the shared-core split, the payment rules, what to leave out) and tested the flows.
* **Google Stitch** — used to explore the visual direction (anthracite and gold) for an earlier web prototype of the screens.

## Repository layout

```
packages/core/        shared TypeScript: client, endpoints, types, payFlow, idempotency, cache, i18n, csv, react hooks
apps/mobile/          Expo app — student app and till (role decides), e2e/ Maestro flows
apps/web/             React dashboard, e2e/ Playwright, firebase.json
DESIGN.md             design document
```
