# Bronsinger Share

Öffentlicher, registrierungsfreier Dateiaustausch mit clientseitiger Ende-zu-Ende-Verschlüsselung und automatischem Ablauf.

## Sicherheitsmodell

Neue Übertragungen verwenden das versionierte Format `v1`:

- Der Browser erzeugt pro Übertragung einen zufälligen 256-Bit-Schlüssel.
- Der Schlüssel steht ausschließlich im URL-Fragment (`#v1.…`). URL-Fragmente werden bei HTTP-Anfragen nicht an den Server übertragen.
- Dateinamen, MIME-Typen und die optionale Notiz werden gemeinsam mit AES-256-GCM verschlüsselt.
- Dateien werden in 4-MiB-Blöcken mit AES-256-GCM verschlüsselt. Jeder Block besitzt einen 16-Byte-Authentifizierungstag.
- Jede Datei erhält eine zufällige 96-Bit-Nonce-Basis. Der jeweilige Blockindex wird zur Basis addiert, sodass innerhalb einer Datei kein Nonce wiederverwendet wird.
- Der Server speichert nur Chiffretext, verschlüsselte Metadaten, Dateianzahl, verschlüsselte und unverschlüsselte Größen sowie Ablauf- und Betriebsdaten.
- Downloads werden blockweise im Browser entschlüsselt und über einen Service Worker mit Backpressure direkt in den Browser-Download gestreamt.

Der unverschlüsselte Upload-Endpunkt ist deaktiviert. Bereits vorhandene ältere Freigaben ohne `encryption`-Eintrag im Manifest bleiben herunterladbar.

## Grenzen des Modells

- Wer den vollständigen Freigabelink besitzt, besitzt auch den Schlüssel und kann die Dateien lesen.
- Ein verlorener Schlüssel kann nicht wiederhergestellt werden.
- Der Server sieht weiterhin IP-Adressen auf Netzwerkebene, Zeitpunkte, Dateianzahl und Größen.
- Für Missbrauchsschutz wird die Client-IP mit einem lokalen geheimen Schlüssel pseudonymisiert. Die Rate-Limit-Dateien enthalten nicht die ursprüngliche IP-Adresse und werden nach Ablauf automatisch bereinigt.
- Die Webanwendung wird vom Server ausgeliefert. Ein künftig kompromittierter Server könnte verändertes JavaScript ausliefern. Deshalb gehören sichere Deployments, eine restriktive CSP, kontrollierte Abhängigkeiten und unabhängige Sicherheitsprüfungen zum Vertrauensmodell.
- Mehrere verschlüsselte Dateien werden derzeit einzeln heruntergeladen; der Server kann daraus mangels Schlüssel kein ZIP erstellen.

## Betrieb

Voraussetzung ist Node.js `>=22.13.0`.

```bash
npm ci
npm run typecheck
npm run lint
npm run build
npm start
```

Produktiv setzt `SHARED_ROOT` das Datenverzeichnis. Abgelaufene und verwaiste Übertragungen werden mit folgendem Befehl bereinigt:

```bash
npm run cleanup
```

Neue Uploads reservieren nicht mehr allein aufgrund der angekündigten Dateigröße den gesamten Speicher. Vor dem Start und vor jedem geschriebenen Block wird freier Speicher geprüft; 5 GiB bleiben als Sicherheitsreserve unberührt. Pro Client gelten höchstens zwei unvollständige Uploads, 20 GiB angekündigtes Datenvolumen pro 24 Stunden und begrenzte Parallelität. Unvollständige Uploads ohne Aktivität werden nach zwei Stunden gelöscht.

`SHARE_ADMIN_CODE` muss als lange, einzigartige Passphrase gesetzt werden. Admin-Anmeldeversuche werden persistent pro Client und global begrenzt. Die Session-Cookies sind `Secure`, `HttpOnly`, `SameSite=Strict`, auf den Host gebunden und zwei Stunden gültig.

Geprüfte, restriktive systemd-Units liegen unter `deploy/`. Ihre Installation benötigt Root-Rechte und ist in `deploy/README.md` beschrieben.

Nach einem Produktions-Build muss der laufende Next.js-Prozess neu gestartet werden, damit HTML und gehashte Assets aus demselben Build stammen.
