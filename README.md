# PEP Enterprise V4.8.0-C — GitHub Production

Paquete de producción para GitHub + Netlify.

## Estructura correcta del repositorio

Los archivos deben quedar directamente en la raíz del repositorio:

- `index.html`
- `src/`
- `templates/`
- `netlify.toml`
- `.gitignore`
- `README.md`

**No cree una carpeta PEP_V4_8_0_C_NETLIFY_PRODUCTION dentro del repositorio.**

## Netlify

- Base directory: vacío
- Build command: vacío
- Publish directory: `.`

Después de subir los archivos a GitHub, Netlify debe desplegar automáticamente.

## Firebase Authentication

Agregue el dominio final de Netlify en Firebase Console → Authentication → Settings → Authorized domains.

Ejemplo: `dqo-informes-2026.netlify.app`

## Versión

V4.8.0-C — Performance Optimization / GitHub Production.
