# Edit Factory Backend - Docker Image
# Multi-stage build for smaller image size

FROM python:3.11-slim AS base

# Set environment variables
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# Install system dependencies (FFmpeg, etc.)
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    espeak-ng \
    ffmpeg \
    libmagic1 \
    libsm6 \
    libxext6 \
    libgl1 \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
FROM base AS builder

COPY requirements.txt .

# Create virtual environment and install dependencies
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Kokoro depends on PyTorch.  PyPI's generic amd64 wheel pulls several
# gigabytes of CUDA libraries even though this service renders on CPU.  Pin the
# official CPU wheel explicitly; the same index publishes cp311/aarch64 for the
# prod-nortia build.
ARG TORCH_VERSION=2.13.0+cpu
RUN pip install --upgrade pip && \
    pip install --index-url https://download.pytorch.org/whl/cpu "torch==${TORCH_VERSION}" && \
    pip install -r requirements.txt

# Final stage
FROM base AS final

ARG APP_PORT=8000

# Copy virtual environment from builder
COPY --from=builder /opt/venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH" \
    PORT="${APP_PORT}"

# Copy application code
COPY app/ ./app/
COPY run.py .

# Run the API as an unprivileged user.  The production Compose file mounts its
# persistent working set at /data and points every writable application path
# there; keeping /app read-only prevents uploaded media from mixing with code.
RUN addgroup --system --gid 1001 blipost && \
    adduser --system --uid 1001 --ingroup blipost --home /home/blipost blipost && \
    mkdir -p /data /home/blipost && \
    chown -R blipost:blipost /data /home/blipost

USER blipost

# Expose port
EXPOSE ${APP_PORT}

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD curl --fail --silent --show-error "http://127.0.0.1:${PORT}/api/v1/health/live" || exit 1

# Run the application
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT}"]
