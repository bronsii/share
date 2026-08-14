# Service-Härtung

Die geprüften Unit-Dateien werden mit Root-Rechten installiert:

```bash
proxy_secret="$(openssl rand -hex 32)"
printf 'SHARE_PROXY_SECRET=%s\n' "$proxy_secret" | sudo tee /etc/share-proxy.env >/dev/null
sudo chmod 0600 /etc/share-proxy.env

sudo install -o root -g root -m 0644 deploy/share.service /etc/systemd/system/share.service
sudo install -o root -g root -m 0644 deploy/share-cleanup.service /etc/systemd/system/share-cleanup.service
sudo systemctl daemon-reload
sudo systemctl restart share.service
sudo systemctl restart share-cleanup.timer
```

Dasselbe Geheimnis wird Caddy beim Start als Umgebungsvariable zur Verfügung gestellt. Bei einer systemd-Installation geschieht das über ein Drop-in:

```bash
sudo install -d -o root -g root -m 0755 /etc/systemd/system/caddy.service.d
printf '[Service]\nEnvironmentFile=/etc/share-proxy.env\n' | sudo tee /etc/systemd/system/caddy.service.d/share-proxy.conf >/dev/null
sudo systemctl daemon-reload
```

`/etc/share-proxy.env` muss ausschließlich für Root lesbar bleiben. Nach einer Rotation werden sowohl `share.service` als auch `caddy.service` neu gestartet. Bei einem fehlenden oder zu kurzen `SHARE_PROXY_SECRET` verweigert `share.service` den Start. Stimmen die Geheimnisse zwischen Caddy und Share nicht überein, schlagen API-Anfragen geschlossen fehl und der Fehler wird im Share-Journal protokolliert.

Danach prüfen:

```bash
systemctl is-active share.service share-cleanup.timer
systemd-analyze security share.service --no-pager
```

Der Laufzeitprozess erhält ausschließlich Schreibrechte auf `shared/`; dort gespeicherte Dateien dürfen nicht ausgeführt werden.

Der Block in `Caddyfile-share.txt` stellt `sendebude.de` bereit und leitet `www.sendebude.de` auf die Hauptdomain um. Er begrenzt jeden Anfragekörper bereits am Reverse Proxy auf 8 MB; die verschlüsselten Uploadblöcke sind ungefähr 4 MB groß. Caddy überschreibt außerdem `X-Share-Client-IP` und versieht die Weiterleitung mit `X-Share-Proxy-Secret`. Die Anwendung vertraut der Client-IP nur bei passendem Geheimnis. Anschließend:

```bash
sudo caddy validate --adapter caddyfile --config /etc/caddy/Caddyfile
sudo systemctl reload caddy.service
```
