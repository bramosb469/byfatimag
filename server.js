require('dotenv').config();
const express = require('express');
const session = require('express-session');
const MemoryStore = require('memorystore')(session);
const helmet = require('helmet');
const compression = require('compression');
const path = require('path');
const fs = require('fs');
const { initDatabase, getAllConfig, seedAdmin } = require('./database/init');

const app = express();
const PORT = process.env.PORT || 3000;

// Directories
const publicUploads = path.join(__dirname, 'public', 'uploads');
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
if (!fs.existsSync(publicUploads)) fs.mkdirSync(publicUploads, { recursive: true });
if (!fs.existsSync(path.join(publicUploads, 'galeria'))) fs.mkdirSync(path.join(publicUploads, 'galeria'), { recursive: true });
if (!fs.existsSync(path.join(publicUploads, 'servicios'))) fs.mkdirSync(path.join(publicUploads, 'servicios'), { recursive: true });

// Helmet config
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      fontSrc: ["'self'", 'fonts.googleapis.com', 'fonts.gstatic.com', 'cdn.jsdelivr.net', 'cdnjs.cloudflare.com', 'unpkg.com'],
      styleSrc: ["'self'", "'unsafe-inline'", 'fonts.googleapis.com', 'cdn.jsdelivr.net', 'cdnjs.cloudflare.com', 'unpkg.com'],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", 'cdn.jsdelivr.net', 'cdnjs.cloudflare.com', 'unpkg.com'],
      imgSrc: ["'self'", "data:", "blob:"],
      mediaSrc: ["'self'", "blob:"],
      connectSrc: ["'self'"]
    }
  }
}));

app.use(compression());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Session with MemoryStore (no native deps needed)
app.use(session({
  store: new MemoryStore({
    checkPeriod: 86400000 // prune expired entries every 24h
  }),
  secret: process.env.SESSION_SECRET || 'secret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 } // 1 week
}));

// EJS
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Config Middleware
app.use((req, res, next) => {
  try {
    const config = getAllConfig();
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

// Initialize database then start server
async function start() {
  try {
    await initDatabase();
    console.log('Base de datos inicializada correctamente.');

    // Seed admin
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@lucejas.com';
    const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';
    seedAdmin(adminEmail, adminPassword);

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

start();
