-- One adapter key identifies one durable projection of external GitHub evidence.
CREATE UNIQUE INDEX brain_events_acceptance_adapter_key
 ON brain_events ((details->>'adapterKey'))
 WHERE event_type IN ('held-out-evaluation-frozen','independent-reviewer-attested',
  'independent-reviewer-assessment','held-out-evaluation-observed','observed')
 AND details ? 'adapterKey';
