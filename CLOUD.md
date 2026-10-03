# Arbeiten mit Codex Cloud

Die bestehende deploy.yml startet bei jedem Push auf main und deployt auf
/srv/apps/share. ci.yml verwendet jetzt Node 24 passend zum package.json und
führt die vorhandenen Prüfungen aus. Vor Änderungen die Cloud-Startanweisungen
und AGENTS.md lesen, lokal `npm run check` ausführen, dann einen Pull Request
nach main übernehmen. Die bestehenden DEPLOY_* Secrets bleiben erforderlich.
Ein GitHub-Environment kann gegebenenfalls eine Freigabe vor Deployment verlangen.
