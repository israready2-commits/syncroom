/* ================================
   SyncRoom — Google Drive con OAuth2
   Igual que Rave: el host hace login con Google,
   obtenemos el access_token, y lo usamos para
   hacer streaming via Drive API v3.
   ================================ */

const driveState = {
  accessToken: null,
  tokenExpiry: null,
};

// Scope mínimo: solo lectura de archivos
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';

/**
 * Inicializa Google Identity Services y el Picker.
 * onFileSelected({ fileId, fileName, accessToken }) — callback al seleccionar
 */
function initGooglePicker(onFileSelected) {
  // Cargar Google Identity Services
  if (!document.getElementById('gis-script')) {
    const gis = document.createElement('script');
    gis.id  = 'gis-script';
    gis.src = 'https://accounts.google.com/gsi/client';
    gis.async = true;
    document.head.appendChild(gis);
  }

  // Cargar gapi para el Picker
  if (!document.getElementById('gapi-script')) {
    const gapi = document.createElement('script');
    gapi.id  = 'gapi-script';
    gapi.src = 'https://apis.google.com/js/api.js';
    gapi.async = true;
    document.head.appendChild(gapi);
  }

  /**
   * Abre el flujo OAuth2 → Picker → devuelve fileId + accessToken
   */
  window.openDrivePicker = function() {
    const clientId = window.GOOGLE_CLIENT_ID || '';
    if (!clientId) {
      showToast('⚠️ Google Client ID no configurado — usa el modal de URL', 'error', 5000);
      return;
    }

    // Verificar si ya tenemos un token válido
    if (driveState.accessToken && driveState.tokenExpiry && Date.now() < driveState.tokenExpiry) {
      _abrirPickerConToken(driveState.accessToken, onFileSelected);
      return;
    }

    // Solicitar nuevo token via Google Identity Services
    try {
      const tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: DRIVE_SCOPE,
        callback: (response) => {
          if (response.error) {
            showToast('Error al autenticar con Google: ' + response.error, 'error');
            return;
          }
          driveState.accessToken = response.access_token;
          // El token dura 3600s, guardamos expiración con margen de 5 min
          driveState.tokenExpiry = Date.now() + (response.expires_in - 300) * 1000;
          _abrirPickerConToken(response.access_token, onFileSelected);
        }
      });
      tokenClient.requestAccessToken({ prompt: '' });
    } catch (err) {
      showToast('Error de autenticación Google. Usa el modal de URL como alternativa.', 'error');
      console.error('[Drive]', err);
    }
  };
}

function _abrirPickerConToken(token, onFileSelected) {
  const apiKey = window.GOOGLE_API_KEY || '';

  // Cargar el módulo picker de gapi
  gapi.load('picker', () => {
    // Vista de videos en Drive
    const videoView = new google.picker.DocsView()
      .setIncludeFolders(true)
      .setSelectFolderEnabled(false)
      .setMimeTypes('video/mp4,video/webm,video/quicktime,video/x-msvideo,video/mpeg,video/*');

    const builder = new google.picker.PickerBuilder()
      .addView(videoView)
      .setOAuthToken(token)
      .setCallback((data) => {
        if (data.action === google.picker.Action.PICKED) {
          const doc = data.docs[0];
          onFileSelected({
            fileId: doc.id,
            fileName: doc.name,
            accessToken: token,   // ← clave: pasar el token junto con el fileId
          });
        }
      });

    if (apiKey) builder.setDeveloperKey(apiKey);

    builder.build().setVisible(true);
  });
}

/**
 * Construye la URL de stream autenticado via nuestro proxy.
 * Esta URL se mete directo en el <video src="">.
 */
function buildDriveStreamUrl(fileId, accessToken) {
  return `/api/drive-stream/${fileId}?token=${encodeURIComponent(accessToken)}`;
}

/**
 * Extrae el videoId de una URL de YouTube.
 */
function parseYouTubeId(url) {
  if (!url) return null;
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/,
    /^([a-zA-Z0-9_-]{11})$/
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}

/**
 * Extrae el fileId de una URL de Google Drive.
 */
function parseDriveId(url) {
  if (!url) return null;
  const patterns = [
    /\/file\/d\/([a-zA-Z0-9_-]{10,})/,
    /id=([a-zA-Z0-9_-]{10,})/,
    /open\?id=([a-zA-Z0-9_-]{10,})/,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  // Si parece un ID directo
  if (/^[a-zA-Z0-9_-]{25,}$/.test(url.trim())) return url.trim();
  return null;
}
