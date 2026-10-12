-- Maoni yanapatikana kwa wote: kichupo cha "Maoni" kwenye menyu, baada ya safari, na pale safari inapokwama.
-- Columns mpya tu (hakuna kinachofutwa); maoni ya zamani yanabaki kama yalivyo.
ALTER TABLE naya.feedback ADD COLUMN ride_id uuid REFERENCES naya.rides(id) ON DELETE SET NULL;
ALTER TABLE naya.feedback ADD COLUMN source varchar(20) NOT NULL DEFAULT 'MENU'
  CHECK (source IN ('MENU', 'AFTER_RIDE', 'PROBLEM', 'ACCOUNT'));
-- Mtoaji ameshaona jibu la ofisi? (kitone kwenye kichupo cha Maoni)
ALTER TABLE naya.feedback ADD COLUMN reply_seen_at timestamptz;
-- Mada mpya: "Safari hii" (maoni kuhusu safari moja)
ALTER TABLE naya.feedback DROP CONSTRAINT IF EXISTS feedback_topic_check;
ALTER TABLE naya.feedback ADD CONSTRAINT feedback_topic_check
  CHECK (topic IN ('GENERAL', 'APP', 'PRICES', 'DRIVERS', 'SAFETY', 'IDEA', 'RIDE'));
CREATE INDEX feedback_ride_idx ON naya.feedback (ride_id) WHERE ride_id IS NOT NULL;
