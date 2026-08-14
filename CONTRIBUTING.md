# Zu Sendebude beitragen

Danke für dein Interesse an Sendebude. Kleine, klar abgegrenzte Änderungen lassen sich am einfachsten prüfen. Besprich größere Funktions- oder Architekturänderungen bitte zunächst in einem Issue.

## Lokale Entwicklung

Voraussetzung ist Node.js `>=22.13.0`.

```bash
npm ci
npm run dev
```

Für die normale lokale Entwicklung ist kein Reverse Proxy und kein `SHARE_PROXY_SECRET` erforderlich. Die Impressums- und Admin-Seiten benötigen bei einem lokalen Test zusätzliche Werte in einer nicht versionierten `.env.local`:

```dotenv
SHARE_ADMIN_CODE=<lange lokale Test-Passphrase>
SHARE_ADMIN_SESSION_SECRET=<mindestens 32 zufällige Zeichen>
SHARE_IMPRINT_NAME=Lokale Entwicklung
SHARE_IMPRINT_STREET=Teststraße 1
SHARE_IMPRINT_LOCALITY=00000 Testort
SHARE_IMPRINT_COUNTRY=Deutschland
SHARE_IMPRINT_EMAIL=dev@example.invalid
```

Verwende dort niemals produktive Geheimnisse oder echte personenbezogene Daten.

## Prüfungen

Führe vor einem Pull Request den vollständigen Check aus:

```bash
npm run check
```

Er umfasst Linting, TypeScript-Prüfung, automatisierte Tests, Integrationstests und den Produktions-Build. Neue oder geänderte Abläufe sollten durch passende Tests abgedeckt werden.

## Sichere Testdaten

- Verwende nur kleine, künstlich erzeugte Dateien und erfundene Metadaten.
- Veröffentliche niemals vollständige Freigabelinks; das Fragment nach `#` enthält den Entschlüsselungsschlüssel.
- Füge weder `.env*` noch Inhalte aus `shared/` zum Repository hinzu, auch nicht erzwungen mit `git add -f`.
- Zugangsdaten, Admin-Codes, private Adressen und Produktionsprotokolle gehören nicht in Commits, Issues oder Test-Fixtures.
- Melde Sicherheitsprobleme nach [SECURITY.md](SECURITY.md), nicht in einem öffentlichen Issue.

## Verschlüsselung und Speicherformat

Änderungen an Verschlüsselung, Nonce-Bildung, Schlüsselfragmenten, Service-Worker-Downloads oder den Dateien `manifest.json` und `upload.json` benötigen besondere Sorgfalt. Bestehende Freigaben dürfen nicht still unlesbar werden. Solche Pull Requests sollten:

- das Sicherheitsziel und die berührten Vertrauensgrenzen erklären,
- Formate explizit versionieren oder die Rückwärtskompatibilität belegen,
- Fehler-, Abbruch- und Wiederaufnahmefälle testen,
- die technische Dokumentation zusammen mit dem Code aktualisieren.

## Pull Requests

- Beschränke einen Pull Request möglichst auf ein Thema.
- Beschreibe Motivation, sichtbare Auswirkungen, Risiken und durchgeführte Tests.
- Halte deutsche und englische Oberflächentexte gemeinsam aktuell.
- Begründe neue Laufzeitabhängigkeiten und vermeide unabhängige Formatierungs- oder Aufräumänderungen.
- Führe keine Produktions-Deployments und keine Tests gegen echte Nutzerdaten als Teil eines Beitrags durch.

Mit einem Beitrag stimmst du zu, dass er unter der Projektlizenz `AGPL-3.0-only` veröffentlicht wird.
