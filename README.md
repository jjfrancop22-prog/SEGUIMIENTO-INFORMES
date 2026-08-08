# PEP Enterprise V4.9.0-A — Bootstrap After Login Fix

Base: V4.8.0-C GitHub Production estable.

## Cambio único

- Login y EnterpriseSessionGate conservan el flujo estable de V4.8.0-C.
- El Auto Bootstrap no corre antes de autenticar.
- Después de un Login válido y Claims/rol válidos, se verifica si IndexedDB está vacío.
- Solo en una PC vacía se descarga la fotografía Firebase a IndexedDB.
- SessionManager, PermissionEngine, LiveSyncManager y módulos de negocio no fueron modificados.
- Se restauraron los exports de compatibilidad de version-metadata requeridos por el runtime V4.8.0-C.

## GitHub + Netlify

Mantener index.html, src/, templates/, netlify.toml y _redirects directamente en la raíz del repositorio.

## PEP V5.0.0-A — Enterprise Desktop Foundation

Esta entrega agrega únicamente la capa PWA instalable sobre la V4.9.0-A estable:
- manifest.webmanifest
- service-worker.js
- iconos 192/512
- botón de instalación cuando el navegador expone el prompt PWA
- apertura en modo standalone después de instalar

No modifica Login, SessionManager, PermissionEngine, New PC Auto Bootstrap, Live Sync ni módulos de negocio.
