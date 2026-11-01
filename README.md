# Personal Assistant

A private, installable web app (PWA) for everyday tracking. Current modules:

- **Glucose**: log readings of every type (fasting, before/after each meal, snacks, bedtime, overnight, exercise, feeling low/high, random, plus your own types), in mg/dL or mmol/L, with optional insulin, carbs, medicine and notes. Trend chart with your target band, averages by reading type, time in range, lows/highs and estimated A1c.
- **Money**: accounts (cash, bank, card, mobile wallet, savings) each in its own currency; income, expenses and transfers (including between currencies); editable categories with monthly budgets; search and filters.
- **Reports**: daily report (glucose + money for any day, shareable as text) and monthly report (income vs expenses chart, category breakdown, budgets, glucose summary).

## Privacy and security

- No server and no account in the cloud. Everything is stored on your device in IndexedDB, **encrypted with AES-256-GCM**.
- The data key is protected by your username + password (PBKDF2-SHA256, 600,000 iterations).
- Optional **fingerprint / Face ID** unlock uses a passkey with the WebAuthn PRF extension, so biometrics actually decrypt the data rather than just hiding the screen (Android Chrome, iOS 18+ Safari, recent desktop browsers).
- Auto-lock after inactivity, increasing delay after wrong passwords, strict Content-Security-Policy, no third-party scripts or analytics.
- Backups are files encrypted with a separate backup password. CSV export is available for your doctor or spreadsheet.
- There is no password recovery: keep a backup.

## Hosting

Plain static files, no build step. Hosted for free with GitHub Pages from the `main` branch root.

To install on your phone: open the site, then **Android Chrome** ⋮ → *Add to Home screen* / *Install app*, or **iPhone Safari** Share → *Add to Home Screen*.

## Development

```
python3 -m http.server 8765
```
then open http://localhost:8765. Chart.js 4.4.7 (MIT) is vendored in `vendor/`.

This app is not a medical device. Follow your doctor's advice.
