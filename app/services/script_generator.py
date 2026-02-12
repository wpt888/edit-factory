"""
AI Script Generator Service
Generates TTS-safe scripts using Gemini or Claude AI with segment keyword awareness.
"""
import re
import logging
from typing import List, Optional
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
        gemini_model: str = "gemini-2.5-flash"
    ):
        """
        Initialize script generator with API keys.

        Args:
            gemini_api_key: Google Gemini API key
            anthropic_api_key: Anthropic Claude API key
            gemini_model: Gemini model to use (default: gemini-2.5-flash)
        """
        self.gemini_api_key = gemini_api_key
        self.anthropic_api_key = anthropic_api_key
        self.gemini_model = gemini_model

        # Lazy-initialized clients
        self._gemini_client = None
        self._anthropic_client = None

        logger.info(f"ScriptGenerator initialized (gemini_model={gemini_model})")

    def generate_scripts(
        self,
        idea: str,
        context: str,
        keywords: List[str],
        variant_count: int,
        provider: str
    ) -> List[str]:
        """
        Generate N script variants using specified AI provider.

        Args:
            idea: User's video idea/concept
            context: Product/brand context
            keywords: Available segment keywords from library
            variant_count: Number of script variants to generate (1-10)
            provider: "gemini" or "claude"

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
            f"(idea: {idea[:50]}..., {len(keywords)} keywords available)"
        )

        # Build prompt
        prompt = self._build_prompt(idea, context, keywords, variant_count)

        # Generate with selected provider
        try:
            if provider == "gemini":
                raw_response = self._generate_with_gemini(prompt)
            else:  # claude
                raw_response = self._generate_with_claude(prompt)

            # Parse and sanitize scripts
            scripts = self._parse_scripts(raw_response, variant_count)

            # Sanitize for TTS
            clean_scripts = [self._sanitize_for_tts(script) for script in scripts]

            logger.info(f"Successfully generated {len(clean_scripts)} scripts")

            if len(clean_scripts) < variant_count:
                logger.warning(
                    f"Generated fewer scripts than requested: {len(clean_scripts)}/{variant_count}"
                )

            return clean_scripts

        except Exception as e:
            logger.error(f"Script generation failed with {provider}: {e}")
            raise

    def _build_prompt(
        self,
        idea: str,
        context: str,
        keywords: List[str],
        variant_count: int
    ) -> str:
        """Build AI prompt for script generation."""
        keyword_list = ", ".join(keywords) if keywords else "none available"

        prompt = f"""Generate {variant_count} script variants for a social media video (reel/TikTok/YouTube Short).

**User's Idea:** {idea}

**Product/Brand Context:** {context or "Not provided"}

**Available Visual Keywords:** {keyword_list}

**Instructions:**
1. Generate EXACTLY {variant_count} unique script variants
2. Each script is a standalone voiceover narration
3. Target length: 75-150 words (~30-60 seconds when spoken)
4. Each variant should take a different angle/approach to the same idea
5. Naturally incorporate some (not all) of the available keywords where relevant
6. Write in the same language as the user's idea
7. Use conversational, engaging language suitable for social media

**CRITICAL TTS-SAFE FORMAT RULES:**
- Plain text only - NO emojis, NO hashtags, NO markdown
- NO stage directions like [pause], (whisper), *action*
- NO brackets or parentheses for actions
- Use proper punctuation for natural pauses (periods, commas, question marks)
- Each script should flow naturally when read aloud

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
        if self._gemini_client is None:
            self._gemini_client = genai.Client(api_key=self.gemini_api_key)

        logger.info(f"Calling Gemini API with model {self.gemini_model}")

        response = self._gemini_client.models.generate_content(
            model=self.gemini_model,
            contents=prompt
        )

        return response.text

    def _generate_with_claude(self, prompt: str) -> str:
        """Generate content using Anthropic Claude API."""
        if self._anthropic_client is None:
            self._anthropic_client = anthropic.Anthropic(api_key=self.anthropic_api_key)

        logger.info("Calling Anthropic Claude API")

        response = self._anthropic_client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=4096,
            messages=[{
                "role": "user",
                "content": prompt
            }]
        )

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
        # Split by delimiter
        scripts = raw_response.split("---SCRIPT---")

        # Clean each script
        cleaned = []
        for script in scripts:
            script = script.strip()
            if script:
                # Remove any markdown formatting that might have slipped through
                script = re.sub(r'\*\*([^*]+)\*\*', r'\1', script)  # Bold
                script = re.sub(r'\*([^*]+)\*', r'\1', script)      # Italic
                script = re.sub(r'_([^_]+)_', r'\1', script)        # Italic underscore
                script = re.sub(r'#+ ', '', script)                 # Headers

                cleaned.append(script)

        return cleaned

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

        # Remove stage directions in brackets/parentheses
        text = re.sub(r'\[([^\]]+)\]', '', text)  # [pause], [dramatic]
        text = re.sub(r'\(([^\)]+)\)', '', text)  # (whisper), (loudly)

        # Remove hashtags
        text = re.sub(r'#\w+', '', text)

        # Remove markdown formatting
        text = re.sub(r'\*\*([^*]+)\*\*', r'\1', text)  # Bold
        text = re.sub(r'\*([^*]+)\*', r'\1', text)      # Italic
        text = re.sub(r'_([^_]+)_', r'\1', text)        # Italic underscore
        text = re.sub(r'~~([^~]+)~~', r'\1', text)      # Strikethrough
        text = re.sub(r'`([^`]+)`', r'\1', text)        # Inline code
        text = re.sub(r'^#+\s*', '', text, flags=re.MULTILINE)  # Headers

        # Collapse multiple whitespace/newlines into single spaces
        text = re.sub(r'\s+', ' ', text)

        # Clean up spacing around punctuation
        text = re.sub(r'\s+([.,!?;:])', r'\1', text)
        text = re.sub(r'([.,!?;:])\s+', r'\1 ', text)

        return text.strip()


# Singleton instance
_script_generator = None


def get_script_generator() -> ScriptGenerator:
    """
    Factory function to get ScriptGenerator singleton instance.

    Returns:
        ScriptGenerator instance configured with API keys from settings
    """
    global _script_generator
    if _script_generator is None:
        from app.config import get_settings
        settings = get_settings()

        _script_generator = ScriptGenerator(
            gemini_api_key=settings.gemini_api_key,
            anthropic_api_key=settings.anthropic_api_key,
            gemini_model=settings.gemini_model
        )

    return _script_generator
