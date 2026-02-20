"""
feed_parser.py - Streaming Google Shopping XML feed parser.

Parses Google Shopping RSS/Atom XML feeds with memory-safe streaming
using lxml iterparse + element clearing. Handles Romanian price formats,
strips HTML tags and entities from product text fields.

Exports:
    parse_feed_xml(xml_bytes) -> list[dict]
    clean_product_text(text) -> str
    parse_price(price_str) -> float | None
    upsert_products(supabase, products, feed_id) -> None

Usage:
    from app.services.feed_parser import parse_feed_xml, upsert_products
    products = parse_feed_xml(xml_bytes)
    upsert_products(supabase, products, feed_id)
"""
import html
import io
import logging
import re
from typing import Optional

logger = logging.getLogger(__name__)

# Google Shopping namespace URI
_G_NS = "http://base.google.com/ns/1.0"

# Batch size for upsert operations
_UPSERT_BATCH_SIZE = 500


def clean_product_text(text: str) -> str:
    """Strip HTML tags and decode HTML entities from product text.

    Args:
        text: Raw product text that may contain HTML tags and entities.

    Returns:
        Cleaned plain text string. Returns empty string for falsy input.

    Examples:
        >>> clean_product_text('<b>Pește</b> &amp; chips')
        'Pește & chips'
        >>> clean_product_text(None)
        ''
    """
    if not text:
        return ""
    # Strip HTML tags (first pass — handles actual <tag> characters)
    cleaned = re.sub(r"<[^>]+>", "", text)
    # Decode HTML entities (e.g. &amp; → &, &lt; → <, &gt; → >)
    cleaned = html.unescape(cleaned)
    # Strip tags again (second pass — handles HTML-entity-encoded tags like &lt;b&gt; after decode)
    cleaned = re.sub(r"<[^>]+>", "", cleaned)
    return cleaned.strip()


def parse_price(price_str: str) -> Optional[float]:
    """Parse a price string to a float, handling Romanian number formats.

    Handles:
        - "249.99 RON"    → 249.99
        - "249,99 RON"    → 249.99  (comma as decimal separator)
        - "1.249,99 RON"  → 1249.99 (dot as thousands, comma as decimal)
        - "1249.99"       → 1249.99
        - "1,249.99 USD"  → 1249.99 (comma as thousands, dot as decimal)

    Args:
        price_str: Price string from the product feed.

    Returns:
        Parsed float value, or None if input is empty/unparseable.
    """
    if not price_str or not price_str.strip():
        return None

    # Extract only the numeric portion (digits, dots, commas)
    raw = price_str.strip()
    # Find the numeric part (may contain dots and commas)
    match = re.search(r"[\d.,]+", raw)
    if not match:
        return None

    numeric = match.group(0)

    # Determine the format:
    # Case 1: Romanian format — dot as thousands separator, comma as decimal
    #   e.g. "1.249,99" → last separator is comma
    if "," in numeric and "." in numeric:
        comma_pos = numeric.rfind(",")
        dot_pos = numeric.rfind(".")
        if comma_pos > dot_pos:
            # dot is thousands (e.g. "1.249,99")
            numeric = numeric.replace(".", "").replace(",", ".")
        else:
            # comma is thousands (e.g. "1,249.99")
            numeric = numeric.replace(",", "")
    elif "," in numeric:
        # Only commas — comma as decimal separator (e.g. "249,99")
        numeric = numeric.replace(",", ".")
    # else: standard dot decimal or integer — use as-is

    try:
        return float(numeric)
    except ValueError:
        logger.warning("Could not parse price string: %r", price_str)
        return None


def parse_feed_xml(xml_bytes: bytes) -> list[dict]:
    """Stream-parse a Google Shopping XML feed using memory-safe iterparse.

    Supports both RSS (tag='item') and Atom (tag='{...}entry') formats.
    Uses elem.clear() + parent cleanup after each item to prevent
    memory accumulation for 10k+ product feeds.

    Args:
        xml_bytes: Raw XML bytes of the feed.

    Returns:
        List of product dicts with keys:
            external_id, title, price, sale_price, raw_price_str,
            raw_sale_price_str, brand, product_type, image_link,
            product_url, description, is_on_sale
    """
    from lxml import etree

    # Detect feed format from first 500 bytes
    feed_preview = xml_bytes[:500].lower()
    if b"<rss" in feed_preview:
        item_tag = "item"
        logger.info("Detected RSS format feed")
    else:
        item_tag = "{http://www.w3.org/2005/Atom}entry"
        logger.info("Detected Atom format feed")

    G = _G_NS
    products = []

    context = etree.iterparse(
        io.BytesIO(xml_bytes),
        events=("end",),
        tag=item_tag,
        recover=True,
    )

    for _event, elem in context:
        try:
            product = _parse_item(elem, G)
            if product.get("external_id") and product.get("title"):
                products.append(product)
        except Exception as exc:
            logger.warning("Failed to parse product item: %s", exc)
        finally:
            # Memory cleanup — prevent tree accumulation
            elem.clear()
            while elem.getprevious() is not None:
                del elem.getparent()[0]

    logger.info("Parsed %d products from feed", len(products))
    return products


def _parse_item(elem, g_ns: str) -> dict:
    """Extract product fields from a single <item> or <entry> element.

    Args:
        elem: lxml Element for the product item.
        g_ns: Google Shopping namespace URI.

    Returns:
        Product dict with all extractable fields.
    """
    def _text(tag: str) -> str:
        """Get text content of a namespaced child element."""
        child = elem.find(f"{{{g_ns}}}{tag}")
        if child is not None and child.text:
            return clean_product_text(child.text)
        return ""

    def _plain(tag: str) -> str:
        """Get text content of a plain (non-namespaced) child element."""
        child = elem.find(tag)
        if child is not None and child.text:
            return clean_product_text(child.text)
        return ""

    external_id = _text("id") or _plain("id")
    title = _text("title") or _plain("title")
    description = _text("description") or _plain("description")

    raw_price_str = _text("price")
    raw_sale_price_str = _text("sale_price")

    price = parse_price(raw_price_str)
    sale_price = parse_price(raw_sale_price_str)

    # is_on_sale: true when both prices exist and sale_price is strictly less
    is_on_sale = bool(
        price is not None
        and sale_price is not None
        and sale_price < price
    )

    return {
        "external_id": external_id,
        "title": title,
        "description": description,
        "brand": _text("brand"),
        "product_type": _text("product_type"),
        "raw_price_str": raw_price_str,
        "raw_sale_price_str": raw_sale_price_str,
        "price": price,
        "sale_price": sale_price,
        "is_on_sale": is_on_sale,
        "image_link": _text("image_link"),
        "product_url": _text("link") or _plain("link"),
    }


def upsert_products(supabase, products: list[dict], feed_id: str) -> None:
    """Upsert products into Supabase in batches of 500.

    Uses ON CONFLICT(feed_id, external_id) to update existing products
    rather than creating duplicates on re-sync.

    Args:
        supabase: Supabase client instance.
        products: List of product dicts from parse_feed_xml.
        feed_id: UUID of the parent feed — added to each product row.
    """
    if not products:
        logger.info("No products to upsert")
        return

    total = len(products)
    inserted = 0

    for start in range(0, total, _UPSERT_BATCH_SIZE):
        batch = products[start : start + _UPSERT_BATCH_SIZE]
        # Inject feed_id into every row
        rows = [{**p, "feed_id": feed_id} for p in batch]
        try:
            supabase.table("products").upsert(
                rows,
                on_conflict="feed_id,external_id",
            ).execute()
            inserted += len(batch)
            logger.info(
                "Upserted products %d-%d / %d for feed %s",
                start + 1,
                min(start + _UPSERT_BATCH_SIZE, total),
                total,
                feed_id,
            )
        except Exception as exc:
            logger.error(
                "Failed to upsert batch %d-%d for feed %s: %s",
                start + 1,
                min(start + _UPSERT_BATCH_SIZE, total),
                feed_id,
                exc,
            )
            raise

    logger.info("Upsert complete: %d products for feed %s", inserted, feed_id)
