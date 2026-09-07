# Browser- und Geräteprüfung

Tests ausschließlich mit Wegwerfdateien ohne private Inhalte durchführen. Die automatischen Tests verwenden eigene Datenverzeichnisse und Loopback-Adressen. Niemals `SHARED_ROOT` auf produktive Uploads setzen oder Lasttests ungefragt gegen sendebude.de starten.

## Automatisch

1. `npm ci` und `npm run check`.
2. `npx playwright install --with-deps chromium firefox webkit`, danach `npm run test:browser`.
3. Großdateien zusätzlich: `TEST_LARGE_FILE_MIB=1024 TEST_BROWSERS=chromium npm run test:browser`; für den Grenzfall `5120` (5 GiB). PowerShell: `$env:TEST_LARGE_FILE_MIB='1024'; $env:TEST_BROWSERS='chromium'; npm run test:browser`. Danach Testvariablen wieder entfernen.
4. Vorher ausreichend Platz prüfen: Quelldatei, verschlüsselte Datei sowie Einzel- und ZIP-Download benötigen zusammen gut die vierfache Testdateigröße, zusätzlich mindestens 5 GiB Serverreserve. Wiederholungen pro Browser laufen nacheinander. Der Test ist ohne Größenvariable sichtbar übersprungen, nicht bestanden.

Der Test liest Quelle und Downloads stückweise. Python prüft ZIP-Verzeichnis, Originalgröße, CRC und SHA-256 des entpackten Inhalts ohne die gesamte Datei in den Arbeitsspeicher zu laden. Gemessene Loopback-Übertragungszeiten sind keine Aussage über Internet-, WLAN- oder Mobilfunkgeschwindigkeit. Ein Großdateilauf in Chromium beweist nichts über Safari oder Firefox.

## Echte Geräte – separat protokollieren

Playwright-WebKit und ein schmales Desktopfenster ersetzen **kein echtes iPhone**. Für eine mobile Freigabe mindestens Safari auf iPhone/iPad sowie Chrome auf Android prüfen und Gerät, OS, Browser-Version, Dateigröße, Netzart und Ergebnis notieren. Ohne verfügbares Gerät bleibt dieser Abschnitt offen.

- Datei aus der Dateien-App auswählen, Nutzungsbedingungen bestätigen, hochladen. Keine automatische Freigabenspeicherung erwarten.
- Kurz WLAN/Netz trennen und wieder einschalten: begrenzte Wiederholung oder verständliche Pause, keine beschädigte Datei.
- Während einer Wiederholung Pause drücken, wieder fortsetzen; einzelne Datei über ihren Papierkorb entfernen, übrige Dateien weiterladen lassen. Gesamtabbruch am unteren Papierkorb erst nach Bestätigung.
- Tab schließen/neuladen und App in den Hintergrund legen; mögliche Betriebssystemunterbrechung festhalten. Eine `beforeunload`-Warnung ist auf Mobilgeräten nicht garantiert.
- Nach Neuladen dieselben unveränderten Quelldateien erneut auswählen und fortsetzen; andere Dateinamen/Größen müssen abgelehnt werden.
- Einzeldatei und ZIP wirklich in „Dateien“ bzw. „Downloads“ speichern, öffnen und Inhalt/Größe prüfen. Nicht nur den grünen Fortschrittsstatus beobachten.
- „Auf diesem Gerät merken“ ausdrücklich wählen, Startseite neu öffnen; Liste darf nur freiwillig gespeicherte Einträge zeigen. „Nur lokal entfernen“ darf die Serverfreigabe nicht löschen.
- Privaten Löschlink öffnen: noch keine Löschung. Erst nach Bestätigung verschwindet die Freigabe; normaler Empfängerlink berechtigt nicht dazu.
- Lange Namen, 20 Dateien, 390 px/320 px Ansicht, Bildschirmtastatur und Hoch-/Querformat prüfen. Keine überlaufenden Aktionen, ausreichend große Touchziele.

## Verwaltung und Betrieb

- Ohne Admin-Sitzung kein Zugriff auf Dateien oder Betriebsdaten.
- Geplante Bereinigung: Status aus tatsächlicher `share-cleanup.service` prüfen; kein Test-Heartbeat in produktive Daten schreiben.
- Freie und reservierte Bytes sind unterschiedliche Werte: Reservierungen sind zugesagte zukünftige Schreibmengen, nicht doppelt belegter Speicher.
- Netzwerkfehler bei Anmeldung/Aktualisierung müssen die Oberfläche wieder bedienbar lassen. Fehler nie als gesunden Status darstellen.
- Dashboard ist eine Momentaufnahme mit Zeitstempel. Warnungen kommen nur dort; keine E-Mail, kein Telegram und keine Hintergrundüberwachung bei ausgefallener App.
