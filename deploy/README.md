# Referenzbetrieb von sendebude.de mit systemd und Caddy

Diese Anleitung beschreibt die konkrete Referenzinstallation von `sendebude.de` auf einem einzelnen Debian-Server. Sie ist kein universeller Installer. Vor einer Übernahme für eine andere Domain müssen Benutzer, Pfade, Domainnamen und DNS-Einträge angepasst werden.

Die versionierten Units erwarten:

| Einstellung | Referenzwert |
| --- | --- |
| Anwendung | `/srv/apps/share` |
| Laufzeitdaten | `/srv/apps/share/shared` |
| Dienstbenutzer und -gruppe | `bronsi` |
| Node | `/opt/node/bin/node` |
| App-Adresse | `127.0.0.1:3000` |
| Öffentliche Hosts | `sendebude.de`, `www.sendebude.de` |

Für eine abweichende Installation müssen mindestens `deploy/share.service`, `deploy/share-cleanup.service` und `deploy/Caddyfile-share.txt` vor der Installation angepasst werden.

## Voraussetzungen und Grenzen

Vor dem ersten Start müssen folgende Punkte erfüllt sein:

- Debian mit systemd, Caddy, Git und OpenSSL ist installiert.
- Node erfüllt die in `package.json` angegebene Mindestversion und ist unter `/opt/node/bin/node` verfügbar. `node`, `npm` und der systemd-Dienst müssen dieselbe Node-Installation verwenden.
- Der Quellcode liegt sauber unter `/srv/apps/share`; lokale Änderungen dürfen nicht durch einen Update-Befehl überschrieben werden.
- Der Benutzer und die Gruppe `bronsi` existieren. Bei einem Fork sollte stattdessen ein eigener, nicht interaktiv genutzter Dienstbenutzer eingetragen werden.
- DNS für `sendebude.de` und `www.sendebude.de` zeigt auf diesen Server. Port 3000 bleibt geschlossen; nur Caddy veröffentlicht die Anwendung über HTTPS.
- Für Konfiguration und Laufzeitdaten ist ausreichend freier Speicher vorhanden.

Kurze Vorprüfung:

```bash
cd /srv/apps/share
/opt/node/bin/node --version
node --version
npm --version
git status --short
systemctl is-active caddy.service
```

`git status --short` muss vor Installation oder Update leer sein. Die CI verwendet Node `22.13.0`; die produktiv verwendete Version muss mindestens die Anforderung aus `package.json` erfüllen.

Alle Befehle sind der Reihe nach auszuführen. Sobald ein Befehl fehlschlägt, nicht mit dem nächsten Block fortfahren, sondern Protokoll beziehungsweise Fehlermeldung prüfen und gegebenenfalls den Rollback verwenden.

### Nur eine App-Instanz

Pro `SHARED_ROOT` darf genau ein Next.js-Prozess laufen. Datei-, Abschluss-, Reservierungs- und Rate-Limit-Koordination ist für diese Referenzinstallation auf einen Prozess ausgelegt. Keine PM2-Cluster, parallelen systemd-Units oder Container-Replikate gegen dasselbe Datenverzeichnis starten. Mehrere Instanzen erfordern zuvor eine prozessübergreifende Sperr- und Zustandsverwaltung.

## Erforderliche Serverkonfiguration

Die Werte liegen in drei nicht versionierten, nur für Root lesbaren Dateien:

| Datei | Inhalt |
| --- | --- |
| `/etc/share-admin.env` | Admin-Passphrase und Signaturschlüssel für Admin-Sitzungen |
| `/etc/share-proxy.env` | gemeinsames Geheimnis zwischen Sendebude und Caddy |
| `/etc/share-imprint.env` | öffentlich angezeigte Impressumsangaben |

Keine dieser Variablen darf mit `NEXT_PUBLIC_` beginnen. Geheimnisse niemals in das Repository, ein Terminal-Kommando, einen Screenshot oder ein Support-Ticket kopieren.

### Geheimnisse genau einmal anlegen

Der folgende Block bricht ab, sobald eine der beiden Dateien oder ein gleichnamiger Symlink bereits existiert. Er ist nicht für Updates oder eine Rotation gedacht. Der ausgegebene Admin-Code gehört anschließend in einen Passwortmanager.

```bash
sudo /bin/sh -eu <<'EOF'
admin_file=/etc/share-admin.env
proxy_file=/etc/share-proxy.env

if [ -e "$admin_file" ] || [ -L "$admin_file" ] || [ -e "$proxy_file" ] || [ -L "$proxy_file" ]; then
  echo "Abbruch: Mindestens eine Geheimnisdatei existiert bereits und bleibt unverändert." >&2
  exit 1
fi

umask 077
admin_code="$(openssl rand -hex 24)"
admin_session_secret="$(openssl rand -hex 32)"
proxy_secret="$(openssl rand -hex 32)"

set -C
printf 'SHARE_ADMIN_CODE=%s\nSHARE_ADMIN_SESSION_SECRET=%s\n' "$admin_code" "$admin_session_secret" > "$admin_file"
printf 'SHARE_PROXY_SECRET=%s\n' "$proxy_secret" > "$proxy_file"
chown root:root "$admin_file" "$proxy_file"
chmod 0600 "$admin_file" "$proxy_file"
printf 'Admin-Code: %s\n' "$admin_code"
unset admin_code admin_session_secret proxy_secret
EOF
```

Eine beabsichtigte Rotation ist ein eigener Wartungsvorgang. Nach einer Proxy-Rotation müssen `share.service` und `caddy.service` mit demselben neuen Wert neu gestartet werden; während des Übergangs können API-Anfragen kurz fehlschlagen.

### Impressumsdatei genau einmal anlegen

Auch dieser Block überschreibt keine bestehende Datei:

```bash
(
  set -e
  sudo /bin/sh -eu <<'EOF'
imprint_file=/etc/share-imprint.env

if [ -e "$imprint_file" ] || [ -L "$imprint_file" ]; then
  echo "Abbruch: /etc/share-imprint.env existiert bereits und bleibt unverändert." >&2
  exit 1
fi

umask 077
set -C
: > "$imprint_file"
chown root:root "$imprint_file"
chmod 0600 "$imprint_file"
EOF
  sudoedit /etc/share-imprint.env
)
```

Die Platzhalter müssen durch die Angaben des jeweiligen Betreibers ersetzt werden. Werte mit Leerzeichen in doppelte Anführungszeichen setzen:

```dotenv
SHARE_IMPRINT_NAME="<vollständiger Anbietername>"
SHARE_IMPRINT_STREET="<Straße und Hausnummer>"
SHARE_IMPRINT_LOCALITY="<Postleitzahl und Ort>"
SHARE_IMPRINT_COUNTRY="<Land>"
SHARE_IMPRINT_EMAIL="<Kontaktadresse>"
```

Die App-Unit verweigert den Start, wenn eine Angabe fehlt. Die Anwendung prüft die E-Mail-Adresse zusätzlich beim Aufruf des Impressums.

Vor der Installation oder einem Neustart lässt sich die vollständige Konfiguration prüfen, ohne einen Wert auszugeben:

```bash
sudo /bin/sh -euc '
  . /etc/share-admin.env
  . /etc/share-proxy.env
  . /etc/share-imprint.env
  test "${#SHARE_ADMIN_CODE}" -ge 16
  test "${#SHARE_ADMIN_SESSION_SECRET}" -ge 32
  test "${#SHARE_PROXY_SECRET}" -ge 32
  test -n "$SHARE_IMPRINT_NAME"
  test -n "$SHARE_IMPRINT_STREET"
  test -n "$SHARE_IMPRINT_LOCALITY"
  test -n "$SHARE_IMPRINT_COUNTRY"
  case "$SHARE_IMPRINT_EMAIL" in ?*@?*.*) ;; *) exit 1 ;; esac
'
```

## Erstinstallation

Wenn auf dem Server bereits eine ältere Sendebude-/Share-Installation läuft, nicht diesen Abschnitt verwenden, sondern mit [Bestehende Live-Installation migrieren](#bestehende-live-installation-migrieren) fortfahren.

### 1. Laufzeitverzeichnis anlegen

Das Verzeichnis muss bereits existieren, bevor systemd `ReadWritePaths` einrichten kann:

```bash
sudo install -d -o bronsi -g bronsi -m 0700 /srv/apps/share/shared
```

Danach die drei Konfigurationsdateien wie oben beschrieben anlegen.

### 2. Abhängigkeiten installieren, prüfen und bauen

```bash
(
  set -e
  cd /srv/apps/share
  npm ci
  npm run check
)
```

`npm run check` führt in dieser Reihenfolge ESLint, TypeScript, Unit-Tests, den Produktions-Build und anschließend Integrationstests gegen diesen Build aus. Erst nach einem vollständig erfolgreichen Lauf darf der Dienst mit diesem Build gestartet werden.

### 3. systemd-Units prüfen und installieren

```bash
(
  set -e
  cd /srv/apps/share
  systemd-analyze verify deploy/share.service deploy/share-cleanup.service deploy/share-cleanup.timer
  sudo install -o root -g root -m 0644 deploy/share.service /etc/systemd/system/share.service
  sudo install -o root -g root -m 0644 deploy/share-cleanup.service /etc/systemd/system/share-cleanup.service
  sudo install -o root -g root -m 0644 deploy/share-cleanup.timer /etc/systemd/system/share-cleanup.timer
  sudo systemctl daemon-reload
  sudo systemctl enable share.service share-cleanup.timer
  sudo systemctl start share.service share-cleanup.timer
)
```

Der App-Prozess kann ausschließlich in `shared/` schreiben; dort gespeicherte Dateien sind für den Dienst zusätzlich als nicht ausführbar eingebunden. Der Timer löst die gemeinsame Löschroutine zu jeder Viertelstunde mit bis zu 60 Sekunden zufälliger Verzögerung aus. `Persistent=true` holt einen während eines Neustarts verpassten Kalenderlauf nach.

### 4. Caddy einmalig anbinden

Vor dem Einbinden muss geprüft werden, ob `sendebude.de` oder `www.sendebude.de` bereits in einer Caddy-Datei definiert ist:

```bash
sudo grep -RniE '(^|[[:space:],])(www\.)?sendebude\.de([[:space:],{]|$)' /etc/caddy/Caddyfile /etc/caddy/sites 2>/dev/null
```

Bei einem Treffer nicht fortfahren. Zwei Definitionen derselben Domain machen die Caddy-Konfiguration ungültig. Einen vorhandenen direkten Block zuerst nach dem Migrationsabschnitt in das versionierte Snippet überführen.

Nur bei einer neuen, noch nicht vorhandenen Domain-Konfiguration:

```bash
(
  set -e
  cd /srv/apps/share
  sudo install -d -o root -g root -m 0755 /etc/caddy/sites
  sudo install -o root -g root -m 0644 deploy/Caddyfile-share.txt /etc/caddy/sites/sendebude.caddy
  if ! sudo grep -Eq '^[[:space:]]*import[[:space:]]+/etc/caddy/sites/\*\.caddy[[:space:]]*$' /etc/caddy/Caddyfile; then
    printf '\nimport /etc/caddy/sites/*.caddy\n' | sudo tee -a /etc/caddy/Caddyfile >/dev/null
  fi

  sudo install -d -o root -g root -m 0755 /etc/systemd/system/caddy.service.d
  sudo /bin/sh -eu <<'EOF'
dropin=/etc/systemd/system/caddy.service.d/share-proxy.conf
expected='[Service]
EnvironmentFile=/etc/share-proxy.env'
if [ -L "$dropin" ]; then
  echo "Abbruch: $dropin ist ein Symlink." >&2
  exit 1
fi
if [ -e "$dropin" ]; then
  if [ "$(cat "$dropin")" != "$expected" ]; then
    echo "Abbruch: $dropin existiert mit anderem Inhalt." >&2
    exit 1
  fi
else
  umask 022
  set -C
  printf '%s\n' "$expected" > "$dropin"
  chown root:root "$dropin"
  chmod 0644 "$dropin"
fi
EOF
  sudo systemctl daemon-reload
)
```

Die Syntaxprüfung muss das Proxy-Geheimnis aus derselben Datei laden, die später der Caddy-Dienst verwendet:

```bash
(
  set -e
  sudo /bin/sh -ec '
    set -a
    . /etc/share-proxy.env
    set +a
    test "${#SHARE_PROXY_SECRET}" -ge 32
    exec caddy validate --adapter caddyfile --config /etc/caddy/Caddyfile
  '
  sudo systemctl enable caddy.service
  sudo systemctl restart caddy.service
)
```

Das Snippet stellt `sendebude.de` bereit, leitet `www.sendebude.de` um und begrenzt Anfragekörper auf 8 MB. Caddy überschreibt die intern verwendeten Client-IP- und Proxy-Secret-Header; die Anwendung vertraut ihnen nur bei übereinstimmendem Geheimnis.

## Bestehende Live-Installation migrieren

Dieser Ablauf ist für eine Installation gedacht, die Impressumswerte noch aus `.env.production.local` lädt oder den Sendebude-Block direkt in `/etc/caddy/Caddyfile` enthält. Während der Vorbereitung bleiben die laufenden Prozesse unverändert.

### 1. Bestand aufnehmen und sichern

Keine Geheimnis- oder Impressumswerte ausgeben. Nur Pfade, Units und Schlüsselbezeichnungen prüfen:

```bash
cd /srv/apps/share
git status --short
sudo systemctl cat share.service
sudo grep -RniE '(^|[[:space:],])(www\.)?sendebude\.de([[:space:],{]|$)' /etc/caddy/Caddyfile /etc/caddy/sites 2>/dev/null
find . -maxdepth 1 -type f -name '.env*' -printf '%M %u:%g %p\n'
```

`git status --short` muss leer sein. Vor Caddy-Änderungen eine wiederherstellbare Kopie anlegen:

```bash
(
  set -e
  migration_stamp="$(date +%Y%m%d-%H%M%S)"
  sudo cp -a /etc/caddy/Caddyfile "/etc/caddy/Caddyfile.before-sendebude-${migration_stamp}"
  if sudo test -e /etc/caddy/sites/sendebude.caddy; then
    sudo cp -a /etc/caddy/sites/sendebude.caddy "/etc/caddy/sites/sendebude.caddy.before-${migration_stamp}"
  fi
  for unit_file in share.service share-cleanup.service share-cleanup.timer; do
    if sudo test -e "/etc/systemd/system/${unit_file}"; then
      sudo cp -a "/etc/systemd/system/${unit_file}" "/etc/systemd/system/${unit_file}.before-${migration_stamp}"
    fi
  done
)
```

### 2. Impressumswerte in die Root-Datei übertragen

Eine vorhandene `/etc/share-imprint.env` niemals neu anlegen oder überschreiben:

```bash
(
  set -e
  if sudo test -e /etc/share-imprint.env || sudo test -L /etc/share-imprint.env; then
    echo '/etc/share-imprint.env existiert bereits und bleibt unverändert.'
  else
    sudo install -o root -g root -m 0600 /dev/null /etc/share-imprint.env
  fi
  sudoedit /etc/share-imprint.env
)
```

Nur die fünf dokumentierten `SHARE_IMPRINT_*`-Werte manuell übertragen; nicht die vollständige lokale Env-Datei kopieren. `.env.production.local` erst nach erfolgreichem Neustart und erfolgreicher Prüfung bereinigen. Enthält sie weitere benötigte Variablen, darf sie nicht gelöscht werden.

### 3. Direkte Caddy-Blöcke migrieren

Falls `sendebude.de` oder `www.sendebude.de` direkt in `/etc/caddy/Caddyfile` definiert ist:

1. Mit `sudoedit /etc/caddy/Caddyfile` ausschließlich diese beiden vollständigen Site-Blöcke entfernen.
2. `deploy/Caddyfile-share.txt` als `/etc/caddy/sites/sendebude.caddy` installieren.
3. Den Top-Level-Import genau einmal ergänzen.
4. Validieren, bevor Caddy neu geladen oder gestartet wird.

```bash
(
  set -e
  cd /srv/apps/share
  sudoedit /etc/caddy/Caddyfile
  sudo install -d -o root -g root -m 0755 /etc/caddy/sites
  sudo install -o root -g root -m 0644 deploy/Caddyfile-share.txt /etc/caddy/sites/sendebude.caddy
  if ! sudo grep -Eq '^[[:space:]]*import[[:space:]]+/etc/caddy/sites/\*\.caddy[[:space:]]*$' /etc/caddy/Caddyfile; then
    printf '\nimport /etc/caddy/sites/*.caddy\n' | sudo tee -a /etc/caddy/Caddyfile >/dev/null
  fi
  sudo /bin/sh -ec '
    set -a
    . /etc/share-proxy.env
    set +a
    test "${#SHARE_PROXY_SECRET}" -ge 32
    exec caddy validate --adapter caddyfile --config /etc/caddy/Caddyfile
  '
)
```

Schlägt die Validierung fehl, Caddy nicht neu laden. Die gesicherte Caddyfile beziehungsweise das gesicherte Snippet wiederherstellen, den Fehler beheben und erneut validieren. Schlägt später der Dienststart wegen der neuen Units fehl, stehen deren Kopien mit demselben Zeitstempel für den kontrollierten Rückweg bereit.

### 4. Versionierte Units übernehmen

Erst fortfahren, wenn `/etc/share-admin.env`, `/etc/share-proxy.env` und `/etc/share-imprint.env` vollständig vorhanden sind. Zuerst die oben dokumentierte Konfigurationsprüfung ausführen; sie darf keine Fehlermeldung liefern:

```bash
(
  set -e
  sudo stat -c '%a %U:%G %n' /etc/share-admin.env /etc/share-proxy.env /etc/share-imprint.env
  cd /srv/apps/share
  systemd-analyze verify deploy/share.service deploy/share-cleanup.service deploy/share-cleanup.timer
  sudo install -o root -g root -m 0644 deploy/share.service /etc/systemd/system/share.service
  sudo install -o root -g root -m 0644 deploy/share-cleanup.service /etc/systemd/system/share-cleanup.service
  sudo install -o root -g root -m 0644 deploy/share-cleanup.timer /etc/systemd/system/share-cleanup.timer
  sudo install -d -o root -g root -m 0755 /etc/systemd/system/caddy.service.d
  sudo /bin/sh -eu <<'EOF'
dropin=/etc/systemd/system/caddy.service.d/share-proxy.conf
expected='[Service]
EnvironmentFile=/etc/share-proxy.env'
if [ -L "$dropin" ]; then
  echo "Abbruch: $dropin ist ein Symlink." >&2
  exit 1
fi
if [ -e "$dropin" ]; then
  if [ "$(cat "$dropin")" != "$expected" ]; then
    echo "Abbruch: $dropin existiert mit anderem Inhalt." >&2
    exit 1
  fi
else
  umask 022
  set -C
  printf '%s\n' "$expected" > "$dropin"
  chown root:root "$dropin"
  chmod 0644 "$dropin"
fi
EOF
  sudo systemctl daemon-reload
  sudo systemctl restart share.service share-cleanup.timer
  sudo systemctl restart caddy.service
)
```

Root-only Drop-ins aus einer älteren Installation mit `sudo systemctl cat share.service` prüfen. Unbekannte Drop-ins nicht blind löschen. Eine lediglich doppelt eingetragene `EnvironmentFile`-Zeile kann nach erfolgreicher Migration kontrolliert entfernt werden.

Nach der Migration die Prüfungen aus dem Abschnitt [Validierung und Überwachung](#validierung-und-überwachung) vollständig durchführen.

## Normales Update

Die Referenz-Units starten aus einem festen Checkout. Deshalb wird für diesen einfachen Aufbau ein Wartungsfenster verwendet: `npm ci` und `next build` dürfen nicht über einen laufenden Next.js-Prozess geschrieben werden. Für höhere Verfügbarkeitsanforderungen sind getrennte, versionierte Release-Verzeichnisse mit einem atomar umgestellten `current`-Symlink und einem außerhalb des Releases liegenden Datenverzeichnis vorzuziehen.

### 1. Update vorbereiten

```bash
cd /srv/apps/share
git switch main
git status --short
git fetch --prune origin
git log --oneline HEAD..origin/main
git rev-parse HEAD
```

Bei lokaler Ausgabe von `git status --short` abbrechen und die Änderungen zuerst bewusst sichern oder abschließen. Den von `git rev-parse HEAD` ausgegebenen Commit als Rollback-Commit notieren.

### 2. Wartungsfenster und Build

```bash
(
  set -e
  sudo systemctl stop share-cleanup.timer
  sudo systemctl stop share.service
  git merge --ff-only origin/main
  npm ci
  npm run check
)
```

Bei einem Fehler nicht mit dem Neustart fortfahren, sondern den unten beschriebenen Rollback ausführen. Ein Produktions-Build ist nur zusammen mit genau dem Quellcode und `node_modules` dieses Commits gültig.

### 3. Deployment-Dateien aktualisieren

```bash
(
  set -e
  systemd-analyze verify deploy/share.service deploy/share-cleanup.service deploy/share-cleanup.timer
  sudo install -o root -g root -m 0644 deploy/share.service /etc/systemd/system/share.service
  sudo install -o root -g root -m 0644 deploy/share-cleanup.service /etc/systemd/system/share-cleanup.service
  sudo install -o root -g root -m 0644 deploy/share-cleanup.timer /etc/systemd/system/share-cleanup.timer
  sudo install -o root -g root -m 0644 deploy/Caddyfile-share.txt /etc/caddy/sites/sendebude.caddy
  sudo systemctl daemon-reload
  sudo /bin/sh -ec '
    set -a
    . /etc/share-proxy.env
    set +a
    test "${#SHARE_PROXY_SECRET}" -ge 32
    exec caddy validate --adapter caddyfile --config /etc/caddy/Caddyfile
  '
)
```

### 4. Neue Version starten

```bash
(
  set -e
  sudo systemctl start share.service
  sudo systemctl start share-cleanup.timer
  sudo systemctl reload caddy.service
)
```

Ein Caddy-Reload genügt nur, wenn `/etc/share-proxy.env` unverändert ist. Nach einer Änderung dieses Geheimnisses müssen App und Caddy neu gestartet werden.

## Rollback

Ein alter `.next`-Ordner darf nicht mit einem anderen Commit wiederverwendet werden. Für den vorher notierten Commit müssen Abhängigkeiten, Tests und Build erneut erzeugt werden. `REPLACE_WITH_PREVIOUS_COMMIT` vor dem Ausführen durch den vorher notierten Commit ersetzen:

```bash
(
  set -e
  cd /srv/apps/share
  sudo systemctl stop share-cleanup.timer
  sudo systemctl stop share.service
  rollback_commit="REPLACE_WITH_PREVIOUS_COMMIT"
  git rev-parse --verify "${rollback_commit}^{commit}"
  git switch --detach "$rollback_commit"
  npm ci
  npm run check
  systemd-analyze verify deploy/share.service deploy/share-cleanup.service deploy/share-cleanup.timer
  sudo install -o root -g root -m 0644 deploy/share.service /etc/systemd/system/share.service
  sudo install -o root -g root -m 0644 deploy/share-cleanup.service /etc/systemd/system/share-cleanup.service
  sudo install -o root -g root -m 0644 deploy/share-cleanup.timer /etc/systemd/system/share-cleanup.timer
  sudo install -o root -g root -m 0644 deploy/Caddyfile-share.txt /etc/caddy/sites/sendebude.caddy
  sudo systemctl daemon-reload
  sudo /bin/sh -ec '
    set -a
    . /etc/share-proxy.env
    set +a
    test "${#SHARE_PROXY_SECRET}" -ge 32
    exec caddy validate --adapter caddyfile --config /etc/caddy/Caddyfile
  '
  sudo systemctl start share.service
  sudo systemctl start share-cleanup.timer
  sudo systemctl reload caddy.service
)
```

Danach die vollständige Validierung durchführen. Ein Rollback läuft absichtlich im Detached-HEAD-Zustand; von dort nichts pushen. Nach Behebung des Problems wieder bewusst auf `main` wechseln und ein reguläres Update ausführen.

## Validierung und Überwachung

### Konfiguration und Dateirechte

```bash
sudo stat -c '%a %U:%G %n' /etc/share-admin.env /etc/share-proxy.env /etc/share-imprint.env
systemd-analyze verify deploy/share.service deploy/share-cleanup.service deploy/share-cleanup.timer
sudo /bin/sh -ec '
  set -a
  . /etc/share-proxy.env
  set +a
  test "${#SHARE_PROXY_SECRET}" -ge 32
  exec caddy validate --adapter caddyfile --config /etc/caddy/Caddyfile
'
```

Alle drei Env-Dateien müssen `600 root:root` anzeigen. Ihre Inhalte nicht zur Kontrolle ausgeben.

### Dienste und Erreichbarkeit

```bash
systemctl is-enabled share.service share-cleanup.timer caddy.service
systemctl is-active share.service share-cleanup.timer caddy.service
systemctl list-timers share-cleanup.timer --all --no-pager
ss -ltn '( sport = :3000 )'
curl --fail --silent --show-error --retry 10 --retry-delay 1 --retry-connrefused https://sendebude.de/ >/dev/null
```

Port 3000 darf ausschließlich auf `127.0.0.1` lauschen. Die drei dauerhaft laufenden Units müssen aktiv sein.

### Cleanup und Protokolle

`share-cleanup.service` ist eine kurz laufende `oneshot`-Unit und nach erfolgreichem Abschluss normalerweise wieder `inactive`. Entscheidend sind Ergebnis und Exitcode:

```bash
systemctl show share-cleanup.service --property=Result --property=ExecMainStatus --property=InactiveExitTimestamp
sudo journalctl -u share-cleanup.service -n 30 --no-pager
sudo journalctl -u share.service -n 30 --no-pager
sudo journalctl -u caddy.service -n 30 --no-pager
systemd-analyze security share.service --no-pager
```

Ein manueller, nicht löschender Probelauf verwendet dieselbe Cleanup-Routine:

```bash
cd /srv/apps/share
sudo -u bronsi env SHARED_ROOT=/srv/apps/share/shared /opt/node/bin/node scripts/cleanup-expired.mjs --dry-run
```
