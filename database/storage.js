const path = require('path');
const fs = require('fs');

// Archivos subidos: Supabase Storage (nube, permanente) si hay credenciales;
// si no, disco local (solo desarrollo).
// Variables: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, (opcional) SUPABASE_BUCKET (por defecto "uploads")
const useSupabase = !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
const BUCKET = process.env.SUPABASE_BUCKET || 'uploads';

let supabase = null;
function getSupabase() {
  if (!supabase) {
    const { createClient } = require('@supabase/supabase-js');
    supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false }
    });
  }
  return supabase;
}

const isVercel = process.env.VERCEL === '1';
const localBase = isVercel ? path.join('/tmp', 'uploads') : path.join(__dirname, '..', 'public', 'uploads');

/**
 * Guarda un archivo de multer (memoryStorage) y devuelve la URL publica.
 * @param {object} file   req.file de multer
 * @param {string} folder 'galeria' | 'servicios'
 */
async function saveFile(file, folder) {
  const name = Date.now() + '-' + file.originalname.replace(/[^a-zA-Z0-9.]/g, '_');
  if (useSupabase) {
    const client = getSupabase();
    const objectPath = `${folder}/${name}`;
    const { error } = await client.storage.from(BUCKET).upload(objectPath, file.buffer, {
      contentType: file.mimetype,
      upsert: false
    });
    if (error) throw error;
    return client.storage.from(BUCKET).getPublicUrl(objectPath).data.publicUrl;
  }
  const dir = path.join(localBase, folder);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), file.buffer);
  return `/uploads/${folder}/${name}`;
}

/** Borra un archivo previamente guardado (local o en Supabase Storage). */
async function deleteFile(url) {
  if (!url) return;
  if (/^https?:\/\//.test(url)) {
    if (!useSupabase) return;
    const marker = `/storage/v1/object/public/${BUCKET}/`;
    const idx = url.indexOf(marker);
    if (idx === -1) return;
    const objectPath = decodeURIComponent(url.slice(idx + marker.length));
    try { await getSupabase().storage.from(BUCKET).remove([objectPath]); } catch (e) { /* ignorar */ }
    return;
  }
  const p = path.join(__dirname, '..', 'public', url);
  try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch (e) { /* ignorar */ }
}

module.exports = { saveFile, deleteFile, useSupabase };
