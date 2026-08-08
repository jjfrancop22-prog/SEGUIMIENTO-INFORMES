# PEP Enterprise V4.8.0-C — Netlify Production

Paquete web basado en V4.8.0-C estable.

## GitHub
Suba el contenido de esta carpeta a la RAÍZ del repositorio. `index.html` debe quedar visible en la raíz.

## Netlify
- Import an existing project / GitHub.
- Build command: vacío.
- Publish directory: `.` (Netlify también lee `netlify.toml`).
- Si el sitio está marcado Private, use **Go live / Manage access** para permitir acceso a los usuarios.

## Firebase Authentication
En Firebase Console > Authentication > Settings > Authorized domains, agregue el dominio final de Netlify (ej.: dqo-final-psi.netlify.app).

## Firebase incluido
La configuración pública de Firebase Web App para `dqo-informes` ya viene integrada como configuración predeterminada. Un valor previamente guardado en el navegador sigue teniendo prioridad.

No se incluyen Firebase Admin SDK, Functions source, `.env`, service accounts ni claves privadas en este paquete web.
