"""DataRepository abstract base class.

Defines the contract that both SupabaseRepository and SQLiteRepository
must implement. Every database operation used across the codebase is
captured as a typed abstract method organized by domain.

All methods accept Dict[str, Any] for data payloads and return
QueryResult, Dict[str, Any], or List[Dict[str, Any]] as appropriate.
"""

from abc import ABC, abstractmethod
from datetime import datetime
from typing import Any, Dict, List, Optional

from app.repositories.models import QueryFilters, QueryResult


class DataRepository(ABC):
    """Abstract interface for all data persistence operations.

    Implementations: SupabaseRepository (cloud), SQLiteRepository (local).
    """

    # ──────────────────────────────────────────────
    # 1. Projects
    # ──────────────────────────────────────────────

    @abstractmethod
    def list_projects(
        self, profile_id: str, filters: Optional[QueryFilters] = None
    ) -> QueryResult:
        """List projects belonging to a profile.

        Returns: QueryResult with project dicts.
        """
        ...

    @abstractmethod
    def get_project(self, project_id: str) -> Optional[Dict[str, Any]]:
        """Get a single project by ID. Returns None if not found."""
        ...

    @abstractmethod
    def create_project(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """Insert a new project. Returns the created row."""
        ...

    @abstractmethod
    def update_project(
        self, project_id: str, data: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Update a project by ID. Returns the updated row."""
        ...

    @abstractmethod
    def delete_project(self, project_id: str) -> None:
        """Delete a project by ID."""
        ...

    # ──────────────────────────────────────────────
    # 2. Clips
    # ──────────────────────────────────────────────

    @abstractmethod
    def list_clips(
        self, project_id: str, filters: Optional[QueryFilters] = None
    ) -> QueryResult:
        """List clips belonging to a project."""
        ...

    @abstractmethod
    def get_clip(self, clip_id: str) -> Optional[Dict[str, Any]]:
        """Get a single clip by ID."""
        ...

    @abstractmethod
    def create_clip(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """Insert a new clip. Returns the created row."""
        ...

    @abstractmethod
    def update_clip(
        self, clip_id: str, data: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Update a clip by ID. Returns the updated row."""
        ...

    @abstractmethod
    def delete_clip(self, clip_id: str) -> None:
        """Delete a clip by ID."""
        ...

    @abstractmethod
    def delete_clips_by_ids(self, clip_ids: List[str]) -> None:
        """Delete multiple clips by their IDs."""
        ...

    @abstractmethod
    def list_clips_by_profile(
        self, profile_id: str, filters: Optional[QueryFilters] = None
    ) -> QueryResult:
        """List all clips accessible to a profile (across projects)."""
        ...

    # ──────────────────────────────────────────────
    # 3. Clip Content
    # ──────────────────────────────────────────────

    @abstractmethod
    def get_clip_content(self, clip_id: str) -> Optional[Dict[str, Any]]:
        """Get clip content (script, TTS data, subtitles) by clip ID."""
        ...

    @abstractmethod
    def create_clip_content(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """Insert clip content. Returns the created row."""
        ...

    @abstractmethod
    def update_clip_content(
        self, clip_id: str, data: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Update clip content by clip_id. Returns the updated row."""
        ...

    @abstractmethod
    def delete_clip_content_by_clip_ids(self, clip_ids: List[str]) -> None:
        """Delete clip content rows for the given clip IDs."""
        ...

    # ──────────────────────────────────────────────
    # 4. Segments
    # ──────────────────────────────────────────────

    @abstractmethod
    def list_segments(
        self, profile_id: str, filters: Optional[QueryFilters] = None
    ) -> QueryResult:
        """List video segments belonging to a profile."""
        ...

    @abstractmethod
    def get_segment(self, segment_id: str) -> Optional[Dict[str, Any]]:
        """Get a single segment by ID."""
        ...

    @abstractmethod
    def create_segment(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """Insert a new segment. Returns the created row."""
        ...

    @abstractmethod
    def update_segment(
        self, segment_id: str, data: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Update a segment by ID. Returns the updated row."""
        ...

    @abstractmethod
    def delete_segment(self, segment_id: str) -> None:
        """Delete a segment by ID."""
        ...

    # ──────────────────────────────────────────────
    # 5. Source Videos
    # ──────────────────────────────────────────────

    @abstractmethod
    def list_source_videos(
        self, profile_id: str, filters: Optional[QueryFilters] = None
    ) -> QueryResult:
        """List source videos belonging to a profile."""
        ...

    @abstractmethod
    def create_source_video(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """Insert a source video record. Returns the created row."""
        ...

    @abstractmethod
    def update_source_video(
        self, video_id: str, data: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Update a source video by ID. Returns the updated row."""
        ...

    @abstractmethod
    def delete_source_video(self, video_id: str) -> None:
        """Delete a source video by ID."""
        ...

    # ──────────────────────────────────────────────
    # 6. Project Segments
    # ──────────────────────────────────────────────

    @abstractmethod
    def list_project_segments(
        self, project_id: str, filters: Optional[QueryFilters] = None
    ) -> QueryResult:
        """List segments associated with a project."""
        ...

    @abstractmethod
    def create_project_segment(
        self, data: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Insert a project-segment association. Returns the created row."""
        ...

    @abstractmethod
    def update_project_segment(
        self, segment_id: str, data: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Update a project segment by ID. Returns the updated row."""
        ...

    @abstractmethod
    def delete_project_segments(self, project_id: str) -> None:
        """Delete all project-segment associations for a project."""
        ...

    # ──────────────────────────────────────────────
    # 7. Pipelines
    # ──────────────────────────────────────────────

    @abstractmethod
    def get_pipeline(self, pipeline_id: str) -> Optional[Dict[str, Any]]:
        """Get a pipeline by ID."""
        ...

    @abstractmethod
    def create_pipeline(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """Insert a pipeline. Returns the created row."""
        ...

    @abstractmethod
    def update_pipeline(
        self, pipeline_id: str, data: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Update a pipeline by ID. Returns the updated row."""
        ...

    @abstractmethod
    def delete_pipeline(self, pipeline_id: str) -> None:
        """Delete a pipeline by ID."""
        ...

    @abstractmethod
    def list_pipelines(
        self, profile_id: str, filters: Optional[QueryFilters] = None
    ) -> QueryResult:
        """List pipelines belonging to a profile."""
        ...

    # ──────────────────────────────────────────────
    # 8. Assembly Jobs
    # ──────────────────────────────────────────────

    @abstractmethod
    def get_assembly_job(
        self, job_id: str
    ) -> Optional[Dict[str, Any]]:
        """Get an assembly job by ID."""
        ...

    @abstractmethod
    def create_assembly_job(
        self, data: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Insert an assembly job. Returns the created row."""
        ...

    @abstractmethod
    def update_assembly_job(
        self, job_id: str, data: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Update an assembly job by ID. Returns the updated row."""
        ...

    # ──────────────────────────────────────────────
    # 9. Export Presets
    # ──────────────────────────────────────────────

    @abstractmethod
    def list_export_presets(
        self, profile_id: str, filters: Optional[QueryFilters] = None
    ) -> QueryResult:
        """List export presets. May include global/shared presets."""
        ...

    @abstractmethod
    def get_default_preset(
        self, profile_id: str
    ) -> Optional[Dict[str, Any]]:
        """Get the default export preset for a profile."""
        ...

    @abstractmethod
    def create_export_preset(
        self, data: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Insert an export preset. Returns the created row."""
        ...

    @abstractmethod
    def update_export_preset(
        self, preset_id: str, data: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Update an export preset by ID. Returns the updated row."""
        ...

    # ──────────────────────────────────────────────
    # 10. Exports
    # ──────────────────────────────────────────────

    @abstractmethod
    def create_export(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """Insert an export record. Returns the created row."""
        ...

    @abstractmethod
    def list_exports(
        self, clip_id: str, filters: Optional[QueryFilters] = None
    ) -> QueryResult:
        """List exports for a given clip."""
        ...

    # ──────────────────────────────────────────────
    # 11. Jobs (background processing jobs)
    # ──────────────────────────────────────────────

    @abstractmethod
    def create_job(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """Insert a background job. Returns the created row."""
        ...

    @abstractmethod
    def get_job(self, job_id: str) -> Optional[Dict[str, Any]]:
        """Get a job by ID."""
        ...

    @abstractmethod
    def update_job(
        self, job_id: str, data: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Update a job by ID. Returns the updated row."""
        ...

    @abstractmethod
    def list_jobs(
        self,
        limit: int = 50,
        profile_id: Optional[str] = None,
        filters: Optional[QueryFilters] = None,
    ) -> QueryResult:
        """List recent jobs, optionally filtered by profile."""
        ...

    @abstractmethod
    def delete_job(self, job_id: str) -> None:
        """Delete a job by ID."""
        ...

    @abstractmethod
    def cleanup_old_jobs(self, cutoff_date: datetime) -> int:
        """Delete jobs older than the cutoff date. Returns count deleted."""
        ...

    @abstractmethod
    def list_jobs_by_project(
        self, project_id: str, filters: Optional[QueryFilters] = None
    ) -> QueryResult:
        """List jobs associated with a project (via data->project_id)."""
        ...

    # ──────────────────────────────────────────────
    # 12. API Costs
    # ──────────────────────────────────────────────

    @abstractmethod
    def log_cost(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """Insert an API cost record. Returns the created row."""
        ...

    @abstractmethod
    def get_cost_summary(
        self, profile_id: str, filters: Optional[QueryFilters] = None
    ) -> QueryResult:
        """Get cost records for a profile, optionally filtered by date range."""
        ...

    # ──────────────────────────────────────────────
    # 13. Profiles
    # ──────────────────────────────────────────────

    @abstractmethod
    def get_profile(self, profile_id: str) -> Optional[Dict[str, Any]]:
        """Get a profile by ID."""
        ...

    @abstractmethod
    def list_profiles(self, user_id: str) -> QueryResult:
        """List all profiles for a user."""
        ...

    @abstractmethod
    def create_profile(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """Insert a new profile. Returns the created row."""
        ...

    @abstractmethod
    def update_profile(
        self, profile_id: str, data: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Update a profile by ID. Returns the updated row."""
        ...

    @abstractmethod
    def delete_profile(self, profile_id: str) -> None:
        """Delete a profile by ID."""
        ...

    @abstractmethod
    def get_default_profile(
        self, user_id: str
    ) -> Optional[Dict[str, Any]]:
        """Get the default profile for a user (is_default=true)."""
        ...

    # ──────────────────────────────────────────────
    # 14. TTS Assets
    # ──────────────────────────────────────────────

    @abstractmethod
    def list_tts_assets(
        self, profile_id: str, filters: Optional[QueryFilters] = None
    ) -> QueryResult:
        """List TTS assets belonging to a profile."""
        ...

    @abstractmethod
    def get_tts_asset(self, asset_id: str) -> Optional[Dict[str, Any]]:
        """Get a TTS asset by ID."""
        ...

    @abstractmethod
    def create_tts_asset(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """Insert a TTS asset. Returns the created row."""
        ...

    @abstractmethod
    def update_tts_asset(
        self, asset_id: str, data: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Update a TTS asset by ID. Returns the updated row."""
        ...

    @abstractmethod
    def delete_tts_asset(self, asset_id: str) -> None:
        """Delete a TTS asset by ID."""
        ...

    # ──────────────────────────────────────────────
    # 15. ElevenLabs Accounts
    # ──────────────────────────────────────────────

    @abstractmethod
    def list_elevenlabs_accounts(
        self, profile_id: str, filters: Optional[QueryFilters] = None
    ) -> QueryResult:
        """List ElevenLabs accounts for a profile."""
        ...

    @abstractmethod
    def get_elevenlabs_account(
        self, account_id: str
    ) -> Optional[Dict[str, Any]]:
        """Get an ElevenLabs account by ID."""
        ...

    @abstractmethod
    def create_elevenlabs_account(
        self, data: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Insert an ElevenLabs account. Returns the created row."""
        ...

    @abstractmethod
    def update_elevenlabs_account(
        self, account_id: str, data: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Update an ElevenLabs account by ID. Returns the updated row."""
        ...

    @abstractmethod
    def delete_elevenlabs_account(self, account_id: str) -> None:
        """Delete an ElevenLabs account by ID."""
        ...

    # ──────────────────────────────────────────────
    # 16. Products & Feeds
    # ──────────────────────────────────────────────

    @abstractmethod
    def list_products(
        self, filters: Optional[QueryFilters] = None
    ) -> QueryResult:
        """List products, optionally filtered."""
        ...

    @abstractmethod
    def get_product(self, product_id: str) -> Optional[Dict[str, Any]]:
        """Get a product by ID."""
        ...

    @abstractmethod
    def create_product(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """Insert a product. Returns the created row."""
        ...

    @abstractmethod
    def list_feeds(
        self, profile_id: str, filters: Optional[QueryFilters] = None
    ) -> QueryResult:
        """List product feeds for a profile."""
        ...

    @abstractmethod
    def create_feed(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """Insert a product feed. Returns the created row."""
        ...

    @abstractmethod
    def update_feed(
        self, feed_id: str, data: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Update a product feed by ID. Returns the updated row."""
        ...

    @abstractmethod
    def delete_feed(self, feed_id: str) -> None:
        """Delete a product feed by ID (cascades to products)."""
        ...

    # ──────────────────────────────────────────────
    # 17. Postiz Publications
    # ──────────────────────────────────────────────

    @abstractmethod
    def create_publication(
        self, data: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Insert a Postiz publication record. Returns the created row."""
        ...

    @abstractmethod
    def list_publications(
        self, clip_id: str, filters: Optional[QueryFilters] = None
    ) -> QueryResult:
        """List publications for a clip."""
        ...

    # ──────────────────────────────────────────────
    # 18. Product Groups
    # ──────────────────────────────────────────────

    @abstractmethod
    def list_product_groups(
        self, profile_id: str, filters: Optional[QueryFilters] = None
    ) -> QueryResult:
        """List product groups for a profile."""
        ...

    @abstractmethod
    def create_product_group(
        self, data: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Insert a product group. Returns the created row."""
        ...

    @abstractmethod
    def delete_product_group(self, group_id: str) -> None:
        """Delete a product group by ID."""
        ...

    # ──────────────────────────────────────────────
    # 19. Segment Product Associations
    # ──────────────────────────────────────────────

    @abstractmethod
    def list_associations(
        self, segment_id: str, filters: Optional[QueryFilters] = None
    ) -> QueryResult:
        """List product associations for a segment."""
        ...

    @abstractmethod
    def create_association(
        self, data: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Insert a segment-product association. Returns the created row."""
        ...

    @abstractmethod
    def update_association(
        self, assoc_id: str, data: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Update a segment-product association. Returns the updated row."""
        ...

    @abstractmethod
    def delete_association(self, assoc_id: str) -> None:
        """Delete a segment-product association by ID."""
        ...

    # ──────────────────────────────────────────────
    # 20. Schedule
    # ──────────────────────────────────────────────

    @abstractmethod
    def create_schedule_plan(
        self, data: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Insert a schedule plan. Returns the created row."""
        ...

    @abstractmethod
    def get_schedule_plan(
        self, plan_id: str
    ) -> Optional[Dict[str, Any]]:
        """Get a schedule plan by ID."""
        ...

    @abstractmethod
    def update_schedule_plan(
        self, plan_id: str, data: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Update a schedule plan by ID. Returns the updated row."""
        ...

    @abstractmethod
    def list_schedule_plans(
        self, profile_id: str, filters: Optional[QueryFilters] = None
    ) -> QueryResult:
        """List schedule plans for a profile."""
        ...

    @abstractmethod
    def create_schedule_items(
        self, items: List[Dict[str, Any]]
    ) -> QueryResult:
        """Bulk insert schedule items. Returns the created rows."""
        ...

    @abstractmethod
    def list_schedule_items(
        self, plan_id: str, filters: Optional[QueryFilters] = None
    ) -> QueryResult:
        """List schedule items for a plan."""
        ...

    @abstractmethod
    def update_schedule_item(
        self, item_id: str, data: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Update a schedule item by ID. Returns the updated row."""
        ...

    # ──────────────────────────────────────────────
    # 21. Generation Progress
    # ──────────────────────────────────────────────

    @abstractmethod
    def get_progress(
        self, project_id: str
    ) -> Optional[Dict[str, Any]]:
        """Get generation progress for a project."""
        ...

    @abstractmethod
    def upsert_progress(
        self, project_id: str, data: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Insert or update generation progress. Returns the row."""
        ...

    @abstractmethod
    def delete_progress(self, project_id: str) -> None:
        """Delete generation progress for a project."""
        ...

    # ──────────────────────────────────────────────
    # 22. Generated Images
    # ──────────────────────────────────────────────

    @abstractmethod
    def create_generated_image(
        self, data: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Insert a generated image record. Returns the created row."""
        ...

    @abstractmethod
    def list_generated_images(
        self, filters: Optional[QueryFilters] = None
    ) -> QueryResult:
        """List generated images, optionally filtered."""
        ...

    @abstractmethod
    def get_generated_image(
        self, image_id: str
    ) -> Optional[Dict[str, Any]]:
        """Get a generated image by ID."""
        ...

    @abstractmethod
    def update_generated_image(
        self, image_id: str, data: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Update a generated image by ID. Returns the updated row."""
        ...

    @abstractmethod
    def delete_generated_image(self, image_id: str) -> None:
        """Delete a generated image by ID."""
        ...

    # ──────────────────────────────────────────────
    # 23. Image Prompt Templates
    # ──────────────────────────────────────────────

    @abstractmethod
    def list_prompt_templates(
        self, profile_id: str, filters: Optional[QueryFilters] = None
    ) -> QueryResult:
        """List image prompt templates for a profile."""
        ...

    @abstractmethod
    def create_prompt_template(
        self, data: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Insert a prompt template. Returns the created row."""
        ...

    @abstractmethod
    def update_prompt_template(
        self, template_id: str, data: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Update a prompt template by ID. Returns the updated row."""
        ...

    @abstractmethod
    def delete_prompt_template(self, template_id: str) -> None:
        """Delete a prompt template by ID."""
        ...

    # ──────────────────────────────────────────────
    # 24. Catalog Views (read-only)
    # ──────────────────────────────────────────────

    @abstractmethod
    def list_catalog_products(
        self, filters: Optional[QueryFilters] = None
    ) -> QueryResult:
        """List catalog products (from view or equivalent query)."""
        ...

    @abstractmethod
    def list_catalog_products_grouped(
        self, filters: Optional[QueryFilters] = None
    ) -> QueryResult:
        """List catalog products grouped by group_key."""
        ...

    # ──────────────────────────────────────────────
    # 25. Generic escape hatch
    # ──────────────────────────────────────────────

    @abstractmethod
    def table_query(
        self,
        table_name: str,
        operation: str,
        data: Optional[Dict[str, Any]] = None,
        filters: Optional[QueryFilters] = None,
    ) -> QueryResult:
        """Generic table operation for edge-case queries.

        Args:
            table_name: The table to operate on.
            operation: One of 'select', 'insert', 'update', 'delete', 'upsert'.
            data: Row data for insert/update/upsert operations.
            filters: Query filters for select/update/delete operations.

        Returns:
            QueryResult with operation results.

        This escape hatch prevents the need to add a new method for
        every one-off query pattern.
        """
        ...
