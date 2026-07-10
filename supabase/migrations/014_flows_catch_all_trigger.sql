-- Extend the flows trigger_type check constraint to allow 'catch_all'.
-- A catch_all flow fires when no keyword or first_inbound_message flow
-- matches an inbound message — it acts as the bot's fallback menu.

ALTER TABLE flows
  DROP CONSTRAINT IF EXISTS flows_trigger_type_check;

ALTER TABLE flows
  ADD CONSTRAINT flows_trigger_type_check
    CHECK (trigger_type IN (
      'keyword',
      'first_inbound_message',
      'manual',
      'api_trigger',
      'catch_all'
    ));
