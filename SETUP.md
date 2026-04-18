# SyncRoom — Guía de Configuración

## Requisitos previos

- Node.js 18+ instalado
- Cuenta de Google (para el host)
- Cuenta en Render.com (para el deploy gratuito)

---

## 1. Configurar Google Cloud Console

### Paso 1.1 — Crear un proyecto

1. Ve a [console.cloud.google.com](https://console.cloud.google.com)
2. Haz clic en el selector de proyectos (arriba a la izquierda)
3. Haz clic en **"Nuevo proyecto"**
4. Pon el nombre `syncroom` y haz clic en **Crear**
5. Selecciona ese proyecto

### Paso 1.2 — Habilitar las APIs necesarias

1. Ve al menú ☰ → **APIs y servicios** → **Biblioteca**
2. Busca y habilita **Google Drive API v3**
3. Busca y habilita **Google Picker API**

### Paso 1.3 — Crear credenciales OAuth2

1. Ve a **APIs y servicios** → **Credenciales**
2. Haz clic en **+ Crear credenciales** → **ID de cliente OAuth**
3. Si te pide configurar la pantalla de consentimiento:
   - Selecciona **Externo**
   - Rellena el nombre de la app: `SyncRoom`
   - Correo de asistencia: el tuyo
   - Guarda
4. En **Tipo de aplicación** selecciona **Aplicación web**
5. Nombre: `SyncRoom Web`
6. En **Orígenes de JavaScript autorizados** agrega:
   - `http://localhost:3000` (para desarrollo)
   - `https://tu-app.onrender.com` (para producción)
7. En **URIs de redirección autorizados** agrega:
   - `http://localhost:3000/auth/callback`
   - `https://tu-app.onrender.com/auth/callback`
8. Haz clic en **Crear**
9. Copia el **Client ID** y el **Client Secret**

### Paso 1.4 — Crear una clave de API (para el Picker)

1. En **Credenciales** → **+ Crear credenciales** → **Clave de API**
2. Copia la clave generada
3. (Opcional pero recomendado) Restringe la clave a:
   - Referentes HTTP: `localhost:3000/*` y `tu-app.onrender.com/*`
   - APIs: `Google Picker API`

---

## 2. Configurar variables de entorno

### Para desarrollo local

Crea un archivo `.env` en la raíz del proyecto:

```env
PORT=3000
GOOGLE_CLIENT_ID=tu_client_id_aqui.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=tu_client_secret_aqui
GOOGLE_API_KEY=tu_api_key_aqui
GOOGLE_REDIRECT_URI=http://localhost:3000/auth/callback
```

### Inyectar variables al frontend

En `server.js`, agrega esta ruta para pasar las variables al cliente de forma segura:

```js
app.get('/api/config', (req, res) => {
  res.json({
    googleClientId: process.env.GOOGLE_CLIENT_ID || '',
    googleApiKey: process.env.GOOGLE_API_KEY || ''
  });
});
```

Y en cada HTML que use Drive, antes de cargar `drive.js`:

```html
<script>
  fetch('/api/config').then(r => r.json()).then(cfg => {
    window.GOOGLE_CLIENT_ID = cfg.googleClientId;
    window.GOOGLE_API_KEY = cfg.googleApiKey;
  });
</script>
```

---

## 3. Instalar y correr localmente

```bash
# Instalar dependencias
npm install

# Desarrollo (con auto-reload)
npm run dev

# Producción
npm start
```

Abre `http://localhost:3000` en el navegador.

---

## 4. Compartir videos de Google Drive

Para que el invitado (sin cuenta) pueda ver el video:

1. El host selecciona un video de su Drive con el Picker
2. En Google Drive, el host debe asegurarse de que el archivo tenga permisos:
   - **Clic derecho en el archivo** → **Compartir**
   - En "Acceso general" selecciona **"Cualquier persona con el enlace"**
   - Rol: **Lector**
3. El invitado cargará automáticamente el mismo embed URL

---

## 5. Desplegar en Render.com (gratis)

### Paso 5.1 — Subir el código a GitHub

```bash
git init
git add .
git commit -m "Initial SyncRoom commit"
git remote add origin https://github.com/tu-usuario/syncroom.git
git push -u origin main
```

### Paso 5.2 — Crear servicio en Render

1. Ve a [render.com](https://render.com) y crea una cuenta
2. Haz clic en **New** → **Web Service**
3. Conecta tu repositorio de GitHub
4. Configura:
   - **Name:** `syncroom`
   - **Runtime:** `Node`
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Plan:** `Free`

### Paso 5.3 — Agregar variables de entorno en Render

En la sección **Environment** del servicio, agrega:

| Variable | Valor |
|----------|-------|
| `GOOGLE_CLIENT_ID` | tu_client_id.apps.googleusercontent.com |
| `GOOGLE_CLIENT_SECRET` | tu_client_secret |
| `GOOGLE_API_KEY` | tu_api_key |
| `GOOGLE_REDIRECT_URI` | https://tu-app.onrender.com/auth/callback |
| `NODE_ENV` | production |

### Paso 5.4 — Actualizar orígenes en Google Cloud

Una vez que tengas la URL de Render (ej: `https://syncroom-abc.onrender.com`), vuelve a Google Cloud Console y agrega esa URL en los **Orígenes autorizados** y **URIs de redirección**.

---

## 6. Notas importantes

### ⚠️ Plan gratuito de Render
- El servicio gratuito se "duerme" después de 15 minutos de inactividad
- Al despertar tarda ~30-60 segundos
- Para uso continuo, considera el plan Starter ($7/mes)

### ⚠️ Sin persistencia de datos
- Toda la información está en memoria
- Si el servidor se reinicia, las salas activas desaparecen
- Esto es por diseño (privacidad y simplicidad)

### ⚠️ Videos de Drive
- Los videos deben estar en el Drive del host
- Los archivos deben ser compartidos como "cualquiera con el enlace"
- Formatos recomendados: MP4, WebM, MOV

### ⚠️ CORS y popups
- El Google Picker abre una ventana popup
- Algunos bloqueadores de popups pueden interferir
- Recomienda a los usuarios desactivar el bloqueador para la app

---

## 7. Solución de problemas frecuentes

### "popup_blocked_by_browser"
→ Desactivar bloqueador de popups para el dominio de la app

### "access_denied" al usar el Picker
→ Verificar que el Client ID esté bien configurado y los orígenes autorizados incluyan tu dominio

### El video no se carga para el invitado
→ Verificar que el archivo en Drive tenga permisos de "cualquiera con el enlace"

### "La sala está llena" para el segundo usuario
→ Esperar unos segundos y reintentar; puede ser un socket que no cerró correctamente

### Socket no conecta en producción
→ Verificar que Render permita WebSockets (está habilitado por defecto en todos los planes)
