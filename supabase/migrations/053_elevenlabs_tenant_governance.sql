-- Migration 053: ElevenLabs tenant governance
--
-- Keeps one shared ElevenLabs subscription while enforcing application-level
-- voice ownership and monthly credit allowances per Edit Factory profile.
-- Credit reservations are atomic so parallel TTS jobs cannot overspend the
-- same allowance. RLS remains disabled, matching the project's service-backed
-- data tables; every public route scopes access through ProfileContext.

CREATE TABLE IF NOT EXISTS public.editai_elevenlabs_voice_access (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  voice_id TEXT NOT NULL,
  voice_name TEXT,
  category TEXT,
  language TEXT,
  preview_url TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  assigned_by TEXT NOT NULL DEFAULT 'admin',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (profile_id, voice_id)
);

CREATE INDEX IF NOT EXISTS idx_elevenlabs_voice_access_profile
  ON public.editai_elevenlabs_voice_access(profile_id, is_active);

-- Preserve existing per-profile custom voice selections when the isolation
-- policy is introduced. Future assignments must use the admin endpoint.
INSERT INTO public.editai_elevenlabs_voice_access (
  profile_id, voice_id, voice_name, assigned_by
)
SELECT
  p.id,
  COALESCE(
    p.tts_settings -> 'elevenlabs' ->> 'voice_id',
    p.tts_settings ->> 'voice_id'
  ),
  COALESCE(
    p.tts_settings -> 'elevenlabs' ->> 'voice_name',
    p.tts_settings ->> 'voice_name'
  ),
  'migration'
FROM public.profiles p
WHERE COALESCE(
  p.tts_settings -> 'elevenlabs' ->> 'voice_id',
  p.tts_settings ->> 'voice_id'
) IS NOT NULL
ON CONFLICT (profile_id, voice_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.editai_elevenlabs_credit_balances (
  profile_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  credit_limit BIGINT NOT NULL,
  credits_used BIGINT NOT NULL DEFAULT 0 CHECK (credits_used >= 0),
  credits_reserved BIGINT NOT NULL DEFAULT 0 CHECK (credits_reserved >= 0),
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (credit_limit >= -1)
);

CREATE TABLE IF NOT EXISTS public.editai_elevenlabs_credit_reservations (
  id UUID PRIMARY KEY,
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  reserved_credits BIGINT NOT NULL CHECK (reserved_credits >= 0),
  actual_credits BIGINT CHECK (actual_credits IS NULL OR actual_credits >= 0),
  text_characters INTEGER NOT NULL DEFAULT 0,
  model_id TEXT,
  voice_id TEXT,
  provider_request_id TEXT,
  status TEXT NOT NULL DEFAULT 'reserved'
    CHECK (status IN ('reserved', 'settled', 'released', 'expired')),
  period_start DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  settled_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_elevenlabs_credit_reservations_profile
  ON public.editai_elevenlabs_credit_reservations(profile_id, created_at DESC);

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
  ON CONFLICT (profile_id) DO NOTHING;

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

CREATE OR REPLACE FUNCTION public.reserve_elevenlabs_credits(
  p_profile_id UUID,
  p_reservation_id UUID,
  p_credits BIGINT,
  p_text_characters INTEGER,
  p_model_id TEXT,
  p_voice_id TEXT,
  p_default_limit BIGINT
)
RETURNS TABLE (
  allowed BOOLEAN,
  credit_limit BIGINT,
  credits_used BIGINT,
  credits_reserved BIGINT,
  credits_remaining BIGINT
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_balance public.editai_elevenlabs_credit_balances%ROWTYPE;
  v_start DATE := date_trunc('month', NOW() AT TIME ZONE 'UTC')::date;
  v_end DATE := (date_trunc('month', NOW() AT TIME ZONE 'UTC') + INTERVAL '1 month')::date;
BEGIN
  IF p_credits < 0 THEN
    RAISE EXCEPTION 'Credit reservation cannot be negative';
  END IF;

  INSERT INTO public.editai_elevenlabs_credit_balances (
    profile_id, credit_limit, period_start, period_end
  ) VALUES (p_profile_id, GREATEST(p_default_limit, -1), v_start, v_end)
  ON CONFLICT (profile_id) DO NOTHING;

  SELECT * INTO v_balance
  FROM public.editai_elevenlabs_credit_balances b
  WHERE b.profile_id = p_profile_id
  FOR UPDATE;

  IF v_balance.period_start <> v_start THEN
    UPDATE public.editai_elevenlabs_credit_balances b
    SET credits_used = 0, credits_reserved = 0,
        period_start = v_start, period_end = v_end, updated_at = NOW()
    WHERE b.profile_id = p_profile_id
    RETURNING * INTO v_balance;

    UPDATE public.editai_elevenlabs_credit_reservations r
    SET status = 'expired', settled_at = NOW()
    WHERE r.profile_id = p_profile_id AND r.status = 'reserved';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.editai_elevenlabs_credit_reservations r
    WHERE r.id = p_reservation_id
  ) THEN
    RETURN QUERY SELECT TRUE, v_balance.credit_limit, v_balance.credits_used,
      v_balance.credits_reserved,
      CASE WHEN v_balance.credit_limit < 0 THEN -1
           ELSE GREATEST(0, v_balance.credit_limit - v_balance.credits_used - v_balance.credits_reserved)
      END;
    RETURN;
  END IF;

  IF v_balance.credit_limit >= 0
     AND v_balance.credits_used + v_balance.credits_reserved + p_credits > v_balance.credit_limit THEN
    RETURN QUERY SELECT FALSE, v_balance.credit_limit, v_balance.credits_used,
      v_balance.credits_reserved,
      GREATEST(0, v_balance.credit_limit - v_balance.credits_used - v_balance.credits_reserved);
    RETURN;
  END IF;

  INSERT INTO public.editai_elevenlabs_credit_reservations (
    id, profile_id, reserved_credits, text_characters, model_id, voice_id, period_start
  ) VALUES (
    p_reservation_id, p_profile_id, p_credits, p_text_characters,
    p_model_id, p_voice_id, v_start
  );

  UPDATE public.editai_elevenlabs_credit_balances b
  SET credits_reserved = b.credits_reserved + p_credits, updated_at = NOW()
  WHERE b.profile_id = p_profile_id
  RETURNING * INTO v_balance;

  RETURN QUERY SELECT TRUE, v_balance.credit_limit, v_balance.credits_used,
    v_balance.credits_reserved,
    CASE WHEN v_balance.credit_limit < 0 THEN -1
         ELSE GREATEST(0, v_balance.credit_limit - v_balance.credits_used - v_balance.credits_reserved)
    END;
END;
$$;

CREATE OR REPLACE FUNCTION public.settle_elevenlabs_credits(
  p_reservation_id UUID,
  p_actual_credits BIGINT,
  p_provider_request_id TEXT DEFAULT NULL
)
RETURNS TABLE (credits_used BIGINT, credits_reserved BIGINT)
LANGUAGE plpgsql
AS $$
DECLARE
  v_res public.editai_elevenlabs_credit_reservations%ROWTYPE;
  v_balance public.editai_elevenlabs_credit_balances%ROWTYPE;
BEGIN
  SELECT * INTO v_res
  FROM public.editai_elevenlabs_credit_reservations r
  WHERE r.id = p_reservation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown ElevenLabs credit reservation %', p_reservation_id;
  END IF;

  IF v_res.status = 'settled' THEN
    RETURN QUERY
    SELECT b.credits_used, b.credits_reserved
    FROM public.editai_elevenlabs_credit_balances b
    WHERE b.profile_id = v_res.profile_id;
    RETURN;
  END IF;

  IF v_res.status <> 'reserved' THEN
    RAISE EXCEPTION 'Cannot settle reservation % in status %', p_reservation_id, v_res.status;
  END IF;

  UPDATE public.editai_elevenlabs_credit_balances b
  SET credits_reserved = GREATEST(0, b.credits_reserved - v_res.reserved_credits),
      credits_used = b.credits_used + GREATEST(p_actual_credits, 0),
      updated_at = NOW()
  WHERE b.profile_id = v_res.profile_id
  RETURNING * INTO v_balance;

  UPDATE public.editai_elevenlabs_credit_reservations r
  SET actual_credits = GREATEST(p_actual_credits, 0),
      provider_request_id = p_provider_request_id,
      status = 'settled', settled_at = NOW()
  WHERE r.id = p_reservation_id;

  RETURN QUERY SELECT v_balance.credits_used, v_balance.credits_reserved;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_elevenlabs_credits(p_reservation_id UUID)
RETURNS TABLE (credits_used BIGINT, credits_reserved BIGINT)
LANGUAGE plpgsql
AS $$
DECLARE
  v_res public.editai_elevenlabs_credit_reservations%ROWTYPE;
  v_balance public.editai_elevenlabs_credit_balances%ROWTYPE;
BEGIN
  SELECT * INTO v_res
  FROM public.editai_elevenlabs_credit_reservations r
  WHERE r.id = p_reservation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF v_res.status = 'reserved' THEN
    UPDATE public.editai_elevenlabs_credit_balances b
    SET credits_reserved = GREATEST(0, b.credits_reserved - v_res.reserved_credits),
        updated_at = NOW()
    WHERE b.profile_id = v_res.profile_id
    RETURNING * INTO v_balance;

    UPDATE public.editai_elevenlabs_credit_reservations r
    SET status = 'released', settled_at = NOW()
    WHERE r.id = p_reservation_id;
  ELSE
    SELECT * INTO v_balance
    FROM public.editai_elevenlabs_credit_balances b
    WHERE b.profile_id = v_res.profile_id;
  END IF;

  RETURN QUERY SELECT v_balance.credits_used, v_balance.credits_reserved;
END;
$$;

NOTIFY pgrst, 'reload schema';
