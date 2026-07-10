-- 0004_messages — persist chat messages for Product A so conversations reload
-- after a browser refresh.
--
-- INVARIANT #1: content is stored REDACTED (placeholders only, e.g. [[PERSON_1]])
-- — never raw PII. On load the gateway un-redacts for the authoring tenant using
-- the encrypted token map (same path as the streaming response). Deleting a
-- conversation cascades here too (GDPR Art. 17).

CREATE TABLE messages (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id        uuid NOT NULL,
  conversation_id  uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role             text NOT NULL CHECK (role IN ('user','assistant')),
  content_redacted text NOT NULL,          -- placeholders only, NO raw PII
  seq              integer NOT NULL,        -- ordering within the conversation
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX messages_conv_seq_idx ON messages(conversation_id, seq);

ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON messages
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- gateway role inherits SELECT/INSERT/UPDATE/DELETE via ALTER DEFAULT PRIVILEGES
-- (0002); messages are not append-only (conversation delete cascades).
