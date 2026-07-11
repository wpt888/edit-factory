import pytest

from app.services.tts.factory import get_tts_service


def test_kokoro_fails_fast_with_clear_message():
    with pytest.raises(NotImplementedError, match="runtime integration has not been verified"):
        get_tts_service("kokoro", "test-profile")
