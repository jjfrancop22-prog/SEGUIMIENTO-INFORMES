# PEP Enterprise V4.9.0 — New PC Auto Bootstrap

Base: V4.8.0-C GitHub Production verificada y estable.

## Cambio único V4.9.0

Al iniciar sesión en una computadora/navegador nuevo con IndexedDB sin datos operativos, el ERP:

1. Detecta automáticamente la instalación vacía.
2. Verifica Firebase y el Initial Cloud Seed.
3. Descarga los dominios autorizados para el rol autenticado: Samples, Laboratory, Reports, Billing, Receivables, Clients y Catalogs.
4. Muestra progreso visible durante la descarga.
5. Verifica conteos antes de aplicar.
6. Guarda la fotografía en IndexedDB.
7. Refresca el ERP y activa Live Sync.
8. En aperturas posteriores no repite el Bootstrap completo.

### Seguridad

- No sobrescribe una PC con cambios pendientes en Outbox.
- Solo descarga dominios permitidos por los Claims/rol Firebase.
- Si Bootstrap falla, muestra el error y permite Reintentar o Continuar sin descargar.
- No modifica Login, Claims, Firestore Rules ni reglas de negocio.

## GitHub + Netlify

`index.html` debe permanecer en la raíz del repositorio. Netlify: Base directory vacío, Build command vacío, Publish directory `.`.
