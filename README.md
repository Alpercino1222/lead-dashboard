# 📍 Lead Dashboard – Osthofen & Worms

Findet lokale Unternehmen ohne Website im Umkreis von 10 km um Osthofen (PLZ 67574) und generiert auf Knopfdruck eine fertige Präsentations-Website per KI.

---

## 🚀 Setup (5 Minuten)

### 1. Abhängigkeiten installieren
```bash
cd lead-dashboard
npm install
```

### 2. API-Keys eintragen
Kopiere `.env.example` zu `.env` und trage deine Keys ein:
```bash
cp .env.example .env
```

Öffne `.env` und fülle aus:
```
GOOGLE_MAPS_API_KEY=dein_google_maps_key_hier
ANTHROPIC_API_KEY=dein_anthropic_key_hier
PORT=3000
```

#### Google Maps API Key
1. Gehe zu https://console.cloud.google.com
2. Neues Projekt erstellen oder bestehendes wählen
3. APIs aktivieren: **Places API** (Legacy)
4. Unter „Anmeldedaten" → API-Schlüssel erstellen
5. Key in `.env` eintragen

#### Anthropic API Key
1. Gehe zu https://console.anthropic.com
2. „API Keys" → Neuen Key erstellen
3. Key in `.env` eintragen

### 3. Server starten
```bash
node server.js
```

### 4. Dashboard öffnen
Browser öffnen und aufrufen:
```
http://localhost:3000
```

---

## 📋 Funktionen

| Funktion | Beschreibung |
|---|---|
| **Suche** | Kategorie wählen → Unternehmen ohne Website in 10 km Umkreis finden |
| **Status** | Jeden Lead inline auf Neu / Kontaktiert / Interessiert / Gewonnen / Verloren setzen |
| **⚡ Website generieren** | Claude KI erstellt eine komplette HTML-Website für den Lead |
| **🗺️ Maps** | Öffnet das Unternehmen direkt in Google Maps |
| **CSV Export** | Alle Leads als Excel-kompatible CSV-Datei herunterladen |
| **Auto-Refresh** | Dashboard aktualisiert sich automatisch alle 30 Sekunden |

---

## 📁 Projektstruktur

```
lead-dashboard/
├── server.js        ← Node.js Backend (REST API)
├── index.html       ← Frontend (Single Page App)
├── leads.json       ← Lokale Datenbank (auto-erstellt)
├── websites/        ← Generierte HTML-Websites (auto-erstellt)
├── .env             ← Deine API-Keys (nicht committen!)
├── .env.example     ← Vorlage für API-Keys
└── package.json
```

---

## 🔌 API-Endpunkte

| Methode | Pfad | Beschreibung |
|---|---|---|
| GET | `/api/leads` | Alle Leads abrufen |
| POST | `/api/search?kategorie=Friseur` | Neue Suche starten |
| POST | `/api/generate-website/:id` | Website per KI generieren |
| PATCH | `/api/leads/:id` | Status eines Leads ändern |
| GET | `/api/export-csv` | Leads als CSV exportieren |

---

## ⚠️ Hinweise

- Die **Google Places API** kostet nach dem kostenlosen Kontingent Geld. Jede Suche macht ~20 Detail-Requests.
- Generierte Websites liegen lokal unter `websites/{id}.html`.
- `leads.json` wird nicht überschrieben – Duplikate werden automatisch verhindert.
