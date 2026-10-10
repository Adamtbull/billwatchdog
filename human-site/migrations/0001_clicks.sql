-- Anonymous request aggregates only; no cookies, IPs, referrers or user identifiers.
-- UTC calendar day. Counts are redirects, not unique visitors or conversions.
CREATE TABLE IF NOT EXISTS click_counts (
  plan_id TEXT NOT NULL,
  day TEXT NOT NULL CHECK (length(day) = 10),
  click_count INTEGER NOT NULL DEFAULT 0 CHECK (click_count >= 0),
  PRIMARY KEY (plan_id, day)
) WITHOUT ROWID;
