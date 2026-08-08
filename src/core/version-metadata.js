export const APP_VERSION='V5.0.0-STABLE';
export const APP_BUILD='MULTI_PC_ENTERPRISE_FROZEN_SYNC_CORE';
export const SYNC_PROTOCOL_VERSION=1;
export const ENTITY_SYNC_SCHEMA_VERSION=1;
export const CONFLICT_SCHEMA_VERSION=2;
export const SECURITY_SCHEMA_VERSION=1;
export const CLOUD_PROVIDER='FIREBASE_FIRESTORE';
export const CLOUD_MODE='MULTI_PC_ENTERPRISE_FROZEN_SYNC_CORE_7_DOMAIN_LIVE_SYNC';
export const APP_VERSION_LABEL=`PEP ${APP_VERSION}`;
export const APP_BUILD_LABEL='Multi-PC Enterprise · Sync Core Frozen';
export const APP_RELEASED_AT='2026-08-08';
export const SYNC_CORE_FROZEN=true;
export const SYNC_CORE_FREEZE_BASE='V5.0.0-A1.2';
export const VERSION_METADATA=Object.freeze({
  appVersion:APP_VERSION,
  version:APP_VERSION,
  build:APP_BUILD,
  syncProtocolVersion:SYNC_PROTOCOL_VERSION,
  entitySyncSchemaVersion:ENTITY_SYNC_SCHEMA_VERSION,
  conflictSchemaVersion:CONFLICT_SCHEMA_VERSION,
  securitySchemaVersion:SECURITY_SCHEMA_VERSION,
  cloudProvider:CLOUD_PROVIDER,
  cloudMode:CLOUD_MODE,
  label:APP_VERSION_LABEL,
  buildLabel:APP_BUILD_LABEL,
  releasedAt:APP_RELEASED_AT,
  syncCoreFrozen:SYNC_CORE_FROZEN,
  syncCoreFreezeBase:SYNC_CORE_FREEZE_BASE
});
