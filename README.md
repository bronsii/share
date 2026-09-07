# Sendebude

Registrierungsfreier Dateiaustausch mit clientseitiger Ende-zu-Ende-Verschlüsselung, fortsetzbaren Uploads und automatischem Ablauf.

- [Sendebude ausprobieren](https://sendebude.de)
- [Quellcode auf GitHub](https://github.com/bronsii/share)
- [Nutzungsbedingungen](https://sendebude.de/nutzungsbedingungen)

Pro Übertragung sind bis zu 20 Dateien mit zusammen höchstens 5 GiB und einer Laufzeit von 1, 3 oder 7 Tagen möglich. Die Oberfläche ist auf Deutsch und Englisch verfügbar.

## Teilen und herunterladen

- Beschriftete Download-Schaltflächen zeigen Vorbereitung, Fortschritt, Fehler und die Übergabe an den Browser an. Ob die Datei tatsächlich gespeichert wurde, bestätigt der Download-Bereich des Browsers.
- Mehrere verschlüsselte Dateien können gemeinsam als ZIP64-Archiv heruntergeladen werden. Entschlüsselung und ZIP-Erstellung geschehen blockweise auf dem Empfängergerät, nicht auf dem Server. Die Dateien werden nicht zusätzlich komprimiert. Gleichnamige Dateien bekommen eindeutige ZIP-Namen.
- Der QR-Code der Upload-Bestätigung wird ausschließlich lokal erzeugt. Er enthält den vollständigen Empfängerlink einschließlich Entschlüsselungsschlüssel. Jeder mit diesem QR-Code kann die Freigabe lesen.
- Zusätzlich erhält der Absender bei neuen Uploads einen unabhängigen privaten Löschlink. Diesen vor dem Verlassen der Bestätigung selbst aufbewahren und nicht an Empfänger weitergeben. Öffnen allein löscht nichts; die Löschung muss bestätigt werden. Bereits gespeicherte Kopien oder laufende Downloads können nicht zurückgerufen werden.
- Relative Restlaufzeit und das genaue Ablaufdatum werden gemeinsam angezeigt.

Der Löschlink enthält eine eigene zufällige 256-Bit-Berechtigung im Fragment `#m1.…`, unabhängig vom `#v1.…`-Dateischlüssel. Bei der Upload-Erstellung wird nur deren SHA-256-Hash gespeichert. Erst die explizite Löschanfrage übermittelt die Berechtigung in einem Authorization-Header über HTTPS; die API prüft Ursprung, Rate-Limit und Hash mit zeitkonstantem Vergleich. Empfänger erhalten weder Berechtigung noch Hash. Verlorene Löschlinks können nicht wiederhergestellt werden; ältere Freigaben ohne Hash laufen weiterhin regulär ab. Die private Löschseite ist von Suchmaschinen ausgeschlossen.

## Architektur und Datenfluss

```text
Upload:   Datei -> AES-GCM im Browser -> HTTPS -> Reverse Proxy -> Sendebude -> Chiffretext
Freigabe: vollständiger Link mit #v1-Schlüssel ---------------------> Empfängerbrowser
Download: Chiffretext <- HTTPS <- Sendebude; Entschlüsselung im Browser -> lokale Datei
```

Der Server erhält den Schlüssel im URL-Fragment nicht. Er liefert jedoch die Webanwendung aus und bleibt damit Teil des Vertrauensmodells.

## Sicherheitsmodell

Neue Übertragungen verwenden das versionierte Format `v1`:

- Der Browser erzeugt pro Übertragung einen zufälligen 256-Bit-Schlüssel.
- Neue Transfer- und Datei-IDs besitzen 128 Zufallsbits. Ältere 20-stellige IDs bleiben aus Kompatibilitätsgründen gültig.
- Der Schlüssel wird im Freigabelink als URL-Fragment (`#v1.…`) übertragen. URL-Fragmente werden bei HTTP-Anfragen nicht an den Server gesendet.
- Dateinamen, MIME-Typen und die optionale Notiz werden gemeinsam mit AES-256-GCM verschlüsselt.
- Dateien werden in 4-MiB-Blöcken mit AES-256-GCM verschlüsselt. Jeder Block besitzt einen 16-Byte-Authentifizierungstag.
- Jede Datei erhält eine zufällige 96-Bit-Nonce-Basis. Der jeweilige Blockindex wird zur Basis addiert, sodass innerhalb einer Datei kein Nonce wiederverwendet wird.
- Der Server speichert Chiffretext, verschlüsselte Metadaten, Dateianzahl, verschlüsselte und unverschlüsselte Größen, Fassung, Sprache und Bestätigungszeitpunkt der akzeptierten Nutzungsbedingungen sowie Ablauf- und Betriebsdaten. Die Zustimmungsangaben werden zusammen mit der Übertragung gelöscht.
- Downloads werden blockweise im Browser entschlüsselt und über einen Service Worker mit Backpressure direkt in den Browser-Download gestreamt.

Der unverschlüsselte Upload-Endpunkt ist deaktiviert. Bereits vorhandene ältere Freigaben ohne `encryption`-Eintrag im Manifest bleiben herunterladbar.

## Wiederaufnahme von Uploads

Kurze Verbindungsfehler bei Dateiabschnitten, Statusabfragen und Abschluss werden bis zu viermal automatisch wiederholt (1, 2, 4, 8 Sekunden Abstand; ein längeres `Retry-After` wird berücksichtigt). Nach einer unklaren Blockantwort wird zuerst der bestätigte Serveroffset abgefragt. Nur ein noch nicht gespeicherter Block wird mit denselben verschlüsselten Bytes erneut gesendet. Berechtigungs-, Ablauf-, Größen- und Speicherfehler sowie Wartezeiten über 60 Sekunden pausieren den Upload ohne weitere automatische Versuche. Pause, Einzeldatei-Abbruch und Gesamtabbruch stoppen auch laufende Wartezeiten.

Ein unfertiger oder pausierter Upload aktiviert die browserseitige Warnung beim Verlassen der Seite. Der Browser bestimmt den Dialogtext und kann die Warnung insbesondere auf Mobilgeräten unterdrücken; sie ist kein Schutz vor beendetem Browserprozess oder ausgeschaltetem Gerät. Der Gesamtabbruch verlangt eine Bestätigung.

Ein Upload kann pausiert und im selben Browser-Tab nach einem Neuladen fortgesetzt werden. Dafür speichert der Browser vorübergehend im `sessionStorage`:

- Sitzungs-, Transfer- und Datei-IDs sowie Ablauf- und Größenangaben,
- Schlüsselmaterial, Nonce-Basen und bei neuen Uploads die separate Löschberechtigung,
- Dateinamen, Größen und Änderungszeitpunkte der ausgewählten lokalen Dateien,
- gewählte Laufzeit und optionale Notiz.

Diese Angaben sind tablokal; Dateiname und Notiz liegen dort im Klartext. Die eigentlichen Dateiinhalte werden nicht im Browser-Speicher abgelegt. Zur Wiederaufnahme müssen dieselben lokalen Dateien erneut ausgewählt werden.

Beim Verwerfen einer Wiederaufnahme löscht der Browser seine lokalen Angaben und versucht, den unvollständigen Upload sofort auf dem Server zu entfernen. Schlägt diese Anfrage beispielsweise wegen einer unterbrochenen Verbindung fehl, übernimmt die automatische Bereinigung die spätere Löschung.

## Freigaben auf dem eigenen Gerät merken

Nach einem erfolgreichen Upload lässt sich **diese einzelne Freigabe ausdrücklich merken**. Ohne diesen Klick wird keine lokale Freigabenliste angelegt. Höchstens fünf Einträge mit Freigabelink einschließlich Schlüssel, privatem Löschlink und Zeitangaben werden im `localStorage` dieses Browserprofils gespeichert – keine Dateien, Dateinamen oder Notizen. Es gibt kein Konto und keine Synchronisierung auf andere Geräte.

Wer Zugriff auf das Browserprofil hat, kann die gemerkten Freigaben öffnen und löschen. Auf gemeinsam genutzten Geräten sollte diese Funktion deshalb nicht verwendet werden. Ablaufprüfung und Entfernung geschehen lokal beim Seitenbesuch und während die Seite geöffnet ist, nicht bei geschlossenem Browser. „Nur lokal entfernen“ entfernt ausschließlich den Listeneintrag; „Vom Server löschen …“ öffnet die bestehende private Löschseite mit separater Bestätigung. Die Liste führt keine Hintergrundabfragen der Freigaben aus; anderweitig gelöschte Freigaben können deshalb noch angezeigt werden.

## Grenzen des Modells

- Wer den vollständigen Freigabelink besitzt, besitzt auch den Schlüssel und kann die Dateien lesen. Ein verlorener Schlüssel kann nicht wiederhergestellt werden.
- Der Server sieht weiterhin IP-Adressen auf Netzwerkebene, Zeitpunkte, Dateianzahl und Größen. Für Missbrauchsschutz wird die vom vertrauenswürdigen Reverse Proxy übermittelte Client-IP mit einem lokalen geheimen Schlüssel pseudonymisiert.
- Die Webanwendung wird vom Server ausgeliefert. Ein kompromittierter Server könnte verändertes JavaScript ausliefern.
- Ende-zu-Ende-Verschlüsselung verhindert eine serverseitige Schadsoftwareprüfung. Empfänger sollten nur Dateien aus vertrauenswürdigen Quellen öffnen.
- Für dieses Repository ist derzeit kein unabhängiges Kryptografie- oder Sicherheits-Audit dokumentiert.
- Das serverseitige Limit von 5 GiB garantiert nicht, dass jeder Browser und jedes Gerät eine so große Datei zuverlässig verarbeiten kann. Erforderlich sind insbesondere Web Crypto, Service Worker und Streaming-Schnittstellen.
- Der Server kann mangels Schlüssel kein entschlüsseltes ZIP erstellen. Der Sammeldownload läuft im Browser; die Seite muss bis zum Abschluss geöffnet bleiben. Browser- oder Betriebssystemgrenzen und ausreichend freier Gerätespeicher gelten weiterhin.

Sichere Deployments, eine restriktive CSP, kontrollierte Abhängigkeiten und unabhängige Prüfungen gehören deshalb zum Vertrauensmodell.

## Lokale Entwicklung

Voraussetzung ist Node.js `>=22.13.0`.

```bash
npm ci
npm run dev
```

Die Startseite und Uploads funktionieren im Entwicklungsmodus ohne Reverse Proxy. Für das Impressum werden die fünf `SHARE_IMPRINT_*`-Werte benötigt, für die Verwaltung `SHARE_ADMIN_CODE` und `SHARE_ADMIN_SESSION_SECRET`. Entwicklungswerte dürfen nie als Produktionsgeheimnisse wiederverwendet werden.

## Tests

```bash
npm run check
```

Der Befehl führt ESLint, TypeScript-Prüfung, Unit- und Integrationstests sowie den Produktions-Build aus.

Die ZIP-Tests verwenden zusätzlich Python 3 als unabhängigen ZIP-Leser. Für echte Browser-Tests (Chromium, Firefox, WebKit) werden Python 3, OpenSSL und die Playwright-Browser mit ihren Systembibliotheken benötigt:

```bash
npx playwright install --with-deps chromium firefox webkit
npm run build
npm run test:browser
```

Die Browser-Tests verwenden einen isolierten HTTPS-Testproxy und eigene kurzlebige Testdaten unter `work/`, niemals produktive Freigaben. Geprüft werden Upload und Verschlüsselung, QR-Inhalt einschließlich Fragment, Einzel- und ZIP-Downloads samt Dateiinhalten, Fehler/Wiederholung, Abbruch, schmale Ansichten und bestätigte Löschung. `TEST_BROWSERS=chromium,firefox npm run test:browser` beschränkt einen lokalen Lauf; nicht ausgeführte Browser sind damit nicht geprüft. Playwright-WebKit ersetzt keinen Test auf einem echten iPhone. Der normale Lauf prüft die 5-GiB-Grenze nur strukturell im ZIP64-Header; ein tatsächlicher Großdateilauf muss separat aktiviert werden. Der Windows-WebKit-Port verwendet beim Einzel-Download den ASCII-Ersatznamen aus `Content-Disposition` (z. B. `Pr_fung.bin`); der Test prüft diesen explizit, während die ZIP-Einträge ihre UTF-8-Namen behalten müssen.

Zusätzlich prüfen die normalen Browsertests einen künstlichen 503-Fehler, eine verlorene erfolgreiche Blockantwort, opt-in Speicherung und Tab-Synchronisierung sowie die Entfernung nach bestätigter Serverlöschung. Ein optionaler Großdateitest erzeugt eine echte Datei auf der Platte, lädt sie verschlüsselt hoch und prüft den Einzel- und ZIP-Download mit SHA-256 und einem unabhängigen Python-ZIP-Leser, jeweils mit begrenztem Prüfspeicher:

```bash
TEST_LARGE_FILE_MIB=1024 TEST_BROWSERS=chromium npm run test:browser
# Bis einschließlich 5120 MiB (5 GiB); ausreichend freien Testplattenspeicher einplanen.
```

Ohne `TEST_LARGE_FILE_MIB` wird der zusätzliche Großdateitest ausdrücklich übersprungen. Eine browser- und gerätespezifische Freigabeprüfung steht in [docs/RELEASE-CHECKS.md](docs/RELEASE-CHECKS.md). Unter Windows können `TEST_PYTHON` und `TEST_OPENSSL` die ausführbaren Dateien explizit festlegen.

## Konfiguration

| Variable | Produktion | Zweck |
| --- | --- | --- |
| `SHARED_ROOT` | optional | Lokales Datenverzeichnis; Standard ist `./shared`. |
| `SHARE_PROXY_SECRET` | erforderlich | Mindestens 32 zufällige Zeichen; muss in Anwendung und Reverse Proxy identisch sein. |
| `SHARE_ADMIN_CODE` | erforderlich | Einzigartige Admin-Passphrase mit mindestens 16 Zeichen; eine deutlich längere Passphrase wird empfohlen. |
| `SHARE_ADMIN_SESSION_SECRET` | erforderlich | Mindestens 32 zufällige Zeichen zum Signieren der Admin-Sitzungen. |
| `SHARE_IMPRINT_NAME` | erforderlich | Öffentlich angezeigter Name im Impressum. |
| `SHARE_IMPRINT_STREET` | erforderlich | Öffentlich angezeigte Straße und Hausnummer. |
| `SHARE_IMPRINT_LOCALITY` | erforderlich | Öffentlich angezeigte Postleitzahl und Ort. |
| `SHARE_IMPRINT_COUNTRY` | erforderlich | Öffentlich angezeigtes Land. |
| `SHARE_IMPRINT_EMAIL` | erforderlich | Öffentlich angezeigte, gültige Kontaktadresse. |

Geheimnisse und personenbezogene Angaben gehören nicht ins Repository. Das Referenzdeployment liest sie aus geschützten Dateien unter `/etc`.

## Produktivbetrieb

Die geprüften Caddy- und systemd-Beispiele sowie Installation, Secret-Erzeugung und Prüfkommandos stehen in [deploy/README.md](deploy/README.md). Nach jedem Produktions-Build muss der laufende Next.js-Prozess neu gestartet werden, damit HTML und gehashte Assets aus demselben Build stammen.

Für den aktuellen Stand gelten folgende Betriebsgrenzen:

- Sendebude darf nur als **eine Node.js-Instanz** betrieben werden. Sperren, Admission Queue und Parallelitätszähler sind pro Prozess; mehrere Worker oder Hosts dürfen nicht dasselbe Datenverzeichnis verwenden.
- `SHARED_ROOT` muss auf einem lokalen POSIX-Dateisystem liegen, das atomare Umbenennungen und freie-Speicher-Abfragen unterstützt. Objekt- oder gemeinsam genutzter Netzwerkspeicher ist nicht unterstützt.
- Der Produktionsdienst lauscht ausschließlich auf `127.0.0.1` und darf nicht direkt ins Internet exponiert werden. Ein vertrauenswürdiger Reverse Proxy muss Client-IP und `SHARE_PROXY_SECRET` wie im Referenzdeployment setzen.
- Die mitgelieferte systemd-Unit verweigert den Start bei fehlenden oder zu kurzen Geheimnissen. Admin-Anmeldeversuche werden persistent begrenzt; die Verwaltung liegt unter `/verwaltung`.

Neue Uploads reservieren ihren noch benötigten Speicher. Die Reservierung schrumpft mit jedem geschriebenen Block; vor jedem Block wird außerdem der tatsächlich freie Speicher geprüft. 5 GiB bleiben als Sicherheitsreserve unberührt. Pro Client gelten höchstens zwei unvollständige Uploads, 20 GiB angekündigtes Datenvolumen pro 24 Stunden und begrenzte Parallelität.

Abgelaufene Freigaben und unvollständige Uploads ohne Aktivität werden durch dieselbe getestete Routine in API und Wartungsskript bereinigt:

```bash
npm run cleanup -- --dry-run
npm run cleanup
```

Das Referenzdeployment startet die Bereinigung alle 15 Minuten mit bis zu 60 Sekunden Zufallsverzögerung. Bei gesundem Timer können abgelaufene Dateien daher noch rund 16 Minuten physisch vorhanden sein. Das Datenverzeichnis sollte von langlebigen Backups ausgeschlossen werden; andernfalls dürfen Backups die zugesagten Löschfristen nicht verlängern.

Die private Verwaltung zeigt eine manuell aktualisierbare Momentaufnahme von freiem Speicher, noch reservierten Upload-Bytes, unvollständigen Uploads und dem letzten erfolgreichen geplanten Bereinigungslauf. Warnungen erscheinen nur dort, ohne externe Nachrichten. Unter 10 GiB freiem Speicher wird gewarnt; die Upload-Sicherheitsreserve bleibt 5 GiB. Der geplante Lauf schreibt mit `--scheduled` atomar eine reine Betriebsstatusdatei unter `shared/.operations/cleanup.json`. Fehlt sie, ist sie fehlerhaft oder liegt der letzte Erfolg mehr als 45 Minuten zurück, zeigt die Verwaltung eine Warnung. Manuelle Läufe, Trockenläufe und API-Bereinigungen zählen nicht als erfolgreicher Timerlauf. Beim Update auch `deploy/share-cleanup.service` übernehmen; ohne `--scheduled` bleibt der Status unbekannt. Eine nicht erreichbare Anwendung kann selbst keine Warnung anzeigen; eine externe Überwachung ist hier bewusst nicht eingerichtet.

Domain, GitHub-Link, Impressum und Aussagen zum Hostingstandort beschreiben die öffentliche Instanz `sendebude.de`. Betreiber eines Forks müssen diese Angaben an ihren tatsächlichen Betrieb und den zugehörigen Quellcode anpassen.

## Mitwirken und Sicherheitsmeldungen

Hinweise für Beiträge stehen in [CONTRIBUTING.md](CONTRIBUTING.md). Sicherheitsprobleme bitte nicht als öffentliches Issue melden, sondern den privaten Weg aus [SECURITY.md](SECURITY.md) verwenden.

## Lizenz

Sendebude ist freie Software unter der [GNU Affero General Public License Version 3](LICENSE) (`AGPL-3.0-only`). Du darfst den Code verwenden, untersuchen, verändern und weitergeben. Wenn du eine veränderte Version über ein Netzwerk anbietest, musst du den Nutzern auch den dazugehörigen Quellcode unter derselben Lizenz zugänglich machen.
