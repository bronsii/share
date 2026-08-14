# Produktivbetrieb mit systemd

Die Units erwarten die Anwendung unter `/srv/apps/share`, das Laufzeitverzeichnis unter `/srv/apps/share/shared` und Node unter `/opt/node/bin/node`. Falls Node an einem anderen Ort liegt, müssen `ExecStart` der App-Unit und der Cleanup-Unit vor der Installation angepasst werden.

## Anwendung bauen

```bash
cd /srv/apps/share
npm ci
npm run check
```

`npm run check` führt Lint, TypeScript, Tests und zuletzt den Produktions-Build aus.

## Geheimnisse einmalig anlegen

Die folgenden Befehle erzeugen eine starke Admin-Passphrase sowie getrennte Geheimnisse für Admin-Sitzungen und den Reverse Proxy. Den ausgegebenen Admin-Code nur an einem sicheren Ort aufbewahren. Dieser Abschnitt ist nicht für normale Updates gedacht.

```bash
admin_code="$(openssl rand -base64 24 | tr -d '\n')"
admin_session_secret="$(openssl rand -hex 32)"
proxy_secret="$(openssl rand -hex 32)"

sudo install -o root -g root -m 0600 /dev/null /etc/share-admin.env
sudo install -o root -g root -m 0600 /dev/null /etc/share-proxy.env
printf 'SHARE_ADMIN_CODE=%s\nSHARE_ADMIN_SESSION_SECRET=%s\n' "$admin_code" "$admin_session_secret" | sudo tee /etc/share-admin.env >/dev/null
printf 'SHARE_PROXY_SECRET=%s\n' "$proxy_secret" | sudo tee /etc/share-proxy.env >/dev/null
printf 'Admin-Code: %s\n' "$admin_code"
unset admin_code admin_session_secret proxy_secret
```

## Impressumsdaten einmalig anlegen

Die öffentlich angezeigten Impressumsdaten liegen ausschließlich in einer geschützten Serverdatei und nicht im Repository. Zuerst die Datei sicher anlegen und anschließend mit `sudoedit` befüllen:

```bash
sudo install -o root -g root -m 0600 /dev/null /etc/share-imprint.env
sudoedit /etc/share-imprint.env
```

Erforderliches Format:

```dotenv
SHARE_IMPRINT_NAME=<Name>
SHARE_IMPRINT_STREET=<Straße und Hausnummer>
SHARE_IMPRINT_LOCALITY=<Postleitzahl und Ort>
SHARE_IMPRINT_COUNTRY=<Land>
SHARE_IMPRINT_EMAIL=<Kontaktadresse>
```

Keine dieser Variablen darf mit `NEXT_PUBLIC_` beginnen. Die Unit verweigert den Start, wenn eine Angabe fehlt.

## Anwendung und Cleanup installieren oder aktualisieren

```bash
sudo install -o root -g root -m 0644 deploy/share.service /etc/systemd/system/share.service
sudo install -o root -g root -m 0644 deploy/share-cleanup.service /etc/systemd/system/share-cleanup.service
sudo install -o root -g root -m 0644 deploy/share-cleanup.timer /etc/systemd/system/share-cleanup.timer
sudo systemctl daemon-reload
sudo systemctl enable share.service share-cleanup.timer
sudo systemctl restart share.service share-cleanup.timer
```

Der explizite Neustart ist auch bei Updates nötig, damit der laufende Prozess den neuen Build, neue Units und geänderte Geheimnisse übernimmt. Der Prozess erhält ausschließlich Schreibrechte auf `shared/`; dort gespeicherte Dateien dürfen nicht ausgeführt werden. Der Timer startet die gemeinsame, getestete Löschroutine alle 15 Minuten.

## Caddy anbinden

Das Caddy-Snippet wird separat installiert und einmalig über einen Top-Level-Import in die bestehende Caddyfile eingebunden. Dadurch werden andere Virtual Hosts nicht überschrieben.

```bash
sudo install -d -o root -g root -m 0755 /etc/caddy/sites
sudo install -o root -g root -m 0644 deploy/Caddyfile-share.txt /etc/caddy/sites/sendebude.caddy
if ! sudo grep -qxF 'import /etc/caddy/sites/*.caddy' /etc/caddy/Caddyfile; then
  printf '\nimport /etc/caddy/sites/*.caddy\n' | sudo tee -a /etc/caddy/Caddyfile >/dev/null
fi

sudo install -d -o root -g root -m 0755 /etc/systemd/system/caddy.service.d
printf '[Service]\nEnvironmentFile=/etc/share-proxy.env\n' | sudo tee /etc/systemd/system/caddy.service.d/share-proxy.conf >/dev/null
sudo systemctl daemon-reload
sudo caddy validate --adapter caddyfile --config /etc/caddy/Caddyfile
sudo systemctl restart caddy.service
```

Der Block stellt `sendebude.de` bereit, leitet `www.sendebude.de` um und begrenzt Anfragekörper auf 8 MB. Caddy überschreibt die Client-IP- und Proxy-Secret-Header; die Anwendung vertraut ihnen nur bei übereinstimmendem Geheimnis. Nach einer Rotation von `/etc/share-proxy.env` müssen `share.service` und `caddy.service` neu gestartet werden.

## Prüfung

```bash
systemctl is-active share.service share-cleanup.timer caddy.service
systemctl list-timers share-cleanup.timer --no-pager
systemd-analyze security share.service --no-pager
journalctl -u share.service -n 30 --no-pager
```
