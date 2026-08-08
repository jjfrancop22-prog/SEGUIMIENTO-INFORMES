# PEP V4.8.0-C — Performance Optimization

Base: PEP V4.8.0-B — Runtime Consolidation.

## Cambios de rendimiento

- Se eliminaron los listeners duplicados de Laboratorio que se volvían a registrar al cambiar de vista.
- El refresh principal ya no espera de forma síncrona a todas las vistas pesadas antes de devolver el control al usuario.
- Reports, Billing, Receivables, Tracking y Dashboard se actualizan en segundo plano mediante tareas idle después del render principal.
- Al abrir una vista pesada, se fuerza su refresh inmediato para mantener datos actuales.
- El cálculo de la última muestra registrada dejó de ordenar una copia completa del arreglo y usa una sola pasada.
- LiveSyncManager reutiliza una sola lectura de health por refresh global en vez de repetirla para cada dominio.
- Los refrescos visuales producidos por ráfagas de cambios remotos se agrupan en un único repaint.
- El PUSH incremental sigue usando el mismo ciclo funcional, con una ventana breve de consolidación para eventos consecutivos.
- Panel administrativo de métricas ligeras para Login/runtime, refresh principal y módulos pesados.

## Sin cambios funcionales

No se modificaron reglas de negocio, Firebase Authentication, Firestore Rules, SessionManager, PermissionEngine, contratos de dominio, esquema IndexedDB ni política de Live Sync.
