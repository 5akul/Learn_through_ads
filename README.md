# Learn Through Ads

Chrome-Extension, die YouTube-Werbepausen in kurze Lernkarten für Cambridge AS/A Level verwandelt.
Die Werbung läuft normal weiter, nur stumm und von der Karte verdeckt. Nichts wird blockiert oder übersprungen.

**Stand: Version 0.7** (40 Lernkarten, je 10 für Computer Science, Mathematics, Economics und Psychology)

Auf YouTube:

- Erkennt, wann eine Werbung läuft, und legt eine Lernkarte deckend über den ganzen Player, auch im Vollbild.
- Schaltet die Werbung stumm und stellt danach den Ton wieder her, wie er vorher war.
- Überspringt nie selbst. Sobald die Werbung überspringbar ist, zeigt die Karte einen Hinweis und lässt genau über dem „Überspringen"-Knopf von YouTube eine Öffnung frei.
- „Hide card" verkleinert die Karte zu einem kleinen Knopf und gibt den Player frei, „Show card" holt sie zurück.
- Fünf Kartentypen: Hook and reveal, Find the error, Fill the gap, Estimate, Spot the variables.
- Bei langen Werbungen: Nach dem Beantworten erscheint „Next card", die nächste Karte kommt sofort, die Werbung läuft weiter.
- Nach der Werbung wartet das Video. „Keep learning" und „Back to video" sind gleich groß und sofort klickbar.
- Die Schrift wird automatisch so groß, dass die ganze Karte samt Antwort genau in den Player passt: kein Scrollen, keine leere Fläche, auch im Vollbild. Die Größe springt nicht, wenn die Antwort erscheint.

Kartenauswahl:

- 50 % aus dem aktuellen Kapitel, 25 % Wiederholungen falsch beantworteter Karten (nach 1, 3, 7 und 21 Tagen), 25 % Zufall aus allen Fächern.
- Keine Karte zweimal am Tag, kein Kartentyp zweimal hintereinander, wichtige Prüfungsthemen öfter.

Klick auf das Extension-Symbol (Einstellungsfenster):

- **Current chapter:** aktuelles Kapitel pro Fach wählen.
- **Exam mode:** Nach einer Werbung läuft das Video erst nach einer selbst gewählten Zahl richtiger Karten weiter. Jederzeit dort wieder abschaltbar.
- **Practice 10 cards now:** manueller Modus, zehn Karten am Stück ohne YouTube.
- Zeigt Streak und die Antworten von heute.

Gespeichert wird nur lokal im Browser: welche Karte wann gezeigt und wie beantwortet wurde, die Daumen-Bewertungen und die Einstellungen. Nichts verlässt das Gerät.

Noch nicht drin: mehr Prüfungsfächer-Karten in den 8 Wochen vor der Prüfung, Tagesziel, Web Store.

## Ausprobieren auf dem Chromebook

Einmalig:

1. Hier auf GitHub oben auf den grünen Knopf **Code** klicken, dann **Download ZIP**.
2. In der App **Dateien** den Ordner **Downloads** öffnen, mit Rechtsklick auf die ZIP-Datei **Alle extrahieren** wählen.
3. In Chrome `chrome://extensions` öffnen und oben rechts den **Entwicklermodus** einschalten.
4. **Entpackte Erweiterung laden** klicken und im entpackten Ordner den Unterordner **`extension`** auswählen.
5. Ein YouTube-Video mit Werbung öffnen.

Nach einem Update: Schritte 1 und 2 wiederholen, den alten Ordner ersetzen, in `chrome://extensions` bei der Extension auf den runden Pfeil (Neu laden) klicken und die YouTube-Seite neu laden. Welche Version geladen ist, steht dort neben dem Namen.

Wichtig, sonst gehen Streak und Lernverlauf verloren: Der Ordner muss immer am selben Ort liegen und gleich heißen, und die Extension wird nur neu geladen, nie entfernt.

**Es erscheint keine Karte?**

- Läuft ein Werbeblocker oder YouTube Premium? Dann gibt es keine Werbung, also auch keine Karten.
- Fehlt der Schalter „Entwicklermodus"? Dann blockiert das Schulkonto Extensions. Ein privates Google-Konto auf dem Chromebook ist nötig.
- YouTube ändert seine Seite gelegentlich. Die Werbeerkennung steht oben in `extension/content.js` (Klasse `ad-showing` am Element `#movie_player`), ebenso die Namen des „Überspringen"-Knopfs (`SKIP_BUTTON_SELECTORS`).

## Ordner

| Pfad | Inhalt |
|---|---|
| `extension/` | Die Extension selbst. Diesen Ordner lädt Chrome. |
| `extension/cards/` | Die Karten, eine Datei pro Fach (`computer_science.json`, `mathematics.json`, `economics.json`, `psychology.json`). |
| `assets/icon-source.webp` | Originalbild des Icons (Brille). Daraus entstehen die Icons in `extension/icons/`. |
| `card.schema.json` | Das Kartenformat. Jede Karte muss dazu passen. |
| `tools/check_cards.py` | Prüft alle Karten gegen das Format. |
| `tests/` | Automatische Tests (siehe unten). |

## Karten

Jede Karte hat diese Felder: `id`, `subject`, `syllabus_code`, `chapter`, `chapter_title`, `type`, `hook`, `answer`, `difficulty` (1–3), `exam_weight` (`high`/`medium`/`low`), `duration_seconds` (15–30), optional `source` und `notes_link`.
Je nach Typ kommen dazu:

| Typ | Zusatzfelder |
|---|---|
| `hook_reveal` | keine |
| `find_error` | `lines` (Zeilen), `error_line` (Nummer der falschen Zeile, ab 1) |
| `cloze` | `options`: zwei Antworten, **die erste ist die richtige**; im `hook` steht `____` für die Lücke |
| `estimate` | `estimate`: `min`, `max`, `correct`, `tolerance`, `unit` |
| `variables` | `iv`, `dv` |

Die `id` ist Fachkürzel, Kapitel, laufende Nummer, zum Beispiel `cs-03-001` (`cs`, `ma`, `ec`, `ps`).
Eine veröffentlichte `id` wird nie geändert oder neu vergeben, weil der Lernverlauf daran hängt.

## Tests

Bei jedem Hochladen prüft GitHub automatisch die Karten und die Auswahllogik (Reiter **Actions**).
Lokal:

```bash
python3 tools/check_cards.py
node tests/unit.test.js
node tests/e2e.test.js
```

Der letzte Test lädt die Extension in einen echten Chromium-Browser und spielt Werbepausen auf einer nachgebauten YouTube-Seite durch. Er braucht Playwright und ffmpeg.

## Grundregeln

- Werbung wird nie blockiert, übersprungen oder ersetzt.
- Keine Manipulationsmuster: Der Nutzer behält immer die Wahl.
- Daten werden nie verkauft.
