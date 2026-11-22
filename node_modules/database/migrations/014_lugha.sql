-- Phase 12: lugha ya mtumiaji (Kiswahili au English) — kwa arifa, SMS na ujumbe wa makosa kutoka server.
-- Safu mpya tu; kila mtu anaanza na Kiswahili. Hakuna kinachofutwa.
ALTER TABLE naya.users
  ADD COLUMN language varchar(2) NOT NULL DEFAULT 'sw' CHECK (language IN ('sw', 'en'));
