# Validierung – 7. September 2026

Geprüft wurde der lokale Änderungssatz für Upload-Wiederholungen, freiwillig gemerkte Freigaben und Betriebsübersicht auf Basis von `9a7b995`. Die Prüfungen liefen ausschließlich mit Wegwerfdateien in getrennten Testverzeichnissen; die produktive Installation wurde nicht ersetzt.

| Prüfung | Ergebnis |
| --- | --- |
| Neuinstallation der Abhängigkeiten | `npm ci` erfolgreich; lokaler Audit meldete keine bekannten Abhängigkeitslücken |
| ESLint, TypeScript und Produktions-Build | erfolgreich unter Windows und Debian |
| Unit-Tests | 52 bestanden |
| Integrationstests | 4 bestanden unter Windows und Debian |
| Chromium / Windows | Browserablauf einschließlich Wiederholung, lokaler Liste, Downloads, Verwaltung und Fehlerbehandlung bestanden |
| Firefox / Debian | derselbe Browserablauf bestanden |
| WebKit / Windows | derselbe Browserablauf bestanden; Einzel-Dateiname nutzt den ASCII-Fallback, UTF-8-Namen im ZIP unverändert |
| 5-GiB-Grenzfall / Chromium / Debian | 5120 MiB insgesamt: `large.bin` mit 5 GiB minus einem Byte plus `marker.txt` mit einem Byte; Upload, Einzel-Download und ZIP bestanden |

Der Großdateilauf dauerte insgesamt rund 552 Sekunden, davon 427 Sekunden Upload. SHA-256 des Einzel-Downloads und Größe, CRC, Dateinamen sowie SHA-256 des unabhängig mit Python entpackten ZIP-Inhalts stimmten. Das ist ein Loopback-Test, keine Messung der öffentlichen Instanz oder einer Internetleitung. Der reguläre Browserlauf überspringt den Großdateitest ohne explizite Größenvariable.

Die Upload-Prüfungen umfassen unter anderem verlorene erfolgreiche Blockantworten, 503/Retry-After, unverändertes verschlüsseltes Wiederholen, Pause und Abbruch während Wartezeiten, langsam fortschreitende Übertragungen, fehlende Sitzungen und verlorene Abschlussantworten. Die Verwaltung wurde bei 390 px auf Überlauf und nach einer simulierten 503-Antwort auf erneute Bedienbarkeit geprüft.

## Grenzen und offene Geräteprüfung

- Kein echter iPhone-/iPad-/Android-Test durchgeführt; siehe [Geräte-Checkliste](RELEASE-CHECKS.md).
- Firefox ließ sich in dieser Windows-Testumgebung nicht starten; deshalb erfolgte seine Prüfung auf Debian.
- Dem Debian-Testhost fehlen Systembibliotheken für Playwright-WebKit. Dieser Browser wurde deshalb unter Windows geprüft; das ersetzt keine Safari-Freigabe.
- Der Windows-WebKit-Port speichert beispielsweise `Prüfung.bin` als `Pr_fung.bin`. Der Test verlangt ausdrücklich diesen bekannten ASCII-Fallback; Dateiinhalte und ZIP-Namen werden weiterhin exakt geprüft.
- Eine Browserwarnung vor dem Schließen ist besonders auf Mobilgeräten nicht garantiert. Ältere Upload-Wiederaufnahmen ohne privaten Verwaltungsschlüssel können nach einem gleichzeitigen Abschluss nur über Ablauf/Bereinigung entfernt werden.
- Testerfolg ist kein unabhängiges Sicherheits- oder Kryptografie-Audit. GitHub-CI und produktives Deployment dieses Änderungssatzes sind separate Schritte.
