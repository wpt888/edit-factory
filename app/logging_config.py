"""
Structured JSON logging configuration for Edit Factory backend.

All backend modules share this logger setup so log output is valid JSON
parseable by log aggregators (Datadog, Loki, CloudWatch, etc.).
"""
import logging
import sys
from pythonjsonlogger import jsonlogger


def setup_logging(level=logging.INFO):
    """Configure structured JSON logging for all loggers."""
    handler = logging.StreamHandler(sys.stdout)
    formatter = jsonlogger.JsonFormatter(
        fmt="%(asctime)s %(name)s %(levelname)s %(message)s",
        rename_fields={"asctime": "timestamp", "levelname": "level", "name": "logger"},
        datefmt="%Y-%m-%dT%H:%M:%S"
    )
    handler.setFormatter(formatter)

    root = logging.getLogger()
    root.handlers.clear()
    root.addHandler(handler)
    root.setLevel(level)

    # Quieten noisy third-party loggers
    for noisy in ["httpcore", "httpx", "urllib3", "multipart"]:
        logging.getLogger(noisy).setLevel(logging.WARNING)
