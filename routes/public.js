const express = require('express');
const router = express.Router();
const { getDb, getAllConfig } = require('../database/init');
const nodemailer = require('nodemailer');
const PDFDocument = require('pdfkit');

router.get('/', async (req, res) => {
  const db = getDb();
  const servicios = await db.prepare('SELECT * FROM servicios WHERE activo = 1 ORDER BY orden ASC').all();
  const galeria = await db.prepare('SELECT * FROM galeria WHERE destacado = 1 ORDER BY created_at DESC LIMIT 6').all();
  const testimonios = await db.prepare('SELECT * FROM testimonios WHERE aprobado = 1 ORDER BY created_at DESC').all();
  res.render('home', { servicios, galeria, testimonios });
});

router.get('/servicios', async (req, res) => {
  const db = getDb();
  const servicios = await db.prepare('SELECT * FROM servicios WHERE activo = 1 ORDER BY orden ASC').all();
  res.render('servicios', { servicios });
});

router.get('/galeria', async (req, res) => {
  const db = getDb();
  const items = await db.prepare('SELECT * FROM galeria ORDER BY created_at DESC').all();
  const servicios = await db.prepare('SELECT * FROM servicios WHERE activo = 1 ORDER BY orden ASC').all();
  res.render('galeria', { items, servicios });
});

router.get('/agendar', async (req, res) => {
  const db = getDb();
  const servicios = await db.prepare('SELECT * FROM servicios WHERE activo = 1 ORDER BY orden ASC').all();
  
  let turnoConfirmado = null;
  if (req.query.success && req.query.turno) {
    turnoConfirmado = await db.prepare(`
      SELECT t.*, s.nombre as servicio_nombre 
      FROM turnos t 
      LEFT JOIN servicios s ON t.servicio_id = s.id 
      WHERE t.id = ?
    `).get(req.query.turno);
  }
  
  res.render('agendar', { servicios, success: req.query.success, error: null, servicio: req.query.servicio, turnoConfirmado });
});

router.get('/agendar/comprobante/:id', async (req, res) => {
  try {
    const db = getDb();
    const turno = await db.prepare(`
      SELECT t.*, s.nombre as servicio_nombre 
      FROM turnos t 
      LEFT JOIN servicios s ON t.servicio_id = s.id 
      WHERE t.id = ?
    `).get(req.params.id);

    if (!turno) {
      return res.status(404).send('Turno no encontrado');
    }

    const config = await getAllConfig();
    const fParts = turno.fecha.split('-');
    const fStr = fParts[2] + '/' + fParts[1] + '/' + fParts[0];

    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const buffers = [];
    
    await new Promise((resolve, reject) => {
      doc.on('data', buffers.push.bind(buffers));
      doc.on('end', resolve);
      doc.on('error', reject);
      
      // PDF Content
      doc.rect(0, 0, doc.page.width, 120).fill(config.color_primario || '#C9A96E');
      doc.fontSize(24).fillColor('#ffffff').text(config.nombre_negocio || 'LU CEJAS', 50, 40, { align: 'center' });
      doc.fontSize(12).fillColor('#ffffff').text('COMPROBANTE DE TURNO', 50, 75, { align: 'center' });
      doc.moveDown(4);
      
      doc.fontSize(16).fillColor('#333333').text('Detalles de la Reserva:', { underline: true });
      doc.moveDown(1);
      
      doc.fontSize(14).fillColor('#555555');
      doc.text(`Cliente: `, { continued: true }).fillColor('#000000').text(turno.nombre_cliente);
      doc.moveDown(0.5);
      doc.fillColor('#555555').text(`Servicio: `, { continued: true }).fillColor('#000000').text(turno.servicio_nombre || '-');
      doc.moveDown(0.5);
      doc.fillColor('#555555').text(`Fecha: `, { continued: true }).fillColor('#000000').text(fStr);
      doc.moveDown(0.5);
      doc.fillColor('#555555').text(`Hora: `, { continued: true }).fillColor('#000000').text(`${turno.hora} hs`);
      doc.moveDown(0.5);
      doc.fillColor('#555555').text(`Dirección: `, { continued: true }).fillColor('#000000').text(config.direccion || '-');
      
      doc.moveDown(3);
      doc.fontSize(12).fillColor('#888888').text(config.email_mensaje_agradecimiento || `¡Gracias por elegir ${config.nombre_negocio || 'nosotros'}! Te esperamos.`, { align: 'center' });
      
      doc.end();
    });

    const pdfData = Buffer.concat(buffers);
    res.setHeader('Content-Length', Buffer.byteLength(pdfData));
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-disposition', `attachment; filename="Turno-LuCejas-${turno.id}.pdf"`);
    res.send(pdfData);
  } catch (error) {
    console.error('PDF Error:', error);
    res.status(500).send('Error generando PDF: ' + (error.message || error.toString()));
  }
});

router.post('/agendar', async (req, res) => {
  const db = getDb();
  const { nombre_cliente, telefono, email, servicio_id, fecha, hora, notas, website } = req.body;

  // Honeypot anti-spam
  if (website) {
    return res.redirect('/agendar');
  }

  if (!nombre_cliente || !telefono || !servicio_id || !fecha || !hora) {
    const servicios = await db.prepare('SELECT * FROM servicios WHERE activo = 1 ORDER BY orden ASC').all();
    return res.render('agendar', { servicios, success: null, error: 'Faltan campos obligatorios' });
  }

  // Check availability
  const check = await db.prepare('SELECT id FROM turnos WHERE fecha = ? AND hora = ? AND estado != ?').get(fecha, hora, 'cancelado');
  if (check) {
    const servicios = await db.prepare('SELECT * FROM servicios WHERE activo = 1 ORDER BY orden ASC').all();
    return res.render('agendar', { servicios, success: null, error: 'El horario seleccionado ya no está disponible' });
  }

  const insertResult = await db.prepare('INSERT INTO turnos (nombre_cliente, telefono, email, servicio_id, fecha, hora, notas) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(nombre_cliente, telefono, email || null, servicio_id, fecha, hora, notas || null);
  
  const insertedId = insertResult.lastInsertRowid;
  
  // Send email asynchronously if email is provided
  if (email) {
    const config = await getAllConfig();
    if (config.email_user && config.email_pass && config.email_host) {
      const transporter = nodemailer.createTransport({
        host: config.email_host,
        port: parseInt(config.email_port) || 587,
        secure: parseInt(config.email_port) === 465,
        auth: {
          user: config.email_user,
          pass: config.email_pass
        }
      });
      
      const servicioRow = await db.prepare('SELECT nombre FROM servicios WHERE id = ?').get(servicio_id);
      const servicioName = (servicioRow && servicioRow.nombre) || 'Servicio';
      const [year, month, day] = fecha.split('-');
      const formattedDate = `${day}/${month}/${year}`;
      const userMessage = config.email_mensaje_agradecimiento || `¡Gracias por elegir ${config.nombre_negocio || 'nosotros'}! Te esperamos.`;

      const mailOptions = {
        from: `"${config.nombre_negocio || 'Lu Cejas'}" <${config.email_user}>`,
        to: email,
        subject: `Confirmación de Turno - ${config.nombre_negocio || 'Lu Cejas'}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
            <h2 style="color: ${config.color_primario || '#C9A96E'};">¡Hola ${nombre_cliente}!</h2>
            <p>Tu turno ha sido reservado exitosamente.</p>
            <div style="background-color: ${config.color_fondo || '#FAF7F2'}; padding: 15px; border-radius: 5px; margin: 20px 0;">
              <p><strong>Servicio:</strong> ${servicioName}</p>
              <p><strong>Fecha:</strong> ${formattedDate}</p>
              <p><strong>Hora:</strong> ${hora} hs</p>
            </div>
            <p style="white-space: pre-wrap;">${userMessage}</p>
            <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />
            <p style="font-size: 12px; color: #999;">${config.nombre_negocio || 'Lu Cejas'} - ${config.direccion || ''}</p>
          </div>
        `
      };

      await transporter.sendMail(mailOptions).catch(err => console.error('Error sending confirmation email:', err));
    }
  }

  res.redirect('/agendar?success=1&turno=' + insertedId);
});

router.get('/api/horarios-disponibles/:fecha', async (req, res) => {
  const db = getDb();
  const { fecha } = req.params;
  const dateObj = new Date(fecha + 'T12:00:00Z');
  const days = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
  const dayName = days[dateObj.getDay()];
  
  const config = await getAllConfig();
  const horario = config[`horario_${dayName}`];
  
  if (!horario || horario.toLowerCase() === 'cerrado') {
    return res.json([]);
  }

  // Check blocked
  const isBlocked = await db.prepare('SELECT id FROM horarios_bloqueados WHERE fecha = ?').get(fecha);
  if (isBlocked) {
    return res.json([]);
  }

  const [startStr, endStr] = horario.split('-');
  if (!startStr || !endStr) return res.json([]);
  
  let currentMin = parseInt(startStr.split(':')[0]) * 60 + parseInt(startStr.split(':')[1]);
  const endMin = parseInt(endStr.split(':')[0]) * 60 + parseInt(endStr.split(':')[1]);
  const duracion = parseInt(config['duracion_turno_min']) || 60;
  
  const allSlots = [];
  while (currentMin + duracion <= endMin) {
    const h = Math.floor(currentMin / 60).toString().padStart(2, '0');
    const m = (currentMin % 60).toString().padStart(2, '0');
    allSlots.push(`${h}:${m}`);
    currentMin += duracion;
  }

  // Check turnos
  const turnos = await db.prepare('SELECT hora FROM turnos WHERE fecha = ? AND estado != ?').all(fecha, 'cancelado');
  const occupied = turnos.map(t => t.hora);
  
  const available = allSlots.filter(s => !occupied.includes(s));
  res.json(available);
});

router.get('/api/galeria', async (req, res) => {
  const db = getDb();
  let items;
  if (req.query.servicio_id) {
    items = await db.prepare('SELECT * FROM galeria WHERE servicio_id = ? ORDER BY created_at DESC').all(req.query.servicio_id);
  } else {
    items = await db.prepare('SELECT * FROM galeria ORDER BY created_at DESC').all();
  }
  res.json(items);
});

module.exports = router;
