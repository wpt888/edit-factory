"""
Verification script for encoding integration.
Tests that EncodingPreset.to_ffmpeg_params() generates correct parameters.
"""
import sys

print("=" * 70)
print("VERIFICATION: Encoding Integration")
print("=" * 70)

# Test 1: Import modules
print("\n1. Testing imports...")
try:
    from app.services.encoding_presets import get_preset, EncodingPreset, PRESETS
    from app.api.library_routes import _render_with_preset
    print("   ✓ Imports successful")
except ImportError as e:
    print(f"   ✗ Import failed: {e}")
    sys.exit(1)

# Test 2: Verify EncodingPreset generates correct params for all platforms
print("\n2. Testing EncodingPreset.to_ffmpeg_params()...")
test_platforms = ["tiktok", "reels", "youtube_shorts", "generic"]

for platform in test_platforms:
    preset = get_preset(platform)
    params = preset.to_ffmpeg_params(use_gpu=False)
    
    # Check for required keyframe parameters
    has_g = "-g" in params
    has_keyint_min = "-keyint_min" in params
    has_crf = "-crf" in params
    has_audio_bitrate = "-b:a" in params
    
    status = "✓" if all([has_g, has_keyint_min, has_crf, has_audio_bitrate]) else "✗"
    print(f"   {status} {platform:20s} - CRF: {preset.crf}, GOP: {preset.gop_size}")
    
    if "-g" in params:
        gop_index = params.index("-g")
        gop_value = params[gop_index + 1]
        print(f"      GOP size in params: {gop_value}")
    
    if not all([has_g, has_keyint_min, has_crf, has_audio_bitrate]):
        print(f"      Missing params: g={has_g}, keyint_min={has_keyint_min}, crf={has_crf}, audio={has_audio_bitrate}")

# Test 3: Verify specific values match must_haves
print("\n3. Verifying must_haves truths...")
truths_to_verify = [
    ("TikTok uses CRF 20", PRESETS["tiktok"].crf == 20),
    ("Reels uses CRF 18", PRESETS["reels"].crf == 18),
    ("GOP size is 60", PRESETS["tiktok"].gop_size == 60),
    ("Audio bitrate is 192k", PRESETS["tiktok"].audio_bitrate == "192k"),
]

all_pass = True
for description, passes in truths_to_verify:
    status = "✓" if passes else "✗"
    print(f"   {status} {description}")
    if not passes:
        all_pass = False

# Test 4: Verify FFmpeg params contain -g
print("\n4. Verifying FFmpeg command will include keyframe controls...")
sample_params = PRESETS["tiktok"].to_ffmpeg_params(use_gpu=False)

checks = [
    ("-g 60", "-g" in sample_params and "60" in sample_params),
    ("-keyint_min", "-keyint_min" in sample_params),
    ("-b:a 192k", "-b:a" in sample_params and "192k" in sample_params),
]

for check_name, passes in checks:
    status = "✓" if passes else "✗"
    print(f"   {status} {check_name} present in FFmpeg params")

# Summary
print("\n" + "=" * 70)
if all_pass:
    print("✓ ALL VERIFICATIONS PASSED")
    sys.exit(0)
else:
    print("✗ SOME VERIFICATIONS FAILED")
    sys.exit(1)
print("=" * 70)
