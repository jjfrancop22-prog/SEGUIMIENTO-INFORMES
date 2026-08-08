# PEP V5.0.0-A1.2 — Live Sync Auto-Start Fix

Versión de producción GitHub + Netlify/PWA.

Objetivo único: cerrar automáticamente el Baseline cuando Cloud Seed/Bootstrap, listeners, Outbox e Inbox están sanos; distinguir entradas históricas de Outbox ya confirmadas en Firebase de operaciones locales realmente pendientes; mantener estas últimas protegidas.

No modifica Login, Claims, SessionManager, PermissionEngine ni módulos de negocio.
