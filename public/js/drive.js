/* ================================
   SyncRoom — Google Drive + Picker
   ================================ */

// Estado OAuth (en memoria)
const driveState = {
  accessToken: null,
  pickerInited: false,
  gapiInited: false
};

const GOOGLE_CLIENT_ID = window.GOOGLE_CLIENT_ID || '';
const GOOGLE_API_KEY   = window.GOOGLE_API_KEY   || '';
const SCOPE = 'https://www.googleapis.com/auth/drive.readonly';

/**
 * Carga las librerías de Google y el Picker.
 */
function initGooglePicker(onFileSelected) {
  // Cargar script de gapi si no existe
  if (!document.getElementById('gapi-script')) {
    const script = document.createElement('script');
    script.id = 'gapi-script';
    script.src = 'https://apis.google.com/js/api.js';
    script.onload = () => {
      gapi.load('client:picker', async () => {
        driveState.gapiInited = true;
        driveState.pickerInited = true;
      });
    };
    document.head.appendChild(script);
  }

  /**
   * Abre el Google Picker para seleccionar un video.
   * Llama a onFileSelected({ fileId, fileName }) al seleccionar.
   */
  window.openDrivePicker = async function() {
    if (!GOOGLE_CLIENT_ID) {
      showToast('⚠️ Google Client ID no configurado — revisa SETUP.md', 'error', 5000);
      return;
    }

    // Solicitar token OAuth
    try {
      const tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: SCOPE,
        callback: (tokenResponse) => {
          driveState.accessToken = tokenResponse.access_token;
          showPicker(onFileSelected);
        }
      });
      tokenClient.requestAccessToken();
    } catch (err) {
      showToast('Error al autenticar con Google', 'error');
      console.error(err);
    }
  };

  // Cargar GIS (Google Identity Services)
  if (!document.getElementById('gis-script')) {
    const gis = document.createElement('script');
    gis.id = 'gis-script';
    gis.src = 'https://accounts.google.com/gsi/client';
    document.head.appendChild(gis);
  }
}

function showPicker(onFileSelected) {
  if (!driveState.accessToken) return;

  gapi.load('picker', () => {
    const view = new google.picker.DocsView(google.picker.ViewId.DOCS_VIDEOS)
      .setIncludeFolders(true)
      .setSelectFolderEnabled(false);

    const picker = new google.picker.PickerBuilder()
      .addView(view)
      .setOAuthToken(driveState.accessToken)
      .setDeveloperKey(GOOGLE_API_KEY)
      .setCallback((data) => {
        if (data.action === google.picker.Action.PICKED) {
          const doc = data.docs[0];
          onFileSelected({ fileId: doc.id, fileName: doc.name });
        }
      })
      .build();

    picker.setVisible(true);
  });
}

/**
 * Extrae el ID de video de una URL de YouTube.
 */
function parseYouTubeId(url) {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/,
    /^([a-zA-Z0-9_-]{11})$/
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}
