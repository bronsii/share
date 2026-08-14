# Sendebude

Öffentlicher, registrierungsfreier Dateiaustausch mit clientseitiger Ende-zu-Ende-Verschlüsselung und automatischem Ablauf.

## Sicherheitsmodell

Neue Übertragungen verwenden das versionierte Format `v1`:

- Der Browser erzeugt pro Übertragung einen zufälligen 256-Bit-Schlüssel.
- Neue Transfer- und Datei-IDs besitzen 128 Zufallsbits. Ältere 20-stellige IDs bleiben aus Kompatibilitätsgründen gültig.
- Der Schlüssel steht ausschließlich im URL-Fragment (`#v1.…`). URL-Fragmente werden bei HTTP-Anfragen nicht an den Server übertragen.
- Dateinamen, MIME-Typen und die optionale Notiz werden gemeinsam mit AES-256-GCM verschlüsselt.
- Dateien werden in 4-MiB-Blöcken mit AES-256-GCM verschlüsselt. Jeder Block besitzt einen 16-Byte-Authentifizierungstag.
- Jede Datei erhält eine zufällige 96-Bit-Nonce-Basis. Der jeweilige Blockindex wird zur Basis addiert, sodass innerhalb einer Datei kein Nonce wiederverwendet wird.
- Der Server speichert nur Chiffretext, verschlüsselte Metadaten, Dateianzahl, verschlüsselte und unverschlüsselte Größen sowie Ablauf- und Betriebsdaten.
- Downloads werden blockweise im Browser entschlüsselt und über einen Service Worker mit Backpressure direkt in den Browser-Download gestreamt.

Der unverschlüsselte Upload-Endpunkt ist deaktiviert. Bereits vorhandene ältere Freigaben ohne `encryption`-Eintrag im Manifest bleiben herunterladbar.

## Bedienung

- Die Oberfläche wählt Deutsch oder Englisch anhand der Browsersprache und merkt sich einen manuellen Sprachwechsel im Browser.
- Ein laufender Upload kann pausiert und fortgesetzt werden. Nach einem versehentlichen Neuladen bleibt die verschlüsselte Sitzung im selben Browser-Tab erhalten; aus Sicherheitsgründen müssen dieselben lokalen Dateien erneut ausgewählt werden.
- Der Browser speichert für die Wiederaufnahme nur Sitzungskennung, Schlüsselmaterial, Nonce-Basen und Dateieigenschaften im `sessionStorage`. Die eigentlichen Dateien werden niemals im Browser-Speicher abgelegt.
- Eine verworfene Wiederaufnahme löscht die unvollständige Übertragung auch auf dem Server.

## Grenzen des Modells

- Wer den vollständigen Freigabelink besitzt, besitzt auch den Schlüssel und kann die Dateien lesen.
- Ein verlorener Schlüssel kann nicht wiederhergestellt werden.
- Der Server sieht weiterhin IP-Adressen auf Netzwerkebene, Zeitpunkte, Dateianzahl und Größen.
- Für Missbrauchsschutz wird die vom vertrauenswürdigen Reverse Proxy übermittelte Client-IP mit einem lokalen geheimen Schlüssel pseudonymisiert. Die Anwendung akzeptiert diese IP nur zusammen mit dem separaten `SHARE_PROXY_SECRET`; frei gesetzte Forwarding-Header werden nicht verwendet. Die Rate-Limit-Dateien enthalten nicht die ursprüngliche IP-Adresse und werden nach Ablauf automatisch bereinigt.
- Die Webanwendung wird vom Server ausgeliefert. Ein künftig kompromittierter Server könnte verändertes JavaScript ausliefern. Deshalb gehören sichere Deployments, eine restriktive CSP, kontrollierte Abhängigkeiten und unabhängige Sicherheitsprüfungen zum Vertrauensmodell.
- Mehrere verschlüsselte Dateien werden derzeit einzeln heruntergeladen; der Server kann daraus mangels Schlüssel kein ZIP erstellen.

## Betrieb

Voraussetzung ist Node.js `>=22.13.0`.

```bash
npm ci
npm run check
npm start
```

Produktiv setzt `SHARED_ROOT` das Datenverzeichnis. Abgelaufene und verwaiste Übertragungen werden mit folgendem Befehl bereinigt:

```bash
npm run cleanup
```

Der API-interne Aufräumweg und das Wartungsskript verwenden dieselbe getestete Bereinigungsroutine, damit ihre Regeln nicht auseinanderlaufen. Mit `npm run cleanup -- --dry-run` lässt sich vorab anzeigen, was entfernt würde.

Neue Uploads reservieren beim Start ihren noch benötigten Speicher. Die Reservierung schrumpft mit jedem geschriebenen Block; zusätzlich wird vor jedem Block der tatsächlich freie Speicher geprüft. 5 GiB bleiben als Sicherheitsreserve unberührt. Verschiedene Dateien dürfen parallel geschrieben werden, während ein Lock pro Zieldatei Offset-Races verhindert. Pro Client gelten höchstens zwei unvollständige Uploads, 20 GiB angekündigtes Datenvolumen pro 24 Stunden und begrenzte Parallelität. Unvollständige Uploads ohne Aktivität werden nach zwei Stunden gelöscht.

`SHARE_PROXY_SECRET` muss aus mindestens 32 zufälligen Zeichen bestehen und in Sendebude sowie Caddy identisch gesetzt sein. Fehlt das Geheimnis beim Produktionsstart, startet die systemd-Unit nicht. Fehlt der vertrauenswürdige Header oder unterscheidet sich das Geheimnis im laufenden Betrieb, verwirft Sendebude betroffene API-Anfragen, statt alle Clients still unter einem gemeinsamen Rate-Limit-Schlüssel zusammenzufassen. Der Produktionsdienst lauscht ausschließlich auf `127.0.0.1`; die App darf nicht direkt ins Internet exponiert werden.

`SHARE_ADMIN_CODE` muss als lange, einzigartige Passphrase gesetzt werden. Admin-Anmeldeversuche werden persistent pro Client und global begrenzt. Die Session-Cookies sind `Secure`, `HttpOnly`, `SameSite=Strict`, auf den Host gebunden und zwei Stunden gültig.

Geprüfte, restriktive systemd-Units liegen unter `deploy/`. Ihre Installation benötigt Root-Rechte und ist in `deploy/README.md` beschrieben.

Nach einem Produktions-Build muss der laufende Next.js-Prozess neu gestartet werden, damit HTML und gehashte Assets aus demselben Build stammen.

## Lizenz

Sendebude ist freie Software unter der [GNU Affero General Public License Version 3](LICENSE) (`AGPL-3.0-only`). Du darfst den Code verwenden, untersuchen, verändern und weitergeben. Wenn du eine veränderte Version über ein Netzwerk anbietest, musst du den Nutzern auch den dazugehörigen Quellcode unter derselben Lizenz zugänglich machen.
