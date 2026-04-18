/* ================================
   SyncRoom — Avatar helpers (DiceBear)
   ================================ */

/**
 * Genera la URL del avatar basado en el nombre del usuario.
 * El mismo nombre siempre produce el mismo avatar.
 */
function getAvatarUrl(name) {
  const seed = encodeURIComponent((name || 'guest').trim().toLowerCase());
  return `https://api.dicebear.com/9.x/adventurer/svg?seed=${seed}&backgroundColor=b6e3f4,c0aede,d1d4f9,ffd5dc,ffdfbf`;
}

/**
 * Crea un elemento <img> con el avatar.
 */
function createAvatarImg(name, size = 48) {
  const img = document.createElement('img');
  img.src = getAvatarUrl(name);
  img.alt = `Avatar de ${name}`;
  img.width = size;
  img.height = size;
  img.style.borderRadius = '50%';
  img.style.display = 'block';
  return img;
}

/**
 * Actualiza el src de un <img> existente.
 */
function updateAvatarImg(imgEl, name) {
  imgEl.src = getAvatarUrl(name);
  imgEl.alt = `Avatar de ${name || 'guest'}`;
}
