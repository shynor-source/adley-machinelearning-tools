"""ASGI entrypoint used by uvicorn in production and local runs.

Creating the app here (instead of importing `app` from `app.main`) keeps the
factory importable by tests without requiring production environment settings.
"""

from .main import create_app


app = create_app()
