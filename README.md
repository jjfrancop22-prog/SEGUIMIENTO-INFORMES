# PEP V5.0.0-STABLE — Multi-PC Enterprise

Base estable de producción GitHub + Netlify/PWA.

## Núcleo de sincronización congelado
La base funcional congelada del motor es **V5.0.0-A1.2**. Las próximas versiones no deben modificar `LiveSyncManager`, `DomainSyncRuntime`, `CloudAdapter`, protocolo de sincronización, esquema de entidad ni resolución de conflictos salvo corrección crítica reproducible.

Esta consolidación conserva los 7 dominios de Live Sync que ya funcionan y añade solamente una capa externa de resiliencia:

- reconexión automática al recuperar Internet;
- reintento con backoff únicamente cuando existe error/Outbox pendiente;
- ACK auditado por dominio;
- recuperación PUSH + PULL por dominio;
- estado global del motor;
- Service Worker sin caché agresiva de HTML/JS.

No modifica Login, Claims, SessionManager, PermissionEngine ni módulos de negocio.

## Regla de mantenimiento
Toda nueva funcionalidad debe implementarse fuera del núcleo congelado. Si una mejora requiere tocar el motor de sincronización, primero debe existir un caso reproducible y una versión de corrección dedicada.

## V5.0.1 — Conflict Engine Refinement
- `history` queda excluido de la detección de conflictos.
- Se excluyen metadatos técnicos de sincronización, auditoría y dispositivo.
- Solo diferencias en campos de negocio generan un conflicto pendiente.
- Los conflictos PENDING existentes que solo contienen metadata se resuelven automáticamente como `IGNORED_METADATA_ONLY` al abrir/actualizar Conflict Review Center.
- Los conflictos reales de negocio continúan pendientes y conservan resolución manual / Smart Merge.


## V5.0.2 — Bootstrap/Outbox Idempotency Fix
- La hidratación inicial y los cambios recibidos por Live Sync refrescan las vistas en modo solo lectura derivada.
- Durante Bootstrap/reconciliación remota no se ejecutan reparaciones/ensure que creen Outbox de rebote.
- Solo una acción local posterior vuelve a habilitar materialización derivada con Outbox normal.
- Objetivo operativo: PC nueva → Bootstrap → Outbox 0; sesiones sin cambios → Outbox 0; cambios locales → pendientes → ACK → 0.
