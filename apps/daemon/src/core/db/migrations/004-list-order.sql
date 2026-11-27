-- 0.65.0: Teams and their Agents in the order the owner puts them (BAZ-098). Today's order is
-- kept: the Default Team first, then the other Teams as they were created; in each Team, its
-- Agents as they were added.
ALTER TABLE teams ADD COLUMN position INTEGER NOT NULL DEFAULT 0;
ALTER TABLE agents ADD COLUMN position INTEGER NOT NULL DEFAULT 0;
UPDATE teams SET position = (
  SELECT ranked.place FROM (
    SELECT id, ROW_NUMBER() OVER (ORDER BY id <> 'default', created_at, id) - 1 AS place
    FROM teams
  ) AS ranked WHERE ranked.id = teams.id
);
UPDATE agents SET position = (
  SELECT ranked.place FROM (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY team_id ORDER BY created_at, id) - 1 AS place
    FROM agents
  ) AS ranked WHERE ranked.id = agents.id
);
