"""Karaoke validity guard in the SRT cache (assembly preview/render poisoning fix)."""
from app.services import tts_cache


def _key(karaoke: bool) -> dict:
    return {"text": "hello world", "voice_id": "v1", "model_id": "m1",
            "provider": "elevenlabs_ts", "wpf": 2, "vs": "0.50_0.75_1.00", "karaoke": karaoke}


def test_poisoned_karaoke_entry_is_a_miss(tmp_path, monkeypatch):
    monkeypatch.setattr(tts_cache, "_get_cache_root", lambda: tmp_path)
    # Pre-fix poisoning: tag-less SRT stored under a karaoke=True key
    tts_cache.srt_cache_store(_key(karaoke=True), "1\n00:00:00,000 --> 00:00:01,000\nhello world\n")
    assert tts_cache.srt_cache_lookup(_key(karaoke=True)) is None


def test_valid_karaoke_entry_is_a_hit(tmp_path, monkeypatch):
    monkeypatch.setattr(tts_cache, "_get_cache_root", lambda: tmp_path)
    content = "1\n00:00:00,000 --> 00:00:01,000\n{\\k50}hello {\\k50}world\n"
    tts_cache.srt_cache_store(_key(karaoke=True), content)
    assert tts_cache.srt_cache_lookup(_key(karaoke=True)) == content


def test_non_karaoke_entry_unaffected(tmp_path, monkeypatch):
    monkeypatch.setattr(tts_cache, "_get_cache_root", lambda: tmp_path)
    content = "1\n00:00:00,000 --> 00:00:01,000\nhello world\n"
    tts_cache.srt_cache_store(_key(karaoke=False), content)
    assert tts_cache.srt_cache_lookup(_key(karaoke=False)) == content
