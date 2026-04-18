/* ================================
   SyncRoom — Sistema de Toasts
   ================================ */

// Crear contenedor si no existe
function getToastContainer() {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }
  return container;
}

const MAX_TOASTS = 3;

/**
 * Muestra un toast de notificación.
 * @param {string} message - Texto del toast
 * @param {'info'|'success'|'error'} type - Tipo de toast
 * @param {number} duration - Duración en ms (default 3000)
 */
function showToast(message, type = 'info', duration = 3000) {
  const container = getToastContainer();

  // Máximo 3 toasts visibles
  const existing = container.querySelectorAll('.toast');
  if (existing.length >= MAX_TOASTS) {
    removeToast(existing[0]);
  }

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <div class="toast-dot"></div>
    <span>${message}</span>
  `;

  container.appendChild(toast);

  // Auto-remover
  const timer = setTimeout(() => removeToast(toast), duration);
  toast.dataset.timer = timer;

  // Click para cerrar
  toast.addEventListener('click', () => {
    clearTimeout(toast.dataset.timer);
    removeToast(toast);
  });
}

function removeToast(toast) {
  if (!toast || !toast.parentNode) return;
  toast.classList.add('removing');
  setTimeout(() => toast.parentNode && toast.parentNode.removeChild(toast), 250);
}
