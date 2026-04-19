require('dotenv').config({ override: true });
const express  = require('express');
const fs       = require('fs');
const path     = require('path');
const fetch    = require('node-fetch');
const Anthropic= require('@anthropic-ai/sdk');
const multer   = require('multer');
const crypto   = require('crypto');

const app = express();
app.use(express.json());

// ── Passwort-Schutz ──────────────────────────────────────────────
const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD || 'geheim123';
const sessions = new Set();

function makeToken() {
  return crypto.randomBytes(32).toString('hex');
}

// Login-Seite
app.get('/login', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Login – Lead Dashboard</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Segoe UI',system-ui,sans-serif;background:#0f1117;color:#e2e8f0;display:flex;align-items:center;justify-content:center;min-height:100vh}
  .card{background:#1a1d27;border:1px solid #2d3148;border-radius:16px;padding:40px;width:360px;box-shadow:0 20px 60px rgba(0,0,0,.6)}
  .logo{font-size:28px;text-align:center;margin-bottom:8px}
  h1{text-align:center;font-size:18px;font-weight:700;margin-bottom:6px}
  p{text-align:center;font-size:13px;color:#718096;margin-bottom:28px}
  input{width:100%;background:#22263a;border:1px solid #2d3148;color:#e2e8f0;padding:12px 14px;border-radius:10px;font-size:14px;outline:none;margin-bottom:14px;transition:border-color .15s}
  input:focus{border-color:#6366f1}
  button{width:100%;background:#6366f1;color:#fff;border:none;padding:13px;border-radius:10px;font-size:14px;font-weight:700;cursor:pointer;transition:opacity .15s}
  button:hover{opacity:.88}
  .err{color:#fca5a5;font-size:13px;text-align:center;margin-top:12px;display:none}
</style>
</head>
<body>
<div class="card">
  <div class="logo">📍</div>
  <h1>Lead Dashboard</h1>
  <p>Bitte melde dich an</p>
  <form method="POST" action="/login">
    <input type="password" name="password" placeholder="Passwort" autofocus required>
    <button type="submit">Anmelden</button>
  </form>
  ${req.query.err ? '<div class="err" style="display:block">❌ Falsches Passwort</div>' : ''}
</div>
</body>
</html>`);
});

// Login verarbeiten
app.use(express.urlencoded({ extended: false }));
app.post('/login', (req, res) => {
  if (req.body.password === DASHBOARD_PASSWORD) {
    const token = makeToken();
    sessions.add(token);
    res.setHeader('Set-Cookie', `ld_session=${token}; Path=/; HttpOnly; Max-Age=86400`);
    res.redirect('/');
  } else {
    res.redirect('/login?err=1');
  }
});

// Logout
app.get('/logout', (req, res) => {
  const cookie = parseCookie(req.headers.cookie || '');
  sessions.delete(cookie.ld_session);
  res.setHeader('Set-Cookie', 'ld_session=; Path=/; Max-Age=0');
  res.redirect('/login');
});

function parseCookie(str) {
  return str.split(';').reduce((acc, part) => {
    const [k, v] = part.trim().split('=');
    if (k) acc[k] = v || '';
    return acc;
  }, {});
}

// Auth-Middleware – schützt alle Routen außer /login
function requireAuth(req, res, next) {
  const cookie = parseCookie(req.headers.cookie || '');
  if (sessions.has(cookie.ld_session)) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Nicht eingeloggt' });
  res.redirect('/login');
}
app.use(requireAuth);
app.use(express.static(__dirname));

const LEADS_FILE = path.join(__dirname, 'leads.json');
const WEBSITES_DIR = path.join(__dirname, 'websites');

const BUILDER_DIR = path.join(__dirname, 'builder-data');
const UPLOADS_DIR = path.join(__dirname, 'uploads');

if (!fs.existsSync(WEBSITES_DIR)) fs.mkdirSync(WEBSITES_DIR, { recursive: true });
if (!fs.existsSync(BUILDER_DIR))  fs.mkdirSync(BUILDER_DIR,  { recursive: true });
if (!fs.existsSync(UPLOADS_DIR))  fs.mkdirSync(UPLOADS_DIR,  { recursive: true });
if (!fs.existsSync(LEADS_FILE))   fs.writeFileSync(LEADS_FILE, '[]');

const multerStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename:    (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  },
});
const upload = multer({ storage: multerStorage, limits: { fileSize: 15 * 1024 * 1024 } });

app.use('/uploads', express.static(UPLOADS_DIR));

function readBuilderData(id) {
  const file = path.join(BUILDER_DIR, `${id}.json`);
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}
function writeBuilderData(id, data) {
  fs.writeFileSync(path.join(BUILDER_DIR, `${id}.json`), JSON.stringify(data, null, 2));
}

const KATEGORIEN_MAP = {
  'Friseur':        'hair_salon',
  'Bäckerei':       'bakery',
  'Autowerkstatt':  'car_repair',
  'Zahnarzt':       'dentist',
  'Metzger':        'meal_takeaway',
  'Blumenladen':    'florist',
  'Elektriker':     'electrician',
  'Malerbetrieb':   'painter',
  'Gartenservice':  'landscaper',
  'Restaurant':     'restaurant',
  'Reinigung':      'laundry',
  'Physiotherapie': 'physiotherapist',
};

const STATUS_VALUES = ['neu', 'kontaktiert', 'zusage', 'absage', 'unentschieden'];

// Haversine-Distanz in km
function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 +
    Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLon/2)**2;
  return Math.round(R * 2 * Math.asin(Math.sqrt(a)) * 10) / 10;
}

// PLZ → lat/lng via OpenStreetMap (kostenlos, kein API-Key nötig)
async function geocodePLZ(plz, apiKey) {
  try {
    const url = `https://nominatim.openstreetmap.org/search?postalcode=${plz}&country=de&format=json&limit=1`;
    const resp = await fetch(url, { headers: { 'User-Agent': 'LeadDashboard/1.0' } });
    const data = await resp.json();
    if (data && data[0]) {
      return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon), label: data[0].display_name };
    }
  } catch (e) { /* fallback */ }
  // Fallback: Google Geocoding
  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${plz},Deutschland&key=${apiKey}`;
    const resp = await fetch(url);
    const data = await resp.json();
    if (data.status === 'OK' && data.results[0]) {
      const loc = data.results[0].geometry.location;
      return { lat: loc.lat, lng: loc.lng, label: data.results[0].formatted_address };
    }
  } catch (e) { /* fallback */ }
  throw new Error(`PLZ ${plz} nicht gefunden`);
}

function readLeads() {
  try {
    return JSON.parse(fs.readFileSync(LEADS_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function writeLeads(leads) {
  fs.writeFileSync(LEADS_FILE, JSON.stringify(leads, null, 2));
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// GET /api/leads
app.get('/api/leads', (req, res) => {
  res.json(readLeads());
});

// POST /api/search?kategorie=Friseur&plz=67574&radius=20
app.post('/api/search', async (req, res) => {
  const kategorie = req.query.kategorie || 'Friseur';
  const plz       = req.query.plz || '67574';
  const radiusKm  = Math.min(parseInt(req.query.radius) || 10, 50);
  const apiKey    = process.env.GOOGLE_MAPS_API_KEY;

  if (!apiKey) return res.status(500).json({ error: 'GOOGLE_MAPS_API_KEY fehlt' });

  try {
    // Schritt 1: PLZ geocoden
    const center = await geocodePLZ(plz, apiKey);

    const type      = KATEGORIEN_MAP[kategorie] || '';
    const typeParam = type ? `&type=${type}` : '';
    const radiusM   = radiusKm * 1000;

    // Schritt 2: Nearby Search
    const searchUrl =
      `https://maps.googleapis.com/maps/api/place/nearbysearch/json` +
      `?location=${center.lat},${center.lng}&radius=${radiusM}` +
      `&keyword=${encodeURIComponent(kategorie)}${typeParam}&language=de&key=${apiKey}`;

    const searchResp = await fetch(searchUrl);
    const searchData = await searchResp.json();

    if (!['OK', 'ZERO_RESULTS'].includes(searchData.status)) {
      return res.status(500).json({ error: `Google API Fehler: ${searchData.status}`, detail: searchData.error_message || '' });
    }

    const places = searchData.results || [];
    const leads  = readLeads();
    const existingIds = new Set(leads.map(l => l.placeId));
    let added = 0;

    for (const place of places.slice(0, 30)) {
      if (existingIds.has(place.place_id)) continue;

      try {
        const detailsUrl =
          `https://maps.googleapis.com/maps/api/place/details/json` +
          `?place_id=${place.place_id}` +
          `&fields=name,website,formatted_address,formatted_phone_number,geometry,url,rating,user_ratings_total` +
          `&language=de&key=${apiKey}`;

        const detailsResp = await fetch(detailsUrl);
        const detailsData = await detailsResp.json();
        if (detailsData.status !== 'OK') continue;

        const d = detailsData.result;
        if (d.website) continue; // bereits Website → überspringen

        const leadLat = d.geometry?.location?.lat ?? place.geometry?.location?.lat ?? center.lat;
        const leadLng = d.geometry?.location?.lng ?? place.geometry?.location?.lng ?? center.lng;

        leads.push({
          id:               uid(),
          placeId:          place.place_id,
          name:             d.name || place.name,
          kategorie,
          adresse:          d.formatted_address || '',
          telefon:          d.formatted_phone_number || '',
          status:           'neu',
          mapsUrl:          d.url || `https://www.google.com/maps/place/?q=place_id:${place.place_id}`,
          lat:              leadLat,
          lng:              leadLng,
          distanzKm:        haversine(center.lat, center.lng, leadLat, leadLng),
          suchPLZ:          plz,
          rating:           d.rating ?? null,
          userRatingsTotal: d.user_ratings_total ?? 0,
          createdAt:        new Date().toISOString(),
        });
        existingIds.add(place.place_id);
        added++;
      } catch { /* skip */ }
    }

    // Nach Distanz sortieren
    leads.sort((a, b) => (a.distanzKm ?? 999) - (b.distanzKm ?? 999));
    writeLeads(leads);
    res.json({ added, total: leads.length, searched: places.length, center: center.label });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/generate-website/:id
app.post('/api/generate-website/:id', async (req, res) => {
  const leads = readLeads();
  const lead = leads.find(l => l.id === req.params.id);

  if (!lead) return res.status(404).json({ error: 'Lead nicht gefunden' });

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY ist nicht gesetzt. Bitte .env Datei prüfen.' });
  }

  try {
    const client = new Anthropic({ apiKey: anthropicKey });

    const msg = await client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 4096,
      system:
        'Du bist ein Webdesigner. Generiere eine vollständige, moderne, mobilfreundliche Single-File HTML-Website ' +
        'für ein lokales deutsches Unternehmen. Verwende den Firmennamen, die Kategorie, die Adresse und die Telefonnummer. ' +
        'Enthalte: Hero-Bereich mit Firmenname und Slogan, Leistungsbereich mit 3 plausiblen Leistungen passend zur Kategorie, ' +
        'Kontaktbereich mit Telefon und Adresse, Google Maps Platzhalter-iframe, und eine Footer-Zeile. ' +
        'Modernes sauberes CSS, keine externen Frameworks. Gib NUR den rohen HTML-Code zurück, nichts anderes.',
      messages: [
        {
          role: 'user',
          content:
            `Erstelle eine Website für:\n` +
            `Firmenname: ${lead.name}\n` +
            `Kategorie: ${lead.kategorie}\n` +
            `Adresse: ${lead.adresse}\n` +
            `Telefon: ${lead.telefon || 'nicht angegeben'}`,
        },
      ],
    });

    let html = msg.content[0].text.trim();
    // Strip markdown code fences if Claude wraps it
    html = html.replace(/^```html?\n?/i, '').replace(/\n?```$/, '');

    const filename = `${lead.id}.html`;
    fs.writeFileSync(path.join(WEBSITES_DIR, filename), html, 'utf8');

    const idx = leads.findIndex(l => l.id === req.params.id);
    leads[idx].websiteFile = filename;
    writeLeads(leads);

    res.json({ file: `/websites/${filename}`, lead: leads[idx] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/leads/:id
app.patch('/api/leads/:id', (req, res) => {
  const leads = readLeads();
  const idx = leads.findIndex(l => l.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Lead nicht gefunden' });

  if (req.body.status && STATUS_VALUES.includes(req.body.status)) {
    leads[idx].status = req.body.status;
  }
  if (req.body.notiz !== undefined) {
    leads[idx].notiz = req.body.notiz;
  }
  writeLeads(leads);
  res.json(leads[idx]);
});

// DELETE /api/leads/:id
app.delete('/api/leads/:id', (req, res) => {
  const leads = readLeads();
  const idx = leads.findIndex(l => l.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Nicht gefunden' });
  leads.splice(idx, 1);
  writeLeads(leads);
  res.json({ ok: true });
});

// POST /api/refresh-ratings – holt Bewertungen für alle Leads ohne Rating
app.post('/api/refresh-ratings', async (req, res) => {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GOOGLE_MAPS_API_KEY fehlt' });

  const leads = readLeads();
  const toUpdate = leads.filter(l => l.rating == null && l.placeId);
  let updated = 0;

  for (const lead of toUpdate) {
    try {
      const url = `https://maps.googleapis.com/maps/api/place/details/json` +
        `?place_id=${lead.placeId}&fields=rating,user_ratings_total&language=de&key=${apiKey}`;
      const resp = await fetch(url);
      const data = await resp.json();
      if (data.status === 'OK') {
        const idx = leads.findIndex(l => l.id === lead.id);
        leads[idx].rating           = data.result.rating            ?? null;
        leads[idx].userRatingsTotal = data.result.user_ratings_total ?? 0;
        updated++;
      }
    } catch (e) { /* skip */ }
  }

  writeLeads(leads);
  res.json({ updated, total: toUpdate.length });
});

// GET /api/export-csv
app.get('/api/export-csv', (req, res) => {
  const leads = readLeads();
  const esc = v => `"${String(v || '').replace(/"/g, '""')}"`;
  const headers = ['Name', 'Kategorie', 'Adresse', 'Telefon', 'Status', 'Maps URL', 'Website generiert', 'Erstellt am'];
  const rows = leads.map(l => [
    esc(l.name), esc(l.kategorie), esc(l.adresse), esc(l.telefon),
    esc(l.status), esc(l.mapsUrl), esc(l.websiteFile ? 'Ja' : 'Nein'), esc(l.createdAt),
  ].join(','));

  const csv = '\uFEFF' + [headers.join(','), ...rows].join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="leads-osthofen.csv"');
  res.send(csv);
});

// Serve generated websites
app.use('/websites', express.static(WEBSITES_DIR));

// ── Builder routes ──────────────────────────────────────────────────────────

// Serve builder SPA
app.get('/builder/:id', (req, res) => res.sendFile(path.join(__dirname, 'builder.html')));

// GET /api/builder/:id
app.get('/api/builder/:id', (req, res) => {
  const data = readBuilderData(req.params.id);
  if (!data) return res.status(404).json({ error: 'no-data' });
  res.json(data);
});

// POST /api/builder/:id/save
app.post('/api/builder/:id/save', (req, res) => {
  writeBuilderData(req.params.id, req.body);
  res.json({ ok: true });
});

// POST /api/builder/:id/generate  – AI generates initial structured content
app.post('/api/builder/:id/generate', async (req, res) => {
  const leads = readLeads();
  const lead  = leads.find(l => l.id === req.params.id);
  if (!lead) return res.status(404).json({ error: 'Lead nicht gefunden' });

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(500).json({ error: 'ANTHROPIC_API_KEY fehlt' });

  try {
    const client = new Anthropic({ apiKey: key });
    const msg = await client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 4096,
      system: `Du bist ein Website-Content-Generator für deutsche lokale Unternehmen.
Gib NUR gültiges JSON zurück – kein Markdown, keine Erklärungen.
Die JSON-Struktur MUSS exakt diesem Schema folgen:
{
  "id": "string",
  "businessName": "string",
  "sections": [
    { "id":"hero","type":"hero","data":{"title":"","subtitle":"","description":"","buttonText":"Jetzt kontaktieren","backgroundImage":""},"styles":{"backgroundColor":"#0f172a","color":"#ffffff"} },
    { "id":"services","type":"services","data":{"title":"Unsere Leistungen","items":[{"id":"s1","icon":"⭐","title":"","description":""},{"id":"s2","icon":"🔧","title":"","description":""},{"id":"s3","icon":"✅","title":"","description":""}]},"styles":{"backgroundColor":"#ffffff","color":"#1e293b"} },
    { "id":"gallery","type":"gallery","data":{"title":"Galerie","images":[{"id":"g1","url":"","alt":"Bild 1"},{"id":"g2","url":"","alt":"Bild 2"},{"id":"g3","url":"","alt":"Bild 3"}]},"styles":{"backgroundColor":"#f8fafc","color":"#1e293b"} },
    { "id":"reviews","type":"reviews","data":{"title":"Kundenstimmen","items":[{"id":"r1","author":"","rating":5,"text":""},{"id":"r2","author":"","rating":5,"text":""},{"id":"r3","author":"","rating":5,"text":""}]},"styles":{"backgroundColor":"#ffffff","color":"#1e293b"} },
    { "id":"contact","type":"contact","data":{"title":"Kontakt","phone":"","address":"","email":"","hours":"Mo–Fr 9–18 Uhr"},"styles":{"backgroundColor":"#0f172a","color":"#ffffff"} },
    { "id":"footer","type":"footer","data":{"text":"© 2025 Firmenname","links":[{"label":"Impressum","url":"#"},{"label":"Datenschutz","url":"#"}]},"styles":{"backgroundColor":"#020617","color":"#94a3b8"} }
  ],
  "globalStyles":{"fontFamily":"Segoe UI, system-ui, sans-serif","primaryColor":"#4f46e5","accentColor":"#7c3aed","animations":false}
}
Fülle alle Textfelder mit realistischem deutschen Inhalt passend zur Kategorie.`,
      messages: [{ role: 'user', content: `Firmenname: ${lead.name}\nKategorie: ${lead.kategorie}\nAdresse: ${lead.adresse}\nTelefon: ${lead.telefon || 'nicht angegeben'}\nID: ${lead.id}` }],
    });

    let text = msg.content[0].text.trim().replace(/^```json?\n?/i,'').replace(/\n?```$/,'');
    const data = JSON.parse(text);
    writeBuilderData(lead.id, data);

    const idx = leads.findIndex(l => l.id === lead.id);
    if (idx !== -1) { leads[idx].hasBuilder = true; writeLeads(leads); }

    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/builder/:id/ai-prompt  – interprets style prompt and returns updated siteData
app.post('/api/builder/:id/ai-prompt', async (req, res) => {
  const { prompt } = req.body;
  const data = readBuilderData(req.params.id);
  if (!data) return res.status(404).json({ error: 'Kein Builder-Inhalt' });

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(500).json({ error: 'ANTHROPIC_API_KEY fehlt' });

  try {
    const client = new Anthropic({ apiKey: key });
    const msg = await client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 4096,
      system: `Du bist ein Website-Style-Transformer. Du bekommst eine Website-Datenstruktur und einen Style-Prompt.
Gib NUR gültiges JSON zurück: { "sections": [...], "globalStyles": {...} }
Verändere NUR Styles und globalStyles – behalte alle Texte, Bilder und Inhalte bei.
Stil-Regeln:
- "modern"      → cleane Fonts, Gradienten, subtile Schatten, viel Whitespace
- "luxury"/"luxus" → Gold (#c9a96e, #1a0a00), Serif-Fonts (Georgia), dunkler Hintergrund
- "dark mode"/"dunkel" → dunkle Hintergründe (#0f0f13, #1a1a24), helle Texte (#f1f5f9)
- "hell"/"light" → weiß/crème Hintergründe, dunkle Texte
- "animations" → setze globalStyles.animations=true
- "minimal" → viel Whitespace, Grautöne, keine Dekorationen
- "bunt"/"colorful" → lebhafte Hauptfarbe, Farbakzente
- "professional" → Navy (#1e3a5f), Grau, sans-serif, seriös`,
      messages: [{ role: 'user', content: `Website:\n${JSON.stringify(data,null,2)}\n\nPrompt: "${prompt}"` }],
    });

    let text = msg.content[0].text.trim().replace(/^```json?\n?/i,'').replace(/\n?```$/,'');
    const changes = JSON.parse(text);

    if (changes.sections) {
      changes.sections.forEach(ns => {
        const idx = data.sections.findIndex(s => s.id === ns.id);
        if (idx !== -1) data.sections[idx] = { ...data.sections[idx], ...ns };
      });
    }
    if (changes.globalStyles) data.globalStyles = { ...data.globalStyles, ...changes.globalStyles };

    writeBuilderData(req.params.id, data);
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/upload/:id – image upload
app.post('/api/upload/:id', upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Keine Datei' });
  res.json({ url: `/uploads/${req.file.filename}` });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n✅ Lead Dashboard läuft auf → http://localhost:${PORT}\n`);
});
