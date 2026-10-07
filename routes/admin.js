const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { getDb } = require('../database/init');
const { requireAuth } = require('../middleware/auth');

// Ensure upload directories exist
const uploadsBase = process.env.VERCEL === '1'
  ? path.join('/tmp', 'public', 'uploads')
  : path.join(__dirname, '..', 'public', 'uploads');
const galeriaDir = path.join(uploadsBase, 'galeria');
const serviciosDir = path.join(uploadsBase, 'servicios');
[uploadsBase, galeriaDir, serviciosDir].forEach(dir => {
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  } catch (e) {
    console.error('No se pudo crear', dir, e.message);
  }
});

// Multer config
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    let dest = uploadsBase;
    if (req.originalUrl.includes('/galeria')) {
      dest = galeriaDir;
    } else {
      dest = serviciosDir;
    }
    cb(null, dest);
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + '-' + file.originalname.replace(/[^a-zA-Z0-9.]/g, '_'));
  }
});
const upload = multer({
  storage: storage,
  limits: { fileSize: 150 * 1024 * 1024 }, // 150MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/') || file.mimetype.startsWith('video/')) {
      cb(null, true);
    } else {
      cb(null, false);
    }
  }
});

router.get('/login', (req, res) => {
  res.render('admin/login', { error: null });
});

router.post('/login', (req, res) => {
  const db = getDb();
  const { email, password } = req.body;
  const user = db.prepare('SELECT * FROM admin_users WHERE email = ?').get(email);
  if (user && bcrypt.compareSync(password, user.password_hash)) {
    req.session.adminId = user.id;
    req.session.adminName = user.nombre;
    res.redirect('/admin');
  } else {
    res.render('admin/login', { error: 'Credenciales inválidas' });
  }
});

router.get('/logout', (req, res) => {
  req.session = null;
  res.redirect('/admin/login');
});

router.use(requireAuth);

router.get('/dashboard', (req, res) => {
  res.redirect('/admin');
});

router.get('/', (req, res) => {
  const db = getDb();
  const hoy = new Date().toISOString().split('T')[0];
  const turnosHoy = db.prepare('SELECT t.*, s.nombre as servicio_nombre FROM turnos t LEFT JOIN servicios s ON t.servicio_id = s.id WHERE t.fecha = ? ORDER BY t.hora ASC').all(hoy);
  
  // Stats
  const now = new Date();
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - now.getDay());
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  
  const semana = db.prepare('SELECT COUNT(*) as c FROM turnos WHERE fecha >= ?').get(startOfWeek.toISOString().split('T')[0]);
  const pendientes = db.prepare("SELECT COUNT(*) as c FROM turnos WHERE estado = 'pendiente'").get();
  const mes = db.prepare('SELECT COUNT(*) as c FROM turnos WHERE fecha >= ?').get(startOfMonth.toISOString().split('T')[0]);
  
  const stats = {
    semana: semana.c,
    pendientes: pendientes.c,
    mes: mes.c
  };

  const proximosTurnos = db.prepare('SELECT t.*, s.nombre as servicio_nombre FROM turnos t LEFT JOIN servicios s ON t.servicio_id = s.id WHERE t.fecha >= ? AND t.estado != ? ORDER BY t.fecha ASC, t.hora ASC LIMIT 5').all(hoy, 'cancelado');
  
  res.render('admin/dashboard', { turnosHoy, stats, proximosTurnos });
});

// CALENDARIO
router.get('/calendario', (req, res) => {
  const db = getDb();
  const servicios = db.prepare('SELECT id, nombre FROM servicios').all();
  res.render('admin/calendario', { msg: req.query.msg, servicios });
});

router.get('/api/turnos', (req, res) => {
  const db = getDb();
  // We want to return JSON for FullCalendar. Needs title, start, end, color.
  const turnos = db.prepare(`
    SELECT t.*, s.nombre as servicio_nombre, s.duracion_min 
    FROM turnos t 
    LEFT JOIN servicios s ON t.servicio_id = s.id 
    WHERE t.estado != 'cancelado'
  `).all();
  
  const events = turnos.map(t => {
    const startStr = `${t.fecha}T${t.hora}:00`;
    const startDate = new Date(startStr);
    
    // Add duracion_min
    const duracion = t.duracion_min || 60;
    const endDate = new Date(startDate.getTime() + duracion * 60000);
    
    let color = '#ffc107'; // pendiente - yellow
    if (t.estado === 'confirmado') color = '#0dcaf0'; // info - blue
    if (t.estado === 'completado') color = '#198754'; // success - green
    
    return {
      title: t.nombre_cliente,
      start: startStr,
      end: endDate.toISOString(),
      backgroundColor: color,
      borderColor: color,
      textColor: t.estado === 'pendiente' ? '#000' : '#fff',
      extendedProps: {
        turno_id: t.id,
        estado: t.estado,
        telefono: t.telefono,
        servicio: t.servicio_nombre
      }
    };
  });
  
  res.json(events);
});

// TURNOS
router.get('/turnos', (req, res) => {
  const db = getDb();
  const { estado, fecha_desde, fecha_hasta, servicio_id } = req.query;
  let q = 'SELECT t.*, s.nombre as servicio_nombre FROM turnos t LEFT JOIN servicios s ON t.servicio_id = s.id WHERE 1=1';
  const params = [];
  if (estado) { q += ' AND t.estado = ?'; params.push(estado); }
  if (fecha_desde) { q += ' AND t.fecha >= ?'; params.push(fecha_desde); }
  if (fecha_hasta) { q += ' AND t.fecha <= ?'; params.push(fecha_hasta); }
  if (servicio_id) { q += ' AND t.servicio_id = ?'; params.push(servicio_id); }
  q += ' ORDER BY t.fecha DESC, t.hora ASC';
  
  const turnos = db.prepare(q).all(...params);
  const servicios = db.prepare('SELECT id, nombre FROM servicios').all();
  res.render('admin/turnos', { turnos, servicios, filters: req.query });
});

router.post('/turnos/:id/estado', (req, res) => {
  const db = getDb();
  db.prepare('UPDATE turnos SET estado = ? WHERE id = ?').run(req.body.estado, req.params.id);
  
  if (req.query.from === 'calendario') {
    return res.redirect('/admin/calendario?msg=ok');
  }
  
  // Safe redirect avoiding fallback to public pages if Referer is missing
  const referer = req.get('Referer');
  if (referer && referer.includes('/admin')) {
    res.redirect(referer);
  } else {
    res.redirect('/admin/turnos');
  }
});

router.post('/turnos/:id/delete', (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM turnos WHERE id = ?').run(req.params.id);
  const ref = req.get('Referer'); res.redirect(ref && ref.includes('/admin') ? ref : '/admin');
});

router.post('/turnos/nuevo', (req, res) => {
  const db = getDb();
  const { nombre_cliente, telefono, email, servicio_id, fecha, hora, notas } = req.body;
  db.prepare('INSERT INTO turnos (nombre_cliente, telefono, email, servicio_id, fecha, hora, notas, estado) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(nombre_cliente, telefono, email || null, servicio_id, fecha, hora, notas || null, 'confirmado');
  const ref = req.get('Referer'); res.redirect(ref && ref.includes('/admin') ? ref : '/admin');
});

// SERVICIOS
router.get('/servicios', (req, res) => {
  const db = getDb();
  const servicios = db.prepare('SELECT * FROM servicios ORDER BY orden ASC').all();
  res.render('admin/servicios', { servicios });
});

router.post('/servicios/nuevo', upload.single('imagen'), (req, res) => {
  const db = getDb();
  const { nombre, descripcion, duracion_min, precio, orden } = req.body;
  const imagenUrl = req.file ? `/uploads/servicios/${req.file.filename}` : null;
  db.prepare('INSERT INTO servicios (nombre, descripcion, duracion_min, precio, orden, imagen) VALUES (?, ?, ?, ?, ?, ?)')
    .run(nombre || 'Sin nombre', descripcion || null, duracion_min || 60, precio || 0, orden || 0, imagenUrl);
  const ref = req.get('Referer'); res.redirect(ref && ref.includes('/admin') ? ref : '/admin');
});

router.post('/servicios/:id/editar', upload.single('imagen'), (req, res) => {
  const db = getDb();
  const { nombre, descripcion, duracion_min, precio, orden } = req.body;
  if (req.file) {
    const imagenUrl = `/uploads/servicios/${req.file.filename}`;
    db.prepare('UPDATE servicios SET nombre=?, descripcion=?, duracion_min=?, precio=?, orden=?, imagen=? WHERE id=?')
      .run(nombre || 'Sin nombre', descripcion || null, duracion_min || 60, precio || 0, orden || 0, imagenUrl, req.params.id);
  } else {
    db.prepare('UPDATE servicios SET nombre=?, descripcion=?, duracion_min=?, precio=?, orden=? WHERE id=?')
      .run(nombre || 'Sin nombre', descripcion || null, duracion_min || 60, precio || 0, orden || 0, req.params.id);
  }
  const ref = req.get('Referer'); res.redirect(ref && ref.includes('/admin') ? ref : '/admin');
});

router.post('/servicios/:id/toggle', (req, res) => {
  const db = getDb();
  db.prepare('UPDATE servicios SET activo = CASE WHEN activo = 1 THEN 0 ELSE 1 END WHERE id = ?').run(req.params.id);
  const ref = req.get('Referer'); res.redirect(ref && ref.includes('/admin') ? ref : '/admin');
});

router.post('/servicios/:id/delete', (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM servicios WHERE id = ?').run(req.params.id);
  const ref = req.get('Referer'); res.redirect(ref && ref.includes('/admin') ? ref : '/admin');
});

// GALERIA
router.get('/galeria', (req, res) => {
  const db = getDb();
  const items = db.prepare('SELECT g.*, s.nombre as servicio_nombre FROM galeria g LEFT JOIN servicios s ON g.servicio_id = s.id ORDER BY g.created_at DESC').all();
  const servicios = db.prepare('SELECT id, nombre FROM servicios').all();
  res.render('admin/galeria', { items, servicios });
});

router.post('/galeria/upload', upload.fields([{ name: 'archivo', maxCount: 1 }, { name: 'archivo_antes', maxCount: 1 }]), (req, res) => {
  const db = getDb();
  const { titulo, descripcion, servicio_id, destacado, tipo } = req.body;
  
  if (req.files && req.files['archivo'] && req.files['archivo'][0]) {
    const file = req.files['archivo'][0];
    const archivo_url = `/uploads/galeria/${file.filename}`;
    
    let antes_url = null;
    if (req.files['archivo_antes'] && req.files['archivo_antes'][0]) {
      antes_url = `/uploads/galeria/${req.files['archivo_antes'][0].filename}`;
    }
    
    db.prepare('INSERT INTO galeria (titulo, descripcion, servicio_id, destacado, tipo, archivo_url, antes_url) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(titulo || '', descripcion || '', servicio_id || null, destacado ? 1 : 0, tipo || 'foto', archivo_url, antes_url);
  }
  
  const ref = req.get('Referer'); res.redirect(ref && ref.includes('/admin') ? ref : '/admin');
});

router.post('/galeria/:id/editar', (req, res) => {
  const db = getDb();
  const { titulo, descripcion, servicio_id } = req.body;
  db.prepare('UPDATE galeria SET titulo=?, descripcion=?, servicio_id=? WHERE id=?').run(titulo || null, descripcion || null, servicio_id || null, req.params.id);
  const ref = req.get('Referer'); res.redirect(ref && ref.includes('/admin') ? ref : '/admin');
});

router.post('/galeria/:id/toggle-destacado', (req, res) => {
  const db = getDb();
  db.prepare('UPDATE galeria SET destacado = CASE WHEN destacado = 1 THEN 0 ELSE 1 END WHERE id = ?').run(req.params.id);
  const ref = req.get('Referer'); res.redirect(ref && ref.includes('/admin') ? ref : '/admin');
});

router.post('/galeria/:id/delete', (req, res) => {
  const db = getDb();
  const item = db.prepare('SELECT archivo_url FROM galeria WHERE id = ?').get(req.params.id);
  if (item && item.archivo_url) {
    const p = path.join(__dirname, '..', 'public', item.archivo_url);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
  db.prepare('DELETE FROM galeria WHERE id = ?').run(req.params.id);
  const ref = req.get('Referer'); res.redirect(ref && ref.includes('/admin') ? ref : '/admin');
});

// TESTIMONIOS
router.get('/testimonios', (req, res) => {
  const db = getDb();
  const testimonios = db.prepare('SELECT * FROM testimonios ORDER BY created_at DESC').all();
  res.render('admin/testimonios', { testimonios });
});

router.post('/testimonios/:id/aprobar', (req, res) => {
  const db = getDb();
  db.prepare('UPDATE testimonios SET aprobado = 1 WHERE id = ?').run(req.params.id);
  const ref = req.get('Referer'); res.redirect(ref && ref.includes('/admin') ? ref : '/admin');
});

router.post('/testimonios/:id/rechazar', (req, res) => {
  const db = getDb();
  db.prepare('UPDATE testimonios SET aprobado = 0 WHERE id = ?').run(req.params.id);
  const ref = req.get('Referer'); res.redirect(ref && ref.includes('/admin') ? ref : '/admin');
});

router.post('/testimonios/:id/delete', (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM testimonios WHERE id = ?').run(req.params.id);
  const ref = req.get('Referer'); res.redirect(ref && ref.includes('/admin') ? ref : '/admin');
});

router.post('/testimonios/nuevo', (req, res) => {
  const db = getDb();
  const { nombre_cliente, texto, calificacion } = req.body;
  db.prepare('INSERT INTO testimonios (nombre_cliente, texto, calificacion, aprobado) VALUES (?, ?, ?, 1)')
    .run(nombre_cliente, texto, calificacion || 5);
  const ref = req.get('Referer'); res.redirect(ref && ref.includes('/admin') ? ref : '/admin');
});

// CONFIGURACION
router.get('/configuracion', (req, res) => {
  const db = getDb();
  const blockedDates = db.prepare('SELECT * FROM horarios_bloqueados ORDER BY fecha ASC').all();
  const adminUser = db.prepare('SELECT email, nombre FROM admin_users WHERE id = ?').get(req.session.adminId);
  res.render('admin/configuracion', { blockedDates, msg: req.query.msg, errorMsg: req.query.error, adminUser });
});

router.post('/cuenta', (req, res) => {
  const db = getDb();
  const { email, nombre, password, password_confirm } = req.body;
  
  if (password && password !== password_confirm) {
    return res.redirect('/admin/configuracion?error=Las+contraseñas+no+coinciden');
  }

  if (password) {
    const hash = bcrypt.hashSync(password, 10);
    db.prepare('UPDATE admin_users SET email = ?, nombre = ?, password_hash = ? WHERE id = ?')
      .run(email, nombre || 'Admin', hash, req.session.adminId);
  } else {
    db.prepare('UPDATE admin_users SET email = ?, nombre = ? WHERE id = ?')
      .run(email, nombre || 'Admin', req.session.adminId);
  }
  
  // Update session name if changed
  if (nombre) req.session.adminName = nombre;

  res.redirect('/admin/configuracion?msg=cuenta_ok');
});

router.post('/configuracion', (req, res) => {
  const db = getDb();
  if (req.body.config) {
    const updateFn = db.transaction((conf) => {
      for (const [clave, valor] of Object.entries(conf)) {
        db.prepare('INSERT INTO configuracion (clave, valor) VALUES (?, ?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor').run(clave, valor);
      }
    });
    updateFn(req.body.config);
  }
  res.redirect('/admin/configuracion?msg=ok');
});

router.post('/horarios-bloqueados/nuevo', (req, res) => {
  const db = getDb();
  db.prepare('INSERT INTO horarios_bloqueados (fecha, motivo) VALUES (?, ?)').run(req.body.fecha, req.body.motivo || '');
  res.redirect('/admin/configuracion');
});

router.post('/horarios-bloqueados/:id/delete', (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM horarios_bloqueados WHERE id = ?').run(req.params.id);
  res.redirect('/admin/configuracion');
});

module.exports = router;
