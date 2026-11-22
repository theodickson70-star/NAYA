-- 0.16.2 "Mfumo huru" (madereva wachache): kila dereva aliyeidhinishwa na yuko online anapokea maombi bila vikwazo —
-- ada ya mwezi haitozwi, simu "iliyolala" haiondolewi, hakuna kuwekwa offline na mfumo. Ofisi inaweza kuuzima (Ada ya mwezi).
-- Inaongeza mpangilio mmoja tu; haifuti wala kubadilisha data yoyote.
INSERT INTO naya.settings (key, value) VALUES ('dispatch', '{"openMode": true}')
ON CONFLICT (key) DO NOTHING;
