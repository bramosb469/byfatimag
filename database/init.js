const initSqlJs = require('sql.js');
const path = require('path');
const bcrypt = require('bcryptjs');
const fs = require('fs');

const isVercel = process.env.VERCEL === '1';
const dataDir = isVercel ? path.join('/tmp', 'data') : path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'lucejas.db');

let db = null;

// Wrapper to make sql.js API compatible with better-sqlite3 style usage
function createDbWrapper(rawDb) {
  function saveToFile() {
    const data = rawDb.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(dbPath, buffer);
  }

  // Auto-save after modifications, debounced
  let saveTimer = null;
  function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(saveToFile, 100);
  }

  const wrapper = {
    _raw: rawDb,
    save: saveToFile,

    exec(sql) {
      rawDb.run(sql);
      scheduleSave();
    },

    prepare(sql) {
      return {
        run(...params) {
          rawDb.run(sql, params);
          scheduleSave();
          return { changes: rawDb.getRowsModified() };
        },
        get(...params) {
          const stmt = rawDb.prepare(sql);
          if (params.length > 0) stmt.bind(params);
          if (stmt.step()) {
            const cols = stmt.getColumnNames();
            const vals = stmt.get();
            const row = {};
            cols.forEach((c, i) => { row[c] = vals[i]; });
            stmt.free();
            return row;
          }
          stmt.free();
          return undefined;
        },
        all(...params) {
          const rows = [];
          const stmt = rawDb.prepare(sql);
          if (params.length > 0) stmt.bind(params);
          while (stmt.step()) {
            const cols = stmt.getColumnNames();
            const vals = stmt.get();
            const row = {};
            cols.forEach((c, i) => { row[c] = vals[i]; });
            rows.push(row);
          }
          stmt.free();
          return rows;
        }
      };
    },

    transaction(fn) {
      return function(...args) {
        rawDb.run('BEGIN TRANSACTION');
        try {
          fn(...args);
          rawDb.run('COMMIT');
          scheduleSave();
        } catch (e) {
          rawDb.run('ROLLBACK');
          throw e;
        }
      };
    }
  };

  return wrapper;
}

// Initialize database synchronously-ish using top-level await pattern
let initPromise = null;

function initDatabase() {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const SQL = await initSqlJs();

    let rawDb;
    if (fs.existsSync(dbPath)) {
      const fileBuffer = fs.readFileSync(dbPath);
      rawDb = new SQL.Database(fileBuffer);
    } else {
      rawDb = new SQL.Database();
    }

    db = createDbWrapper(rawDb);

    // Enable WAL mode
    rawDb.run('PRAGMA journal_mode = WAL');

    // 1. configuracion
    db.exec(`
      CREATE TABLE IF NOT EXISTS configuracion (
        id INTEGER PRIMARY KEY,
        clave TEXT UNIQUE,
        valor TEXT,
        tipo TEXT DEFAULT 'text'
      )
    `);

    const defaults = [
      ['nombre_negocio', 'LU CEJAS'],
      ['slogan', 'Realzá tu mirada'],
      ['telefono', ''],
      ['email', ''],
      ['direccion', ''],
      ['instagram', ''],
      ['whatsapp', ''],
      ['horario_lunes', '09:00-18:00'],
      ['horario_martes', '09:00-18:00'],
      ['horario_miercoles', '09:00-18:00'],
      ['horario_jueves', '09:00-18:00'],
      ['horario_viernes', '09:00-18:00'],
      ['horario_sabado', '09:00-14:00'],
      ['horario_domingo', 'Cerrado'],
      ['duracion_turno_min', '60'],
      ['color_primario', '#C9A96E'],
      ['color_fondo', '#FAF7F2'],
      ['color_texto', '#2C1810'],
      ['color_acento', '#8B6914'],
      ['color_secundario', '#F5EDE0'],
      ['about_titulo', 'Sobre Nosotras'],
      ['about_texto', 'Somos un centro estético dedicado al arte de realzar tu mirada. Con años de experiencia y pasión por la belleza, ofrecemos tratamientos de primera calidad para resaltar tu expresión natural.'],
      ['about_imagen', '']
    ];

    defaults.forEach(d => {
      db.prepare('INSERT OR IGNORE INTO configuracion (clave, valor) VALUES (?, ?)').run(d[0], d[1]);
    });

    // 2. servicios
    db.exec(`
      CREATE TABLE IF NOT EXISTS servicios (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nombre TEXT NOT NULL,
        descripcion TEXT,
        duracion_min INTEGER DEFAULT 60,
        precio REAL,
        imagen TEXT,
        activo INTEGER DEFAULT 1,
        orden INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    const countServicios = db.prepare('SELECT COUNT(*) as count FROM servicios').get();
    if (countServicios.count === 0) {
      db.prepare('INSERT INTO servicios (nombre, descripcion, duracion_min, precio, orden) VALUES (?, ?, ?, ?, ?)').run('Diseño de Cejas', 'Diseño personalizado adaptado a la forma de tu rostro para realzar tu mirada natural.', 45, 3500, 1);
      db.prepare('INSERT INTO servicios (nombre, descripcion, duracion_min, precio, orden) VALUES (?, ?, ?, ?, ?)').run('Laminado de Cejas', 'Tratamiento que alisa y fija las cejas dándoles forma y volumen durante semanas.', 60, 5500, 2);
      db.prepare('INSERT INTO servicios (nombre, descripcion, duracion_min, precio, orden) VALUES (?, ?, ?, ?, ?)').run('Microblading', 'Técnica semipermanente pelo a pelo para cejas naturales y definidas.', 120, 25000, 3);
    }

    // 3. galeria
    db.exec(`
      CREATE TABLE IF NOT EXISTS galeria (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        titulo TEXT,
        descripcion TEXT,
        tipo TEXT DEFAULT 'foto',
        archivo_url TEXT NOT NULL,
        thumbnail_url TEXT,
        servicio_id INTEGER REFERENCES servicios(id),
        destacado INTEGER DEFAULT 0,
        antes_url TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 4. turnos
    db.exec(`
      CREATE TABLE IF NOT EXISTS turnos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nombre_cliente TEXT NOT NULL,
        telefono TEXT NOT NULL,
        email TEXT,
        servicio_id INTEGER REFERENCES servicios(id),
        fecha TEXT NOT NULL,
        hora TEXT NOT NULL,
        estado TEXT DEFAULT 'pendiente',
        notas TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 5. testimonios
    db.exec(`
      CREATE TABLE IF NOT EXISTS testimonios (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nombre_cliente TEXT NOT NULL,
        texto TEXT NOT NULL,
        calificacion INTEGER DEFAULT 5,
        foto_url TEXT,
        aprobado INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 6. admin_users
    db.exec(`
      CREATE TABLE IF NOT EXISTS admin_users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        nombre TEXT
      )
    `);

    // 7. horarios_bloqueados
    db.exec(`
      CREATE TABLE IF NOT EXISTS horarios_bloqueados (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        fecha TEXT NOT NULL,
        motivo TEXT
      )
    `);

    db.save();
    return db;
  })();
  return initPromise;
}

function getDb() {
  if (!db) throw new Error('Database not initialized. Call initDatabase() first.');
  return db;
}

function getConfig(clave) {
  const row = getDb().prepare('SELECT valor FROM configuracion WHERE clave = ?').get(clave);
  return row ? row.valor : null;
}

function getAllConfig() {
  const rows = getDb().prepare('SELECT clave, valor FROM configuracion').all();
  const config = {};
  rows.forEach(row => {
    config[row.clave] = row.valor;
  });
  return config;
}

function seedAdmin(email, passwordPlain) {
  const count = getDb().prepare('SELECT COUNT(*) as count FROM admin_users').get();
  if (count.count === 0) {
    const hash = bcrypt.hashSync(passwordPlain, 10);
    getDb().prepare('INSERT INTO admin_users (email, password_hash, nombre) VALUES (?, ?, ?)').run(email, hash, 'Admin');
  }
}

module.exports = {
  initDatabase,
  getDb,
  getConfig,
  getAllConfig,
  seedAdmin
};
