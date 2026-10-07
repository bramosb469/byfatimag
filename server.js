require('dotenv').config();
const express = require('express');
const cookieSession = require('cookie-session');
const helmet = require('helmet');
const compression = require('compression');
const path = require('path');
const fs = require('fs');
const { initDatabase, getAllConfig, seedAdmin } = require('./database/init');

const app = express();
const PORT = process.env.PORT || 3000;

require('express-async-errors');
const isVercel = process.env.VERCEL === '1';
if (!isVercel) {
  const publicUploads = path.join(__dirname, 'public', 'uploads');
  ['galeria', 'servicios'].forEach(d => {
    const dir = path.join(publicUploads, d);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  });
}

// Helmet config
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      fontSrc: ["'self'", 'fonts.googleapis.com', 'fonts.gstatic.com', 'cdn.jsdelivr.net', 'cdnjs.cloudflare.com', 'unpkg.com'],
      styleSrc: ["'self'", "'unsafe-inline'", 'fonts.googleapis.com', 'cdn.jsdelivr.net', 'cdnjs.cloudflare.com', 'unpkg.com'],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", 'cdn.jsdelivr.net', 'cdnjs.cloudflare.com', 'unpkg.com'],
      imgSrc: ["'self'", "data:", "blob:", 'https://*.supabase.co'],
      mediaSrc: ["'self'", "blob:", 'https://*.supabase.co'],
      connectSrc: ["'self'"]
    }
  }
}));

app.use(compression());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Session stored in a signed cookie (works in serverless, no server state)
app.set('trust proxy', 1);
app.use(cookieSession({
  name: 'lucejas_session',
  keys: [process.env.SESSION_SECRET || 'secret'],
  maxAge: 7 * 24 * 60 * 60 * 1000, // 1 week
  httpOnly: true,
  sameSite: 'lax',
  secure: isVercel
}));

// EJS
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Lazy DB init (works both locally and in serverless)
let dbReady = null;
function ensureDb() {
  if (!dbReady) {
    dbReady = initDatabase()
      .then(() => seedAdmin(process.env.ADMIN_EMAIL || 'admin@lucejas.com', process.env.ADMIN_PASSWORD || 'admin123'))
      .catch(err => {
        dbReady = null; // permitir reintento en el proximo request
        throw err;
      });
  }
  return dbReady;
}
app.use((req, res, next) => {
  ensureDb().then(() => next()).catch(next);
});

// Config Middleware
app.use(async (req, res, next) => {
  try {
    const config = await getAllConfig();
    res.locals.config = config;
    res.locals.siteConfig = config;
  } catch (e) {
    res.locals.config = {};
    res.locals.siteConfig = {};
  }
  res.locals.user = req.session.adminId ? { nombre: req.session.adminName } : null;
  next();
});

// Routes
const publicRoutes = require('./routes/public');
const adminRoutes = require('./routes/admin');

app.use('/', publicRoutes);
app.use('/admin', adminRoutes);

// Initialize database then start server (local only)
async function start() {
  try {
    await ensureDb();

    const adminEmail = process.env.ADMIN_EMAIL || 'admin@lucejas.com';
    const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';

    app.listen(PORT, () => {
      console.log(`\n  ✨ LU CEJAS servidor corriendo en http://localhost:${PORT}`);
      console.log(`  📋 Panel de control: http://localhost:${PORT}/admin`);
      console.log(`  📧 Admin: ${adminEmail}`);
      console.log(`  🔑 Pass: ${adminPassword}\n`);
    });
  } catch (err) {
    console.error('Error al iniciar:', err);
    process.exit(1);
  }
}

if (isVercel) {
  module.exports = app;
} else {
  start();
}
