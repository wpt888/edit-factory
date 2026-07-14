-- Keep every Supabase Auth identity connected to an application workspace.
-- Runtime code has the same idempotent fallback for installations where this
-- migration has not yet been applied.

-- Remove legacy auth.users triggers that write incomplete profile rows. The
-- deployed database currently has one such trigger: signup fails because it
-- inserts profiles.user_id = NULL. Limit removal strictly to triggers whose
-- function body references the profiles table.
DO $$
DECLARE
  legacy_trigger RECORD;
BEGIN
  FOR legacy_trigger IN
    SELECT trigger_def.tgname
    FROM pg_trigger AS trigger_def
    JOIN pg_class AS relation_def ON relation_def.oid = trigger_def.tgrelid
    JOIN pg_namespace AS schema_def ON schema_def.oid = relation_def.relnamespace
    JOIN pg_proc AS function_def ON function_def.oid = trigger_def.tgfoid
    WHERE schema_def.nspname = 'auth'
      AND relation_def.relname = 'users'
      AND NOT trigger_def.tgisinternal
      AND pg_get_functiondef(function_def.oid) ILIKE '%profiles%'
  LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS %I ON auth.users',
      legacy_trigger.tgname
    );
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_default_profile_for_auth_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, name, description, is_default)
  VALUES (NEW.id, 'My Workspace', 'Default Blipost workspace', true)
  ON CONFLICT (user_id) WHERE (is_default = true) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS create_default_profile_after_signup ON auth.users;
CREATE TRIGGER create_default_profile_after_signup
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.create_default_profile_for_auth_user();

INSERT INTO public.profiles (user_id, name, description, is_default)
SELECT users.id, 'My Workspace', 'Default Blipost workspace', true
FROM auth.users AS users
WHERE NOT EXISTS (
  SELECT 1 FROM public.profiles WHERE profiles.user_id = users.id
)
ON CONFLICT (user_id) WHERE (is_default = true) DO NOTHING;
