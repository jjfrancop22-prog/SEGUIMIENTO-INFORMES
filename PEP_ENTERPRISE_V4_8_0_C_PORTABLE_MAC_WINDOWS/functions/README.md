# PEP Security Functions · V4.6.0-H

Funciones callable:
- `pepClaimsAdminStatus`: verifica si el usuario actual puede administrar claims.
- `pepListAuthUsers`: lista usuarios de Firebase Authentication (solo administrador autorizado).
- `pepSetUserClaims`: asigna rol/permisos Custom Claims (solo administrador autorizado).

El primer administrador se autoriza con `PEP_BOOTSTRAP_ADMIN_UID` en `.env`. Después, un usuario con claim ADMINISTRADOR también puede administrar roles.

Despliegue desde la raíz:

```bash
firebase deploy --only functions
```
