const { Pool, types } = require('pg');
const bcrypt = require('bcryptjs');

// BIGINT (COUNT(*), etc.) -> number, para que el codigo existente siga funcionando
types.setTypeParser(20, v => parseInt(v, 10));

// Base de datos: Supabase (PostgreSQL en la nube, permanente).
// Variable requerida: DATABASE_URL (cadena de conexion de Supabase).
let pool = null;
function getPool() {
  if (!pool) {
    if (!process.env.DATABASE_URL) {
      throw new Error('Falta la variable de entorno DATABASE_URL (cadena de conexion de Supabase).');
    }
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
      max: 3,
      idleTimeoutMillis: 10000
    });
  }
  return pool;
}

// Permite inyectar un pool (tests)
function setPool(p) { pool = p; }

// Convierte placeholders "?" (estilo SQLite) a $1, $2, ... (PostgreSQL)
function toPg(sql) {
  let i = 0;
  let out = '';
  let inStr = false;
  for (const ch of sql) {
    if (ch === "'") inStr = !inStr;
    if (ch === '?' && !inStr) out += '$' + (++i);
    else out += ch;
  }
  return out;
}

// API asincrona con estilo similar a better-sqlite3:
//   await db.prepare(sql).get(...params) / .all(...params) / .run(...params)
const db = {
  async exec(sql) {
    await getPool().query(sql);
  },

  prepare(sql) {
    return {
      async run(...params) {
        let q = toPg(sql);
        // Para INSERT devolvemos el id generado (reemplaza last_insert_rowid)
        if (/^\s*insert/i.test(q) && !/returning/i.test(q)) q += ' RETURNING id';
        const res = await getPool().query(q, params);
        return {
          changes: res.rowCount,
          lastInsertRowid: res.rows && res.rows[0] ? res.rows[0].id : undefined
        };
      },
      async get(...params) {
        const res = await getPool().query(toPg(sql), params);
        return res.rows[0];
      },
      async all(...params) {
        const res = await getPool().query(toPg(sql), params);
        return res.rows;
      }
    };
  }
};

const NOW_TXT = "to_char(now(), 'YYYY-MM-DD HH24:MI:SS')";

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

let initPromise = null;

function initDatabase() {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const p = getPool();

    const tables = [
      `CREATE TABLE IF NOT EXISTS configuracion (
        id SERIAL PRIMARY KEY,
        clave TEXT UNIQUE,
        valor TEXT,
        tipo TEXT DEFAULT 'text'
      )`,
      `CREATE TABLE IF NOT EXISTS servicios (
        id SERIAL PRIMARY KEY,
        nombre TEXT NOT NULL,
        descripcion TEXT,
        duracion_min INTEGER DEFAULT 60,
        precio DOUBLE PRECISION,
        imagen TEXT,
        activo INTEGER DEFAULT 1,
        orden INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (${NOW_TXT})
      )`,
      `CREATE TABLE IF NOT EXISTS galeria (
        id SERIAL PRIMARY KEY,
        titulo TEXT,
        descripcion TEXT,
        tipo TEXT DEFAULT 'foto',
        archivo_url TEXT NOT NULL,
        thumbnail_url TEXT,
        servicio_id INTEGER REFERENCES servicios(id) ON DELETE SET NULL,
        destacado INTEGER DEFAULT 0,
        antes_url TEXT,
        created_at TEXT DEFAULT (${NOW_TXT})
      )`,
      `CREATE TABLE IF NOT EXISTS turnos (
        id SERIAL PRIMARY KEY,
        nombre_cliente TEXT NOT NULL,
        telefono TEXT NOT NULL,
        email TEXT,
        servicio_id INTEGER REFERENCES servicios(id) ON DELETE SET NULL,
        fecha TEXT NOT NULL,
        hora TEXT NOT NULL,
        estado TEXT DEFAULT 'pendiente',
        notas TEXT,
        created_at TEXT DEFAULT (${NOW_TXT})
      )`,
      `CREATE TABLE IF NOT EXISTS testimonios (
        id SERIAL PRIMARY KEY,
        nombre_cliente TEXT NOT NULL,
        texto TEXT NOT NULL,
        calificacion INTEGER DEFAULT 5,
        foto_url TEXT,
        aprobado INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (${NOW_TXT})
      )`,
      `CREATE TABLE IF NOT EXISTS admin_users (
        id SERIAL PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        nombre TEXT
      )`,
      `CREATE TABLE IF NOT EXISTS horarios_bloqueados (
        id SERIAL PRIMARY KEY,
        fecha TEXT NOT NULL,
        motivo TEXT
      )`
    ];
    for (const sql of tables) await p.query(sql);

    // Configuracion por defecto (no pisa valores existentes)
    for (const d of defaults) {
      await p.query('INSERT INTO configuracion (clave, valor) VALUES ($1, $2) ON CONFLICT (clave) DO NOTHING', d);
    }

    // Servicios de ejemplo (solo si la tabla esta vacia)
    const c = await db.prepare('SELECT COUNT(*) as count FROM servicios').get();
    if (Number(c.count) === 0) {
      const ins = 'INSERT INTO servicios (nombre, descripcion, duracion_min, precio, orden) VALUES ($1, $2, $3, $4, $5)';
      await p.query(ins, ['Diseño de Cejas', 'Diseño personalizado adaptado a la forma de tu rostro para realzar tu mirada natural.', 45, 3500, 1]);
      await p.query(ins, ['Laminado de Cejas', 'Tratamiento que alisa y fija las cejas dándoles forma y volumen durante semanas.', 60, 5500, 2]);
      await p.query(ins, ['Microblading', 'Técnica semipermanente pelo a pelo para cejas naturales y definidas.', 120, 25000, 3]);
    }

    return db;
  })().catch(err => {
    initPromise = null; // permitir reintento en el proximo request
    throw err;
  });
  return initPromise;
}

function getDb() {
  return db;
}

async function getConfig(clave) {
  const row = await db.prepare('SELECT valor FROM configuracion WHERE clave = ?').get(clave);
  return row ? row.valor : null;
}

async function getAllConfig() {
  const rows = await db.prepare('SELECT clave, valor FROM configuracion').all();
  const config = {};
  rows.forEach(row => {
    config[row.clave] = row.valor;
  });
  return config;
}

async function seedAdmin(email, passwordPlain) {
  const count = await db.prepare('SELECT COUNT(*) as count FROM admin_users').get();
  if (Number(count.count) === 0) {
    const hash = bcrypt.hashSync(passwordPlain, 10);
    await db.prepare('INSERT INTO admin_users (email, password_hash, nombre) VALUES (?, ?, ?)').run(email, hash, 'Admin');
  }
}

module.exports = {
  initDatabase,
  getDb,
  getConfig,
  getAllConfig,
  seedAdmin,
  setPool
};
