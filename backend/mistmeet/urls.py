from django.contrib import admin
from django.db import connection
from django.http import JsonResponse
from django.urls import include, path


def health(request):
    """Liveness check that also reports whether the database is fully set up."""
    from django.apps import apps
    from django.db.migrations.autodetector import MigrationAutodetector
    from django.db.migrations.executor import MigrationExecutor
    from django.db.migrations.state import ProjectState

    info = {"status": "ok"}
    try:
        executor = MigrationExecutor(connection)
        plan = executor.migration_plan(executor.loader.graph.leaf_nodes())
        info["pending_migrations"] = [f"{m.app_label}.{m.name}" for m, _ in plan]
        changes = MigrationAutodetector(
            executor.loader.project_state(), ProjectState.from_apps(apps)
        ).changes(graph=executor.loader.graph)
        info["missing_migration_files"] = sorted(changes.keys())
        info["database"] = "ready" if not plan and not changes else "needs setup"
    except Exception as exc:  # database unreachable or misconfigured
        info["database"] = f"error: {exc.__class__.__name__}"
    return JsonResponse(info)


urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/health/", health),
    path("api/auth/", include("accounts.urls")),
    path("api/", include("meetings.urls")),
]
