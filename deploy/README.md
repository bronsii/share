# Service-Härtung

Die geprüften Unit-Dateien werden mit Root-Rechten installiert:

```bash
sudo install -o root -g root -m 0644 deploy/share.service /etc/systemd/system/share.service
sudo install -o root -g root -m 0644 deploy/share-cleanup.service /etc/systemd/system/share-cleanup.service
sudo systemctl daemon-reload
sudo systemctl restart share.service
sudo systemctl restart share-cleanup.timer
```

Danach prüfen:

```bash
systemctl is-active share.service share-cleanup.timer
systemd-analyze security share.service --no-pager
```

Der Laufzeitprozess erhält ausschließlich Schreibrechte auf `shared/`; dort gespeicherte Dateien dürfen nicht ausgeführt werden.

Der Block in `Caddyfile-share.txt` ersetzt den bestehenden Block für `sendebude.de`. Er begrenzt jeden Anfragekörper bereits am Reverse Proxy auf 8 MB; die verschlüsselten Uploadblöcke sind ungefähr 4 MB groß. Anschließend:

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy.service
```
