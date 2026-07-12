# AI Video with Seedance 2.0

The desktop app generates text-to-video assets through FAL's
`bytedance/seedance-2.0/text-to-video` queue using the existing profile-scoped
FAL credential (or `FAL_API_KEY` fallback). The backend owns the key and queue
polling; browser code never receives it.

## Asset lifecycle

1. `POST /api/v1/video-gen/generate` creates a `generated_videos` history row
   and starts the background Seedance task.
2. The finished result is downloaded as an MP4 to
   `source_videos/generated/<profile-id>/` before it is exposed in the UI.
3. The MP4 is registered in `editai_source_videos` and runs the normal local
   metadata, thumbnail, and proxy processing, so it is available to the
   timeline/editor as a Source Video.
4. A completed `editai_projects` + `editai_clips` pair points to the same local
   MP4. It therefore appears in Library and can use the established social
   publishing, caption, voiceover, and download routes without a special path.

Generation failures and upstream queue errors are persisted in the history row;
the queue wait is capped at 15 minutes. The migration is
`049_create_generated_videos.sql`; SQLite development schema has the matching
table.
