-- Durable output identity, exact TTS provenance, and atomic pipeline snapshots.
-- This migration is additive; legacy index columns remain available for
-- compatibility while existing rows are gradually backfilled by normal saves.

BEGIN;

ALTER TABLE public.editai_pipelines
ADD COLUMN IF NOT EXISTS settings_revision BIGINT NOT NULL DEFAULT 0;

ALTER TABLE public.editai_pipelines
ADD COLUMN IF NOT EXISTS jobs_revision BIGINT NOT NULL DEFAULT 0;

ALTER TABLE public.editai_pipelines
ADD COLUMN IF NOT EXISTS preview_jobs JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.editai_pipelines.settings_revision IS
  'Monotonic compare-and-swap revision for template_settings autosaves.';

COMMENT ON COLUMN public.editai_pipelines.jobs_revision IS
  'Monotonic compare-and-swap revision shared by async job maps and structural script saves.';

COMMENT ON COLUMN public.editai_pipelines.preview_jobs IS
  'Durable per-OutputId reassembly jobs used to block unsafe script reorder/delete.';

ALTER TABLE public.editai_clips
ADD COLUMN IF NOT EXISTS script_id TEXT;

ALTER TABLE public.editai_clips
ADD COLUMN IF NOT EXISTS output_id TEXT;

COMMENT ON COLUMN public.editai_clips.script_id IS
  'Stable pipeline ScriptId; variant_index is retained only for display and legacy rows.';

COMMENT ON COLUMN public.editai_clips.output_id IS
  'Stable pipeline OutputId derived from ScriptId and the visual version.';

-- New Library projects carry an explicit pipeline link. Legacy projects are
-- linked only when the evidence identifies exactly one project/pipeline pair.
ALTER TABLE public.editai_projects
ADD COLUMN IF NOT EXISTS pipeline_id UUID
REFERENCES public.editai_pipelines(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.editai_projects.pipeline_id IS
  'Explicit owner pipeline for Library projects created by pipeline rendering.';

-- Strong legacy evidence: the renderer stored the complete pipeline UUID in
-- the project description. The UUID makes this association independent of
-- non-unique display names.
WITH description_candidates AS (
  SELECT
    project.id AS project_id,
    pipeline.id AS pipeline_id,
    COUNT(*) OVER (PARTITION BY project.id) AS project_match_count,
    COUNT(*) OVER (PARTITION BY pipeline.id) AS pipeline_match_count
  FROM public.editai_projects AS project
  JOIN public.editai_pipelines AS pipeline
    ON pipeline.profile_id = project.profile_id
   AND project.description = (
     'Auto-generated from pipeline ' || pipeline.id::text
   )
  WHERE project.pipeline_id IS NULL
)
UPDATE public.editai_projects AS project
SET pipeline_id = candidate.pipeline_id
FROM description_candidates AS candidate
WHERE project.id = candidate.project_id
  AND candidate.project_match_count = 1
  AND candidate.pipeline_match_count = 1;

-- Fallback for older rows without the UUID-bearing description. Match the
-- exact renderer naming rule, including the idea-derived name, but accept it
-- only when it is one-to-one in both directions.
WITH name_candidates AS (
  SELECT
    project.id AS project_id,
    pipeline.id AS pipeline_id,
    COUNT(*) OVER (PARTITION BY project.id) AS project_match_count,
    COUNT(*) OVER (PARTITION BY pipeline.id) AS pipeline_match_count
  FROM public.editai_projects AS project
  JOIN public.editai_pipelines AS pipeline
   ON pipeline.profile_id = project.profile_id
   AND BTRIM(project.name) = COALESCE(
     NULLIF(
       BTRIM(
         LEFT(
           COALESCE(NULLIF(pipeline.name, ''), pipeline.idea, ''),
           80
         )
       ),
       ''
     ),
     'Pipeline ' || LEFT(pipeline.id::text, 8)
   )
  WHERE project.pipeline_id IS NULL
)
UPDATE public.editai_projects AS project
SET pipeline_id = candidate.pipeline_id
FROM name_candidates AS candidate
WHERE project.id = candidate.project_id
  AND candidate.project_match_count = 1
  AND candidate.pipeline_match_count = 1;

-- Refuse ambiguous explicit ownership before adding the uniqueness contract.
DO $$
DECLARE
  duplicate_owner RECORD;
BEGIN
  SELECT pipeline_id, COUNT(*) AS duplicate_count
  INTO duplicate_owner
  FROM public.editai_projects
  WHERE pipeline_id IS NOT NULL
  GROUP BY pipeline_id
  HAVING COUNT(*) > 1
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION
      'Migration 059 preflight failed: pipeline % is linked to % Library projects',
      duplicate_owner.pipeline_id,
      duplicate_owner.duplicate_count;
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_editai_projects_pipeline_id
  ON public.editai_projects(pipeline_id)
  WHERE pipeline_id IS NOT NULL;

-- Read-only duplicate preflight. This considers both already-identified clips
-- and the identities that the legacy backfill would assign. The migration
-- aborts before changing any clip if the active rows cannot satisfy the unique
-- OutputId contract.
DO $$
DECLARE
  duplicate_output RECORD;
BEGIN
  WITH derived_legacy AS (
    SELECT
      clip.id,
      clip.project_id,
      (
        (pipeline.script_ids ->> clip.variant_index)
        || ':'
        || COALESCE(NULLIF(clip.visual_version, ''), 'default')
      ) AS output_id
    FROM public.editai_clips AS clip
    JOIN public.editai_projects AS project
      ON project.id = clip.project_id
    JOIN public.editai_pipelines AS pipeline
      ON pipeline.id = project.pipeline_id
     AND pipeline.profile_id = project.profile_id
    WHERE clip.output_id IS NULL
      AND clip.is_deleted = FALSE
      AND clip.variant_index IS NOT NULL
      AND clip.variant_index >= 0
      AND jsonb_typeof(pipeline.script_ids) = 'array'
      AND clip.variant_index < jsonb_array_length(pipeline.script_ids)
      AND NULLIF(pipeline.script_ids ->> clip.variant_index, '') IS NOT NULL
  ),
  prospective_active AS (
    SELECT id, project_id, output_id
    FROM public.editai_clips
    WHERE output_id IS NOT NULL
      AND is_deleted = FALSE
    UNION ALL
    SELECT id, project_id, output_id
    FROM derived_legacy
  )
  SELECT project_id, output_id, COUNT(*) AS duplicate_count
  INTO duplicate_output
  FROM prospective_active
  GROUP BY project_id, output_id
  HAVING COUNT(*) > 1
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION
      'Migration 059 preflight failed: project %, output % has % active clips',
      duplicate_output.project_id,
      duplicate_output.output_id,
      duplicate_output.duplicate_count;
  END IF;
END
$$;

-- Backfill only through the explicit, unambiguous project -> pipeline link.
-- Unresolved legacy projects remain NULL for manual review; no identity is
-- guessed from a display name.
UPDATE public.editai_clips AS clip
SET
  script_id = pipeline.script_ids ->> clip.variant_index,
  output_id = (
    (pipeline.script_ids ->> clip.variant_index)
    || ':'
    || COALESCE(NULLIF(clip.visual_version, ''), 'default')
  )
FROM public.editai_projects AS project
JOIN public.editai_pipelines AS pipeline
  ON pipeline.id = project.pipeline_id
 AND pipeline.profile_id = project.profile_id
WHERE clip.project_id = project.id
  AND clip.output_id IS NULL
  AND clip.variant_index IS NOT NULL
  AND clip.variant_index >= 0
  AND jsonb_typeof(pipeline.script_ids) = 'array'
  AND clip.variant_index < jsonb_array_length(pipeline.script_ids)
  AND NULLIF(pipeline.script_ids ->> clip.variant_index, '') IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_editai_clips_project_output_id_active
  ON public.editai_clips(project_id, output_id)
  WHERE output_id IS NOT NULL AND is_deleted = FALSE;

ALTER TABLE public.editai_tts_assets
ADD COLUMN IF NOT EXISTS tts_voice_settings JSONB;

ALTER TABLE public.editai_tts_assets
ADD COLUMN IF NOT EXISTS audio_sha256 TEXT;

COMMENT ON COLUMN public.editai_tts_assets.tts_voice_settings IS
  'Complete voice settings used to generate the durable audio asset.';

COMMENT ON COLUMN public.editai_tts_assets.audio_sha256 IS
  'SHA-256 of the persisted MP3, used to prevent cross-voice/path reassociation.';

COMMIT;
