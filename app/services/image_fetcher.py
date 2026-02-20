"""
image_fetcher.py - Parallel product image downloader with placeholder fallback.

Downloads product images in parallel using httpx async + asyncio.Semaphore
for concurrency control. Failed downloads produce a gray placeholder JPEG
via FFmpeg lavfi. Images are cached on disk — re-running download for the
same product skips existing files.

Usage:
    from app.services.image_fetcher import download_product_images, update_local_image_paths
    image_map = await download_product_images(products, cache_dir, feed_id)
    update_local_image_paths(supabase, image_map, feed_id)
"""
import asyncio
import logging
import subprocess
from pathlib import Path

import httpx

logger = logging.getLogger(__name__)

# Concurrency cap — don't overwhelm CDNs or the local event loop
CONCURRENT_DOWNLOADS = 5

# Aggressive timeouts — skip slow CDNs rather than hang the pipeline
DOWNLOAD_TIMEOUT = httpx.Timeout(10.0, connect=3.0)

# User-Agent sent with all image requests
_USER_AGENT = "Mozilla/5.0 (compatible; EditFactory/1.0)"


async def download_product_images(
    products: list[dict],
    cache_dir: Path,
    feed_id: str,
) -> dict[str, str]:
    """Download product images in parallel, returning a map of external_id -> local_file_path.

    Args:
        products: List of product dicts. Each must have 'external_id'; may have 'image_link'.
        cache_dir: Root directory for the image cache.
        feed_id: Feed identifier — used for sub-directory naming.

    Returns:
        Dict mapping external_id -> absolute path of the local JPEG (or placeholder).
    """
    # Build the per-feed cache subdirectory
    feed_cache = cache_dir / feed_id
    feed_cache.mkdir(parents=True, exist_ok=True)

    semaphore = asyncio.Semaphore(CONCURRENT_DOWNLOADS)

    tasks = [_download_one(product, feed_cache, semaphore) for product in products]
    results = await asyncio.gather(*tasks)

    return dict(results)


async def _download_one(
    product: dict,
    cache_dir: Path,
    semaphore: asyncio.Semaphore,
) -> tuple[str, str]:
    """Download a single product image or return a placeholder path.

    Args:
        product: Product dict with 'external_id' and optional 'image_link'.
        cache_dir: Directory to store the downloaded/placeholder image.
        semaphore: Shared concurrency limiter.

    Returns:
        Tuple of (external_id, local_file_path).
    """
    external_id = product["external_id"]
    dest = cache_dir / f"{external_id}.jpg"

    # Cache hit — skip download
    if dest.exists():
        logger.debug("Cache hit for product %s: %s", external_id, dest)
        return (external_id, str(dest))

    image_link = product.get("image_link") or ""
    if not image_link:
        logger.warning("No image_link for product %s — generating placeholder", external_id)
        return (external_id, _make_placeholder(dest))

    try:
        async with semaphore:
            async with httpx.AsyncClient(
                follow_redirects=True,
                timeout=DOWNLOAD_TIMEOUT,
                headers={"User-Agent": _USER_AGENT},
            ) as client:
                response = await client.get(image_link)
                response.raise_for_status()

                content_type = response.headers.get("content-type", "").lower()

                if "image/webp" in content_type:
                    # Save webp first, then convert to jpg via FFmpeg
                    webp_path = dest.with_suffix(".webp")
                    webp_path.write_bytes(response.content)
                    _convert_webp_to_jpg(webp_path, dest)
                    if webp_path.exists():
                        webp_path.unlink()
                else:
                    dest.write_bytes(response.content)

                logger.debug("Downloaded image for product %s -> %s", external_id, dest)
                return (external_id, str(dest))

    except Exception as exc:
        logger.warning(
            "Failed to download image for product %s (url=%s): %s — using placeholder",
            external_id,
            image_link,
            exc,
        )
        return (external_id, _make_placeholder(dest))


def _convert_webp_to_jpg(webp_path: Path, jpg_path: Path) -> None:
    """Convert a .webp file to .jpg using FFmpeg.

    Args:
        webp_path: Source .webp file path.
        jpg_path: Destination .jpg file path.
    """
    cmd = [
        "ffmpeg", "-y",
        "-i", str(webp_path),
        str(jpg_path),
    ]
    result = subprocess.run(cmd, capture_output=True)
    if result.returncode != 0:
        logger.warning(
            "FFmpeg webp->jpg conversion failed for %s: %s",
            webp_path,
            result.stderr.decode(errors="replace"),
        )


def _make_placeholder(dest: Path) -> str:
    """Generate a 400x400 gray placeholder JPEG via FFmpeg lavfi.

    Args:
        dest: Output file path for the placeholder image.

    Returns:
        str(dest) — path to the created placeholder.
    """
    cmd = [
        "ffmpeg", "-y",
        "-f", "lavfi",
        "-i", "color=c=808080:s=400x400",
        "-vf", "drawtext=text='No Image':fontsize=24:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2",
        "-vframes", "1",
        str(dest),
    ]
    result = subprocess.run(cmd, capture_output=True)
    if result.returncode != 0:
        logger.error(
            "FFmpeg placeholder generation failed for %s: %s",
            dest,
            result.stderr.decode(errors="replace"),
        )
    return str(dest)


def update_local_image_paths(
    supabase,
    image_map: dict[str, str],
    feed_id: str,
) -> None:
    """Update the products table with local image paths after download.

    Performs individual UPDATE calls. Supabase-py does not support batch UPDATE,
    but for 10k products this takes ~10s in a background task — acceptable.

    Args:
        supabase: Supabase client instance.
        image_map: Dict mapping external_id -> local_file_path.
        feed_id: Feed identifier used to scope the WHERE clause.
    """
    for external_id, local_path in image_map.items():
        try:
            (
                supabase.table("products")
                .update({"local_image_path": local_path})
                .eq("feed_id", feed_id)
                .eq("external_id", external_id)
                .execute()
            )
        except Exception as exc:
            logger.warning(
                "Failed to update local_image_path for product %s: %s",
                external_id,
                exc,
            )
