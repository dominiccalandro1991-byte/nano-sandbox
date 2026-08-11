"""nano-sandbox remote validation engine.

This service is an OPTIONAL remote engine. The NanoHabitat Sandbox Engine
(NHSE) that ships in the frontend is fully self-contained and runs entirely
on-device in the browser. Nothing in the frontend requires this backend to
exist. When a remote engine URL is configured in the NHSE "Remote" tab, the
frontend will call out to this service for validation jobs that are too
heavy, too long-running, or too unsafe (arbitrary code execution) to run
inside a browser tab. If no remote engine is configured, NHSE simply runs
without it.
"""

__version__ = "0.1.0"
