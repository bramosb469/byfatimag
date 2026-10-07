const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { getDb } = require('../database/init');
const { requireAuth } = require('../middleware/auth');

const { saveFile, deleteFile } = require('../database/storage');

// Multer config (en memoria: el archivo se sube luego a Supabase Storage)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 4 * 1024 * 1024 }, // 4MB (limite de Vercel por request: 4.5MB)
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/') || file.mimetype.startsWith('video/')) {
      cb(null, true);
    } else {
      cb(null, false);
    }
  }
});

router.get('/login', async (req, res) => {
  res.render('admin/login', { error: null });
});

router.post('/login', async (req, res) => {
  const db = getDb();
  const { email, password } = req.body;
  const user = await db.prepare('SELECT * FROM admin_users WHERE email = ?').get(email);
  if (user && bcrypt.compareSync(password, user.password_hash)) {
    req.session.adminId = user.id;
    req.session.adminName = user.nombre;
    res.redirect('/admin');
  } else {
    res.render('admin/login', { error: 'Credenciales inválidas' });
  }
});

router.get('/logout', async (req, res) => {
  req.session = null;
  res.redirect('/admin/login');
});

router.use(requireAuth);

router.get('/dashboard', async (req, res) => {
  res.redirect('/admin');
});

router.get('/', async (req, res) => {
  const db = getDb();
  const hoy = new Date().toISOString().split('T')[0];
  const turnosHoy = await db.prepare('SELECT t.*, s.nombre as servicio_nombre FROM turnos t LEFT JOIN servicios s ON t.servicio_id = s.id WHERE t.fecha = ? ORDER BY t.hora ASC').all(hoy);
  
  // Stats
  const now = new Date();
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - now.getDay());
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  
  const semana = await db.prepare('SELECT COUNT(*) as c FROM turnos WHERE fecha >= ?').get(startOfWeek.toISOString().split('T')[0]);
  const pendientes = await db.prepare("SELECT COUNT(*) as c FROM turnos WHERE estado = 'pendiente'").get();
  const mes = await db.prepare('SELECT COUNT(*) as c FROM turnos WHERE fecha >= ?').get(startOfMonth.toISOString().split('T')[0]);
  
  const stats = {
    semana: semana.c,
    pendientes: pendientes.c,
    mes: mes.c
  };

  const proximosTurnos = await db.prepare('SELECT t.*, s.nombre as servicio_nombre FROM turnos t LEFT JOIN servicios s ON t.servicio_id = s.id WHERE t.fecha >= ? AND t.estado != ? ORDER BY t.fecha ASC, t.hora ASC LIMIT 5').all(hoy, 'cancelado');
  
  res.render('admin/dashboard', { turnosHoy, stats, proximosTurnos });
});

// CALENDARIO
router.get('/calendario', async (req, res) => {
  const db = getDb();
  const servicios = await db.prepare('SELECT id, nombre FROM servicios').all();
  res.render('admin/calendario', { msg: req.query.msg, servicios });
});

router.get('/api/turnos', async (req, res) => {
  const db = getDb();
  // We want to return JSON for FullCalendar. Needs title, start, end, color.
  const turnos = await db.prepare(`
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
router.get('/turnos', async (req, res) => {
  const db = getDb();
  const { estado, fecha_desde, fecha_hasta, servicio_id } = req.query;
  let q = 'SELECT t.*, s.nombre as servicio_nombre FROM turnos t LEFT JOIN servicios s ON t.servicio_id = s.id WHERE 1=1';
  const params = [];
  if (estado) { q += ' AND t.estado = ?'; params.push(estado); }
  if (fecha_desde) { q += ' AND t.fecha >= ?'; params.push(fecha_desde); }
  if (fecha_hasta) { q += ' AND t.fecha <= ?'; params.push(fecha_hasta); }
  if (servicio_id) { q += ' AND t.servicio_id = ?'; params.push(servicio_id); }
  q += ' ORDER BY t.fecha DESC, t.hora ASC';
  
  const turnos = await db.prepare(q).all(...params);
  const servicios = await db.prepare('SELECT id, nombre FROM servicios').all();
  res.render('admin/turnos', { turnos, servicios, filters: req.query });
});

router.post('/turnos/:id/estado', async (req, res) => {
  const db = getDb();
  await db.prepare('UPDATE turnos SET estado = ? WHERE id = ?').run(req.body.estado, req.params.id);
  
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

router.post('/turnos/:id/delete', async (req, res) => {
  const db = getDb();
  await db.prepare('DELETE FROM turnos WHERE id = ?').run(req.params.id);
  const ref = req.get('Referer'); res.redirect(ref && ref.includes('/admin') ? ref : '/admin');
});

router.post('/turnos/nuevo', async (req, res) => {
  const db = getDb();
  const { nombre_cliente, telefono, email, servicio_id, fecha, hora, notas } = req.body;
  await db.prepare('INSERT INTO turnos (nombre_cliente, telefono, email, servicio_id, fecha, hora, notas, estado) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(nombre_cliente, telefono, email || null, servicio_id, fecha, hora, notas || null, 'confirmado');
  const ref = req.get('Referer'); res.redirect(ref && ref.includes('/admin') ? ref : '/admin');
});

// SERVICIOS
router.get('/servicios', async (req, res) => {
  const db = getDb();
  const servicios = await db.prepare('SELECT * FROM servicios ORDER BY orden ASC').all();
  res.render('admin/servicios', { servicios });
});

router.post('/servicios/nuevo', upload.single('imagen'), async (req, res) => {
  const db = getDb();
  const { nombre, descripcion, duracion_min, precio, orden } = req.body;
  const imagenUrl = req.file ? await saveFile(req.file, 'servicios') : null;
  await db.prepare('INSERT INTO servicios (nombre, descripcion, duracion_min, precio, orden, imagen) VALUES (?, ?, ?, ?, ?, ?)')
    .run(nombre || 'Sin nombre', descripcion || null, duracion_min || 60, precio || 0, orden || 0, imagenUrl);
  const ref = req.get('Referer'); res.redirect(ref && ref.includes('/admin') ? ref : '/admin');
});

router.post('/servicios/:id/editar', upload.single('imagen'), async (req, res) => {
  const db = getDb();
  const { nombre, descripcion, duracion_min, precio, orden } = req.body;
  if (req.file) {
    const imagenUrl = await saveFile(req.file, 'servicios');
    await db.prepare('UPDATE servicios SET nombre=?, descripcion=?, duracion_min=?, precio=?, orden=?, imagen=? WHERE id=?')
      .run(nombre || 'Sin nombre', descripcion || null, duracion_min || 60, precio || 0, orden || 0, imagenUrl, req.params.id);
  } else {
    await db.prepare('UPDATE servicios SET nombre=?, descripcion=?, duracion_min=?, precio=?, orden=? WHERE id=?')
      .run(nombre || 'Sin nombre', descripcion || null, duracion_min || 60, precio || 0, orden || 0, req.params.id);
  }
  const ref = req.get('Referer'); res.redirect(ref && ref.includes('/admin') ? ref : '/admin');
});

router.post('/servicios/:id/toggle', async (req, res) => {
  const db = getDb();
  await db.prepare('UPDATE servicios SET activo = CASE WHEN activo = 1 THEN 0 ELSE 1 END WHERE id = ?').run(req.params.id);
  const ref = req.get('Referer'); res.redirect(ref && ref.includes('/admin') ? ref : '/admin');
});

router.post('/servicios/:id/delete', async (req, res) => {
  const db = getDb();
  await db.prepare('DELETE FROM servicios WHERE id = ?').run(req.params.id);
  const ref = req.get('Referer'); res.redirect(ref && ref.includes('/admin') ? ref : '/admin');
});

// GALERIA
router.get('/galeria', async (req, res) => {
  const db = getDb();
  const items = await db.prepare('SELECT g.*, s.nombre as servicio_nombre FROM galeria g LEFT JOIN servicios s ON g.servicio_id = s.id ORDER BY g.created_at DESC').all();
  const servicios = await db.prepare('SELECT id, nombre FROM servicios').all();
  res.render('admin/galeria', { items, servicios });
});

router.post('/galeria/upload', upload.fields([{ name: 'archivo', maxCount: 1 }, { name: 'archivo_antes', maxCount: 1 }]), async (req, res) => {
  const db = getDb();
  const { titulo, descripcion, servicio_id, destacado, tipo } = req.body;
  
  if (req.files && req.files['archivo'] && req.files['archivo'][0]) {
    const file = req.files['archivo'][0];
    const archivo_url = await saveFile(file, 'galeria');
    
    let antes_url = null;
    if (req.files['archivo_antes'] && req.files['archivo_antes'][0]) {
      antes_url = await saveFile(req.files['archivo_antes'][0], 'galeria');
    }
    
    await db.prepare('INSERT INTO galeria (titulo, descripcion, servicio_id, destacado, tipo, archivo_url, antes_url) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(titulo || '', descripcion || '', servicio_id || null, destacado ? 1 : 0, tipo || 'foto', archivo_url, antes_url);
  }
  
  const ref = req.get('Referer'); res.redirect(ref && ref.includes('/admin') ? ref : '/admin');
});

router.post('/galeria/:id/editar', async (req, res) => {
  const db = getDb();
  const { titulo, descripcion, servicio_id } = req.body;
  await db.prepare('UPDATE galeria SET titulo=?, descripcion=?, servicio_id=? WHERE id=?').run(titulo || null, descripcion || null, servicio_id || null, req.params.id);
  const ref = req.get('Referer'); res.redirect(ref && ref.includes('/admin') ? ref : '/admin');
});

router.post('/galeria/:id/toggle-destacado', async (req, res) => {
  const db = getDb();
  await db.prepare('UPDATE galeria SET destacado = CASE WHEN destacado = 1 THEN 0 ELSE 1 END WHERE id = ?').run(req.params.id);
  const ref = req.get('Referer'); res.redirect(ref && ref.includes('/admin') ? ref : '/admin');
});

router.post('/galeria/:id/delete', async (req, res) => {
  const db = getDb();
  const item = await db.prepare('SELECT archivo_url, antes_url FROM galeria WHERE id = ?').get(req.params.id);
  if (item) {
    await deleteFile(item.archivo_url);
    await deleteFile(item.antes_url);
  }
  await db.prepare('DELETE FROM galeria WHERE id = ?').run(req.params.id);
  const ref = req.get('Referer'); res.redirect(ref && ref.includes('/admin') ? ref : '/admin');
});

// TESTIMONIOS
router.get('/testimonios', async (req, res) => {
  const db = getDb();
  const testimonios = await db.prepare('SELECT * FROM testimonios ORDER BY created_at DESC').all();
  res.render('admin/testimonios', { testimonios });
});

router.post('/testimonios/:id/aprobar', async (req, res) => {
  const db = getDb();
  await db.prepare('UPDATE testimonios SET aprobado = 1 WHERE id = ?').run(req.params.id);
  const ref = req.get('Referer'); res.redirect(ref && ref.includes('/admin') ? ref : '/admin');
});

router.post('/testimonios/:id/rechazar', async (req, res) => {
  const db = getDb();
  await db.prepare('UPDATE testimonios SET aprobado = 0 WHERE id = ?').run(req.params.id);
  const ref = req.get('Referer'); res.redirect(ref && ref.includes('/admin') ? ref : '/admin');
});

router.post('/testimonios/:id/delete', async (req, res) => {
  const db = getDb();
  await db.prepare('DELETE FROM testimonios WHERE id = ?').run(req.params.id);
  const ref = req.get('Referer'); res.redirect(ref && ref.includes('/admin') ? ref : '/admin');
});

router.post('/testimonios/nuevo', async (req, res) => {
  const db = getDb();
  const { nombre_cliente, texto, calificacion } = req.body;
  await db.prepare('INSERT INTO testimonios (nombre_cliente, texto, calificacion, aprobado) VALUES (?, ?, ?, 1)')
    .run(nombre_cliente, texto, calificacion || 5);
  const ref = req.get('Referer'); res.redirect(ref && ref.includes('/admin') ? ref : '/admin');
});

// CONFIGURACION
router.get('/configuracion', async (req, res) => {
  const db = getDb();
  const blockedDates = await db.prepare('SELECT * FROM horarios_bloqueados ORDER BY fecha ASC').all();
  const adminUser = await db.prepare('SELECT email, nombre FROM admin_users WHERE id = ?').get(req.session.adminId);
  res.render('admin/configuracion', { blockedDates, msg: req.query.msg, errorMsg: req.query.error, adminUser });
});

router.post('/cuenta', async (req, res) => {
  const db = getDb();
  const { email, nombre, password, password_confirm } = req.body;
  
  if (password && password !== password_confirm) {
    return res.redirect('/admin/configuracion?error=Las+contraseñas+no+coinciden');
  }

  if (password) {
    const hash = bcrypt.hashSync(password, 10);
    await db.prepare('UPDATE admin_users SET email = ?, nombre = ?, password_hash = ? WHERE id = ?')
      .run(email, nombre || 'Admin', hash, req.session.adminId);
  } else {
    await db.prepare('UPDATE admin_users SET email = ?, nombre = ? WHERE id = ?')
      .run(email, nombre || 'Admin', req.session.adminId);
  }
  
  // Update session name if changed
  if (nombre) req.session.adminName = nombre;

  res.redirect('/admin/configuracion?msg=cuenta_ok');
});

router.post('/configuracion', async (req, res) => {
  const db = getDb();
  if (req.body.config) {
    for (const [clave, valor] of Object.entries(req.body.config)) {
      await db.prepare('INSERT INTO configuracion (clave, valor) VALUES (?, ?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor').run(clave, valor);
    }
  }
  res.redirect('/admin/configuracion?msg=ok');
});

router.post('/horarios-bloqueados/nuevo', async (req, res) => {
  const db = getDb();
  await db.prepare('INSERT INTO horarios_bloqueados (fecha, motivo) VALUES (?, ?)').run(req.body.fecha, req.body.motivo || '');
  res.redirect('/admin/configuracion');
});

router.post('/horarios-bloqueados/:id/delete', async (req, res) => {
  const db = getDb();
  await db.prepare('DELETE FROM horarios_bloqueados WHERE id = ?').run(req.params.id);
  res.redirect('/admin/configuracion');
});

module.exports = router;
