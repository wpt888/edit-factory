"""SQLite list_segments must emulate the Supabase embedded source-video join.

assembly_service and library available-segments read
seg["editai_source_videos"]["file_path"]; without the emulated join every
segment looked path-less under SQLite ("No usable segments found").
"""
import uuid


def test_list_segments_attaches_source_video_embed(sqlite_backend):
    client, repo, profile_id = sqlite_backend

    video_id = str(uuid.uuid4())
    repo.create_source_video({
        "id": video_id,
        "profile_id": profile_id,
        "name": "Embed Test Video",
        "file_path": "C:/videos/embed-test.mp4",
        "duration": 30.0,
        "status": "ready",
    })
    seg_id = str(uuid.uuid4())
    repo.create_segment({
        "id": seg_id,
        "source_video_id": video_id,
        "profile_id": profile_id,
        "start_time": 0.0,
        "end_time": 5.0,
        "keywords": ["alpha", "beta"],
    })

    result = repo.list_segments(profile_id)
    seg = next(s for s in result.data if s["id"] == seg_id)

    embed = seg.get("editai_source_videos")
    assert embed is not None, "embedded source video dict missing"
    assert embed["file_path"] == "C:/videos/embed-test.mp4"
    assert embed["name"] == "Embed Test Video"
    assert embed["duration"] == 30.0
    # JSON columns round-trip as Python lists
    assert seg["keywords"] == ["alpha", "beta"]
