-- Phase 13.2: dereva anapokea maombi hata skrini ya simu ikiwa imezimwa.
-- online_since: alienda online lini (maombi aliyokosa kujibu yanahesabiwa tangu hapo tu). Safu mpya tu.
ALTER TABLE naya.drivers ADD COLUMN online_since timestamptz;
