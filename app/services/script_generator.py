"""
AI Script Generator Service
Generates TTS-safe scripts using Gemini or Claude AI with segment keyword awareness.
"""
import re
import time
import logging
import threading
from typing import List, Optional, Dict
from google import genai
import anthropic

logger = logging.getLogger(__name__)


class ScriptGenerator:
    """
    AI-powered script generation for social media videos.

    Supports Gemini and Claude providers, generates TTS-safe scripts with
    keyword awareness for downstream video segment matching.
    """

    def __init__(
        self,
        gemini_api_key: Optional[str] = None,
        anthropic_api_key: Optional[str] = None,
        gemini_model: str = "gemini-2.5-flash",
        anthropic_model: str = "claude-sonnet-4-6"
    ):
        """
        Initialize script generator with API keys.

        Args:
            gemini_api_key: Google Gemini API key
            anthropic_api_key: Anthropic Claude API key
            gemini_model: Gemini model to use (default: gemini-2.5-flash)
            anthropic_model: Anthropic model to use (default: claude-sonnet-4-6)
        """
        self.gemini_api_key = gemini_api_key
        self.anthropic_api_key = anthropic_api_key
        self.gemini_model = gemini_model
        self.anthropic_model = anthropic_model

        # Lazy-initialized clients (protected by _client_lock for thread safety)
        self._gemini_client = None
        self._anthropic_client = None
        self._client_lock = threading.Lock()

        logger.info(f"ScriptGenerator initialized (gemini_model={gemini_model})")

    def generate_scripts(
        self,
        idea: str,
        context: str,
        keywords: List[str],
        variant_count: int,
        provider: str,
        product_groups: Optional[Dict[str, List[str]]] = None,
        ai_instructions: str = "",
        target_duration: Optional[float] = None
    ) -> List[str]:
        """
        Generate N script variants using specified AI provider.

        Args:
            idea: User's video idea/concept
            context: Product/brand context
            keywords: Available segment keywords from library
            variant_count: Number of script variants to generate (1-10)
            provider: "gemini" or "claude"
            product_groups: Optional dict mapping group labels to keyword lists
            ai_instructions: Optional creator rules/guidelines for the AI
            target_duration: Optional target duration in seconds for word count estimation

        Returns:
            List of clean, TTS-safe script texts

        Raises:
            ValueError: If provider is invalid or API key is missing
            Exception: If AI generation fails
        """
        # Validate provider
        if provider not in ["gemini", "claude"]:
            raise ValueError(f"Invalid provider: {provider}. Must be 'gemini' or 'claude'")

        # Validate variant count
        if variant_count < 1 or variant_count > 10:
            raise ValueError(f"Invalid variant_count: {variant_count}. Must be between 1 and 10")

        # Check API key availability
        if provider == "gemini" and not self.gemini_api_key:
            raise ValueError("GEMINI_API_KEY is required for Gemini provider")
        if provider == "claude" and not self.anthropic_api_key:
            raise ValueError("ANTHROPIC_API_KEY is required for Claude provider")

        logger.info(
            f"Generating {variant_count} scripts with {provider} "
            f"(idea: {idea[:50]}{'...' if len(idea) > 50 else ''}, {len(keywords)} keywords available)"
        )

        # Build prompt
        prompt = self._build_prompt(idea, context, keywords, variant_count, product_groups, ai_instructions, target_duration)

        # Generate with selected provider (1 retry for 429/5xx errors)
        last_error = None
        for attempt in range(2):
            try:
                if provider == "gemini":
                    raw_response = self._generate_with_gemini(prompt)
                else:  # claude
                    raw_response = self._generate_with_claude(prompt, variant_count)

                # Parse and sanitize scripts
                scripts = self._parse_scripts(raw_response, variant_count)

                # Sanitize for TTS
                clean_scripts = [self._sanitize_for_tts(script) for script in scripts]

                logger.info(f"Successfully generated {len(clean_scripts)} scripts")

                # SCR-12: Fail explicitly if no valid scripts were produced
                if not clean_scripts:
                    raise ValueError("No valid scripts generated — AI response could not be parsed into scripts")

                if len(clean_scripts) < variant_count:
                    logger.warning(
                        f"Generated fewer scripts than requested: {len(clean_scripts)}/{variant_count}"
                    )

                return clean_scripts

            except Exception as e:
                last_error = e
                status = getattr(e, 'status_code', None) or getattr(e, 'code', None)
                is_retryable = (status == 429 or (isinstance(status, int) and 500 <= status < 600))
                if attempt == 0 and is_retryable:
                    logger.warning(f"Script generation attempt {attempt + 1} failed (status={status}): {e}, retrying in 2s...")
                    time.sleep(2)
                    continue
                logger.error(f"Script generation failed with {provider}: {e}")
                raise

        # Should not reach here, but just in case
        raise last_error  # type: ignore[misc]

    def _build_prompt(
        self,
        idea: str,
        context: str,
        keywords: List[str],
        variant_count: int,
        product_groups: Optional[Dict[str, List[str]]] = None,
        ai_instructions: str = "",
        target_duration: Optional[float] = None,
        words_per_sec: float = 2.3
    ) -> str:
        """Build AI prompt for script generation."""
        _strip_ctrl = lambda s: ''.join(c for c in s if c.isprintable() or c == '\n')
        idea = _strip_ctrl(idea[:500])
        context = _strip_ctrl((context or "")[:1000])
        ai_instructions = _strip_ctrl((ai_instructions or "")[:2000])
        # BUG-SG-09: Cap keywords and groups to avoid prompt bloat
        keyword_list = ", ".join(keywords[:100]) if keywords else "none available"

        # Build product groups section if available
        product_groups_section = ""
        if product_groups:
            groups_text = []
            # Limit to 20 groups to keep prompt manageable
            limited_groups = dict(list(product_groups.items())[:20])
            for group_label, group_keywords in limited_groups.items():
                groups_text.append(f"  - {group_label}: {', '.join(group_keywords)}")
            product_groups_section = f"\n**Product Groups (video segments organized by product):**\n" + "\n".join(groups_text) + "\n"

        # Build creator rules section if ai_instructions provided
        ai_rules_section = ""
        if ai_instructions.strip():
            ai_rules_section = f"\n**Creator's Rules & Guidelines:**\n{ai_instructions.strip()}\n"

        # Compute dynamic word target based on available footage duration
        if target_duration and target_duration > 0:
            # Target 80-95% of available duration to leave breathing room
            min_duration = target_duration * 0.80
            max_duration = target_duration * 0.95
            min_words = max(20, int(min_duration * words_per_sec))
            max_words = max(min_words + 10, int(max_duration * words_per_sec))
            duration_target = f"{min_words}-{max_words} words (~{int(min_duration)}-{int(max_duration)} seconds when spoken)"
            duration_warning = f"\n8. IMPORTANT: The available video footage is approximately {int(target_duration)}s. The script MUST NOT exceed this duration when spoken, or segments will be looped."
        else:
            duration_target = "75-150 words (~30-60 seconds when spoken)"
            duration_warning = ""

        prompt = f"""Generate {variant_count} script variants for a social media video (reel/TikTok/YouTube Short).

**User's Idea:** {idea}

**Product/Brand Context:** {context or "Not provided"}

**Available Visual Keywords:** {keyword_list}
{product_groups_section}
{ai_rules_section}
**Instructions:**
1. Generate EXACTLY {variant_count} unique script variants
2. Each script is a standalone voiceover narration
3. Target length: {duration_target}
4. Each variant should take a different angle/approach to the same idea
5. Naturally incorporate some (not all) of the available keywords where relevant
6. Write in the same language as the user's idea
7. Use conversational, engaging language suitable for social media{duration_warning}

**CRITICAL TTS-SAFE FORMAT RULES:**
- Plain text only - NO emojis, NO hashtags, NO markdown
- NO stage directions like [pause], (whisper), *action*
- NO brackets or parentheses for actions
- Use proper punctuation for natural pauses (periods, commas, question marks)
- Each script should flow naturally when read aloud
- IMPORTANT: Write each sentence on its own line with a blank line between sentences (one sentence per line, double-newline separated)

**Output Format:**
Separate each script with "---SCRIPT---" delimiter:

Script 1 text here...
---SCRIPT---
Script 2 text here...
---SCRIPT---
Script 3 text here...

Begin generation now:"""

        return prompt

    def _generate_with_gemini(self, prompt: str) -> str:
        """Generate content using Gemini API."""
        with self._client_lock:
            if self._gemini_client is None:
                self._gemini_client = genai.Client(
                    api_key=self.gemini_api_key,
                    http_options={"timeout": 120},
                )
            client = self._gemini_client

        logger.info(f"Calling Gemini API with model {self.gemini_model}")

        response = client.models.generate_content(
            model=self.gemini_model,
            contents=prompt
        )

        # SCR-01: Validate response before accessing .text
        if not response.candidates:
            raise RuntimeError("Gemini returned no candidates")

        finish_reason = getattr(response.candidates[0], "finish_reason", None)
        if finish_reason is not None:
            # finish_reason may be an enum or string depending on SDK version
            reason_str = str(finish_reason).upper()
            if "SAFETY" in reason_str or "RECITATION" in reason_str:
                raise RuntimeError(
                    f"Gemini response blocked by safety filter (finish_reason={finish_reason})"
                )

        text = response.text
        if not text:
            raise RuntimeError("Gemini returned empty response")
        return text

    def _generate_with_claude(self, prompt: str, variant_count: int = 3) -> str:
        """Generate content using Anthropic Claude API."""
        with self._client_lock:
            if self._anthropic_client is None:
                self._anthropic_client = anthropic.Anthropic(
                    api_key=self.anthropic_api_key,
                    timeout=120.0,
                )
            client = self._anthropic_client

        logger.info("Calling Anthropic Claude API")

        response = client.messages.create(
            model=self.anthropic_model,
            max_tokens=min(8192, 1024 + variant_count * 800),
            messages=[{
                "role": "user",
                "content": prompt
            }]
        )

        # SCR-02: Validate response before accessing content
        if not response.content:
            raise RuntimeError("Claude returned empty response")
        if response.content[0].type != "text":
            raise RuntimeError(f"Unexpected content type: {response.content[0].type}")

        if response.stop_reason == "max_tokens":
            logger.warning(f"Claude response was truncated (max_tokens reached for {variant_count} variants)")

        return response.content[0].text

    def _parse_scripts(self, raw_response: str, variant_count: int) -> List[str]:
        """
        Parse AI response into individual scripts.

        Args:
            raw_response: Raw AI response text
            variant_count: Expected number of scripts

        Returns:
            List of individual script texts
        """
        # Split by primary delimiter (line-anchored to avoid matching inside text)
        scripts = re.split(r'(?m)^---SCRIPT---$', raw_response)

        # BUG-SG-11: Skip preamble — first element from split is often an AI
        # intro like "Here are the scripts:" rather than actual script content.
        if len(scripts) > 1 and scripts[0].strip():
            first = scripts[0].strip()
            if len(first) < 20 or not re.search(r'[.!?]', first):
                scripts = scripts[1:]

        # SCR-07: Fallback delimiter — if primary delimiter yields only 1 chunk,
        # try numbered format like "Script 1:", "Script 2:", etc.
        if len([s for s in scripts if s.strip()]) <= 1:
            numbered_parts = re.split(r'(?:^|\n)\s*Script\s+\d+\s*:\s*', raw_response, flags=re.IGNORECASE)
            numbered_parts = [p for p in numbered_parts if p.strip()]
            if len(numbered_parts) > 1:
                logger.info(f"Primary delimiter failed, using numbered 'Script N:' fallback ({len(numbered_parts)} scripts found)")
                scripts = numbered_parts

        # Clean each script
        cleaned = []
        for script in scripts:
            script = script.strip()
            if script:
                # BUG-SG-08: Markdown removal moved to _sanitize_for_tts to avoid
                # duplicate logic. _format_sentences runs here first, then
                # _sanitize_for_tts preserves the sentence-per-line formatting.
                script = self._format_sentences(script)
                cleaned.append(script)

        # Truncate to requested variant_count to avoid returning excess scripts
        cleaned = cleaned[:variant_count]

        return cleaned

    def _format_sentences(self, text: str) -> str:
        """Format script so each sentence starts on a new line."""
        # If already has multiple lines, assume it's formatted
        lines = [l.strip() for l in text.strip().split('\n') if l.strip()]
        if len(lines) >= 3:
            return '\n\n'.join(lines)

        # Otherwise, split by sentence-ending punctuation and put each on its own line
        # Split on . ! ? followed by a space and uppercase letter (or end of string)
        sentences = re.split(r'(?<=[.!?])\s+(?=[A-Z])', text.strip())
        return '\n\n'.join(s.strip() for s in sentences if s.strip())

    def _sanitize_for_tts(self, text: str) -> str:
        """
        Sanitize text to be TTS-safe.

        Removes emojis, markdown, stage directions, and other non-TTS content
        while preserving proper punctuation.

        Args:
            text: Raw script text

        Returns:
            Clean TTS-ready text
        """
        # Remove emojis (Unicode emoji ranges)
        emoji_pattern = re.compile(
            "["
            "\U0001F600-\U0001F64F"  # emoticons
            "\U0001F300-\U0001F5FF"  # symbols & pictographs
            "\U0001F680-\U0001F6FF"  # transport & map symbols
            "\U0001F1E0-\U0001F1FF"  # flags (iOS)
            "\U00002702-\U000027B0"
            "\U000024C2-\U0001F251"
            "]+",
            flags=re.UNICODE
        )
        text = emoji_pattern.sub('', text)

        # Remove markdown links [text](url)
        text = re.sub(r'\[([^\]]+)\]\([^\)]+\)', r'\1', text)

        # SCR-09: Remove only common stage-direction brackets (e.g. [pause], [laughs],
        # [music], [dramatic pause], [soft voice]).  Product group tags like [ProductName]
        # are stripped earlier in the pipeline flow by strip_product_group_tags(), so they
        # should not reach here.  This targeted regex avoids removing unexpected bracket
        # content that may be legitimate speech.
        _stage_directions = (
            r'pause|laughs?|music|dramatic|whisper|softly|loudly|silence|beat|'
            r'sigh|clap|gasp|cheer|applause|dramatic\s+pause|soft\s+voice|'
            r'voice\s+over|narrator|transition|fade|cut|intro|outro'
        )
        text = re.sub(rf'\[\s*(?:{_stage_directions})\s*\]', '', text, flags=re.IGNORECASE)
        # Also catch common short bracket directions like [pause], [beat], etc.
        _short_bracket = r'pause|beat|silence|music|laughs?|sigh|gasp|clap'
        text = re.sub(rf'\[\s*(?:{_short_bracket})\s*\]', '', text, flags=re.IGNORECASE)
        # Remove only known stage directions in parentheses — e.g. (whisper), (loudly),
        # (dramatic pause).  Preserve single-word parentheticals that may be acronyms
        # like (NATO), (USD), (CEO).
        _paren_stage_directions = (
            r'pause|beat|silence|whisper|softly|loudly|music|laughs?|sigh|gasp|clap|'
            r'cheer|applause|dramatic\s+pause|soft\s+voice|voice\s+over|narrator|'
            r'transition|fade|cut|intro|outro'
        )
        text = re.sub(rf'\(\s*(?:{_paren_stage_directions})\s*\)', '', text, flags=re.IGNORECASE)

        # Remove hashtags
        text = re.sub(r'#\w+', '', text)

        # Remove markdown formatting
        text = re.sub(r'\*\*([^*]+)\*\*', r'\1', text)  # Bold
        text = re.sub(r'\*([^*]+)\*', r'\1', text)      # Italic
        text = re.sub(r'_([^_]+)_', r'\1', text)        # Italic underscore
        text = re.sub(r'~~([^~]+)~~', r'\1', text)      # Strikethrough
        text = re.sub(r'`([^`]+)`', r'\1', text)        # Inline code
        text = re.sub(r'^#+\s*', '', text, flags=re.MULTILINE)  # Headers

        # Collapse multiple spaces within lines, but preserve single newlines
        text = re.sub(r'[^\S\n]+', ' ', text)       # horizontal whitespace → single space
        text = re.sub(r'\n{3,}', '\n\n', text)      # 3+ newlines → double newline
        text = re.sub(r' *\n *', '\n', text)         # trim spaces around newlines

        # Clean up spacing around punctuation (horizontal only)
        text = re.sub(r' +([.,!?;:])', r'\1', text)
        text = re.sub(r'([.,!?;:]) +', r'\1 ', text)

        return text.strip()


# Singleton instance
_script_generator = None
_script_generator_lock = threading.Lock()


def get_script_generator() -> ScriptGenerator:
    """
    Factory function to get ScriptGenerator singleton instance.

    Returns:
        ScriptGenerator instance configured with API keys from settings
    """
    global _script_generator
    if _script_generator is None:
        with _script_generator_lock:
            if _script_generator is None:
                from app.config import get_settings
                settings = get_settings()

                # BUG-SG-10: Validate that at least one API key is present
                # before persisting the singleton
                gemini_key = settings.gemini_api_key or ""
                anthropic_key = settings.anthropic_api_key or ""
                if not gemini_key.strip() and not anthropic_key.strip():
                    raise ValueError(
                        "ScriptGenerator requires at least one API key "
                        "(gemini_api_key or anthropic_api_key). "
                        "Check your .env configuration."
                    )

                _script_generator = ScriptGenerator(
                    gemini_api_key=settings.gemini_api_key,
                    anthropic_api_key=settings.anthropic_api_key,
                    gemini_model=settings.gemini_model,
                    anthropic_model=settings.anthropic_model
                )

    return _script_generator


def reset_script_generator() -> None:
    """
    Reset the ScriptGenerator singleton instance.

    Useful for API key rotation or configuration changes at runtime.
    The next call to get_script_generator() will create a fresh instance.
    """
    global _script_generator
    with _script_generator_lock:
        _script_generator = None
        logger.info("ScriptGenerator singleton has been reset")
