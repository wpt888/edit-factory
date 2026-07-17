-- Migration 055: disambiguate the ElevenLabs balance RPC primary-key conflict.
--
-- The RETURNS TABLE output column `profile_id` is also a PL/pgSQL variable.
-- `ON CONFLICT (profile_id)` therefore raises 42702 before the balance can be
-- read. Naming the primary-key constraint removes that ambiguity without
-- changing any balance or reservation data.

CREATE OR REPLACE FUNCTION public.get_elevenlabs_credit_balance(
  p_profile_id UUID,
  p_default_limit BIGINT
)
RETURNS TABLE (
  profile_id UUID,
  credit_limit BIGINT,
  credits_used BIGINT,
  credits_reserved BIGINT,
  period_start DATE,
  period_end DATE
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_start DATE := date_trunc('month', NOW() AT TIME ZONE 'UTC')::date;
  v_end DATE := (date_trunc('month', NOW() AT TIME ZONE 'UTC') + INTERVAL '1 month')::date;
BEGIN
  INSERT INTO public.editai_elevenlabs_credit_balances (
    profile_id, credit_limit, period_start, period_end
  ) VALUES (p_profile_id, GREATEST(p_default_limit, -1), v_start, v_end)
  ON CONFLICT ON CONSTRAINT editai_elevenlabs_credit_balances_pkey DO NOTHING;

  UPDATE public.editai_elevenlabs_credit_balances b
  SET credits_used = 0,
      credits_reserved = 0,
      period_start = v_start,
      period_end = v_end,
      updated_at = NOW()
  WHERE b.profile_id = p_profile_id AND b.period_start <> v_start;

  UPDATE public.editai_elevenlabs_credit_reservations r
  SET status = 'expired', settled_at = NOW()
  WHERE r.profile_id = p_profile_id
    AND r.status = 'reserved'
    AND r.period_start <> v_start;

  RETURN QUERY
  SELECT b.profile_id, b.credit_limit, b.credits_used, b.credits_reserved,
         b.period_start, b.period_end
  FROM public.editai_elevenlabs_credit_balances b
  WHERE b.profile_id = p_profile_id;
END;
$$;

NOTIFY pgrst, 'reload schema';
