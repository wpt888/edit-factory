"""
Unit tests for VideoSegment, hash functions, and VideoAnalyzer in video_processor.py.

All tests run fully offline — no real video files, no FFmpeg, no network.
cv2.VideoCapture is mocked where needed.
"""
import pytest
import numpy as np
from unittest.mock import patch, MagicMock
from pathlib import Path


# ---------------------------------------------------------------------------
# VideoSegment tests
# ---------------------------------------------------------------------------

def make_segment(
    start=0.0, end=5.0,
    motion=0.5, variance=0.5, brightness=0.5,
    blur=1.0, contrast=0.5,
    visual_hashes=None
):
    """Helper: create a VideoSegment with given params."""
    from app.services.video_processor import VideoSegment
    return VideoSegment(
        start_time=start,
        end_time=end,
        motion_score=motion,
        variance_score=variance,
        avg_brightness=brightness,
        blur_score=blur,
        contrast_score=contrast,
        visual_hashes=visual_hashes,
    )


def test_segment_duration():
    """VideoSegment.duration returns end - start."""
    seg = make_segment(start=2.0, end=7.0)
    assert seg.duration == pytest.approx(5.0)


def test_segment_duration_zero():
    """VideoSegment.duration is 0 when start == end."""
    seg = make_segment(start=3.0, end=3.0)
    assert seg.duration == pytest.approx(0.0)


def test_segment_combined_score_formula():
    """combined_score uses: motion*0.40 + variance*0.20 + blur*0.20 + contrast*0.15 + (1-|brightness-0.5|)*0.05."""
    seg = make_segment(motion=0.8, variance=0.6, brightness=0.5, blur=0.9, contrast=0.7)
    expected = (
        0.8 * 0.40 +
        0.6 * 0.20 +
        0.9 * 0.20 +
        0.7 * 0.15 +
        (1 - abs(0.5 - 0.5)) * 0.05
    )
    assert seg.combined_score == pytest.approx(expected, abs=1e-6)


def test_segment_combined_score_perfect():
    """All scores at maximum → combined_score == 1.0."""
    seg = make_segment(motion=1.0, variance=1.0, brightness=0.5, blur=1.0, contrast=1.0)
    # (1-|0.5-0.5|) = 1.0
    expected = 1.0 * 0.40 + 1.0 * 0.20 + 1.0 * 0.20 + 1.0 * 0.15 + 1.0 * 0.05
    assert seg.combined_score == pytest.approx(expected, abs=1e-6)
    assert expected == pytest.approx(1.0)


def test_segment_combined_score_zero():
    """All scores at zero — brightness component contributes 0.025 (1-|0-0.5|=0.5)."""
    seg = make_segment(motion=0.0, variance=0.0, brightness=0.0, blur=0.0, contrast=0.0)
    # (1 - abs(0.0 - 0.5)) * 0.05 = 0.5 * 0.05 = 0.025
    expected = 0.0 + 0.0 + 0.0 + 0.0 + 0.5 * 0.05
    assert seg.combined_score == pytest.approx(expected, abs=1e-6)


def test_segment_combined_score_brightness_penalty():
    """Brightness far from 0.5 reduces combined_score."""
    seg_good = make_segment(motion=0.5, variance=0.5, brightness=0.5, blur=0.5, contrast=0.5)
    seg_dark = make_segment(motion=0.5, variance=0.5, brightness=0.0, blur=0.5, contrast=0.5)
    # seg_dark gets (1-0.5)*0.05 = 0.025, seg_good gets 1.0*0.05 = 0.05
    assert seg_good.combined_score > seg_dark.combined_score


def test_segment_to_dict_keys():
    """to_dict() returns expected keys."""
    seg = make_segment()
    d = seg.to_dict()
    expected_keys = {"start", "end", "duration", "motion_score", "variance_score",
                     "blur_score", "contrast_score", "combined_score"}
    assert set(d.keys()) == expected_keys


def test_segment_to_dict_values():
    """to_dict() rounds values to 4 decimals."""
    seg = make_segment(start=0.0, end=5.123456, motion=0.12345678)
    d = seg.to_dict()
    assert d["start"] == 0.0
    assert d["end"] == 5.123456
    assert d["motion_score"] == round(0.12345678, 4)
    assert d["combined_score"] == round(seg.combined_score, 4)


def test_segment_is_visually_similar_no_hashes():
    """is_visually_similar returns False when visual_hashes is None on either segment."""
    seg_a = make_segment()
    seg_b = make_segment()
    assert seg_a.is_visually_similar(seg_b) is False


def test_segment_is_visually_similar_identical():
    """Two segments with identical hash arrays are visually similar."""
    h = np.array([True, False, True, True, False, True, False, False])
    seg_a = make_segment(visual_hashes=[h])
    seg_b = make_segment(visual_hashes=[h.copy()])
    assert seg_a.is_visually_similar(seg_b, threshold=12) is True


def test_segment_is_visually_similar_different():
    """Two segments with completely opposite hashes are NOT similar."""
    h1 = np.ones(64, dtype=bool)
    h2 = np.zeros(64, dtype=bool)
    seg_a = make_segment(visual_hashes=[h1])
    seg_b = make_segment(visual_hashes=[h2])
    # Hamming distance == 64, threshold default 12 → NOT similar
    assert seg_a.is_visually_similar(seg_b, threshold=12) is False


def test_segment_is_visually_similar_mixed():
    """When more than half of comparisons are similar, returns True."""
    from app.services.video_processor import VideoSegment
    h_same = np.ones(64, dtype=bool)
    # 3 identical hashes + 1 different hash
    h_diff = np.zeros(64, dtype=bool)
    seg_a = make_segment(visual_hashes=[h_same, h_same, h_same])
    seg_b = make_segment(visual_hashes=[h_same.copy(), h_same.copy(), h_diff])
    # 6 comparisons: h_same vs h_same (×4, dist=0 < 12 → similar), h_same vs h_diff (×2, dist=64 ≥ 12 → not similar)
    # 4/6 similar → True
    # (There are 3×3=9 comparisons)
    # similar_count: (1,1)=0,(1,2)=0,(1,3)=64 → 2 sim; (2,1)=0,(2,2)=0,(2,3)=64 → 2 sim; (3,1)=0,(3,2)=0,(3,3)=64 → 2 sim
    # total_comparisons=9, similar_count=6, ratio=0.67 → True
    assert seg_a.is_visually_similar(seg_b, threshold=12) is True


# ---------------------------------------------------------------------------
# Hash function tests
# ---------------------------------------------------------------------------

def test_hamming_distance_identical():
    """Identical boolean arrays → Hamming distance 0."""
    from app.services.video_processor import hamming_distance
    h = np.array([True, False, True, False, True])
    assert hamming_distance(h, h.copy()) == 0


def test_hamming_distance_opposite():
    """Completely opposite arrays → distance == length."""
    from app.services.video_processor import hamming_distance
    h1 = np.ones(8, dtype=bool)
    h2 = np.zeros(8, dtype=bool)
    assert hamming_distance(h1, h2) == 8


def test_hamming_distance_one_bit():
    """Arrays differing by exactly one bit → distance 1."""
    from app.services.video_processor import hamming_distance
    h1 = np.array([True, True, True, False])
    h2 = np.array([True, True, False, False])
    assert hamming_distance(h1, h2) == 1


def test_hamming_distance_symmetry():
    """Hamming distance is symmetric."""
    from app.services.video_processor import hamming_distance
    h1 = np.array([True, False, True, True, False])
    h2 = np.array([False, False, True, False, True])
    assert hamming_distance(h1, h2) == hamming_distance(h2, h1)


# ---------------------------------------------------------------------------
# VideoAnalyzer tests (cv2 mocked)
# ---------------------------------------------------------------------------

@pytest.fixture
def mock_video_analyzer(tmp_path):
    """Fixture: VideoAnalyzer with cv2.VideoCapture mocked out."""
    import cv2
    dummy_video = tmp_path / "test.mp4"
    dummy_video.touch()
    with patch("cv2.VideoCapture") as mock_cap_cls:
        instance = mock_cap_cls.return_value
        instance.isOpened.return_value = True
        instance.get.side_effect = lambda prop: {
            cv2.CAP_PROP_FRAME_WIDTH: 1920,
            cv2.CAP_PROP_FRAME_HEIGHT: 1080,
            cv2.CAP_PROP_FPS: 30.0,
            cv2.CAP_PROP_FRAME_COUNT: 900,
        }.get(prop, 0)
        instance.read.return_value = (True, np.zeros((1080, 1920, 3), dtype=np.uint8))
        # Mock _detect_rotation to avoid ffprobe subprocess call
        with patch("app.services.video_processor.VideoAnalyzer._detect_rotation", return_value=0):
            from app.services.video_processor import VideoAnalyzer
            analyzer = VideoAnalyzer(dummy_video)
            yield analyzer


def test_get_video_info(mock_video_analyzer):
    """get_video_info returns a dict with expected keys and correct values."""
    info = mock_video_analyzer.get_video_info()
    assert isinstance(info, dict)
    assert info.get("width") == 1920
    assert info.get("height") == 1080
    assert info.get("fps") == pytest.approx(30.0)
    assert info.get("frame_count") == 900


def test_calculate_blur_score(mock_video_analyzer):
    """_calculate_blur_score returns a value in [0, 1]."""
    # Create a synthetic frame — uniform gray → very low variance → low blur
    frame = np.full((480, 640, 3), 128, dtype=np.uint8)
    score = mock_video_analyzer._calculate_blur_score(frame)
    assert 0.0 <= score <= 1.0


def test_calculate_blur_score_sharp(mock_video_analyzer):
    """Sharp (high-contrast) frame has higher blur score than uniform frame."""
    # Uniform frame → very blurry
    uniform = np.full((480, 640, 3), 128, dtype=np.uint8)
    # Checkerboard frame → very sharp (max Laplacian variance)
    sharp = np.zeros((480, 640, 3), dtype=np.uint8)
    sharp[::2, ::2] = 255
    blur_uniform = mock_video_analyzer._calculate_blur_score(uniform)
    blur_sharp = mock_video_analyzer._calculate_blur_score(sharp)
    assert blur_sharp >= blur_uniform


def test_calculate_contrast_score(mock_video_analyzer):
    """_calculate_contrast_score returns a value in [0, 1]."""
    frame = np.random.randint(0, 256, (480, 640, 3), dtype=np.uint8)
    score = mock_video_analyzer._calculate_contrast_score(frame)
    assert 0.0 <= score <= 1.0


def test_calculate_contrast_score_uniform(mock_video_analyzer):
    """Uniform gray frame → near-zero contrast score."""
    frame = np.full((480, 640, 3), 128, dtype=np.uint8)
    score = mock_video_analyzer._calculate_contrast_score(frame)
    assert score < 0.1


def test_video_analyzer_init_stores_path(tmp_path):
    """VideoAnalyzer.__init__ stores video_path correctly."""
    import cv2
    dummy_video = tmp_path / "video.mp4"
    dummy_video.touch()
    with patch("cv2.VideoCapture") as mock_cap_cls:
        instance = mock_cap_cls.return_value
        instance.isOpened.return_value = True
        instance.get.return_value = 0
        instance.read.return_value = (False, None)
        with patch("app.services.video_processor.VideoAnalyzer._detect_rotation", return_value=0):
            from app.services.video_processor import VideoAnalyzer
            analyzer = VideoAnalyzer(dummy_video)
            assert analyzer.video_path == dummy_video


def test_video_analyzer_file_not_found(tmp_path):
    """VideoAnalyzer raises FileNotFoundError for missing video."""
    from app.services.video_processor import VideoAnalyzer
    missing = tmp_path / "does_not_exist.mp4"
    with pytest.raises(FileNotFoundError):
        VideoAnalyzer(missing)


# ---------------------------------------------------------------------------
# VideoProcessorService init test
# ---------------------------------------------------------------------------

def test_processor_service_init(tmp_path):
    """VideoProcessorService stores input/output/temp directories."""
    from app.services.video_processor import VideoProcessorService
    input_dir = tmp_path / "input"
    output_dir = tmp_path / "output"
    temp_dir = tmp_path / "temp"
    input_dir.mkdir()
    output_dir.mkdir()
    temp_dir.mkdir()

    service = VideoProcessorService(
        input_dir=str(input_dir),
        output_dir=str(output_dir),
        temp_dir=str(temp_dir)
    )
    assert service.input_dir == Path(input_dir)
    assert service.output_dir == Path(output_dir)
    assert service.temp_dir == Path(temp_dir)


# ---------------------------------------------------------------------------
# compute_phash test (numpy-only, no real video)
# ---------------------------------------------------------------------------

def test_compute_phash_returns_boolean_array():
    """compute_phash returns a boolean numpy array of size hash_size^2."""
    import cv2
    from app.services.video_processor import compute_phash
    # Use a real numpy frame that cv2.resize and cv2.cvtColor can process
    frame = np.random.randint(0, 256, (64, 64, 3), dtype=np.uint8)
    result = compute_phash(frame, hash_size=8)
    assert result.dtype == bool
    assert result.shape == (64,)  # 8*8


def test_compute_phash_same_frame_same_hash():
    """Identical frames produce identical hashes."""
    from app.services.video_processor import compute_phash
    frame = np.random.randint(0, 256, (64, 64, 3), dtype=np.uint8)
    h1 = compute_phash(frame)
    h2 = compute_phash(frame.copy())
    assert np.array_equal(h1, h2)
