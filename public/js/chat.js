/* ================================
   SyncRoom — Módulo de Chat
   ================================ */

/**
 * Inicializa el chat.
 * @param {string} containerId - ID del contenedor de mensajes
 * @param {string} inputId     - ID del input de texto
 * @param {string} sendBtnId   - ID del botón de enviar
 * @param {string} localUser   - Nombre del usuario local
 */
function initChat(containerId, inputId, sendBtnId, localUser) {
  const container = document.getElementById(containerId);
  const input     = document.getElementById(inputId);
  const sendBtn   = document.getElementById(sendBtnId);

  function enviarMensaje() {
    const text = input.value.trim();
    if (!text) return;
    emitChat(text);
    input.value = '';
    // Animación del botón
    sendBtn.classList.add('sending');
    setTimeout(() => sendBtn.classList.remove('sending'), 400);
  }

  sendBtn.addEventListener('click', enviarMensaje);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      enviarMensaje();
    }
  });

  return {
    addMessage(data) {
      const isOwn = data.userName === localUser;
      const time  = new Date(data.timestamp).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });

      const wrapper = document.createElement('div');
      wrapper.className = `chat-msg ${isOwn ? 'own' : 'other'}`;

      const avatarHtml = `<div class="avatar avatar-sm"><img src="${getAvatarUrl(data.userName)}" alt="${data.userName}" width="32" height="32"></div>`;

      wrapper.innerHTML = `
        ${!isOwn ? avatarHtml : ''}
        <div>
          <div class="chat-meta">${isOwn ? '' : data.userName + ' · '}${time}</div>
          <div class="chat-bubble">${escapeHtml(data.text)}</div>
        </div>
        ${isOwn ? avatarHtml : ''}
      `;

      container.appendChild(wrapper);
      container.scrollTop = container.scrollHeight;
    },

    addSystemMessage(text) {
      const div = document.createElement('div');
      div.className = 'system-msg';
      div.textContent = text;
      container.appendChild(div);
      container.scrollTop = container.scrollHeight;
    }
  };
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.appendChild(document.createTextNode(text));
  return div.innerHTML;
}
