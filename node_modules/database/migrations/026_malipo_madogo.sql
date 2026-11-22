-- 0.18.2 Malipo madogo ya ofa yanakusanywa: safari ya ofa ambayo deni la dereva bado liko chini ya kima cha chini cha
-- kutuma (Abliner haikubali kiasi kidogo) inakaa "WAITING" (inakusanywa) mpaka deni lifike, kisha zinatumwa pamoja.
-- Inapanua CHECK ya hali tu; haibadilishi wala kufuta data.
ALTER TABLE naya.rides DROP CONSTRAINT IF EXISTS rides_promo_payout_state_check;
ALTER TABLE naya.rides ADD CONSTRAINT rides_promo_payout_state_check
  CHECK (promo_payout_state IN ('PENDING', 'PAID', 'HELD', 'FAILED', 'REJECTED', 'WAITING'));
