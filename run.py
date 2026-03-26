#!/usr/bin/env python3
"""
Edit Factory - Run Script
Porneste serverul FastAPI.
"""
import uvicorn
from app.config import get_settings, APP_VERSION

if __name__ == "__main__":
    settings = get_settings()

    print(f"""
    ===============================================
              EDIT FACTORY {APP_VERSION}
    ===============================================
      Server: http://{settings.host}:{settings.port}
      Docs:   http://localhost:{settings.port}/docs
      UI:     http://localhost:{settings.port}/static
    ===============================================
    """)

    uvicorn.run(
        "app.main:app",
        host=settings.host,
        port=settings.port,
        reload=settings.debug
    )
