-- Kosa #2: kumpata dereva haraka kwa "mawimbi" — ombi moja linaweza kwenda kwa madereva kadhaa kwa pamoja.
-- Hali mpya za ombi (hakuna data inayofutwa; hali za zamani zinabaki zilivyo):
--   TAKEN     = dereva mwingine wa wimbi lile lile amewahi kukubali
--   CANCELLED = abiria / ofisi imeghairi, au ofisi imempa dereva mwingine
-- Hizi hazihesabiwi kama "hakujibu" (EXPIRED), kwa hiyo dereva hawekwi offline kwa sababu yake.
ALTER TABLE naya.ride_offers DROP CONSTRAINT IF EXISTS ride_offers_status_check;
ALTER TABLE naya.ride_offers ADD CONSTRAINT ride_offers_status_check
  CHECK (status IN ('PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'TAKEN', 'CANCELLED'));
