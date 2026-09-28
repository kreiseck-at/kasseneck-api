# Zweig `release/0.x`

Dieser Zweig ist die eingefrorene 0.x-Linie von `@kreiseck/kasseneck-api`. Sie spricht `/v1` und den
internen Weg `/api` und bleibt für bestehende Nutzer bestehen, bis diese auf 1.x umgestiegen sind.

- Hier landen nur Fehlerbehebungen, keine neuen Funktionen. Neues entsteht auf `main` (1.x, nur `/v3`).
- Veröffentlicht wird ausschließlich mit `npm publish --tag legacy`, nie ohne Kanal: sonst wandert `latest`
  von 1.x zurück auf 0.x.
- Nach jeder Veröffentlichung `npm view @kreiseck/kasseneck-api dist-tags` prüfen: `latest` zeigt auf 1.x,
  `legacy` auf die neue 0.x-Version.
- Veröffentlicht wird nur aus einer frischen, sauberen Kopie des Zweigs (kein Arbeitsverzeichnis mit
  lokalen Dateien).
- Eine Behebung, die auch 1.x betrifft, wird zusätzlich auf `main` gebracht.
