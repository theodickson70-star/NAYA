-- NAYA app moja: akaunti moja inaweza kuwa ABIRIA na DEREVA; mtumiaji anabadili "mode".
-- Hakuna data inayofutwa. Mabadiliko:
--   1. role 'CUSTOMER' inaitwa 'USER' (mtumiaji wa app). Admin wanabaki 'ADMIN' / 'SUPER_ADMIN'.
--   2. Madereva waliojisajili zamani (role 'DRIVER') wanakuwa 'USER' — taarifa zao za udereva
--      zinabaki kwenye naya.drivers kama zilivyo.
--   3. Safu mpya users.active_mode: mode aliyochagua mara ya mwisho (NULL = bado hajachagua).
-- Thamani 'DRIVER' inabaki ndani ya enum naya.user_role (PostgreSQL haiondoi thamani za enum) lakini haitumiki tena.

ALTER TYPE naya.user_role RENAME VALUE 'CUSTOMER' TO 'USER';

CREATE TYPE naya.app_mode AS ENUM ('PASSENGER', 'DRIVER');
ALTER TABLE naya.users ADD COLUMN active_mode naya.app_mode;

UPDATE naya.users SET active_mode = 'DRIVER', role = 'USER' WHERE role = 'DRIVER';
UPDATE naya.users SET active_mode = 'PASSENGER' WHERE role = 'USER' AND active_mode IS NULL;
